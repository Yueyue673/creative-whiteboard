import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from . import backups
from .maintenance import RESTORE_MARKER, StorageLease
from .services import APIError


class OfflineBackupTests(SimpleTestCase):
    """Actual independent on-disk schemas; never uses the application's test DB."""
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.template_directory = tempfile.TemporaryDirectory(prefix="creative-backup-template-")
        cls.addClassCleanup(cls.template_directory.cleanup)
        cls.template = Path(cls.template_directory.name) / "store"
        cls.template.mkdir()
        environment = dict(os.environ, DJANGO_SETTINGS_MODULE="service.settings", PYTHONIOENCODING="utf-8",
                           CREATIVE_BOARD_HOSTED_DATA_DIR=str(cls.template), CREATIVE_BOARD_HOSTED_SECRET="fixture-secret-" + "z" * 64,
                           CREATIVE_BOARD_HOSTED_HOSTS="localhost", CREATIVE_BOARD_HOSTED_ORIGINS="")
        environment.pop("CREATIVE_BOARD_HOSTED_TRUST_PROXY", None)
        def execute(*arguments):
            return subprocess.run([sys.executable, *arguments], cwd=settings.BASE_DIR, env=environment,
                                  capture_output=True, text=True, encoding="utf-8", check=True, timeout=30)
        execute("manage.py", "migrate", "--noinput")
        fixture = r'''
import django, io, json
from datetime import timedelta
django.setup()
from django.utils import timezone
from core.sessions import SessionStore
from core.models import Account,Membership,Invitation,Initialization
from core.services import create_personal_workspace,create_shared_workspace
from core.scope import WorkspaceScope
from core.documents import put_document,change_board_state
from core.media import upload_stream,reserve_upload,checked_storage
from core.test_documents import sample_board
owner=Account.objects.create_user("owner@example.test","fixture-only-owner-passphrase-739",display_name="Fixture Owner")
editor=Account.objects.create_user("editor@example.test","fixture-only-editor-passphrase-963",display_name="Fixture Editor")
Initialization.objects.create(id=1)
create_personal_workspace(owner); create_personal_workspace(editor)
shared=create_shared_workspace(owner,"Generic shared fixture")
Membership.objects.create(workspace=shared,account=editor,role="editor")
Invitation.objects.create(workspace=shared,email="future@example.test",role="viewer",token_digest="a"*64,created_by=owner,expires_at=timezone.now()+timedelta(days=7))
scope=WorkspaceScope(shared,"owner")
_,tag=put_document(scope,owner,"board","one",sample_board("Original **words** ~~kept~~ 😀"),"new")
put_document(scope,owner,"board","one",sample_board("Newer author's words"),tag)
put_document(scope,editor,"board","one",sample_board("Exact unapplied editor words"),tag)
_,trash_tag=put_document(scope,owner,"board","trash",sample_board("Trash original"),"new")
change_board_state(scope,owner,"trash",trash_tag)
asset=upload_stream(scope,owner,io.BytesIO(b"\x89PNG\r\n\x1a\n"+bytes(range(64))),72,"generic.png","")
pending=reserve_upload(scope,editor,100,"pending.png","")
checked_storage(scope,"incoming",pending.pk,create=True).write_bytes(b"unfinished exact bytes")
orphan=scope.storage_root()/"media"/"unreserved.blob"; orphan.write_bytes(b"unreserved exact bytes")
(scope.storage_root()/"empty-subdirectory").mkdir()
from django.contrib.auth import SESSION_KEY,BACKEND_SESSION_KEY,HASH_SESSION_KEY
session=SessionStore(); session[SESSION_KEY]=str(owner.pk); session[BACKEND_SESSION_KEY]="django.contrib.auth.backends.ModelBackend"; session[HASH_SESSION_KEY]=owner.get_session_auth_hash(); session.login_label="Fixture browser"; session.save()
print(json.dumps({"asset":str(asset.pk),"workspace":str(shared.pk),"pending":str(pending.pk)}))
'''
        cls.identifiers = json.loads(execute("-c", fixture).stdout)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="creative-backup-case-")
        self.addCleanup(self.directory.cleanup)
        self.case = Path(self.directory.name)
        self.store = self.case / "store"
        shutil.copytree(self.template, self.store)
        self.override = override_settings(HOSTED_DATA_ROOT=self.store)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.package = self.case / "snapshot"
        self.target = self.case / "recovered"
        self.asset_relative = f"workspaces/{self.identifiers['workspace'].replace('-', '')}/media/{self.identifiers['asset'].replace('-', '')}.blob"

    def snapshot(self):
        with StorageLease(offline=True) as lease:
            return backups.backup_store(lease, self.package)

    def recover(self, package=None, expected=None, target=None):
        target = target or self.target
        target.mkdir(exist_ok=True)
        with override_settings(HOSTED_DATA_ROOT=target):
            with StorageLease(offline=True) as lease:
                return backups.restore_store(lease, package or self.package, expected or backups.verify_backup(package or self.package)["manifestHash"])

    def sql_dump(self, root):
        with closing(sqlite3.connect(root / "accounts.sqlite3")) as database:
            return list(database.iterdump())

    def edit_manifest(self, mutate, package=None):
        path = (package or self.package) / "manifest.json"
        value = json.loads(path.read_text())
        mutate(value)
        path.write_text(json.dumps(value), encoding="utf-8")

    def test_full_current_store_roundtrip_keeps_all_sql_rows_files_pending_orphans_and_empty_directories(self):
        before_sql = self.sql_dump(self.store)
        before_media = (self.store / self.asset_relative).read_bytes()
        result = self.snapshot()
        self.assertEqual(result["fileCount"], 4)
        self.assertEqual(result["database"]["tables"]["core_account"], 2)
        self.assertEqual(result["database"]["tables"]["core_workspace"], 3)
        self.assertEqual(result["database"]["tables"]["core_conflictdraft"], 1)
        self.assertEqual(result["database"]["tables"]["core_uploadreservation"], 1)
        self.assertEqual(result["database"]["tables"]["core_accountsession"], 1)
        self.assertEqual(result["database"]["tables"]["django_session"], 0)
        self.assertEqual(result["database"]["tables"]["core_invitation"], 1)
        restored = self.recover(expected=result["manifestHash"])
        self.assertTrue(restored["restored"])
        self.assertFalse(restored["overwroteExistingData"])
        self.assertEqual(self.sql_dump(self.target), before_sql)
        self.assertEqual(self.sql_dump(self.store), before_sql)
        self.assertEqual((self.target / self.asset_relative).read_bytes(), before_media)
        for pattern in ("*.part", "unreserved.blob"):
            source = list(self.store.rglob(pattern))[0]
            self.assertEqual((self.target / source.relative_to(self.store)).read_bytes(), source.read_bytes())
        self.assertTrue(list(self.target.rglob("empty-subdirectory"))[0].is_dir())
        self.assertFalse((self.package / backups.BACKUP_MARKER).exists())
        self.assertFalse((self.target / RESTORE_MARKER).exists())

    def test_sqlite_backup_includes_committed_wal_rows_without_copying_live_journals(self):
        with closing(sqlite3.connect(self.store / "accounts.sqlite3")) as writer:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO core_throttlebucket(key,count,expires_at) VALUES(?,?,?)", ("wal-only-fixture", 17, "2030-01-01 00:00:00"))
            writer.commit()
            self.assertTrue((self.store / "accounts.sqlite3-wal").exists())
            result = self.snapshot()
            self.assertEqual(result["database"]["tables"]["core_throttlebucket"], 1)
            self.assertFalse(list((self.package / "payload").rglob("*-wal")))
            self.recover(expected=result["manifestHash"])
            with closing(sqlite3.connect(self.target / "accounts.sqlite3")) as recovered:
                self.assertEqual(recovered.execute("SELECT count FROM core_throttlebucket WHERE key='wal-only-fixture'").fetchone(), (17,))

    def test_existing_or_nested_destination_is_rejected_before_any_original_change(self):
        original = self.sql_dump(self.store)
        for destination in (self.store, self.store / "nested", self.case):
            with StorageLease(offline=True) as lease, self.assertRaises(APIError):
                backups.backup_store(lease, destination)
        self.assertEqual(self.sql_dump(self.store), original)
        self.assertFalse((self.store / "nested").exists())

    def test_unknown_source_root_data_is_not_silently_excluded(self):
        extra = self.store / "unimplemented-task-files"
        extra.mkdir()
        (extra / "keep.txt").write_bytes(b"keep exact data")
        with StorageLease(offline=True) as lease, self.assertRaises(APIError):
            backups.backup_store(lease, self.package)
        self.assertFalse(self.package.exists())
        self.assertEqual((extra / "keep.txt").read_bytes(), b"keep exact data")

    def test_corrupt_registered_source_keeps_an_incomplete_copy_and_does_not_change_original(self):
        source = self.store / self.asset_relative
        source.write_bytes(b"X" * source.stat().st_size)
        with StorageLease(offline=True) as lease, self.assertRaises(APIError):
            backups.backup_store(lease, self.package)
        self.assertTrue((self.package / backups.BACKUP_MARKER).exists())
        self.assertEqual(source.read_bytes(), b"X" * 72)
        with self.assertRaises(APIError):
            backups.verify_backup(self.package)

    def test_missing_extra_duplicate_and_changed_backup_files_are_rejected(self):
        self.snapshot()
        for variant in ("missing", "extra", "duplicate", "changed"):
            package = self.case / variant
            shutil.copytree(self.package, package)
            path = package / "payload" / self.asset_relative
            if variant == "missing":
                path.unlink()
            elif variant == "extra":
                (package / "payload" / "workspaces" / "not-listed.bin").write_bytes(b"extra")
            elif variant == "duplicate":
                self.edit_manifest(lambda value: value["files"].append(value["files"][0]), package)
            else:
                path.write_bytes(b"X" * 72)
            with self.assertRaises(APIError):
                backups.verify_backup(package)

    def test_manifest_paths_never_read_or_write_outside_the_backup(self):
        self.snapshot()
        foreign = self.case / "foreign.txt"
        foreign.write_bytes(b"foreign original")
        for index, name in enumerate(("../foreign.txt", "/foreign.txt", "C:/foreign.txt", "workspaces/../foreign.txt", "workspaces\\foreign.txt")):
            package = self.case / f"path-case-{index}"
            shutil.copytree(self.package, package)
            self.edit_manifest(lambda value: value["files"][0].update(path=name), package)
            with self.assertRaises(APIError):
                backups.verify_backup(package)
        self.assertEqual(foreign.read_bytes(), b"foreign original")

    def test_same_size_hash_and_manifest_tampering_cannot_override_registered_database_hash(self):
        self.snapshot()
        path = self.package / "payload" / self.asset_relative
        path.write_bytes(b"X" * 72)
        changed = backups.transfer_file(path)
        def change_manifest(value):
            for item in value["files"]:
                if item["path"] == self.asset_relative:
                    item.update(changed)
        self.edit_manifest(change_manifest)
        with self.assertRaises(APIError):
            backups.verify_backup(self.package)
        with self.assertRaises(APIError):
            self.recover()
        self.assertFalse((self.target / RESTORE_MARKER).exists())
        self.assertFalse((self.target / "accounts.sqlite3").exists())

    def test_changed_or_invalid_manifest_confirmation_does_not_begin_restore(self):
        result = self.snapshot()
        self.edit_manifest(lambda value: value.update(createdAt="changed after review"))
        for expected in (result["manifestHash"], "中文", "short"):
            with self.assertRaises(APIError):
                self.recover(expected=expected)
        self.assertFalse((self.target / RESTORE_MARKER).exists())
        self.assertFalse((self.target / "accounts.sqlite3").exists())

    def test_restore_never_overwrites_existing_target_files(self):
        self.snapshot()
        self.target.mkdir()
        (self.target / "accounts.sqlite3").write_bytes(b"existing target original")
        with self.assertRaises(APIError):
            self.recover()
        self.assertEqual((self.target / "accounts.sqlite3").read_bytes(), b"existing target original")

    def test_partial_restore_stays_blocked_and_a_separate_new_target_can_recover(self):
        result = self.snapshot()
        real_transfer = backups.transfer_file
        def fail_media(source, **kwargs):
            if kwargs.get("destination") == self.target / self.asset_relative:
                raise OSError("fixture interrupted copy")
            return real_transfer(source, **kwargs)
        with patch("core.backups.transfer_file", fail_media), self.assertRaises(OSError):
            self.recover(expected=result["manifestHash"])
        self.assertTrue((self.target / RESTORE_MARKER).exists())
        with override_settings(HOSTED_DATA_ROOT=self.target), self.assertRaises(APIError):
            StorageLease()
        with self.assertRaises(APIError):
            self.recover(expected=result["manifestHash"])
        alternate = self.case / "separate-recovery"
        self.assertTrue(self.recover(target=alternate, expected=result["manifestHash"])["restored"])
        self.assertTrue((self.target / RESTORE_MARKER).exists())
        self.assertEqual(self.sql_dump(alternate), self.sql_dump(self.store))

    def test_redirect_and_actual_hardlink_sources_fail_without_copying_foreign_content(self):
        source = self.store / self.asset_relative
        foreign = self.case / "foreign.bin"
        foreign.write_bytes(b"foreign original")
        original_resolve = Path.resolve
        def redirected(path, *args, **kwargs):
            return foreign if path == source else original_resolve(path, *args, **kwargs)
        with StorageLease(offline=True) as lease:
            with patch.object(Path, "resolve", redirected), self.assertRaises(APIError):
                backups.backup_store(lease, self.package)
        self.assertFalse(self.package.exists())
        link = self.case / "linked-copy.blob"
        os.link(source, link)
        with StorageLease(offline=True) as lease, self.assertRaises(APIError):
            backups.backup_store(lease, self.package)
        self.assertEqual(foreign.read_bytes(), b"foreign original")
        self.assertEqual(link.read_bytes(), source.read_bytes())

    def test_capacity_failures_do_not_begin_backup_or_restore(self):
        low_disk = shutil._ntuple_diskusage(100, 99, 1)
        with patch("core.backups.shutil.disk_usage", return_value=low_disk):
            with StorageLease(offline=True) as lease, self.assertRaises(APIError):
                backups.backup_store(lease, self.package)
        self.assertFalse(self.package.exists())
        result = self.snapshot()
        with patch("core.backups.shutil.disk_usage", return_value=low_disk), self.assertRaises(APIError):
            self.recover(expected=result["manifestHash"])
        self.assertFalse((self.target / RESTORE_MARKER).exists())

    def test_commands_require_stopped_workers_review_and_new_store_confirmation(self):
        output = io.StringIO()
        with self.assertRaises(CommandError):
            call_command("backup_store", destination=str(self.package), stdout=output)
        with StorageLease():
            with self.assertRaises(CommandError):
                call_command("backup_store", destination=str(self.package), service_stopped=True, stdout=output)
        call_command("backup_store", destination=str(self.package), service_stopped=True, stdout=output)
        result = json.loads(output.getvalue())
        output = io.StringIO()
        call_command("verify_backup", source=str(self.package), stdout=output)
        self.assertEqual(json.loads(output.getvalue())["manifestHash"], result["manifestHash"])
        self.target.mkdir()
        with override_settings(HOSTED_DATA_ROOT=self.target), self.assertRaises(CommandError):
            call_command("restore_store", source=str(self.package), manifest_hash=result["manifestHash"], service_stopped=True, stdout=io.StringIO())

    def test_incomplete_packages_and_missing_or_invalid_databases_never_become_valid_snapshots(self):
        result = self.snapshot()
        backups.write_new(self.package / backups.BACKUP_MARKER, b"incomplete")
        with self.assertRaises(APIError):
            backups.verify_backup(self.package)
        with self.assertRaises(APIError):
            self.recover(expected=result["manifestHash"])
        (self.store / "accounts.sqlite3").unlink()
        destination = self.case / "missing-db-copy"
        with StorageLease(offline=True) as lease, self.assertRaises(APIError):
            backups.backup_store(lease, destination)
        self.assertFalse(destination.exists())

    def test_backup_copy_failure_retains_incomplete_marker_and_original_bytes(self):
        before = self.sql_dump(self.store)
        real_transfer = backups.transfer_file
        def fail_media(source, **kwargs):
            if kwargs.get("destination") == self.package / "payload" / self.asset_relative:
                raise OSError("fixture copy interrupted")
            return real_transfer(source, **kwargs)
        with StorageLease(offline=True) as lease:
            with patch("core.backups.transfer_file", fail_media), self.assertRaises(OSError):
                backups.backup_store(lease, self.package)
        self.assertTrue((self.package / backups.BACKUP_MARKER).exists())
        with self.assertRaises(APIError):
            backups.verify_backup(self.package)
        self.assertEqual(self.sql_dump(self.store), before)
        self.assertEqual((self.store / self.asset_relative).read_bytes(), b"\x89PNG\r\n\x1a\n" + bytes(range(64)))

    def test_backup_media_changed_after_review_cannot_start_restored_service(self):
        result = self.snapshot()
        actual_verify = backups.verify_backup
        def change_after_review(source, **kwargs):
            reviewed = actual_verify(source, **kwargs)
            (self.package / "payload" / self.asset_relative).write_bytes(b"X" * 72)
            return reviewed
        with patch("core.backups.verify_backup", change_after_review), self.assertRaises(APIError):
            self.recover(expected=result["manifestHash"])
        self.assertTrue((self.target / RESTORE_MARKER).exists())
        with override_settings(HOSTED_DATA_ROOT=self.target), self.assertRaises(APIError):
            StorageLease()

    def test_manifest_is_bounded_and_duplicate_keys_are_rejected(self):
        self.snapshot()
        with patch("core.backups.MAX_MANIFEST_BYTES", 8), self.assertRaises(APIError):
            backups.verify_backup(self.package)
        manifest = self.package / "manifest.json"
        value = manifest.read_text()
        manifest.write_text('{"format":"duplicate",' + value.lstrip()[1:], encoding="utf-8")
        with self.assertRaises(APIError):
            backups.verify_backup(self.package)

    def test_database_foreign_key_failures_or_unknown_migration_cannot_be_marked_as_complete(self):
        with closing(sqlite3.connect(self.store / "accounts.sqlite3")) as database:
            database.execute("UPDATE core_uploadreservation SET workspace_id=?", ("0" * 32,))
            database.commit()
        with StorageLease(offline=True) as lease, self.assertRaises(APIError):
            backups.backup_store(lease, self.package)
        self.assertTrue((self.package / backups.BACKUP_MARKER).exists())
        shutil.copyfile(self.template / "accounts.sqlite3", self.store / "accounts.sqlite3")
        with closing(sqlite3.connect(self.store / "accounts.sqlite3")) as database:
            database.execute("INSERT INTO django_migrations(app,name,applied) VALUES('core','9999_future','2030-01-01 00:00:00')")
            database.commit()
        with StorageLease(offline=True) as lease, self.assertRaises(APIError):
            backups.backup_store(lease, self.case / "future-snapshot")
        self.assertTrue((self.case / "future-snapshot" / backups.BACKUP_MARKER).exists())
