"""Database sessions with account-scoped, non-credential login records."""
from asgiref.sync import sync_to_async
from django.contrib.auth import SESSION_KEY
from django.contrib.sessions.backends.db import SessionStore as DatabaseSessionStore


class SessionStore(DatabaseSessionStore):
    @classmethod
    def get_model_class(cls):
        from .models import AccountSession
        return AccountSession

    def create_model_instance(self, data):
        obj = super().create_model_instance(data)
        identity = data.get(SESSION_KEY)
        obj.account_id = int(identity) if str(identity).isdigit() and int(identity) > 0 else None
        previous = self.model.objects.filter(session_key=self.session_key).values("public_id", "started_at", "label").first()
        if previous:
            for key, value in previous.items():
                setattr(obj, key, value)
        if hasattr(self, "login_label"):
            obj.label = self.login_label
        return obj

    async def acreate_model_instance(self, data):
        return await sync_to_async(self.create_model_instance)(data)


def login_label(request):
    # Self-reported family only; do not store raw UA, address or geolocation.
    agent = request.META.get("HTTP_USER_AGENT", "")[:1024]
    browser = next((name for marker, name in (("Edg/", "Edge"), ("Firefox/", "Firefox"),
                   ("Chrome/", "Chrome"), ("Safari/", "Safari")) if marker in agent), "浏览器")
    platform = next((name for marker, name in (("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"),
                    ("Windows", "Windows"), ("Macintosh", "macOS"), ("Linux", "Linux")) if marker in agent), "")
    return f"{browser} · {platform}" if platform else f"{browser}登录"
