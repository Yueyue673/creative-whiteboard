"""Catalog-only historical cleanup preserves current references and private inputs."""
import copy
import io

from django.test import TestCase, override_settings

from . import test_documents as fixtures
from .documents import document_etag, usage
from .media import upload_stream
from .models import ConflictDraft, DocumentRevision, WorkspaceDocument
from .scope import WorkspaceScope


class CatalogHistoryTests(TestCase):
    setUp = fixtures.DocumentAPITests.setUp
    url = fixtures.DocumentAPITests.url
    api = fixtures.DocumentAPITests.api
    create = fixtures.DocumentAPITests.create

    def setup_catalogs(self):
        tags = {}
        for kind, endpoint in (("folders", "folders"), ("library", "assets")):
            tag = "new"
            for number in range(3):
                value = {"folders": [{"id": "kept-folder", "name": f"Own <img src=x> {number}", "parent": ""}]} if kind == "folders" else {"version": 1, "folders": [f"Own {number}"], "folderIds": {f"Own {number}": "kept-library-folder"}, "assets": []}
                saved = self.api(endpoint, "PUT", value, tag)
                self.assertEqual(saved.status_code, 200, saved.content)
                tag = saved["ETag"]
            tags[kind] = tag
        self.create(value=fixtures.sample_board("Exact authored words", "kept-folder"))
        asset = upload_stream(WorkspaceScope(self.shared, "owner"), self.owner, io.BytesIO(b"original-media"), 14, "own.txt", "kept-library-folder")
        for kind in ("folders", "library"):
            value = WorkspaceDocument.objects.get(workspace=self.shared, kind=kind).value
            for actor, client in ((self.owner, self.client), (self.editor, self.editor_client)):
                response = self.api("folders" if kind == "folders" else "assets", "PUT", copy.deepcopy(value), "new", client=client, account=actor)
                self.assertEqual(response.status_code, 409)
                self.assertTrue(response.json()["draftSaved"])
        return tags, asset

    def preview(self, kind):
        reply = self.api(f"history/{kind}/catalog/cleanup?keep=1")
        self.assertEqual(reply.status_code, 200, reply.content)
        return reply

    def clean(self, kind, preview, **kwargs):
        return self.api(f"history/{kind}/catalog/cleanup", "POST", {"keep": 1, "confirm": "discard_history"}, preview["ETag"], **kwargs)

    def test_catalog_cleanup_preserves_current_ids_boards_assets_all_authors_drafts_and_other_kind(self):
        tags, asset = self.setup_catalogs()
        before_documents = list(WorkspaceDocument.objects.values("pk", "value", "revision_token", "byte_size"))
        drafts = list(ConflictDraft.objects.values("pk", "value", "byte_size"))
        board_versions = list(DocumentRevision.objects.filter(document__kind="board").values_list("pk", flat=True))
        for kind in ("folders", "library"):
            before = usage(self.shared.pk)
            preview = self.preview(kind);plan = preview.json()
            self.assertEqual(plan["kind"], kind)
            self.assertEqual(plan["key"], "catalog")
            versions = list(DocumentRevision.objects.filter(document__workspace=self.shared, document__kind=kind).order_by("-revision"))
            self.assertEqual([v["id"] for v in plan["retainVersions"]], [str(versions[0].pk)])
            self.assertEqual([v["id"] for v in plan["removeVersions"]], [str(v.pk) for v in versions[1:]])
            with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):
                reply = self.clean(kind, preview)
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(before["totalBytes"] - usage(self.shared.pk)["totalBytes"], plan["reclaimPayloadBytes"])
            self.assertEqual(DocumentRevision.objects.filter(document__workspace=self.shared, document__kind=kind).count(), 1)
            self.assertEqual(document_etag(WorkspaceDocument.objects.get(workspace=self.shared, kind=kind)), tags[kind])
        self.assertEqual(list(WorkspaceDocument.objects.values("pk", "value", "revision_token", "byte_size")), before_documents)
        self.assertEqual(list(ConflictDraft.objects.values("pk", "value", "byte_size")), drafts)
        self.assertEqual(list(DocumentRevision.objects.filter(document__kind="board").values_list("pk", flat=True)), board_versions)
        asset.refresh_from_db();self.assertEqual(asset.folder_id, "kept-library-folder")
        self.assertEqual(self.api("assets").json()["folderIds"], {"Own 2": "kept-library-folder"})

    def test_catalog_plan_cannot_be_reused_for_other_kind_workspace_key_or_keep_count(self):
        self.setup_catalogs();preview = self.preview("folders")
        self.assertEqual(self.clean("library", preview).status_code, 409)
        self.assertEqual(self.clean("folders", preview, workspace=self.personal).status_code, 404)
        self.assertEqual(self.api("history/folders/other/cleanup").status_code, 404)
        self.assertEqual(self.api("history/folders/catalog/cleanup", "POST", {"keep": 2, "confirm": "discard_history"}, preview["ETag"]).status_code, 409)
        self.assertEqual(DocumentRevision.objects.filter(document__kind__in=("folders", "library")).count(), 6)

    def test_new_catalog_save_after_preview_invalidates_exact_plan(self):
        tags, _ = self.setup_catalogs();preview = self.preview("folders")
        value = {"folders": [{"id": "kept-folder", "name": "New device exact folder name", "parent": ""}]}
        saved = self.api("folders", "PUT", value, tags["folders"])
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.clean("folders", preview).status_code, 409)
        self.assertEqual(self.api("folders").json(), value)
        self.assertEqual(DocumentRevision.objects.filter(document__kind="folders").count(), 4)

    def test_identity_permission_and_confirmation_are_checked_on_catalog_writes(self):
        self.setup_catalogs();preview = self.preview("library")
        self.assertEqual(self.clean("library", preview, client=self.editor_client, account=self.editor).status_code, 403)
        self.assertEqual(self.clean("library", preview, client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.clean("library", preview, identity=False).status_code, 428)
        self.assertEqual(self.api("history/library/catalog/cleanup", "POST", {"keep": 1, "confirm": "discard_board"}, preview["ETag"]).status_code, 428)
        self.assertEqual(self.api("history/library/catalog/cleanup", "POST", {"keep": 1, "confirm": "discard_history"}).status_code, 428)
        self.assertEqual(DocumentRevision.objects.filter(document__kind="library").count(), 3)

    def test_noop_cleanup_adds_no_revision_and_catalog_cannot_be_applied_as_board(self):
        self.setup_catalogs()
        preview = self.api("history/folders/catalog/cleanup?keep=3")
        reply = self.api("history/folders/catalog/cleanup", "POST", {"keep": 3, "confirm": "discard_history"}, preview["ETag"])
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()["removeRevisions"], 0)
        old = DocumentRevision.objects.filter(document__kind="folders").first()
        self.assertEqual(self.api(f"history/board/catalog/{old.pk}/apply").status_code, 404)
        self.assertEqual(DocumentRevision.objects.filter(document__kind="folders").count(), 3)
