"""Real Linux primitives, not a mock of the Windows branch."""
import io
import os
import select
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings

from core.backups import file_details, sync_directory, transfer_file
from core.maintenance import StorageLease
from core.media_audit import audit_media
from core.services import APIError
from core.test_upload_recovery import InterruptedUploadTests
from service.configuration import secret_key


@skipUnless(sys.platform == "linux", "Real Linux acceptance requires a Linux kernel")
class LinuxLeaseTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hosted-linux-lease-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.override = override_settings(HOSTED_DATA_ROOT=self.root)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.workers = []
        self.addCleanup(self.stop_workers)
        self.environment = {**os.environ, "DJANGO_SETTINGS_MODULE": "service.settings", "PYTHONIOENCODING": "utf-8",
                            "CREATIVE_BOARD_HOSTED_DATA_DIR": str(self.root), "CREATIVE_BOARD_HOSTED_SECRET": "linux-fixture-only-" + "x" * 64,
                            "CREATIVE_BOARD_HOSTED_HOSTS": "localhost", "CREATIVE_BOARD_HOSTED_ORIGINS": ""}
        self.environment.pop("CREATIVE_BOARD_HOSTED_SECRET_FILE", None)

    def worker(self):
        process = subprocess.Popen([sys.executable, "-u", "-c", "import service.wsgi,sys; print('ready',flush=True); sys.stdin.read(1)"],
                                   cwd=settings.BASE_DIR, env=self.environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.workers.append(process)
        self.assertTrue(select.select([process.stdout], [], [], 15)[0], "Guarded worker did not start")
        self.assertEqual(process.stdout.readline().strip(), b"ready", process.stderr.read() if process.poll() is not None else b"")
        return process

    def stop_workers(self):
        for worker in self.workers:
            if worker.poll() is None:
                worker.kill()
            worker.communicate(timeout=15)

    def test_two_real_wsgi_workers_share_lease_and_last_crash_releases_maintenance(self):
        first, second = self.worker(), self.worker()
        with self.assertRaises(APIError):
            StorageLease(offline=True)
        first.send_signal(signal.SIGKILL)
        first.wait(timeout=15)
        with self.assertRaises(APIError):
            StorageLease(offline=True)
        second.send_signal(signal.SIGKILL)
        second.wait(timeout=15)
        with StorageLease(offline=True) as lease:
            lease.verify()

    def test_offline_exclusive_lease_refuses_new_real_wsgi_workers(self):
        with StorageLease(offline=True):
            result = subprocess.run([sys.executable, "-c", "import service.wsgi"], cwd=settings.BASE_DIR, env=self.environment, capture_output=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)

    def test_native_symlink_hardlink_and_fifo_cannot_replace_regular_backup_or_secret_files(self):
        source = self.root / "original"
        source.write_bytes(b"Synthetic original bytes")
        linked = self.root / "linked"
        linked.symlink_to(source)
        with self.assertRaises(APIError):
            transfer_file(linked)
        linked.unlink()
        os.link(source, linked)
        with self.assertRaises(APIError):
            file_details(source)
        linked.unlink()
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        with self.assertRaises(APIError):
            transfer_file(fifo)
        key = self.root / "key"
        key.write_text("fixture-only-" + "k" * 64)
        linked.symlink_to(key)
        from django.core.exceptions import ImproperlyConfigured
        with self.assertRaises(ImproperlyConfigured):
            secret_key({"CREATIVE_BOARD_HOSTED_SECRET_FILE": str(linked)})
        self.assertEqual(source.read_bytes(), b"Synthetic original bytes")

    def test_directory_entries_are_actually_fsynced_and_lock_replacement_stops_old_owner(self):
        sync_directory(self.root)
        with StorageLease() as lease:
            old = self.root / "retained-lock"
            lease.target.rename(old)
            lease.target.touch()
            with self.assertRaises(APIError):
                lease.verify()
        self.assertTrue(old.is_file())


@skipUnless(sys.platform == "linux", "Native Linux inventory acceptance")
class LinuxInventoryTests(TestCase):
    setUp = InterruptedUploadTests.setUp
    committed = InterruptedUploadTests.committed

    def test_native_directory_symlink_is_reported_without_traversing_or_reading_target(self):
        self.committed()
        root = Path(self.directory.name)
        external = root / "Synthetic-external"
        external.mkdir()
        original = external / "Synthetic-private.txt"
        original.write_bytes(b"Synthetic external original")
        link = self.scope.storage_root() / "incoming"
        link.rmdir()
        link.symlink_to(external, target_is_directory=True)
        scanned = []
        scan = os.scandir
        def record(path):
            scanned.append(Path(path))
            return scan(path)
        with StorageLease(offline=True) as lease, patch("core.media_audit.os.scandir", record), patch("core.media_audit.os.open", side_effect=AssertionError("No content reads")):
            result = audit_media(lease)
        self.assertEqual(result["counts"]["unsafeEntries"], 1)
        self.assertNotIn(link, scanned)
        self.assertNotIn(external, scanned)
        self.assertEqual(original.read_bytes(), b"Synthetic external original")
        link.unlink()
