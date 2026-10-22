"""Explicitly scoped, transactional JSON documents. No file-server fallback."""
import hashlib
import re
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from board_schema import valid_board, valid_folders
from library_folders import validate_folder_ids, with_folder_ids

from .json_data import document_bytes
from .models import Account, ConflictDraft, DocumentRevision, MediaAsset, Membership, NativeFolderTrash, ResearchRecord, WorkspaceDocument
from .scope import valid_membership
from .services import APIError, locked_workspace


def valid_key(key):
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", key):
        raise APIError("内容编号无效")
    return key


def check_tree(value):
    pending = [(value, 0)]
    while pending:
        current, depth = pending.pop()
        if depth > 64:
            raise APIError("内容嵌套过深")
        if isinstance(current, dict):
            pending.extend((child, depth + 1) for child in current.values())
        elif isinstance(current, list):
            pending.extend((child, depth + 1) for child in current)


def validate_document(kind, value):
    if not isinstance(value, dict):
        raise APIError("内容必须是 JSON 对象")
    check_tree(value)
    try:
        size = len(document_bytes(value))
    except (ValueError, UnicodeError, RecursionError):
        raise APIError("内容包含无效的数字或文字") from None
    if size > settings.HOSTED_MAX_DOCUMENT_BYTES:
        raise APIError("单份内容超过网页版本的大小限制，请保留当前输入", 413)
    try:
        if kind == WorkspaceDocument.Kind.BOARD:
            valid_board(value)
            if type(value["version"]) is not int or not isinstance(value.get("folder", ""), str):
                raise ValueError("白板格式或目录无效")
            if len(value["name"]) > 1000 or not all(isinstance(edge, dict) for edge in value["edges"]):
                raise ValueError("白板名称或连线无效")
            for node in value["nodes"]:
                valid_key(node["id"])
                if any(type(node[key]) not in (int, float) for key in ("x", "y", "w", "h")) or node["w"] <= 0 or node["h"] <= 0:
                    raise ValueError("白板尺寸无效")
        elif kind == WorkspaceDocument.Kind.FOLDERS:
            if set(value) != {"folders"}:
                raise ValueError("目录包含不支持的字段")
            valid_folders(value)
            for folder in value["folders"]:
                valid_key(folder["id"])
                if not folder["name"].strip() or len(folder["name"]) > 1000:
                    raise ValueError("文件夹名称无效")
        elif kind == WorkspaceDocument.Kind.LIBRARY:
            if set(value) - {"version", "folders", "folderIds", "assets", "trash"} or type(value.get("version")) is not int or value["version"] != 1:
                raise ValueError("资料库目录格式无效")
            if not isinstance(value.get("assets"), list):
                raise ValueError("资料库格式无效")
            folders = value.get("folders")
            if not isinstance(folders, list) or len(folders) > 1000 or len(set(folders)) != len(folders):
                raise ValueError("资料库文件夹无效")
            for path in folders:
                if not isinstance(path, str) or len(path) > 1000 or "\\" in path or any(not part or part in (".", "..") for part in path.split("/")):
                    raise ValueError("资料库文件夹名称无效")
            validate_folder_ids(value)
            from .native_library import validate_entries
            validate_entries(value)
        else:
            raise ValueError("内容类型无效")
    except (TypeError, AttributeError, KeyError, ValueError) as error:
        raise APIError("内容格式不正确：" + str(error)) from None
    return size


def revision_etag(document, token):
    namespace = f"{document.workspace_id}/{document.kind}/{document.key}/{token}"
    return '"' + hashlib.sha256(namespace.encode("utf-8")).hexdigest() + '"'


def document_etag(document):
    return revision_etag(document, document.revision_token)


def require_precondition(value):
    if not value:
        raise APIError("缺少保存前的版本，请保留输入并重新检查当前内容", 428)
    # Narrow transition support for already-open native pages that received a
    # gzip-weakened copy of our exact revision token. Namespace/current-version
    # checks below still run. This is opt-in, not general weak If-Match support.
    if getattr(settings, 'HOSTED_LEGACY_COMPRESSED_REVISION', False) and isinstance(value, str) and re.fullmatch(r'W/"[a-f0-9]{64}"', value):
        value = value[2:]
    if value != "new" and not re.fullmatch(r'"[a-f0-9]{64}"', value):
        raise APIError("内容版本格式无效")
    return value


