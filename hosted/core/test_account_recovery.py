import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import transaction
from django.db import close_old_connections
from django.test import Client, RequestFactory, TestCase, TransactionTestCase
from django.utils import timezone

from .account_recovery import apply_recovery, review_recovery
from .account_security import change_password
from .documents import put_document
from .models import Account, AccountSession, ConflictDraft, DocumentRevision, Membership, Workspace, WorkspaceDocument
from .scope import WorkspaceScope
from .services import APIError, create_personal_workspace, create_shared_workspace
from .sessions import SessionStore
from .test_documents import sample_board

OLD = "Independent-fixture-pear-749!"
NEW = "Different-fixture-stone-852!"


class AccountRecoveryTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user("owner@example.test", OLD, display_name="Owner", is_staff=True, is_superuser=True)
        self.other = Account.objects.create_user("other@example.test", OLD, display_name="Other")
        self.personal = create_personal_workspace(self.owner)
        self.other_personal = create_personal_workspace(self.other)
        self.shared = create_shared_workspace(self.owner, "Shared")
        Membership.objects.create(workspace=self.shared, account=self.other, role="editor")
        self.client.force_login(self.owner)
        self.second = Client(); self.second.force_login(self.owner)
        self.foreign = Client(); self.foreign.force_login(self.other)
        scope = WorkspaceScope(self.shared, "owner")
        _, tag = put_document(scope, self.owner, "board", "one", sample_board("first own words"), "new")
        put_document(scope, self.owner, "board", "one", sample_board("new own words"), tag)
        put_document(scope, self.owner, "board", "one", sample_board("own unsubmitted input"), tag)

    def preserved(self):
        return {model.__name__: list(model.objects.order_by("pk").values())
                for model in (Workspace, Membership, WorkspaceDocument, DocumentRevision, ConflictDraft)}

    def review(self):
        return review_recovery(self.owner.pk, self.owner.email)

    def apply(self, tag=None, **patches):
        if tag is None: _, tag = self.review()
        data = {"account_id": self.owner.pk, "email": self.owner.email, "expected": tag,
                "confirmation": str(self.owner.pk), "new_password": NEW, "repeated": NEW, **patches}
        return apply_recovery(**data)

    def test_review_is_read_only_and_does_not_expose_hashes_or_session_credentials(self):
        before = list(Account.objects.values()), list(AccountSession.objects.values()), self.preserved()
        plan, tag = self.review()
        self.assertEqual(plan["accountId"], self.owner.pk)
        self.assertEqual(plan["sessionsToRevoke"], 2)
        self.assertRegex(tag, r'^"[a-f0-9]{64}"$')
        raw = json.dumps(plan)
        for row in AccountSession.objects.all():
            self.assertNotIn(row.session_key, raw); self.assertNotIn(row.session_data, raw)
        self.assertNotIn(self.owner.password, raw)
        self.assertEqual((list(Account.objects.values()), list(AccountSession.objects.values()), self.preserved()), before)

    def test_recovery_changes_only_target_password_and_sessions_and_keeps_all_work_and_roles(self):
        values, sessions = self.preserved(), list(AccountSession.objects.filter(account=self.other).values())
        original = Account.objects.values().get(pk=self.owner.pk)
        result = self.apply()
        self.assertTrue(result["recovered"]); self.assertEqual(result["revokedSessions"], 2)
        self.assertEqual(self.preserved(), values)
        self.assertEqual(list(AccountSession.objects.filter(account=self.other).values()), sessions)
        after = Account.objects.values().get(pk=self.owner.pk)
        self.assertNotEqual(after.pop("password"), original.pop("password")); self.assertEqual(after, original)
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 0)
        self.assertIsNone(authenticate(email=self.owner.email, password=OLD))
        self.assertEqual(authenticate(email=self.owner.email, password=NEW).pk, self.owner.pk)
        self.assertIsNone(self.client.get("/api/session").json()["account"])
        self.assertIsNone(self.second.get("/api/session").json()["account"])
        self.assertEqual(self.foreign.get("/api/session").json()["account"]["id"], self.other.pk)
        fresh = Client(); self.assertTrue(fresh.login(email=self.owner.email, password=NEW))
        read = fresh.get(f"/w/{self.shared.pk}/api/boards/one", HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk))
        self.assertEqual(read.status_code, 200); self.assertEqual(read.json()["nodes"][0]["body"], "new own words")

    def test_mismatched_identity_confirmation_or_review_never_selects_another_account(self):
        _, tag = self.review(); before = list(Account.objects.values()), list(AccountSession.objects.values())
        for patches in ({"account_id": self.other.pk}, {"email": self.other.email}, {"account_id": 0},
                        {"expected": "wrong"}, {"expected": ""}, {"confirmation": ""}, {"confirmation": str(self.other.pk)}):
            with self.assertRaises((APIError, ValueError)): self.apply(tag, **patches)
        self.assertEqual((list(Account.objects.values()), list(AccountSession.objects.values())), before)

    def test_new_login_profile_password_or_disabled_account_invalidates_review(self):
        for change in (lambda: Account.objects.filter(pk=self.owner.pk).update(display_name="Changed"),
                       lambda: Account.objects.filter(pk=self.owner.pk).update(is_active=False),
                       lambda: Account.objects.filter(pk=self.owner.pk).update(password=self.other.password),
                       lambda: Client().force_login(self.owner)):
            with transaction.atomic():
                _, tag = self.review(); change()
                with self.assertRaises(APIError): self.apply(tag)
                transaction.set_rollback(True)

    def test_invalid_new_password_same_password_or_mismatch_preserves_hash_and_sessions(self):
        before = self.owner.password, list(AccountSession.objects.values())
        for patches in ({"new_password": OLD, "repeated": OLD}, {"new_password": "short", "repeated": "short"},
                        {"new_password": NEW, "repeated": "different"}, {"new_password": None}, {"new_password": "x" * 1025}):
            with self.assertRaises((APIError, ValidationError)): self.apply(**patches)
        self.owner.refresh_from_db(); self.assertEqual((self.owner.password, list(AccountSession.objects.values())), before)

    def test_expired_logins_are_included_and_excessive_review_is_bounded(self):
        AccountSession.objects.filter(session_key=self.second.session.session_key).update(expire_date=timezone.now() - timedelta(days=1))
        plan, tag = self.review(); self.assertEqual(plan["sessionsToRevoke"], 2); self.assertEqual(plan["unexpiredSessions"], 1)
        with patch("core.account_recovery.MAX_RECOVERY_SESSIONS", 1):
            with self.assertRaises(APIError): self.review()
            with self.assertRaises(APIError): self.apply(tag)
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 2)

    def test_session_delete_failure_rolls_back_password_and_all_original_logins(self):
        before = self.owner.password, list(AccountSession.objects.values())
        with patch("django.db.models.query.QuerySet.delete", side_effect=RuntimeError("synthetic deletion failure")):
            with self.assertRaises(RuntimeError): self.apply()
        self.owner.refresh_from_db(); self.assertEqual((self.owner.password, list(AccountSession.objects.values())), before)

    def test_old_plan_cannot_be_replayed_and_cached_old_hash_login_cannot_return(self):
        _, tag = self.review(); self.apply(tag)
        with self.assertRaises(APIError): self.apply(tag)
        stale = Client(); stale.force_login(self.owner)
        self.assertIsNone(stale.get("/api/session").json()["account"])
        self.assertIsNone(self.client.get("/api/session").json()["account"])

    def test_command_review_cancel_and_hidden_password_prompts_have_no_secret_outputs(self):
        out = io.StringIO(); before = list(Account.objects.values()), list(AccountSession.objects.values())
        with patch("builtins.input", side_effect=AssertionError("no confirmation")), patch("core.management.commands.recover_account.getpass", side_effect=AssertionError("no password")):
            call_command("recover_account", account_id=self.owner.pk, email=" OWNER@example.test ", review_only=True, stdout=out)
        self.assertEqual((list(Account.objects.values()), list(AccountSession.objects.values())), before)
        with patch("builtins.input", return_value=""), patch("core.management.commands.recover_account.getpass", side_effect=AssertionError("no password")):
            with self.assertRaises(CommandError): call_command("recover_account", account_id=self.owner.pk, email=self.owner.email, stdout=out)
        with patch("builtins.input", return_value=str(self.owner.pk)), patch("core.management.commands.recover_account.getpass", side_effect=[NEW, NEW]):
            call_command("recover_account", account_id=self.owner.pk, email=self.owner.email, stdout=out)
        self.assertNotIn(OLD, out.getvalue()); self.assertNotIn(NEW, out.getvalue()); self.assertNotIn(self.owner.password, out.getvalue())
        self.assertIn("原工作数据和权限保留", out.getvalue())

    def test_no_anonymous_web_recovery_route_or_password_command_argument_is_added(self):
        for path in ("/api/password-reset", "/api/account/recover", "/api/account/reset-password"):
            self.assertEqual(Client().post(path, data=json.dumps({"email": self.owner.email}), content_type="application/json").status_code, 404)
        with self.assertRaises((TypeError, CommandError)):
            call_command("recover_account", account_id=self.owner.pk, email=self.owner.email, password=NEW)

    def test_command_terminal_name_is_inert_and_invalid_email_or_interrupted_prompts_do_not_write(self):
        Account.objects.filter(pk=self.owner.pk).update(display_name="Original\n伪造编号：999\x1b[2J\u202e")
        out = io.StringIO()
        call_command("recover_account", account_id=self.owner.pk, email=self.owner.email, review_only=True, stdout=out)
        self.assertIn("Original\\n伪造编号", out.getvalue()); self.assertIn("\\u001b", out.getvalue()); self.assertIn("\\u202e", out.getvalue())
        self.assertNotIn("\x1b", out.getvalue()); self.assertNotIn("\u202e", out.getvalue())
        before = list(Account.objects.values()), list(AccountSession.objects.values())
        for address in ("invalid", "", None):
            with self.assertRaisesMessage(CommandError, "邮箱"):
                call_command("recover_account", account_id=self.owner.pk, email=address, stdout=io.StringIO())
        for error in (EOFError(), KeyboardInterrupt()):
            with patch("builtins.input", side_effect=error):
                with self.assertRaises(CommandError): call_command("recover_account", account_id=self.owner.pk, email=self.owner.email, stdout=io.StringIO())
        self.assertEqual((list(Account.objects.values()), list(AccountSession.objects.values())), before)

    def test_account_change_during_actual_command_prompts_refuses_the_old_review(self):
        def password_prompt(prompt):
            Account.objects.filter(pk=self.owner.pk).update(display_name="A newer reviewed identity")
            return NEW
        with patch("builtins.input", return_value=str(self.owner.pk)), patch("core.management.commands.recover_account.getpass", side_effect=password_prompt):
            with self.assertRaisesMessage(CommandError, "有变化"):
                call_command("recover_account", account_id=self.owner.pk, email=self.owner.email, stdout=io.StringIO())
        self.owner.refresh_from_db(); self.assertTrue(self.owner.check_password(OLD))
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 2)


