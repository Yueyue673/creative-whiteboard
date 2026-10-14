"""Small independent portal; never serves the desktop entry or its file API."""
from pathlib import Path

from django.http import HttpResponse, HttpResponseNotAllowed, Http404
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

from .views import account_json


ASSETS = {
    "account-panel.js": "text/javascript", "account-panel.css": "text/css",
    "note-references.js": "text/javascript", "note-references.css": "text/css",
    "board-views.js": "text/javascript", "board-views.css": "text/css",
    "board-frames.js": "text/javascript", "board-frames.css": "text/css",
    "board-tables.js": "text/javascript", "board-tables.css": "text/css", "table-model.js": "text/javascript",
    "board-table-paste.js": "text/javascript", "table-paste-model.js": "text/javascript",
    "board-cell-notes.js": "text/javascript", "board-cell-notes.css": "text/css", "cell-notes-model.js": "text/javascript",
    "board-cell-media.js": "text/javascript", "cell-media-model.js": "text/javascript",
    "media-cues.js": "text/javascript", "media-cues.css": "text/css", "media-cue-model.js": "text/javascript",
    "portal.js": "text/javascript", "portal.css": "text/css",
    "workspace-search.js": "text/javascript",
    "board-transport.js": "text/javascript", "board-drafts.js": "text/javascript",
    "board-session.js": "text/javascript",
    "board-reconciliation.js": "text/javascript",
    "board-editor.js": "text/javascript", "board-editor.css": "text/css",
    "markdown-it.js": "text/javascript",
    "board-media.js": "text/javascript", "board-library.js": "text/javascript",
    "board-metadata.js": "text/javascript",
    "board-folders.js": "text/javascript", "folder-plan.js": "text/javascript",
    "workspace-recovery.js": "text/javascript", "browser-recovery.css": "text/css",
    "archive-transport.js": "text/javascript", "workspace-archive.js": "text/javascript", "workspace-archive.css": "text/css",
}
ASSET_ROOT = Path(__file__).resolve().parent / "portal_assets"


@ensure_csrf_cookie
def page(request, workspace_id=None, key=None, create=False):
    if request.method not in ("GET", "HEAD"):
        return HttpResponseNotAllowed(("GET", "HEAD"))
    # A UUID is only a requested destination, not an authority. No workspace
    # name/data is embedded: fresh scoped APIs authorize the actual contents.
    editor = key is not None and request.user.is_authenticated
    response = render(request, "core/board_editor.html" if editor else "core/portal.html", {"bootstrap": {
        "account": account_json(request.user) if request.user.is_authenticated else None,
        "workspace": str(workspace_id) if workspace_id else None,
        "join": request.path == "/join",
        "key": key, "create": create,
        "destination": request.path if key is not None else None,
    }})
    response.creative_portal = True
    response.creative_editor = editor
    return response


page.creative_portal_page = True


def asset(request, name):
    if request.method not in ("GET", "HEAD"):
        return HttpResponseNotAllowed(("GET", "HEAD"))
    if name not in ASSETS:
        raise Http404
    # This vendor alias is one fixed program file, never a supplied path.
    path = Path(__file__).resolve().parents[2] / "vendor" / "markdown-it.min.js" if name == "markdown-it.js" else ASSET_ROOT / name
    if path.resolve() != path.absolute() or not path.is_file():
        raise Http404
    return HttpResponse(path.read_bytes(), content_type=ASSETS[name])