def require_current_editor(workspace, account):
    if not Account.objects.filter(pk=account.pk, is_active=True).exists():
        raise APIError("账号已失效，请保留当前输入", 401)
    member = Membership.objects.select_related("workspace").filter(workspace=workspace, account=account).first()
    if member is None or not valid_membership(member):
        raise APIError("工作区不存在或你没有访问权限", 404)
    if member.role not in (Membership.Role.EDITOR, Membership.Role.OWNER):
        raise APIError("此工作区只有阅读权限，请保留当前输入", 403)


def find_document(workspace_id, kind, key, include_deleted=False):
    query = WorkspaceDocument.objects.filter(workspace_id=workspace_id, kind=kind, key=valid_key(key))
    if not include_deleted:
        query = query.filter(deleted_at__isnull=True)
    return query.first()


def usage(workspace_id):
    def total(query):
        return query.aggregate(total=Sum("byte_size"))["total"] or 0
    current = total(WorkspaceDocument.objects.filter(workspace_id=workspace_id))
    history = total(DocumentRevision.objects.filter(document__workspace_id=workspace_id))
    drafts = total(ConflictDraft.objects.filter(workspace_id=workspace_id))
    metadata = total(MediaAsset.objects.filter(workspace_id=workspace_id))
    trash = total(NativeFolderTrash.objects.filter(workspace_id=workspace_id))
    research = total(ResearchRecord.objects.filter(workspace_id=workspace_id))
    return {"researchBytes": research, "currentBytes": current, "historyBytes": history, "draftBytes": drafts, "assetMetadataBytes": metadata, "trashMetadataBytes": trash, "totalBytes": current + history + drafts + metadata + trash + research, "limitBytes": settings.HOSTED_MAX_WORKSPACE_BYTES}


def check_quota(workspace_id):
    state = usage(workspace_id)
    if state["totalBytes"] > state["limitBytes"]:
        raise APIError("工作区的内容和历史已达到容量限制，本次修改未保存，请保留当前输入", 413)


def save_revision(document):
    DocumentRevision.objects.create(
        id=document.revision_token, document=document, revision=document.revision,
        value=document.value, byte_size=document.byte_size, actor=document.updated_by,
        deleted=document.deleted_at is not None,
    )
    older = list(document.versions.order_by("-revision").values_list("pk", flat=True)[settings.HOSTED_HISTORY_LIMIT:])
    if older:
        DocumentRevision.objects.filter(pk__in=older).delete()


def conflict_result(workspace, account, kind, key, value, size, expected, current, reason):
    fingerprint = hashlib.sha256(document_bytes({"kind": kind, "key": key, "base": expected, "value": value})).hexdigest()
    existing = ConflictDraft.objects.filter(workspace=workspace, actor=account, fingerprint=fingerprint).first()
    saved = existing
    if saved is None:
        count = ConflictDraft.objects.filter(workspace=workspace, actor=account).count()
        state = usage(workspace.pk)
        if count < settings.HOSTED_MAX_CONFLICT_DRAFTS_PER_ACCOUNT and state["totalBytes"] + size <= state["limitBytes"]:
            saved = ConflictDraft.objects.create(
                workspace=workspace, actor=account, kind=kind, key=key, value=value, byte_size=size,
                base_etag=expected, current_etag=current, fingerprint=fingerprint,
            )
    message = {
        "deleted": "这张白板已进入回收站，本次输入没有替换原内容。",
        "purged": "这张白板已被明确永久移除，本次输入没有重新创建它。",
        "folder_missing": "原文件夹已不存在，本次输入没有写入白板。",
        "folder_in_use": "目录里仍有白板，未执行这次目录移除。",
        "library_folder_in_use": "资料库目录里仍有素材，未执行这次目录移除。",
        "version_conflict": "内容已被其他设备修改，当前版本保留。",
    }[reason]
    message += "你的这份输入已另外保存，尚未应用。" if saved else "暂时没有容量另外保存这份输入，请保留当前窗口。"
    return {
        "saved": False, "error": message, "code": reason, "currentETag": current, "preserveDraft": True,
        "draftSaved": saved is not None, "draftId": str(saved.pk) if saved else None,
        "draftURL": f"/w/{workspace.pk}/api/conflicts/{saved.pk}" if saved else None,
    }


