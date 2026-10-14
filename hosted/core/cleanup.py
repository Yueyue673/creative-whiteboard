"""Owner-reviewed quota cleanup; preserve current content and private inputs."""
import hashlib
import uuid

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .documents import document_etag, find_document, require_current_editor, require_precondition, usage
from .json_data import document_bytes
from .models import DocumentRevision
from .services import APIError, locked_workspace


def require_cleanup_owner(workspace, account):
    require_current_editor(workspace, account)
    if workspace.owner_id != account.pk:
        raise APIError("只有工作区所有者可以永久清理历史或回收站", 403)


def keep_count(value):
    if type(value) is not int or not 1 <= value <= settings.HOSTED_HISTORY_LIMIT:
        raise APIError("保留版本数必须是允许范围内的整数，至少保留最新一版")
    return value


def cleanup_document(workspace_id, kind, key):
    document = find_document(workspace_id, kind, key, include_deleted=True)
    if document is None:
        raise APIError("内容不存在", 404)
    if document.purged_at:
        raise APIError("这张白板已经被永久移除", 410)
    return document


def build_plan(document, action, keep=None):
    versions = list(document.versions.order_by("-revision"))
    if not versions or versions[0].pk != document.revision_token:
        raise APIError("最新版本记录不完整，未执行清理", 409)
    if action == "discard_history":
        keep = keep_count(keep)
        removed = versions[keep:]
        retained_bytes = document.byte_size
        message = "永久移除较早的历史版本；当前内容和保留的版本不变，其他人的未应用输入不受影响。"
    elif action == "discard_board":
        if document.kind != "board" or not document.deleted_at:
            raise APIError("只有回收站中的白板可以永久移除", 409)
        removed = versions
        # Keep the identity reserved, so delayed saves and reused 'new' IDs can
        # never resurrect a permanently removed board. The title labels it only.
        retained_bytes = len(document_bytes({"name": document.value["name"]}))
        message = "永久移除这张回收站白板及其历史，无法再恢复；编号保留，其他人的未应用输入不受影响。"
    else:
        raise APIError("清理方式无效")
    material = {
        "workspace": str(document.workspace_id), "kind": document.kind, "key": document.key,
        "action": action, "keep": keep, "etag": document_etag(document),
        "versions": [[str(row.pk), row.revision, row.byte_size] for row in versions],
    }
    tag = '"' + hashlib.sha256(document_bytes(material)).hexdigest() + '"'
    reclaimed = sum(row.byte_size for row in removed) + document.byte_size - retained_bytes
    def version_info(row):
        return {"id": str(row.pk), "revision": row.revision,
                "savedAt": row.created_at.timestamp(), "name": row.value.get("name", ""),
                "deleted": row.deleted, "payloadBytes": row.byte_size}
    removed_ids = {row.pk for row in removed}
    public = {
        "action": action, "workspace": str(document.workspace_id), "kind": document.kind, "key": document.key,
        "name": document.value.get("name", ""), "documentETag": document_etag(document),
        "removeRevisions": len(removed), "keepRevisions": len(versions) - len(removed),
        "reclaimPayloadBytes": reclaimed, "irreversible": True,
        "privateInputsPreserved": True, "warning": message,
        "removeVersions": [version_info(row) for row in removed],
        "retainVersions": [version_info(row) for row in versions if row.pk not in removed_ids],
        "retentionLimit": settings.HOSTED_HISTORY_LIMIT,
    }
    if keep is not None:
        public["keep"] = keep
    return public, tag, removed


def preview_cleanup(scope, account, kind, key, action, keep=None):
    # A read-only transaction gives the plan a consistent document/history
    # snapshot. POST rechecks the plan under the same write lock as saves.
    with transaction.atomic():
        require_cleanup_owner(scope.workspace, account)
        document = cleanup_document(scope.workspace.pk, kind, key)
        result, tag, _ = build_plan(document, action, keep)
        result["usage"] = usage(scope.workspace.pk)
        return result, tag


def apply_cleanup(scope, account, kind, key, action, expected, confirmation, keep=None):
    expected = require_precondition(expected)
    if confirmation != action:
        raise APIError("请先查看清理范围，再明确确认永久移除", 428)
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_cleanup_owner(workspace, account)
        document = cleanup_document(workspace.pk, kind, key)
        result, current, removed = build_plan(document, action, keep)
        if current != expected:
            raise APIError("内容或历史在预览后有变化，未执行清理，请重新检查范围", 409)
        if removed:
            DocumentRevision.objects.filter(document=document, pk__in=[row.pk for row in removed]).delete()
        if action == "discard_board":
            document.value = {"name": document.value["name"]}
            document.byte_size = len(document_bytes(document.value))
            document.purged_at = timezone.now()
            document.updated_by = account
            document.revision += 1
            document.revision_token = uuid.uuid4()
            document.save()
        # Cleanup can operate even when a smaller configured quota has already
        # been exceeded. It never writes or deletes another member's draft.
        return {**result, "cleaned": True, "usage": usage(workspace.pk)}
