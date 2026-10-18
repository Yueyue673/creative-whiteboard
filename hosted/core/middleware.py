from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin

from .models import Membership
from .scope import WorkspaceScope, valid_membership


class ResponsePolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Validate Host on every request, including endpoints not using absolute URLs.
        request.get_host()
        response = self.get_response(request)
        # A compression proxy may weaken the representation ETag. The opaque
        # application revision is independent of its transfer encoding.
        if response.get('ETag') and not getattr(response, 'creative_program_cache', False):
            response['X-Creative-Revision'] = response['ETag']
        response["Cache-Control"] = "private, no-cache" if getattr(response, 'creative_program_cache', False) else "no-store"
        response["X-Frame-Options"] = "DENY"
        policy = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if getattr(response, "creative_portal", False):
            policy += "; script-src 'self'; style-src 'self'; connect-src 'self'"
        if getattr(response, "creative_editor", False):
            policy += "; img-src 'self'; media-src 'self'; frame-src 'self'"
        if getattr(response, 'creative_workbench_nonce', None):
            # Original workbench uses program-created inline styles and real
            # same-origin panes. Authored code never receives a script nonce.
            nonce = response.creative_workbench_nonce
            policy = "default-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'nonce-" + nonce + "'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'"
            response['X-Frame-Options'] = 'SAMEORIGIN'
        if getattr(response, "creative_static_preview", False):
            from .html_preview import POLICY
            policy = POLICY
            if getattr(response, 'creative_native_preview', False):
                from .native_preview import POLICY as NATIVE_POLICY
                policy = NATIVE_POLICY
            response["X-Frame-Options"] = "SAMEORIGIN"
            response["Referrer-Policy"] = "no-referrer"
            response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), fullscreen=()"
        response["Content-Security-Policy"] = policy
        if not getattr(response, "creative_static_preview", False):
            response["Referrer-Policy"] = "same-origin"
        return response


class WorkspaceScopeMiddleware(MiddlewareMixin):
    def process_view(self, request, view_func, view_args, view_kwargs):
        if getattr(view_func, "creative_portal_page", False):
            return None
        workspace_id = view_kwargs.get("workspace_id")
        if workspace_id is None:
            return None
        if not request.user.is_authenticated:
            return JsonResponse({"error": "请先登录"}, status=401)
        member = Membership.objects.select_related("workspace").filter(workspace_id=workspace_id, account=request.user).first()
        if member is None or not valid_membership(member):
            return JsonResponse({"error": "工作区不存在或你没有访问权限"}, status=404)
        scope = WorkspaceScope(member.workspace, member.role)
        request.workspace_scope = scope
        if request.method not in ("GET", "HEAD", "OPTIONS") and not scope.can_edit:
            return JsonResponse({"error": "此工作区只有阅读权限"}, status=403)
        return None
