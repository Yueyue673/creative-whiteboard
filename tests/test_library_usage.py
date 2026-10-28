import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import library_usage as usage
import workflow_backend as backend


def node(identity, origin="resource-a", **extra):
    return {"id": identity, "type": "note", "title": identity,
            "libraryOrigin": {"id": origin}, **extra}


class CopyIdentityTests(unittest.TestCase):
    def test_exact_identity_nested_positions_and_literal_unicode_ids(self):
        value = {"nodes": [node("节点 α"), {"id": "table", "type": "table",
                 "cellItems": [[[node("inside"), node("wrong", "resource-b")]]]}],
                 "opaque": {"nodes": [node("ignored")]}}
        before = copy.deepcopy(value)
        result = usage.board_copies(value, "resource-a")
        self.assertFalse(result["limited"])
        self.assertEqual([(x["rootId"], x["nodeId"]) for x in result["items"]],
                         [("节点 α", "节点 α"), ("table", "inside")])
        self.assertIn("第1行第1列", result["items"][1]["context"])
        self.assertEqual(value, before)

    def test_names_file_ids_unknown_fields_and_same_name_do_not_imply_copy(self):
        value = {"nodes": [{"id": "file", "type": "note", "title": "resource-a", "assetId": "resource-a"},
                           node("other", "resource-b"), {"id": "unknown", "type": "note",
                           "opaque": {"libraryOrigin": {"id": "resource-a"}}}]}
        self.assertEqual(usage.board_copies(value, "resource-a")["items"], [])

    def test_ambiguous_roots_and_malformed_cell_content_are_disclosed(self):
        result = usage.board_copies({"nodes": [node("same"), node("same"),
                                    {"id": "bad", "type": "table", "cellItems": "wrong"}]}, "resource-a")
        self.assertTrue(result["limited"])
        self.assertEqual(result["items"], [])

    def test_deadline_parts_depth_and_result_limits_are_explicit(self):
        value = {"nodes": [node("a"), node("b")]}
        result = usage.board_copies(value, "resource-a", maximum=1)
        self.assertEqual(len(result["items"]), 1)
        self.assertTrue(result["limited"])
        self.assertTrue(usage.board_copies(value, "resource-a", {"parts": 0, "deadline": -1})["interrupted"])
        with patch.object(usage, "MAX_PARTS", 1):
            self.assertTrue(usage.board_copies(value, "resource-a")["interrupted"])
        deep = node("deep")
        for i in range(18):
            deep = {"id": "t" + str(i), "type": "table", "cellItems": [[[deep]]]}
        self.assertTrue(usage.board_copies({"nodes": [deep]}, "resource-a")["interrupted"])

    def test_query_shape_and_response_labels_are_bounded(self):
        for value in [{}, {"id": []}, {"id": ["a", "b"]}, {"id": ["../a"]},
                      {"id": ["a\n"]}, {"id": [""]}, {"id": ["a"], "path": ["private"]}]:
            with self.assertRaises(ValueError):
                usage.copy_query(value)
        self.assertEqual(usage.copy_query({"id": ["resource-a"]}), "resource-a")
        value = {"nodes": [node("literal", title="<img onerror=bad>" + "长" * 2000)]}
        before = copy.deepcopy(value)
        result = usage.board_copies(value, "resource-a")
        self.assertEqual(len(result["items"][0]["title"]), 501)
        self.assertTrue(result["items"][0]["title"].endswith("…"))
        self.assertEqual(value, before)


class LocalCopyQueryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.scope = patch.object(backend, "ROOT", self.root)
        self.scope.start()
        (self.root / "内容").mkdir()
        self.catalog = {"assets": [{"id": "resource-a", "mime": "application/x-creative-bundle"},
                                  {"id": "archived", "mime": "application/x-creative-bundle", "archived": True}]}
        self.write("素材目录.json", self.catalog)
        self.write("内容/one.json", {"name": "同名", "nodes": [node("copy")], "edges": []})
        self.write("内容/two.json", {"name": "同名", "nodes": [node("wrong", "resource-b")], "edges": []})

    def tearDown(self):
        self.scope.stop()
        self.temp.cleanup()

    def write(self, name, value):
        (self.root / name).write_bytes(json.dumps(value, ensure_ascii=False).encode())

    def test_local_scan_is_readonly_and_does_not_read_external_asset_paths(self):
        self.catalog["assets"][0]["path"] = "/must-not-open-private-content"
        self.write("素材目录.json", self.catalog)
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        result = backend.library_copies("resource-a")
        self.assertEqual([(x["boardId"], x["nodeId"]) for x in result["items"]], [("one", "copy")])
        self.assertEqual(result["coverage"], "currentSupportedCopies")
        self.assertEqual(before, {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})
        for identity in ["unknown", "archived"]:
            with self.assertRaises(LookupError):
                backend.library_copies(identity)

    def test_local_record_bytes_parts_and_unreadable_board_limits(self):
        with patch.object(usage, "MAX_RECORDS", 1):
            self.assertEqual(backend.library_copies("resource-a")["coverage"], "limited")
        budget = len((self.root / "素材目录.json").read_bytes()) + 10
        self.write("内容/large.json", {"name": "large", "nodes": [node("big", body="x" * 3000)]})
        with patch.object(usage, "MAX_BYTES", budget):
            self.assertEqual(backend.library_copies("resource-a")["coverage"], "limited")
        with patch.object(usage, "MAX_PARTS", 0):
            with self.assertRaises(OverflowError):
                backend.library_copies("resource-a")
        (self.root / "内容/broken.json").write_bytes(b"{")
        self.assertEqual(backend.library_copies("resource-a")["coverage"], "limited")

    def test_local_catalog_budget_stops_before_parsing_unbounded_bytes(self):
        with patch.object(usage, "MAX_BYTES", 1):
            with self.assertRaises(OverflowError):
                backend.library_copies("resource-a")

    def test_local_endpoint_validates_parameters_before_reading(self):
        class Handler:
            path = "/api/library-copies?id=resource-a&id=other"
            def reply(self, code, value):
                self.code, self.value = code, value
        handler = Handler()
        with patch.object(backend, "library_copies") as scan:
            self.assertTrue(backend.workflow_get(handler, "/api/library-copies"))
            self.assertEqual(handler.code, 400)
            scan.assert_not_called()

