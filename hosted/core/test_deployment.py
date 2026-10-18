import os
import subprocess
import sys
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.test import SimpleTestCase, override_settings

from core.maintenance import StorageLease


class DeploymentCommandsTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hosted-deploy-fixture-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.store = self.root / "store"
        self.key = self.root / "operator-fixture.key"
        self.key.write_text("fixture-only-key-" + "k" * 64, encoding="utf-8")
        self.environment = {**os.environ, "CREATIVE_BOARD_HOSTED_DATA_DIR": str(self.store),
                            "PYTHONIOENCODING": "utf-8",
                            "CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.key), "CREATIVE_BOARD_HOSTED_HOSTS": "localhost",
                            "CREATIVE_BOARD_HOSTED_ORIGINS": "https://localhost", "CREATIVE_BOARD_HOSTED_TRUST_PROXY": "1"}
        self.environment.pop("CREATIVE_BOARD_HOSTED_SECRET", None)

    def run_entry(self, *args):
        return subprocess.run([sys.executable, "deployment/entry.py", *args], cwd=settings.BASE_DIR,
                              env=self.environment, capture_output=True, text=True, encoding="utf-8", timeout=45)

    def test_serve_refuses_uninitialized_store_without_creating_database_or_accounts(self):
        result = self.run_entry("serve")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("initialized", result.stderr)
        self.assertFalse((self.store / "accounts.sqlite3").exists())

    def test_explicit_migrate_then_ready_guard_preserves_complete_schema(self):
        result = self.run_entry("migrate")
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([sys.executable, "-c", "from deployment.entry import ready_store; ready_store(); print('ready')"],
                                cwd=settings.BASE_DIR, env=self.environment, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ready")

    def test_running_worker_lease_blocks_explicit_migration_without_database_creation(self):
        self.store.mkdir()
        with override_settings(HOSTED_DATA_ROOT=self.store), StorageLease():
            result = self.run_entry("migrate")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.store / "accounts.sqlite3").exists())

    def test_restore_incomplete_marker_blocks_serving_original_store(self):
        self.assertEqual(self.run_entry("migrate").returncode, 0)
        (self.store / ".hosted-restore-incomplete").write_bytes(b"fixture marker")
        result = self.run_entry("serve")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.store / ".hosted-restore-incomplete").exists())

    def test_missing_secret_or_unsupported_actions_never_echo_key(self):
        self.environment["CREATIVE_BOARD_HOSTED_SECRET_FILE"] = str(self.root / "missing.key")
        for action in ("check", "serve", "migrate"):
            result = self.run_entry(action)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(str(self.key), result.stderr)
            self.assertNotIn("k" * 64, result.stderr)
        result = self.run_entry("delete-store")
        self.assertNotEqual(result.returncode, 0)
