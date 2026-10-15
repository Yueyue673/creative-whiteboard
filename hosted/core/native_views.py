"""Original workbench library facade over existing scoped cloud documents/media."""
import copy
import hashlib
import uuid
from urllib.parse import quote

from django.db import transaction
from django.http import JsonResponse, HttpResponse

from .document_views import data_endpoint, value_payload
from .documents import check_quota, document_etag, find_document, put_document, require_current_editor, require_precondition, validate_document, save_revision
from .json_data import document_bytes
from .media import asset_etag, asset_json, locked_budget, metadata_size
from .models import MediaAsset, DocumentRevision
from .native_library import BUNDLE, FILE_REFERENCE
from .services import APIError, locked_workspace
from .workspace_search import authored_parts, excerpt, search_boards, search_query, ScanLimit
from .media_search import search_assets, current_reader
from .html_preview import prepare_html, EXIT_SCRIPT
from .native_preview import SCRIPT as NATIVE_PREVIEW_SCRIPT
import re
import time


def snapshot(scope, account):
    doc = find_document(scope.workspace.pk, 'library', 'catalog')
    value = copy.deepcopy(doc.value) if doc else {'version': 1, 'folders': [], 'folderIds': {}, 'assets': []}
    records = list(MediaAsset.objects.filter(workspace_id=scope.workspace.pk).order_by('id'))
    stored = {row['id']: row for row in value['assets'] if row.get('mime') == FILE_REFERENCE}
    value['assets'] = [row for row in value['assets'] if row.get('mime') != FILE_REFERENCE]
    for record in records:
        item = asset_json(record, account)
        item['path'] = item['mediaURL'] + '&filename=' + quote(record.filename)
        item['updated'] = record.updated_at.timestamp() * 1000
        for field in ('archiveBatch', 'archivedAt'):
            if field in stored.get(str(record.pk), {}):
                item[field] = stored[str(record.pk)][field]
        if record.archived and str(record.pk) in stored:
            item['folder'] = stored[str(record.pk)].get('folder', item['folder'])
        value['assets'].append(item)
    identity = [document_etag(doc) if doc else 'new', [(str(row.pk), asset_etag(row)) for row in records]]
    tag = '"' + hashlib.sha256(document_bytes(identity)).hexdigest() + '"'
    return value, tag, doc, records


@data_endpoint(('GET', 'HEAD', 'PUT'))
def library(request, workspace_id):
    scope = request.workspace_scope
    incoming = value_payload(request) if request.method == 'PUT' else None
    expected = require_precondition(request.headers.get('If-Match')) if incoming is not None else None
    with transaction.atomic():
        if incoming is not None:
            locked_budget()
            workspace = locked_workspace(workspace_id)
            require_current_editor(workspace, request.user)
        value, tag, doc, records = snapshot(scope, request.user)
        if incoming is None:
            response = JsonResponse(value)
        elif expected != tag:
            response = JsonResponse({'saved': False, 'draftSaved': False, 'preserveDraft': True, 'error': '内容库已被其他页面修改，本次输入没有写入，请保留并核对'}, status=409)
        else:
            if not isinstance(incoming, dict) or set(incoming) - {'version', 'folders', 'folderIds', 'assets', 'trash'} or not isinstance(incoming.get('assets'), list):
                raise APIError('内容库格式无效')
            canonical = copy.deepcopy(incoming)
            canonical['assets'] = []
            current = {row['id']: row for row in value['assets']}
            files = {str(row.pk): row for row in records}
            seen = set()
            folder_ids = incoming.get('folderIds', {})
            if not isinstance(folder_ids, dict):
                raise APIError('内容库目录编号无效')
            for item in incoming['assets']:
                if not isinstance(item, dict) or not isinstance(item.get('id'), str) or item['id'] in seen:
                    raise APIError('内容库项目无效或重复')
                identity = item['id']; seen.add(identity)
                if identity not in files:
                    if item.get('mime') != BUNDLE:
                        raise APIError('新文件必须先上传，不能引用电脑或服务器路径')
                    canonical['assets'].append(copy.deepcopy(item)); continue
                old = current[identity]; record = files[identity]
                immutable = ('path', 'filename', 'mime', 'size', 'contentHash', 'mediaURL')
                if any(item.get(field) != old.get(field) for field in immutable):
                    raise APIError('登记的原文件编号和内容不能从内容库修改')
                title, notes, tags = item.get('title'), item.get('notes', ''), item.get('tags', [])
                archived = item.get('archived', False); folder = item.get('folder', '')
                if not isinstance(title, str) or not title.strip() or len(title) > 1000 or not isinstance(notes, str) or len(notes) > 65536:
                    raise APIError('素材名称或备注无效')
                if not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(t, str) or len(t) > 100 for t in tags) or type(archived) is not bool:
                    raise APIError('素材标签或收起状态无效')
                if not isinstance(folder, str) or not archived and folder not in ['', *incoming.get('folders', [])]:
                    raise APIError('素材目标目录不存在')
                target_id = folder_ids.get(folder, '') if folder else ''
                if folder and not target_id and not archived:
                    raise APIError('素材目标目录缺少固定编号')
                mutable = {'title': title, 'notes': notes, 'tags': tags, 'archived': archived, 'folder_id': target_id}
                changed = any(getattr(record, key) != val for key, val in mutable.items())
                for key, val in mutable.items():
                    setattr(record, key, val)
                if changed:
                    record.byte_size = metadata_size(record);record.revision_token = uuid.uuid4();record.save()
                saved = {'id': identity, 'mime': FILE_REFERENCE, 'title': title, 'notes': notes, 'tags': tags, 'folder': folder, 'folderId': target_id, 'archived': archived}
                for field in ('archiveBatch', 'archivedAt'):
                    if field in item:
                        saved[field] = copy.deepcopy(item[field])
                canonical['assets'].append(saved)
            if not set(files).issubset(seen):
                raise APIError('内容库包含未核对的登记文件，未清理原文件；请刷新后再试', 409)
            validate_document('library', canonical)
            saved, _ = put_document(scope, request.user, 'library', 'catalog', canonical, document_etag(doc) if doc else 'new')
            if not saved['saved']:
                # No partial metadata commit when catalog validation/refusal fails.
                raise APIError(saved.get('error', '内容库没有保存，原输入保留'), 409)
            check_quota(workspace_id)
            _, tag, _, _ = snapshot(scope, request.user)
            response = JsonResponse(saved)
        response['ETag'] = tag
        return response


