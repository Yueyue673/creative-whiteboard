import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.request
import test_server as server_tests


class FileStorageTest(unittest.TestCase):
    setUpClass = classmethod(server_tests.ServerTest.setUpClass.__func__)
    tearDownClass = classmethod(server_tests.ServerTest.tearDownClass.__func__)
    request = server_tests.ServerTest.request

    def upload(self, name, raw, folder=''):
        from urllib.parse import quote
        req = urllib.request.Request(
            self.base + '/api/assets/upload', data=raw, method='POST',
            headers={'X-File-Name': quote(name), 'X-Folder': quote(folder)})
        with urllib.request.urlopen(req) as response:
            return json.load(response)

    def register(self, paths, **options):
        return self.request('/api/assets/reference', 'POST',
                            {'paths': [str(p) for p in paths], **options})

    def test_identical_upload_reuses_file_and_catalog_entry(self):
        first = self.upload('unique-a.wav', b'unique PCM fixture A')
        again = self.upload('unique-a.wav', b'unique PCM fixture A')
        self.assertEqual(first['id'], again['id'])
        alias = self.upload('alternate-name.wav', b'unique PCM fixture A', 'audio')
        self.assertNotEqual(first['id'], alias['id'])
        self.assertEqual(first['path'], alias['path'])
        self.assertEqual(Path(alias['path']).read_bytes(), b'unique PCM fixture A')
        self.assertEqual(sum(p.read_bytes() == b'unique PCM fixture A'
                             for p in (Path(self.tmp.name) / '素材文件').iterdir()), 1)

    def test_modified_owned_file_is_not_reused_by_stale_hash(self):
        first = self.upload('unique-b.json', b'{"fixture":"B1"}')
        stored = Path(first['path'])
        stored.write_bytes(b'{"fixture":"B2"}')
        os.utime(stored, ns=(stored.stat().st_atime_ns, first['contentMtime'] + 10_000_000))
        second = self.upload('unique-b.json', b'{"fixture":"B1"}')
        self.assertNotEqual(first['path'], second['path'])
        self.assertEqual(stored.read_bytes(), b'{"fixture":"B2"}')
        self.assertEqual(Path(second['path']).read_bytes(), b'{"fixture":"B1"}')

    def test_references_do_not_copy_and_relink_preserves_metadata(self):
        with tempfile.TemporaryDirectory() as source:
            first = Path(source) / 'clip.json'
            second = Path(source) / 'new-clip.json'
            first.write_text('{"fixture":"external"}', encoding='utf-8')
            second.write_text('{"fixture":"relocated"}', encoding='utf-8')
            files = Path(self.tmp.name) / '素材文件'
            before = set(files.glob('*'))
            status, _, raw = self.register([first], folder='references')
            self.assertEqual(status, 200)
            item = json.loads(raw)['assets'][0]
            self.assertEqual(Path(item['path']), first.resolve())
            self.assertTrue(item['isReference'])
            self.assertEqual(set(files.glob('*')), before)
            repeated = json.loads(self.register([first], folder='references')[2])['assets'][0]
            self.assertEqual(item['id'], repeated['id'])
            _, headers, raw = self.request('/api/assets')
            catalog = json.loads(raw)
            record = next(a for a in catalog['assets'] if a['id'] == item['id'])
            record.update(notes='保留自己的说明', tags=['观察'])
            self.assertEqual(self.request('/api/assets', 'PUT', catalog,
                                         {'If-Match': headers['ETag']})[0], 200)
            status, _, raw = self.register([second], replaceId=item['id'])
            self.assertEqual(status, 200)
            relinked = json.loads(raw)['assets'][0]
            self.assertEqual(relinked['id'], item['id'])
            self.assertEqual(relinked['notes'], '保留自己的说明')
            self.assertEqual(relinked['tags'], ['观察'])
            self.assertEqual(relinked['folder'], 'references')
            self.assertEqual(self.request('/api/media/' + item['id'])[2], second.read_bytes())
            self.assertTrue(first.exists())
            self.assertEqual(set(files.glob('*')), before)

    def test_reference_validation_is_atomic_and_local_only(self):
        with tempfile.TemporaryDirectory() as source:
            existing = Path(source) / 'valid.txt'
            existing.write_text('fixture', encoding='utf-8')
            before = self.request('/api/assets')[2]
            self.assertEqual(self.register([existing, Path(source) / 'missing.txt'])[0], 400)
            self.assertEqual(self.register(['relative.txt'])[0], 400)
            self.assertEqual(self.register([source])[0], 400)
            self.assertEqual(self.request('/api/assets')[2], before)
            self.assertEqual(self.request('/api/assets/reference', 'POST',
                                         {'paths': [str(existing)]},
                                         {'Origin': 'https://example.com'})[0], 403)

    def test_bundle_is_not_a_relocatable_file(self):
        _, headers, raw = self.request('/api/assets')
        catalog = json.loads(raw)
        catalog['assets'].append({'id': 'fixture-bundle', 'title': '内容组合', 'path': '',
                                  'folder': '', 'mime': 'application/x-creative-bundle',
                                  'bundle': {'nodes': [], 'edges': []}})
        self.assertEqual(self.request('/api/assets', 'PUT', catalog,
                                     {'If-Match': headers['ETag']})[0], 200)
        with tempfile.TemporaryDirectory() as source:
            file = Path(source) / 'valid.txt'
            file.write_text('fixture', encoding='utf-8')
            before = self.request('/api/assets')[2]
            self.assertEqual(self.register([file], replaceId='fixture-bundle')[0], 400)
            self.assertEqual(self.request('/api/assets')[2], before)

    def test_large_reference_uses_only_metadata(self):
        with tempfile.TemporaryDirectory() as source:
            file = Path(source) / 'large.mp4'
            with file.open('wb') as stream:
                stream.truncate(257 * 1024 * 1024)
            files = Path(self.tmp.name) / '素材文件'
            before = set(files.glob('*'))
            status, _, raw = self.register([file])
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(raw)['assets'][0]['size'], file.stat().st_size)
            self.assertEqual(set(files.glob('*')), before)


if __name__ == '__main__':
    unittest.main()
