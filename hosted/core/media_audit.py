"""Bounded, offline metadata inventory. No blob reads, cleanup or reference proof."""
import hashlib
import hmac
import os
import re
import stat
import time
import uuid
from pathlib import Path

from django.conf import settings

from .models import MediaAsset, UploadReservation, Workspace
from .services import APIError

MAX_RECORDS = 10000
MAX_ENTRIES = 10000
MAX_FINDINGS = 500
MAX_SECONDS = 5.0
HEX = re.compile(r"^[a-f0-9]{32}$")
FILES = {"media": re.compile(r"^([a-f0-9]{32})\.blob$"), "incoming": re.compile(r"^([a-f0-9]{32})\.part$")}
ROOT_NAMES = {"accounts.sqlite3", "accounts.sqlite3-wal", "accounts.sqlite3-shm", "accounts.sqlite3-journal",
              ".hosted-maintenance.lock", ".hosted-restore-incomplete"}


class AuditLimit(Exception):
    pass


def redirected(details):
    return stat.S_ISLNK(details.st_mode) or bool(getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def fingerprint(details):
    return (details.st_mode, details.st_size, details.st_mtime_ns, details.st_ctime_ns,
            details.st_dev, details.st_ino, details.st_nlink, getattr(details, "st_file_attributes", 0))


class Inventory:
    def __init__(self, lease):
        if not lease.offline:
            raise APIError("只读盘点也须先停止全部网页服务，并使用离线维护锁")
        lease.verify()
        self.lease, self.root = lease, Path(settings.HOSTED_DATA_ROOT)
        if not self.root.is_absolute() or self.root.resolve() != self.root or self.root != lease.root:
            raise APIError("原存储范围无法核对，未盘点其他目录", 503)
        self.deadline = time.monotonic() + MAX_SECONDS
        self.records, self.entries, self.checked, self.uninspected = 0, 0, {}, 0
        self.counts = {key: 0 for key in ("registeredMedia", "registeredSizeMismatch", "reservedFiles", "unregisteredFiles", "misplacedIdentity", "unknownEntries", "unsafeEntries")}
        self.findings, self.hidden = [], 0

    def tick(self):
        if time.monotonic() > self.deadline:
            raise AuditLimit

    def rows(self, model, fields):
        result = []
        for row in model.objects.order_by("pk").values_list(*fields).iterator(chunk_size=128):
            self.tick()
            if self.records >= MAX_RECORDS:
                raise AuditLimit
            self.records += 1
            result.append(row)
        return tuple(result)

    def details(self, path):
        # DirEntry metadata can be cached: take a fresh no-follow path stat.
        self.tick()
        value = path.lstat()
        key = fingerprint(value)
        if path in self.checked and self.checked[path] != key:
            raise APIError("存储条目在盘点中已改变，请重新盘点；未修改原文件", 409)
        self.checked[path] = key
        return value

    def children(self, path):
        before = self.details(path)
        if redirected(before) or not stat.S_ISDIR(before.st_mode):
            raise APIError("原存储目录无法安全盘点，未进入其他位置", 503)
        self.lease.verify()
        # Fixed depth only. Unknown directories and links are never recursed.
        with os.scandir(path) as stream:
            for entry in stream:
                self.tick()
                if self.entries >= MAX_ENTRIES:
                    raise AuditLimit
                self.entries += 1
                self.details(path)
                child = path / entry.name
                yield child, self.details(child)
        self.details(path)

    def finding(self, path, details, category, workspace=None, area=None, identifier=None):
        self.counts[category] += 1
        if redirected(details) or stat.S_ISDIR(details.st_mode):
            self.uninspected += 1
        if category == "registeredMedia":
            return
        row = {"entryToken": hmac.new(settings.SECRET_KEY.encode(), os.fsencode(path.relative_to(self.root)), hashlib.sha256).hexdigest(),
               "category": category, "workspace": str(workspace) if workspace else None,
               "area": area, "storageId": str(identifier) if identifier else None,
               "bytes": details.st_size if stat.S_ISREG(details.st_mode) and not redirected(details) else None,
               "deletionSafe": False}
        if len(self.findings) < MAX_FINDINGS:
            self.findings.append(row)
        else:
            self.hidden += 1

    def verify(self, snapshots):
        self.lease.verify()
        for path in tuple(self.checked):
            self.details(path)
        # No SQL update/lock-version write: the service lifetime lease supplies
        # exclusion. A custom writer isn't entitled to bypass it.
        fresh = (self.rows(Workspace, ("id",)),
                 self.rows(MediaAsset, ("id", "workspace_id", "size", "revision_token")),
                 self.rows(UploadReservation, ("id", "workspace_id", "size")))
        if fresh != snapshots:
            raise APIError("登记范围在盘点中已改变，请重新盘点；未修改原记录", 409)
        self.lease.verify()


def audit_media(lease):
    audit = Inventory(lease)
    complete, reason, snapshots = False, None, None
    try:
        snapshots = (audit.rows(Workspace, ("id",)),
                     audit.rows(MediaAsset, ("id", "workspace_id", "size", "revision_token")),
                     audit.rows(UploadReservation, ("id", "workspace_id", "size")))
        known = {row[0].hex: row[0] for row in snapshots[0]}
        assets = {(row[1], row[0]): row[2] for row in snapshots[1]}
        pending = {(row[1], row[0]) for row in snapshots[2]}
        anywhere = {}
        for rows in snapshots[1:]:
            for row in rows:
                anywhere.setdefault(row[0], set()).add(row[1])
        for root_child, root_stat in audit.children(audit.root):
            if root_child.name in ROOT_NAMES:
                if redirected(root_stat) or not stat.S_ISREG(root_stat.st_mode) or root_stat.st_nlink != 1:
                    audit.finding(root_child, root_stat, "unsafeEntries")
                continue
            if root_child.name != "workspaces":
                audit.finding(root_child, root_stat, "unsafeEntries" if redirected(root_stat) else "unknownEntries")
                continue
            if redirected(root_stat) or not stat.S_ISDIR(root_stat.st_mode):
                audit.finding(root_child, root_stat, "unsafeEntries")
                continue
            for directory, directory_stat in audit.children(root_child):
                workspace = known.get(directory.name)
                if redirected(directory_stat) or not stat.S_ISDIR(directory_stat.st_mode):
                    audit.finding(directory, directory_stat, "unsafeEntries", workspace)
                    continue
                if workspace is None or not HEX.fullmatch(directory.name):
                    audit.finding(directory, directory_stat, "unknownEntries")
                    continue
                for area, area_stat in audit.children(directory):
                    if redirected(area_stat) or not stat.S_ISDIR(area_stat.st_mode):
                        audit.finding(area, area_stat, "unsafeEntries" if redirected(area_stat) else "unknownEntries", workspace)
                        continue
                    if area.name not in FILES:
                        audit.finding(area, area_stat, "unknownEntries", workspace)
                        continue
                    for entry, details in audit.children(area):
                        match = FILES[area.name].fullmatch(entry.name)
                        identifier = uuid.UUID(match[1]) if match else None
                        key = (workspace, identifier)
                        if redirected(details) or not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
                            category = "unsafeEntries"
                        elif identifier is None:
                            category = "unknownEntries"
                        elif identifier in anywhere and anywhere[identifier] != {workspace}:
                            category = "misplacedIdentity"
                        elif area.name == "media" and key in assets:
                            category = "registeredMedia" if details.st_size == assets[key] else "registeredSizeMismatch"
                        elif key in pending:
                            category = "reservedFiles"
                        elif identifier in anywhere:
                            category = "misplacedIdentity"
                        else:
                            category = "unregisteredFiles"
                        audit.finding(entry, details, category, workspace, area.name, identifier)
        # Re-read snapshots with the same independent record bound, not a doubled
        # budget that would mark every store near its maximum as incomplete.
        audit.records = 0
        audit.verify(snapshots)
        complete = True
    except AuditLimit:
        reason = "budget"
        lease.verify()
    except (OSError, ValueError):
        raise APIError("存储条目无法核对或在盘点中改变，请重新盘点；未修改原文件", 503) from None
    return {"format": "creative-media-inventory-v1", "enumerationComplete": complete, "limitReason": reason,
            "entriesChecked": audit.entries, "counts": audit.counts, "findings": audit.findings,
            "hiddenFindings": audit.hidden, "uninspectedSubtrees": audit.uninspected,
            "referenceSafetyChecked": False, "contentIntegrityChecked": False, "deletionSafe": False,
            "limits": {"records": MAX_RECORDS, "entries": MAX_ENTRIES, "findings": MAX_FINDINGS, "seconds": MAX_SECONDS},
            "notice": "只读盘点，未删除、修复或重新登记任何文件。未登记不等于无用；没有检查内容完整性或白板、历史和任何成员私有输入中的关联。未知目录和链接未深入，受限结果不代表完整范围。"}
