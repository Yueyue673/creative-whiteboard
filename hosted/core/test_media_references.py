import copy
import time
from unittest.mock import patch

from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection

from .documents import change_board_state, document_etag, put_document, usage
from .media_references import ScanLimit, reference_match
from .models import ConflictDraft, DocumentRevision, WorkspaceDocument
from .scope import WorkspaceScope
from .services import change_member
from .test_documents import sample_board
from . import test_media as media_fixtures


class MediaReferenceTests(TestCase):
    setUp = media_fixtures.MediaAPITests.setUp
    url = media_fixtures.MediaAPITests.url
    api = media_fixtures.MediaAPITests.api
    upload = media_fixtures.MediaAPITests.upload

    def asset(self):
        return self.upload().json()["id"]

    def save(self, key, value, expected="new", account=None, workspace=None):
        space = workspace or self.shared
        return put_document(WorkspaceScope(space, "owner" if account is None else "editor"), account or self.owner, "board", key, value, expected)

    def audit(self, asset, **kwargs):
        return self.api("assets/items/" + asset + "/references", **kwargs)

    def test_nested_cues_cells_unknown_extensions_text_and_original_records(self):
        asset = self.asset()
        value = sample_board("Keep authored original")
        value["nodes"][0]["mediaCue"] = {"assetId": asset}
        value["futureCells"] = {"a": [{"nodes": [{"assetId": asset}]}]}
        _, first = self.save("nested", value)
        changed = copy.deepcopy(value)
        changed["nodes"][0].pop("mediaCue")
        changed.pop("futureCells")
        self.save("nested", changed, first)
        mentioned = sample_board("Literal /w/other/api/media/" + asset + " is only text")
        self.save("mentioned", mentioned)
        boundary = sample_board("not-" + asset + "-a-reference")
        self.save("boundary", boundary)
        before = list(WorkspaceDocument.objects.values())
        versions = list(DocumentRevision.objects.values())
        before_usage = usage(self.shared.pk)
        with CaptureQueriesContext(connection) as queries:
            response = self.audit(asset)
        self.assertEqual(response.status_code, 200, response.content)
        value = response.json()
        self.assertEqual(value["counts"]["board"], 1)
        self.assertEqual(value["counts"]["history"], 2)
        self.assertTrue(any(row["key"] == "nested" and row["match"] == "direct" and row["category"] == "history" for row in value["items"]))
        self.assertTrue(any(row["key"] == "mentioned" and row["match"] == "mentioned" for row in value["items"]))
        self.assertFalse(any(row["key"] == "boundary" for row in value["items"]))
        self.assertFalse(any("value" in row or "body" in row for row in value["items"]))
        self.assertEqual(list(WorkspaceDocument.objects.values()), before)
        self.assertEqual(list(DocumentRevision.objects.values()), versions)
        self.assertEqual(usage(self.shared.pk), before_usage)
        self.assertEqual(response["Cache-Control"], "no-store")
        history_queries = [row["sql"] for row in queries.captured_queries if '"core_documentrevision"."value"' in row["sql"]]
        self.assertTrue(history_queries)
        self.assertTrue(all('"core_workspacedocument"."value"' not in query for query in history_queries))

    def test_private_submissions_are_only_original_authors_never_other_account_counts_or_content(self):
        asset = self.asset()
        _, first = self.save("one", sample_board())
        self.save("one", sample_board("new"), first)
        own = sample_board("owner private literal " + asset)
        self.save("one", own, first)
        foreign = sample_board("OTHER PRIVATE SECRET")
        foreign["nodes"][0]["assetId"] = asset
        self.save("one", foreign, first, account=self.editor)
        result = self.audit(asset).json()
        self.assertEqual(result["counts"]["draft"], 1)
        self.assertEqual(result["items"][0]["match"], "mentioned")
        self.assertNotIn("OTHER PRIVATE SECRET", str(result))
        foreign_id = str(ConflictDraft.objects.get(actor=self.editor).pk)
        self.assertNotIn(foreign_id, str(result))
        other = self.audit(asset, client=self.editor_client, account=self.editor).json()
        self.assertEqual(other["counts"]["draft"], 1)
        self.assertEqual(other["items"][0]["match"], "direct")
        self.assertNotIn(str(ConflictDraft.objects.get(actor=self.owner).pk), str(other))
        self.assertTrue(result["privateSubmissionsExcluded"])
        self.assertFalse(result["deletionSafe"])

    def test_trash_catalog_and_their_retained_history_are_separate(self):
        asset = self.asset()
        value = sample_board()
        value["nodes"][0]["assetId"] = asset
        _, tag = self.save("deleted", value)
        change_board_state(self.scope, self.owner, "deleted", tag)
        # A directory name containing an ID is only a mentioned identifier.
        catalog = {"version": 1, "folders": [asset], "folderIds": {}, "assets": []}
        put_document(self.scope, self.owner, "library", "catalog", catalog, "new")
        result = self.audit(asset).json()
        self.assertEqual(result["counts"], {"board": 0, "trash": 1, "catalog": 1, "history": 2, "catalogHistory": 1, "draft": 0})
        self.assertEqual(result["coverage"], "visibleSavedRecords")

    def test_original_account_membership_and_registered_workspace_identity(self):
        asset = self.asset()
        self.assertEqual(self.audit(asset, client=Client()).status_code, 401)
        self.assertEqual(self.audit(asset, identity=False).status_code, 428)
        self.assertEqual(self.audit(asset, client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.audit(asset, workspace=self.personal).status_code, 404)
        self.assertEqual(self.audit(asset, workspace=self.other_personal).status_code, 404)
        change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
        self.assertEqual(self.audit(asset, client=self.editor_client, account=self.editor).status_code, 200)
        self.assertEqual(self.audit(asset, method="POST", value={}).status_code, 405)
        self.assertEqual(self.audit(asset, method="DELETE").status_code, 405)
        self.assertEqual(self.audit(asset, method="HEAD").content, b"")
        change_member(self.shared.pk, self.owner, self.editor.pk, remove=True)
        self.assertEqual(self.audit(asset, client=self.editor_client, account=self.editor).status_code, 404)

    def test_budget_limits_and_absent_references_never_certify_deletion(self):
        asset = self.asset()
        self.save("one", sample_board())
        for overrides in ({"MAX_BYTES": 1}, {"MAX_RECORDS": 0}, {"MAX_NODES": 1}, {"MAX_SECONDS": -1}):
            with patch.multiple("core.media_references", **overrides):
                result = self.audit(asset).json()
                self.assertEqual(result["coverage"], "limited", overrides)
                self.assertFalse(result["deletionSafe"])
                self.assertEqual(result["items"], [])
        complete = self.audit(asset).json()
        self.assertEqual(complete["coverage"], "visibleSavedRecords")
        self.assertEqual(complete["counts"]["board"], 0)
        self.assertFalse(complete["deletionSafe"])
        with self.assertRaises(ScanLimit):
            reference_match({"assetId": asset}, asset, {"nodes": 0, "deadline": time.monotonic() - 1})

    def test_bounded_results_keep_exact_counts_and_purged_record_is_not_current_link(self):
        asset = self.asset()
        value = sample_board()
        value["opaque"] = {asset.upper(): "A future key"}
        self.save("one", value)
        self.save("two", value)
        with patch("core.media_references.MAX_RESULTS", 1):
            result = self.audit(asset).json()
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(sum(result["counts"].values()), 4)
        self.assertEqual(result["hiddenResults"], 3)
        self.assertEqual(result["items"][0]["match"], "mentioned")
        # Defensive fixture: a purged key must never be advertised as current,
        # even if an old body is encountered in a damaged/imported store.
        from django.utils import timezone
        WorkspaceDocument.objects.filter(key="two").update(deleted_at=timezone.now(), purged_at=timezone.now())
        self.assertFalse(any(row["key"] == "two" for row in self.audit(asset).json()["items"]))
