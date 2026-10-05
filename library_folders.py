"""Stable library destinations, without changing existing catalogs during reads."""
import hashlib
import re
import uuid


def folder_paths(catalog):
    paths = set(catalog.get('folders', []))
    paths.update(a.get('folder', '') for a in catalog.get('assets', []) if not a.get('archived'))
    for path in list(paths):
        if not isinstance(path, str):
            continue
        parts = path.split('/')
        paths.update('/'.join(parts[:i]) for i in range(1, len(parts) + 1))
    return sorted(path for path in paths if isinstance(path, str) and path)


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', value) is not None


def validate_folder_ids(catalog):
    ids = catalog.get('folderIds', {})
    if not isinstance(ids, dict) or len(ids) > 20000:
        raise ValueError('文件夹编号格式无效')
    if any(not isinstance(path, str) or not path or not valid_id(identity) for path, identity in ids.items()):
        raise ValueError('文件夹编号格式无效')
    if len(set(ids.values())) != len(ids):
        raise ValueError('文件夹编号重复')


def folder_ids(catalog):
    """Legacy paths have repeatable read-only IDs until the next real edit."""
    given = catalog.get('folderIds', {})
    return {path: given.get(path) or 'legacy_' + hashlib.sha256(path.encode('utf-8')).hexdigest()[:32]
            for path in folder_paths(catalog)}


def with_folder_ids(catalog, previous=None):
    validate_folder_ids(catalog)
    result = dict(catalog)
    given = result.get('folderIds', {})
    old = folder_ids(previous) if previous is not None else {}
    result['folderIds'] = {path: given.get(path) or old.get(path) or uuid.uuid4().hex
                           for path in folder_paths(result)}
    validate_folder_ids(result)
    return result


def read_catalog(catalog):
    result = dict(catalog)
    result['folderIds'] = folder_ids(catalog)
    return result


def capture_destination(catalog, path, identity=None):
    if not isinstance(path, str) or len(path) > 1000:
        raise ValueError('存放位置无效')
    if identity and not valid_id(identity):
        raise ValueError('存放位置编号无效')
    return {'path': path, 'id': identity or folder_ids(catalog).get(path)}


def resolve_destination(catalog, target):
    if not target['id']:
        return target['path'], False
    path = next((path for path, identity in folder_ids(catalog).items() if identity == target['id']), None)
    return (path, False) if path is not None else ('', True)


def import_result(item, catalog, missing=False):
    return {**item, 'importFolderId': folder_ids(catalog).get(item.get('folder', ''), ''),
            **({'destinationMissing': True} if missing else {})}
