"""Bounded literal library entries; none of these fields authorize file reads."""
import re
import uuid

from board_schema import valid_board
from .services import APIError

BUNDLE = 'application/x-creative-bundle'
FILE_REFERENCE = 'application/x-creative-file-reference'


def validate_entries(value):
    entries = value['assets']
    if len(entries) > 10000:
        raise ValueError('内容库项目过多')
    ids = set()
    for entry in entries:
        if not isinstance(entry, dict) or entry.get('mime') not in (BUNDLE, FILE_REFERENCE):
            raise APIError('文件必须通过受保护的上传接口登记，不能使用客户端文件路径', 501)
        identity = entry.get('id')
        if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identity) or identity in ids:
            raise ValueError('内容库项目编号无效或重复')
        ids.add(identity)
        if not isinstance(entry.get('title'), str) or not entry['title'].strip() or len(entry['title']) > 1000:
            raise ValueError('内容库名称无效')
        folder = entry.get('folder', '')
        if not isinstance(folder, str) or len(folder) > 1000 or folder and any(part in ('', '.', '..') for part in folder.split('/')) or '\\' in folder or not entry.get('archived') and folder not in ['', *value['folders']]:
            raise ValueError('内容库项目目录不存在')
        if 'archived' in entry and type(entry['archived']) is not bool:
            raise ValueError('内容库收起状态无效')
        if 'archiveBatch' in entry and (not isinstance(entry['archiveBatch'], str) or len(entry['archiveBatch']) > 100):
            raise ValueError('内容库恢复批次无效')
        if not isinstance(entry.get('notes', ''), str) or len(entry.get('notes', '')) > 65536:
            raise ValueError('内容库备注过长')
        tags = entry.get('tags', [])
        if not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(tag, str) or len(tag) > 100 for tag in tags):
            raise ValueError('内容库标签无效')
        if entry['mime'] == FILE_REFERENCE:
            uuid.UUID(identity)
            if entry.get('path', ''):
                raise ValueError('登记文件快照不能包含文件系统路径')
        else:
            bundle = entry.get('bundle')
            if not isinstance(bundle, dict) or set(bundle) != {'nodes', 'edges'}:
                raise ValueError('内容组合无效')
            valid_board({'format': 'creative-board', 'version': 1, 'name': entry['title'], **bundle, 'view': {'x': 0, 'y': 0, 'z': 1}})
            if entry.get('path', ''):
                raise ValueError('内容组合不使用文件系统路径')
    trash = value.get('trash', [])
    if not isinstance(trash, list) or len(trash) > 1000 or any(not isinstance(row, dict) for row in trash):
        raise ValueError('内容库恢复记录无效')
