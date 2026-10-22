"""Operator configuration; secret contents and private paths never enter errors."""
import os
import stat
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


def secret_key(environment):
    key = environment.get("CREATIVE_BOARD_HOSTED_SECRET", "")
    location = environment.get("CREATIVE_BOARD_HOSTED_SECRET_FILE", "")
    if key and location:
        raise ImproperlyConfigured("Choose either the hosted secret environment value or secret file, not both.")
    if location:
        try:
            path = Path(location)
            if not path.is_absolute() or path.resolve() != path:
                raise ValueError()
            before = path.lstat()
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 4096:
                raise ValueError()
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
            descriptor = os.open(path, flags)
            with os.fdopen(descriptor, "rb") as source:
                opened = os.fstat(source.fileno())
                if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or not os.path.samestat(before, opened):
                    raise ValueError()
                raw = source.read(4097)
                after = os.fstat(source.fileno())
                if len(raw) > 4096 or (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or not os.path.samestat(after, path.lstat()):
                    raise ValueError()
            key = raw.decode("utf-8")
            # A file's final line ending is transport, but spaces can be part
            # of an existing environment key and must never silently rotate it.
            if key.endswith("\r\n"):
                key = key[:-2]
            elif key.endswith("\n"):
                key = key[:-1]
            if any(value in key for value in ("\n", "\r", "\x00")):
                raise ValueError()
        except (OSError, ValueError, UnicodeError):
            raise ImproperlyConfigured("Hosted secret file must be an unchanged regular readable absolute file, at most 4096 bytes.") from None
    if len(key) < 50:
        raise ImproperlyConfigured("Hosted secret must contain at least 50 characters.")
    return key
