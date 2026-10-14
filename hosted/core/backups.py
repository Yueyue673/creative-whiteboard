"""Offline snapshots of the currently implemented SQLite + workspace store.

All service workers must use the lifetime lease. No archive extraction, live
backup promise, original overwrite or automatic removal of failed copies.
"""
import hashlib
import hmac
import json
import os
import re
import shutil
import sqlite3
import stat
import time
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from django.conf import settings

from .maintenance import RESTORE_MARKER
from .services import APIError

FORMAT = "creative-hosted-backup-v1"
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_ENTRIES = 100000
BACKUP_MARKER = ".incomplete"
REQUIRED_TABLES = {"core_account", "core_workspace", "core_membership", "core_invitation", "core_throttlebucket",
                   "core_initialization", "core_workspacedocument", "core_documentrevision", "core_conflictdraft",
                   "core_mediastoragebudget", "core_mediaasset", "core_uploadreservation", "core_accountsession", "django_session", "django_migrations"}


def plain_path(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path:
        raise APIError("存储位置必须是没有跳转的完整路径，未读取或写入其他位置")
    return path


def relative_path(value, *, directory=False):
    if not isinstance(value, str) or len(value) > 2048:
        raise APIError("备份清单路径无效")
    parts = value.split("/")
    if any(part in ("", ".", "..") or not re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts):
        raise APIError("备份清单路径无效")
    if value != "accounts.sqlite3" and not (parts[0] == "workspaces" and (directory or len(parts) > 1)):
        raise APIError("备份清单包含不支持的存储位置")
    if directory and value == "accounts.sqlite3":
        raise APIError("数据库不能作为目录")
    return PurePosixPath(value)


def file_details(path):
    plain_path(path)
    details = path.stat()
    if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
        raise APIError("存储含链接或非常规文件，操作已停止")
    return (details.st_size, details.st_mtime_ns, details.st_ctime_ns, details.st_dev, details.st_ino)


def tree_inventory(root):
    plain_path(root)
    if not root.is_dir():
        raise APIError("存储目录不存在")
    directories, files = [], {}
    def walk(directory):
        for path in sorted(directory.iterdir()):
            plain_path(path)
            name = path.relative_to(root).as_posix()
            if path.is_dir():
                directories.append(name)
                walk(path)
            else:
                files[name] = file_details(path)
            if len(directories) + len(files) > MAX_ENTRIES:
                raise APIError("存储条目超过本版备份清单限制")
    walk(root)
    return sorted(directories), files


def sync_directory(directory):
    # Windows does not support fsync on an ordinary directory handle. File data
    # is explicitly flushed on both platforms; Linux directory entries are too.
    if os.name != "nt":
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def write_new(path, raw):
    plain_path(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())


def transfer_file(source, *, destination=None, expected=None):
    before = file_details(source)
    if expected is not None and before[0] != expected["size"]:
        raise APIError("文件大小与备份清单不符，操作已停止")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
    descriptor = os.open(source, flags)
    digest, copied = hashlib.sha256(), 0
    with os.fdopen(descriptor, "rb") as stream:
        details = os.fstat(stream.fileno())
        # Windows stat(path) and fstat(handle) can report different meanings for
        # ctime. Compare their size/mtime/file identity, and compare handle ctime
        # only with the same handle after reading; path ctime likewise below.
        if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1 or (details.st_size, details.st_mtime_ns, details.st_dev, details.st_ino) != (before[0], before[1], before[3], before[4]):
            raise APIError("读取前的文件身份已改变")
        output = None
        try:
            if destination is not None:
                plain_path(destination)
                target = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
                output = os.fdopen(target, "wb")
            remaining = before[0]
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise APIError("文件在复制时被截断")
                if output:
                    output.write(chunk)
                digest.update(chunk)
                copied += len(chunk)
                remaining -= len(chunk)
            after = os.fstat(stream.fileno())
            if stream.read(1) or file_details(source) != before or (after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_dev, after.st_ino, after.st_nlink) != (details.st_size, details.st_mtime_ns, details.st_ctime_ns, details.st_dev, details.st_ino, details.st_nlink):
                raise APIError("文件在复制时已改变，未完成的副本需单独核对")
            if output:
                output.flush()
                os.fsync(output.fileno())
        finally:
            if output:
                output.close()
    result = {"size": copied, "sha256": digest.hexdigest()}
    if expected is not None and result != {"size": expected["size"], "sha256": expected["sha256"]}:
        raise APIError("文件内容与备份清单不符，操作已停止")
    return result


def database_profile(path, files):
    file_details(path)
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as database:
        database.execute("PRAGMA query_only=ON")
        if database.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or database.execute("PRAGMA foreign_key_check").fetchone():
            raise APIError("数据库完整性或关联核对失败")
        tables = sorted(row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
        if not REQUIRED_TABLES.issubset(tables):
            raise APIError("数据库缺少当前网页存储表")
        migrations = [row[0] for row in database.execute("SELECT name FROM django_migrations WHERE app='core' ORDER BY name")]
        supported = sorted(p.stem for p in (Path(__file__).parent / "migrations").glob("[0-9]*.py"))
        if migrations != supported:
            raise APIError("备份数据库与当前程序的迁移版本不一致，不能直接恢复")
        counts = {table: database.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0] for table in tables}
        registered = 0
        for identifier, workspace, size, content_hash in database.execute("SELECT id,workspace_id,size,content_hash FROM core_mediaasset"):
            try:
                name = f"workspaces/{uuid.UUID(workspace).hex}/media/{uuid.UUID(identifier).hex}.blob"
            except (ValueError, TypeError, AttributeError):
                raise APIError("数据库素材编号无效") from None
            if files.get(name) != {"size": size, "sha256": content_hash}:
                raise APIError("已登记素材缺失或内容不符，未把不完整备份标记为可恢复")
            registered += 1
    return {"tables": counts, "coreMigrations": migrations, "registeredFiles": registered}


def read_manifest_bytes(path):
    before = file_details(path)
    if before[0] > MAX_MANIFEST_BYTES:
        raise APIError("备份清单超过大小限制")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0))
    with os.fdopen(descriptor, "rb") as stream:
        details = os.fstat(stream.fileno())
        if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1 or (details.st_size, details.st_mtime_ns, details.st_dev, details.st_ino) != (before[0], before[1], before[3], before[4]):
            raise APIError("清单文件身份已改变")
        raw = stream.read(MAX_MANIFEST_BYTES + 1)
        after = os.fstat(stream.fileno())
        if len(raw) != before[0] or len(raw) > MAX_MANIFEST_BYTES or file_details(path) != before or (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (details.st_size, details.st_mtime_ns, details.st_ctime_ns):
            raise APIError("清单在读取时已改变或超过限制")
    return raw


def ensure_capacity(directory, needed):
    if shutil.disk_usage(directory).free < needed + settings.HOSTED_MIN_FREE_DISK_BYTES:
        raise APIError("副本空间不足，保留现有数据，未开始复制", 507)


def store_inventory(root):
    allowed = {"accounts.sqlite3", "accounts.sqlite3-journal", "accounts.sqlite3-wal", "accounts.sqlite3-shm", ".hosted-maintenance.lock", "workspaces"}
    for path in root.iterdir():
        plain_path(path)
        if path.name not in allowed:
            raise APIError("数据目录含本版备份范围外的条目，先单独核对，未忽略它")
        if path.name != "workspaces":
            file_details(path)
    if not (root / "accounts.sqlite3").is_file():
        raise APIError("账号数据库不存在，不能生成空备份")
    dirs, files = tree_inventory(root / "workspaces") if (root / "workspaces").exists() else ([], {})
    if (root / "workspaces").exists():
        dirs = ["workspaces"] + ["workspaces/" + name for name in dirs]
        files = {"workspaces/" + name: value for name, value in files.items()}
    for name in dirs:
        relative_path(name, directory=True)
    for name in files:
        relative_path(name)
    # Watch the WAL too: an unguarded custom writer must not silently produce a
    # mixed file/database snapshot. Shared-memory reader markers are excluded.
    database_state = {name: file_details(root / name) for name in ("accounts.sqlite3", "accounts.sqlite3-wal") if (root / name).exists()}
    return sorted(dirs), files, database_state


def backup_store(lease, destination):
    if not lease.offline:
        raise APIError("备份要求离线维护锁")
    lease.verify()
    root, destination = settings.HOSTED_DATA_ROOT, plain_path(destination)
    if destination.exists() or destination.is_relative_to(root) or root.is_relative_to(destination):
        raise APIError("备份必须使用数据目录之外的新目录，不能覆盖或递归复制现有存储")
    if not destination.parent.is_dir():
        raise APIError("请先创建备份的父目录")
    dirs, source_files, database_state = store_inventory(root)
    estimated = sum(info[0] for info in source_files.values()) + sum(info[0] for info in database_state.values())
    ensure_capacity(destination.parent, estimated)
    destination.mkdir(mode=0o700)
    write_new(destination / BACKUP_MARKER, b"Incomplete backup; never restore this directory.\n")
    payload = destination / "payload"
    payload.mkdir(mode=0o700)
    db_target = payload / "accounts.sqlite3"
    write_new(db_target, b"")
    # The SQLite backup API includes committed WAL data; copying just the main
    # database file would miss it. No writes to the original are requested.
    with closing(sqlite3.connect((root / "accounts.sqlite3").as_uri() + "?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(db_target)) as copied:
            deadline = time.monotonic() + 300
            def progress(status, remaining, total):
                lease.verify()
                if time.monotonic() > deadline:
                    raise APIError("数据库快照超过等待时间，请核对是否存在未停止的写入程序", 503)
            original.backup(copied, pages=1024, progress=progress)
    with db_target.open("r+b") as synced:
        os.fsync(synced.fileno())
    files = {"accounts.sqlite3": transfer_file(db_target)}
    for name in sorted(dirs, key=lambda value: (value.count("/"), value)):
        plain_path(payload / name).mkdir(mode=0o700)
    for name, before in sorted(source_files.items()):
        lease.verify()
        if file_details(root / name) != before:
            raise APIError("备份来源文件已改变，副本保持未完成状态")
        files[name] = transfer_file(root / name, destination=payload / name)
    if store_inventory(root) != (dirs, source_files, database_state):
        raise APIError("来源存储在备份期间已改变，不能确认副本完整")
    profile = database_profile(db_target, files)
    manifest = {"format": FORMAT, "createdAt": datetime.now(timezone.utc).isoformat(), "directories": dirs,
                "files": [{"path": name, **info} for name, info in sorted(files.items())], "database": profile}
    manifest_raw = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    if len(manifest_raw) > MAX_MANIFEST_BYTES:
        raise APIError("生成的清单超过本版大小限制，副本保持未完成状态")
    write_new(destination / "manifest.json", manifest_raw)
    result = verify_backup(destination, _allow_incomplete=True)
    lease.verify()
    for directory in [payload / name for name in reversed(sorted(dirs, key=lambda value: (value.count("/"), value)))] + [payload, destination]:
        sync_directory(directory)
    (destination / BACKUP_MARKER).unlink()
    sync_directory(destination)
    return result


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate manifest key")
        result[key] = value
    return result


def verify_backup(source, *, _allow_incomplete=False):
    source = plain_path(source)
    if not source.is_dir() or ((source / BACKUP_MARKER).exists() and not _allow_incomplete):
        raise APIError("备份不存在或未完成，不能用于恢复")
    expected_entries = {"manifest.json", "payload"} | ({BACKUP_MARKER} if _allow_incomplete else set())
    if {path.name for path in source.iterdir()} - expected_entries:
        raise APIError("备份含清单之外的根目录条目")
    manifest_path = source / "manifest.json"
    raw = read_manifest_bytes(manifest_path)
    try:
        manifest = json.loads(raw, object_pairs_hook=unique_object, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, UnicodeError):
        raise APIError("备份清单无效") from None
    if not isinstance(manifest, dict) or set(manifest) != {"format", "createdAt", "directories", "files", "database"} or manifest["format"] != FORMAT:
        raise APIError("不支持的备份清单格式")
    directories, entries = manifest["directories"], manifest["files"]
    if not isinstance(directories, list) or not isinstance(entries, list) or len(directories) + len(entries) > MAX_ENTRIES:
        raise APIError("备份清单条目无效或超过限制")
    for name in directories:
        relative_path(name, directory=True)
    if len(set(directories)) != len(directories):
        raise APIError("备份清单含重复目录")
    files = {}
    for item in entries:
        if not isinstance(item, dict) or set(item) != {"path", "size", "sha256"}:
            raise APIError("备份清单文件字段无效")
        relative_path(item["path"])
        if item["path"] in files or type(item["size"]) is not int or item["size"] < 0 or not isinstance(item["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise APIError("备份清单文件重复或摘要无效")
        files[item["path"]] = {"size": item["size"], "sha256": item["sha256"]}
    if "accounts.sqlite3" not in files:
        raise APIError("备份缺少账号数据库")
    actual_dirs, actual_files = tree_inventory(source / "payload")
    if actual_dirs != sorted(directories) or set(actual_files) != set(files):
        raise APIError("备份实际文件与清单范围不符")
    for name, expected in files.items():
        transfer_file(source / "payload" / name, expected=expected)
    profile = database_profile(source / "payload" / "accounts.sqlite3", files)
    if profile != manifest["database"]:
        raise APIError("备份数据库统计与清单不符")
    return {"verified": True, "manifestHash": hashlib.sha256(raw).hexdigest(), "fileCount": len(files),
            "fileBytes": sum(info["size"] for info in files.values()), "database": profile}


def restore_store(lease, source, expected_manifest_hash):
    if not lease.offline:
        raise APIError("恢复要求离线维护锁")
    lease.verify()
    root, source = settings.HOSTED_DATA_ROOT, plain_path(source)
    if source.is_relative_to(root) or root.is_relative_to(source):
        raise APIError("恢复目标不能在备份目录中，备份也不能放在目标中")
    if {path.name for path in root.iterdir()} - {".hosted-maintenance.lock"}:
        raise APIError("恢复仅支持新的空数据目录，不能覆盖现有存储")
    result = verify_backup(source)
    if not isinstance(expected_manifest_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_manifest_hash) or not hmac.compare_digest(result["manifestHash"], expected_manifest_hash):
        raise APIError("备份清单已改变或未提供核对摘要，请重新验证备份", 409)
    ensure_capacity(root, result["fileBytes"])
    manifest_raw = read_manifest_bytes(source / "manifest.json")
    if hashlib.sha256(manifest_raw).hexdigest() != result["manifestHash"]:
        raise APIError("恢复前备份清单已改变", 409)
    manifest = json.loads(manifest_raw)
    write_new(root / RESTORE_MARKER, b"Incomplete restore; hosted WSGI startup is blocked. Restore into a fresh empty store.\n")
    for name in sorted(manifest["directories"], key=lambda value: (value.count("/"), value)):
        lease.verify()
        plain_path(root / name).mkdir(mode=0o700)
    copied = {}
    for item in manifest["files"]:
        lease.verify()
        copied[item["path"]] = transfer_file(source / "payload" / item["path"], destination=root / item["path"], expected=item)
    if database_profile(root / "accounts.sqlite3", copied) != result["database"]:
        raise APIError("恢复后的数据库与原备份统计不符，保留未完成标记")
    for name, expected in copied.items():
        transfer_file(root / name, expected=expected)
    lease.verify()
    for directory in [root / name for name in reversed(sorted(manifest["directories"], key=lambda value: (value.count("/"), value)))] + [root]:
        sync_directory(directory)
    (root / RESTORE_MARKER).unlink()
    sync_directory(root)
    return {**result, "restored": True, "overwroteExistingData": False}
