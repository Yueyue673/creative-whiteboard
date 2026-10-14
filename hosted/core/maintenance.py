"""A persistent OS lock keeps offline maintenance separate from WSGI workers.

Never remove or replace the lock file: its inode is the coordination identity.
Linux workers share a lifetime lease; Windows currently supports one WSGI
process (its threads share the same lease). Kernel locks release after a crash.
"""
import os
import stat

from django.conf import settings

from .services import APIError

RESTORE_MARKER = ".hosted-restore-incomplete"


class StorageLease:
    def __init__(self, *, offline=False):
        self.descriptor = None
        self.offline = offline
        root = settings.HOSTED_DATA_ROOT
        target = root / ".hosted-maintenance.lock"
        try:
            if root.resolve() != root or target.resolve() != target:
                raise ValueError("redirected lock")
            if not offline and (root / RESTORE_MARKER).exists():
                raise APIError("上次恢复尚未完成，不能启动网页服务；请保留副本并恢复到新的空目录", 503)
            descriptor = os.open(target, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
            self.descriptor = descriptor
            details = os.fstat(descriptor)
            if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1 or not os.path.samestat(details, target.stat()):
                raise ValueError("invalid lock file")
            if os.name == "nt":
                import msvcrt
                # The byte range can extend past EOF; there is no need to write
                # a marker into a potentially contested lock file.
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, (fcntl.LOCK_EX if offline else fcntl.LOCK_SH) | fcntl.LOCK_NB)
            if root.resolve() != root or target.resolve() != target or not os.path.samestat(details, target.stat()):
                raise ValueError("lock location changed during acquisition")
            self.root = root
            self.target = target
            self.identity = details
        except (OSError, ValueError):
            self.close()
            raise APIError("存储正在被服务或维护占用，或维护锁无效；请停止全部网页服务后再核对，不能删除锁文件", 503) from None

    def verify(self):
        try:
            if self.descriptor is None or self.root.resolve() != self.root or self.target.resolve() != self.target:
                raise ValueError("lost maintenance lease")
            current = self.target.stat()
            if current.st_nlink != 1 or not os.path.samestat(self.identity, current) or not os.path.samestat(self.identity, os.fstat(self.descriptor)):
                raise ValueError("lock identity changed")
            if not self.offline and (self.root / RESTORE_MARKER).exists():
                raise ValueError("incomplete restore")
        except (OSError, ValueError):
            raise APIError("维护锁位置已改变，操作已停止；不能删除或替换锁文件", 503) from None

    def close(self):
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