@data_endpoint(('GET', 'HEAD'))
def search(request, workspace_id):
    if set(request.GET) != {'q'}:
        raise APIError('查找请求字段无效')
    query = search_query(request.GET.getlist('q'))
    boards = search_boards(request.workspace_scope, request.user, query)
    files = search_assets(request.workspace_scope, request.user, query)
    rows = [{'kind': 'board', 'boardId': row['id'], 'id': '', 'title': row['name'], 'location': row['name'], 'snippet': row['excerpt'], 'matchedIn': row['context']} for row in boards['items']]
    rows += [{'kind': 'asset', 'id': row['asset']['id'], 'title': row['asset']['title'], 'location': row['asset']['folder'] or '根目录', 'snippet': row['excerpt'], 'matchedIn': row['context']} for row in files['items']]
    limited = boards['coverage'] == 'limited' or files['coverage'] == 'limited'
    doc = find_document(workspace_id, 'library', 'catalog')
    if doc and doc.byte_size <= 4 * 1024 * 1024:
        budget = {'parts': 0, 'deadline': time.monotonic() + .5}
        try:
            for item in doc.value['assets'][:1000]:
                if item.get('mime') != BUNDLE or item.get('archived'):
                    continue
                parts = authored_parts({'name': item['title'], 'nodes': item['bundle']['nodes'], 'edges': item['bundle']['edges']}, budget)
                for label, text in parts:
                    found = excerpt(text, query)
                    if found is not None:
                        rows.append({'kind': 'asset', 'id': item['id'], 'title': item['title'], 'location': item.get('folder') or '根目录', 'snippet': found, 'matchedIn': label});break
                if len(rows) >= 150:
                    limited=True;break
        except ScanLimit:
            limited=True
    elif doc:
        limited=True
    current_reader(request.workspace_scope, request.user)
    return JsonResponse({'results': rows[:150], 'total': 151 if limited else len(rows), 'limited': limited})


@data_endpoint(('GET', 'HEAD'), media=True)
def preview(request, workspace_id, asset_id):
    _, content = prepare_html(request.workspace_scope, request.user, asset_id)
    # Keep the original workbench's wheel/zoom/Escape handshake, while only
    # executing this one trusted program script inside the inert attachment.
    content = content.decode('utf-8').replace('<script>' + EXIT_SCRIPT + '</script>', '<script>' + NATIVE_PREVIEW_SCRIPT + '</script>')
    content = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', '', content, count=1)
    response = HttpResponse(content, content_type='text/html; charset=utf-8')
    response.creative_static_preview = True
    response.creative_native_preview = True
    return response


def historical_library(value, scope, account):
    value = copy.deepcopy(value)
    files = {str(row.pk): row for row in MediaAsset.objects.filter(workspace_id=scope.workspace.pk)}
    for index, item in enumerate(value['assets']):
        if item.get('mime') != FILE_REFERENCE or item['id'] not in files:
            continue
        row = files[item['id']]; result = asset_json(row, account)
        result['path'] = result['mediaURL'] + '&filename=' + quote(row.filename)
        for field in ('title', 'notes', 'tags', 'folder', 'folderId', 'archived', 'archiveBatch', 'archivedAt'):
            if field in item:
                result[field] = copy.deepcopy(item[field])
        value['assets'][index] = result
    return value


@data_endpoint(('GET', 'HEAD'))
def history(request, workspace_id, kind, key, revision_id=None):
    doc = find_document(workspace_id, kind, key, include_deleted=True)
    if doc is None or doc.purged_at:
        raise APIError('历史记录不存在', 404)
    rows = doc.versions.order_by('-revision')
    if revision_id:
        row = rows.filter(pk=revision_id).first()
        if row is None:
            raise APIError('历史记录不存在', 404)
        value = historical_library(row.value, request.workspace_scope, request.user) if kind == 'library' else row.value
        return JsonResponse({'id': str(row.pk), 'savedAt': row.created_at.timestamp(), 'value': value, 'deleted': row.deleted})
    return JsonResponse([{'id': str(row.pk), 'savedAt': row.created_at.timestamp(), 'count': len(row.value.get('assets' if kind == 'library' else 'nodes', [])), 'deleted': row.deleted} for row in rows], safe=False)


@data_endpoint(('PUT',))
def checkpoint(request, workspace_id, kind, key):
    # Every accepted write already retains its exact current revision. Checking
    # that record must not rotate the board ETag underneath its open original pane.
    with transaction.atomic():
        workspace = locked_workspace(workspace_id);require_current_editor(workspace, request.user)
        doc = find_document(workspace_id, kind, key)
        if doc is None:
            raise APIError('当前内容尚未保存到云端', 404)
        if not DocumentRevision.objects.filter(document=doc, revision=doc.revision).exists():
            save_revision(doc);check_quota(workspace_id)
        return JsonResponse({'saved': True, 'automaticRevisionRetained': True})
