import json
from functools import wraps

from django.conf import settings
from django.http import JsonResponse

from .cleanup import apply_cleanup, keep_count, preview_cleanup
from .documents import change_board_state, document_etag, find_document, put_document, remove_conflict, usage
from .models import ConflictDraft, DocumentRevision, WorkspaceDocument
from .revision_application import apply_application, preview_application
from .workspace_search import search_boards, search_query
from .services import APIError
from .views import endpoint, payload


def data_endpoint(methods, media=False):
    def decorate(view):
        @endpoint(methods, signed_in=True)
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            identity = request.headers.get("X-Creative-Account", "")
            if media:
                identities = request.GET.getlist("account")
                if len(identities) > 1 or (identities and (not identities[0] or (identity and identity != identities[0]))):
                    raise APIError("媒体页面所属账号不一致")
                identity = identity or (identities[0] if identities else "")
            if not identity:
                raise APIError("缺少页面所属账号，请保留输入并重新打开工作区", 428)
            if identity != str(request.user.pk):
                return JsonResponse({"error": "登录账号已改变，请保留这个页面的输入后再重新打开工作区", "code": "account_changed", "preserveDraft": True}, status=409)
            return view(request, *args, **kwargs)
        return wrapped
    return decorate


def value_payload(request):
    if request.content_type != "application/json":
        raise APIError("请使用 JSON 请求", 415)
    length = request.META.get("CONTENT_LENGTH", "")
    if length and (not length.isdigit() or int(length) > settings.HOSTED_MAX_DOCUMENT_BYTES):
        raise APIError("内容超过大小限制，请保留当前输入", 413)
    if len(request.body) > settings.HOSTED_MAX_DOCUMENT_BYTES:
        raise APIError("内容超过大小限制，请保留当前输入", 413)
    try:
        def reject_nonfinite(value):
            raise ValueError(value)
        return json.loads(request.body, parse_constant=reject_nonfinite)
    except (RecursionError, ValueError):
        raise APIError("内容不是有效的 JSON") from None


def reply_value(value, etag):
    response = JsonResponse(value, json_dumps_params={"ensure_ascii": False, "allow_nan": False})
    response["ETag"] = etag
    return response


def document_response(request, kind, key, default=None):
    scope = request.workspace_scope
    if request.method == "PUT":
        result, etag = put_document(scope, request.user, kind, key, value_payload(request), request.headers.get("If-Match"))
        response = JsonResponse(result, status=200 if result["saved"] else 409)
        response["ETag"] = etag
        return response
    document = find_document(scope.workspace.pk, kind, key)
    if document:
        return reply_value(document.value, document_etag(document))
    if default is not None:
        return reply_value(default, "new")
    raise APIError("白板不存在或已放入回收站", 404)


@data_endpoint(("GET", "HEAD"))
def boards(request, workspace_id):
    rows = []
    query = WorkspaceDocument.objects.filter(workspace_id=workspace_id, kind="board", deleted_at__isnull=True).order_by("-updated_at")
    for document in query.iterator(chunk_size=20):
        rows.append({"id": document.key, "name": document.value["name"], "count": len(document.value["nodes"]), "folder": document.value.get("folder", ""), "updated": document.updated_at.timestamp()})
    return JsonResponse(rows, safe=False)


@data_endpoint(("GET", "HEAD"))
def search(request, workspace_id):
    query = search_query(request.GET.getlist("q"))
    if set(request.GET) != {"q"}:
        raise APIError("查找请求包含不支持的字段")
    return JsonResponse(search_boards(request.workspace_scope, request.user, query),
                        json_dumps_params={"ensure_ascii": False})


@data_endpoint(("GET", "HEAD", "PUT", "DELETE"))
def board(request, workspace_id, key):
    if request.method == "DELETE":
        result, etag = change_board_state(request.workspace_scope, request.user, key, request.headers.get("If-Match"))
        return reply_value(result, etag)
    return document_response(request, WorkspaceDocument.Kind.BOARD, key)


@data_endpoint(("POST",))
def restore_board(request, workspace_id, key):
    result, etag = change_board_state(request.workspace_scope, request.user, key, request.headers.get("If-Match"), restore=True)
    return reply_value(result, etag)


@data_endpoint(("GET", "HEAD", "POST"))
def apply_revision(request, workspace_id, key, revision_id):
    if request.method == "POST":
        data = payload(request, ("confirm",))
        result, etag = apply_application(request.workspace_scope, request.user, key, revision_id,
                                        request.headers.get("If-Match"), data.get("confirm"))
    else:
        result, etag = preview_application(request.workspace_scope, request.user, key, revision_id)
    return reply_value(result, etag)


