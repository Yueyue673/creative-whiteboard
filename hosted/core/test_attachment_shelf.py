import copy
import uuid
from unittest.mock import patch

from django.test import TestCase

from .documents import find_document, put_document
from .media import checked_storage
from .models import MediaAsset, UploadReservation
from .native_views import historical_library
from . import test_media as media_fixtures


class AttachmentShelfTests(TestCase):
    api = media_fixtures.MediaAPITests.api
    url = media_fixtures.MediaAPITests.url
    upload = media_fixtures.MediaAPITests.upload
    # This class reuses the existing isolated account, storage and API fixture.
    def setUp(self):
        media_fixtures.MediaAPITests.setUp(self)
        self.board = {'format': 'creative-board', 'version': 1, 'name': 'Given writer',
                      'nodes': [], 'edges': [], 'view': {'x': 0, 'y': 0, 'z': 1}}
        put_document(self.scope, self.owner, 'board', 'given-writer', self.board, 'new')

    def test_attachment_marker_roundtrip_collection_and_original_bytes(self):
        upload = self.upload(HTTP_X_ATTACHMENT_BOARD='given-writer')
        self.assertEqual(upload.status_code, 201, upload.content)
        asset = upload.json()
        self.assertEqual(asset['attachmentBoard'], 'given-writer')
        catalog = self.api('native/assets')
        value = catalog.json()
        item = next(a for a in value['assets'] if a['id'] == asset['id'])
        self.assertEqual(item['attachmentBoard'], 'given-writer')
        old = copy.deepcopy(value)
        del item['attachmentBoard']
        saved = self.api('native/assets', method='put', value=value, etag=catalog['ETag'])
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertNotIn('attachmentBoard', self.api('native/assets').json()['assets'][0])
        stale = self.api('native/assets', method='put', value=old, etag=catalog['ETag'])
        self.assertEqual(stale.status_code, 409)
        stored = find_document(self.shared.pk, 'library', 'catalog')
        snapshot = copy.deepcopy(stored.value);snapshot['assets'][0]['attachmentBoard']='given-writer'
        self.assertEqual(historical_library(snapshot, self.scope, self.owner)['assets'][0]['attachmentBoard'], 'given-writer')
        self.assertEqual(checked_storage(self.scope, 'media', uuid.UUID(asset['id'])).read_bytes(), self.raw)
        self.assertEqual(find_document(self.shared.pk, 'board', 'given-writer').value, self.board)

    def test_missing_source_and_invalid_marker_do_not_register_uploads(self):
        before = MediaAsset.objects.count()
        self.assertEqual(self.upload(HTTP_X_ATTACHMENT_BOARD='missing-board').status_code, 409)
        self.assertEqual(self.upload(HTTP_X_ATTACHMENT_BOARD='../private').status_code, 400)
        self.assertEqual(MediaAsset.objects.count(), before)
        self.assertFalse(UploadReservation.objects.exists())

    def test_catalog_refusal_rolls_back_file_and_registration_together(self):
        with patch('core.documents.put_document', return_value=({'saved': False}, 'new')):
            reply = self.upload(HTTP_X_ATTACHMENT_BOARD='given-writer')
        self.assertEqual(reply.status_code, 409, reply.content)
        self.assertFalse(MediaAsset.objects.exists())
        self.assertFalse(UploadReservation.objects.exists())
        self.assertIsNone(find_document(self.shared.pk, 'library', 'catalog'))
