"""Atomic original-workbench folder deletion, with retained scoped recovery."""
import hashlib
import uuid

from django.core import signing
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .document_views import data_endpoint, reply_value, value_payload
from .documents import (check_quota, document_etag, find_document, require_current_editor,
                        require_precondition, save_revision, valid_key, validate_document)
from .json_data import document_bytes
from .models import NativeFolderTrash, WorkspaceDocument
from .services import APIError, locked_workspace

SALT = 'creative-native-folder-deletion-v1'
MAX_BATCHES = 1000


def material(workspace_id, key, expected):
    valid_key(key)
    require_precondition(expected)
    catalog = find_document(workspace_id, 'folders', 'catalog')
    if catalog is None or document_etag(catalog) != expected:
        raise APIError('目录已改变，未执行整夹删除；请重新选择后再试', 409)
    folders = catalog.value['folders']
    if key not in {row['id'] for row in folders}:
        raise APIError('原文件夹已不存在，未执行删除', 404)
    ids = {key}
    while True:
        before = len(ids)
        ids.update(row['id'] for row in folders if row.get('parent', '') in ids)
        if len(ids) == before:
            break
    rows = [row for row in folders if row['id'] in ids]
    boards = [row for row in WorkspaceDocument.objects.filter(workspace_id=workspace_id, kind='board', deleted_at__isnull=True).order_by('key')
              if row.value.get('folder') in ids]
    value = {'catalogETag': expected, 'folders': rows, 'boards': {row.key: document_etag(row) for row in boards}}
    return catalog, rows, boards, hashlib.sha256(document_bytes(value)).hexdigest()


def advance(document, account, *, value=None, deleted=None):
    if value is not None:
        document.value = value
        document.byte_size = validate_document(document.kind, value)
    if deleted is not None:
        document.deleted_at = timezone.now() if deleted else None
    document.updated_by = account
    document.revision += 1
    document.revision_token = uuid.uuid4()
    document.save()
    save_revision(document)


def batch_etag(batch):
    return '"' + hashlib.sha256(document_bytes({'workspace': str(batch.workspace_id), 'id': str(batch.pk),
                                                'folders': batch.folders, 'boards': batch.boards})).hexdigest() + '"'


def preview(scope, account, key, expected):
    with transaction.atomic():
        _, folders, boards, digest = material(scope.workspace.pk, key, expected)
        token = signing.dumps({'workspace': str(scope.workspace.pk), 'account': account.pk, 'folder': key, 'digest': digest}, salt=SALT)
        return {'folder': key, 'folderCount': len(folders), 'boardCount': len(boards), 'plan': token}


def remove(scope, account, key, expected, token):
    if not isinstance(token, str) or len(token) > 4096:
        raise APIError('缺少本次整夹删除的核对记录', 428)
    try:
        plan = signing.loads(token, salt=SALT, max_age=300)
    except signing.BadSignature:
        raise APIError('删除核对已过期或无效，原内容保留；请重新选择', 409) from None
    if not isinstance(plan, dict) or plan.get('workspace') != str(scope.workspace.pk) or plan.get('account') != account.pk or plan.get('folder') != key:
        raise APIError('删除核对不属于原账号、工作区或文件夹', 409)
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        catalog, folders, boards, digest = material(workspace.pk, key, expected)
        if plan.get('digest') != digest:
            raise APIError('文件夹或其中白板刚刚有变化，未执行删除；请重新核对', 409)
        if NativeFolderTrash.objects.filter(workspace=workspace).count() >= MAX_BATCHES:
            raise APIError('整夹回收记录已达到限制，请先处理原记录', 413)
        folder_ids = {row['id'] for row in folders}
        for board in boards:
            advance(board, account, deleted=True)
        advance(catalog, account, value={'folders': [row for row in catalog.value['folders'] if row['id'] not in folder_ids]})
        tags = {row.key: document_etag(row) for row in boards}
        title = next(row['name'] for row in folders if row['id'] == key)
        batch = NativeFolderTrash.objects.create(workspace=workspace, title=title, folders=folders, boards=tags,
                                                byte_size=len(document_bytes({'title': title, 'folders': folders, 'boards': tags})), created_by=account)
        check_quota(workspace.pk)
        return {'deleted': True, 'ticket': batch.pk.hex, 'ids': list(tags), 'folderIds': sorted(folder_ids)}


