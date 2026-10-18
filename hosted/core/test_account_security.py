import json
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY
from django.contrib.sessions.backends.base import UpdateError
from django.db import close_old_connections
from django.test import Client, RequestFactory, TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from .account_security import change_password, locked_account, revoke_logins
from .models import Account, AccountSession, WorkspaceDocument
from .services import APIError, create_personal_workspace
from .sessions import SessionStore
from .test_documents import sample_board

OLD = "Independent-fixture-pear-749!"
NEW = "Different-fixture-stone-852!"


@override_settings(ACCOUNT_REAUTH_LIMIT=100, ACCOUNT_REAUTH_IP_LIMIT=100)
class AccountSecurityTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user("owner@example.test", OLD, display_name="Owner")
        self.other = Account.objects.create_user("other@example.test", OLD, display_name="Other")
        self.space = create_personal_workspace(self.owner)
        self.client.force_login(self.owner)
        self.second = Client(); self.second.force_login(self.owner)
        self.foreign = Client(); self.foreign.force_login(self.other)

    def call(self, path="sessions", value=None, *, client=None, tag=None, identity=True):
        headers = {"HTTP_X_CREATIVE_ACCOUNT": str(self.owner.pk)} if identity else {}
        if tag is not None: headers["HTTP_IF_MATCH"] = tag
        return (client or self.client).generic("GET" if value is None else "POST", "/api/account/" + path,
                                             data="" if value is None else json.dumps(value), content_type="application/json", **headers)

    def listing(self):
        result = self.call(); self.assertEqual(result.status_code, 200, result.content)
        return result.json()["sessions"], result["ETag"]

    def change(self, **kwargs):
        return self.call("password", {"oldPassword": OLD, "newPassword": NEW, "confirmation": NEW, **kwargs})

    def test_list_only_own_active_valid_logins_without_bearer_secrets(self):
        rows, tag = self.listing()
        self.assertEqual(len(rows), 2); self.assertEqual(sum(row["current"] for row in rows), 1)
        result = json.dumps(rows)
        for row in AccountSession.objects.all():
            self.assertNotIn(row.session_key, result); self.assertNotIn(row.session_data, result)
        self.assertRegex(tag, r'^"[a-f0-9]{64}"$')
        self.assertEqual(self.call().get("Cache-Control"), "no-store")

    def test_expired_and_wrong_auth_hash_rows_not_listed(self):
        key = self.second.session.session_key
        AccountSession.objects.filter(session_key=key).update(expire_date=timezone.now()-timedelta(seconds=1))
        bad = SessionStore(); bad[SESSION_KEY] = str(self.owner.pk); bad[BACKEND_SESSION_KEY] = settings.AUTHENTICATION_BACKENDS[0]; bad[HASH_SESSION_KEY] = "wrong"; bad.save()
        self.assertEqual(len(self.listing()[0]), 1)

    def test_original_account_header_and_auth_required_for_every_route(self):
        rows, tag = self.listing(); target = next(row["id"] for row in rows if not row["current"])
        for path, data in [("sessions", None), ("password", {"oldPassword":OLD,"newPassword":NEW,"confirmation":NEW}),
                           (f"sessions/{target}/revoke", {"password":OLD,"confirm":True}), ("sessions/revoke-others", {"password":OLD,"confirm":True})]:
            self.assertEqual(self.call(path, data, identity=False, tag=tag).status_code, 428)
            self.assertEqual(self.call(path, data, client=self.foreign, tag=tag).status_code, 409)
            self.assertEqual(self.call(path, data, client=Client(), tag=tag).status_code, 401)
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 2)

    def test_only_post_mutates_and_unexpected_fields_rejected(self):
        self.assertEqual(self.call("password").status_code, 405)
        self.assertEqual(self.call("sessions", {"password":OLD}).status_code, 405)
        self.assertEqual(self.call("password", {"oldPassword":OLD,"newPassword":NEW,"confirmation":NEW,"account":self.other.pk}).status_code, 400)

    def test_wrong_password_weak_same_and_mismatched_confirmation_leave_everything(self):
        before = list(AccountSession.objects.values_list("session_key", "session_data"))
        for kwargs in [{"oldPassword":"bad"}, {"newPassword":"tiny","confirmation":"tiny"}, {"confirmation":"another"},
                       {"newPassword":OLD,"confirmation":OLD}, {"newPassword":True,"confirmation":True}]:
            self.assertEqual(self.change(**kwargs).status_code, 400)
        self.owner.refresh_from_db(); self.assertTrue(self.owner.check_password(OLD))
        self.assertEqual(list(AccountSession.objects.values_list("session_key", "session_data")), before)

    def test_password_change_rotates_current_keeps_it_and_invalidates_others(self):
        original_key = self.client.session.session_key; other_key = self.second.session.session_key
        foreign_key = self.foreign.session.session_key
        response = self.change(); self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["passwordChanged"])
        new_key = self.client.session.session_key; self.assertNotEqual(new_key, original_key)
        self.assertFalse(AccountSession.objects.filter(session_key__in=[original_key, other_key]).exists())
        self.assertTrue(AccountSession.objects.filter(session_key=foreign_key).exists())
        self.assertEqual(self.client.get("/api/session").json()["account"]["id"], self.owner.pk)
        self.assertIsNone(self.second.get("/api/session").json()["account"])
        guest = Client()
        self.assertEqual(guest.post("/api/login", json.dumps({"email":self.owner.email,"password":OLD}), content_type="application/json").status_code, 401)
        self.assertEqual(guest.post("/api/login", json.dumps({"email":self.owner.email,"password":NEW}), content_type="application/json").status_code, 200)

    def test_exact_other_revoke_leaves_current_and_other_account(self):
        rows, tag = self.listing(); target = next(row["id"] for row in rows if not row["current"])
        response = self.call(f"sessions/{target}/revoke", {"password":OLD,"confirm":True}, tag=tag)
        self.assertEqual(response.status_code, 200); self.assertEqual(response.json()["revoked"], 1)
        self.assertEqual(len(self.listing()[0]), 1)
        self.assertIsNone(self.second.get("/api/session").json()["account"])
        self.assertEqual(self.foreign.get("/api/session").json()["account"]["id"], self.other.pk)

    def test_own_current_record_cannot_be_revoked_by_other_login_action(self):
        rows, tag = self.listing(); current = next(row["id"] for row in rows if row["current"])
        self.assertEqual(self.call(f"sessions/{current}/revoke", {"password":OLD,"confirm":True}, tag=tag).status_code, 400)

    def test_foreign_public_id_never_authorizes_foreign_revocation(self):
        foreign_id = AccountSession.objects.get(account=self.other).public_id
        _, tag = self.listing()
        self.assertEqual(self.call(f"sessions/{foreign_id}/revoke", {"password":OLD,"confirm":True}, tag=tag).status_code, 404)
        self.assertEqual(AccountSession.objects.filter(account=self.other).count(), 1)

    def test_missing_review_wrong_password_and_nonboolean_confirmation_cannot_revoke(self):
        _, tag = self.listing()
        for value, expected_tag, status in [({"password":OLD,"confirm":True},None,428),
                                            ({"password":"wrong","confirm":True},tag,400),
                                            ({"password":OLD,"confirm":"yes"},tag,400)]:
            self.assertEqual(self.call("sessions/revoke-others", value, tag=expected_tag).status_code, status)
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 2)

    def test_new_login_changes_review_and_requires_explicit_rereview(self):
        _, tag = self.listing(); third = Client(); third.force_login(self.owner)
        self.assertEqual(self.call("sessions/revoke-others", {"password":OLD,"confirm":True}, tag=tag).status_code, 409)
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(), 3)
        _, tag = self.listing()
        result = self.call("sessions/revoke-others", {"password":OLD,"confirm":True}, tag=tag)
        self.assertEqual(result.json()["revoked"], 2); self.assertEqual(len(self.listing()[0]), 1)

    def test_cached_request_authority_rechecked_after_revocation(self):
        request = RequestFactory().post("/"); request.user = self.owner
        request.session = SessionStore(self.second.session.session_key)
        request.session["cached"] = True
        _, tag = self.listing()
        self.call("sessions/revoke-others", {"password":OLD,"confirm":True}, tag=tag)
        with self.assertRaises(APIError) as caught:
            with locked_account(request): pass
        self.assertEqual(caught.exception.status, 401)

    def test_delayed_cached_session_save_cannot_resurrect_revoked_cookie(self):
        stale = SessionStore(self.second.session.session_key); stale["cached"] = "before"
        _, tag = self.listing(); self.call("sessions/revoke-others", {"password":OLD,"confirm":True}, tag=tag)
        with self.assertRaises(UpdateError): stale.save()
        self.assertFalse(AccountSession.objects.filter(session_key=stale.session_key).exists())

    def test_record_identity_time_and_label_survive_normal_session_save(self):
        session = self.client.session; before = AccountSession.objects.get(session_key=session.session_key)
        session["ordinary"] = True; session.save()
        after = AccountSession.objects.get(session_key=session.session_key)
        self.assertEqual((before.public_id,before.started_at,before.label), (after.public_id,after.started_at,after.label))

    def test_password_rotation_failure_rolls_back_password_sessions_and_response_cookie(self):
        request = RequestFactory().post("/"); request.user = self.owner
        old_key = self.client.session.session_key; request.session = SessionStore(old_key)
        before = list(AccountSession.objects.values_list("session_key", "session_data"))
        save = SessionStore.save
        def fail_after_save(store, *args, **kwargs):
            save(store, *args, **kwargs)
            if not kwargs.get("must_create"): raise APIError("synthetic disk failure", 503)
        with patch.object(SessionStore, "save", fail_after_save), self.assertRaises(APIError):
            change_password(request, OLD, NEW, NEW)
        self.owner.refresh_from_db(); self.assertTrue(self.owner.check_password(OLD))
        self.assertEqual(request.session.session_key, old_key)
        self.assertEqual(list(AccountSession.objects.values_list("session_key", "session_data")), before)

    @override_settings(ACCOUNT_REAUTH_LIMIT=1)
    def test_reauthentication_failures_are_throttled(self):
        self.assertEqual(self.change(oldPassword="wrong").status_code, 400)
        self.assertEqual(self.change().status_code, 429)
        self.owner.refresh_from_db(); self.assertTrue(self.owner.check_password(OLD))

    def test_csrf_required_for_password_and_revocation(self):
        client = Client(enforce_csrf_checks=True); client.force_login(self.owner)
        for path, value in [("password",{"oldPassword":OLD,"newPassword":NEW,"confirmation":NEW}),
                            ("sessions/revoke-others",{"password":OLD,"confirm":True})]:
            self.assertEqual(self.call(path, value, client=client).status_code, 403)

    def test_revoke_then_old_cookie_cannot_read_or_write_working_data(self):
        headers = {"HTTP_X_CREATIVE_ACCOUNT":str(self.owner.pk)}
        path = f"/w/{self.space.pk}/api/boards/original"
        self.assertEqual(self.second.put(path, json.dumps(sample_board()), content_type="application/json", HTTP_IF_MATCH="new", **headers).status_code,200)
        before = WorkspaceDocument.objects.get().value
        _, tag = self.listing(); self.call("sessions/revoke-others", {"password":OLD,"confirm":True}, tag=tag)
        for suffix in ["boards/original", "history/board/original", "assets", "conflicts", "quota"]:
            self.assertEqual(self.second.get(f"/w/{self.space.pk}/api/{suffix}", **headers).status_code, 401)
        self.assertEqual(self.second.put(path, json.dumps(sample_board("changed")), content_type="application/json", HTTP_IF_MATCH="new", **headers).status_code,401)
        self.assertEqual(WorkspaceDocument.objects.get().value, before)

    def test_oversized_review_refuses_to_act_instead_of_hiding_unreviewed_logins(self):
        template = self.client.session; data = template.encode(dict(template.items()))
        AccountSession.objects.bulk_create([AccountSession(session_key=f"fixture{i:033}", account=self.owner,
            session_data=data, expire_date=timezone.now()+timedelta(days=1)) for i in range(99)])
        self.assertEqual(self.call().status_code,409)
        self.assertEqual(AccountSession.objects.filter(account=self.owner).count(),101)


class AccountRaceTests(TransactionTestCase):
    def test_two_real_concurrent_password_changes_keep_only_the_winning_login(self):
        account=Account.objects.create_user("race@example.test",OLD,display_name="Race")
        clients=[Client(),Client()]
        for client in clients: client.force_login(account)
        keys=[client.session.session_key for client in clients];barrier=Barrier(2)
        def worker(index):
            close_old_connections()
            try:
                request=RequestFactory().post("/");request.user=Account.objects.get(pk=account.pk)
                request.session=SessionStore(keys[index]);request.session.get(SESSION_KEY)
                barrier.wait(timeout=5)
                try:
                    value=change_password(request,OLD,NEW+str(index),NEW+str(index))
                    return (index,200,request.session.session_key,value)
                except APIError as error:return (index,error.status,None,None)
            finally:close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(worker,range(2)))
        self.assertEqual(sorted(item[1] for item in results),[200,401])
        winner=next(item for item in results if item[1]==200);account.refresh_from_db()
        self.assertTrue(account.check_password(NEW+str(winner[0])))
        self.assertEqual(list(AccountSession.objects.filter(account=account).values_list("session_key",flat=True)),[winner[2]])
