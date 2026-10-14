import copy
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import OperationalError, close_old_connections, connection
from django.test import Client, TestCase, TransactionTestCase, override_settings

from .documents import document_etag, put_document, usage
from .json_data import document_bytes
from .models import Account, ConflictDraft, DocumentRevision, Membership, WorkspaceDocument
from .scope import WorkspaceScope
from .services import APIError, change_member, create_personal_workspace, create_shared_workspace


def sample_board(text="作者自己的原文 **格式**\n第二行 😀", folder=""):
    return {
        "format": "creative-board", "version": 1, "name": "Authored board", "folder": folder,
        "nodes": [{"id": "note", "type": "note", "x": 12, "y": -34, "w": 320, "h": 180,
                   "title": "Own title", "body": text, "textFormat": "markdown", "paperStyle": "lined", "sizeMode": "manual"}],
        "edges": [], "view": {"x": 80, "y": 80, "z": 1},
    }


class DocumentAPITests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user("owner@example.test", "not-a-real-account-password", display_name="Owner")
        self.editor = Account.objects.create_user("editor@example.test", "not-a-real-account-password", display_name="Editor")
        self.other = Account.objects.create_user("other@example.test", "not-a-real-account-password", display_name="Other")
        self.shared = create_shared_workspace(self.owner, "Shared")
        self.personal = create_personal_workspace(self.owner)
        self.other_personal = create_personal_workspace(self.other)
        Membership.objects.create(workspace=self.shared, account=self.editor, role="editor")
        self.client.force_login(self.owner)
        self.editor_client = Client()
        self.editor_client.force_login(self.editor)

    def url(self, suffix, workspace=None):
        return f"/w/{(workspace or self.shared).pk}/api/{suffix}"

    def api(self, suffix, method="GET", value=None, etag=None, client=None, account=None, workspace=None, identity=True):
        headers = {}
        if identity:
            headers["HTTP_X_CREATIVE_ACCOUNT"] = str((account or self.owner).pk)
        if etag is not None:
            headers["HTTP_IF_MATCH"] = etag
        return getattr(client or self.client, method.lower())(
            self.url(suffix, workspace), data=json.dumps(value, ensure_ascii=False) if value is not None else None,
            content_type="application/json", **headers,
        )

    def create(self, key="one", value=None, workspace=None):
        response = self.api("boards/" + key, "PUT", value or sample_board(), "new", workspace=workspace)
        self.assertEqual(response.status_code, 200, response.content)
        return response["ETag"]

    def test_actual_board_roundtrip_preserves_authored_text_formats_layout_and_database_bytes(self):
        value = sample_board()
        value["nodes"] += [{"id": "table", "type": "table", "x": -8, "y": 240, "w": 300, "h": 100,
                            "columns": ["Column"], "rows": [["own cell"]], "rowIds": ["row"], "columnIds": ["column"]}]
        value["edges"] = [{"id": "edge", "from": "note", "to": "table", "label": "my relation"}]
        etag = self.create(value=value)
        read = self.api("boards/one")
        self.assertEqual(read.json(), value)
        self.assertEqual(read["ETag"], etag)
        row = WorkspaceDocument.objects.get()
        with connection.cursor() as cursor:
            cursor.execute("SELECT value FROM core_workspacedocument WHERE id = %s", [row.pk])
            stored = cursor.fetchone()[0].encode("utf-8")
        self.assertEqual(stored, document_bytes(value))
        self.assertEqual(row.byte_size, len(stored))
        self.assertNotIn("server", sys.modules)
        self.assertNotIn("assets", sys.modules)
        self.assertNotIn("workflow_backend", sys.modules)

    def test_same_key_in_different_workspaces_has_independent_data_and_versions(self):
        shared_tag = self.create(value=sample_board("shared"))
        private_tag = self.create(value=sample_board("private"), workspace=self.personal)
        self.assertNotEqual(shared_tag, private_tag)
        self.client.cookies["current_workspace"] = str(self.personal.pk)
        self.assertEqual(self.api("boards/one").json()["nodes"][0]["body"], "shared")
        self.assertEqual(self.api("boards/one", workspace=self.personal).json()["nodes"][0]["body"], "private")
        cross_tag = self.api("boards/one", "PUT", sample_board("attempt"), private_tag)
        self.assertEqual(cross_tag.status_code, 409)
        self.assertTrue(cross_tag.json()["draftSaved"])
        self.assertEqual(self.api("boards/one").json()["nodes"][0]["body"], "shared")
        self.assertEqual(self.api("boards/one", workspace=self.personal).json()["nodes"][0]["body"], "private")

    def test_url_membership_not_request_body_determines_ownership(self):
        value = sample_board()
        value["workspaceId"] = str(self.other_personal.pk)
        self.create(value=value)
        self.assertEqual(WorkspaceDocument.objects.get().workspace_id, self.shared.pk)
        for suffix in ("boards", "boards/one", "history/board/one", "assets", "folders", "conflicts", "quota", "trash"):
            self.assertEqual(self.api(suffix, workspace=self.other_personal).status_code, 404, suffix)
            self.assertEqual(self.api(suffix, client=Client()).status_code, 401, suffix)

    def test_old_page_cannot_read_or_save_after_account_changes_even_if_both_are_members(self):
        etag = self.create()
        self.assertEqual(self.api("boards/one", identity=False).status_code, 428)
        old = self.api("boards/one", "PUT", sample_board("old owner's input"), etag, client=self.editor_client, account=self.owner)
        self.assertEqual(old.status_code, 409)
        self.assertEqual(old.json()["code"], "account_changed")
        self.assertTrue(old.json()["preserveDraft"])
        self.assertEqual(self.api("boards/one", client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.api("boards/one", client=self.editor_client, account=self.editor).status_code, 200)
        self.assertEqual(WorkspaceDocument.objects.get().revision, 1)
        self.assertEqual(ConflictDraft.objects.count(), 0)

    def test_precondition_is_required_and_noop_does_not_create_revisions(self):
        self.assertEqual(self.api("boards/one", "PUT", sample_board()).status_code, 428)
        self.assertEqual(self.api("boards/one", "PUT", sample_board(), 'W/"bad"').status_code, 400)
        self.assertEqual(WorkspaceDocument.objects.count(), 0)
        etag = self.create()
        response = self.api("boards/one", "PUT", sample_board(), etag)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["unchanged"])
        self.assertEqual(response["ETag"], etag)
        self.assertEqual(DocumentRevision.objects.count(), 1)

    def test_stale_save_preserves_both_inputs_without_overwrite_or_automatic_merge(self):
        first_tag = self.create(value=sample_board("first"))
        winner = self.api("boards/one", "PUT", sample_board("newer writer"), first_tag)
        own_input = sample_board("other device's unchanged original input")
        loser = self.api("boards/one", "PUT", own_input, first_tag, client=self.editor_client, account=self.editor)
        self.assertEqual(loser.status_code, 409)
        self.assertTrue(loser.json()["draftSaved"])
        self.assertEqual(loser.json()["currentETag"], winner["ETag"])
        draft_id = loser.json()["draftId"]
        self.assertEqual(self.api("boards/one").json(), sample_board("newer writer"))
        self.assertEqual(self.api("conflicts/" + draft_id, client=self.editor_client, account=self.editor).json()["value"], own_input)
        retried = self.api("boards/one", "PUT", own_input, first_tag, client=self.editor_client, account=self.editor)
        self.assertEqual(retried.json()["draftId"], draft_id)
        self.assertEqual(ConflictDraft.objects.count(), 1)
        self.assertEqual(DocumentRevision.objects.count(), 2)

    def test_conflict_inputs_are_private_to_the_author_not_visible_to_the_workspace_owner(self):
        old_tag = self.create()
        self.api("boards/one", "PUT", sample_board("newer"), old_tag)
        draft = self.api("boards/one", "PUT", sample_board("editor's private unsaved input"), old_tag, client=self.editor_client, account=self.editor).json()
        self.assertEqual(self.api("conflicts").json(), [])
        self.assertEqual(self.api("conflicts/" + draft["draftId"]).status_code, 404)
        self.assertEqual(self.api("conflicts/" + draft["draftId"], "DELETE").status_code, 404)
        self.assertEqual(self.api("conflicts/" + draft["draftId"], client=self.editor_client, account=self.editor, workspace=self.personal).status_code, 404)
        removed = self.api("conflicts/" + draft["draftId"], "DELETE", client=self.editor_client, account=self.editor)
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json(), {"removed": True, "id": draft["draftId"]})
        self.assertEqual(ConflictDraft.objects.count(), 0)

    def test_history_is_immutable_and_scoped_to_both_workspace_and_document(self):
        old_value = sample_board("first line \n keep me")
        first_tag = self.create(value=old_value)
        self.api("boards/one", "PUT", sample_board("second"), first_tag)
        self.create("two", sample_board("other document"))
        rows = self.api("history/board/one").json()
        self.assertEqual([row["revision"] for row in rows], [2, 1])
        self.assertEqual(self.api("history/boards/one").json(), rows)
        old_id = rows[-1]["id"]
        historical = self.api("history/board/one/" + old_id).json()
        self.assertEqual(historical["value"], old_value)
        self.assertEqual(self.api("history/board/two/" + old_id).status_code, 404)
        self.assertEqual(self.api("history/board/one/" + old_id, workspace=self.personal).status_code, 404)
        self.assertEqual(self.api("history/board/one/" + old_id, "PUT", old_value, first_tag).status_code, 405)

    def test_board_delete_restore_requires_fresh_version_and_stale_saves_cannot_resurrect(self):
        initial = sample_board("keep original")
        tag = self.create(value=initial)
        self.assertEqual(self.api("boards/one", "DELETE").status_code, 428)
        deleted = self.api("boards/one", "DELETE", etag=tag)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.api("boards/one").status_code, 404)
        self.assertEqual(self.api("boards").json(), [])
        trash = self.api("trash").json()
        self.assertEqual(trash[0]["etag"], deleted["ETag"])
        stale = self.api("boards/one", "PUT", sample_board("late input"), tag)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "deleted")
        self.assertEqual(self.api("boards/one", "PUT", sample_board("new cannot reuse a deleted id"), "new").status_code, 409)
        self.assertEqual(self.api("boards/one/restore", "POST", etag=tag).status_code, 409)
        restored = self.api("boards/one/restore", "POST", etag=deleted["ETag"])
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(self.api("boards/one").json(), initial)
        self.assertEqual(self.api("trash").json(), [])
        self.assertEqual(self.api("boards/one", "DELETE", etag=deleted["ETag"]).status_code, 409)

    def test_readonly_and_revoked_members_cannot_write_or_access_history_and_drafts(self):
        tag = self.create()
        Membership.objects.filter(workspace=self.shared, account=self.editor).update(role="viewer")
        read = self.api("boards/one", client=self.editor_client, account=self.editor)
        self.assertEqual(read.status_code, 200)
        for suffix, method, value in [("boards/one", "PUT", sample_board()), ("boards/one", "DELETE", None), ("folders", "PUT", {"folders": []}), ("assets", "PUT", {"version": 1, "folders": [], "assets": []})]:
            self.assertEqual(self.api(suffix, method, value, tag, client=self.editor_client, account=self.editor).status_code, 403)
        Membership.objects.filter(workspace=self.shared, account=self.editor).delete()
        self.assertEqual(self.api("history/board/one", client=self.editor_client, account=self.editor).status_code, 404)
        self.assertEqual(self.api("boards/one", client=self.editor_client, account=self.editor).status_code, 404)
        self.assertEqual(WorkspaceDocument.objects.get().revision, 1)

    def test_role_is_checked_again_if_it_changes_after_request_authorization(self):
        tag = self.create()
        original = put_document
        def after_authorization(scope, account, *args):
            change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
            return original(scope, account, *args)
        with patch("core.document_views.put_document", after_authorization):
            response = self.api("boards/one", "PUT", sample_board("blocked late write"), tag, client=self.editor_client, account=self.editor)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(WorkspaceDocument.objects.get().revision, 1)
        self.assertEqual(ConflictDraft.objects.count(), 0)

    def test_folder_catalog_and_board_references_cannot_silently_destroy_each_other(self):
        self.assertEqual(self.api("folders")["ETag"], "new")
        folders = {"folders": [{"id": "parent", "name": "Parent", "parent": ""}, {"id": "child", "name": "Child", "parent": "parent"}]}
        saved = self.api("folders", "PUT", folders, "new")
        self.assertEqual(saved.status_code, 200)
        self.create(value=sample_board("inside", "child"))
        removal = self.api("folders", "PUT", {"folders": []}, saved["ETag"])
        self.assertEqual(removal.status_code, 409)
        self.assertEqual(removal.json()["code"], "folder_in_use")
        self.assertTrue(removal.json()["draftSaved"])
        self.assertEqual(self.api("folders").json(), folders)
        unknown = self.api("boards/two", "PUT", sample_board("in a missing folder", "absent"), "new")
        self.assertEqual(unknown.status_code, 409)
        self.assertTrue(unknown.json()["draftSaved"])
        self.assertIsNone(WorkspaceDocument.objects.filter(kind="board", key="two").first())
        cycle = copy.deepcopy(folders)
        cycle["folders"][0]["parent"] = "child"
        self.assertEqual(self.api("folders", "PUT", cycle, saved["ETag"]).status_code, 400)

    def test_library_folder_id_survives_rename_and_unsafe_file_references_are_not_accepted(self):
        initial = {"version": 1, "folders": ["Root/Child"], "assets": []}
        first = self.api("assets", "PUT", initial, "new")
        self.assertEqual(first.status_code, 200)
        current = self.api("assets").json()
        identity = current["folderIds"]["Root/Child"]
        renamed = {"version": 1, "folders": ["Root/Renamed"], "folderIds": {"Root/Renamed": identity}, "assets": []}
        second = self.api("assets", "PUT", renamed, first["ETag"])
        self.assertEqual(second.status_code, 200)
        self.assertEqual(self.api("assets").json()["folderIds"]["Root/Renamed"], identity)
        for path in ("../outside", "/absolute", "Root/../escape", "C:\\private"):
            invalid = {"version": 1, "folders": [path], "assets": []}
            self.assertEqual(self.api("assets", "PUT", invalid, second["ETag"]).status_code, 400)
        files = {"version": 1, "folders": [], "assets": [{"id": "foreign", "path": "/etc/passwd"}]}
        self.assertEqual(self.api("assets", "PUT", files, second["ETag"]).status_code, 501)
        self.assertEqual(self.api("media/foreign").status_code, 501)
        self.assertEqual(self.api("assets").json()["assets"], [])

    def test_invalid_documents_do_not_change_data_history_or_conflicts(self):
        tag = self.create()
        for key, bad in [("nodes", "wrong"), ("edges", ["not an edge"]), ("version", True), ("folder", None)]:
            value = sample_board()
            value[key] = bad
            self.assertEqual(self.api("boards/one", "PUT", value, tag).status_code, 400, key)
        for key, bad in [("x", True), ("w", -1), ("x", float("inf")), ("paperStyle", "unsupported")]:
            value = sample_board()
            value["nodes"][0][key] = bad
            self.assertEqual(self.api("boards/one", "PUT", value, tag).status_code, 400, key)
        deep = []
        for _ in range(66):
            deep = [deep]
        value = sample_board()
        value["extra"] = deep
        self.assertEqual(self.api("boards/one", "PUT", value, tag).status_code, 400)
        self.assertEqual(WorkspaceDocument.objects.get().revision, 1)
        self.assertEqual(DocumentRevision.objects.count(), 1)
        self.assertEqual(ConflictDraft.objects.count(), 0)

    def test_request_and_document_limits_are_enforced_without_partial_writes(self):
        with override_settings(HOSTED_MAX_DOCUMENT_BYTES=100):
            self.assertEqual(self.api("boards/one", "PUT", sample_board(), "new").status_code, 413)
        self.assertEqual(WorkspaceDocument.objects.count(), 0)
        self.create()
        with override_settings(HOSTED_MAX_DOCUMENTS=1):
            self.assertEqual(self.api("boards/two", "PUT", sample_board(), "new").status_code, 413)
        self.assertEqual(WorkspaceDocument.objects.count(), 1)

    def test_workspace_quota_failure_rolls_back_new_content_and_history_pruning(self):
        original = sample_board("original")
        tag = self.create(value=original)
        revision_id = DocumentRevision.objects.get().pk
        total = usage(self.shared.pk)["totalBytes"]
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=total, HOSTED_HISTORY_LIMIT=1):
            response = self.api("boards/one", "PUT", sample_board("larger new words " * 100), tag)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.api("boards/one").json(), original)
        self.assertEqual(self.api("boards/one")["ETag"], tag)
        self.assertEqual(DocumentRevision.objects.get().pk, revision_id)

    def test_conflict_quota_never_falsely_claims_that_rejected_input_was_saved(self):
        old_tag = self.create()
        self.api("boards/one", "PUT", sample_board("newer"), old_tag)
        limit = usage(self.shared.pk)["totalBytes"]
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=limit):
            response = self.api("boards/one", "PUT", sample_board("retained in the caller"), old_tag)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.json()["draftSaved"])
        self.assertIsNone(response.json()["draftId"])
        self.assertEqual(ConflictDraft.objects.count(), 0)
        with override_settings(HOSTED_MAX_CONFLICT_DRAFTS_PER_ACCOUNT=0):
            response = self.api("boards/one", "PUT", sample_board("also retained"), old_tag)
        self.assertFalse(response.json()["draftSaved"])

    @override_settings(HOSTED_HISTORY_LIMIT=3)
    def test_retained_history_is_bounded_and_latest_original_words_are_retrievable(self):
        etag = self.create(value=sample_board("0"))
        for number in range(1, 5):
            response = self.api("boards/one", "PUT", sample_board(str(number)), etag)
            self.assertEqual(response.status_code, 200)
            etag = response["ETag"]
        history = self.api("history/board/one").json()
        self.assertEqual([row["revision"] for row in history], [5, 4, 3])
        self.assertEqual(DocumentRevision.objects.count(), 3)
        for number, row in zip(["4", "3", "2"], history):
            self.assertEqual(self.api("history/board/one/" + row["id"]).json()["value"]["nodes"][0]["body"], number)

    def test_database_failure_leaves_no_partial_document_and_retry_is_possible(self):
        with patch("core.documents.DocumentRevision.objects.create", side_effect=OperationalError("simulated unavailable storage")):
            response = self.api("boards/one", "PUT", sample_board(), "new")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(WorkspaceDocument.objects.count(), 0)
        self.assertEqual(DocumentRevision.objects.count(), 0)
        self.create()


