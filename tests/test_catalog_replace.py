"""Catalog replacement keeps complete versions under short Windows read holds."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock
import assets
import test_server as server_tests


class CatalogReplaceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.index = Path(self.tmp.name) / 'given-catalog.json'
        self.pending = self.index.with_suffix('.tmp')
        self.before = b'{"given":"original"}'
        self.after = b'{"given":"authored"}'
        self.index.write_bytes(self.before)
        self.pending.write_bytes(self.after)
        self.patch = mock.patch.object(assets, 'INDEX', self.index)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.original_replace = os.replace

    @staticmethod
    def sharing_error(code=5):
        error = PermissionError('Given controlled Windows read hold')
        error.winerror = code
        return error

    def test_short_read_hold_then_exact_atomic_replacement(self):
        failures = [self.sharing_error(5), self.sharing_error(32)]
        def replace(source, target):
            if failures:
                raise failures.pop(0)
            return self.original_replace(source, target)
        with mock.patch.object(assets.os, 'replace', side_effect=replace) as operation, mock.patch.object(assets.time, 'sleep') as sleep:
            assets._replace_catalog(self.pending, self.before)
        self.assertEqual(operation.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [.02, .04])
        self.assertEqual(self.index.read_bytes(), self.after)
        self.assertFalse(self.pending.exists())

    def test_persistent_hold_keeps_complete_files_and_stops(self):
        failure = self.sharing_error()
        with mock.patch.object(assets.os, 'replace', side_effect=failure) as operation, mock.patch.object(assets.time, 'sleep') as sleep:
            with self.assertRaisesRegex(ValueError, '稍后再保存') as raised:
                assets._replace_catalog(self.pending, self.before)
        self.assertIs(raised.exception.__cause__, failure)
        self.assertEqual(operation.call_count, 5)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [.02, .04, .08, .16])
        self.assertEqual(self.index.read_bytes(), self.before)
        self.assertEqual(self.pending.read_bytes(), self.after)

    def test_unrelated_permission_errors_are_not_retried(self):
        for code in [None, 2, 33]:
            with self.subTest(code=code):
                failure = self.sharing_error(code)
                with mock.patch.object(assets.os, 'replace', side_effect=failure) as operation, mock.patch.object(assets.time, 'sleep') as sleep:
                    with self.assertRaises(PermissionError) as raised:
                        assets._replace_catalog(self.pending, self.before)
                self.assertIs(raised.exception, failure)
                self.assertEqual(operation.call_count, 1)
                sleep.assert_not_called()
                self.assertEqual(self.index.read_bytes(), self.before)
                self.assertEqual(self.pending.read_bytes(), self.after)

    def test_other_os_errors_are_not_retried(self):
        failure = OSError('Given unrelated filesystem failure')
        with mock.patch.object(assets.os, 'replace', side_effect=failure) as operation, mock.patch.object(assets.time, 'sleep') as sleep:
            with self.assertRaises(OSError) as raised:
                assets._replace_catalog(self.pending, self.before)
        self.assertIs(raised.exception, failure)
        self.assertEqual(operation.call_count, 1)
        sleep.assert_not_called()
        self.assertEqual(self.index.read_bytes(), self.before)
        self.assertEqual(self.pending.read_bytes(), self.after)

    def test_later_catalog_is_not_replaced_after_waiting(self):
        later = b'{"given":"later independent version"}'
        with mock.patch.object(assets.os, 'replace', side_effect=self.sharing_error()) as operation, mock.patch.object(assets.time, 'sleep', side_effect=lambda delay: self.index.write_bytes(later)):
            with self.assertRaisesRegex(ValueError, '已有新内容'):
                assets._replace_catalog(self.pending, self.before)
        self.assertEqual(operation.call_count, 1)
        self.assertEqual(self.index.read_bytes(), later)
        self.assertEqual(self.pending.read_bytes(), self.after)

    def test_removed_catalog_is_not_recreated_after_waiting(self):
        with mock.patch.object(assets.os, 'replace', side_effect=self.sharing_error()) as operation, mock.patch.object(assets.time, 'sleep', side_effect=lambda delay: self.index.unlink()):
            with self.assertRaisesRegex(ValueError, '已有新内容'):
                assets._replace_catalog(self.pending, self.before)
        self.assertEqual(operation.call_count, 1)
        self.assertFalse(self.index.exists())
        self.assertEqual(self.pending.read_bytes(), self.after)

    def test_new_catalog_created_during_wait_is_kept(self):
        self.index.unlink()
        later = b'{"given":"another creator"}'
        with mock.patch.object(assets.os, 'replace', side_effect=self.sharing_error(32)) as operation, mock.patch.object(assets.time, 'sleep', side_effect=lambda delay: self.index.write_bytes(later)):
            with self.assertRaisesRegex(ValueError, '已有新内容'):
                assets._replace_catalog(self.pending, None)
        self.assertEqual(operation.call_count, 1)
        self.assertEqual(self.index.read_bytes(), later)
        self.assertEqual(self.pending.read_bytes(), self.after)

    def test_initial_creation_can_finish_after_short_hold(self):
        self.index.unlink()
        first = True
        def replace(source, target):
            nonlocal first
            if first:
                first = False
                raise self.sharing_error(32)
            return self.original_replace(source, target)
        with mock.patch.object(assets.os, 'replace', side_effect=replace), mock.patch.object(assets.time, 'sleep'):
            assets._replace_catalog(self.pending, None)
        self.assertEqual(self.index.read_bytes(), self.after)
        self.assertFalse(self.pending.exists())

    def test_normal_replacement_does_not_wait(self):
        with mock.patch.object(assets.time, 'sleep') as sleep:
            assets._replace_catalog(self.pending, self.before)
        sleep.assert_not_called()
        self.assertEqual(self.index.read_bytes(), self.after)
        self.assertFalse(self.pending.exists())


@unittest.skipUnless(os.name == 'nt', 'Actual Windows file-sharing behavior')
class WindowsCatalogSharingHTTPTest(unittest.TestCase):
    request = server_tests.ServerTest.request

    def setUp(self):
        self.addCleanup(self.close_owned_server)
        server_tests.ServerTest.setUpClass.__func__(type(self))
        self.index = Path(self.tmp.name) / '素材目录.json'
        self.pending = self.index.with_suffix('.tmp')
        status, self.headers, raw = self.request('/api/assets')
        self.assertEqual(status, 200)
        self.catalog = json.loads(raw)
        self.catalog['assets'] = [{'id':'given-authored','title':'Given authored material','path':'','folder':'','mime':'text/plain','size':0,'notes':'Given retained authored words'}]
        self.before = self.index.read_bytes()

    def close_owned_server(self):
        process = getattr(self, 'process', None)
        if process is not None:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
            if process.stderr is not None:
                process.stderr.close()
            self.assertIsNotNone(process.poll())
        directory = getattr(self, 'tmp', None)
        if directory is not None:
            directory.cleanup()

    def worker_after_pending(self, action):
        errors = []
        done = threading.Event()
        def work():
            try:
                for _ in range(2000):
                    if self.pending.exists() and self.pending.stat().st_size:
                        break
                    time.sleep(.001)
                else:
                    raise AssertionError('Owned complete temporary catalog did not appear')
                action()
            except Exception as error:
                errors.append(error)
            finally:
                done.set()
        thread = threading.Thread(target=work)
        thread.start()
        return thread, done, errors

    def test_short_ordinary_reader_finishes_without_another_save(self):
        with self.index.open('rb') as held:
            self.assertEqual(held.read(1), self.before[:1])
            thread, done, errors = self.worker_after_pending(lambda: (time.sleep(.06), held.close()))
            try:
                status, _, raw = self.request('/api/assets', 'PUT', self.catalog, {'If-Match':self.headers['ETag']})
            finally:
                thread.join(timeout=3)
                held.close()
        self.assertTrue(done.is_set())
        self.assertEqual(errors, [])
        self.assertEqual(status, 200, raw)
        actual = self.index.read_bytes()
        self.assertEqual(json.loads(actual)['assets'], self.catalog['assets'])
        status, headers, body = self.request('/api/assets')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['assets'], self.catalog['assets'])
        self.assertEqual(headers['ETag'].strip('"'), hashlib.sha256(actual).hexdigest())
        self.assertFalse(self.pending.exists())
        histories = list((Path(self.tmp.name)/'历史记录/library/catalog').glob('*.json'))
        self.assertTrue(any(json.loads(p.read_bytes())['value'] == json.loads(self.before) for p in histories))

    def test_persistent_reader_preserves_catalog_then_explicit_retry(self):
        with self.index.open('rb') as held:
            self.assertEqual(held.read(1), self.before[:1])
            status, _, raw = self.request('/api/assets', 'PUT', self.catalog, {'If-Match':self.headers['ETag']})
            self.assertEqual(status, 400, raw)
            self.assertIn('稍后再保存', json.loads(raw)['error'])
            self.assertNotIn(str(self.index), json.loads(raw)['error'])
            self.assertEqual(self.index.read_bytes(), self.before)
            self.assertEqual(json.loads(self.pending.read_bytes())['assets'], self.catalog['assets'])
        status, _, raw = self.request('/api/assets', 'PUT', self.catalog, {'If-Match':self.headers['ETag']})
        self.assertEqual(status, 200, raw)
        self.assertEqual(json.loads(self.index.read_bytes())['assets'], self.catalog['assets'])
        self.assertFalse(self.pending.exists())

    def test_later_catalog_during_real_read_hold_is_not_overwritten(self):
        later = copy.deepcopy(self.catalog)
        later['assets'][0]['notes'] = 'Given independently later words'
        later_bytes = json.dumps(later, ensure_ascii=False).encode('utf-8')
        with self.index.open('rb') as held:
            self.assertEqual(held.read(1), self.before[:1])
            def change_then_release():
                self.index.write_bytes(later_bytes)
                time.sleep(.06)
                held.close()
            thread, done, errors = self.worker_after_pending(change_then_release)
            try:
                status, _, raw = self.request('/api/assets', 'PUT', self.catalog, {'If-Match':self.headers['ETag']})
            finally:
                thread.join(timeout=3)
                held.close()
        self.assertTrue(done.is_set())
        self.assertEqual(errors, [])
        self.assertEqual(status, 400, raw)
        self.assertIn('已有新内容', json.loads(raw)['error'])
        self.assertEqual(self.index.read_bytes(), later_bytes)
        self.assertEqual(json.loads(self.pending.read_bytes())['assets'], self.catalog['assets'])


if __name__ == '__main__':
    unittest.main()
