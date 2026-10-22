"""Review and discard only interrupted reservations with all WSGI workers stopped.

Registered assets are never candidates. Unreserved files need a separate future
audit and remain untouched here. File deletion cannot be rolled back with SQL:
on failure reservations stay accounted for and a fresh review can retry.
"""
import hashlib
import hmac
import os
import stat

from django.conf import settings
from django.db import connection, transaction

from .json_data import document_bytes
from .media import checked_storage, locked_budget
from .models import MediaAsset, UploadReservation
from .scope import WorkspaceScope
from .services import APIError


def file_snapshot(scope, area, identifier, *, maximum=None):
    target = checked_storage(scope, area, identifier)
    try:
        descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0))
    except FileNotFoundError:
        return None
    except OSError:
        raise APIError("待核对的上传文件不可用，未清理任何其他位置", 503) from None
    try:
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise OSError("not a private regular file")
            if maximum is not None and before.st_size > maximum:
                raise OSError("file exceeds recorded upload budget")
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
            after = os.fstat(stream.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise OSError("file changed while reviewing")
            if checked_storage(scope, area, identifier) != target or not os.path.samestat(after, target.stat()):
                raise OSError("file identity changed")
            return {"size": after.st_size, "sha256": digest.hexdigest(), "device": after.st_dev,
                    "inode": after.st_ino, "modifiedNs": after.st_mtime_ns, "changedNs": after.st_ctime_ns}
    except OSError:
        raise APIError("上传文件在核对时已改变或不是独立常规文件，请重新核对", 503) from None


@transaction.atomic
def review_uploads(lease):
    if not lease.offline:
        raise APIError("必须使用离线维护锁")
    lease.verify()
    locked_budget()
    rows = []
    for reservation in UploadReservation.objects.select_related("workspace").order_by("id"):
        scope = WorkspaceScope(reservation.workspace, "owner")
        asset = MediaAsset.objects.filter(pk=reservation.pk).first()
        limit = max(reservation.size, asset.size if asset else 0)
        files = {area: file_snapshot(scope, area, reservation.pk, maximum=limit) for area in ("incoming", "media")}
        registered = None
        if asset:
            # A corrupt/cross-workspace registration is not an interrupted file.
            # Preserve its reservation and all bytes until separately repaired.
            if asset.workspace_id != reservation.workspace_id or files["media"] is None or files["media"]["size"] != asset.size or files["media"]["sha256"] != asset.content_hash:
                raise APIError("已登记素材与上传占位不一致，未清理；请先单独核对素材完整性", 503)
            registered = {"workspace": str(asset.workspace_id), "size": asset.size, "sha256": asset.content_hash}
        rows.append({"id": str(reservation.pk), "workspace": str(reservation.workspace_id), "account": reservation.account_id,
                     "reservedBytes": reservation.size, "filename": reservation.filename, "folderId": reservation.folder_id,
                     "createdAt": reservation.created_at.isoformat(), "registered": registered, "files": files})
    payload = {"format": "creative-interrupted-uploads-v1", "storage": str(settings.HOSTED_DATA_ROOT),
               "database": str(connection.settings_dict["NAME"]), "rows": rows}
    token = hmac.new(settings.SECRET_KEY.encode(), document_bytes(payload), hashlib.sha256).hexdigest()
    discard = sum(snapshot["size"] for row in rows for area, snapshot in row["files"].items()
                  if snapshot is not None and not (row["registered"] and area == "media"))
    return {"planToken": token, "reservationCount": len(rows), "releasedReservationBytes": sum(row["reservedBytes"] for row in rows),
            "discardedFileBytes": discard, "registeredFilesPreserved": sum(bool(row["registered"]) for row in rows), "uploads": rows}


def discard_interrupted_uploads(lease, expected_token):
    if not isinstance(expected_token, str) or len(expected_token) != 64:
        raise APIError("需要完整的核对编号，不能跳过预览")
    with transaction.atomic():
        locked_budget()
        plan = review_uploads(lease)
        if not hmac.compare_digest(plan["planToken"], expected_token):
            raise APIError("上传占位、文件或存储已改变，旧核对编号失效；请重新预览", 409)
        # Review the entire set again before making the first filesystem change.
        for row in plan["uploads"]:
            reservation = UploadReservation.objects.select_related("workspace").get(pk=row["id"])
            scope = WorkspaceScope(reservation.workspace, "owner")
            for area, snapshot in row["files"].items():
                if row["registered"] and area == "media":
                    continue
                lease.verify()
                limit = max(row["reservedBytes"], row["registered"]["size"] if row["registered"] else 0)
                if file_snapshot(scope, area, reservation.pk, maximum=limit) != snapshot:
                    raise APIError("文件在清理时已改变，操作停止；请重新核对剩余上传占位", 409)
                if snapshot is not None:
                    checked_storage(scope, area, reservation.pk).unlink()
        lease.verify()
        UploadReservation.objects.filter(pk__in=[row["id"] for row in plan["uploads"]]).delete()
        return {"discardedReservations": plan["reservationCount"], "releasedReservationBytes": plan["releasedReservationBytes"],
                "discardedFileBytes": plan["discardedFileBytes"], "registeredFilesPreserved": plan["registeredFilesPreserved"]}
