import hashlib
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
from queue import Queue
from pathlib import Path
from threading import Thread
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError
from django.db.models.query import QuerySet
from django.test import TestCase, override_settings

from . import test_documents as fixtures
from .maintenance import StorageLease
from .media import checked_storage, reserve_upload, upload_stream
from .models import MediaAsset, MediaStorageBudget, UploadReservation
from .scope import WorkspaceScope
from .services import APIError
from .upload_recovery import discard_interrupted_uploads, review_uploads


class InterruptedUploadTests(TestCase):
    def setUp(self):
        fixtures.DocumentAPITests.setUp(self)
        self.directory = tempfile.TemporaryDirectory(prefix="creative-offline-tests-")
        self.addCleanup(self.directory.cleanup)
        self.override = override_settings(HOSTED_DATA_ROOT=Path(self.directory.name))
        self.override.enable()
        self.addCleanup(self.override.disable)
        MediaStorageBudget.objects.get_or_create(pk=1)
        self.scope = WorkspaceScope(self.shared, "owner")
        self.raw = b"\x89PNG\r\n\x1a\n" + bytes(range(64))

    def pending(self, *areas, data=b"original unfinished upload"):
        row = reserve_upload(self.scope, self.owner, 100, "my-upload.png", "")
        for area in areas:
            checked_storage(self.scope, area, row.pk, create=True).write_bytes(data)
        return row

    def committed(self):
        return upload_stream(self.scope, self.owner, io.BytesIO(self.raw), len(self.raw), "own.png", "")

    def command(self, **options):
        output = io.StringIO()
        call_command("reconcile_uploads", stdout=output, **options)
        return json.loads(output.getvalue())

    def test_preview_identifies_each_crash_stage_and_does_not_discard_bytes_or_reservations(self):
        partial = self.pending("incoming")
        promoted = self.pending("media")
        missing = self.pending()
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
        self.assertEqual(plan["reservationCount"], 3)
        self.assertEqual(plan["releasedReservationBytes"], 300)
        self.assertEqual(plan["discardedFileBytes"], 2 * len(b"original unfinished upload"))
        self.assertEqual(UploadReservation.objects.count(), 3)
        snapshots = {row["id"]: row for row in plan["uploads"]}
        self.assertEqual(snapshots[str(partial.pk)]["files"]["incoming"]["sha256"], hashlib.sha256(b"original unfinished upload").hexdigest())
        self.assertIsNone(snapshots[str(promoted.pk)]["files"]["incoming"])
        self.assertEqual(snapshots[str(missing.pk)]["files"], {"incoming": None, "media": None})
        self.assertTrue(checked_storage(self.scope, "incoming", partial.pk).exists())
        self.assertTrue(checked_storage(self.scope, "media", promoted.pk).exists())

    def test_confirmed_plan_releases_only_reviewed_reservations_and_leaves_registered_and_unreserved_files(self):
        asset = self.committed()
        row = self.pending("incoming", "media")
        original = Path(self.directory.name) / "author-original.png"
        original.write_bytes(self.raw)
        orphan = self.scope.storage_root() / "media" / "unreserved.blob"
        orphan.write_bytes(b"separate future audit")
        plan = self.command(service_stopped=True)
        result = self.command(service_stopped=True, plan_token=plan["planToken"], confirm_discard_interrupted_uploads=True)
        self.assertEqual(result["discardedReservations"], 1)
        self.assertFalse(UploadReservation.objects.exists())
        self.assertFalse(checked_storage(self.scope, "media", row.pk).exists())
        self.assertFalse(checked_storage(self.scope, "incoming", row.pk).exists())
        self.assertEqual(checked_storage(self.scope, "media", asset.pk).read_bytes(), self.raw)
        self.assertEqual(original.read_bytes(), self.raw)
        self.assertEqual(orphan.read_bytes(), b"separate future audit")
        self.assertEqual(MediaAsset.objects.count(), 1)
        with self.assertRaises(CommandError):
            self.command(service_stopped=True, plan_token=plan["planToken"], confirm_discard_interrupted_uploads=True)

    def test_ambiguous_committed_asset_keeps_exact_registered_file_and_metadata(self):
        asset = self.committed()
        UploadReservation.objects.create(id=asset.pk, workspace=self.shared, account=self.owner, size=asset.size, filename=asset.filename)
        incoming = checked_storage(self.scope, "incoming", asset.pk, create=True)
        incoming.write_bytes(b"extra partial")
        metadata = MediaAsset.objects.values().get(pk=asset.pk)
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
            self.assertEqual(plan["registeredFilesPreserved"], 1)
            self.assertEqual(plan["discardedFileBytes"], len(b"extra partial"))
            result = discard_interrupted_uploads(lease, plan["planToken"])
        self.assertEqual(result["registeredFilesPreserved"], 1)
        self.assertEqual(MediaAsset.objects.values().get(pk=asset.pk), metadata)
        self.assertEqual(checked_storage(self.scope, "media", asset.pk).read_bytes(), self.raw)
        self.assertFalse(incoming.exists())
        self.assertFalse(UploadReservation.objects.exists())

    def test_corrupt_or_cross_workspace_registered_asset_blocks_the_entire_review(self):
        asset = self.committed()
        UploadReservation.objects.create(id=asset.pk, workspace=self.shared, account=self.owner, size=asset.size, filename=asset.filename)
        path = checked_storage(self.scope, "media", asset.pk)
        path.write_bytes(b"X" * asset.size)
        with StorageLease(offline=True) as lease:
            with self.assertRaises(APIError):
                review_uploads(lease)
        path.write_bytes(self.raw)
        UploadReservation.objects.filter(pk=asset.pk).update(workspace=self.personal)
        with StorageLease(offline=True) as lease:
            with self.assertRaises(APIError):
                review_uploads(lease)
        self.assertEqual(path.read_bytes(), self.raw)
        self.assertTrue(UploadReservation.objects.exists())

    def test_changed_file_invalidates_plan_even_when_size_is_unchanged(self):
        row = self.pending("incoming", data=b"aaa")
        path = checked_storage(self.scope, "incoming", row.pk)
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
            path.write_bytes(b"bbb")
            with self.assertRaises(APIError) as caught:
                discard_interrupted_uploads(lease, plan["planToken"])
            self.assertEqual(caught.exception.status, 409)
        self.assertEqual(path.read_bytes(), b"bbb")
        self.assertTrue(UploadReservation.objects.filter(pk=row.pk).exists())

    def test_new_or_changed_reservation_invalidates_old_plan_before_first_deletion(self):
        row = self.pending("incoming")
        path = checked_storage(self.scope, "incoming", row.pk)
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
            UploadReservation.objects.filter(pk=row.pk).update(filename="a-new-author-name.png")
            with self.assertRaises(APIError):
                discard_interrupted_uploads(lease, plan["planToken"])
            plan = review_uploads(lease)
            self.pending()
            with self.assertRaises(APIError):
                discard_interrupted_uploads(lease, plan["planToken"])
        self.assertTrue(path.exists())
        self.assertEqual(UploadReservation.objects.count(), 2)

    def test_token_from_another_store_cannot_discard_this_store(self):
        row = self.pending("incoming")
        original = checked_storage(self.scope, "incoming", row.pk)
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
        with tempfile.TemporaryDirectory(prefix="creative-other-store-") as other:
            with override_settings(HOSTED_DATA_ROOT=Path(other)):
                local = checked_storage(self.scope, "incoming", row.pk, create=True)
                local.write_bytes(original.read_bytes())
                with StorageLease(offline=True) as lease:
                    with self.assertRaises(APIError):
                        discard_interrupted_uploads(lease, plan["planToken"])
                self.assertTrue(local.exists())
        self.assertTrue(original.exists())
        self.assertTrue(UploadReservation.objects.exists())

    def test_filesystem_failure_keeps_reservations_accounted_and_fresh_review_can_retry(self):
        row = self.pending("incoming", "media")
        incoming = checked_storage(self.scope, "incoming", row.pk)
        promoted = checked_storage(self.scope, "media", row.pk)
        original_unlink = Path.unlink
        def fail_promoted(path, *args, **kwargs):
            if path == promoted:
                raise PermissionError("fixture: file unavailable")
            return original_unlink(path, *args, **kwargs)
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
            with patch.object(Path, "unlink", fail_promoted), self.assertRaises(OSError):
                discard_interrupted_uploads(lease, plan["planToken"])
            self.assertFalse(incoming.exists())
            self.assertTrue(promoted.exists())
            self.assertTrue(UploadReservation.objects.exists())
            retry = review_uploads(lease)
            self.assertNotEqual(retry["planToken"], plan["planToken"])
            result = discard_interrupted_uploads(lease, retry["planToken"])
        self.assertEqual(result["discardedReservations"], 1)
        self.assertFalse(UploadReservation.objects.exists())

    def test_database_failure_after_file_removal_keeps_capacity_reserved_until_new_review(self):
        row = self.pending("incoming")
        path = checked_storage(self.scope, "incoming", row.pk)
        original_delete = QuerySet.delete
        def fail_reservation_delete(query):
            if query.model is UploadReservation:
                raise OperationalError("fixture database commit uncertain")
            return original_delete(query)
        with StorageLease(offline=True) as lease:
            plan = review_uploads(lease)
            with patch.object(QuerySet, "delete", fail_reservation_delete), self.assertRaises(OperationalError):
                discard_interrupted_uploads(lease, plan["planToken"])
            self.assertFalse(path.exists())
            self.assertEqual(UploadReservation.objects.get().size, 100)
            retry = review_uploads(lease)
            self.assertEqual(retry["discardedFileBytes"], 0)
            discard_interrupted_uploads(lease, retry["planToken"])
        self.assertFalse(UploadReservation.objects.exists())

    def test_redirect_or_linked_file_is_never_read_or_discarded(self):
        row = self.pending("incoming")
        path = checked_storage(self.scope, "incoming", row.pk)
        foreign = Path(self.directory.name) / "foreign.bin"
        foreign.write_bytes(b"foreign content")
        original_resolve = Path.resolve
        def redirect(current, *args, **kwargs):
            return foreign if current == path else original_resolve(current, *args, **kwargs)
        with StorageLease(offline=True) as lease:
            with patch.object(Path, "resolve", redirect), self.assertRaises(APIError):
                review_uploads(lease)
        self.assertEqual(foreign.read_bytes(), b"foreign content")
        hardlink = Path(self.directory.name) / "linked-copy.bin"
        os.link(path, hardlink)
        with StorageLease(offline=True) as lease:
            with self.assertRaises(APIError):
                review_uploads(lease)
        self.assertEqual(hardlink.read_bytes(), b"original unfinished upload")
        self.assertTrue(path.exists())
        self.assertTrue(UploadReservation.objects.exists())

    def test_command_requires_stopped_service_and_both_review_and_explicit_confirmation(self):
        row = self.pending("incoming")
        for options in ({}, {"service_stopped": True, "plan_token": "0" * 64},
                        {"service_stopped": True, "confirm_discard_interrupted_uploads": True}):
            with self.assertRaises(CommandError):
                self.command(**options)
        with StorageLease(offline=True):
            with self.assertRaises(CommandError):
                self.command(service_stopped=True)
        self.assertTrue(checked_storage(self.scope, "incoming", row.pk).exists())

    def test_file_larger_than_reserved_budget_is_preserved_without_unbounded_hash_read(self):
        row = self.pending("incoming", data=b"X" * 101)
        with StorageLease(offline=True) as lease:
            with patch("core.upload_recovery.hashlib.sha256", side_effect=AssertionError("oversized file must not be hashed")):
                with self.assertRaises(APIError):
                    review_uploads(lease)
        self.assertEqual(checked_storage(self.scope, "incoming", row.pk).stat().st_size, 101)
        self.assertTrue(UploadReservation.objects.filter(pk=row.pk).exists())

    def test_changed_lock_identity_and_runtime_lease_cannot_be_used_for_offline_cleanup(self):
        with StorageLease() as runtime:
            with self.assertRaises(APIError):
                review_uploads(runtime)
        with StorageLease(offline=True) as lease:
            original_stat = Path.stat
            foreign = Path(self.directory.name) / "foreign-lock"
            foreign.touch()
            def switched(path, *args, **kwargs):
                return original_stat(foreign, *args, **kwargs) if path == lease.target else original_stat(path, *args, **kwargs)
            with patch.object(Path, "stat", switched), self.assertRaises(APIError):
                review_uploads(lease)

    def test_real_wsgi_worker_cannot_start_while_store_is_under_offline_lease(self):
        environment = dict(os.environ, DJANGO_SETTINGS_MODULE="service.settings", PYTHONIOENCODING="utf-8",
                           CREATIVE_BOARD_HOSTED_DATA_DIR=self.directory.name, CREATIVE_BOARD_HOSTED_SECRET="fixture-secret-" + "x" * 64,
                           CREATIVE_BOARD_HOSTED_HOSTS="localhost", CREATIVE_BOARD_HOSTED_ORIGINS="")
        with StorageLease(offline=True):
            result = subprocess.run([sys.executable, "-c", "import service.wsgi"], cwd=settings.BASE_DIR,
                                    env=environment, capture_output=True, text=True, encoding="utf-8", timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ImproperlyConfigured", result.stderr)
        result = subprocess.run([sys.executable, "-c", "import service.wsgi; print('guarded worker ready')"], cwd=settings.BASE_DIR,
                                env=environment, capture_output=True, text=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("guarded worker ready", result.stdout)

    def test_running_real_worker_blocks_cleanup_and_process_crash_releases_kernel_lock(self):
        environment = dict(os.environ, DJANGO_SETTINGS_MODULE="service.settings", PYTHONIOENCODING="utf-8",
                           CREATIVE_BOARD_HOSTED_DATA_DIR=self.directory.name, CREATIVE_BOARD_HOSTED_SECRET="fixture-secret-" + "x" * 64,
                           CREATIVE_BOARD_HOSTED_HOSTS="localhost", CREATIVE_BOARD_HOSTED_ORIGINS="")
        child = subprocess.Popen([sys.executable, "-u", "-c", "import service.wsgi; import os, sys; print('ready ' + str(os.getpid()), flush=True); sys.stdin.read(1)"],
                                 cwd=settings.BASE_DIR, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, encoding="utf-8")
        lines = Queue()
        reader = Thread(target=lambda: lines.put(child.stdout.readline()), daemon=True)
        reader.start()
        try:
            ready = lines.get(timeout=15).strip().split()
            self.assertEqual(ready[0], "ready")
            worker_pid = int(ready[1])
            with self.assertRaises(APIError):
                StorageLease(offline=True)
            with self.assertRaises(CommandError):
                self.command(service_stopped=True)
            # On Windows a venv executable can be a launcher. Killing only
            # that launcher leaves the actual interpreter holding the lease.
            os.kill(worker_pid, signal.SIGTERM if os.name == "nt" else signal.SIGKILL)
            child.wait(timeout=15)
            with StorageLease(offline=True) as lease:
                plan = review_uploads(lease)
            self.assertEqual(plan["reservationCount"], 0)
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=15)
