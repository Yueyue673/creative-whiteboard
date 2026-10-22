"""Bounded, stateless static rendering of one registered HTML attachment.

The original bytes remain a download attachment. This is a separate, sanitized
view served in an opaque-origin sandbox with no authored scripts or links.
"""
import base64
import hashlib
import re
import time
from html import escape
from html.parser import HTMLParser

from .media import open_media
from .models import Account, MediaAsset, Membership
from .scope import valid_membership
from .services import APIError


MAX_BYTES = 512 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
MAX_PARTS = 10000
MAX_SECONDS = 0.5
EXIT_SCRIPT = "document.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();parent.postMessage({type:'creative-static-preview-close'},'*');}});"
EXIT_HASH = base64.b64encode(hashlib.sha256(EXIT_SCRIPT.encode()).digest()).decode()
POLICY = "default-src 'none'; script-src 'sha256-" + EXIT_HASH + "'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts"
TAGS = set("div span p main section article header footer aside nav h1 h2 h3 h4 h5 h6 strong em b i u s del ins small mark sub sup pre code kbd samp var blockquote ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td figure figcaption br hr details summary time ruby rt rp a button input label style img".split())
VOID = {"br", "hr", "col", "img", "input"}
DROP = {"script", "iframe", "object", "embed", "svg", "math", "template", "title", "textarea", "select", "audio", "video"}
ATTRS = {"class", "id", "style", "title", "lang", "dir", "colspan", "rowspan", "scope", "width", "height", "alt"}


class StaticHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.output = []; self.parts = 0; self.size = 0; self.omitted = False
        self.deadline = time.monotonic() + MAX_SECONDS
        self.dropped = []; self.styles = False

    def tick(self):
        self.parts += 1
        if self.parts > MAX_PARTS or time.monotonic() > self.deadline:
            raise APIError("HTML内容较多，暂时无法完成静态预览；原文件仍可下载", 413)

    def emit(self, value):
        self.size += len(value.encode("utf-8"))
        if self.size > MAX_OUTPUT_BYTES:
            raise APIError("HTML静态预览超过大小限制；原文件仍可下载", 413)
        self.output.append(value)

    def handle_starttag(self, tag, attrs):
        self.tick()
        if self.dropped:
            if tag in DROP and tag not in {"embed"}:
                self.dropped.append(tag)
            return
        if tag in DROP:
            self.omitted = True
            if tag != "embed": self.dropped.append(tag)
            return
        if tag not in TAGS:
            if tag not in {"html", "head", "body"}: self.omitted = True
            return
        values = []; seen = set()
        for key, value in attrs:
            if key in seen: self.omitted = True; continue
            seen.add(key)
            if key == "src" and tag == "img" and isinstance(value, str) and inline_image(value):
                values.append((key, value)); continue
            if key in ATTRS and isinstance(value, str):
                values.append((key, value)); continue
            if key == "value" and tag == "input" and isinstance(value, str):
                values.append((key, value)); continue
            self.omitted = True
        if tag in {"button", "input"}:
            values.append(("disabled", ""))
            values.append(("type", "button" if tag == "button" else "text"))
        self.emit("<" + tag + "".join(' ' + name + '="' + escape(value, quote=True) + '"' for name, value in values) + ">")
        if tag == "style": self.styles = True

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID: self.handle_endtag(tag)

    def handle_endtag(self, tag):
        self.tick()
        if self.dropped:
            if tag == self.dropped[-1]: self.dropped.pop()
            return
        if tag in TAGS and tag not in VOID: self.emit("</" + tag + ">")
        if tag == "style": self.styles = False

    def handle_data(self, data):
        self.tick()
        if self.dropped: return
        # Raw-text styles are kept for layout, with URLs blocked by response CSP.
        # Escaping closing sequences prevents a reparsed raw-text breakout.
        self.emit(data.replace("</", "<\\/") if self.styles else escape(data, quote=False))

    def handle_comment(self, data):
        self.tick()

    def handle_decl(self, decl):
        self.tick()


def inline_image(value):
    match = re.fullmatch(r"data:image/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)", value, re.I)
    if not match: return False
    try:
        raw = base64.b64decode(match[2], validate=True)
    except ValueError:
        return False
    prefixes = {"png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"), "jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
                "gif": lambda b: b[:6] in (b"GIF87a", b"GIF89a"), "webp": lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP"}
    return prefixes[match[1].lower()](raw)


def current_access(scope, account):
    member = Membership.objects.select_related("workspace").filter(workspace=scope.workspace, account_id=account.pk).first()
    fresh = Account.objects.filter(pk=account.pk, is_active=True).only("password").first()
    if not member or not valid_membership(member) or fresh is None:
        raise APIError("原工作区访问已改变，请在新页面核对", 404)
    if fresh.password != account.password:
        raise APIError("原账号登录状态已改变，请在新页面核对", 409)


def prepare_html(scope, account, asset_id):
    current_access(scope, account)
    asset = MediaAsset.objects.filter(pk=asset_id, workspace=scope.workspace).first()
    if asset is None: raise APIError("素材不存在", 404)
    if asset.mime != "application/octet-stream" or not re.search(r"\.html?$", asset.filename, re.I):
        raise APIError("这份文件不提供HTML静态预览，仍可下载原文件", 415)
    if asset.size > MAX_BYTES: raise APIError("HTML超过静态预览大小限制，仍可下载原文件", 413)
    try:
        with open_media(scope, asset) as stream:
            raw = stream.read(MAX_BYTES + 1)
    except OSError:
        raise APIError("原素材暂时不可读取，请稍后再试", 503) from None
    if len(raw) != asset.size or hashlib.sha256(raw).hexdigest() != asset.content_hash:
        raise APIError("原素材字节无法核对，未显示预览", 503)
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeError:
        raise APIError("暂时只预览UTF-8的HTML，仍可下载原文件", 415) from None
    parser = StaticHTML()
    parser.feed(source); parser.close()
    if parser.styles: parser.emit("</style>")
    content = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
               '<meta http-equiv="Content-Security-Policy" content="' + escape(POLICY, quote=True) + '"></head><body>' +
               "".join(parser.output) + '<script>' + EXIT_SCRIPT + '</script></body></html>').encode("utf-8")
    if len(content) > MAX_OUTPUT_BYTES: raise APIError("HTML静态预览超过大小限制；原文件仍可下载", 413)
    current_access(scope, account)
    result = {"account": account.pk, "workspace": str(scope.workspace.pk), "assetId": str(asset.pk), "contentHash": asset.content_hash,
              "previewHash": hashlib.sha256(content).hexdigest(), "mode": "static", "exitBridge": "escape-close-v1", "omittedMarkup": parser.omitted,
              "size": len(content), "limitBytes": MAX_BYTES}
    result["url"] = f'/w/{scope.workspace.pk}/api/html-preview/{asset.pk}?account={account.pk}&hash={result["contentHash"]}&render={result["previewHash"]}'
    return result, content
