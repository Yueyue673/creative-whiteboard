"""Every test process gets independent data outside the checkout."""
import os
import tempfile

_test_data = tempfile.TemporaryDirectory(prefix="creative-hosted-tests-")
os.environ["CREATIVE_BOARD_HOSTED_DATA_DIR"] = _test_data.name
os.environ["CREATIVE_BOARD_HOSTED_SECRET"] = "test-only-secret-" + "0" * 64
os.environ["CREATIVE_BOARD_HOSTED_HOSTS"] = "testserver,localhost"
os.environ["CREATIVE_BOARD_HOSTED_ORIGINS"] = ""
os.environ.pop("CREATIVE_BOARD_HOSTED_TRUST_PROXY", None)
from .settings import *  # noqa: E402,F403

DATABASES["default"]["TEST"] = {"NAME": os.path.join(_test_data.name, "test-accounts.sqlite3")}
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SESSION_COOKIE_NAME = "creative_test_session"
CSRF_COOKIE_NAME = "creative_test_csrf"
# Fast hashing is confined to this explicit test module.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
