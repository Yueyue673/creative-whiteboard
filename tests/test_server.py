import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]

class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        env = dict(os.environ, CREATIVE_BOARD_PORT=str(cls.port),
                   CREATIVE_BOARD_DATA_DIR=cls.tmp.name, PYTHONIOENCODING="utf-8")
        cls.process = subprocess.Popen([sys.executable, str(ROOT / "server.py")],
                                      env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.process.poll() is not None:
                raise RuntimeError(cls.process.stderr.read().decode("utf-8", "replace"))
            try:
                with urllib.request.urlopen(cls.base + "/api/health", timeout=.5):
                    return
            except OSError:
                time.sleep(.05)
        raise RuntimeError("Server did not become ready")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.process.stderr.close()
        cls.tmp.cleanup()

    def request(self, path, method="GET", value=None, headers=None):
        data = json.dumps(value).encode() if value is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers=headers or {})
        try:
            response = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, response.headers, raw

    def test_blank_workspace_and_static_files(self):
        status, _, raw = self.request("/api/folders")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"folders": []})
        self.assertEqual(self.request("/api/checkpoints/library/catalog", "PUT")[0], 200)
        history = json.loads(self.request("/api/history/library/catalog")[2])
        self.assertEqual(history[0]["count"], 0)
        for path in ["/", "/index.html", "/workspace.js", "/workflow.js", "/workspace.css", "/shell.js", "/shell.css", "/pane.js", "/cells.js", "/experience.js", "/clipboard-coordinator.js"]:
            self.assertEqual(self.request(path)[0], 200)
        self.assertEqual(self.request("/app_paths.py")[0], 404)

    def test_conflict_and_trash_restore(self):
        board = {"format": "creative-board", "version": 1, "name": "test", "folder": "", "nodes": [], "edges": []}
        status, headers, _ = self.request("/api/boards/test", "PUT", board, {"If-Match": "new"})
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/boards/test", "PUT", board, {"If-Match": "new"})[0], 409)
        status, _, raw = self.request("/api/boards/test", "DELETE", headers={"If-Match": headers["ETag"]})
        self.assertEqual(status, 200)
        ticket = json.loads(raw)["ticket"]
        self.assertEqual(self.request("/api/boards/test")[0], 404)
        trash = json.loads(self.request("/api/trash")[2])
        self.assertEqual(next(t for t in trash if t["id"] == ticket)["ids"], ["test"])
        status, _, raw = self.request("/api/trash/" + ticket, "PUT")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["ids"], ["test"])
        self.assertEqual(json.loads(raw)["boards"], [{"id": "test", "name": "test", "folder": "", "count": 0}])
        self.assertEqual(json.loads(self.request("/api/boards/test")[2]), board)

    def test_origin_and_host_checks(self):
        self.assertEqual(self.request("/api/folders", "PUT", {"folders": []},
                         {"Origin": "https://example.com", "If-Match": "new"})[0], 403)
        self.assertEqual(self.request("/api/health", headers={"Host": "example.com"})[0], 403)

    def test_json_upload_and_media(self):
        req = urllib.request.Request(self.base + "/api/assets/upload", data=b'{"name":"sample"}',
              method="POST", headers={"Content-Type": "application/octet-stream", "X-File-Name": "sample.json"})
        with urllib.request.urlopen(req) as response:
            item = json.load(response)
        self.assertTrue(Path(item["path"]).resolve().is_relative_to(Path(self.tmp.name).resolve()))
        status, _, raw = self.request("/api/media/" + item["id"])
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"name": "sample"})
        self.assertEqual(self.request("/api/media/" + item["id"], headers={"Range": "bytes=0-3"})[0], 206)

    def test_public_example_is_valid(self):
        example = json.loads((ROOT / "examples/getting-started.json").read_text(encoding="utf-8"))
        self.assertEqual(self.request("/api/boards/example", "PUT", example, {"If-Match": "new"})[0], 200)
        self.assertEqual(self.request("/api/checkpoints/example", "PUT")[0], 200)
        self.assertTrue(json.loads(self.request("/api/history/boards/example")[2]))

    def test_table_axis_identity_validation_preserves_saved_content(self):
        board = {"format": "creative-board", "version": 1, "name": "table", "nodes": [{
            "id": "table", "type": "table", "title": "原文", "body": "", "x": 0, "y": 0, "w": 600, "h": 300,
            "columns": ["画面", "声音"], "rows": [["作者的记录", ""]],
            "rowIds": ["row-a"], "columnIds": ["col-a", "col-b"]}], "edges": []}
        status, headers, _ = self.request("/api/boards/table-axes", "PUT", board, {"If-Match": "new"})
        self.assertEqual(status, 200)
        raw = (Path(self.tmp.name) / "内容" / "table-axes.json").read_bytes()
        for key, bad in [("rowIds", []), ("columnIds", ["same", "same"]), ("rowIds", [None]),
                         ("columnIds", ["", "other"]), ("rowIds", ["x" * 101])]:
            invalid = json.loads(json.dumps(board))
            invalid["nodes"][0][key] = bad
            self.assertEqual(self.request("/api/boards/table-axes", "PUT", invalid, {"If-Match": headers["ETag"]})[0], 400)
            self.assertEqual((Path(self.tmp.name) / "内容" / "table-axes.json").read_bytes(), raw)
        self.assertEqual(json.loads(self.request("/api/boards/table-axes")[2]), board)
        legacy = json.loads(json.dumps(board))
        del legacy["nodes"][0]["rowIds"]
        del legacy["nodes"][0]["columnIds"]
        self.assertEqual(self.request("/api/boards/legacy-table", "PUT", legacy, {"If-Match": "new"})[0], 200)

    def test_damaged_board_reads_leave_original_file_untouched(self):
        target = Path(self.tmp.name) / "内容" / "damaged.json"
        for raw in [b'{"broken":', json.dumps({"format": "creative-board", "version": 1,
                    "name": "damaged", "nodes": [None], "edges": []}).encode()]:
            target.write_bytes(raw)
            status, _, message = self.request("/api/boards/damaged")
            self.assertEqual(status, 400)
            self.assertIn("原文件仍保留", json.loads(message)["error"])
            self.assertEqual(target.read_bytes(), raw)

    def test_library_checkpoint_preserves_catalog_and_file_references(self):
        # A manual library checkpoint must not checkpoint whichever board is active.
        status, headers, raw = self.request("/api/assets")
        self.assertEqual(status, 200)
        catalog = json.loads(raw)
        catalog["folders"] = ["empty", "nested/empty"]
        catalog["trash"] = [{"id": "batch", "assetIds": [], "folders": ["deleted/empty"]}]
        self.assertEqual(self.request("/api/assets", "PUT", catalog,
                         {"If-Match": headers["ETag"]})[0], 200)
        catalog = json.loads(self.request("/api/assets")[2])
        self.assertEqual(set(catalog["folderIds"]), {"empty", "nested", "nested/empty"})
        before = (Path(self.tmp.name) / "素材目录.json").read_bytes()
        self.assertEqual(self.request("/api/checkpoints/library/catalog", "PUT")[0], 200)
        rows = json.loads(self.request("/api/history/library/catalog")[2])
        self.assertTrue(rows)
        revision = json.loads(self.request("/api/history/library/catalog/" + rows[0]["id"])[2])
        self.assertEqual(revision["value"], catalog)
        self.assertEqual((Path(self.tmp.name) / "素材目录.json").read_bytes(), before)
        self.assertEqual(self.request("/api/checkpoints/library/catalog", "PUT",
                         headers={"Origin": "https://example.com"})[0], 403)

if __name__ == "__main__":
    unittest.main()
