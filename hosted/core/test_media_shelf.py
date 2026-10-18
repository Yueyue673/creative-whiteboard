"""Reversible library organization, never registered-source deletion."""
from django.test import Client, TestCase, override_settings

from . import test_media as fixtures
from .documents import put_document, usage
from .media import media_usage, metadata_size
from .models import ConflictDraft, DocumentRevision, MediaAsset, Membership, WorkspaceDocument
from .test_documents import sample_board


class MediaShelfTests(TestCase):
    setUp = fixtures.MediaAPITests.setUp
    upload = fixtures.MediaAPITests.upload
    content = fixtures.MediaAPITests.content
    api = fixtures.MediaAPITests.api
    url = fixtures.MediaAPITests.url

    def asset(self, name="Shelf needle.png"):
        response = self.upload(name=name)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def change(self, row, archived, **kwargs):
        return self.api("assets/items/" + row["id"], "PATCH", {"archived": archived}, row["etag"], **kwargs)

    def test_archive_and_restore_keep_original_bytes_references_author_metadata_and_capacity(self):
        row = self.asset()
        result = self.api("assets/items/" + row["id"], "PATCH", {"notes": "  Own exact words\n", "tags": ["own"]}, row["etag"])
        row = result.json()["asset"]
        board = sample_board("Original words")
        board["nodes"].append({"id": "ref", "type": "image", "assetId": row["id"], "x": 0, "y": 0, "w": 200, "h": 200})
        put_document(self.scope, self.owner, "board", "one", board, "new")
        before = {model.__name__: list(model.objects.values()) for model in (WorkspaceDocument, DocumentRevision, ConflictDraft)}
        before_usage = media_usage(self.shared.pk, self.owner.pk)
        content_tag = self.content(row["mediaURL"])[0]["ETag"]
        archived = self.change(row, True)
        self.assertEqual(archived.status_code, 200, archived.content)
        saved = archived.json()["asset"]
        self.assertTrue(saved["archived"])
        self.assertNotEqual(saved["etag"], row["etag"])
        self.assertEqual(self.api("assets/items").json()["items"], [])
        self.assertEqual(self.api("assets/items?shelf=archived").json()["items"][0]["id"], row["id"])
        self.assertEqual(self.api("assets/search?q=needle").json()["items"], [])
        self.assertEqual(self.api("assets/search?q=needle&shelf=archived").json()["items"][0]["asset"]["id"], row["id"])
        response, raw = self.content(saved["mediaURL"], HTTP_RANGE="bytes=8-15")
        self.assertEqual((response.status_code, raw, response["ETag"]), (206, self.raw[8:16], content_tag))
        self.assertEqual(self.api("assets/items/" + row["id"] + "/references").json()["counts"]["board"], 1)
        self.assertEqual(before_usage, media_usage(self.shared.pk, self.owner.pk))
        asset = MediaAsset.objects.get(pk=row["id"])
        self.assertEqual(asset.byte_size, metadata_size(asset))
        restored = self.change(saved, False).json()["asset"]
        self.assertFalse(restored["archived"])
        for key in ("id", "title", "filename", "notes", "tags", "folderId", "contentHash", "size", "mediaURL"):
            self.assertEqual(restored[key], row[key], key)
        self.assertEqual(self.api("assets/items?shelf=archived").json()["items"], [])
        self.assertEqual(self.content(restored["mediaURL"])[1], self.raw)
        self.assertEqual(before, {model.__name__: list(model.objects.values()) for model in (WorkspaceDocument, DocumentRevision, ConflictDraft)})

    def test_stale_version_cannot_hide_newer_metadata_and_same_state_confirmation_is_noop(self):
        row = self.asset()
        newer = self.api("assets/items/" + row["id"], "PATCH", {"title": "New author title"}, row["etag"]).json()["asset"]
        stale = self.change(row, True)
        self.assertEqual(stale.status_code, 409)
        self.assertFalse(stale.json()["asset"]["archived"])
        self.assertEqual(stale.json()["asset"]["title"], "New author title")
        before = list(MediaAsset.objects.values())
        self.assertEqual(self.change(newer, False).json()["asset"]["etag"], newer["etag"])
        self.assertEqual(before, list(MediaAsset.objects.values()))
        self.assertEqual(self.api("assets/items/" + row["id"], "PATCH", {"archived": True}).status_code, 428)

    def test_fresh_role_original_account_and_workspace_guard_every_shelf_path(self):
        row = self.asset()
        self.assertEqual(self.change(row, True, identity=False).status_code, 428)
        self.assertEqual(self.change(row, True, workspace=self.personal).status_code, 404)
        self.assertEqual(self.change(row, True, client=self.editor_client).status_code, 409)
        Membership.objects.filter(workspace=self.shared, account=self.editor).update(role="viewer")
        self.assertEqual(self.change(row, True, client=self.editor_client, account=self.editor).status_code, 403)
        self.assertEqual(self.api("assets/items?shelf=archived", client=self.editor_client, account=self.editor).status_code, 200)
        Membership.objects.filter(workspace=self.shared, account=self.editor).delete()
        for suffix in ("assets/items?shelf=archived", "assets/search?q=needle&shelf=archived", "assets/items/" + row["id"]):
            self.assertEqual(self.api(suffix, client=self.editor_client, account=self.editor).status_code, 404)
        self.assertEqual(self.change(row, True, client=self.editor_client, account=self.editor).status_code, 404)
        self.assertFalse(MediaAsset.objects.get(pk=row["id"]).archived)

    def test_csrf_and_invalid_combined_actions_cannot_change_records(self):
        row = self.asset()
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.owner)
        self.assertEqual(self.change(row, True, client=csrf_client).status_code, 403)
        for value in ({"archived": 1}, {"archived": "true"}, {"archived": True, "title": "Hidden edit"}):
            self.assertEqual(self.api("assets/items/" + row["id"], "PATCH", value, row["etag"]).status_code, 400)
        for suffix in ("assets/items?shelf=all", "assets/items?shelf=active&shelf=archived", "assets/search?q=needle&shelf=unknown"):
            self.assertEqual(self.api(suffix).status_code, 400)
        self.assertFalse(MediaAsset.objects.get(pk=row["id"]).archived)

    def test_quota_failure_rolls_back_archive_and_archived_bytes_still_limit_uploads(self):
        row = self.asset()
        before = list(MediaAsset.objects.values())
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=usage(self.shared.pk)["totalBytes"]):
            self.assertEqual(self.change(row, True).status_code, 413)
        self.assertEqual(before, list(MediaAsset.objects.values()))
        saved = self.change(row, True).json()["asset"]
        with override_settings(HOSTED_MAX_WORKSPACE_MEDIA_BYTES=len(self.raw)):
            self.assertEqual(self.upload().status_code, 413)
        self.assertEqual(self.change(saved, False).status_code, 200)
        self.assertEqual(MediaAsset.objects.count(), 1)

    def test_archived_folder_identity_remains_protected_and_metadata_version_conflicts(self):
        catalog = {"version": 1, "folders": ["Original"], "folderIds": {"Original": "original-folder"}, "assets": []}
        _, tag = put_document(self.scope, self.owner, "library", "catalog", catalog, "new")
        row = self.upload(folder_id="original-folder").json()
        saved = self.change(row, True).json()["asset"]
        removed = self.api("assets", "PUT", {"version": 1, "folders": [], "folderIds": {}, "assets": []}, tag)
        self.assertEqual(removed.status_code, 409)
        old_edit = self.api("assets/items/" + row["id"], "PATCH", {"notes": "Original unapplied input"}, row["etag"])
        self.assertEqual(old_edit.status_code, 409)
        self.assertTrue(old_edit.json()["asset"]["archived"])
        self.assertEqual(self.change(saved, False).json()["asset"]["folderId"], "original-folder")

    def test_shelf_pagination_and_search_do_not_mix_registered_hidden_and_active_sources(self):
        rows = [self.asset("needle " + str(i) + ".png") for i in range(5)]
        hidden = {rows[i]["id"] for i in (0, 2, 4)}
        for row in rows:
            if row["id"] in hidden:
                self.change(row, True)
        found, after = set(), ""
        while True:
            reply = self.api("assets/items?shelf=archived&limit=2" + ("&after=" + after if after else "")).json()
            found.update(row["id"] for row in reply["items"])
            self.assertTrue(all(row["archived"] for row in reply["items"]))
            after = reply["next"]
            if not after:
                break
        self.assertEqual(found, hidden)
        self.assertEqual({row["asset"]["id"] for row in self.api("assets/search?q=needle&shelf=archived").json()["items"]}, hidden)
        self.assertEqual({row["id"] for row in self.api("assets/items").json()["items"]}, {row["id"] for row in rows} - hidden)

    def test_archived_static_html_preview_and_original_attachment_remain_identical(self):
        from .test_html_preview import RAW
        row = self.upload(raw=RAW, name="own.html").json()
        plan = self.api("assets/items/" + row["id"] + "/html-preview").json()
        rendered = self.client.get(plan["url"]).content
        self.assertEqual(self.change(row, True).status_code, 200)
        self.assertEqual(self.api("assets/items/" + row["id"] + "/html-preview").json(), plan)
        self.assertEqual(self.client.get(plan["url"]).content, rendered)
        response, raw = self.content(row["mediaURL"])
        self.assertEqual(raw, RAW)
        self.assertTrue(response["Content-Disposition"].startswith("attachment;"))
