from unittest.mock import patch

from django.db import connection
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext

from . import test_media as fixtures
from .documents import put_document, usage
from .media import checked_storage, metadata_size
from .models import Account, ConflictDraft, DocumentRevision, MediaAsset, Membership, WorkspaceDocument
from .scope import WorkspaceScope
from .services import change_member
from . import media_search


class MediaSearchTests(TestCase):
    setUp = fixtures.MediaAPITests.setUp
    upload = fixtures.MediaAPITests.upload
    api = fixtures.MediaAPITests.api
    url = fixtures.MediaAPITests.url

    def search(self, query="needle", **kwargs):
        from urllib.parse import urlencode
        return self.api("assets/search?" + urlencode({"q": query}), **kwargs)

    def asset(self, name="original.bin", **changes):
        result = self.upload(raw=b"synthetic original blob fileContents-only", name=name)
        self.assertEqual(result.status_code, 201, result.content)
        asset = MediaAsset.objects.get(pk=result.json()["id"])
        for field, value in changes.items():
            setattr(asset, field, value)
        asset.byte_size = metadata_size(asset)
        asset.save()
        return asset

    def test_known_metadata_original_excerpt_and_all_bytes_database_usage_unchanged(self):
        asset = self.asset(notes="前" * 200 + " Needle **作者原文**\n<script>字面显示</script> 😀" + "后" * 200)
        before = (list(MediaAsset.objects.values()), list(WorkspaceDocument.objects.values()), list(DocumentRevision.objects.values()), usage(self.shared.pk), checked_storage(self.scope, "media", asset.pk).read_bytes())
        with CaptureQueriesContext(connection) as queries:
            result = self.search().json()
        self.assertEqual(result["account"], self.owner.pk)
        self.assertEqual(result["workspace"], str(self.shared.pk))
        self.assertEqual(result["query"], "needle")
        self.assertEqual(result["coverage"], "registeredMetadata")
        row = result["items"][0]
        self.assertEqual(row["context"], "说明")
        self.assertEqual(row["asset"]["id"], str(asset.pk))
        self.assertIn("Needle **作者原文**\n<script>字面显示</script> 😀", row["excerpt"])
        self.assertLessEqual(len(row["excerpt"]), 142)
        self.assertEqual(before, (list(MediaAsset.objects.values()), list(WorkspaceDocument.objects.values()), list(DocumentRevision.objects.values()), usage(self.shared.pk), checked_storage(self.scope, "media", asset.pk).read_bytes()))
        self.assertFalse(any(row["sql"].lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT")) for row in queries.captured_queries))

    def test_name_original_filename_notes_and_tags_literal_matching_one_result_per_file(self):
        for field in ("title", "filename", "notes", "tags"):
            self.asset(**{field: ["Own a+b[.] original"] if field == "tags" else "Own a+b[.] original"})
        rows = self.search("A+B[.]").json()["items"]
        self.assertEqual({row["context"] for row in rows}, {"素材名称", "原文件名", "说明", "标签"})
        self.assertEqual(len(rows), 4)
        self.assertTrue(all("a+b[.]" in row["excerpt"] for row in rows))
        self.assertEqual(self.search("a.*").json()["items"], [])
        self.asset(title="needle", notes="needle", tags=["needle", "needle"])
        self.assertEqual(len(self.search().json()["items"]), 1)

    def test_unicode_casefold_keeps_authored_characters_and_long_queries_bounded(self):
        self.asset(notes="Straße 😀 **Original**")
        row = self.search("  STRASSE  ").json()["items"][0]
        self.assertEqual(row["excerpt"], "Straße 😀 **Original**")
        self.asset(notes="S" * 400)
        self.assertEqual(self.search("ß" * 120).json()["items"][0]["excerpt"], "S" * 140 + "…")

    def test_foreign_workspace_source_contents_private_drafts_and_history_excluded(self):
        self.asset(notes="current only")
        self.upload(raw=b"needle foreign bytes", name="needle-foreign.bin", workspace=self.personal)
        board = fixtures.document_fixtures.sample_board("needle board only")
        _, tag = put_document(self.scope, self.owner, "board", "original", board, "new")
        _, current = put_document(self.scope, self.owner, "board", "original", fixtures.document_fixtures.sample_board("needle current"), tag)
        put_document(self.scope, self.owner, "board", "original", fixtures.document_fixtures.sample_board("needle private draft"), tag)
        self.assertTrue(DocumentRevision.objects.exists())
        self.assertTrue(ConflictDraft.objects.exists())
        self.assertEqual(self.search().json()["items"], [])
        self.assertEqual(self.search("fileContents-only").json()["items"], [])
        self.assertEqual(len(self.search(workspace=self.personal).json()["items"]), 1)
        self.assertEqual(self.search().json()["excludes"], ["fileContents", "history", "privateDrafts", "browserInput"])

    def test_original_identity_viewer_revocation_and_missing_account(self):
        self.asset(notes="needle")
        self.assertEqual(self.search(client=Client()).status_code, 401)
        self.assertEqual(self.search(identity=False).status_code, 428)
        self.assertEqual(self.search(client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.search(workspace=self.other_personal).status_code, 404)
        change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
        self.assertEqual(len(self.search(client=self.editor_client, account=self.editor).json()["items"]), 1)
        change_member(self.shared.pk, self.owner, self.editor.pk, remove=True)
        self.assertEqual(self.search(client=self.editor_client, account=self.editor).status_code, 404)

    def test_permission_withdrawal_disabled_account_and_password_change_during_scan_refused(self):
        self.asset(notes="needle")
        original = media_search.metadata_parts
        for change in ("member", "disabled", "password"):
            def parts(asset, budget):
                if change == "member":
                    Membership.objects.filter(workspace=self.shared, account=self.editor).delete()
                elif change == "disabled":
                    Account.objects.filter(pk=self.editor.pk).update(is_active=False)
                else:
                    Account.objects.filter(pk=self.editor.pk).update(password="changed-password-hash")
                yield from original(asset, budget)
            with self.subTest(change=change), patch("core.media_search.metadata_parts", parts):
                response = self.search(client=self.editor_client, account=self.editor)
                self.assertEqual(response.status_code, 409 if change == "password" else 404)
                self.assertNotIn("items", response.json())
            Account.objects.filter(pk=self.editor.pk).update(is_active=True, password=self.editor.password)
            Membership.objects.get_or_create(workspace=self.shared, account=self.editor, defaults={"role": "editor"})

    def test_only_get_head_no_cache_and_no_extra_or_duplicate_query_parameters(self):
        self.asset(notes="needle")
        self.assertEqual(self.search()["Cache-Control"], "no-store")
        self.assertEqual(self.search(method="HEAD").content, b"")
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual(self.search(method=method).status_code, 405)
        for suffix in ("assets/search", "assets/search?q=", "assets/search?q=a&q=b", "assets/search?q=a&path=/private", "assets/search?q=a&account=other", "assets/search?q=a&workspace=other"):
            self.assertEqual(self.api(suffix).status_code, 400, suffix)
        for query in ("a" * 121, "a\nb", "a\x00b"):
            self.assertEqual(self.search(query).status_code, 400)

    def test_read_budget_before_deserialization_and_partial_results_honest(self):
        self.asset(notes="needle old")
        self.asset(notes="needle new")
        for overrides in ({"MAX_BYTES": 1}, {"MAX_RECORDS": 0}, {"MAX_SECONDS": -1}):
            with patch.multiple("core.media_search", **overrides), CaptureQueriesContext(connection) as queries:
                result = self.search().json()
            self.assertEqual(result["coverage"], "limited")
            self.assertEqual(result["items"], [])
            self.assertFalse(any('"core_mediaasset"."notes"' in row["sql"] or '"core_workspacedocument"."value"' in row["sql"] for row in queries.captured_queries))
        for overrides in ({"MAX_PARTS": 1}, {"MAX_RECORDS": 1}, {"MAX_RESULTS": 1}):
            with patch.multiple("core.media_search", **overrides):
                result = self.search().json()
            self.assertEqual(result["coverage"], "limited")
            self.assertLessEqual(len(result["items"]), 1)
        with patch("core.media_search.MAX_RESULTS", 1):
            self.assertEqual(self.search().json()["items"][0]["asset"]["notes"], "needle new")

    def test_original_stable_folder_caption_and_catalog_budget_without_file_reads(self):
        catalog = {"version": 1, "folders": ["资料/原位置"], "folderIds": {"资料/原位置": "originalFolder"}, "assets": []}
        response, _ = put_document(self.scope, self.owner, "library", "catalog", catalog, "new")
        self.assertTrue(response["saved"])
        asset = self.asset(notes="needle", folder_id="originalFolder")
        with patch("core.media.open_media", side_effect=AssertionError("Search must not read blobs")):
            self.assertEqual(self.search().json()["items"][0]["asset"]["folder"], "资料/原位置")
        with patch("core.media_search.MAX_BYTES", asset.byte_size):
            result = self.search().json()
        self.assertEqual(result["items"], [])
        self.assertEqual(result["coverage"], "limited")
