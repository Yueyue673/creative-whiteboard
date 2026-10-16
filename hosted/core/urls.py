from django.urls import path, register_converter

from . import account_views, document_views, media_views, portal, views, workbench, native_views, native_folders, native_research


class DocumentKeyConverter:
    regex = r"[A-Za-z0-9_-]{1,100}"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return value


class DocumentKindConverter(DocumentKeyConverter):
    regex = r"boards?|folders|library"

    def to_python(self, value):
        return "board" if value == "boards" else value


register_converter(DocumentKeyConverter, "document_key")
register_converter(DocumentKindConverter, "document_kind")

urlpatterns = [
    path("", portal.page),
    path("spaces", portal.page),
    path("join", portal.page),
    path("w/<uuid:workspace_id>/", portal.page),
    path("w/<uuid:workspace_id>/manage/", portal.page),
    path("w/<uuid:workspace_id>/app/", workbench.file),
    path("w/<uuid:workspace_id>/app/<str:name>", workbench.file),
    path("w/<uuid:workspace_id>/b/<document_key:key>/", portal.page),
    path("w/<uuid:workspace_id>/new/<document_key:key>/", portal.page, {"create": True}),
    path("portal-assets/<str:name>", portal.asset),
    path("api/health", views.health),
    path("api/session", views.session),
    path("api/login", views.sign_in),
    path("api/register/code", views.registration_code),
    path("api/logout", views.sign_out),
    path("api/register", views.register),
    path("api/account/sessions", account_views.sessions),
    path("api/account/password", account_views.password),
    path("api/account/sessions/revoke-others", account_views.revoke),
    path("api/account/sessions/<uuid:session_id>/revoke", account_views.revoke),
    path("api/workspaces", views.workspaces),
    path("api/invitations/accept", views.invitation_accept),
    path("w/<uuid:workspace_id>/api/workspace", views.workspace_detail),
    path("w/<uuid:workspace_id>/api/members", views.members),
    path("w/<uuid:workspace_id>/api/members/<int:account_id>", views.member_detail),
    path("w/<uuid:workspace_id>/api/invitations", views.invitations),
    path("w/<uuid:workspace_id>/api/invitations/<uuid:invitation_id>", views.invitation_detail),
    path("w/<uuid:workspace_id>/api/boards", document_views.boards),
    path("w/<uuid:workspace_id>/api/search", document_views.search),
    path("w/<uuid:workspace_id>/api/boards/<document_key:key>", document_views.board),
    path("w/<uuid:workspace_id>/api/boards/<document_key:key>/reconcile", document_views.reconcile),
    path("w/<uuid:workspace_id>/api/boards/<document_key:key>/live", document_views.live_board),
    path("w/<uuid:workspace_id>/api/boards/<document_key:key>/restore", document_views.restore_board),
    path("w/<uuid:workspace_id>/api/boards/<document_key:key>/purge", document_views.purge_board),
    path("w/<uuid:workspace_id>/api/folders", document_views.folders),
    path("w/<uuid:workspace_id>/api/assets", document_views.library),
    path("w/<uuid:workspace_id>/api/native/assets", native_views.library),
    path("w/<uuid:workspace_id>/api/native/search", native_views.search),
    path("w/<uuid:workspace_id>/api/native/folders/<document_key:key>", native_folders.folder),
    path("w/<uuid:workspace_id>/api/native/trash", native_folders.trash),
    path("w/<uuid:workspace_id>/api/native/trash/<document_key:batch_id>/restore", native_folders.restore_batch),
    path("w/<uuid:workspace_id>/api/native/preview/<uuid:asset_id>", native_views.preview),
    path("w/<uuid:workspace_id>/api/native/history/<document_kind:kind>/<document_key:key>", native_views.history),
    path("w/<uuid:workspace_id>/api/native/history/<document_kind:kind>/<document_key:key>/<uuid:revision_id>", native_views.history),
    path("w/<uuid:workspace_id>/api/native/checkpoints/<document_kind:kind>/<document_key:key>", native_views.checkpoint),
    path("w/<uuid:workspace_id>/api/assets/upload", media_views.upload),
    path("w/<uuid:workspace_id>/api/assets/search", media_views.search),
    path("w/<uuid:workspace_id>/api/assets/items", media_views.items),
    path("w/<uuid:workspace_id>/api/assets/items/<uuid:asset_id>", media_views.item),
    path("w/<uuid:workspace_id>/api/assets/items/<uuid:asset_id>/references", media_views.references),
    path("w/<uuid:workspace_id>/api/assets/items/<uuid:asset_id>/html-preview", media_views.html_preview_plan),
    path("w/<uuid:workspace_id>/api/html-preview/<uuid:asset_id>", media_views.html_preview_view),
    path("w/<uuid:workspace_id>/api/media/<uuid:asset_id>", media_views.media),
    path("w/<uuid:workspace_id>/api/media-quota", media_views.quota),
    path("w/<uuid:workspace_id>/api/history/<document_kind:kind>/<document_key:key>", document_views.history),
    path("w/<uuid:workspace_id>/api/history/<document_kind:kind>/<document_key:key>/<uuid:revision_id>", document_views.history),
    path("w/<uuid:workspace_id>/api/history/board/<document_key:key>/<uuid:revision_id>/apply", document_views.apply_revision),
    path("w/<uuid:workspace_id>/api/history/<document_kind:kind>/<document_key:key>/cleanup", document_views.cleanup_history),
    path("w/<uuid:workspace_id>/api/trash", document_views.trash),
    path("w/<uuid:workspace_id>/api/conflicts", document_views.conflicts),
    path("w/<uuid:workspace_id>/api/conflicts/<uuid:draft_id>", document_views.conflict),
    path("w/<uuid:workspace_id>/api/quota", document_views.quota),
    path('w/<uuid:workspace_id>/api/ai/tasks', native_research.listing, {'kind': 'task'}),
    path('w/<uuid:workspace_id>/api/ai/tasks/<document_key:key>', native_research.item, {'kind': 'task'}),
    path('w/<uuid:workspace_id>/api/ai/tasks/<document_key:key>/current', native_research.current),
    path('w/<uuid:workspace_id>/api/ai/tasks/<document_key:key>/bundle', native_research.bundle),
    path('w/<uuid:workspace_id>/api/ai/tasks/<document_key:key>/files/<str:name>', native_research.attachment),
    path('w/<uuid:workspace_id>/api/ai/references', native_research.listing, {'kind': 'reference'}),
    path('w/<uuid:workspace_id>/api/ai/references/<document_key:key>', native_research.item, {'kind': 'reference'}),
    path('w/<uuid:workspace_id>/api/proposals', native_research.proposals),
    path('w/<uuid:workspace_id>/api/proposals/<document_key:key>', native_research.proposals),
    path('w/<uuid:workspace_id>/api/proposals/<document_key:key>/status', native_research.proposals, {'status': True}),
    path("w/<uuid:workspace_id>/api/<path:remaining>", views.unfinished_workspace_route),
]