@data_endpoint(("GET", "HEAD", "PUT"))
def folders(request, workspace_id):
    return document_response(request, WorkspaceDocument.Kind.FOLDERS, "catalog", {"folders": []})


@data_endpoint(("GET", "HEAD", "PUT"))
def library(request, workspace_id):
    return document_response(request, WorkspaceDocument.Kind.LIBRARY, "catalog", {"version": 1, "folders": [], "folderIds": {}, "assets": []})


@data_endpoint(("GET", "HEAD"))
def history(request, workspace_id, kind, key, revision_id=None):
    document = find_document(workspace_id, kind, key, include_deleted=True)
    if document is None:
        raise APIError("历史记录不存在", 404)
    if document.purged_at:
        raise APIError("这张白板已被永久移除，历史不再保留", 410)
    if revision_id is not None:
        revision = DocumentRevision.objects.filter(pk=revision_id, document=document).first()
        if revision is None:
            raise APIError("历史记录不存在", 404)
        return JsonResponse({"id": str(revision.pk), "revision": revision.revision, "savedAt": revision.created_at.timestamp(), "value": revision.value, "deleted": revision.deleted})
    rows = [{"id": str(row.pk), "revision": row.revision, "savedAt": row.created_at.timestamp(), "name": row.value.get("name", ""), "deleted": row.deleted} for row in document.versions.order_by("-revision")]
    return JsonResponse(rows, safe=False)


@data_endpoint(("GET", "HEAD"))
def trash(request, workspace_id):
    rows = [{"id": row.key, "name": row.value["name"], "savedAt": row.deleted_at.timestamp(), "etag": document_etag(row)} for row in WorkspaceDocument.objects.filter(workspace_id=workspace_id, kind="board", deleted_at__isnull=False, purged_at__isnull=True).order_by("-deleted_at")]
    return JsonResponse(rows, safe=False)


def conflict_json(draft):
    return {"id": str(draft.pk), "kind": draft.kind, "key": draft.key, "createdAt": draft.created_at.timestamp(), "baseETag": draft.base_etag, "currentETag": draft.current_etag}


@data_endpoint(("GET", "HEAD"))
def conflicts(request, workspace_id):
    rows = ConflictDraft.objects.filter(workspace_id=workspace_id, actor=request.user).order_by("-created_at")
    return JsonResponse([conflict_json(row) for row in rows], safe=False)


@data_endpoint(("GET", "HEAD", "DELETE"))
def conflict(request, workspace_id, draft_id):
    if request.method == "DELETE":
        remove_conflict(request.workspace_scope, request.user, draft_id)
        return JsonResponse({"removed": True, "id": str(draft_id)})
    draft = ConflictDraft.objects.filter(pk=draft_id, workspace_id=workspace_id, actor=request.user).first()
    if draft is None:
        raise APIError("输入副本不存在或不属于这个账号", 404)
    return JsonResponse({**conflict_json(draft), "value": draft.value})


@data_endpoint(("GET", "HEAD"))
def quota(request, workspace_id):
    return JsonResponse(usage(workspace_id))


@data_endpoint(("GET", "HEAD", "POST"))
def cleanup_history(request, workspace_id, kind, key):
    if request.method == "POST":
        data = payload(request, ("keep", "confirm"))
        result = apply_cleanup(request.workspace_scope, request.user, kind, key, "discard_history", request.headers.get("If-Match"), data["confirm"], keep_count(data["keep"]))
        return JsonResponse(result)
    raw = request.GET.get("keep", "1")
    if not raw.isascii() or not raw.isdigit() or len(raw) > 4:
        raise APIError("保留版本数无效")
    result, tag = preview_cleanup(request.workspace_scope, request.user, kind, key, "discard_history", keep_count(int(raw)))
    return reply_value(result, tag)


@data_endpoint(("GET", "HEAD", "POST"))
def purge_board(request, workspace_id, key):
    if request.method == "POST":
        data = payload(request, ("confirm",))
        result = apply_cleanup(request.workspace_scope, request.user, "board", key, "discard_board", request.headers.get("If-Match"), data["confirm"])
        return JsonResponse(result)
    result, tag = preview_cleanup(request.workspace_scope, request.user, "board", key, "discard_board")
    return reply_value(result, tag)
