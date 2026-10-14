import re
import uuid

from django.conf import settings
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.utils.http import content_disposition_header

from .document_views import data_endpoint
from .documents import find_document
from .media import MediaChunks, asset_etag, asset_json, content_etag, media_range, media_usage, open_media, original_filename, update_asset, upload_stream
from .models import MediaAsset
from .media_references import inspect_references
from .html_preview import prepare_html
from .media_search import search_assets
from .workspace_search import search_query
from .services import APIError
from .views import payload


@data_endpoint(("POST",))
def upload(request, workspace_id):
    if request.content_type != "application/octet-stream":
        raise APIError("请使用原始文件上传，不使用表单或服务器文件路径", 415)
    declared = request.META.get("CONTENT_LENGTH", "")
    if not declared:
        raise APIError("上传需要明确文件大小", 411)
    if not declared.isascii() or not declared.isdigit() or len(declared) > 12:
        raise APIError("上传文件大小无效")
    length = int(declared)
    if not 0 < length <= settings.HOSTED_MAX_UPLOAD_BYTES:
        raise APIError("文件为空或超过单次上传限制，本次未保存", 413)
    filename = original_filename(request.headers.get("X-File-Name", ""))
    folder_id = request.headers.get("X-Folder-Id", "")
    try:
        asset = upload_stream(request.workspace_scope, request.user, request, length, filename, folder_id)
    except OSError:
        raise APIError("上传存储暂时不可用，本次未完成，请保留原文件后重试", 503) from None
    response = JsonResponse(asset_json(asset, request.user), status=201)
    response["ETag"] = asset_etag(asset)
    return response


@data_endpoint(("GET", "HEAD"))
def search(request, workspace_id):
    if set(request.GET) != {"q"}:
        raise APIError("素材查找请求包含不支持的字段")
    return JsonResponse(search_assets(request.workspace_scope, request.user, search_query(request.GET.getlist("q"))))


@data_endpoint(("GET", "HEAD"))
def items(request, workspace_id):
    raw = request.GET.get("limit", "100")
    if not raw.isascii() or not raw.isdigit() or len(raw) > 3 or not 1 <= int(raw) <= 100:
        raise APIError("每页素材数量无效")
    limit = int(raw)
    query = MediaAsset.objects.filter(workspace_id=workspace_id).order_by("id")
    cursor = request.GET.get("after", "")
    if cursor:
        try:
            query = query.filter(id__gt=uuid.UUID(cursor))
        except ValueError:
            raise APIError("素材翻页编号无效") from None
    rows = list(query[:limit + 1])
    catalog = find_document(workspace_id, "library", "catalog")
    folders = {identity: path for path, identity in catalog.value["folderIds"].items()} if catalog else {}
    return JsonResponse({"items": [asset_json(row, request.user, folders) for row in rows[:limit]], "next": str(rows[limit - 1].pk) if len(rows) > limit else None})


@data_endpoint(("GET", "HEAD", "PATCH"))
def item(request, workspace_id, asset_id):
    if request.method == "PATCH":
        data = payload(request, (), ("title", "notes", "tags", "folderId"))
        result, asset = update_asset(request.workspace_scope, request.user, asset_id, data, request.headers.get("If-Match"))
        response = JsonResponse({**result, "asset": asset_json(asset, request.user)}, status=200 if result["saved"] else 409)
    else:
        asset = MediaAsset.objects.filter(pk=asset_id, workspace_id=workspace_id).first()
        if asset is None:
            raise APIError("素材不存在", 404)
        response = JsonResponse(asset_json(asset, request.user))
    response["ETag"] = asset_etag(asset)
    return response


@data_endpoint(("GET", "HEAD"))
def references(request, workspace_id, asset_id):
    return JsonResponse(inspect_references(request.workspace_scope, request.user, asset_id))


@data_endpoint(("GET", "HEAD"))
def html_preview_plan(request, workspace_id, asset_id):
    if request.GET: raise APIError("HTML预览请求包含不支持的字段")
    result, _ = prepare_html(request.workspace_scope, request.user, asset_id)
    return JsonResponse(result)


@data_endpoint(("GET", "HEAD"), media=True)
def html_preview_view(request, workspace_id, asset_id):
    if set(request.GET) != {"account", "hash", "render"} or any(len(request.GET.getlist(key)) != 1 for key in request.GET):
        raise APIError("缺少原HTML预览的核对范围")
    if any(not re.fullmatch(r"[a-f0-9]{64}", request.GET[key]) for key in ("hash", "render")):
        raise APIError("HTML预览的核对范围无效")
    result, content = prepare_html(request.workspace_scope, request.user, asset_id)
    if request.GET["hash"] != result["contentHash"] or request.GET["render"] != result["previewHash"]:
        raise APIError("原HTML预览已改变，请重新核对", 409)
    response = HttpResponse(content, content_type="text/html; charset=utf-8")
    response.creative_static_preview = True
    response["ETag"] = '"' + result["previewHash"] + '"'
    return response


@data_endpoint(("GET", "HEAD"))
def quota(request, workspace_id):
    # Do not reveal other accounts' usage or the server's aggregate private data.
    return JsonResponse(media_usage(workspace_id, request.user.pk))


@data_endpoint(("GET", "HEAD"), media=True)
def media(request, workspace_id, asset_id):
    asset = MediaAsset.objects.filter(pk=asset_id, workspace_id=workspace_id).first()
    if asset is None:
        raise APIError("素材不存在", 404)
    etag = content_etag(asset)
    start, end, status = 0, asset.size - 1, 200
    supplied_range = request.headers.get("Range", "")
    if_range = request.headers.get("If-Range")
    if request.method == "GET" and supplied_range and (if_range is None or if_range == etag):
        try:
            start, end = media_range(supplied_range, asset.size)
            status = 206
        except APIError as error:
            response = JsonResponse({"error": error.message}, status=416)
            response["Content-Range"] = f"bytes */{asset.size}"
            return response
    stream = open_media(request.workspace_scope, asset)
    if request.method == "HEAD":
        stream.close()
        response = HttpResponse(content_type=asset.mime)
    else:
        response = StreamingHttpResponse(MediaChunks(stream, asset, request.user, start, end), status=status, content_type=asset.mime)
    response["Content-Length"] = str(end - start + 1)
    response["Accept-Ranges"] = "bytes"
    response["ETag"] = etag
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Disposition"] = content_disposition_header(asset.mime == "application/octet-stream", asset.filename)
    if status == 206:
        response["Content-Range"] = f"bytes {start}-{end}/{asset.size}"
    return response