class ConcurrentDocumentTests(TransactionTestCase):
    def setUp(self):
        self.owner = Account.objects.create_user("owner@example.test", "not-a-real-account-password", display_name="Owner")
        self.workspace = create_shared_workspace(self.owner, "Shared")
        self.scope = WorkspaceScope(self.workspace, "owner")

    def simultaneous(self, expected):
        barrier = Barrier(2, timeout=10)
        def worker(text):
            close_old_connections()
            try:
                account = Account.objects.get(pk=self.owner.pk)
                scope = WorkspaceScope(self.workspace, "owner")
                barrier.wait()
                return text, put_document(scope, account, "board", "same", sample_board(text), expected)[0]
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(worker, ["Device A's exact input", "Device B's exact input"]))

    def verify_both_retained(self, results):
        self.assertEqual(sum(result["saved"] for _, result in results), 1)
        winner = next(text for text, result in results if result["saved"])
        loser = next(text for text, result in results if not result["saved"])
        document = WorkspaceDocument.objects.get()
        draft = ConflictDraft.objects.get()
        self.assertEqual(document.value, sample_board(winner))
        self.assertEqual(draft.value, sample_board(loser))
        self.assertEqual(next(result for _, result in results if not result["saved"])["draftId"], str(draft.pk))

    def test_simultaneous_new_document_creation_keeps_winner_and_exact_losing_input(self):
        self.verify_both_retained(self.simultaneous("new"))
        self.assertEqual(DocumentRevision.objects.count(), 1)

    def test_simultaneous_same_version_edits_keep_both_without_merging(self):
        _, etag = put_document(self.scope, self.owner, "board", "same", sample_board("initial"), "new")
        self.verify_both_retained(self.simultaneous(etag))
        self.assertEqual(DocumentRevision.objects.count(), 2)
