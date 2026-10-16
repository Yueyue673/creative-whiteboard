"""Account and membership operations; no desktop globals or filesystem references."""
import hashlib
import hmac
import ipaddress
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import Account, Invitation, Membership, ThrottleBucket, Workspace, canonical_email


class APIError(Exception):
    def __init__(self, message, status=400):
        self.message = message
        self.status = status
        super().__init__(message)


def authored_name(value, maximum):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise APIError("名称不能为空，也不能超出长度限制")
    return value.strip()


def recipient_role(value):
    if value not in (Membership.Role.EDITOR, Membership.Role.VIEWER):
        raise APIError("成员只能设置为可编辑或只读")
    return value


def throttle(request, operation, subject, limit, seconds=None):
    now = timezone.now()
    seconds = seconds or settings.THROTTLE_WINDOW_SECONDS
    slot = int(now.timestamp()) // seconds
    material = f"{operation}\0{slot}\0{subject}".encode("utf-8")
    key = hmac.new(settings.SECRET_KEY.encode("utf-8"), material, hashlib.sha256).hexdigest()
    # Updates are atomic in SQLite too. A racing read may reject an extra attempt,
    # but can never grant an attempt beyond the limit.
    ThrottleBucket.objects.get_or_create(key=key, defaults={"expires_at": now + timedelta(seconds=seconds * 2)})
    ThrottleBucket.objects.filter(key=key).update(count=F("count") + 1)
    count = ThrottleBucket.objects.values_list("count", flat=True).get(key=key)
    ThrottleBucket.objects.filter(expires_at__lt=now).delete()
    if count > limit:
        raise APIError("尝试次数过多，请稍后再试", 429)


def client_address(request):
    address = request.META.get("REMOTE_ADDR", "")
    if getattr(settings, "TRUST_PROXY", False):
        # The trusted proxy must overwrite X-Real-IP, never append client input.
        address = request.META.get("HTTP_X_REAL_IP", address)
    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return "unknown"


@transaction.atomic
def create_personal_workspace(account):
    workspace = Workspace.objects.create(owner=account, kind=Workspace.Kind.PERSONAL, name="我的工作区")
    Membership.objects.create(workspace=workspace, account=account, role=Membership.Role.OWNER)
    return workspace


@transaction.atomic
def create_shared_workspace(account, name):
    name = authored_name(name, 100)
    # Acquire a write lock before reads. Unlike select_for_update alone, this
    # also serializes quota checks on the initial single-instance SQLite store.
    Account.objects.filter(pk=account.pk).update(last_login=F("last_login"))
    if Workspace.objects.filter(owner=account, kind=Workspace.Kind.SHARED).count() >= settings.MAX_OWNED_SHARED_WORKSPACES:
        raise APIError("创建的共享工作区已达到数量限制", 409)
    workspace = Workspace.objects.create(owner=account, kind=Workspace.Kind.SHARED, name=name)
    Membership.objects.create(workspace=workspace, account=account, role=Membership.Role.OWNER)
    return workspace


def locked_workspace(workspace_id):
    if not Workspace.objects.filter(pk=workspace_id).update(name=F("name")):
        raise APIError("工作区不存在或你没有访问权限", 404)
    return Workspace.objects.get(pk=workspace_id)


def require_owner(workspace, account):
    if workspace.owner_id != account.pk or not Membership.objects.filter(workspace=workspace, account=account, role=Membership.Role.OWNER).exists():
        raise APIError("只有工作区所有者可以管理成员", 403)


def require_shared(workspace):
    if workspace.kind != Workspace.Kind.SHARED:
        raise APIError("私有工作区不能邀请或加入其他成员", 403)


