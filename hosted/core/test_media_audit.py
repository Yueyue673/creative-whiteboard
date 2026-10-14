import io
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from . import test_upload_recovery as fixtures
from .documents import put_document, usage
from .maintenance import StorageLease
from .media import checked_storage
from .models import ConflictDraft, DocumentRevision, MediaAsset, UploadReservation, WorkspaceDocument
from .scope import WorkspaceScope
from .services import APIError
from .media_audit import audit_media, Inventory


class MediaAuditTests(TestCase):
    setUp = fixtures.InterruptedUploadTests.setUp
    pending = fixtures.InterruptedUploadTests.pending
    committed = fixtures.InterruptedUploadTests.committed

    def run_audit(self):
        with StorageLease(offline=True) as lease:
            return audit_media(lease)

    def command(self, **options):
        output = io.StringIO()
        call_command("audit_media", stdout=output, **options)
        return json.loads(output.getvalue())

    def orphan(self, area="media", scope=None):
        identifier = uuid.uuid4()
        path = checked_storage(scope or self.scope, area, identifier, create=True)
        path.write_bytes(b"Synthetic original unregistered file")
        return identifier, path

    def test_registered_pending_and_unregistered_distinct_without_contents_or_private_names(self):
        asset = self.committed()
        reservation = self.pending("incoming", "media")
        identifier, original = self.orphan()
        unknown = Path(self.directory.name) / "Unpublished author name and private note.txt"
        unknown.write_text("Synthetic private original", encoding="utf-8")
        with StorageLease(offline=True) as lease, patch("core.media_audit.os.open", side_effect=AssertionError("Inventory must not open file content")):
            result = audit_media(lease)
        self.assertTrue(result["enumerationComplete"])
        self.assertEqual(result["counts"]["registeredMedia"], 1)
        self.assertEqual(result["counts"]["reservedFiles"], 2)
        self.assertEqual(result["counts"]["unregisteredFiles"], 1)
        self.assertEqual(result["counts"]["unknownEntries"], 1)
        row = next(row for row in result["findings"] if row["category"] == "unregisteredFiles")
        self.assertEqual(row["storageId"], str(identifier))
        self.assertEqual(row["workspace"], str(self.shared.pk))
        self.assertFalse(row["deletionSafe"])
        self.assertNotIn(str(asset.pk), json.dumps(result["findings"]))
        text = json.dumps(result)
        for value in (asset.filename, reservation.filename, unknown.name, unknown.read_text(), str(Path(self.directory.name))):
            self.assertNotIn(value, text)
        self.assertEqual(original.read_bytes(), b"Synthetic original unregistered file")
        self.assertTrue(UploadReservation.objects.filter(pk=reservation.pk).exists())

    def test_all_database_files_references_and_other_members_private_inputs_preserved_no_sql_writes(self):
        asset = self.committed()
        identifier, orphan = self.orphan()
        self.pending("incoming")
        board = fixtures.fixtures.sample_board("Own text " + str(identifier))
        _, tag = put_document(self.scope, self.owner, "board", "original", board, "new")
        put_document(self.scope, self.owner, "board", "original", fixtures.fixtures.sample_board("Current original"), tag)
        put_document(WorkspaceScope(self.shared, "editor"), self.editor, "board", "original", fixtures.fixtures.sample_board("Other member's private input " + str(identifier)), tag)
        self.assertTrue(ConflictDraft.objects.exists())
        self.assertTrue(DocumentRevision.objects.exists())
        before = (list(MediaAsset.objects.values()), list(UploadReservation.objects.values()), list(WorkspaceDocument.objects.values()), list(DocumentRevision.objects.values()), list(ConflictDraft.objects.values()), usage(self.shared.pk))
        raw = {path: path.read_bytes() for path in Path(self.directory.name).rglob("*") if path.is_file()}
        with CaptureQueriesContext(connection) as queries:
            result = self.run_audit()
        self.assertFalse(result["referenceSafetyChecked"])
        self.assertFalse(result["contentIntegrityChecked"])
        self.assertFalse(result["deletionSafe"])
        self.assertEqual(before, (list(MediaAsset.objects.values()), list(UploadReservation.objects.values()), list(WorkspaceDocument.objects.values()), list(DocumentRevision.objects.values()), list(ConflictDraft.objects.values()), usage(self.shared.pk)))
        self.assertEqual(raw, {path: path.read_bytes() for path in raw})
        self.assertFalse(any(row["sql"].lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT")) for row in queries.captured_queries))
        self.assertFalse(any(name in row["sql"] for row in queries.captured_queries for name in ("core_conflictdraft", "core_workspacedocument", "core_documentrevision", "email", '"notes"', '"title"', '"filename"')))

    def test_cross_workspace_identity_is_never_registered_or_assumed_discardable(self):
        asset = self.committed()
        other_scope = WorkspaceScope(self.personal, "owner")
        copied = checked_storage(other_scope, "media", asset.pk, create=True)
        copied.write_bytes(self.raw)
        result = self.run_audit()
        row = next(row for row in result["findings"] if row["category"] == "misplacedIdentity")
        self.assertEqual(row["workspace"], str(self.personal.pk))
        self.assertFalse(row["deletionSafe"])
        self.assertEqual(copied.read_bytes(), self.raw)

    def test_registered_pending_overlap_and_cross_workspace_reservation_inconsistency_preserved(self):
        asset = self.committed()
        UploadReservation.objects.create(id=asset.pk, workspace=self.shared, account=self.owner, size=asset.size, filename="Synthetic pending source")
        incoming = checked_storage(self.scope, "incoming", asset.pk, create=True)
        incoming.write_bytes(b"Synthetic extra partial upload")
        result = self.run_audit()
        self.assertEqual(result["counts"]["registeredMedia"], 1)
        self.assertEqual(result["counts"]["reservedFiles"], 1)
        UploadReservation.objects.filter(pk=asset.pk).update(workspace=self.personal)
        result = self.run_audit()
        self.assertEqual(result["counts"]["registeredMedia"], 0)
        self.assertEqual(result["counts"]["misplacedIdentity"], 2)
        self.assertEqual(checked_storage(self.scope, "media", asset.pk).read_bytes(), self.raw)
        self.assertTrue(incoming.exists())

    def test_size_mismatch_is_reported_but_equal_size_never_claims_content_integrity(self):
        asset = self.committed()
        path = checked_storage(self.scope, "media", asset.pk)
        path.write_bytes(b"Synthetic changed shorter bytes")
        result = self.run_audit()
        self.assertEqual(result["counts"]["registeredSizeMismatch"], 1)
        self.assertEqual(result["counts"]["registeredMedia"], 0)
        self.assertEqual(result["findings"][0]["storageId"], str(asset.pk))
        self.assertEqual(path.read_bytes(), b"Synthetic changed shorter bytes")
        path.write_bytes(b"X" * asset.size)
        result = self.run_audit()
        self.assertEqual(result["counts"]["registeredMedia"], 1)
        self.assertFalse(result["contentIntegrityChecked"])
        self.assertFalse(result["deletionSafe"])

    def test_unknown_workspace_area_and_nested_directories_never_traversed(self):
        self.committed()
        root = Path(self.directory.name)
        foreign = root / "workspaces" / uuid.uuid4().hex
        nested = self.scope.storage_root() / "media" / "Synthetic private folder"
        future = self.scope.storage_root() / "future-private-area"
        for directory in (foreign, nested, future):
            directory.mkdir(parents=True)
            (directory / "Synthetic-private-file.txt").write_bytes(b"Private synthetic source")
        original = os.scandir
        paths = []
        def scan(path):
            paths.append(Path(path))
            return original(path)
        with patch("core.media_audit.os.scandir", scan):
            result = self.run_audit()
        self.assertTrue(result["enumerationComplete"])
        self.assertEqual(result["uninspectedSubtrees"], 3)
        self.assertTrue(all(directory not in paths for directory in (foreign, nested, future)))
        self.assertNotIn("Synthetic-private-file", json.dumps(result))
        self.assertNotIn("future-private-area", json.dumps(result))

    def test_native_hard_link_is_reported_without_opening_or_changing_either_name(self):
        identifier, path = self.orphan()
        linked = path.parent / "Synthetic-hardlink.blob"
        try:
            os.link(path, linked)
        except PermissionError:
            self.skipTest("Current sandbox denies native hard-link creation; metadata refusal checked separately")
        result = self.run_audit()
        self.assertEqual(result["counts"]["unsafeEntries"], 2)
        self.assertEqual(result["counts"]["unregisteredFiles"], 0)
        self.assertEqual(path.read_bytes(), linked.read_bytes())
        self.assertEqual(path.stat().st_nlink, 2)

    def test_real_windows_junction_is_reported_and_target_never_scanned(self):
        if os.name != "nt":
            self.skipTest("Native Windows junction acceptance; Linux needs its separate symlink check")
        self.committed()
        root = Path(self.directory.name)
        target = root / "Synthetic-external-original"
        target.mkdir()
        original_file = target / "Synthetic-private.txt"
        original_file.write_bytes(b"Synthetic outside original bytes")
        junction = self.scope.storage_root() / "incoming"
        # A completed upload leaves an empty incoming directory. A junction
        # fixture must start at a free name, rather than fail with 'exists'.
        junction.rmdir()
        command = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(target)], capture_output=True, text=True, timeout=15)
        if command.returncode and any(value in (command.stdout+command.stderr).lower() for value in ("denied", "拒绝访问", "权限")):
            self.skipTest("Current sandbox denies native junction creation; reparse refusal checked separately")
        self.assertEqual(command.returncode, 0, command.stdout+command.stderr)
        original = os.scandir
        paths = []
        def scan(path):
            paths.append(Path(path))
            return original(path)
        try:
            with patch("core.media_audit.os.scandir", scan):
                result = self.run_audit()
            self.assertEqual(result["counts"]["unsafeEntries"], 1)
            self.assertNotIn(junction, paths)
            self.assertNotIn(target, paths)
            self.assertEqual(original_file.read_bytes(), b"Synthetic outside original bytes")
        finally:
            # rmdir removes only this fixture junction, never recurses into it.
            junction.rmdir()
        self.assertTrue(original_file.exists())

    def test_hardlink_and_reparse_metadata_refused_without_traversal_or_content_reads(self):
        identifier, path = self.orphan()
        unsafe_directory = self.scope.storage_root() / "incoming"
        unsafe_directory.mkdir()
        original = Path.lstat
        def changed(value, *args, **kwargs):
            details = original(value, *args, **kwargs)
            if value not in (path, unsafe_directory):
                return details
            fields = {key: getattr(details, key) for key in ("st_mode", "st_size", "st_mtime_ns", "st_ctime_ns", "st_dev", "st_ino", "st_nlink")}
            fields["st_file_attributes"] = getattr(details, "st_file_attributes", 0)
            if value == path:
                fields["st_nlink"] = 2
            else:
                fields["st_file_attributes"] |= 0x400
            return SimpleNamespace(**fields)
        with patch.object(Path, "lstat", changed):
            result = self.run_audit()
        self.assertEqual(result["counts"]["unsafeEntries"], 2)
        self.assertEqual(result["counts"]["unregisteredFiles"], 0)
        self.assertEqual(path.read_bytes(), b"Synthetic original unregistered file")

    def test_entry_record_and_time_limits_never_claim_complete_enumeration(self):
        self.committed()
        self.orphan()
        for limits in ({"MAX_ENTRIES": 0}, {"MAX_RECORDS": 0}, {"MAX_SECONDS": -1}):
            with patch.multiple("core.media_audit", **limits):
                result = self.run_audit()
            self.assertFalse(result["enumerationComplete"])
            self.assertEqual(result["limitReason"], "budget")
            self.assertFalse(result["deletionSafe"])

    def test_findings_limit_keeps_checked_counts_and_explicit_omissions(self):
        self.committed()
        self.orphan()
        self.orphan()
        with patch("core.media_audit.MAX_FINDINGS", 1):
            result = self.run_audit()
        self.assertTrue(result["enumerationComplete"])
        self.assertEqual(result["counts"]["unregisteredFiles"], 2)
        self.assertEqual(len(result["findings"]), 1)
        self.assertEqual(result["hiddenFindings"], 1)

    def test_directory_or_database_changes_during_inventory_refuse_a_complete_report(self):
        asset = self.committed()
        self.orphan()
        original = Inventory.finding
        done = []
        def change_directory(audit, *args, **kwargs):
            original(audit, *args, **kwargs)
            if not done:
                (audit.root / "Synthetic-late-file.txt").write_bytes(b"New source")
                done.append(True)
        with patch.object(Inventory, "finding", change_directory), self.assertRaises(APIError) as caught:
            self.run_audit()
        self.assertEqual(caught.exception.status, 409)
        (Path(self.directory.name) / "Synthetic-late-file.txt").unlink()
        done.clear()
        def change_database(audit, *args, **kwargs):
            original(audit, *args, **kwargs)
            if not done:
                MediaAsset.objects.filter(pk=asset.pk).update(size=asset.size+1)
                done.append(True)
        with patch.object(Inventory, "finding", change_database), self.assertRaises(APIError) as caught:
            self.run_audit()
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(checked_storage(self.scope, "media", asset.pk).read_bytes(), self.raw)

    def test_read_errors_are_generic_and_do_not_publish_raw_private_paths(self):
        self.committed()
        with patch("core.media_audit.os.scandir", side_effect=PermissionError("Unpublished private path")), self.assertRaises(CommandError) as caught:
            self.command(service_stopped=True)
        self.assertNotIn("Unpublished private path", str(caught.exception))
        self.assertIn("未清理", str(caught.exception))

    def test_runtime_lease_stopped_confirmation_and_unknown_mutation_flags_refused(self):
        self.committed()
        with self.assertRaises(CommandError):
            self.command()
        with StorageLease() as lease, self.assertRaises(APIError):
            audit_media(lease)
        environment = dict(os.environ, DJANGO_SETTINGS_MODULE="service.settings", PYTHONIOENCODING="utf-8",
                           CREATIVE_BOARD_HOSTED_DATA_DIR=self.directory.name, CREATIVE_BOARD_HOSTED_SECRET="Synthetic-audit-secret-" + "0" * 64,
                           CREATIVE_BOARD_HOSTED_HOSTS="localhost", CREATIVE_BOARD_HOSTED_ORIGINS="")
        # Windows byte locks are per process. A second handle in this same test
        # process doesn't represent an independently running server/maintenance.
        with StorageLease():
            child = subprocess.run([sys.executable, "-X", "utf8", "manage.py", "audit_media", "--service-stopped"],
                                   cwd=settings.BASE_DIR, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertNotEqual(child.returncode, 0)
        self.assertIn("占用", child.stderr)
        for argument in ("--delete", "--apply", "--confirm-discard-interrupted-uploads"):
            from .management.commands.audit_media import Command
            with self.assertRaises(CommandError):
                Command().create_parser("manage.py", "audit_media").parse_args(["--service-stopped", argument])
        result = self.command(service_stopped=True)
        self.assertFalse(result["deletionSafe"])
