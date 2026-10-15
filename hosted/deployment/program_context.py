"""Explicit public program inputs; never walks a runtime/private data tree."""
import hashlib
import json
import os
import shutil
import stat
from pathlib import Path, PurePosixPath


class ContextError(ValueError):
    pass


BUILD_FILES = ('.dockerignore', 'hosted/Dockerfile', 'hosted/compose.yaml')


def program_files(root):
    root = Path(root).resolve()
    manifest = root / 'hosted/deployment/program_files.json'
    try:
        if manifest.resolve() != manifest or not manifest.is_file() or manifest.stat().st_nlink != 1 or manifest.stat().st_size > 65536:
            raise ValueError()
        value = json.loads(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise ContextError('Program manifest cannot be read.') from None
    if not isinstance(value, dict) or set(value) != {'version', 'files'} or value['version'] != 1 or type(value['version']) is not int:
        raise ContextError('Unsupported program manifest.')
    files = value['files']
    if not isinstance(files, list) or not 1 <= len(files) <= 500 or any(not isinstance(name, str) for name in files) or len(set(name.casefold() for name in files)) != len(files):
        raise ContextError('Program paths must be a bounded unique list.')
    native_names = ()
    native_contract = root / 'hosted/deployment/native_files.json'
    if native_contract.exists():
        try:
            if native_contract.resolve() != native_contract or native_contract.stat().st_nlink != 1 or native_contract.stat().st_size > 16384:
                raise ValueError()
            native = json.loads(native_contract.read_text(encoding='utf-8'))
            native_names = native['files']
            import re
            if set(native) != {'version', 'files'} or type(native['version']) is not int or native['version'] != 1 or not isinstance(native_names, list) or not 1 <= len(native_names) <= 80 or len(set(native_names)) != len(native_names) or any(not isinstance(n, str) or not re.fullmatch(r'[a-z][a-z0-9-]*\.(js|css|html)', n) for n in native_names):
                raise ValueError()
        except (OSError, ValueError, TypeError, KeyError):
            raise ContextError('Original workbench program contract is invalid.') from None
    for name in files:
        path = PurePosixPath(name)
        allowed_root = name in native_names or name in ('LICENSE', 'board_schema.py', 'library_folders.py', 'vendor/markdown-it.min.js', 'vendor/markdown-it.LICENSE')
        if str(path) != name or path.is_absolute() or any(part in ('..', '.') or part.startswith('.') for part in path.parts) or any(char in name for char in ':\\*?[]\x00\r\n'):
            raise ContextError('Program paths must be exact relative files.')
        if not allowed_root and not name.startswith(('hosted/core/', 'hosted/service/', 'hosted/deployment/')) and name not in ('hosted/manage.py', 'hosted/requirements.txt', 'hosted/requirements-runtime.txt'):
            raise ContextError('Program path is outside reviewed runtime roots.')
        if path.suffix.lower() in ('.key', '.pem', '.log', '.sqlite3', '.pyc') or any(part in ('data', 'backups', 'tests', '__pycache__') for part in path.parts) or path.name.startswith('test_') or path.name == 'tests.py':
            raise ContextError('Runtime data and test inputs are not program files.')
        source = root / name
        if source.resolve() != source or not source.is_file() or source.stat().st_nlink != 1:
            raise ContextError('Program input must be an existing independent regular file.')
    return tuple(files)


def export_context(root, destination):
    """Copy only the manifest and three build controls into a new empty tree."""
    root, destination = Path(root).resolve(), Path(destination)
    if not destination.is_absolute() or destination.resolve() != destination.absolute() or destination.is_symlink() or destination.exists():
        raise ContextError('Build destination must be a new independent directory.')
    files = (*program_files(root), *BUILD_FILES)
    if destination.is_relative_to(root):
        raise ContextError('Build destination must be outside the source checkout.')
    for name in BUILD_FILES:
        source = root / name
        if source.resolve() != source or not source.is_file() or source.stat().st_nlink != 1:
            raise ContextError('Build control must be an existing independent regular file.')
    destination.mkdir(mode=0o700, parents=True)
    hashes = {}
    for name in files:
        source, target = root / name, destination / name
        before = source.lstat()
        descriptor = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_BINARY', 0))
        with os.fdopen(descriptor, 'rb') as stream:
            opened = os.fstat(stream.fileno())
            if not os.path.samestat(before, opened) or opened.st_nlink != 1 or not stat.S_ISREG(opened.st_mode):
                raise ContextError('Program input changed during export.')
            raw = stream.read(8 * 1024 * 1024 + 1); after = os.fstat(stream.fileno())
        if len(raw) > 8 * 1024 * 1024 or not os.path.samestat(after, source.lstat()) or (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or source.resolve() != source:
            raise ContextError('Program input changed or exceeded its export bound.')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(raw)
        shutil.copymode(source, target)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    return hashes
