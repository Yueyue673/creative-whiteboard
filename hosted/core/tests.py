import hashlib
import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Barrier, local
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, close_old_connections, transaction
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from .models import Account, Initialization, Invitation, Membership, ThrottleBucket, Workspace
from .scope import WorkspaceScope
from . import services
from .services import APIError, accept_invitation, create_personal_workspace, create_shared_workspace, issue_invitation, throttle


PASSWORD = "A-staged-test-passphrase-924!"


class HostedFoundationTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_superuser("owner@example.test", PASSWORD, display_name="Owner")
        self.outsider = Account.objects.create_user("other@example.test", PASSWORD, display_name="Other")
        self.personal = create_personal_workspace(self.owner)
        self.other_personal = create_personal_workspace(self.outsider)
        self.shared = create_shared_workspace(self.owner, "A shared space")
        self.client.force_login(self.owner)

    def api(self, path, method="GET", data=None, client=None, **headers):
        client = client or self.client
        identity = client.session.get("_auth_user_id")
        if identity:
            headers.setdefault("HTTP_X_CREATIVE_ACCOUNT", str(identity))
        return getattr(client, method.lower())(path, data=json.dumps(data) if data is not None else None, content_type="application/json", **headers)

    def route(self, suffix="workspace", workspace=None):
        return f"/w/{(workspace or self.shared).id}/api/{suffix}"

    def invite(self, email="guest@example.test", role="editor"):
        response = self.api(self.route("invitations"), "POST", {"email": email, "role": role})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_workspace_lists_and_request_urls_are_account_owned(self):
        first = self.api("/api/workspaces").json()["workspaces"]
        self.assertEqual({row["id"] for row in first}, {str(self.personal.id), str(self.shared.id)})
        self.assertNotIn(str(self.other_personal.id), json.dumps(first))
        self.client.cookies["current_workspace"] = str(self.other_personal.id)
        session = self.client.session
        session["current_workspace"] = str(self.other_personal.id)
        session.save()
        for workspace in (self.shared, self.personal, self.shared):
            response = self.api(self.route(workspace=workspace))
            self.assertEqual(response.json()["id"], str(workspace.id))
            self.assertEqual(response.json()["api"], f"/w/{workspace.id}/api")
        self.assertEqual(self.api(self.route(workspace=self.other_personal)).status_code, 404)

    def test_private_workspace_and_management_cannot_be_forged(self):
        forged = {"name": "Another", "owner": self.outsider.pk, "kind": "personal"}
        self.assertEqual(self.api("/api/workspaces", "POST", forged).status_code, 400)
        self.assertEqual(self.api(self.route("invitations", self.personal), "POST", {"email": self.outsider.email, "role": "editor"}).status_code, 403)
        self.assertEqual(self.api(self.route("invitations"), "POST", {"email": self.outsider.email, "role": "owner"}).status_code, 400)
        self.assertEqual(self.api(self.route(f"members/{self.owner.pk}"), "DELETE").status_code, 403)
        self.assertEqual(self.api(self.route(f"members/{self.owner.pk}"), "PATCH", {"role": "viewer"}).status_code, 403)
        self.assertEqual(self.shared.owner_id, self.owner.pk)
        # Fail closed if a future import or manual database edit creates an invalid ACL.
        Membership.objects.create(workspace=self.other_personal, account=self.owner, role="editor")
        self.assertEqual(self.api(self.route(workspace=self.other_personal)).status_code, 404)
        listed = self.api("/api/workspaces").json()["workspaces"]
        self.assertNotIn(str(self.other_personal.id), {row["id"] for row in listed})

    def test_superuser_has_no_access_to_someone_elses_workspace(self):
        self.assertTrue(self.owner.is_superuser)
        self.assertEqual(self.api(self.route(workspace=self.other_personal)).status_code, 404)
        self.assertEqual(self.api(f"/w/{uuid.uuid4()}/api/workspace").status_code, 404)
        self.assertEqual(self.api("/w/------------------------------------/api/media/secret").status_code, 404)

    def test_invitation_is_email_bound_single_use_and_hash_only(self):
        invitation = self.invite(self.outsider.email, "viewer")
        stored = Invitation.objects.get(pk=invitation["invitation"]["id"])
        self.assertEqual(stored.token_digest, hashlib.sha256(invitation["token"].encode("ascii")).hexdigest())
        self.assertNotIn(invitation["token"], self.api(self.route("invitations")).content.decode())
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": invitation["token"]}).status_code, 403)
        self.client.force_login(self.outsider)
        accepted = self.api("/api/invitations/accept", "POST", {"token": invitation["token"]})
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(accepted.json()["role"], "viewer")
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": invitation["token"]}).status_code, 403)
        stored.refresh_from_db()
        self.assertEqual(stored.accepted_by_id, self.outsider.pk)
        self.assertIsNotNone(stored.accepted_at)

    def test_new_invitation_replaces_old_and_revocation_expiry_are_enforced(self):
        old = self.invite(self.outsider.email)
        current = self.invite(self.outsider.email)
        self.client.force_login(self.outsider)
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": old["token"]}).status_code, 403)
        self.client.force_login(self.owner)
        self.assertEqual(self.api(self.route(f"invitations/{current['invitation']['id']}"), "DELETE").status_code, 200)
        self.client.force_login(self.outsider)
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": current["token"]}).status_code, 403)
        self.client.force_login(self.owner)
        expired = self.invite(self.outsider.email)
        Invitation.objects.filter(pk=expired["invitation"]["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.client.force_login(self.outsider)
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": expired["token"]}).status_code, 403)
        self.assertFalse(Membership.objects.filter(workspace=self.shared, account=self.outsider).exists())

    def test_invited_registration_creates_personal_space_and_correct_shared_membership(self):
        invitation = self.invite()
        guest = Client()
        response = self.api("/api/register", "POST", {"email": " GUEST@EXAMPLE.TEST ", "password": PASSWORD, "name": "Guest's own name", "token": invitation["token"]}, client=guest)
        self.assertEqual(response.status_code, 201, response.content)
        account = Account.objects.get(email="guest@example.test")
        self.assertTrue(account.check_password(PASSWORD))
        self.assertFalse(account.is_superuser or account.is_staff)
        spaces = self.api("/api/workspaces", client=guest).json()["workspaces"]
        self.assertEqual(len(spaces), 2)
        self.assertEqual({row["role"] for row in spaces}, {"owner", "editor"})
        self.assertEqual(self.api(self.route(workspace=self.personal), client=guest).status_code, 404)
        self.assertEqual(self.api("/api/session", client=guest).json()["account"]["name"], "Guest's own name")

    def test_registration_is_invite_only_and_invalid_password_does_not_consume_invite(self):
        invitation = self.invite()
        guest = Client()
        data = {"email": "guest@example.test", "password": "123", "name": "Guest", "token": invitation["token"]}
        self.assertEqual(self.api("/api/register", "POST", data, client=guest).status_code, 400)
        data["password"] = PASSWORD
        data["token"] = "A" * 43
        self.assertEqual(self.api("/api/register", "POST", data, client=guest).status_code, 403)
        data["token"] = invitation["token"]
        data["email"] = "not-the-recipient@example.test"
        self.assertEqual(self.api("/api/register", "POST", data, client=guest).status_code, 403)
        self.assertEqual(Account.objects.count(), 2)
        stored = Invitation.objects.get(pk=invitation["invitation"]["id"])
        self.assertIsNone(stored.accepted_at)
        self.assertEqual(self.api("/api/register", "POST", data).status_code, 409)

    def test_registration_transaction_rolls_back_account_personal_space_and_membership(self):
        invitation = self.invite()
        counts = (Account.objects.count(), Workspace.objects.count(), Membership.objects.count())
        with patch("core.services.consume_invitation", side_effect=APIError("模拟写入失败", 409)):
            response = self.api("/api/register", "POST", {"email": "guest@example.test", "password": PASSWORD, "name": "Guest", "token": invitation["token"]}, client=Client())
        self.assertEqual(response.status_code, 409)
        self.assertEqual(counts, (Account.objects.count(), Workspace.objects.count(), Membership.objects.count()))
        self.assertIsNone(Invitation.objects.get(pk=invitation["invitation"]["id"]).accepted_at)

    def test_member_permissions_are_rechecked_for_an_already_open_session(self):
        invitation = self.invite(self.outsider.email)
        editor = Client()
        editor.force_login(self.outsider)
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": invitation["token"]}, client=editor).status_code, 200)
        self.assertEqual(self.api(self.route(), client=editor).status_code, 200)
        self.assertEqual(self.api(self.route("invitations"), client=editor).status_code, 403)
        self.assertEqual(self.api(self.route("uploads/example"), "PUT", {"authored": True}, client=editor).status_code, 501)
        self.assertEqual(self.api(self.route(f"members/{self.outsider.pk}"), "PATCH", {"role": "viewer"}).status_code, 200)
        self.assertEqual(self.api(self.route("uploads/example"), "PUT", {"authored": True}, client=editor).status_code, 403)
        members = self.api(self.route("members"), client=editor).json()["members"]
        self.assertTrue(all("email" not in row for row in members))
        self.assertEqual(self.api(self.route(f"members/{self.outsider.pk}"), "DELETE").status_code, 200)
        self.assertEqual(self.api(self.route(), client=editor).status_code, 404)
        self.assertEqual(self.api("/api/workspaces", client=editor).json()["workspaces"][0]["id"], str(self.other_personal.id))
        self.assertEqual(len(self.api("/api/workspaces", client=editor).json()["workspaces"]), 1)

    def test_cross_workspace_invitation_id_cannot_be_revoked(self):
        invitation = self.invite()
        second = create_shared_workspace(self.owner, "Second")
        self.assertEqual(self.api(self.route(f"invitations/{invitation['invitation']['id']}", second), "DELETE").status_code, 404)
        self.assertIsNone(Invitation.objects.get(pk=invitation["invitation"]["id"]).revoked_at)

    def test_invitation_revoke_does_not_silently_remove_an_accepted_member(self):
        invitation = self.invite(self.outsider.email)
        self.client.force_login(self.outsider)
        self.api("/api/invitations/accept", "POST", {"token": invitation["token"]})
        self.client.force_login(self.owner)
        self.assertEqual(self.api(self.route(f"invitations/{invitation['invitation']['id']}"), "DELETE").status_code, 409)
        self.assertTrue(Membership.objects.filter(workspace=self.shared, account=self.outsider).exists())

    def test_legacy_file_endpoints_are_never_exposed_and_future_routes_fail_closed(self):
        anonymous = Client()
        paths = ["uploads/example", "media/example", "preview/example/../../outside", "ai/tasks/example", "assets/reference"]
        for path in paths:
            self.assertEqual(self.api("/api/" + path).status_code, 404, path)
            self.assertEqual(self.api(self.route(path)).status_code, 404 if path == "ai/tasks/example" else 501, path)
            self.assertEqual(self.api(self.route(path, self.other_personal)).status_code, 404, path)
            self.assertEqual(self.api(self.route(path), client=anonymous).status_code, 401, path)
        # Saved-text search is now implemented, with the same fixed scope.
        search = "search?q=private"
        self.assertEqual(self.api("/api/" + search).status_code, 404)
        self.assertEqual(self.api(self.route(search)).status_code, 200)
        self.assertEqual(self.api(self.route(search, self.other_personal)).status_code, 404)
        self.assertEqual(self.api(self.route(search), client=anonymous).status_code, 401)
        for path in ["/server.py", "/index.html", "/data/accounts.sqlite3", "/admin/"]:
            self.assertEqual(self.api(path).status_code, 404, path)

    def test_namespace_storage_does_not_follow_symlinks_even_into_other_workspaces(self):
        scope = WorkspaceScope(self.shared, "owner")
        expected = settings.HOSTED_DATA_ROOT / "workspaces" / self.shared.id.hex
        self.assertEqual(scope.storage_root(), expected)
        self.assertNotEqual(scope.storage_root(), WorkspaceScope(self.personal, "owner").storage_root())
        original = Path.resolve
        for redirected in (settings.HOSTED_DATA_ROOT / "workspaces" / self.personal.id.hex, settings.HOSTED_DATA_ROOT.parent / "outside"):
            def resolve(path, *args, **kwargs):
                return redirected if path == expected else original(path, *args, **kwargs)
            with patch.object(Path, "resolve", resolve):
                with self.assertRaises(ValueError):
                    scope.storage_root()

    @override_settings(MAX_OWNED_SHARED_WORKSPACES=1, MAX_WORKSPACE_MEMBERS=1)
    def test_initial_workspace_and_member_quotas(self):
        self.assertEqual(self.api("/api/workspaces", "POST", {"name": "Over limit"}).status_code, 409)
        self.assertEqual(self.api(self.route("invitations"), "POST", {"email": "guest@example.test", "role": "editor"}).status_code, 409)

    @override_settings(MAX_WORKSPACE_MEMBERS=2)
    def test_member_quota_is_checked_again_when_accepting_not_only_when_inviting(self):
        first = self.invite(self.outsider.email)
        second = self.invite()
        self.client.force_login(self.outsider)
        self.assertEqual(self.api("/api/invitations/accept", "POST", {"token": first["token"]}).status_code, 200)
        response = self.api("/api/register", "POST", {"email": "guest@example.test", "password": PASSWORD, "name": "Guest", "token": second["token"]}, client=Client())
        self.assertEqual(response.status_code, 409)
        self.assertFalse(Account.objects.filter(email="guest@example.test").exists())

    def test_login_rotates_session_logout_and_disabled_accounts_cannot_continue(self):
        client = Client()
        session = client.session
        session["untrusted_before_login"] = "present"
        session.save()
        old_key = session.session_key
        response = self.api("/api/login", "POST", {"email": "OWNER@EXAMPLE.TEST", "password": PASSWORD}, client=client)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(client.session.session_key, old_key)
        self.assertEqual(self.api("/api/logout", "POST", client=client).status_code, 200)
        self.assertEqual(self.api("/api/session", client=client).json(), {"account": None})
        self.assertEqual(self.api(self.route(), client=client).status_code, 401)
        client.force_login(self.owner)
        Account.objects.filter(pk=self.owner.pk).update(is_active=False)
        self.assertEqual(self.api(self.route(), client=client).status_code, 401)
        self.assertEqual(self.api("/api/login", "POST", {"email": self.owner.email, "password": PASSWORD}, client=client).status_code, 401)

    def test_csrf_is_required_for_login_writes_and_logout_and_rotates_on_login(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.api("/api/login", "POST", {"email": self.owner.email, "password": PASSWORD}, client=client).status_code, 403)
        self.api("/api/session", client=client)
        old_csrf = client.cookies[settings.CSRF_COOKIE_NAME].value
        response = self.api("/api/login", "POST", {"email": self.owner.email, "password": PASSWORD}, client=client, HTTP_X_CSRFTOKEN=old_csrf)
        self.assertEqual(response.status_code, 200)
        new_csrf = client.cookies[settings.CSRF_COOKIE_NAME].value
        self.assertNotEqual(old_csrf, new_csrf)
        self.assertEqual(self.api("/api/workspaces", "POST", {"name": "A new space"}, client=client).status_code, 403)
        self.assertEqual(self.api("/api/workspaces", "POST", {"name": "A new space"}, client=client, HTTP_X_CSRFTOKEN=new_csrf, HTTP_ORIGIN="https://untrusted.example").status_code, 403)
        self.assertEqual(self.api("/api/workspaces", "POST", {"name": "A new space"}, client=client, HTTP_X_CSRFTOKEN=new_csrf).status_code, 201)
        self.assertEqual(self.api("/api/logout", "POST", client=client, HTTP_X_CSRFTOKEN=old_csrf).status_code, 403)
        self.assertEqual(self.api("/api/logout", "POST", client=client, HTTP_X_CSRFTOKEN=new_csrf).status_code, 200)

    @override_settings(LOGIN_ACCOUNT_LIMIT=2, LOGIN_IP_LIMIT=4)
    def test_database_throttle_survives_new_clients_and_spoofed_ip_header(self):
        now = timezone.now()
        # These attempts test one window, even when CI crosses a real boundary.
        with patch("core.services.timezone.now", return_value=now):
            for _ in range(2):
                self.assertEqual(self.api("/api/login", "POST", {"email": self.owner.email, "password": "wrong"}, client=Client()).status_code, 401)
            self.assertEqual(self.api("/api/login", "POST", {"email": self.owner.email, "password": PASSWORD}, client=Client()).status_code, 429)
            self.assertEqual(self.api("/api/login", "POST", {"email": "unused@example.test", "password": "wrong"}, client=Client()).status_code, 401)
            self.assertEqual(self.api("/api/login", "POST", {"email": "new@example.test", "password": "wrong"}, client=Client(), HTTP_X_REAL_IP="192.0.2.200", HTTP_X_FORWARDED_FOR="192.0.2.200").status_code, 429)
        for bucket in ThrottleBucket.objects.all():
            self.assertEqual(len(bucket.key), 64)
            self.assertNotIn("@", bucket.key)
            self.assertNotIn("127.0.0.1", bucket.key)

    @override_settings(LOGIN_ACCOUNT_LIMIT=2, LOGIN_IP_LIMIT=4)
    def test_login_ip_limit_rejects_last_window_attempt_and_allows_next_window(self):
        seconds = settings.THROTTLE_WINDOW_SECONDS
        now = timezone.now().replace(microsecond=0)
        start = now - timedelta(seconds=int(now.timestamp()) % seconds)
        with patch("core.services.timezone.now", return_value=start + timedelta(seconds=seconds - 1)):
            for index in range(4):
                self.assertEqual(self.api("/api/login", "POST", {"email": f"unused-{index}@example.test", "password": "wrong"}, client=Client()).status_code, 401)
            self.assertEqual(self.api("/api/login", "POST", {"email": "next@example.test", "password": "wrong"}, client=Client()).status_code, 429)
        with patch("core.services.timezone.now", return_value=start + timedelta(seconds=seconds)):
            self.assertEqual(self.api("/api/login", "POST", {"email": "next@example.test", "password": "wrong"}, client=Client()).status_code, 401)

    def test_secure_response_policy_host_and_bounded_json(self):
        response = self.api("/api/session")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response["Content-Security-Policy"])
        self.assertEqual(self.api("/api/health", HTTP_HOST="untrusted.example").status_code, 400)
        self.assertEqual(self.client.post("/api/workspaces", data="x", content_type="text/plain", HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk)).status_code, 415)
        self.assertEqual(self.client.post("/api/workspaces", data="{", content_type="application/json", HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk)).status_code, 400)
        self.assertEqual(self.api("/api/workspaces", "POST", {"name": "x" * 70000}).status_code, 413)
        self.assertEqual(self.api("/api/workspaces", "POST", ["wrong-shape"]).status_code, 400)
        self.assertEqual(self.client.post("/api/workspaces", data="[" * 2000 + "0" + "]" * 2000, content_type="application/json", HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk)).status_code, 400)
        self.assertEqual(self.api("/api/workspaces", "POST", {"name": "x", "currentWorkspace": str(self.other_personal.id)}).status_code, 400)

    def test_canonical_email_and_database_constraints(self):
        with transaction.atomic():
            with self.assertRaises(IntegrityError):
                Account.objects.create_user("OWNER@EXAMPLE.TEST", PASSWORD, display_name="Duplicate")
        with transaction.atomic():
            with self.assertRaises(IntegrityError):
                Workspace.objects.create(owner=self.owner, kind="personal", name="Duplicate personal space")


