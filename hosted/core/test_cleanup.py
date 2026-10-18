from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import OperationalError, close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings

from .cleanup import apply_cleanup, preview_cleanup
from .documents import change_board_state, document_etag, put_document, usage
from .models import Account, ConflictDraft, DocumentRevision, Membership, WorkspaceDocument
from .scope import WorkspaceScope
from .services import APIError
from . import test_documents as document_fixtures

sample_board = document_fixtures.sample_board


class CleanupAPITests(TestCase):
    setUp = document_fixtures.DocumentAPITests.setUp
    url = document_fixtures.DocumentAPITests.url
    api = document_fixtures.DocumentAPITests.api
    create = document_fixtures.DocumentAPITests.create

    def test_review_lists_exact_scoped_versions_and_never_includes_revision_bodies(self):
        tag = self.versions()
        document = WorkspaceDocument.objects.get(workspace=self.shared, key="one")
        rows = list(document.versions.order_by("-revision"))
        preview = self.api("history/board/one/cleanup?keep=2")
        self.assertEqual(preview.status_code, 200)
        plan = preview.json()
        self.assertEqual(plan["workspace"], str(self.shared.pk))
        self.assertEqual([r["id"] for r in plan["retainVersions"]], [str(r.pk) for r in rows[:2]])
        self.assertEqual([r["id"] for r in plan["removeVersions"]], [str(rows[2].pk)])
        self.assertEqual(plan["reclaimPayloadBytes"], rows[2].byte_size)
        for info, row in zip(plan["retainVersions"] + plan["removeVersions"], rows):
            self.assertEqual(info, {"id": str(row.pk), "revision": row.revision,
                                  "name": row.value["name"], "deleted": row.deleted,
                                  "savedAt": row.created_at.timestamp(), "payloadBytes": row.byte_size})
            self.assertNotIn("value", info)
        self.assertEqual(plan["retentionLimit"], 40)
        self.assertEqual(document_etag(WorkspaceDocument.objects.get(pk=document.pk)), tag)

    def test_purge_review_lists_all_versions_and_post_repeats_the_accepted_exact_range(self):
        tag = self.versions()
        self.api("boards/one", "DELETE", etag=tag)
        preview = self.api("boards/one/purge")
        plan = preview.json()
        self.assertEqual(plan["retainVersions"], [])
        self.assertEqual([r["revision"] for r in plan["removeVersions"]], [4, 3, 2, 1])
        self.assertTrue(plan["removeVersions"][0]["deleted"])
        reply = self.api("boards/one/purge", "POST", {"confirm": "discard_board"}, preview["ETag"])
        self.assertEqual(reply.status_code, 200)
        for key in ("workspace", "key", "removeVersions", "retainVersions", "reclaimPayloadBytes"):
            self.assertEqual(reply.json()[key], plan[key])

    def versions(self, key="one"):
        tag = self.create(key, sample_board("own words 0"))
        for number in range(1, 3):
            saved = self.api("boards/" + key, "PUT", sample_board("own words " + str(number)), tag)
            self.assertEqual(saved.status_code, 200)
            tag = saved["ETag"]
        return tag

    def prune(self, preview, keep=1, **kwargs):
        return self.api("history/board/one/cleanup", "POST", {"keep": keep, "confirm": "discard_history"}, preview["ETag"], **kwargs)

    def test_full_quota_can_be_recovered_without_rewriting_current_content_or_private_inputs(self):
        tag = self.versions()
        draft = self.api("boards/one", "PUT", sample_board("editor's exact rejected words"), "new", client=self.editor_client, account=self.editor)
        self.assertTrue(draft.json()["draftSaved"])
        original = WorkspaceDocument.objects.get().value
        original_draft = ConflictDraft.objects.get().value
        before = usage(self.shared.pk)
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=before["totalBytes"]):
            blocked = self.api("boards/one", "DELETE", etag=tag)
            self.assertEqual(blocked.status_code, 413)
            preview = self.api("history/board/one/cleanup?keep=1")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.json()["removeRevisions"], 2)
            # Viewing, canceling and malformed/unconfirmed actions remove nothing.
            self.assertEqual(DocumentRevision.objects.count(), 3)
            missing = self.api("history/board/one/cleanup", "POST", {"keep": 1, "confirm": ""}, preview["ETag"])
            self.assertEqual(missing.status_code, 428)
            self.assertEqual(DocumentRevision.objects.count(), 3)
            result = self.prune(preview)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(before["totalBytes"] - result.json()["usage"]["totalBytes"], preview.json()["reclaimPayloadBytes"])
            self.assertEqual(DocumentRevision.objects.count(), 1)
            self.assertEqual(WorkspaceDocument.objects.get().value, original)
            self.assertEqual(document_etag(WorkspaceDocument.objects.get()), tag)
            self.assertEqual(ConflictDraft.objects.get().value, original_draft)
            self.assertEqual(self.api("boards/one", "DELETE", etag=tag).status_code, 200)

    def test_history_plan_is_bound_to_versions_retention_choice_workspace_and_kind(self):
        tag = self.versions()
        self.versions("two")
        preview = self.api("history/boards/one/cleanup?keep=1")
        self.assertEqual(self.prune(preview, keep=2).status_code, 409)
        foreign = self.api("history/board/two/cleanup", "POST", {"keep": 1, "confirm": "discard_history"}, preview["ETag"])
        self.assertEqual(foreign.status_code, 409)
        private_tag = self.create(value=sample_board("personal"), workspace=self.personal)
        self.assertNotEqual(tag, private_tag)
        self.assertEqual(self.prune(preview, workspace=self.personal).status_code, 409)
        saved = self.api("boards/one", "PUT", sample_board("a new device's authored input"), tag)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.prune(preview).status_code, 409)
        self.assertEqual(WorkspaceDocument.objects.get(workspace=self.shared, key="one").value, sample_board("a new device's authored input"))
        self.assertEqual(DocumentRevision.objects.filter(document__workspace=self.shared, document__key="one").count(), 4)
        current = self.api("history/board/one/cleanup?keep=2")
        self.assertEqual(self.prune(current, keep=2).status_code, 200)
        self.assertEqual(self.prune(current, keep=2).status_code, 409)
        self.assertEqual([v["revision"] for v in self.api("history/board/one").json()], [4, 3])

    def test_owner_only_cleanup_rechecks_identity_membership_and_active_account(self):
        self.versions()
        preview = self.api("history/board/one/cleanup")
        for role in ("editor", "viewer"):
            Membership.objects.filter(workspace=self.shared, account=self.editor).update(role=role)
            self.assertEqual(self.api("history/board/one/cleanup", client=self.editor_client, account=self.editor).status_code, 403)
            self.assertEqual(self.prune(preview, client=self.editor_client, account=self.editor).status_code, 403)
        Membership.objects.filter(workspace=self.shared, account=self.editor).update(role="editor")
        self.assertEqual(self.prune(preview, client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.prune(preview, identity=False).status_code, 428)
        self.assertEqual(self.prune(preview, workspace=self.other_personal).status_code, 404)
        original = apply_cleanup
        def after_scope_check(scope, account, *args, **kwargs):
            Account.objects.filter(pk=account.pk).update(is_active=False)
            return original(scope, account, *args, **kwargs)
        with patch("core.document_views.apply_cleanup", after_scope_check):
            self.assertEqual(self.prune(preview).status_code, 401)
        self.assertEqual(DocumentRevision.objects.count(), 3)

    def test_invalid_retention_values_never_discard_current_or_historical_words(self):
        self.versions()
        for value in ("0", "-1", "41", "1.5", "true", "00001", "١"):
            self.assertEqual(self.api("history/board/one/cleanup?keep=" + value).status_code, 400, value)
        preview = self.api("history/board/one/cleanup")
        for value in (0, -1, 41, True, 1.5, "1", None):
            self.assertEqual(self.prune(preview, keep=value).status_code, 400, value)
        self.assertEqual(DocumentRevision.objects.count(), 3)

    def test_catalog_history_cleanup_preserves_latest_folder_identities(self):
        first = self.api("folders", "PUT", {"folders": []}, "new")
        current = {"folders": [{"id": "my-folder", "name": "Own folder", "parent": ""}]}
        saved = self.api("folders", "PUT", current, first["ETag"])
        preview = self.api("history/folders/catalog/cleanup")
        result = self.api("history/folders/catalog/cleanup", "POST", {"keep": 1, "confirm": "discard_history"}, preview["ETag"])
        self.assertEqual(result.status_code, 200)
        read = self.api("folders")
        self.assertEqual(read.json(), current)
        self.assertEqual(read["ETag"], saved["ETag"])

    def test_permanent_trash_cleanup_reserves_identity_and_preserves_other_authors_drafts(self):
        tag = self.versions()
        self.assertEqual(self.api("boards/one/purge").status_code, 409)
        deleted = self.api("boards/one", "DELETE", etag=tag)
        draft = self.api("boards/one", "PUT", sample_board("another author's retained input"), tag, client=self.editor_client, account=self.editor)
        self.assertTrue(draft.json()["draftSaved"])
        before = usage(self.shared.pk)["totalBytes"]
        preview = self.api("boards/one/purge")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()["removeRevisions"], 4)
        self.assertEqual(self.api("boards/one/purge", "POST", {"confirm": "discard_board"}).status_code, 428)
        self.assertEqual(self.api("boards/one/purge", "POST", {"confirm": "discard_history"}, preview["ETag"]).status_code, 428)
        self.assertEqual(self.api("boards/one/purge", "POST", {"confirm": "discard_board"}, deleted["ETag"]).status_code, 409)
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):
            result = self.api("boards/one/purge", "POST", {"confirm": "discard_board"}, preview["ETag"])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(before - result.json()["usage"]["totalBytes"], preview.json()["reclaimPayloadBytes"])
        document = WorkspaceDocument.objects.get()
        self.assertIsNotNone(document.purged_at)
        self.assertIsNotNone(document.deleted_at)
        self.assertEqual(document.value, {"name": "Authored board"})
        self.assertEqual(DocumentRevision.objects.count(), 0)
        self.assertEqual(ConflictDraft.objects.get().value, sample_board("another author's retained input"))
        self.assertEqual(self.api("trash").json(), [])
        self.assertEqual(self.api("boards").json(), [])
        self.assertEqual(self.api("boards/one/restore", "POST", etag=document_etag(document)).status_code, 410)
        self.assertEqual(self.api("history/board/one").status_code, 410)
        self.assertEqual(self.api("boards/one/purge").status_code, 410)
        for expected in (tag, "new", document_etag(document)):
            stale = self.api("boards/one", "PUT", sample_board("keep this in own conflict snapshot"), expected)
            self.assertEqual(stale.status_code, 409)
            self.assertEqual(stale.json()["code"], "purged")
        self.assertEqual(WorkspaceDocument.objects.get().value, {"name": "Authored board"})

    def test_purge_preview_is_invalid_after_restore_and_does_not_destroy_new_input(self):
        tag = self.create()
        deleted = self.api("boards/one", "DELETE", etag=tag)
        preview = self.api("boards/one/purge")
        restored = self.api("boards/one/restore", "POST", etag=deleted["ETag"])
        response = self.api("boards/one/purge", "POST", {"confirm": "discard_board"}, preview["ETag"])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.api("boards/one")["ETag"], restored["ETag"])
        self.assertEqual(self.api("boards/one").json(), sample_board())
        self.assertEqual(DocumentRevision.objects.count(), 3)

    def test_storage_failure_rolls_back_both_history_removal_and_purge_state(self):
        tag = self.versions()
        self.api("boards/one", "DELETE", etag=tag)
        preview = self.api("boards/one/purge")
        with patch("core.models.WorkspaceDocument.save", side_effect=OperationalError("temporary failure")):
            response = self.api("boards/one/purge", "POST", {"confirm": "discard_board"}, preview["ETag"])
        self.assertEqual(response.status_code, 503)
        self.assertEqual(DocumentRevision.objects.count(), 4)
        self.assertIsNone(WorkspaceDocument.objects.get().purged_at)
        retry = self.api("boards/one/purge", "POST", {"confirm": "discard_board"}, preview["ETag"])
        self.assertEqual(retry.status_code, 200)


