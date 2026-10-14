import hashlib
import io
import os
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch
from urllib.parse import quote

from django.conf import settings
from django.db import OperationalError, close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings

from . import test_documents as document_fixtures
from .documents import usage
from .media import cancel_upload, checked_storage, reserve_upload, upload_stream
from .models import Account, MediaAsset, MediaStorageBudget, Membership, UploadReservation
from .scope import WorkspaceScope
from .services import APIError, change_member


class MediaAPITests(TestCase):
    url = document_fixtures.DocumentAPITests.url
    api = document_fixtures.DocumentAPITests.api

    def setUp(self):
        document_fixtures.DocumentAPITests.setUp(self)
        self.data_directory = tempfile.TemporaryDirectory(prefix="creative-media-tests-")
        self.addCleanup(self.data_directory.cleanup)
        self.settings_override = override_settings(HOSTED_DATA_ROOT=Path(self.data_directory.name))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        MediaStorageBudget.objects.get_or_create(pk=1)
        self.scope = WorkspaceScope(self.shared, "owner")
        self.raw = b"\x89PNG\r\n\x1a\n" + bytes(range(64))

    def upload(self, raw=None, name="作者的图片.png", workspace=None, client=None, account=None, folder_id="", **headers):
        return (client or self.client).post(
            self.url("assets/upload", workspace), data=self.raw if raw is None else raw,
            content_type="application/octet-stream", HTTP_X_CREATIVE_ACCOUNT=str((account or self.owner).pk),
            HTTP_X_FILE_NAME=quote(name, safe=""), HTTP_X_FOLDER_ID=folder_id, **headers,
        )

    def content(self, path, client=None, **headers):
        response = (client or self.client).get(path, **headers)
        if response.streaming:
            raw = b"".join(response.streaming_content)
        else:
            raw = response.content
        # Django's test client closes the response while exhausting its wrapped
        # iterator. Closing it a second time sends request_finished again and
        # can close the surrounding TestCase transaction's database connection.
        return response, raw

    def test_upload_stream_preserves_original_bytes_and_uses_only_server_owned_file_identity(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.content)
        asset = MediaAsset.objects.get()
        result = response.json()
        self.assertEqual(asset.filename, "作者的图片.png")
        self.assertEqual(asset.content_hash, hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(asset.size, len(self.raw))
        self.assertNotIn("path", result)
        self.assertEqual(checked_storage(self.scope, "media", asset.pk).read_bytes(), self.raw)
        self.assertEqual(UploadReservation.objects.count(), 0)
        self.assertEqual(list((self.scope.storage_root() / "incoming").iterdir()), [])
        media, raw = self.content(result["mediaURL"])
        self.assertEqual(media.status_code, 200)
        self.assertEqual(raw, self.raw)
        self.assertEqual(media["Content-Type"], "image/png")
        self.assertTrue(media["Content-Disposition"].startswith("inline;"))
        self.assertEqual(media["Cache-Control"], "no-store")
        self.assertEqual(media["X-Content-Type-Options"], "nosniff")
        self.assertEqual(usage(self.shared.pk)["assetMetadataBytes"], asset.byte_size)

    def test_media_element_account_binding_cannot_read_after_browser_switch_or_other_workspace(self):
        result = self.upload().json()
        path = result["mediaURL"]
        self.assertEqual(self.content(path, client=self.editor_client)[0].status_code, 409)
        own_path = path.replace("account=" + str(self.owner.pk), "account=" + str(self.editor.pk))
        self.assertEqual(self.content(own_path, client=self.editor_client)[1], self.raw)
        forged = own_path.replace(str(self.shared.pk), str(self.personal.pk))
        self.assertEqual(self.content(forged, client=self.editor_client)[0].status_code, 404)
        cross = path.replace(str(self.shared.pk), str(self.personal.pk))
        self.assertEqual(self.content(cross)[0].status_code, 404)
        self.assertEqual(self.content(path.split("?")[0])[0].status_code, 428)
        self.assertEqual(self.content(path + "&account=" + str(self.owner.pk))[0].status_code, 400)
        self.assertEqual(self.content(path, HTTP_X_CREATIVE_ACCOUNT=str(self.editor.pk))[0].status_code, 400)
        self.client.logout()
        self.assertEqual(self.content(path)[0].status_code, 401)

    def test_single_ranges_head_and_if_range_obey_exact_bytes_and_private_etag(self):
        uploaded = self.upload().json()
        path = uploaded["mediaURL"]
        whole, _ = self.content(path)
        for value, expected, span in [("bytes=2-9", self.raw[2:10], "2-9"), ("bytes=10-", self.raw[10:], "10-71"), ("bytes=-5", self.raw[-5:], "67-71"), ("bytes=0-999", self.raw, "0-71")]:
            response, raw = self.content(path, HTTP_RANGE=value, HTTP_IF_RANGE=whole["ETag"])
            self.assertEqual(response.status_code, 206)
            self.assertEqual(raw, expected)
            self.assertEqual(response["Content-Length"], str(len(expected)))
            self.assertEqual(response["Content-Range"], "bytes " + span + "/72")
        for value in ("bytes=", "bytes=-", "bytes=-0", "bytes=100-", "bytes=9-2", "bytes=0-1,3-4", "bytes=" + "9" * 100 + "-"):
            response, _ = self.content(path, HTTP_RANGE=value)
            self.assertEqual(response.status_code, 416, value)
            self.assertEqual(response["Content-Range"], "bytes */72")
        response, raw = self.content(path, HTTP_RANGE="bytes=2-9", HTTP_IF_RANGE='"another-workspace-version"')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(raw, self.raw)
        head = self.client.head(path, HTTP_RANGE="bytes=2-9")
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head["Content-Length"], "72")
        self.assertEqual(head.content, b"")

    def test_active_files_and_extension_spoofing_are_always_download_attachments(self):
        for name, raw in [("not-an-image.png", b"<script>alert(1)</script>"), ("drawing.svg", b"<svg onload='alert(1)'></svg>"), ("document.pdf", b"%PDF-1.7"), ("page.html", b"<!doctype html>")]:
            result = self.upload(raw=raw, name=name)
            self.assertEqual(result.status_code, 201)
            response, actual = self.content(result.json()["mediaURL"])
            self.assertEqual(actual, raw)
            self.assertEqual(response["Content-Type"], "application/octet-stream")
            self.assertTrue(response["Content-Disposition"].startswith("attachment;"))
            self.assertIn("default-src 'none'", response["Content-Security-Policy"])

    def test_viewer_revoked_and_deactivated_members_cannot_upload_or_keep_streaming(self):
        result = self.upload(raw=b"a" * (1024 * 1024 + 10)).json()
        own_path = result["mediaURL"].replace("account=" + str(self.owner.pk), "account=" + str(self.editor.pk))
        change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
        self.assertEqual(self.upload(client=self.editor_client, account=self.editor).status_code, 403)
        response = self.editor_client.get(own_path)
        chunks = iter(response.streaming_content)
        self.assertEqual(len(next(chunks)), 1024 * 1024)
        change_member(self.shared.pk, self.owner, self.editor.pk, remove=True)
        self.assertEqual(list(chunks), [])
        self.assertEqual(self.content(own_path, client=self.editor_client)[0].status_code, 404)
        self.assertEqual(self.upload(client=self.editor_client, account=self.editor).status_code, 404)
        Account.objects.filter(pk=self.owner.pk).update(is_active=False)
        self.assertEqual(self.content(result["mediaURL"])[0].status_code, 401)

    def test_names_paths_content_lengths_and_limits_fail_before_any_file_is_registered(self):
        for name in ("../escape.png", "C:\\private.png", "folder/file", "x\nname", ".", ""):
            self.assertEqual(self.upload(name=name).status_code, 400, name)
        with override_settings(HOSTED_MAX_UPLOAD_BYTES=1):
            self.assertEqual(self.upload().status_code, 413)
        # The test client omits both headers for an empty body unless supplied.
        self.assertEqual(self.upload(raw=b"", CONTENT_TYPE="application/octet-stream", CONTENT_LENGTH="0").status_code, 413)
        self.assertEqual(self.upload(CONTENT_LENGTH="").status_code, 411)
        self.assertEqual(self.upload(CONTENT_LENGTH="x").status_code, 400)
        self.assertEqual(self.api("assets/upload", "POST", {"path": "/etc/passwd"}).status_code, 415)
        self.assertEqual(MediaAsset.objects.count(), 0)
        self.assertEqual(UploadReservation.objects.count(), 0)

    def test_metadata_updates_preserve_authored_notes_and_reject_stale_or_foreign_file_paths(self):
        uploaded = self.upload()
        key = uploaded.json()["id"]
        changes = {"title": "我的标题", "notes": "  原文 **自己写**\n保留空白  ", "tags": ["参考", " own tag "]}
        saved = self.api("assets/items/" + key, "PATCH", changes, uploaded["ETag"])
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()["asset"]["notes"], changes["notes"])
        self.assertEqual(saved.json()["asset"]["tags"], changes["tags"])
        stale = self.api("assets/items/" + key, "PATCH", {"notes": "do not overwrite"}, uploaded["ETag"])
        self.assertEqual(stale.status_code, 409)
        self.assertTrue(stale.json()["preserveDraft"])
        self.assertFalse(stale.json()["draftSaved"])
        self.assertEqual(self.api("assets/items/" + key, "PATCH", {"path": "/etc/passwd"}, saved["ETag"]).status_code, 400)
        self.assertEqual(self.api("assets/items/" + key, workspace=self.personal).status_code, 404)
        self.assertEqual(MediaAsset.objects.get().notes, changes["notes"])
        self.assertEqual(self.content(uploaded.json()["mediaURL"])[1], self.raw)

    def test_pending_upload_follows_folder_identity_through_rename_and_does_not_orphan_assets(self):
        first = self.api("assets", "PUT", {"version": 1, "folders": ["Own/Folder"], "assets": []}, "new")
        catalog = self.api("assets").json()
        folder_id = catalog["folderIds"]["Own/Folder"]
        original_stream = io.BytesIO(self.raw)
        class RenameDuringRead:
            def __init__(inner):
                inner.renamed = False
            def read(inner, count):
                if not inner.renamed:
                    inner.renamed = True
                    renamed = {"version": 1, "folders": ["Own/Renamed"], "folderIds": {"Own/Renamed": folder_id}, "assets": []}
                    self.assertEqual(self.api("assets", "PUT", renamed, first["ETag"]).status_code, 200)
                return original_stream.read(count)
        asset = upload_stream(self.scope, self.owner, RenameDuringRead(), len(self.raw), "own.png", folder_id)
        self.assertEqual(asset.folder_id, folder_id)
        result = self.api("assets/items/" + str(asset.pk)).json()
        self.assertEqual(result["folder"], "Own/Renamed")
        now = self.api("assets")
        removal = self.api("assets", "PUT", {"version": 1, "folders": [], "assets": []}, now["ETag"])
        self.assertEqual(removal.status_code, 409)
        self.assertEqual(removal.json()["code"], "library_folder_in_use")
        self.assertEqual(self.upload(folder_id="missing").status_code, 409)

    def test_folder_removed_or_member_revoked_mid_upload_leaves_no_registered_or_partial_file(self):
        first = self.api("assets", "PUT", {"version": 1, "folders": ["Target"], "assets": []}, "new")
        folder_id = self.api("assets").json()["folderIds"]["Target"]
        raw_stream = io.BytesIO(self.raw)
        class RemoveDuringRead:
            def read(inner, count):
                self.assertEqual(self.api("assets", "PUT", {"version": 1, "folders": [], "assets": []}, first["ETag"]).status_code, 200)
                return raw_stream.read(count)
        with self.assertRaises(APIError) as error:
            upload_stream(self.scope, self.owner, RemoveDuringRead(), len(self.raw), "own.png", folder_id)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(MediaAsset.objects.count(), 0)
        self.assertEqual(UploadReservation.objects.count(), 0)
        self.assertEqual(list(Path(self.data_directory.name).rglob("*.part")), [])
        self.assertEqual(list(Path(self.data_directory.name).rglob("*.blob")), [])
        original = io.BytesIO(self.raw)
        class RevokeDuringRead:
            def read(inner, count):
                change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
                return original.read(count)
        with self.assertRaises(APIError) as denied:
            upload_stream(WorkspaceScope(self.shared, "editor"), self.editor, RevokeDuringRead(), len(self.raw), "own.png", "")
        self.assertEqual(denied.exception.status, 403)
        self.assertEqual(MediaAsset.objects.count(), 0)
        self.assertEqual(UploadReservation.objects.count(), 0)
        self.assertEqual(list(Path(self.data_directory.name).rglob("*.part")), [])

    def test_early_disconnect_and_disk_database_failures_leave_no_partial_asset_and_retry_works(self):
        with self.assertRaises(APIError):
            upload_stream(self.scope, self.owner, io.BytesIO(b"short"), 100, "own.png", "")
        with patch("core.media.MediaAsset.save", side_effect=OperationalError("temporary database failure")):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        with patch("core.media.os.fsync", side_effect=OSError("temporary disk failure")):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(MediaAsset.objects.count(), 0)
        self.assertEqual(UploadReservation.objects.count(), 0)
        self.assertEqual(list(Path(self.data_directory.name).rglob("*.part")), [])
        self.assertEqual(list(Path(self.data_directory.name).rglob("*.blob")), [])
        self.assertEqual(self.upload().status_code, 201)

    def test_media_quota_reservations_include_pending_transfers_and_do_not_leak_other_accounts(self):
        for config in ("HOSTED_MAX_WORKSPACE_MEDIA_BYTES", "HOSTED_MAX_ACCOUNT_MEDIA_BYTES", "HOSTED_MAX_TOTAL_MEDIA_BYTES"):
            with override_settings(**{config: len(self.raw) - 1}):
                self.assertEqual(self.upload().status_code, 413, config)
        with patch("core.media.shutil.disk_usage") as disk:
            disk.return_value.free = settings.HOSTED_MIN_FREE_DISK_BYTES
            self.assertEqual(self.upload().status_code, 507)
        reservation = reserve_upload(self.scope, self.owner, len(self.raw), "pending.png", "")
        with override_settings(HOSTED_MAX_WORKSPACE_MEDIA_BYTES=len(self.raw)):
            self.assertEqual(self.upload().status_code, 413)
        with override_settings(HOSTED_MAX_PENDING_UPLOADS_PER_ACCOUNT=1):
            self.assertEqual(self.upload(workspace=self.personal).status_code, 429)
        state = self.api("media-quota").json()
        self.assertEqual(state["workspacePendingBytes"], len(self.raw))
        self.assertNotIn("globalBytes", state)
        cancel_upload(self.scope, reservation.pk)
        self.assertEqual(self.upload().status_code, 201)

    def test_json_metadata_quota_rolls_back_uploaded_file_and_metadata_edits(self):
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):
            self.assertEqual(self.upload().status_code, 413)
        self.assertEqual(MediaAsset.objects.count(), 0)
        self.assertEqual(list(Path(self.data_directory.name).rglob("*.blob")), [])
        result = self.upload()
        before = usage(self.shared.pk)["totalBytes"]
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=before):
            response = self.api("assets/items/" + result.json()["id"], "PATCH", {"notes": "much more authored text" * 100}, result["ETag"])
        self.assertEqual(response.status_code, 413)
        self.assertEqual(MediaAsset.objects.get().notes, "")
        self.assertEqual(self.api("assets/items/" + result.json()["id"])["ETag"], result["ETag"])

    def test_paginated_library_items_are_scoped_and_bound_media_urls_belong_to_current_reader(self):
        for index in range(3):
            self.upload(name=f"own-{index}.png")
        first = self.api("assets/items?limit=2")
        self.assertEqual(len(first.json()["items"]), 2)
        second = self.api("assets/items?limit=2&after=" + first.json()["next"])
        self.assertEqual(len(second.json()["items"]), 1)
        self.assertIsNone(second.json()["next"])
        self.assertEqual(self.api("assets/items", workspace=self.personal).json()["items"], [])
        guest = self.api("assets/items", client=self.editor_client, account=self.editor)
        self.assertTrue(all(row["mediaURL"].endswith("account=" + str(self.editor.pk)) for row in guest.json()["items"]))

    def test_registered_file_tampering_and_redirects_fail_without_reading_foreign_bytes(self):
        uploaded = self.upload().json()
        asset = MediaAsset.objects.get()
        target = checked_storage(self.scope, "media", asset.pk)
        target.write_bytes(b"wrong size")
        self.assertEqual(self.content(uploaded["mediaURL"])[0].status_code, 503)
        outside = Path(self.data_directory.name) / "foreign"
        outside.mkdir()
        foreign = outside / target.name
        foreign.write_bytes(b"do not read")
        original_resolve = Path.resolve
        def redirect(path, *args, **kwargs):
            return foreign if path == target else original_resolve(path, *args, **kwargs)
        with patch.object(Path, "resolve", redirect):
            self.assertEqual(self.content(uploaded["mediaURL"])[0].status_code, 503)
        self.assertEqual(foreign.read_bytes(), b"do not read")


class ConcurrentMediaTests(TransactionTestCase):
    def setUp(self):
        document_fixtures.ConcurrentDocumentTests.setUp(self)
        MediaStorageBudget.objects.get_or_create(pk=1)

    @override_settings(HOSTED_MAX_TOTAL_MEDIA_BYTES=100, HOSTED_MAX_WORKSPACE_MEDIA_BYTES=100)
    def test_simultaneous_upload_reservations_cannot_overbook_storage(self):
        barrier = Barrier(2, timeout=10)
        def worker(_):
            close_old_connections()
            try:
                account = Account.objects.get(pk=self.owner.pk)
                barrier.wait()
                try:
                    return reserve_upload(self.scope, account, 70, "own.png", "").pk
                except APIError as error:
                    return error.status
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(worker, range(2)))
        self.assertEqual(sum(isinstance(result, uuid.UUID) for result in results), 1)
        self.assertEqual(results.count(413), 1)
        self.assertEqual(UploadReservation.objects.count(), 1)
        self.assertEqual(UploadReservation.objects.get().size, 70)