class BootstrapOwnerTests(TestCase):
    def test_first_account_is_local_interactive_and_cannot_be_created_twice(self):
        output = io.StringIO()
        with patch("core.management.commands.bootstrap_owner.getpass", side_effect=[PASSWORD, PASSWORD]):
            call_command("bootstrap_owner", email="first@example.test", name="First", stdout=output)
        owner = Account.objects.get(email="first@example.test")
        self.assertTrue(owner.is_staff and owner.is_superuser and owner.check_password(PASSWORD))
        self.assertEqual(owner.memberships.get().role, "owner")
        self.assertEqual(Initialization.objects.count(), 1)
        self.assertNotIn(PASSWORD, output.getvalue())
        with patch("core.management.commands.bootstrap_owner.getpass") as prompt:
            with self.assertRaises(CommandError):
                call_command("bootstrap_owner", email="second@example.test", name="Second", stdout=output)
            prompt.assert_not_called()

    def test_bad_password_and_failed_initialization_leave_no_partial_account(self):
        with patch("core.management.commands.bootstrap_owner.getpass", side_effect=["123", "123"]):
            with self.assertRaises(CommandError):
                call_command("bootstrap_owner", email="first@example.test", name="First", stdout=io.StringIO())
        self.assertEqual(Account.objects.count(), 0)
        self.assertEqual(Workspace.objects.count(), 0)
        self.assertEqual(Initialization.objects.count(), 0)