def folder_reference_conflict(workspace_id, kind, value):
    if kind == WorkspaceDocument.Kind.BOARD:
        folder = value.get("folder", "")
        if folder:
            catalog = find_document(workspace_id, WorkspaceDocument.Kind.FOLDERS, "catalog")
            if catalog is None or folder not in {row["id"] for row in catalog.value["folders"]}:
                return "folder_missing"
    elif kind == WorkspaceDocument.Kind.FOLDERS:
        ids = {row["id"] for row in value["folders"]}
        boards = WorkspaceDocument.objects.filter(workspace_id=workspace_id, kind="board", deleted_at__isnull=True)
        if any(board.value.get("folder") and board.value["folder"] not in ids for board in boards.iterator(chunk_size=20)):
            return "folder_in_use"
    elif kind == WorkspaceDocument.Kind.LIBRARY:
        ids = set(value.get("folderIds", {}).values())
        if MediaAsset.objects.filter(workspace_id=workspace_id).exclude(folder_id="").exclude(folder_id__in=ids).exists():
            return "library_folder_in_use"
    return None


def put_document(scope, account, kind, key, value, expected):
    key = valid_key(key)
    expected = require_precondition(expected)
    validate_document(kind, value)
    # Lock before the first transactional read, including on SQLite. Fresh role
    # checks under this lock serialize with membership removal or downgrading.
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        document = find_document(workspace.pk, kind, key, include_deleted=True)
        current = document_etag(document) if document else "new"
        if kind == WorkspaceDocument.Kind.LIBRARY:
            value = with_folder_ids(value, document.value if document else None)
            from .native_library import FILE_REFERENCE
            references = {row['id'] for row in value['assets'] if row.get('mime') == FILE_REFERENCE}
            if references and set(str(identity) for identity in MediaAsset.objects.filter(workspace_id=workspace.pk, pk__in=references).values_list('pk', flat=True)) != references:
                raise APIError('内容库含未在这个工作区登记的文件，原数据保留')
        size = validate_document(kind, value)
        if expected != current or (document and document.deleted_at):
            reason = "purged" if document and document.purged_at else "deleted" if document and document.deleted_at else "version_conflict"
            return conflict_result(workspace, account, kind, key, value, size, expected, current, reason), current
        relation_error = folder_reference_conflict(workspace.pk, kind, value)
        if relation_error:
            return conflict_result(workspace, account, kind, key, value, size, expected, current, relation_error), current
        if document and document_bytes(document.value) == document_bytes(value):
            return {"saved": True, "unchanged": True, "revision": document.revision}, current
        if document is None:
            if workspace.documents.count() >= settings.HOSTED_MAX_DOCUMENTS:
                raise APIError("工作区的内容数量已达到限制，本次修改未保存", 413)
            document = WorkspaceDocument.objects.create(workspace=workspace, kind=kind, key=key, value=value, byte_size=size, updated_by=account)
        else:
            document.value = value
            document.byte_size = size
            document.revision += 1
            document.revision_token = uuid.uuid4()
            document.updated_by = account
            document.save()
        save_revision(document)
        check_quota(workspace.pk)
        return {"saved": True, "revision": document.revision}, document_etag(document)


def change_board_state(scope, account, key, expected, restore=False):
    expected = require_precondition(expected)
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        document = find_document(workspace.pk, "board", key, include_deleted=True)
        if document is None:
            raise APIError("白板不存在", 404)
        if document.purged_at:
            raise APIError("这张白板已被永久移除，不能从回收站恢复", 410)
        current = document_etag(document)
        if current != expected:
            raise APIError("白板刚刚有变化，未执行删除或恢复，请重新检查", 409)
        if restore != (document.deleted_at is not None):
            raise APIError("白板状态已改变，未重复执行操作", 409)
        if restore and folder_reference_conflict(workspace.pk, "board", document.value):
            raise APIError("原文件夹已不存在，请先恢复目录再恢复这张白板", 409)
        document.deleted_at = None if restore else timezone.now()
        document.updated_by = account
        document.revision += 1
        document.revision_token = uuid.uuid4()
        document.save()
        save_revision(document)
        check_quota(workspace.pk)
        return {"restored" if restore else "deleted": True, "id": key}, document_etag(document)


def remove_conflict(scope, account, draft_id):
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        draft = ConflictDraft.objects.filter(pk=draft_id, workspace=workspace, actor=account).first()
        if draft is None:
            raise APIError("输入副本不存在或不属于这个账号", 404)
        draft.delete()
