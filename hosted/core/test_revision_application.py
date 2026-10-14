import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings

from .cleanup import apply_cleanup, preview_cleanup
from .documents import document_etag, put_document, usage
from .models import Account, ConflictDraft, DocumentRevision, Membership, WorkspaceDocument
from .revision_application import apply_application, preview_application
from .scope import WorkspaceScope
from .services import APIError, create_shared_workspace
from . import test_documents as fixtures
sample_board = fixtures.sample_board


class RevisionApplicationTests(TestCase):
    setUp = fixtures.DocumentAPITests.setUp
    url = fixtures.DocumentAPITests.url
    api = fixtures.DocumentAPITests.api
    create = fixtures.DocumentAPITests.create

    def versions(self, key="one"):
        first = sample_board("自己的第一份原文\n保留 **格式** 😀")
        first["opaque"] = {"kept": [17, "原样"]}
        first["nodes"][0]["custom"] = {"color": "#aabbcc"}
        tag = self.create(key, first)
        source = WorkspaceDocument.objects.get(workspace=self.shared, key=key).revision_token
        newer = copy.deepcopy(first)
        newer["nodes"][0]["body"] = "后来保存的新原文。"
        response = self.api("boards/" + key, "PUT", newer, tag)
        self.assertEqual(response.status_code, 200)
        return first, newer, source, response["ETag"]

    def path(self, source, key="one"):
        return f"history/board/{key}/{source}/apply"

    def confirm(self, source, plan, **kwargs):
        return self.api(self.path(source), "POST", {"confirm": "apply_retained_version"}, plan["ETag"], **kwargs)

    def test_review_is_read_only_and_apply_preserves_every_retained_payload_and_private_input(self):
        first, newer, source, tag = self.versions()
        self.api("boards/one", "PUT", sample_board("另一人的未合入输入"), "new", client=self.editor_client, account=self.editor)
        document = WorkspaceDocument.objects.get(workspace=self.shared, key="one")
        original_rows = list(document.versions.values_list("pk", "value", "deleted"))
        own_input = ConflictDraft.objects.get().value
        plan = self.api(self.path(source))
        self.assertEqual(plan.status_code, 200)
        self.assertTrue(plan.json()["canApply"])
        self.assertTrue(plan.json()["retainedVersionsPreserved"])
        self.assertNotIn("value", plan.json())
        self.assertEqual(self.api("boards/one").json(), newer)
        result = self.confirm(source, plan)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(result.json()["sourceId"], str(source))
        self.assertEqual(result.json()["revision"], 3)
        self.assertNotEqual(result["ETag"], tag)
        self.assertEqual(self.api("boards/one").json(), first)
        for pk, value, deleted in original_rows:
            self.assertEqual(DocumentRevision.objects.get(pk=pk).value, value)
            self.assertEqual(DocumentRevision.objects.get(pk=pk).deleted, deleted)
        self.assertEqual(document.versions.count(), 3)
        self.assertEqual(ConflictDraft.objects.get().value, own_input)

    def test_no_confirmation_or_precondition_and_repeated_old_plan_do_not_write(self):
        first, newer, source, tag = self.versions()
        plan = self.api(self.path(source))
        for payload, expected, status in [({}, plan["ETag"], 400), ({"confirm": "wrong"}, plan["ETag"], 428), ({"confirm": "apply_retained_version"}, None, 428)]:
            reply = self.api(self.path(source), "POST", payload, expected)
            self.assertEqual(reply.status_code, status)
            self.assertEqual(self.api("boards/one")["ETag"], tag)
        self.assertEqual(self.confirm(source, plan).status_code, 200)
        self.assertEqual(self.confirm(source, plan).status_code, 409)
        self.assertEqual(DocumentRevision.objects.count(), 3)

    def test_a_new_current_save_invalidates_the_older_confirmation(self):
        first, newer, source, tag = self.versions()
        plan = self.api(self.path(source))
        latest = sample_board("刚刚另一设备写下的原文。")
        response = self.api("boards/one", "PUT", latest, tag)
        self.assertEqual(self.confirm(source, plan).status_code, 409)
        self.assertEqual(self.api("boards/one").json(), latest)
        self.assertEqual(ConflictDraft.objects.count(), 0)

    def test_quota_and_full_history_block_without_implicit_trim(self):
        first, newer, source, tag = self.versions()
        before = usage(self.shared.pk)["totalBytes"]
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=before, HOSTED_HISTORY_LIMIT=40):
            plan = self.api(self.path(source))
            self.assertFalse(plan.json()["canApply"])
            self.assertEqual(self.confirm(source, plan).status_code, 413)
        with override_settings(HOSTED_HISTORY_LIMIT=2):
            plan = self.api(self.path(source))
            self.assertFalse(plan.json()["canApply"])
            self.assertIn("不会自动删除", plan.json()["blockedReason"])
            self.assertEqual(self.confirm(source, plan).status_code, 413)
        self.assertEqual(self.api("boards/one")["ETag"], tag)
        self.assertEqual(DocumentRevision.objects.count(), 2)

    def test_scope_role_original_identity_and_downgrade_are_checked_again(self):
        first, newer, source, tag = self.versions()
        self.create("other")
        self.assertEqual(self.api(self.path(source, "other")).status_code, 404)
        self.assertEqual(self.api(self.path(source), workspace=self.other_personal).status_code, 404)
        self.assertEqual(self.api(self.path(source), identity=False).status_code, 428)
        plan = self.api(self.path(source), client=self.editor_client, account=self.editor)
        self.assertEqual(plan.status_code, 200)
        Membership.objects.filter(workspace=self.shared, account=self.editor).update(role="viewer")
        self.assertEqual(self.confirm(source, plan, client=self.editor_client, account=self.editor).status_code, 403)
        self.assertEqual(self.api(self.path(source), client=self.editor_client, account=self.editor).status_code, 403)
        self.assertEqual(self.api("boards/one")["ETag"], tag)

    def test_deleted_purged_missing_or_changed_retained_source_is_never_recreated(self):
        first, newer, source, tag = self.versions()
        plan = self.api(self.path(source))
        row = DocumentRevision.objects.get(pk=source)
        altered = copy.deepcopy(row.value);altered["nodes"][0]["body"] = "另一个原文"
        from .json_data import document_bytes
        row.value = altered;row.byte_size = len(document_bytes(altered));row.save()
        self.assertEqual(self.confirm(source, plan).status_code, 409)
        row.delete()
        self.assertEqual(self.confirm(source, plan).status_code, 404)
        doc = WorkspaceDocument.objects.get(workspace=self.shared, key="one")
        current_source = doc.revision_token
        self.api("boards/one", "DELETE", etag=tag)
        self.assertEqual(self.api(self.path(current_source)).status_code, 409)
        doc.refresh_from_db();doc.purged_at = doc.deleted_at;doc.save()
        self.assertEqual(self.api(self.path(current_source)).status_code, 410)

    def test_noop_latest_payload_creates_no_new_version_even_at_limits(self):
        first, newer, source, tag = self.versions()
        current = WorkspaceDocument.objects.get(workspace=self.shared, key="one")
        with override_settings(HOSTED_HISTORY_LIMIT=2, HOSTED_MAX_WORKSPACE_BYTES=1):
            plan = self.api(self.path(current.revision_token))
            self.assertFalse(plan.json()["changed"])
            self.assertTrue(plan.json()["canApply"])
            reply = self.confirm(current.revision_token, plan)
            self.assertTrue(reply.json()["unchanged"])
            self.assertEqual(reply["ETag"], tag)
        self.assertEqual(DocumentRevision.objects.count(), 2)

    def test_a_capacity_change_inside_commit_rolls_back_document_and_new_history(self):
        first, newer, source, tag = self.versions()
        plan = self.api(self.path(source))
        with patch('core.revision_application.check_quota', side_effect=APIError("测试容量变化", 413)):
            reply = self.confirm(source, plan)
        self.assertEqual(reply.status_code, 413)
        self.assertEqual(self.api("boards/one").json(), newer)
        self.assertEqual(self.api("boards/one")["ETag"], tag)
        self.assertEqual(DocumentRevision.objects.count(), 2)

    def test_history_cleanup_requires_new_review(self):
        first, newer, source, tag = self.versions()
        plan = self.api(self.path(source))
        scope = WorkspaceScope(self.shared, "owner")
        clean, clean_tag = preview_cleanup(scope, self.owner, "board", "one", "discard_history", 1)
        apply_cleanup(scope, self.owner, "board", "one", "discard_history", clean_tag, "discard_history", 1)
        self.assertEqual(self.confirm(source, plan).status_code, 404)
        self.assertEqual(self.api("boards/one")["ETag"], tag)

    def test_removed_original_folder_is_not_silently_dropped_or_retargeted(self):
        folders = {"folders": [{"id": "original-folder", "name": "原分类", "parent": ""}]}
        folder_tag = self.api("folders", "PUT", folders, "new")["ETag"]
        first = sample_board("原分类里的原文", "original-folder")
        tag = self.create(value=first)
        source = WorkspaceDocument.objects.get(workspace=self.shared, key="one").revision_token
        newer = sample_board("后来已经移出分类的原文")
        tag = self.api("boards/one", "PUT", newer, tag)["ETag"]
        self.assertEqual(self.api("folders", "PUT", {"folders": []}, folder_tag).status_code, 200)
        plan = self.api(self.path(source))
        self.assertFalse(plan.json()["canApply"])
        self.assertIn("分类", plan.json()["blockedReason"])
        self.assertEqual(self.confirm(source, plan).status_code, 413)
        self.assertEqual(self.api("boards/one").json(), newer)
        self.assertEqual(self.api("boards/one")["ETag"], tag)


class ConcurrentRevisionApplicationTests(TransactionTestCase):
    def test_two_confirmations_of_one_plan_create_exactly_one_new_version(self):
        owner = Account.objects.create_user("owner@example.test", "synthetic-only")
        workspace = create_shared_workspace(owner, "Synthetic concurrent history")
        scope = WorkspaceScope(workspace, "owner")
        first = sample_board("原始版本")
        _, tag = put_document(scope, owner, "board", "one", first, "new")
        source = WorkspaceDocument.objects.get(workspace=workspace, key="one").revision_token
        put_document(scope, owner, "board", "one", sample_board("后来版本"), tag)
        _, plan_tag = preview_application(scope, owner, "one", source)
        gate = Barrier(2)
        def attempt():
            close_old_connections()
            try:
                gate.wait(timeout=5)
                try:
                    apply_application(scope, owner, "one", source, plan_tag, "apply_retained_version")
                    return 200
                except APIError as error:
                    return error.status
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(sorted(outcomes), [200, 409])
        self.assertEqual(WorkspaceDocument.objects.get(workspace=workspace, key="one").value, first)
        self.assertEqual(DocumentRevision.objects.count(), 3)
        self.assertEqual(ConflictDraft.objects.count(), 0)