class ConcurrentMembershipTests(TransactionTestCase):
    """Real independent database connections, using a temporary file-backed store."""
    def setUp(self):
        self.owner = Account.objects.create_user("owner@example.test", PASSWORD, display_name="Owner")
        self.first = Account.objects.create_user("first@example.test", PASSWORD, display_name="First")
        self.second = Account.objects.create_user("second@example.test", PASSWORD, display_name="Second")
        self.shared = create_shared_workspace(self.owner, "Shared")

    def simultaneous_accept(self, attempts):
        barrier = Barrier(len(attempts), timeout=10)
        state = local()
        original = services.find_invitation

        def held_first_lookup(token):
            invitation = original(token)
            if not getattr(state, "looked_up", False):
                state.looked_up = True
                barrier.wait()
            return invitation

        def worker(attempt):
            close_old_connections()
            try:
                token, account_id = attempt
                account = Account.objects.get(pk=account_id)
                try:
                    accept_invitation(token, account)
                    return 200
                except APIError as error:
                    return error.status
            finally:
                close_old_connections()

        with patch("core.services.find_invitation", held_first_lookup), ThreadPoolExecutor(max_workers=len(attempts)) as executor:
            return list(executor.map(worker, attempts))

    def test_simultaneous_accept_of_same_invite_creates_one_member(self):
        invitation, token = issue_invitation(self.shared.id, self.owner, self.first.email, "editor")
        results = self.simultaneous_accept([(token, self.first.pk), (token, self.first.pk)])
        self.assertEqual(sorted(results), [200, 403])
        self.assertEqual(Membership.objects.filter(workspace=self.shared).count(), 2)
        invitation.refresh_from_db()
        self.assertEqual(invitation.accepted_by_id, self.first.pk)

    @override_settings(MAX_WORKSPACE_MEMBERS=2)
    def test_simultaneous_different_invites_cannot_exceed_member_limit(self):
        _, first_token = issue_invitation(self.shared.id, self.owner, self.first.email, "editor")
        _, second_token = issue_invitation(self.shared.id, self.owner, self.second.email, "viewer")
        results = self.simultaneous_accept([(first_token, self.first.pk), (second_token, self.second.pk)])
        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(Membership.objects.filter(workspace=self.shared).count(), 2)
        self.assertEqual(Invitation.objects.filter(accepted_at__isnull=False).count(), 1)

    def test_parallel_authentication_attempts_never_exceed_throttle(self):
        barrier = Barrier(8, timeout=10)
        now = timezone.now()

        def worker(_):
            close_old_connections()
            try:
                barrier.wait()
                try:
                    throttle(None, "test-login", "same-account", 4)
                    return True
                except APIError as error:
                    self.assertEqual(error.status, 429)
                    return False
            finally:
                close_old_connections()

        with patch("core.services.timezone.now", return_value=now), ThreadPoolExecutor(max_workers=8) as executor:
            accepted = list(executor.map(worker, range(8)))
        self.assertLessEqual(sum(accepted), 4)
        self.assertEqual(ThrottleBucket.objects.get().count, 8)
