import hashlib
from unittest.mock import patch

from django.db import connection
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext

from . import test_media as media_fixtures
from .documents import usage
from .html_preview import EXIT_HASH, EXIT_SCRIPT
from .media import checked_storage, media_usage
from .models import Account, MediaAsset, WorkspaceDocument
from .services import change_member


RAW = b'''<!doctype html><html><head><style>.paper{color:#362b21;background:#f3e8d9;padding:24px;display:grid;gap:14px}h1{font-size:28px}</style></head><body>
<main class="paper"><h1>Original authored layout</h1><p>Literal original **Markdown** &amp; spacing</p><table><tr><th>Own column</th><td>Own cell</td></tr></table>
<a href="https://external.invalid/track" target="_top">Original link label</a><button onclick="parent.changed=true">Original control label</button>
<form action="/api/account/password"><input name="password" value="synthetic original" autofocus><button type="submit">Submit</button></form>
<script>parent.changed=true;fetch('/api/account/password')</script><img src="https://external.invalid/pixel" onerror="parent.changed=true">
<meta http-equiv="refresh" content="0;url=https://external.invalid"><iframe src="/api/session"></iframe>
</main></body></html>'''


class HTMLPreviewTests(TestCase):
    setUp = media_fixtures.MediaAPITests.setUp
    url = media_fixtures.MediaAPITests.url
    api = media_fixtures.MediaAPITests.api
    upload = media_fixtures.MediaAPITests.upload
    content = media_fixtures.MediaAPITests.content

    def asset(self, raw=RAW, name="authored.html"):
        response = self.upload(raw=raw, name=name)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def plan(self, asset, **kwargs):
        return self.api("assets/items/" + asset["id"] + "/html-preview", **kwargs)

    def test_original_download_database_usage_and_file_bytes_are_unchanged(self):
        asset = self.asset()
        before = list(MediaAsset.objects.values())
        docs = list(WorkspaceDocument.objects.values())
        before_usage = usage(self.shared.pk), media_usage(self.shared.pk, self.owner.pk)
        with CaptureQueriesContext(connection) as queries:
            response = self.plan(asset)
            self.assertEqual(response.status_code, 200, response.content)
            plan = response.json()
            preview = self.client.get(plan["url"])
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(plan["account"], self.owner.pk)
        self.assertEqual(plan["workspace"], str(self.shared.pk))
        self.assertEqual(plan["assetId"], asset["id"])
        self.assertEqual(plan["contentHash"], hashlib.sha256(RAW).hexdigest())
        self.assertEqual(hashlib.sha256(preview.content).hexdigest(), plan["previewHash"])
        self.assertEqual(preview["ETag"], '"' + plan["previewHash"] + '"')
        self.assertEqual(list(MediaAsset.objects.values()), before)
        self.assertEqual(list(WorkspaceDocument.objects.values()), docs)
        self.assertEqual((usage(self.shared.pk), media_usage(self.shared.pk, self.owner.pk)), before_usage)
        self.assertFalse(any(row["sql"].lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT")) for row in queries.captured_queries))
        raw_response, actual = self.content(asset["mediaURL"])
        self.assertEqual(actual, RAW)
        self.assertEqual(raw_response["Content-Type"], "application/octet-stream")
        self.assertTrue(raw_response["Content-Disposition"].startswith("attachment;"))
        self.assertEqual(raw_response["X-Frame-Options"], "DENY")

    def test_active_markup_is_removed_original_labels_and_layout_css_retained(self):
        asset = self.asset(); result = self.plan(asset).json()
        text = self.client.get(result["url"]).content.decode()
        for part in ["Original authored layout", "Original link label", "Original control label", "Own cell", ".paper{color:#362b21"]:
            self.assertIn(part, text)
        for part in ["<iframe", "<form", "href=", "onclick=", "onerror=", "action=", "autofocus", "name=\"password\"", "parent.changed", "external.invalid"]:
            self.assertNotIn(part, text)
        self.assertEqual(text.count("<script>"), 1)
        self.assertIn("<script>" + EXIT_SCRIPT + "</script>", text)
        self.assertIn('disabled=""', text)
        self.assertTrue(result["omittedMarkup"])

    def test_isolation_policy_only_on_protected_static_preview(self):
        asset = self.asset(); result = self.plan(asset).json()
        preview = self.client.get(result["url"])
        policy = preview["Content-Security-Policy"]
        for part in ["sandbox allow-scripts", "script-src 'sha256-"+EXIT_HASH+"'", "default-src 'none'", "style-src 'unsafe-inline'", "img-src data:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"]:
            self.assertIn(part, policy)
        self.assertNotIn("allow-same-origin", policy)
        self.assertNotIn("unsafe-inline", policy.split(";")[1])
        self.assertEqual(preview["X-Frame-Options"], "SAMEORIGIN")
        self.assertEqual(preview["Cache-Control"], "no-store")
        self.assertEqual(preview["Referrer-Policy"], "no-referrer")
        self.assertIn("microphone=()", preview["Permissions-Policy"])
        self.assertEqual(self.client.head(result["url"]).content, b"")
        for response in [self.plan(asset), self.api("assets/items/" + asset["id"]), self.client.get("/"), self.client.get(f'/w/{self.shared.pk}/b/one/')]:
            self.assertEqual(response["X-Frame-Options"], "DENY")
            self.assertNotIn("unsafe-inline", response["Content-Security-Policy"])
        self.assertIn("frame-src 'self'", self.client.get(f'/w/{self.shared.pk}/b/one/')["Content-Security-Policy"])

    def test_anonymous_foreign_workspace_and_changed_original_identity_refused(self):
        asset = self.asset(); result = self.plan(asset).json()
        self.assertEqual(self.plan(asset, client=Client()).status_code, 401)
        self.assertEqual(Client().get(result["url"]).status_code, 401)
        self.assertEqual(self.plan(asset, identity=False).status_code, 428)
        self.assertEqual(self.plan(asset, client=self.editor_client, account=self.owner).status_code, 409)
        self.assertEqual(self.editor_client.get(result["url"]).status_code, 409)
        self.assertEqual(self.plan(asset, workspace=self.personal).status_code, 404)
        foreign = result["url"].replace(str(self.shared.pk), str(self.personal.pk))
        self.assertEqual(self.client.get(foreign).status_code, 404)
        self.assertEqual(self.plan(asset, workspace=self.other_personal).status_code, 404)

    def test_viewer_allowed_then_revocation_and_account_deactivation_refuse_both_paths(self):
        asset = self.asset()
        change_member(self.shared.pk, self.owner, self.editor.pk, role="viewer")
        result = self.plan(asset, client=self.editor_client, account=self.editor).json()
        self.assertEqual(self.editor_client.get(result["url"]).status_code, 200)
        change_member(self.shared.pk, self.owner, self.editor.pk, remove=True)
        self.assertEqual(self.editor_client.get(result["url"]).status_code, 404)
        self.assertEqual(self.plan(asset, client=self.editor_client, account=self.editor).status_code, 404)
        own = self.plan(asset).json()
        Account.objects.filter(pk=self.owner.pk).update(is_active=False)
        self.assertEqual(self.client.get(own["url"]).status_code, 401)

    def test_revocation_during_read_rechecked_before_any_content_response(self):
        asset = self.asset()
        from .html_preview import open_media
        def removed(scope, row):
            stream = open_media(scope, row)
            change_member(self.shared.pk, self.owner, self.editor.pk, remove=True)
            return stream
        with patch("core.html_preview.open_media", side_effect=removed):
            result = self.plan(asset, client=self.editor_client, account=self.editor)
        self.assertEqual(result.status_code, 404)
        self.assertNotIn("Original authored layout", result.content.decode())

    def test_hash_range_duplicate_and_arbitrary_path_inputs_never_choose_another_source(self):
        asset = self.asset(); result = self.plan(asset).json()
        url = result["url"]
        self.assertEqual(self.client.get(url.replace(result["contentHash"], "0" * 64)).status_code, 409)
        self.assertEqual(self.client.get(url.replace(result["previewHash"], "0" * 64)).status_code, 409)
        for wrong in [url+"&account="+str(self.owner.pk), url+"&hash="+result["contentHash"], url+"&path=/etc/passwd", url.replace(result["contentHash"], "bad")]:
            self.assertEqual(self.client.get(wrong).status_code, 400)
        self.assertEqual(self.api("assets/items/"+asset["id"]+"/html-preview?path=C:/private").status_code, 400)
        for method in ["POST", "PUT", "DELETE"]:
            self.assertEqual(self.plan(asset, method=method).status_code, 405)
            self.assertEqual(getattr(self.client, method.lower())(url).status_code, 405)
        self.assertEqual(self.client.get(url, HTTP_RANGE="bytes=1-2").status_code, 200)

    def test_only_registered_octet_stream_html_and_utf8_bom_not_spoofed_media_or_other_files(self):
        for name, raw in [("image.html", self.raw), ("page.svg", b"<svg>"), ("page.txt", RAW), ("page.html", b"\xff\xfebad")]:
            self.assertEqual(self.plan(self.asset(raw, name)).status_code, 415, name)
        bom = self.asset(b"\xef\xbb\xbf<p>Original BOM text</p>", "UPPER.HTM")
        self.assertEqual(self.plan(bom).status_code, 200)

    def test_size_checked_before_open_no_truncation_and_all_parser_budgets_refuse(self):
        asset = self.asset()
        with patch("core.html_preview.MAX_BYTES", 4), patch("core.html_preview.open_media") as opened:
            self.assertEqual(self.plan(asset).status_code, 413)
            opened.assert_not_called()
        for changes in [{"MAX_PARTS": 1}, {"MAX_SECONDS": -1}, {"MAX_OUTPUT_BYTES": 8}]:
            with patch.multiple("core.html_preview", **changes):
                self.assertEqual(self.plan(asset).status_code, 413, changes)
        self.assertEqual(self.content(asset["mediaURL"])[1], RAW)

    def test_changed_registered_bytes_or_missing_file_refused_not_replaced_or_repaired(self):
        asset = self.asset(); row = MediaAsset.objects.get(pk=asset["id"])
        path = checked_storage(self.scope, "media", row.pk)
        original = path.read_bytes(); path.write_bytes(b"x" * len(original))
        self.assertEqual(self.plan(asset).status_code, 503)
        self.assertEqual(path.read_bytes(), b"x" * len(original))
        path.unlink()
        self.assertEqual(self.plan(asset).status_code, 503)
        self.assertFalse(path.exists())

    def test_reparsed_raw_text_foreign_namespaces_controls_and_css_urls_have_no_active_markup(self):
        raw = b'''<div id="safe" style="background:url(https://external.invalid/css)">Kept</div><style>@import url(https://external.invalid/style);p{color:#123456}</style>
<svg><foreignObject><script>bad()</script></foreignObject></svg><math><annotation-xml><img src="x" onerror="bad()"></annotation-xml></math>
<xmp><a href="javascript:bad()">Escaped label</a></xmp><button type="submit" formaction="/api/logout">Kept button</button>
<meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://external.invalid"><iframe srcdoc="bad"></iframe>'''
        result = self.plan(self.asset(raw)).json(); response = self.client.get(result["url"]); text = response.content.decode()
        for forbidden in ["<svg", "<math", "<iframe", "onerror=", '<a href="javascript:', "formaction", "<base"]:
            self.assertNotIn(forbidden, text)
        self.assertEqual(text.count("<script>"), 1)
        self.assertIn("Escaped label", text)
        self.assertIn("@import url(https://external.invalid/style)", text)
        self.assertIn("default-src 'none'", response["Content-Security-Policy"])

    def test_only_verified_inline_raster_image_source_retained(self):
        import base64
        image = base64.b64encode(self.raw).decode()
        raw = f'<img src="data:image/png;base64,{image}" alt="Original alternate text"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:image/png;base64,YmFk">'.encode()
        result = self.plan(self.asset(raw)).json()
        text = self.client.get(result["url"]).content.decode()
        self.assertEqual(text.count(" src="), 1)
        self.assertIn("Original alternate text", text)
        self.assertNotIn("image/svg+xml", text)