class ConcurrentCleanupTests(TransactionTestCase):
    setUp = document_fixtures.ConcurrentDocumentTests.setUp

    def race(self, first, second):
        barrier = Barrier(2, timeout=10)
        def worker(operation):
            close_old_connections()
            try:
                account = Account.objects.get(pk=self.owner.pk)
                scope = WorkspaceScope(self.workspace, "owner")
                barrier.wait()
                try:
                    return operation(scope, account)
                except APIError as error:
                    return error.status
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(worker, [first, second]))

    def test_newer_device_save_survives_racing_history_cleanup(self):
        _, tag = put_document(self.scope, self.owner, "board", "one", sample_board("original"), "new")
        _, tag = put_document(self.scope, self.owner, "board", "one", sample_board("second"), tag)
        _, plan_tag = preview_cleanup(self.scope, self.owner, "board", "one", "discard_history", 1)
        def cleanup(scope, account):
            return apply_cleanup(scope, account, "board", "one", "discard_history", plan_tag, "discard_history", 1)
        def save(scope, account):
            return put_document(scope, account, "board", "one", sample_board("device's exact newest input"), tag)[0]
        results = self.race(cleanup, save)
        self.assertTrue(results[1]["saved"])
        self.assertEqual(WorkspaceDocument.objects.get().value, sample_board("device's exact newest input"))
        self.assertIn(results[0] if isinstance(results[0], int) else results[0]["cleaned"], (409, True))
        self.assertEqual(DocumentRevision.objects.order_by("-revision").first().value, sample_board("device's exact newest input"))

    def test_restore_and_explicit_purge_serialize_without_accidental_resurrection(self):
        _, tag = put_document(self.scope, self.owner, "board", "one", sample_board("original"), "new")
        _, deleted_tag = change_board_state(self.scope, self.owner, "one", tag)
        _, plan_tag = preview_cleanup(self.scope, self.owner, "board", "one", "discard_board")
        def purge(scope, account):
            return apply_cleanup(scope, account, "board", "one", "discard_board", plan_tag, "discard_board")
        def restore(scope, account):
            return change_board_state(scope, account, "one", deleted_tag, restore=True)[0]
        results = self.race(purge, restore)
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        document = WorkspaceDocument.objects.get()
        if document.purged_at:
            self.assertEqual(results[1], 410)
            self.assertEqual(DocumentRevision.objects.count(), 0)
        else:
            self.assertEqual(results[0], 409)
            self.assertIsNone(document.deleted_at)
            self.assertEqual(document.value, sample_board("original"))
