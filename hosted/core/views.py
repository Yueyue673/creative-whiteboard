import json
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import RequestDataTooBig, ValidationError
from django.db import IntegrityError, OperationalError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Membership, canonical_email
from .identity import page_account
from .scope import valid_membership
from .services import (
    APIError, accept_invitation, change_member, client_address, create_shared_workspace,
    issue_invitation, register_by_invitation, revoke_invitation, throttle,
)


def endpoint(methods, signed_in=False, owner=False, account_bound=False):
    def decorate(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if request.method not in methods:
                response = JsonResponse({"error": "不支持这个请求方式"}, status=405)
                response["Allow"] = ", ".join(methods)
                return response
            if signed_in and not request.user.is_authenticated:
                return JsonResponse({"error": "请先登录"}, status=401)
            if owner and not request.workspace_scope.is_owner:
                return JsonResponse({"error": "只有工作区所有者可以管理成员"}, status=403)
            try:
                if account_bound:
                    changed = page_account(request)
                    if changed is not None:
                        return changed
                return view(request, *args, **kwargs)
            except APIError as error:
                return JsonResponse({"error": error.message}, status=error.status)
            except RequestDataTooBig:
                return JsonResponse({"error": "请求内容过大"}, status=413)
            except ValidationError as error:
                return JsonResponse({"error": "；".join(error.messages)}, status=400)
            except ValueError:
                return JsonResponse({"error": "请求内容格式不正确"}, status=400)
            except IntegrityError:
                return JsonResponse({"error": "内容已改变，请重新检查后再试"}, status=409)
            except OperationalError:
                return JsonResponse({"error": "暂时不能完成操作，请保留当前输入并稍后重试"}, status=503)
        return wrapped
    return decorate


def payload(request, required, optional=()):
    if request.content_type != "application/json":
        raise APIError("请使用 JSON 请求", 415)
    length = request.META.get("CONTENT_LENGTH", "")
    if length and (not length.isdigit() or int(length) > settings.ACCOUNT_REQUEST_MAX_BYTES):
        raise APIError("请求内容过大", 413)
    if len(request.body) > settings.ACCOUNT_REQUEST_MAX_BYTES:
        raise APIError("请求内容过大", 413)
    try:
        data = json.loads(request.body)
    except RecursionError:
        raise APIError("请求内容嵌套过深") from None
    if not isinstance(data, dict) or not set(required).issubset(data) or set(data) - set(required) - set(optional):
        raise APIError("请求字段缺少或包含不支持的字段")
    return data


def account_json(account):
    return {"id": account.pk, "email": account.email, "name": account.display_name}


def workspace_json(workspace, role):
    return {"id": str(workspace.id), "name": workspace.name, "kind": workspace.kind, "role": role, "api": f"/w/{workspace.id}/api"}


def invitation_json(invitation):
    now = timezone.now()
    state = "accepted" if invitation.accepted_at else "revoked" if invitation.revoked_at else "expired" if invitation.expires_at <= now else "pending"
    return {"id": str(invitation.id), "email": invitation.email, "role": invitation.role, "state": state, "expiresAt": invitation.expires_at.isoformat()}


@endpoint(("GET", "HEAD"))
def health(request):
    return JsonResponse({"service": "creative-whiteboard-hosted", "stage": "foundation"})


@ensure_csrf_cookie
@endpoint(("GET", "HEAD"))
def session(request):
    return JsonResponse({"account": account_json(request.user) if request.user.is_authenticated else None})


@endpoint(("POST",))
def sign_in(request):
    if request.user.is_authenticated:
        return JsonResponse({"error": "当前已有登录账号，请在当前账号页面明确退出后再登录", "code": "account_changed", "preserveDraft": True}, status=409)
    throttle(request, "login-ip", client_address(request), settings.LOGIN_IP_LIMIT)
    data = payload(request, ("email", "password"))
    email = canonical_email(data["email"])
    throttle(request, "login-account", email, settings.LOGIN_ACCOUNT_LIMIT)
    password = data["password"]
    if not isinstance(password, str) or len(password) > 1024:
        raise APIError("邮箱或密码不正确", 401)
    account = authenticate(request, email=email, password=password)
    if account is None:
        raise APIError("邮箱或密码不正确", 401)
    login(request, account)
    from .sessions import login_label
    request.session.login_label = login_label(request)
    return JsonResponse({"account": account_json(account)})


@endpoint(("POST",), signed_in=True, account_bound=True)
def sign_out(request):
    logout(request)
    return JsonResponse({"account": None})


@endpoint(("POST",))
def register(request):
    if request.user.is_authenticated:
        raise APIError("请先退出当前账号，或使用当前账号接受邀请", 409)
    throttle(request, "register-ip", client_address(request), settings.REGISTRATION_IP_LIMIT)
    data = payload(request, ("email", "password", "name"), ("token", "code"))
    if 'code' in data and 'token' not in data:
        from .email_registration import register_verified
        account = register_verified(request, data['email'], data['password'], data['name'], data['code'])
    elif 'token' in data and 'code' not in data:
        account = register_by_invitation(data["token"], data["email"], data["password"], data["name"])
    else:
        raise APIError('请先验证邮箱')
    login(request, account, backend="django.contrib.auth.backends.ModelBackend")
    from .sessions import login_label
    request.session.login_label = login_label(request)
    return JsonResponse({"account": account_json(account)}, status=201)


@endpoint(("POST",))
def registration_code(request):
    if request.user.is_authenticated:
        raise APIError('当前已有登录账号，请先明确退出。', 409)
    data = payload(request, ('email',))
    from .email_registration import send_code
    send_code(request, data['email'])
    return JsonResponse({'sent': True, 'message': '如果这个邮箱可以注册，验证码将发到邮箱，10 分钟内有效；已有账号请直接登录。', 'retryAfter': 60})


@endpoint(("GET", "HEAD", "POST"), signed_in=True, account_bound=True)
def workspaces(request):
    if request.method == "POST":
        data = payload(request, ("name",))
        workspace = create_shared_workspace(request.user, data["name"])
        return JsonResponse(workspace_json(workspace, Membership.Role.OWNER), status=201)
    members = request.user.memberships.select_related("workspace").order_by("workspace__created_at")
    return JsonResponse({"workspaces": [workspace_json(member.workspace, member.role) for member in members if valid_membership(member)]})


@endpoint(("GET", "HEAD"), signed_in=True, account_bound=True)
def workspace_detail(request, workspace_id):
    scope = request.workspace_scope
    return JsonResponse(workspace_json(scope.workspace, scope.role))


@endpoint(("GET", "HEAD"), signed_in=True, account_bound=True)
def members(request, workspace_id):
    scope = request.workspace_scope
    rows = []
    for member in scope.workspace.memberships.select_related("account").order_by("joined_at"):
        row = {"id": member.account_id, "name": member.account.display_name, "role": member.role}
        if scope.is_owner:
            row["email"] = member.account.email
        rows.append(row)
    return JsonResponse({"members": rows})


@endpoint(("PATCH", "DELETE"), signed_in=True, owner=True, account_bound=True)
def member_detail(request, workspace_id, account_id):
    if request.method == "DELETE":
        change_member(workspace_id, request.user, account_id, remove=True)
    else:
        data = payload(request, ("role",))
        change_member(workspace_id, request.user, account_id, role=data["role"])
    return JsonResponse({"ok": True})


@endpoint(("GET", "HEAD", "POST"), signed_in=True, owner=True, account_bound=True)
def invitations(request, workspace_id):
    if request.method == "POST":
        data = payload(request, ("email", "role"))
        invitation, token = issue_invitation(workspace_id, request.user, data["email"], data["role"])
        return JsonResponse({"invitation": invitation_json(invitation), "token": token}, status=201)
    rows = request.workspace_scope.workspace.invitations.order_by("-created_at")
    return JsonResponse({"invitations": [invitation_json(invitation) for invitation in rows]})


@endpoint(("DELETE",), signed_in=True, owner=True, account_bound=True)
def invitation_detail(request, workspace_id, invitation_id):
    revoke_invitation(workspace_id, request.user, invitation_id)
    return JsonResponse({"ok": True})


@endpoint(("POST",), signed_in=True, account_bound=True)
def invitation_accept(request):
    throttle(request, "accept-ip", client_address(request), settings.REGISTRATION_IP_LIMIT)
    data = payload(request, ("token",))
    workspace = accept_invitation(data["token"], request.user)
    member = Membership.objects.get(workspace=workspace, account=request.user)
    return JsonResponse(workspace_json(workspace, member.role))


@endpoint(("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"), signed_in=True)
def unfinished_workspace_route(request, workspace_id, remaining=""):
    # Old file-server APIs are not a fallback. Permission is checked even for
    # future media/preview/search/history/task routes, which remain unavailable.
    raise APIError("网页版创作接口仍在开发，当前不能在这里读写白板或素材", 501)


def csrf_failure(request, reason=""):
    return JsonResponse({"error": "请求验证已失效，请保留当前输入，在新页面检查登录后再试"}, status=403)
