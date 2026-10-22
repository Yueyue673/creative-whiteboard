"""Local server-operator recovery only; no public reset or email enumeration."""
import json

from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from .account_security import password_text
from .models import Account, AccountSession, canonical_email
from .services import APIError

MAX_RECOVERY_SESSIONS = 1000


def recovery_target(account_id, email):
    if type(account_id) is not int or account_id < 1:
        raise APIError("请填写已核对的账号编号")
    try:
        address = canonical_email(email)
    except (ValidationError, ValueError):
        raise APIError("请填写有效的账号邮箱") from None
    account = Account.objects.filter(pk=account_id, email=address).first()
    if account is None:
        raise APIError("账号编号与邮箱不一致，未更改任何账号", 404)
    if not account.is_active:
        raise APIError("这个账号已停用；恢复密码不会启用账号", 403)
    return account


def recovery_plan(account):
    rows = list(AccountSession.objects.filter(account=account).order_by("session_key")
                .values_list("session_key", "public_id", "started_at", "expire_date")[:MAX_RECOVERY_SESSIONS + 1])
    if len(rows) > MAX_RECOVERY_SESSIONS:
        raise APIError("该账号登录记录过多，不能完整核对；未更改密码或登录", 409)
    current = timezone.now()
    public = {"accountId": account.pk, "email": account.email, "name": account.display_name,
              "active": account.is_active, "staff": account.is_staff, "superuser": account.is_superuser,
              "sessionsToRevoke": len(rows), "unexpiredSessions": sum(row[3] > current for row in rows),
              "dataPreserved": True, "permissionsPreserved": True}
    # This private plan never prints session keys, password hashes or a reset
    # bearer token. Only the trusted CLI holds it between review and commit.
    material = [public, account.date_joined.isoformat(), account.password,
                [[key, str(identity), started.isoformat(), expires.isoformat()]
                 for key, identity, started, expires in rows]]
    encoded = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    tag = '"' + salted_hmac("creative-local-account-recovery", encoded, algorithm="sha256").hexdigest() + '"'
    return public, tag


def review_recovery(account_id, email):
    with transaction.atomic():
        return recovery_plan(recovery_target(account_id, email))


def apply_recovery(account_id, email, expected, confirmation, new_password, repeated):
    if confirmation != str(account_id) or not isinstance(expected, str) or not expected:
        raise APIError("请先核对账号，再填写显示的完整编号确认恢复", 428)
    with transaction.atomic():
        # First write acquires SQLite's transaction write lock; fresh identity,
        # password and session-set checks follow it, not a cached user object.
        Account.objects.filter(pk=account_id).update(last_login=F("last_login"))
        account = recovery_target(account_id, email)
        plan, current = recovery_plan(account)
        if not constant_time_compare(expected, current):
            raise APIError("账号或登录记录在核对后有变化，未恢复；请重新查看", 409)
        password = password_text(new_password)
        if password != repeated:
            raise APIError("两次新密码不一致，未更改账号或登录")
        if check_password(password, account.password):
            raise APIError("新密码需要与原密码不同")
        validate_password(password, account)
        account.set_password(password)
        account.save(update_fields=["password"])
        AccountSession.objects.filter(account=account).delete()
        return {"recovered": True, "accountId": account.pk, "email": account.email,
                "revokedSessions": plan["sessionsToRevoke"], "dataPreserved": True,
                "permissionsPreserved": True, "oldLoginsInvalidated": True}
