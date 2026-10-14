"""Fresh account/session checks and explicitly reviewed login changes."""
import json
from contextlib import contextmanager

from django.conf import settings
from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY, update_session_auth_hash
from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from .models import Account, AccountSession
from .services import APIError, client_address, throttle

MAX_REVIEWED_LOGINS = 100


def valid_login(row, account):
    data = row.get_decoded()
    return (str(data.get(SESSION_KEY)) == str(account.pk)
            and data.get(BACKEND_SESSION_KEY) in settings.AUTHENTICATION_BACKENDS
            and constant_time_compare(data.get(HASH_SESSION_KEY, ""), account.get_session_auth_hash()))


@contextmanager
def locked_account(request):
    with transaction.atomic():
        # First write serializes account mutations even on SQLite. Re-read the
        # cookie and password hash; a cached request.user is not authorization.
        Account.objects.filter(pk=request.user.pk).update(last_login=F("last_login"))
        account = Account.objects.filter(pk=request.user.pk, is_active=True).first()
        row = AccountSession.objects.filter(session_key=request.session.session_key,
                                            account_id=request.user.pk, expire_date__gt=timezone.now()).first()
        if account is None or row is None or not valid_login(row, account):
            raise APIError("这次登录已失效，请保留输入后重新登录", 401)
        yield account, row


def reviewed_logins(account, current):
    candidates = list(AccountSession.objects.filter(account=account, expire_date__gt=timezone.now())
                      .order_by("started_at", "public_id")[:MAX_REVIEWED_LOGINS + 1])
    if len(candidates) > MAX_REVIEWED_LOGINS:
        raise APIError("登录记录过多，暂时不能完整核对；未退出任何登录", 409)
    rows = [row for row in candidates if valid_login(row, account)]
    value = [{"id": str(row.public_id), "label": row.label, "startedAt": row.started_at.isoformat(),
              "expiresAt": row.expire_date.isoformat(), "current": row.session_key == current.session_key} for row in rows]
    encoded = json.dumps([str(account.pk), str(current.public_id), account.get_session_auth_hash(), value],
                         ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    tag = '"' + salted_hmac("creative-reviewed-logins", encoded, algorithm="sha256").hexdigest() + '"'
    return rows, value, tag


def require_review(request, tag):
    submitted = request.headers.get("If-Match", "")
    if not submitted:
        raise APIError("请先查看这次登录列表，再明确选择要退出的登录", 428)
    if not constant_time_compare(submitted, tag):
        raise APIError("登录列表已改变，请重新查看并确认；未退出任何登录", 409)


def reauth_throttle(request):
    throttle(request, "account-reauth", str(request.user.pk), settings.ACCOUNT_REAUTH_LIMIT)
    throttle(request, "account-reauth-ip", client_address(request), settings.ACCOUNT_REAUTH_IP_LIMIT)


def password_text(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 1024:
        raise APIError("密码长度不正确")
    return value


def reauthenticate(account, password):
    # No setter: verification must not silently upgrade the stored hash and
    # invalidate this session half-way through the reviewed operation.
    if not check_password(password_text(password), account.password):
        raise APIError("当前密码不正确；未更改账号或退出登录", 400)


def revoke_logins(request, password, confirmed, public_id=None):
    if confirmed is not True:
        raise APIError("请明确确认这次要退出的登录")
    with locked_account(request) as (account, current):
        reauthenticate(account, password)
        rows, _, tag = reviewed_logins(account, current)
        require_review(request, tag)
        if public_id is None:
            targets = [row for row in rows if row.session_key != current.session_key]
        else:
            targets = [row for row in rows if row.public_id == public_id]
            if not targets:
                raise APIError("没有这条可退出的登录记录", 404)
            if targets[0].session_key == current.session_key:
                raise APIError("这是当前登录；请用页面上的退出登录操作")
        AccountSession.objects.filter(account=account, session_key__in=[row.session_key for row in targets]).delete()
        return {"accepted": True, "revoked": len(targets), "currentKept": True}


def change_password(request, old_password, new_password, confirmation):
    old_key = request.session.session_key
    store_class = type(request.session)
    try:
        with locked_account(request) as (account, current):
            reauthenticate(account, old_password)
            new_password = password_text(new_password)
            if new_password != confirmation:
                raise APIError("两次新密码不一致；未更改密码")
            if check_password(new_password, account.password):
                raise APIError("新密码需要与当前密码不同")
            validate_password(new_password, account)
            account.set_password(new_password)
            account.save(update_fields=["password"])
            request.session.login_label = current.label
            update_session_auth_hash(request, account)
            # Persist password + rotated current cookie + other revocations in
            # one transaction; don't leave session persistence to the response.
            request.session.save()
            AccountSession.objects.filter(account=account).exclude(session_key=request.session.session_key).delete()
            request.user = account
        return {"accepted": True, "passwordChanged": True, "currentKept": True, "othersRevoked": True}
    except Exception:
        # A rollback also rolled back cycle_key(). Middleware must not later
        # attempt to save the nonexistent rotated key or expose it as a cookie.
        request.session = store_class(session_key=old_key)
        raise