@transaction.atomic
def issue_invitation(workspace_id, owner, email, role):
    email = canonical_email(email)
    role = recipient_role(role)
    workspace = locked_workspace(workspace_id)
    require_owner(workspace, owner)
    require_shared(workspace)
    if Membership.objects.filter(workspace=workspace, account__email=email).exists():
        raise APIError("这个账号已经是工作区成员", 409)
    if workspace.memberships.count() >= settings.MAX_WORKSPACE_MEMBERS:
        raise APIError("工作区成员已达到数量限制", 409)
    now = timezone.now()
    Invitation.objects.filter(workspace=workspace, email=email, revoked_at__isnull=True, accepted_at__isnull=True).update(revoked_at=now)
    token = secrets.token_urlsafe(32)
    invitation = Invitation.objects.create(
        workspace=workspace, email=email, role=role, token_digest=hashlib.sha256(token.encode("ascii")).hexdigest(),
        created_by=owner, expires_at=now + timedelta(days=settings.INVITATION_LIFETIME_DAYS),
    )
    return invitation, token


def invitation_digest(token):
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise APIError("邀请无效、已过期，或不属于这个账号", 403)
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def find_invitation(token):
    invitation = Invitation.objects.filter(token_digest=invitation_digest(token)).first()
    if invitation is None:
        raise APIError("邀请无效、已过期，或不属于这个账号", 403)
    return invitation


def pending_invitation(token, email):
    invitation = find_invitation(token)
    if invitation.email != email or invitation.revoked_at or invitation.accepted_at or invitation.expires_at <= timezone.now():
        raise APIError("邀请无效、已过期，或不属于这个账号", 403)
    require_shared(invitation.workspace)
    # Removing or changing the creator's ownership invalidates older invitations.
    require_owner(invitation.workspace, invitation.created_by)
    if invitation.workspace.memberships.count() >= settings.MAX_WORKSPACE_MEMBERS:
        raise APIError("工作区成员已达到数量限制", 409)
    return invitation


def consume_invitation(invitation, account):
    if Membership.objects.filter(workspace=invitation.workspace, account=account).exists():
        raise APIError("你已经是这个工作区的成员", 409)
    Membership.objects.create(workspace=invitation.workspace, account=account, role=invitation.role)
    invitation.accepted_at = timezone.now()
    invitation.accepted_by = account
    invitation.save(update_fields=["accepted_at", "accepted_by"])


def register_by_invitation(token, email, password, display_name):
    email = canonical_email(email)
    display_name = authored_name(display_name, 80)
    if not isinstance(password, str) or len(password) > 1024:
        raise APIError("密码格式不正确")
    candidate = Account(email=email, display_name=display_name)
    validate_password(password, candidate)
    candidate.set_password(password)
    initial = find_invitation(token)
    with transaction.atomic():
        locked_workspace(initial.workspace_id)
        invitation = pending_invitation(token, email)
        if Account.objects.filter(email=email).exists():
            raise APIError("请使用已有账号登录后接受邀请", 409)
        candidate.save()
        create_personal_workspace(candidate)
        consume_invitation(invitation, candidate)
    return candidate


def accept_invitation(token, account):
    initial = find_invitation(token)
    with transaction.atomic():
        locked_workspace(initial.workspace_id)
        invitation = pending_invitation(token, account.email)
        consume_invitation(invitation, account)
    return invitation.workspace


@transaction.atomic
def revoke_invitation(workspace_id, owner, invitation_id):
    workspace = locked_workspace(workspace_id)
    require_owner(workspace, owner)
    invitation = Invitation.objects.filter(pk=invitation_id, workspace=workspace).first()
    if invitation is None:
        raise APIError("邀请不存在", 404)
    if invitation.accepted_at:
        raise APIError("邀请已经接受；如需撤回权限，请移除成员", 409)
    if not invitation.revoked_at:
        invitation.revoked_at = timezone.now()
        invitation.save(update_fields=["revoked_at"])


@transaction.atomic
def change_member(workspace_id, owner, account_id, role=None, remove=False):
    workspace = locked_workspace(workspace_id)
    require_owner(workspace, owner)
    require_shared(workspace)
    member = Membership.objects.filter(workspace=workspace, account_id=account_id).first()
    if member is None:
        raise APIError("成员不存在", 404)
    if member.account_id == workspace.owner_id or member.role == Membership.Role.OWNER:
        raise APIError("不能移除所有者或修改其权限", 403)
    if remove:
        member.delete()
    else:
        member.role = recipient_role(role)
        member.save(update_fields=["role"])
