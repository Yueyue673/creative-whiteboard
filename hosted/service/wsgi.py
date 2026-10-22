import os

from django.core.wsgi import get_wsgi_application
from django.core.exceptions import ImproperlyConfigured

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "service.settings")
_django_application = get_wsgi_application()

from core.maintenance import StorageLease  # noqa: E402
from core.services import APIError  # noqa: E402

try:
    # Held for the lifetime of each worker, including idle periods. Never use a
    # custom unguarded get_wsgi_application() entry point for hosted serving.
    _storage_lease = StorageLease()
except APIError as error:
    raise ImproperlyConfigured(error.message) from None


def application(environ, start_response):
    try:
        _storage_lease.verify()
    except APIError:
        body = b'{"error":"Hosted storage lease is unavailable"}'
        start_response("503 Service Unavailable", [("Content-Type", "application/json"), ("Content-Length", str(len(body))), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")])
        return [body]
    return _django_application(environ, start_response)
