from unittest.mock import patch

from django.db import connection
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext

from .documents import change_board_state, put_document, usage
from .models import ConflictDraft, DocumentRevision, WorkspaceDocument
from .scope import WorkspaceScope
from .services import change_member
from . import test_documents as document_fixtures
from .workspace_search import excerpt

sample_board = document_fixtures.sample_board

class WorkspaceSearchTests(TestCase):
    setUp = document_fixtures.DocumentAPITests.setUp
    api = document_fixtures.DocumentAPITests.api
    url = document_fixtures.DocumentAPITests.url
    create = document_fixtures.DocumentAPITests.create

    def search(self, query="needle", **kwargs):
        from urllib.parse import urlencode
        return self.api("search?" + urlencode({"q": query}), **kwargs)

    def test_current_workspace_text_and_original_data_unchanged(self):
        original = sample_board("字面 Needle **原文**\n<script>原文</script> 😀")
        original["nodes"][0]["future"] = {"secret": "unknown-field-only"}
        tag = self.create("matching", original)
        self.create("other", sample_board("other text"))
        before = list(WorkspaceDocument.objects.values())
        versions = list(DocumentRevision.objects.values())
        before_usage = usage(self.shared.pk)
        with CaptureQueriesContext(connection) as queries:
            result = self.search().json()
        self.assertEqual(result["account"], self.owner.pk)
        self.assertEqual(result["workspace"], str(self.shared.pk))
        self.assertEqual(result["query"], "needle")
        self.assertEqual(result["items"], [{"id": "matching", "name": "Authored board", "context": "第1项 · 正文",
                                           "excerpt": original["nodes"][0]["body"], "updated": before[0]["updated_at"].timestamp()}])
        self.assertEqual(result["scannedBoards"], 2)
        self.assertEqual(result["coverage"], "currentSupportedText")
        self.assertEqual(list(WorkspaceDocument.objects.values()), before)
        self.assertEqual(list(DocumentRevision.objects.values()), versions)
        self.assertEqual(usage(self.shared.pk), before_usage)
        self.assertFalse(any(row["sql"].lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT")) for row in queries.captured_queries))
        self.assertEqual(self.api("boards/matching")["ETag"], tag)
        self.assertEqual(self.search("unknown-field-only").json()["items"], [])

    def test_name_title_annotation_original_text_edges_and_literal_regex_characters(self):
        for key, field in [("name", "name"), ("title", "title"), ("userText", "userText"), ("annotation", "annotation")]:
            value = sample_board("plain")
            (value if field == "name" else value["nodes"][0])[field] = "Own a+b[.] literal"
            self.create(key, value)
        value = sample_board("plain")
        value["edges"] = [{"id": "edge", "from": "note", "to": "note", "label": "Own a+b[.] relation"}]
        self.create("edge", value)
        rows = self.search("A+B[.]").json()["items"]
        self.assertEqual({row["id"] for row in rows}, {"name", "title", "userText", "annotation", "edge"})
        self.assertTrue(all("a+b[.]" in row["excerpt"] for row in rows))
        self.assertEqual(self.search("a.*").json()["items"], [])

    def test_table_cells_columns_nested_notes_and_tables_have_original_context(self):
        value = sample_board("plain")
        table = {"id": "table", "type": "table", "x": 1, "y": 1, "w": 320, "h": 200,
                 "columns": ["First column"], "rows": [["cell-needle"]],
                 "cellItems": [[[{"id": "inner", "type": "note", "body": "embedded-needle"},
                                  {"id": "nested", "type": "table", "columns": ["nested-column"], "rows": [["nested-cell"]]}]]]}
        value["nodes"].append(table)
        self.create("table", value)
        for query, where in [("column", "第2项 · 第1列名称"), ("cell-needle", "第2项 · 第1行第1列"),
                             ("embedded-needle", "第2项 · 第1行第1列 · 嵌入第1项 · 正文"),
                             ("nested-cell", "第2项 · 第1行第1列 · 嵌入第2项 · 第1行第1列")]:
            self.assertEqual(self.search(query).json()["items"][0]["context"], where)

    def test_other_workspaces_same_board_key_history_trash_and_all_private_drafts_excluded(self):
        tag = self.create("same", sample_board("old-history-needle"))
        current = sample_board("current only")
        put_document(WorkspaceScope(self.shared, "owner"), self.owner, "board", "same", current, tag)
        for actor in [self.owner, self.editor]:
            put_document(WorkspaceScope(self.shared, "owner" if actor == self.owner else "editor"), actor, "board", "same", sample_board("private-draft-needle"), tag)
        self.assertEqual(ConflictDraft.objects.count(), 2)
        tag = self.create("trash", sample_board("trash-needle"))
        change_board_state(WorkspaceScope(self.shared, "owner"), self.owner, "trash", tag)
        self.create("same", sample_board("personal-needle"), workspace=self.personal)
        self.assertEqual(self.search().json()["items"], [])
        self.assertEqual(self.search(workspace=self.personal).json()["items"][0]["excerpt"], "personal-needle")
        for value in ["private-draft", "old-history", "trash-needle"]:
            self.assertEqual(self.search(value).json()["items"], [])

    def test_read_permissions_original_account_and_revocation(self):
        self.create("one", sample_board("needle"))
        self.assertEqual(self.search(client=Client()).status_code, 401)
        self.assertEqual(self.search(identity=False).status_code, 428)
        self.assertEqual(self.search(client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.search(workspace=self.other_personal).status_code, 404)
        change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
        self.assertEqual(len(self.search(client=self.editor_client, account=self.editor).json()["items"]), 1)
        change_member(self.shared.pk, self.owner, self.editor.pk, remove=True)
        self.assertEqual(self.search(client=self.editor_client, account=self.editor).status_code, 404)

    def test_only_read_methods_no_cache_no_extra_parameters(self):
        self.create("one", sample_board("needle"))
        response = self.search()
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(self.search(method="HEAD").content, b"")
        for method in ["POST", "PUT", "PATCH", "DELETE"]:
            self.assertEqual(self.search(method=method).status_code, 405)
        for suffix in ["search", "search?q=", "search?q=a&q=b", "search?q=a&workspace=elsewhere", "search?q=a&path=/secret"]:
            self.assertEqual(self.api(suffix).status_code, 400, suffix)
        for query in [" " * 4, "a" * 121, "a\nb", "a\x00b"]:
            self.assertEqual(self.search(query).status_code, 400)

    def test_unicode_casefold_excerpt_is_bounded_original_and_never_folded_rewrite(self):
        raw = "前" * 300 + " 🧭 Straße **作者原文**\n" + "后" * 500
        self.create("unicode", sample_board(raw))
        snippet = self.search("STRASSE").json()["items"][0]["excerpt"]
        self.assertIn("Straße **作者原文**\n", snippet)
        self.assertNotIn("strasse", snippet)
        self.assertTrue(snippet.startswith("…") and snippet.endswith("…"))
        self.assertLessEqual(len(snippet), 142)
        self.assertIsNone(excerpt("not a match", "NEEDLE"))
        self.assertEqual(self.search("  STRASSE  ").json()["query"], "STRASSE")
        self.create("expansion", sample_board("S" * 400))
        long_match = self.search("ß" * 120).json()["items"][0]["excerpt"]
        self.assertEqual(long_match, "S" * 140 + "…")

    def test_byte_and_record_budget_before_document_body_deserialization(self):
        self.create("one", sample_board("needle"))
        for overrides in [{"MAX_BYTES": 1}, {"MAX_RECORDS": 0}]:
            with patch.multiple("core.workspace_search", **overrides), CaptureQueriesContext(connection) as queries:
                value = self.search().json()
            self.assertEqual(value["items"], [])
            self.assertEqual(value["coverage"], "limited")
            self.assertFalse(any('"core_workspacedocument"."value"' in row["sql"] for row in queries.captured_queries))

    def test_time_traversal_and_result_budgets_report_partial_without_exhaustive_claim(self):
        self.create("old", sample_board("needle old"))
        self.create("new", sample_board("needle new"))
        for overrides in [{"MAX_SECONDS": -1}, {"MAX_PARTS": 1}, {"MAX_RECORDS": 1}, {"MAX_RESULTS": 1}]:
            with patch.multiple("core.workspace_search", **overrides):
                value = self.search().json()
            self.assertEqual(value["coverage"], "limited", overrides)
            self.assertLessEqual(len(value["items"]), 1)
        with patch("core.workspace_search.MAX_RESULTS", 1):
            self.assertEqual(self.search().json()["items"][0]["id"], "new")

    def test_malformed_extensions_do_not_execute_urls_or_block_other_authored_nodes(self):
        value = sample_board("needle retained")
        value["nodes"].append({"id": "future", "type": "table", "x": 0, "y": 0, "w": 10, "h": 10,
                               "columns": ["column"], "rows": [["row"]], "cellItems": [[[{"type": "note", "body": "known nested"}]]],
                               "url": "https://example.test/unknown-secret", "path": "C:/private/unknown-secret",
                               "futureData": {"body": "unknown-secret"}})
        self.create("safe", value)
        # Future/malformed JSON from a retained import is read conservatively;
        # do not weaken the write schema to make a search fixture admissible.
        record = WorkspaceDocument.objects.get(key="safe")
        malformed = dict(value)
        malformed["nodes"] = [*value["nodes"]]
        malformed["nodes"][1] = {**value["nodes"][1], "columns": {}, "rows": [None, {}],
                                  "cellItems": [None, [None, [{"type": "note", "body": "known nested"}]]]}
        record.value = malformed
        record.save(update_fields=["value"])
        self.assertEqual(self.search("unknown-secret").json()["items"], [])
        self.assertEqual(len(self.search("known nested").json()["items"]), 1)
        self.assertEqual(self.api("boards/safe").json(), malformed)
