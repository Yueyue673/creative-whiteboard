import gzip
import json

from django.conf import settings
from django.test import TestCase, override_settings

from .documents import document_etag, put_document
from .models import Account, ConflictDraft, WorkspaceDocument
from .scope import WorkspaceScope
from .services import create_shared_workspace


class CompressedRevisionTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('gzip@example.test', 'Synthetic-Strong-443!', display_name='合成压缩')
        self.space = create_shared_workspace(self.owner, '合成压缩工作区')
        self.scope = WorkspaceScope(self.space, 'owner')
        self.value = {'format': 'creative-board', 'version': 1, 'name': '合成大白板', 'nodes': [{'id': 'n', 'type': 'note', 'x': 10, 'y': 20, 'w': 300, 'h': 200, 'title': '合成', 'body': 'Synthetic padding. ' * 220}], 'edges': [], 'view': {'x': 0, 'y': 0, 'z': 1}}
        _, self.tag = put_document(self.scope, self.owner, 'board', 'large', self.value, 'new')
        self.client.force_login(self.owner)
        self.url = f'/w/{self.space.pk}/api/boards/large'
        self.identity = {'HTTP_X_CREATIVE_ACCOUNT': str(self.owner.pk)}

    def save(self, tag, value=None):
        return self.client.put(self.url, value or self.value, content_type='application/json', HTTP_IF_MATCH=tag, **self.identity)

    def test_compression_weakens_representation_but_not_application_revision(self):
        with override_settings(MIDDLEWARE=['django.middleware.gzip.GZipMiddleware', *settings.MIDDLEWARE]):
            response = self.client.get(self.url, HTTP_ACCEPT_ENCODING='gzip', **self.identity)
        self.assertEqual(response['Content-Encoding'], 'gzip')
        self.assertEqual(response['ETag'], 'W/' + self.tag)
        self.assertEqual(response['X-Creative-Revision'], self.tag)
        self.assertEqual(json.loads(gzip.decompress(response.content)), self.value)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.value['nodes'][0]['body'] += ' new'
        self.assertEqual(self.save(response['X-Creative-Revision']).status_code, 200)

    def test_weak_if_match_not_accepted_by_default(self):
        with override_settings(HOSTED_LEGACY_COMPRESSED_REVISION=False):
            response = self.save('W/' + self.tag)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], '内容版本格式无效')

    @override_settings(HOSTED_LEGACY_COMPRESSED_REVISION=True)
    def test_old_open_page_can_save_exact_current_revision_and_stale_still_conflicts(self):
        self.value['nodes'][0]['body'] += ' preserved old-page draft'
        response = self.save('W/' + self.tag)
        self.assertEqual(response.status_code, 200)
        current = response['X-Creative-Revision']
        self.assertNotEqual(current, self.tag)
        self.value['nodes'][0]['body'] += ' stale input'
        self.assertEqual(self.save('W/' + self.tag).status_code, 409)
        doc = WorkspaceDocument.objects.get(workspace=self.space, key='large')
        self.assertEqual(document_etag(doc), current)
        self.assertNotIn('stale input', doc.value['nodes'][0]['body'])
        self.assertEqual(ConflictDraft.objects.get().value, self.value)

    @override_settings(HOSTED_LEGACY_COMPRESSED_REVISION=True)
    def test_compatibility_does_not_accept_lists_wildcards_or_other_token_shapes(self):
        for invalid in ['*', 'W/*', 'W/new', 'w/' + self.tag, 'W/' + self.tag + ', ' + self.tag, 'W/"abc"', 'W/"' + 'A' * 64 + '"']:
            self.assertEqual(self.save(invalid).status_code, 400, invalid)
        self.assertEqual(WorkspaceDocument.objects.get(workspace=self.space, key='large').revision, 1)

    @override_settings(HOSTED_LEGACY_COMPRESSED_REVISION=True)
    def test_other_document_or_workspace_revision_is_not_an_authority(self):
        other = create_shared_workspace(self.owner, '另一个合成空间')
        _, tag = put_document(WorkspaceScope(other, 'owner'), self.owner, 'board', 'large', self.value, 'new')
        self.assertEqual(self.save('W/' + tag).status_code, 409)
        self.assertEqual(WorkspaceDocument.objects.get(workspace=self.space, key='large').revision, 1)

    @override_settings(HOSTED_LEGACY_COMPRESSED_REVISION=True)
    def test_compatibility_keeps_account_binding_and_fresh_permission_checks(self):
        self.identity['HTTP_X_CREATIVE_ACCOUNT'] = str(self.owner.pk + 1)
        self.assertEqual(self.save('W/' + self.tag).status_code, 409)
        self.identity['HTTP_X_CREATIVE_ACCOUNT'] = str(self.owner.pk)
        self.space.memberships.all().delete()
        self.assertEqual(self.save('W/' + self.tag).status_code, 404)
        self.assertEqual(WorkspaceDocument.objects.get(workspace=self.space, key='large').revision, 1)