def restore(scope, account, identity, expected):
    require_precondition(expected)
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        batch = NativeFolderTrash.objects.filter(workspace=workspace, pk=identity).first()
        if batch is None:
            raise APIError('整夹回收记录已处理或不属于这个工作区', 404)
        if batch_etag(batch) != expected:
            raise APIError('原回收记录已改变，未执行恢复', 409)
        catalog = find_document(workspace.pk, 'folders', 'catalog')
        if catalog is None:
            raise APIError('当前目录无法核对，未执行恢复', 409)
        current = {row['id'] for row in catalog.value['folders']}
        if current & {row['id'] for row in batch.folders}:
            raise APIError('原文件夹编号已另有内容，未覆盖现有目录；请先核对', 409)
        merged = {'folders': catalog.value['folders'] + batch.folders}
        try:
            validate_document('folders', merged)
        except APIError:
            raise APIError('原上级文件夹已改变或不存在，请先恢复上级目录', 409) from None
        boards = []
        for key, tag in batch.boards.items():
            board = find_document(workspace.pk, 'board', key, include_deleted=True)
            if board is None or board.purged_at or board.deleted_at is None or document_etag(board) != tag:
                raise APIError('其中白板已另外处理，未执行部分恢复；原记录仍保留', 409)
            boards.append(board)
        advance(catalog, account, value=merged)
        for board in boards:
            advance(board, account, deleted=False)
        batch.delete()
        check_quota(workspace.pk)
        return {'restored': True, 'ids': [row.key for row in boards], 'boards': [
            {'id': row.key, 'name': row.value['name'], 'folder': row.value.get('folder', ''), 'count': len(row.value['nodes'])} for row in boards]}


@data_endpoint(('GET', 'HEAD', 'DELETE'))
def folder(request, workspace_id, key):
    expected = request.headers.get('If-Match')
    if request.method == 'DELETE':
        if not settings.HOSTED_NATIVE_FOLDER_DELETE:
            raise APIError('整夹删除暂时停用，原内容和回收记录保留；已有记录仍可以恢复', 503)
        value = value_payload(request)
        if not isinstance(value, dict) or set(value) != {'plan'}:
            raise APIError('请提供本次整夹删除核对记录')
        from django.http import JsonResponse
        return JsonResponse(remove(request.workspace_scope, request.user, key, expected, value['plan']))
    return reply_value(preview(request.workspace_scope, request.user, key, expected), expected)


@data_endpoint(('GET', 'HEAD'))
def trash(request, workspace_id):
    from django.http import JsonResponse
    rows = []
    grouped = set()
    for batch in NativeFolderTrash.objects.filter(workspace_id=workspace_id).order_by('-created_at'):
        grouped.update(batch.boards)
        rows.append({'kind': 'folder', 'id': batch.pk.hex, 'names': [batch.title], 'folders': [batch.title], 'folderCount': len(batch.folders),
                     'savedAt': batch.created_at.timestamp(), 'etag': batch_etag(batch), 'boardCount': len(batch.boards)})
    rows += [{'kind': 'board', 'id': row.key, 'name': row.value['name'], 'savedAt': row.deleted_at.timestamp(), 'etag': document_etag(row)}
             for row in WorkspaceDocument.objects.filter(workspace_id=workspace_id, kind='board', deleted_at__isnull=False, purged_at__isnull=True).exclude(key__in=grouped).order_by('-deleted_at')]
    return JsonResponse(sorted(rows, key=lambda row: row['savedAt'], reverse=True), safe=False)


@data_endpoint(('POST',))
def restore_batch(request, workspace_id, batch_id):
    from django.http import JsonResponse
    try:
        identity = uuid.UUID(batch_id)
    except ValueError:
        raise APIError('整夹回收记录不存在', 404) from None
    return JsonResponse(restore(request.workspace_scope, request.user, identity, request.headers.get('If-Match')))
