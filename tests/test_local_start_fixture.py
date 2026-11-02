"""Exercise cleanup with deliberate inner failures; the outer checks must pass."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import tempfile
import unittest

import test_local_start as startup


def remove_owned_fixture(root):
    target = root.resolve()
    target.relative_to(Path(tempfile.gettempdir()).resolve())
    if not target.name.startswith("creative-local-start-"):
        raise AssertionError("Unexpected synthetic fixture root")
    shutil.rmtree(target)


class LocalStartFixtureTests(unittest.TestCase):
    def test_current_failures_and_errors_retain_the_given_marker(self):
        for kind in ["assertion", "exception", "subtest"]:
            with self.subTest(kind=kind):
                class Given(startup.LocalStartTests):
                    def runTest(self):
                        if kind == "assertion":
                            self.fail("Given assertion")
                        if kind == "exception":
                            raise RuntimeError("Given exception")
                        with self.subTest(part="given"):
                            self.fail("Given subtest failure")

                case = Given()
                result = unittest.TestResult()
                output = io.StringIO()
                with contextlib.redirect_stderr(output):
                    case.run(result)
                self.assertEqual(len(result.failures) + len(result.errors), 1)
                self.assertEqual(case.marker.read_bytes(), b'{"given":"keep"}')
                self.assertIn("GIVEN_FIXTURE_RETAINED: " + str(case.root), output.getvalue())
                remove_owned_fixture(case.root)

    def test_success_still_removes_its_own_fixture(self):
        class Given(startup.LocalStartTests):
            def runTest(self):
                self.assertEqual(self.marker.read_bytes(), b'{"given":"keep"}')

        case = Given()
        result = unittest.TestResult()
        case.run(result)
        self.assertTrue(result.wasSuccessful(), result.errors)
        self.assertFalse(case.root.exists())

    def test_missing_record_keeps_startup_phase_evidence(self):
        class Given(startup.LocalStartTests):
            def runTest(self):
                self.launch(open_browser=True)
                self.wait_json(self.open_log)
                self.wait_json(self.root / "given-missing.json", timeout=0)

        case = Given()
        result = unittest.TestResult()
        with contextlib.redirect_stderr(io.StringIO()):
            case.run(result)
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.errors, [])
        failure = result.failures[0][1]
        self.assertIn("Controlled startup record missing:", failure)
        self.assertIn("identity.json:", failure)
        self.assertIn("startup-progress.jsonl:", failure)
        events = [json.loads(line) for line in (case.root / "startup-progress.jsonl").read_text(encoding="utf8").splitlines()]
        phases = [event["phase"] for event in events]
        for phase in ["hook-loaded", "server-bound", "serve-entered", "browser-provider-loaded",
                      "browser-open-entered", "health-request-started", "health-request-finished",
                      "index-request-started", "index-request-finished"]:
            self.assertIn(phase, phases)
        row = json.loads(case.open_log.read_bytes())
        self.assertTrue(row["returned"])
        self.assertEqual(row["pid"], json.loads(case.identity.read_bytes())["pid"])
        self.assertEqual(case.marker.read_bytes(), b'{"given":"keep"}')
        remove_owned_fixture(case.root)

    @unittest.skipUnless(os.name == "nt", "Windows command process tree")
    def test_failed_command_fixture_stops_its_owned_server_before_retaining_files(self):
        class Given(startup.LocalStartTests):
            def runTest(self):
                self.launch_windows_entry()
                row = self.wait_json(self.open_log)
                self.assertTrue(row["returned"])
                self.fail("Given failure after the command child became ready")

        case = Given()
        result = unittest.TestResult()
        with contextlib.redirect_stderr(io.StringIO()):
            case.run(result)
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.errors, [])
        self.assertIn("Given failure after the command child became ready", result.failures[0][1])
        self.assertTrue(all(process.poll() is not None for process in case.processes))
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", case.port)), 0)
        # A surviving child with this cwd caused the original WinError32.
        (case.root / "Given app with spaces").rename(case.root / "Stopped owned app")
        self.assertEqual(case.marker.read_bytes(), b'{"given":"keep"}')
        remove_owned_fixture(case.root)


if __name__ == "__main__":
    unittest.main()
