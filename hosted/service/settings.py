"""Fail-closed settings for the separate, not-yet-integrated hosted service."""
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured
from .configuration import secret_key

BASE_DIR = Path(__file__).resolve().parent.parent
PROGRAM_ROOT = BASE_DIR.parent
sys.path.insert(0, str(PROGRAM_ROOT))
SECRET_KEY = secret_key(os.environ)

configured_root = Path(os.environ.get("CREATIVE_BOARD_HOSTED_DATA_DIR", ""))
if not configured_root.is_absolute():
    raise ImproperlyConfigured("CREATIVE_BOARD_HOSTED_DATA_DIR must be an explicit absolute path.")
HOSTED_DATA_ROOT = configured_root.resolve()
if HOSTED_DATA_ROOT.is_relative_to(BASE_DIR.parent):
    raise ImproperlyConfigured("Hosted data must be stored outside the program directory.")
HOSTED_DATA_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)

DEBUG = False
ALLOWED_HOSTS = [host.strip() for host in os.environ.get("CREATIVE_BOARD_HOSTED_HOSTS", "").split(",") if host.strip()]
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("Explicit hosted host names are required; '*' is not allowed.")
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.environ.get("CREATIVE_BOARD_HOSTED_ORIGINS", "").split(",") if origin.strip()]
for origin in CSRF_TRUSTED_ORIGINS:
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or "*" in origin or parsed.username:
        raise ImproperlyConfigured("Trusted origins must be explicit HTTPS origins without a path.")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "core.apps.CoreConfig",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "core.middleware.ResponsePolicyMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.WorkspaceScopeMiddleware",
]
ROOT_URLCONF = "service.urls"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True}]
WSGI_APPLICATION = "service.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": HOSTED_DATA_ROOT / "accounts.sqlite3", "OPTIONS": {"timeout": 20}}}
AUTH_USER_MODEL = "core.Account"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.Argon2PasswordHasher", "django.contrib.auth.hashers.PBKDF2PasswordHasher"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator", "OPTIONS": {"user_attributes": ["email", "display_name"]}},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "UTC"
USE_TZ = True
APPEND_SLASH = False
HOSTED_NATIVE_WORKBENCH = os.environ.get('CREATIVE_BOARD_HOSTED_NATIVE_WORKBENCH') == '1'
HOSTED_NATIVE_FOLDER_DELETE = os.environ.get('CREATIVE_BOARD_HOSTED_NATIVE_FOLDER_DELETE') == '1'
HOSTED_NATIVE_RESEARCH = os.environ.get('CREATIVE_BOARD_HOSTED_NATIVE_RESEARCH') == '1'
HOSTED_MAX_RESEARCH_BYTES = 16 * 1024 * 1024
ACCOUNT_REQUEST_MAX_BYTES = 65536
HOSTED_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
HOSTED_MAX_WORKSPACE_BYTES = 128 * 1024 * 1024
HOSTED_MAX_DOCUMENTS = 5000
HOSTED_HISTORY_LIMIT = 40
HOSTED_MAX_CONFLICT_DRAFTS_PER_ACCOUNT = 20
HOSTED_MAX_UPLOAD_BYTES = 128 * 1024 * 1024
HOSTED_MAX_WORKSPACE_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
HOSTED_MAX_ACCOUNT_MEDIA_BYTES = 4 * 1024 * 1024 * 1024
HOSTED_MAX_TOTAL_MEDIA_BYTES = 8 * 1024 * 1024 * 1024
HOSTED_MIN_FREE_DISK_BYTES = 512 * 1024 * 1024
HOSTED_MAX_ASSETS = 10000
HOSTED_MAX_PENDING_UPLOADS_PER_ACCOUNT = 3
DATA_UPLOAD_MAX_MEMORY_SIZE = max(HOSTED_MAX_DOCUMENT_BYTES, HOSTED_MAX_RESEARCH_BYTES)
DATA_UPLOAD_MAX_NUMBER_FIELDS = 30
SESSION_ENGINE = "core.sessions"
SESSION_COOKIE_NAME = "__Host-creative_session"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
CSRF_COOKIE_NAME = "__Host-creative_csrf"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_FAILURE_VIEW = "core.views.csrf_failure"
SECURE_SSL_REDIRECT = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_HSTS_SECONDS = 3600
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
X_FRAME_OPTIONS = "DENY"
# Enable only behind a proxy that overwrites this header and blocks direct access.
TRUST_PROXY = os.environ.get("CREATIVE_BOARD_HOSTED_TRUST_PROXY") == "1"
if TRUST_PROXY:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = False
THROTTLE_WINDOW_SECONDS = 300
ACCOUNT_REAUTH_LIMIT = 8
ACCOUNT_REAUTH_IP_LIMIT = 30
LOGIN_IP_LIMIT = 30
LOGIN_ACCOUNT_LIMIT = 8
REGISTRATION_IP_LIMIT = 20
# SMTP credentials are operator environment values, never public program data.
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = os.environ.get('CREATIVE_BOARD_MAIL_HOST', '')
EMAIL_PORT = int(os.environ.get('CREATIVE_BOARD_MAIL_PORT', '465'))
EMAIL_HOST_USER = os.environ.get('CREATIVE_BOARD_MAIL_USER', '')
_mail_password_file = os.environ.get('CREATIVE_BOARD_MAIL_PASSWORD_FILE', '')
EMAIL_HOST_PASSWORD = Path(_mail_password_file).read_text('utf-8').strip() if _mail_password_file else os.environ.get('CREATIVE_BOARD_MAIL_PASSWORD', '')
EMAIL_USE_SSL = os.environ.get('CREATIVE_BOARD_MAIL_TLS', 'ssl') == 'ssl'
EMAIL_USE_TLS = os.environ.get('CREATIVE_BOARD_MAIL_TLS', 'ssl') == 'starttls'
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = os.environ.get('CREATIVE_BOARD_MAIL_FROM', '') or EMAIL_HOST_USER
HOSTED_EMAIL_REGISTRATION = os.environ.get('CREATIVE_BOARD_EMAIL_REGISTRATION') == '1' and bool(EMAIL_HOST and EMAIL_HOST_USER and EMAIL_HOST_PASSWORD and DEFAULT_FROM_EMAIL)
if HOSTED_EMAIL_REGISTRATION and not (EMAIL_USE_SSL or EMAIL_USE_TLS):
    raise ImproperlyConfigured('Email registration requires encrypted SMTP.')
INVITATION_LIFETIME_DAYS = 7
MAX_OWNED_SHARED_WORKSPACES = 100
MAX_WORKSPACE_MEMBERS = 50
# Request diagnostics can contain authored search queries or invitation tokens.
# The independent deployment uses offline checks for configuration diagnostics.
LOGGING = {
    "version": 1, "disable_existing_loggers": False,
    "handlers": {"request_private": {"class": "logging.NullHandler"}},
    "loggers": {name: {"handlers": ["request_private"], "propagate": False}
                for name in ("django.request", "django.security")},
}
