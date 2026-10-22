from django.test import TestCase
from . import test_documents as fixtures
from .models import WorkspaceDocument


class ExactMetadataTests(TestCase):
    setUp = fixtures.DocumentAPITests.setUp
    url = fixtures.DocumentAPITests.url
    api = fixtures.DocumentAPITests.api
    create = fixtures.DocumentAPITests.create

    def test_boolean_numeric_and_decimal_metadata_changes_are_actually_stored(self):
        value = fixtures.sample_board()
        value['opaque'] = {'flag': True, 'amount': 1.0, 'authorText': '  Own\r\ntext 😀  '}
        tag = self.create(value=value)
        for next_value, expected_type in [(1, int), (False, bool), (0, int), (0.0, float)]:
            value['opaque']['flag'] = next_value
            result = self.api('boards/one', 'PUT', value, tag)
            self.assertEqual(result.status_code, 200)
            self.assertNotEqual(result['ETag'], tag)
            tag = result['ETag']
            stored = WorkspaceDocument.objects.get().value
            self.assertIs(type(stored['opaque']['flag']), expected_type)
            self.assertEqual(stored['opaque']['authorText'], value['opaque']['authorText'])
