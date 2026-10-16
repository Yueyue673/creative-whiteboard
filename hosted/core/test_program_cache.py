from django.conf import settings
from django.test import TestCase, override_settings

from .models import Account, Membership
from .services import create_personal_workspace


@override_settings(HOSTED_NATIVE_WORKBENCH=True)
class ProgramCacheTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create_user('cache@example.test', 'Synthetic-Password-44!', display_name='合成账号')
        self.space = create_personal_workspace(self.account)
        self.client.force_login(self.account)
        self.url = f'/w/{self.space.pk}/app/shell.js?account={self.account.pk}'

    def test_second_program_transfer_is_empty_and_html_is_never_cached(self):
        original = self.client.get(self.url)
        self.assertEqual(original.status_code, 200)
        self.assertGreater(len(original.content), 1000)
        cached = self.client.get(self.url, HTTP_IF_NONE_MATCH=original['ETag'])
        self.assertEqual(cached.status_code, 304)
        self.assertEqual(cached.content, b'')
        self.assertEqual(cached['Cache-Control'], 'private, no-cache')
        html = self.client.get(f'/w/{self.space.pk}/app/')
        self.assertEqual(html['Cache-Control'], 'no-store')
        self.assertNotIn('ETag', html)

    def test_etag_does_not_skip_fresh_account_or_workspace_authority(self):
        version = self.client.get(self.url)['ETag']
        other = Account.objects.create_user('other-cache@example.test', 'Synthetic-Password-55!', display_name='另一合成账号')
        self.client.force_login(other)
        self.assertEqual(self.client.get(self.url, HTTP_IF_NONE_MATCH=version).status_code, 404)
        self.client.force_login(self.account)
        Membership.objects.filter(workspace=self.space).delete()
        self.assertEqual(self.client.get(self.url, HTTP_IF_NONE_MATCH=version).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.url, HTTP_IF_NONE_MATCH=version).status_code, 401)

    def test_old_account_and_changed_program_cannot_get_wrong_cached_bytes(self):
        version = self.client.get(self.url)['ETag']
        wrong = self.client.get(self.url.replace(f'account={self.account.pk}', 'account=99999'), HTTP_IF_NONE_MATCH=version)
        self.assertEqual(wrong.status_code, 409)
        changed = self.client.get(self.url, HTTP_IF_NONE_MATCH='"stale-program"')
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed['ETag'], version)

    def test_only_reviewed_public_portal_programs_can_revalidate(self):
        original = self.client.get('/portal-assets/portal.js')
        self.assertEqual(self.client.get('/portal-assets/portal.js', HTTP_IF_NONE_MATCH=original['ETag']).status_code, 304)
        self.assertEqual(self.client.get('/portal-assets/settings.py', HTTP_IF_NONE_MATCH=original['ETag']).status_code, 404)
        self.assertEqual(self.client.get('/api/session')['Cache-Control'], 'no-store')
