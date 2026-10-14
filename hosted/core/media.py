"""Server-owned media identifiers, bounded transfers and explicit scope."""
import hashlib
import os
import re
import shutil
import stat
import uuid
from pathlib import Path
from urllib.parse import unquote_to_bytes

from django.conf import settings
from django.db import OperationalError, transaction
from django.db.models import F, Sum

from .documents import check_quota, find_document, require_current_editor, require_precondition, valid_key
from .json_data import document_bytes
from .models import Account, MediaAsset, MediaStorageBudget, Membership, UploadReservation
from .scope import valid_membership
from .services import APIError, locked_workspace


def locked_budget():
    if not MediaStorageBudget.objects.filter(pk=1).update(lock_version=F("lock_version")):
        raise APIError("素材容量记录未初始化，暂时不能上传", 503)


def original_filename(encoded):
    if not encoded or len(encoded) > 4096 or not encoded.isascii():
        raise APIError("文件名需使用 UTF-8 百分号编码")
    try:
        name = unquote_to_bytes(encoded).decode("utf-8")
    except UnicodeError:
        raise APIError("文件名编码无效") from None
    if not name.strip() or len(name) > 255 or name in (".", "..") or any(ch in name for ch in "\\/:") or any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        raise APIError("文件名无效")
    return name


def folder_location(workspace_id, folder_id):
    if not folder_id:
        return ""
    valid_key(folder_id)
    catalog = find_document(workspace_id, "library", "catalog")
    if catalog:
        for path, identity in catalog.value.get("folderIds", {}).items():
            if identity == folder_id:
                return path
    raise APIError("原资料库文件夹已不存在，未把素材放入其他位置", 409)


def total(query, field="size"):
    return query.aggregate(total=Sum(field))["total"] or 0


def media_usage(workspace_id, account_id):
    return {
        "workspaceBytes": total(MediaAsset.objects.filter(workspace_id=workspace_id)),
        "workspacePendingBytes": total(UploadReservation.objects.filter(workspace_id=workspace_id)),
        "workspaceLimitBytes": settings.HOSTED_MAX_WORKSPACE_MEDIA_BYTES,
        "accountUploadedBytes": total(MediaAsset.objects.filter(uploaded_by_id=account_id)),
        "accountPendingBytes": total(UploadReservation.objects.filter(account_id=account_id)),
        "accountLimitBytes": settings.HOSTED_MAX_ACCOUNT_MEDIA_BYTES,
        "singleUploadLimitBytes": settings.HOSTED_MAX_UPLOAD_BYTES,
    }


def checked_storage(scope, area, identifier, create=False):
    if area not in ("media", "incoming") or not isinstance(identifier, uuid.UUID):
        raise APIError("素材存储编号无效")
    try:
        root = scope.storage_root()
        directory = root / area
        # Do not resolve and accept a redirect, even into another workspace.
        for path in [root.parent, root, directory]:
            if path.resolve() != path or (path.exists() and not path.is_dir()):
                raise ValueError("redirected storage")
            if create:
                path.mkdir(exist_ok=True, mode=0o700)
                if path.resolve() != path:
                    raise ValueError("redirected storage")
        target = directory / (identifier.hex + (".blob" if area == "media" else ".part"))
        if target.resolve() != target:
            raise ValueError("redirected storage")
        return target
    except (OSError, ValueError):
        raise APIError("素材存储位置不可用，未读取或写入其他目录", 503) from None


def reserve_upload(scope, account, size, filename, folder_id):
    with transaction.atomic():
        locked_budget()
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        folder_location(workspace.pk, folder_id)
        pending = UploadReservation.objects.all()
        if pending.filter(account=account).count() >= settings.HOSTED_MAX_PENDING_UPLOADS_PER_ACCOUNT:
            raise APIError("正在上传的文件过多，请等待当前上传结束", 429)
        if workspace.media_assets.count() + pending.filter(workspace=workspace).count() >= settings.HOSTED_MAX_ASSETS:
            raise APIError("工作区的素材数量已达到限制", 413)
        state = media_usage(workspace.pk, account.pk)
        if state["workspaceBytes"] + state["workspacePendingBytes"] + size > state["workspaceLimitBytes"]:
            raise APIError("工作区素材容量已达到限制，本次文件未保存", 413)
        if state["accountUploadedBytes"] + state["accountPendingBytes"] + size > state["accountLimitBytes"]:
            raise APIError("账号上传容量已达到限制，本次文件未保存", 413)
        reserved = total(pending)
        if total(MediaAsset.objects.all()) + reserved + size > settings.HOSTED_MAX_TOTAL_MEDIA_BYTES:
            raise APIError("服务素材容量已达到限制，本次文件未保存", 413)
        if shutil.disk_usage(settings.HOSTED_DATA_ROOT).free < settings.HOSTED_MIN_FREE_DISK_BYTES + reserved + size:
            raise APIError("存储空间不足，本次文件未保存", 507)
        return UploadReservation.objects.create(workspace=workspace, account=account, size=size, filename=filename, folder_id=folder_id)


