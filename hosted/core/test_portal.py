import json
import uuid
from html.parser import HTMLParser

from django.test import Client, TestCase

from .models import Account, Invitation, Membership, Workspace
from .services import create_personal_workspace, create_shared_workspace, issue_invitation
from .tests import PASSWORD


class ContextParser(HTMLParser):
    def __init__(self, context_id='portal-context'):
        super().__init__(); self.inside = False; self.context = ''; self.context_id = context_id

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == self.context_id:
            self.inside = True

    def handle_data(self, text):
        if self.inside:
            self.context += text

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inside = False


class PortalTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('owner@example.test', PASSWORD, display_name='</script><b>作者</b>')
        self.other = Account.objects.create_user('other@example.test', PASSWORD, display_name='Other')
        self.personal = create_personal_workspace(self.owner)
        self.shared = create_shared_workspace(self.owner, 'Private workspace name')
        self.other_space = create_shared_workspace(self.other, 'Other space')
        Membership.objects.create(workspace=self.shared, account=self.other, role='editor')
        self.client.force_login(self.owner)

    def call(self, path, method='GET', value=None, identity=None):
        headers = {} if identity is None else {'HTTP_X_CREATIVE_ACCOUNT': str(identity)}
        return getattr(self.client, method.lower())(path, data=json.dumps(value) if value is not None else None, content_type='application/json', **headers)

    def test_html_bootstrap_escapes_authored_name_and_has_no_workspace_contents(self):
        response = self.client.get(f'/w/{self.shared.pk}/')
        self.assertEqual(response.status_code, 200)
        text = response.content.decode()
        parser = ContextParser(); parser.feed(text)
        value = json.loads(parser.context)
        self.assertEqual(value['account']['name'], self.owner.display_name)
        self.assertEqual(value['workspace'], str(self.shared.pk))
        self.assertNotIn('</script><b>作者</b>', text)
        self.assertNotIn(self.shared.name, text)
        self.assertIn("script-src 'self'", response['Content-Security-Policy'])
        self.assertNotIn('unsafe-inline', response['Content-Security-Policy'])
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertIn('creative_test_csrf', response.cookies)

    def test_anonymous_destination_is_a_login_shell_not_an_authority_or_data_leak(self):
        guest = Client()
        for path in ['/', '/join', f'/w/{self.personal.pk}/', f'/w/{uuid.uuid4()}/']:
            response = guest.get(path)
            self.assertEqual(response.status_code, 200)
            parser = ContextParser(); parser.feed(response.content.decode())
            self.assertIsNone(json.loads(parser.context)['account'])
            self.assertNotIn(self.owner.email, response.content.decode())
        self.assertEqual(guest.get(f'/w/{self.personal.pk}/api/workspace').status_code, 401)
        self.assertEqual(self.call(f'/w/{self.other_space.pk}/api/workspace', identity=self.owner.pk).status_code, 404)

    def test_only_explicit_portal_assets_are_served(self):
        for name, content_type in [('portal.js', 'text/javascript'), ('portal.css', 'text/css'),
                                   ('space-reading.js', 'text/javascript'),
                                   ('paper-reading.js', 'text/javascript'), ('paper-reading.css', 'text/css'),
                                   ('workspace-search.js', 'text/javascript'),
                                   ('account-panel.js', 'text/javascript'), ('account-panel.css', 'text/css'),
                                   ('note-references.js', 'text/javascript'), ('note-references.css', 'text/css'),
                                   ('board-views.js', 'text/javascript'), ('board-views.css', 'text/css'),
                                   ('board-frames.js', 'text/javascript'), ('board-frames.css', 'text/css'),
                                   ('board-tables.js', 'text/javascript'), ('board-tables.css', 'text/css'), ('table-model.js', 'text/javascript'),
                                   ('board-table-paste.js', 'text/javascript'), ('table-paste-model.js', 'text/javascript'),
                                   ('board-cell-notes.js', 'text/javascript'), ('board-cell-notes.css', 'text/css'), ('cell-notes-model.js', 'text/javascript'),
                                     ('board-cell-media.js', 'text/javascript'), ('cell-media-model.js', 'text/javascript'),
                                   ('media-cues.js', 'text/javascript'), ('media-cues.css', 'text/css'), ('media-cue-model.js', 'text/javascript'),
                                   ('board-transport.js', 'text/javascript'),
                                   ('board-drafts.js', 'text/javascript'),
                                   ('board-session.js', 'text/javascript'),
                                   ('board-editor.js', 'text/javascript'),
                                   ('board-editor.css', 'text/css'),
                                   ('board-media.js', 'text/javascript'),
                                   ('board-library.js', 'text/javascript'),
                                   ('board-metadata.js', 'text/javascript'),
                                   ('board-folders.js', 'text/javascript'),
                                   ('workspace-recovery.js', 'text/javascript'),
                                   ('browser-recovery.css', 'text/css'),
                                   ('archive-transport.js', 'text/javascript'),
                                   ('workspace-archive.js', 'text/javascript'),
                                   ('workspace-archive.css', 'text/css'),
                                   ('folder-plan.js', 'text/javascript'),
                                   ('markdown-it.js', 'text/javascript')]:
            response = self.client.get('/portal-assets/' + name)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response['Content-Type'].startswith(content_type))
            self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
            self.assertNotIn("script-src 'self'", response['Content-Security-Policy'])
        for path in ['/portal-assets/server.py', '/portal-assets/accounts.sqlite3', '/portal-assets/../views.py', '/index.html', '/data/accounts.sqlite3']:
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertEqual(self.client.post('/portal-assets/portal.js').status_code, 405)
        self.assertEqual(self.client.put('/').status_code, 405)

    def test_editor_shell_binds_account_workspace_key_and_never_embeds_board_contents(self):
        from .documents import put_document
        from .scope import WorkspaceScope
        value = {'format': 'creative-board', 'version': 1, 'name': 'Private authored board name',
                 'nodes': [{'id': 'n', 'type': 'note', 'x': 1, 'y': 2, 'w': 300, 'h': 100,
                            'body': 'Private authored note body'}], 'edges': []}
        put_document(WorkspaceScope(self.shared, 'owner'), self.owner, 'board', 'exact-key', value, 'new')
        for part, create in [('b', False), ('new', True)]:
            path = f'/w/{self.shared.pk}/{part}/exact-key/'
            response = self.client.get(path + '?next=https://example.test/elsewhere')
            self.assertEqual(response.status_code, 200)
            text = response.content.decode()
            parser = ContextParser('board-context'); parser.feed(text)
            context = json.loads(parser.context)
            self.assertEqual(context['account']['id'], self.owner.pk)
            self.assertEqual(context['workspace'], str(self.shared.pk))
            self.assertEqual(context['key'], 'exact-key')
            self.assertEqual(context['create'], create)
            self.assertEqual(context['destination'], path)
            for secret in [value['name'], value['nodes'][0]['body'], self.shared.name, self.owner.display_name]:
                self.assertNotIn(secret, text)
            self.assertIn('board-editor.js', text)
            self.assertNotIn('unsafe-inline', response['Content-Security-Policy'])
            self.assertIn("img-src 'self'", response['Content-Security-Policy'])
            self.assertIn("media-src 'self'", response['Content-Security-Policy'])
            self.assertEqual(response['Cache-Control'], 'no-store')
            self.assertEqual(self.client.post(path).status_code, 405)

    def test_editor_login_return_is_server_fixed_and_shell_does_not_grant_access(self):
        guest = Client()
        for part in ['b', 'new']:
            path = f'/w/{self.personal.pk}/{part}/exact-key/'
            response = guest.get(path + '?destination=https://example.test')
            parser = ContextParser(); parser.feed(response.content.decode())
            context = json.loads(parser.context)
            self.assertIsNone(context['account'])
            self.assertEqual(context['destination'], path)
            self.assertNotIn('board-editor.js', response.content.decode())
            self.assertNotIn('img-src', response['Content-Security-Policy'])
            self.assertNotIn('media-src', response['Content-Security-Policy'])
        path = f'/w/{self.other_space.pk}/b/exact-key/'
        self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(self.call(f'/w/{self.other_space.pk}/api/boards/exact-key', identity=self.owner.pk).status_code, 404)
        self.assertEqual(guest.get(f'/w/{self.personal.pk}/api/boards/exact-key').status_code, 401)
        for suffix in ['../outside', 'a/b', '%2F', 'x' * 101]:
            self.assertEqual(self.client.get(f'/w/{self.personal.pk}/b/{suffix}/').status_code, 404)

    def test_management_and_workspace_reads_require_original_account(self):
        for path in ['/api/workspaces', f'/w/{self.shared.pk}/api/workspace', f'/w/{self.shared.pk}/api/members', f'/w/{self.shared.pk}/api/invitations']:
            self.assertEqual(self.call(path).status_code, 428)
            self.assertEqual(self.call(path, identity=self.owner.pk).status_code, 200)
            changed = self.call(path, identity=self.other.pk)
            self.assertEqual(changed.status_code, 409)
            self.assertEqual(changed.json()['code'], 'account_changed')

    def test_old_home_cannot_create_under_new_cookie_account_or_logout_it(self):
        self.client.force_login(self.other)
        before = Workspace.objects.count()
        self.assertEqual(self.call('/api/workspaces', 'POST', {'name': 'Original author input'}, self.owner.pk).status_code, 409)
        self.assertEqual(Workspace.objects.count(), before)
        self.assertEqual(self.call('/api/logout', 'POST', {}, self.owner.pk).status_code, 409)
        self.assertEqual(self.call('/api/session').json()['account']['id'], self.other.pk)
        self.assertEqual(self.call('/api/logout', 'POST', {}, self.other.pk).status_code, 200)

    def test_old_owner_page_cannot_manage_second_owner_workspace(self):
        # Both cookies can legitimately own the same resource across a manual
        # transfer. The page identity still cannot become a newer authority.
        Workspace.objects.filter(pk=self.shared.pk).update(owner=self.other)
        Membership.objects.filter(workspace=self.shared, account=self.owner).update(role='editor')
        Membership.objects.filter(workspace=self.shared, account=self.other).update(role='owner')
        self.client.force_login(self.other)
        response = self.call(f'/w/{self.shared.pk}/api/invitations', 'POST', {'email': 'new@example.test', 'role': 'editor'}, self.owner.pk)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(Invitation.objects.exists())
        self.assertEqual(self.call(f'/w/{self.shared.pk}/api/members/{self.owner.pk}', 'DELETE', identity=self.owner.pk).status_code, 409)
        self.assertTrue(Membership.objects.filter(workspace=self.shared, account=self.owner).exists())

    def test_old_accept_cannot_use_a_new_matching_account(self):
        # Create a still-pending invitation for this existing account in the
        # original owner's workspace, then switch cookies before acceptance.
        Membership.objects.filter(workspace=self.shared, account=self.other).delete()
        invitation, token = issue_invitation(self.shared.pk, self.owner, self.other.email, 'viewer')
        self.client.force_login(self.other)
        changed = self.call('/api/invitations/accept', 'POST', {'token': token}, self.owner.pk)
        self.assertEqual(changed.status_code, 409)
        invitation.refresh_from_db(); self.assertIsNone(invitation.accepted_at)
        self.assertEqual(self.call('/api/invitations/accept', 'POST', {'token': token}, self.other.pk).status_code, 200)

    def test_old_login_form_does_not_replace_an_already_logged_in_account(self):
        response = self.call('/api/login', 'POST', {'email': self.other.email, 'password': PASSWORD})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'account_changed')
        self.assertEqual(self.call('/api/session').json()['account']['id'], self.owner.pk)

    def test_portal_policy_does_not_loosen_active_media_or_api_policy(self):
        for path in ['/api/session', f'/w/{self.shared.pk}/api/members']:
            response = self.call(path, identity=self.owner.pk)
            self.assertNotIn("script-src 'self'", response['Content-Security-Policy'])
            self.assertIn("default-src 'none'", response['Content-Security-Policy'])
            self.assertEqual(response['X-Frame-Options'], 'DENY')

    def test_missing_identity_blocks_all_authenticated_mutation_shapes(self):
        paths = [('/api/logout', 'POST', {}), ('/api/workspaces', 'POST', {'name': 'New'}), ('/api/invitations/accept', 'POST', {'token': 'x' * 43}), (f'/w/{self.shared.pk}/api/invitations', 'POST', {'email': 'new@example.test', 'role': 'editor'}), (f'/w/{self.shared.pk}/api/members/{self.other.pk}', 'PATCH', {'role': 'viewer'}), (f'/w/{self.shared.pk}/api/members/{self.other.pk}', 'DELETE', None)]
        for path, method, value in paths:
            self.assertEqual(self.call(path, method, value).status_code, 428, path)
        self.assertEqual(Membership.objects.get(workspace=self.shared, account=self.other).role, 'editor')
