"""Explicit retained-version application; no implicit merge or history removal."""
import hashlib
import uuid

from django.conf import settings
from django.db import transaction

from .documents import (check_quota, document_etag, find_document,
                        folder_reference_conflict, require_current_editor,
                        require_precondition, save_revision, usage, validate_document)
from .json_data import document_bytes
from .models import DocumentRevision
from .services import APIError, locked_workspace


def build_application(workspace, key, revision_id):
    document = find_document(workspace.pk, "board", key, include_deleted=True)
    if document is None:
        raise APIError("原白板不存在，未应用历史版本", 404)
    if document.purged_at:
        raise APIError("原白板已永久移除，不能重新创建它", 410)
    if document.deleted_at:
        raise APIError("原白板仍在回收站，请先核对并恢复原白板", 409)
    source = DocumentRevision.objects.filter(pk=revision_id, document=document).first()
    if source is None:
        raise APIError("这个保留版本已不存在，请刷新后重新核对", 404)
    if source.deleted:
        raise APIError("这是回收站状态的记录，请通过回收站恢复", 409)
    size = validate_document("board", source.value)
    if size != source.byte_size:
        raise APIError("保留版本的完整内容与记录不一致，未应用", 409)
    versions = list(document.versions.order_by("-revision").values_list("pk", "revision", "byte_size"))
    if not versions or versions[0][0] != document.revision_token:
        raise APIError("当前版本记录不完整，未应用历史版本", 409)
    changed = source.value != document.value
    state = usage(workspace.pk)
    blocked = ""
    if changed and len(versions) >= settings.HOSTED_HISTORY_LIMIT:
        blocked = "保留版本数量已满；请先导出或明确清理旧版本，再取回。本次不会自动删除任何版本。"
    elif changed and state["totalBytes"] + size * 2 - document.byte_size > state["limitBytes"]:
        blocked = "保存取回结果需要更多内容容量；请先检查容量，本次未改变白板或记录。"
    elif changed and folder_reference_conflict(workspace.pk, "board", source.value):
        blocked = "这个版本原来的分类已不存在，请先恢复原分类或导出内容；未更改其归属。"
    result = {
        "action": "apply_retained_version", "workspace": str(workspace.pk), "key": document.key,
        "sourceId": str(source.pk), "sourceRevision": source.revision,
        "sourceName": source.value["name"], "sourceSavedAt": source.created_at.timestamp(),
        "sourcePayloadBytes": source.byte_size, "currentName": document.value["name"],
        "currentRevision": document.revision, "currentETag": document_etag(document),
        "retainedVersions": len(versions), "historyLimit": settings.HOSTED_HISTORY_LIMIT,
        "changed": changed, "canApply": not blocked, "blockedReason": blocked,
        "retainedVersionsPreserved": True, "privateInputsPreserved": True, "originalFilesPreserved": True,
    }
    material = {**result, "sourceValue": source.value,
                "versions": [[str(row[0]), row[1], row[2]] for row in versions]}
    tag = '"' + hashlib.sha256(document_bytes(material)).hexdigest() + '"'
    return document, source, result, tag


def preview_application(scope, account, key, revision_id):
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        _, _, result, tag = build_application(workspace, key, revision_id)
        return result, tag


def apply_application(scope, account, key, revision_id, expected, confirmation):
    expected = require_precondition(expected)
    if confirmation != "apply_retained_version":
        raise APIError("请先查看取回范围，再明确确认", 428)
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        document, source, plan, tag = build_application(workspace, key, revision_id)
        if tag != expected:
            raise APIError("当前内容、保留版本或容量在核对后有变化，未执行取回，请重新检查", 409)
        if not plan["canApply"]:
            raise APIError(plan["blockedReason"], 413)
        if not plan["changed"]:
            return {**plan, "applied": True, "unchanged": True, "revision": document.revision}, document_etag(document)
        document.value = source.value
        document.byte_size = source.byte_size
        document.revision += 1
        document.revision_token = uuid.uuid4()
        document.updated_by = account
        document.save()
        # The locked plan checked room for one new version. save_revision cannot
        # trim existing history here; apply never silently makes space.
        save_revision(document)
        check_quota(workspace.pk)
        return {**plan, "applied": True, "unchanged": False, "revision": document.revision}, document_etag(document)
