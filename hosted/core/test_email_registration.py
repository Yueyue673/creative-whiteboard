import re
from datetime import timedelta
from unittest.mock import patch

from django.core import mail
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .models import Account, Membership, Workspace


@override_settings(HOSTED_EMAIL_REGISTRATION=True, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', DEFAULT_FROM_EMAIL='whiteboard@example.test')
class EmailRegistrationTests(TestCase):
    def post(self, url, value, client=None):
        return (client or self.client).post(url, value, content_type='application/json')

    def send(self, email='new@example.test', client=None):
        response = self.post('/api/register/code', {'email': email}, client)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn('code', response.json())
        return re.search(r'(?<!\d)\d{6}(?!\d)', mail.outbox[-1].body)[0]

    def register(self, code, email='new@example.test', client=None, password='Original-Paper-Password-44!'):
        return self.post('/api/register', {'email': email, 'name': '合成注册', 'password': password, 'code': code}, client)

    def test_delivery_then_verified_account_and_private_workspace(self):
        code = self.send(' NEW@example.test ')
        self.assertEqual(mail.outbox[-1].to, ['new@example.test'])
        self.assertEqual(Account.objects.count(), 0)
        self.assertNotIn(code, str(dict(self.client.session)))
        response = self.register(code)
        self.assertEqual(response.status_code, 201, response.content)
        account = Account.objects.get(email='new@example.test')
        self.assertTrue(account.check_password('Original-Paper-Password-44!'))
        space = Workspace.objects.get(owner=account)
        self.assertEqual(space.kind, 'personal')
        self.assertEqual(Membership.objects.get(workspace=space).account, account)
        self.assertEqual(self.client.get('/api/session').json()['account']['id'], account.pk)

    def test_proof_bound_to_email_and_original_browser(self):
        code = self.send()
        self.assertEqual(self.register(code, client=Client()).status_code, 400)
        self.assertEqual(self.register(code, email='other@example.test').status_code, 400)
        self.assertEqual(Account.objects.count(), 0)
        self.assertEqual(self.register(code).status_code, 201)

    def test_wrong_expired_and_excessive_guesses_do_not_create_anything(self):
        code = self.send()
        for _ in range(8):
            self.assertEqual(self.register('999999' if code != '999999' else '111111').status_code, 400)
        self.assertEqual(self.register(code).status_code, 429)
        self.assertFalse(Account.objects.exists())

    def test_expiry_and_weak_password_keep_account_uncreated(self):
        code = self.send()
        self.assertEqual(self.register(code, password='short').status_code, 400)
        with patch('core.email_registration.timezone.now', return_value=timezone.now() + timedelta(minutes=11)):
            self.assertEqual(self.register(code).status_code, 400)
        self.assertFalse(Account.objects.exists())

    def test_delivery_failure_is_honest_and_leaves_no_challenge_or_account(self):
        with patch('core.email_registration.send_mail', side_effect=OSError('private SMTP detail')):
            response = self.post('/api/register/code', {'email': 'new@example.test'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private SMTP', response.content.decode())
        self.assertNotIn('email_registration', self.client.session)
        self.assertFalse(Account.objects.exists())

    def test_resend_throttle_and_server_disabled_do_not_send(self):
        self.send()
        self.assertEqual(self.post('/api/register/code', {'email': 'new@example.test'}).status_code, 429)
        self.assertEqual(len(mail.outbox), 1)
        with override_settings(HOSTED_EMAIL_REGISTRATION=False):
            self.assertEqual(self.post('/api/register/code', {'email': 'other@example.test'}).status_code, 503)
            self.assertEqual(self.register('123456').status_code, 503)
        self.assertEqual(len(mail.outbox), 1)

    def test_existing_account_is_untouched_and_response_not_enumerating(self):
        account = Account.objects.create_user('existing@example.test', 'Existing-Secret-443!', display_name='已有账号')
        before = account.password
        response = self.post('/api/register/code', {'email': account.email})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self.register('123456', email=account.email).status_code, 400)
        account.refresh_from_db()
        self.assertEqual(account.password, before)
        self.assertEqual(Account.objects.count(), 1)

    def test_transaction_failure_does_not_leave_orphan_account(self):
        code = self.send()
        with patch('core.email_registration.create_personal_workspace', side_effect=RuntimeError('fixture failure')):
            with self.assertRaises(RuntimeError):
                self.register(code)
        self.assertFalse(Account.objects.exists())
        self.assertFalse(Workspace.objects.exists())
        self.assertEqual(self.register(code).status_code, 201)

    def test_public_entry_does_not_load_authenticated_panels(self):
        html = self.client.get('/').content.decode()
        self.assertIn('/portal-assets/entry.css', html)
        self.assertNotIn('src="/portal-assets/account-panel.js"', html)
        self.assertNotIn('src="/portal-assets/workspace-search.js"', html)
        self.assertIn('id="emailCode"', html)

    def test_csrf_still_required_for_sending_and_registering(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.post('/api/register/code', {'email': 'new@example.test'}, client).status_code, 403)
        self.assertEqual(self.register('123456', client=client).status_code, 403)