class ConcurrentAccountRecoveryTests(TransactionTestCase):
    def setUp(self):
        self.owner = Account.objects.create_user("owner@example.test", OLD, display_name="Owner")
        self.space = create_personal_workspace(self.owner)
        self.client.force_login(self.owner)
        self.key = self.client.session.session_key

    def race(self, operations):
        barrier = Barrier(2, timeout=10)
        def worker(index):
            close_old_connections()
            try:
                barrier.wait()
                try: return (index, 200, operations[index]())
                except APIError as error: return (index, error.status, None)
            finally: close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(worker, (0, 1)))

    def test_two_concurrent_recoveries_only_one_can_apply_the_reviewed_original_plan(self):
        _, tag = review_recovery(self.owner.pk, self.owner.email)
        results = self.race([lambda: apply_recovery(self.owner.pk, self.owner.email, tag, str(self.owner.pk), NEW, NEW),
                             lambda: apply_recovery(self.owner.pk, self.owner.email, tag, str(self.owner.pk), NEW + "2", NEW + "2")])
        self.assertEqual(sorted(row[1] for row in results), [200, 409])
        winner = next(row[0] for row in results if row[1] == 200)
        self.owner.refresh_from_db(); self.assertTrue(self.owner.check_password(NEW + ("2" if winner else "")))
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 0)

    def test_normal_authenticated_password_change_and_operator_recovery_preserve_the_serialized_winner(self):
        _, tag = review_recovery(self.owner.pk, self.owner.email)
        def change():
            request = RequestFactory().post("/")
            request.user = Account.objects.get(pk=self.owner.pk)
            request.session = SessionStore(self.key)
            return change_password(request, OLD, NEW + "normal", NEW + "normal")
        results = self.race([lambda: apply_recovery(self.owner.pk, self.owner.email, tag, str(self.owner.pk), NEW, NEW), change])
        self.owner.refresh_from_db()
        if results[0][1] == 200:
            self.assertEqual(results[1][1], 401)
            self.assertTrue(self.owner.check_password(NEW))
            self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 0)
        else:
            self.assertEqual([row[1] for row in results], [409, 200])
            self.assertTrue(self.owner.check_password(NEW + "normal"))
            self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 1)
