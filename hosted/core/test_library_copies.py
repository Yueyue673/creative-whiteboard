import copy
import json
from unittest.mock import patch

from django.test import Client, TestCase
from .documents import put_document
from .models import Account, Membership, WorkspaceDocument, DocumentRevision
from .scope import WorkspaceScope
from .services import create_shared_workspace, create_personal_workspace


def note(identity, origin="resource-a", **extra):
    return {"id": identity, "type": "note", "title": "同名内容", "body": "后来补写的合成内容。",
            "x": 20, "y": 30, "w": 300, "h": 200, "libraryOrigin": {"id": origin}, **extra}


class LibraryCopyQueryTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user("copy-owner@example.test", "fixture-only-password")
        self.other = Account.objects.create_user("copy-other@example.test", "fixture-only-password")
        self.space = create_shared_workspace(self.owner, "Current")
        self.foreign = create_personal_workspace(self.other)
        self.scope = WorkspaceScope(self.space, "owner")
        self.client.force_login(self.owner)
        self.url = f"/w/{self.space.pk}/api/library-copies"
        original = note("original")
        catalog = {"version": 1, "folders": [], "folderIds": {}, "assets": [
            {"id": "resource-a", "title": "同名资源", "mime": "application/x-creative-bundle",
             "path": "", "folder": "", "notes": "", "size": 0, "tags": [],
             "bundle": {"nodes": [original], "edges": []}},
            {"id": "resource-b", "title": "同名资源", "mime": "application/x-creative-bundle",
             "path": "", "folder": "", "notes": "", "size": 0, "tags": [],
             "bundle": {"nodes": [original], "edges": []}}]}
        put_document(self.scope, self.owner, "library", "catalog", catalog, "new")
        self.board("one", [note("renamed", title="已经改名")])
        self.board("nested", [{"id": "table", "type": "table", "title": "合成表格", "x": 0, "y": 0,
                              "w": 500, "h": 350, "columns": ["列"], "rows": [["原格"]],
                              "cellItems": [[[note("inside")]]]}])
        self.board("other", [note("wrong", "resource-b")])

    def board(self, key, nodes, scope=None, owner=None):
        value = {"format": "creative-board", "version": 1, "name": "同名白板",
                 "nodes": nodes, "edges": [], "view": {"x": 0, "y": 0, "z": 1}}
        put_document(scope or self.scope, owner or self.owner, "board", key, value, "new")

    def get(self, identity="resource-a", url=None, account=None):
        return self.client.get(url or self.url, {"id": identity}, secure=True,
                               HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk if account is None else account))

    def test_identity_nested_targets_and_document_history_are_readonly(self):
        before = list(WorkspaceDocument.objects.order_by("pk").values())
        history = list(DocumentRevision.objects.order_by("pk").values())
        response = self.get()
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual({(x["boardId"], x["rootId"], x["nodeId"]) for x in data["items"]},
                         {("one", "renamed", "renamed"), ("nested", "table", "inside")})
        self.assertEqual(data["workspace"], str(self.space.pk))
        self.assertEqual(data["account"], self.owner.pk)
        self.assertEqual(data["coverage"], "currentSupportedCopies")
        self.assertEqual(before, list(WorkspaceDocument.objects.order_by("pk").values()))
        self.assertEqual(history, list(DocumentRevision.objects.order_by("pk").values()))

    def test_foreign_workspace_trash_and_same_name_are_excluded(self):
        foreign_scope = WorkspaceScope(self.foreign, "owner")
        self.board("foreign", [note("foreign-copy")], foreign_scope, self.other)
        WorkspaceDocument.objects.filter(workspace=self.space, key="one").update(deleted_at="2026-01-01T00:00:00Z")
        data = self.get().json()
        self.assertEqual({x["boardId"] for x in data["items"]}, {"nested"})
        self.assertEqual(self.get(url=f"/w/{self.foreign.pk}/api/library-copies").status_code, 404)
        self.assertEqual(self.get("unknown").status_code, 404)

    def test_original_account_membership_and_reader_role_are_enforced(self):
        self.assertEqual(Client().get(self.url, {"id": "resource-a"}, secure=True).status_code, 401)
        self.assertEqual(self.client.get(self.url, {"id": "resource-a"}, secure=True).status_code, 428)
        self.assertEqual(self.get(account=self.other.pk).status_code, 409)
        Membership.objects.create(workspace=self.space, account=self.other, role="viewer")
        self.client.force_login(self.other)
        self.assertEqual(self.get(account=self.other.pk).status_code, 200)
        Membership.objects.filter(workspace=self.space, account=self.other).delete()
        self.assertEqual(self.get(account=self.other.pk).status_code, 404)

    def test_bad_query_methods_and_budget_limits_do_not_claim_full_coverage(self):
        headers = {"HTTP_X_CREATIVE_ACCOUNT": str(self.owner.pk)}
        for suffix in ["", "?id=resource-a&id=resource-b", "?id=../a", "?id=resource-a&path=x"]:
            self.assertEqual(self.client.get(self.url + suffix, secure=True, **headers).status_code, 400)
        self.assertEqual(self.client.post(self.url, data="{}", content_type="application/json", secure=True, **headers).status_code, 405)
        with patch("core.library_copies.MAX_RECORDS", 1):
            self.assertEqual(self.get().json()["coverage"], "limited")
        with patch("core.library_copies.MAX_BYTES", 1):
            self.assertEqual(self.get().status_code, 413)
        with patch("library_usage.MAX_PARTS", 0):
            self.assertEqual(self.get().status_code, 413)

    def test_result_limit_and_membership_change_during_read(self):
        self.board("many", [note("copy-" + str(i)) for i in range(45)])
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["items"]), 40)
        self.assertEqual(response.json()["coverage"], "limited")
        from library_usage import board_copies
        def revoked(*args, **kwargs):
            Membership.objects.filter(workspace=self.space, account=self.owner).delete()
            return board_copies(*args, **kwargs)
        with patch("core.library_copies.board_copies", revoked):
            self.assertEqual(self.get().status_code, 404)

