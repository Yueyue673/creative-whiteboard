"""Email ownership proof kept in the server-side session, never in a URL/log."""
import hashlib
import hmac
import secrets
import smtplib

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import Account, canonical_email
from .services import APIError, authored_name, client_address, create_personal_workspace, throttle

CHALLENGE = 'email_registration'


def digest(nonce, email, code):
    return hmac.new(settings.SECRET_KEY.encode(), f'register\0{nonce}\0{email}\0{code}'.encode(), hashlib.sha256).hexdigest()


def send_code(request, address):
    if not settings.HOSTED_EMAIL_REGISTRATION:
        raise APIError('邮箱验证服务还未启用，请稍后再来；已有账号可以正常登录。', 503)
    email = canonical_email(address)
    throttle(request, 'email-code-ip', client_address(request), 10)
    throttle(request, 'email-code-address', email, 3, seconds=3600)
    throttle(request, 'email-code-cooldown', email, 1, seconds=60)
    # The same visible response also covers existing accounts. No account is
    # created until verification; a failed delivery never pretends success.
    if Account.objects.filter(email=email).exists():
        return
    nonce, code = secrets.token_urlsafe(24), f'{secrets.randbelow(1000000):06d}'
    try:
        sent = send_mail('创作白板 · 邮箱验证码', f'你的注册验证码是：{code}\n\n10 分钟内有效，请在申请验证码的页面填写。\n如果不是你本人申请，请忽略这封邮件。', settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
        if sent != 1:
            raise OSError('delivery unavailable')
    except (smtplib.SMTPException, OSError, ValueError):
        raise APIError('验证码暂时未能发出，请稍后重试。你的账号尚未创建。', 503) from None
    request.session[CHALLENGE] = {'email': email, 'nonce': nonce, 'digest': digest(nonce, email, code), 'expires': int(timezone.now().timestamp()) + 600}


def register_verified(request, address, password, name, code):
    if not settings.HOSTED_EMAIL_REGISTRATION:
        raise APIError('邮箱验证服务还未启用，已有账号可以正常登录。', 503)
    email = canonical_email(address)
    throttle(request, 'email-verify-address', email, 8, seconds=900)
    throttle(request, 'email-verify-ip', client_address(request), 25, seconds=900)
    proof = request.session.get(CHALLENGE) or {}
    if (not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdigit()
        or proof.get('email') != email or proof.get('expires', 0) <= timezone.now().timestamp()
        or not hmac.compare_digest(proof.get('digest', ''), digest(proof.get('nonce', ''), email, code))):
        raise APIError('验证码不正确或已过期，请检查邮箱，或重新获取。')
    display_name = authored_name(name, 80)
    if not isinstance(password, str) or len(password) > 1024:
        raise APIError('密码格式不正确')
    candidate = Account(email=email, display_name=display_name)
    validate_password(password, candidate)
    candidate.set_password(password)
    with transaction.atomic():
        if Account.objects.filter(email=email).exists():
            raise APIError('这个邮箱已有账号，请直接登录。', 409)
        candidate.save()
        create_personal_workspace(candidate)
    request.session.pop(CHALLENGE, None)
    return candidate
