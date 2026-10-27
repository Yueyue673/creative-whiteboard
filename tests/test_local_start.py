import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import build_opener, ProxyHandler

sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_start_fixture import write_hooks, fixture_env

PROJECT = Path(__file__).resolve().parents[1]
REQUEST = build_opener(ProxyHandler({})).open

class LocalStartTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="creative-local-start-"))
        self.data = self.root / "given-data"
        self.data.mkdir()
        self.marker = self.data / "given-marker.json"
        self.marker.write_bytes(b'{"given":"keep"}')
        self.hooks = write_hooks(self.root / "hooks")
        self.open_log = self.root / "open.json"
        self.identity = self.root / "identity.json"
        self.log = (self.root / "process.log").open("wb")
        self.processes = []
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}/"

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=16)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            if process.stdin:
                process.stdin.close()
        self.log.close()
        result = self._outcome.result
        failed = any(test.id().startswith(self.id()) for test, _ in result.failures + result.errors)
        if failed:
            print("GIVEN_FIXTURE_RETAINED: " + str(self.root), file=sys.stderr)
        else:
            target = self.root.resolve()
            target.relative_to(Path(tempfile.gettempdir()).resolve())
            self.assertTrue(target.name.startswith("creative-local-start-"))
            shutil.rmtree(target)

    def launch(self, *, open_browser=False, mode="true", deny_data=False):
        args = [sys.executable, str(PROJECT / "server.py")]
        if open_browser:
            args.append("--open-browser")
        process = subprocess.Popen(args, cwd=PROJECT,
            env=fixture_env(self.data, self.port, self.hooks, self.open_log, self.identity, mode=mode, deny_data=deny_data),
            stdout=self.log, stderr=self.log,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.processes.append(process)
        return process

    def wait_json(self, path, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists():
                return json.loads(path.read_bytes())
            time.sleep(0.04)
        self.fail("Controlled startup record missing: " + str(path) + "\n" +
                  (self.root / "process.log").read_text(encoding="utf8", errors="replace"))

    def wait_ready(self, process):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                self.fail("Server exited before readiness")
            try:
                with REQUEST(self.url + "api/health", timeout=0.25) as response:
                    if response.status == 200:
                        return
            except OSError:
                pass
            time.sleep(0.04)
        self.fail("Owned local server did not become ready")

    def test_default_cli_remains_manual_and_keeps_existing_data(self):
        process = self.launch()
        self.wait_ready(process)
        self.assertFalse(self.open_log.exists())
        self.assertEqual(self.marker.read_bytes(), b'{"given":"keep"}')
        with REQUEST(self.url + "index.html", timeout=2) as response:
            self.assertEqual(response.read(), (PROJECT / "index.html").read_bytes())

    def test_open_request_uses_bound_ready_original_server(self):
        process = self.launch(open_browser=True)
        row = self.wait_json(self.open_log)
        identity = self.wait_json(self.identity)
        self.assertTrue(row["controlledBrowserProvider"])
        self.assertTrue(row["returned"])
        self.assertEqual(row["url"], self.url)
        self.assertEqual(row["pid"], process.pid)
        self.assertEqual(row["pid"], identity["pid"])
        self.assertEqual(identity["boundPort"], self.port)
        self.assertEqual(row["healthStatus"], 200)
        self.assertEqual(row["indexSHA256"], hashlib.sha256((PROJECT / "index.html").read_bytes()).hexdigest())

    def test_occupied_address_never_opens_other_service_or_changes_given_files(self):
        before = {p.name: p.read_bytes() for p in self.data.iterdir() if p.is_file()}
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", self.port))
            occupied.listen()
            process = self.launch(open_browser=True)
            self.assertNotEqual(process.wait(timeout=8), 0)
            self.assertFalse(self.open_log.exists())
            self.assertFalse(self.identity.exists())
            occupied.settimeout(0.1)
            with self.assertRaises(socket.timeout):
                occupied.accept()
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.data.iterdir() if p.is_file()})
        output = (self.root / "process.log").read_text(encoding="utf8")
        self.assertIn(self.url, output)
        self.assertIn("请查看原来的启动窗口", output)

    def test_unavailable_browser_keeps_manual_service_usable(self):
        for mode in ["false", "raise"]:
            with self.subTest(mode=mode):
                if self.open_log.exists():
                    self.open_log.unlink()
                process = self.launch(open_browser=True, mode=mode)
                row = self.wait_json(self.open_log)
                self.assertFalse(row["returned"])
                self.wait_ready(process)
                self.assertIsNone(process.poll())
                self.assertEqual(self.marker.read_bytes(), b'{"given":"keep"}')
                process.terminate()
                process.wait(timeout=5)
        self.assertIn(self.url, (self.root / "process.log").read_text(encoding="utf8"))

    def test_data_access_failure_is_not_reported_as_address_occupation(self):
        process = self.launch(open_browser=True, deny_data=True)
        self.assertNotEqual(process.wait(timeout=8), 0)
        self.assertFalse(self.open_log.exists())
        output = (self.root / "process.log").read_text(encoding="utf8")
        self.assertIn("未能启动白板", output)
        self.assertIn("Given data directory unavailable", output)
        self.assertNotIn("本机地址", output)
        self.assertEqual(self.marker.read_bytes(), b'{"given":"keep"}')
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", self.port)), 0)

    @unittest.skipUnless(os.name == "nt", "Windows command entry")
    def test_windows_entry_works_from_a_given_folder_with_spaces(self):
        program = self.root / "Given app with spaces"
        program.mkdir()
        for name in ["server.py", "app_paths.py", "assets.py", "workflow_backend.py",
                     "ai_context.py", "library_folders.py", "index.html", "启动白板.cmd"]:
            shutil.copyfile(PROJECT / name, program / name)
        env = fixture_env(self.data, self.port, self.hooks, self.open_log, self.identity, lifetime=12)
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
        cmd_exe = os.environ.get("ComSpec", r"C:\Windows\System32\cmd.exe")
        script = (program / "启动白板.cmd").resolve()
        script.relative_to(self.root.resolve())
        command = subprocess.list2cmdline([cmd_exe]) + ' /d /s /c ""' + str(script) + '""'
        process = subprocess.Popen(command, executable=cmd_exe,
            cwd=self.root, env=env, stdin=subprocess.PIPE, stdout=self.log, stderr=self.log,
            creationflags=subprocess.CREATE_NO_WINDOW)
        self.processes.append(process)
        row = self.wait_json(self.open_log)
        self.assertTrue(row["returned"])
        self.assertEqual(row["url"], self.url)
        self.assertEqual(row["healthStatus"], 200)
        self.assertEqual(row["pid"], self.wait_json(self.identity)["pid"])
        process.communicate(input=b"\n", timeout=20)
        self.assertEqual(process.returncode, 0)
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", self.port)), 0)
        self.assertEqual(self.marker.read_bytes(), b'{"given":"keep"}')

if __name__ == "__main__":
    unittest.main()