def sniff_mime(prefix, filename):
    # Only inert browser media types get an inline response. HTML, SVG, PDF and
    # everything else use an attachment regardless of the supplied extension.
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if prefix.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if prefix[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP":
        return "image/webp"
    if prefix.startswith(b"RIFF") and prefix[8:12] == b"WAVE":
        return "audio/wav"
    if prefix.startswith(b"fLaC"):
        return "audio/flac"
    if prefix.startswith(b"ID3") or (len(prefix) >= 2 and prefix[0] == 255 and prefix[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if prefix.startswith(b"OggS"):
        return "video/ogg" if Path(filename).suffix.lower() == ".ogv" else "audio/ogg"
    if prefix.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if len(prefix) >= 12 and prefix[4:8] == b"ftyp":
        return "audio/mp4" if Path(filename).suffix.lower() == ".m4a" else "video/mp4"
    return "application/octet-stream"


def metadata_size(asset):
    return len(document_bytes({"filename": asset.filename, "title": asset.title, "folderId": asset.folder_id, "notes": asset.notes, "tags": asset.tags, "mime": asset.mime, "size": asset.size, "contentHash": asset.content_hash}))


def asset_etag(asset):
    return '"' + hashlib.sha256(f"{asset.workspace_id}/{asset.pk}/{asset.revision_token}".encode()).hexdigest() + '"'


def content_etag(asset):
    return '"' + hashlib.sha256(f"{asset.workspace_id}/{asset.pk}/{asset.content_hash}/{asset.size}".encode()).hexdigest() + '"'


def asset_json(asset, account, folder_map=None):
    return {"id": str(asset.pk), "title": asset.title, "filename": asset.filename, "folderId": asset.folder_id,
            "folder": folder_map.get(asset.folder_id, "") if folder_map is not None else folder_location(asset.workspace_id, asset.folder_id), "mime": asset.mime, "size": asset.size,
            "contentHash": asset.content_hash, "notes": asset.notes, "tags": asset.tags,
            "etag": asset_etag(asset), "mediaURL": f"/w/{asset.workspace_id}/api/media/{asset.pk}?account={account.pk}"}


def cancel_upload(scope, reservation_id):
    # Only this unregistered upload's opaque ID is eligible for cleanup. On an
    # ambiguous database failure, keep both the reservation and file for later
    # reconciliation rather than risk deleting a successfully committed asset.
    with transaction.atomic():
        locked_budget()
        if MediaAsset.objects.filter(pk=reservation_id).exists():
            UploadReservation.objects.filter(pk=reservation_id).delete()
            return
        row = UploadReservation.objects.filter(pk=reservation_id, workspace=scope.workspace).first()
        if row is None:
            return
        for area in ("incoming", "media"):
            target = checked_storage(scope, area, row.pk)
            if target.exists():
                target.unlink()
        row.delete()


def upload_stream(scope, account, request, size, filename, folder_id):
    row = reserve_upload(scope, account, size, filename, folder_id)
    try:
        target = checked_storage(scope, "incoming", row.pk, create=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        digest = hashlib.sha256()
        prefix = b""
        with os.fdopen(os.open(target, flags, 0o600), "wb") as output:
            remaining = size
            while remaining:
                chunk = request.read(min(64 * 1024, remaining))
                if not chunk:
                    raise APIError("上传未完成，本次文件未保存，请保留原文件后重试")
                output.write(chunk)
                digest.update(chunk)
                if len(prefix) < 32:
                    prefix += chunk[:32 - len(prefix)]
                remaining -= len(chunk)
            output.flush()
            os.fsync(output.fileno())
        with transaction.atomic():
            locked_budget()
            workspace = locked_workspace(scope.workspace.pk)
            require_current_editor(workspace, account)
            folder_location(workspace.pk, row.folder_id)
            destination = checked_storage(scope, "media", row.pk, create=True)
            if destination.exists():
                raise APIError("上传存储编号已被占用，未替换现有文件", 409)
            os.rename(target, destination)
            asset = MediaAsset(
                id=row.pk, workspace=workspace, uploaded_by=account, filename=filename, title=filename,
                folder_id=row.folder_id, mime=sniff_mime(prefix, filename), size=size,
                content_hash=digest.hexdigest(), notes="", tags=[], byte_size=0,
            )
            asset.byte_size = metadata_size(asset)
            asset.save(force_insert=True)
            UploadReservation.objects.filter(pk=row.pk).delete()
            check_quota(workspace.pk)
            return asset
    except Exception:
        try:
            cancel_upload(scope, row.pk)
        except (APIError, OSError, OperationalError):
            # A crashed or interrupted transfer remains accounted for and can
            # be reconciled offline; it is never served as registered media.
            pass
        raise


def update_asset(scope, account, identifier, data, expected):
    expected = require_precondition(expected)
    if not isinstance(data, dict) or not data or set(data) - {"title", "notes", "tags", "folderId"}:
        raise APIError("素材编辑字段无效")
    if "title" in data and (not isinstance(data["title"], str) or not data["title"].strip() or len(data["title"]) > 1000):
        raise APIError("素材名称无效")
    if "notes" in data and (not isinstance(data["notes"], str) or len(data["notes"]) > 65536):
        raise APIError("素材备注过长，请保留当前输入")
    if "tags" in data and (not isinstance(data["tags"], list) or len(data["tags"]) > 50 or any(not isinstance(tag, str) or len(tag) > 100 for tag in data["tags"])):
        raise APIError("素材标签无效")
    if "folderId" in data and not isinstance(data["folderId"], str):
        raise APIError("素材文件夹编号无效")
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        asset = MediaAsset.objects.filter(pk=identifier, workspace=workspace).first()
        if asset is None:
            raise APIError("素材不存在", 404)
        if asset_etag(asset) != expected:
            return {"saved": False, "preserveDraft": True, "draftSaved": False, "error": "素材信息已被修改，本次输入未写入，请保留当前输入"}, asset
        folder_location(workspace.pk, data.get("folderId", asset.folder_id))
        for key, value in data.items():
            setattr(asset, "folder_id" if key == "folderId" else key, value)
        asset.byte_size = metadata_size(asset)
        asset.revision_token = uuid.uuid4()
        asset.save()
        check_quota(workspace.pk)
        return {"saved": True}, asset


def open_media(scope, asset):
    target = checked_storage(scope, "media", asset.pk)
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        descriptor = os.open(target, flags)
        try:
            details = os.fstat(descriptor)
            if not stat.S_ISREG(details.st_mode) or details.st_size != asset.size:
                raise OSError("registered media mismatch")
            return os.fdopen(descriptor, "rb")
        except Exception:
            os.close(descriptor)
            raise
    except OSError:
        raise APIError("登记的素材文件不可用，未读取其他文件", 503) from None


def media_range(value, size):
    match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", value)
    if not match:
        raise APIError("媒体范围无效", 416)
    first, last = match.groups()
    if not first and not last:
        raise APIError("媒体范围无效", 416)
    if first:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
    else:
        if int(last) == 0:
            raise APIError("媒体范围无效", 416)
        start, end = max(0, size - int(last)), size - 1
    if start >= size or end < start:
        raise APIError("媒体范围超出文件", 416)
    return start, end


class MediaChunks:
    def __init__(self, stream, asset, account, start, end):
        self.stream, self.asset, self.account = stream, asset, account
        self.remaining = end - start + 1
        stream.seek(start)

    def __iter__(self):
        try:
            while self.remaining:
                member = Membership.objects.select_related("workspace").filter(workspace_id=self.asset.workspace_id, account_id=self.account.pk).first()
                if not member or not valid_membership(member) or not Account.objects.filter(pk=self.account.pk, is_active=True).exists():
                    return
                chunk = self.stream.read(min(1024 * 1024, self.remaining))
                if not chunk:
                    return
                self.remaining -= len(chunk)
                yield chunk
        except (OSError, OperationalError):
            return
        finally:
            self.close()

    def close(self):
        self.stream.close()
