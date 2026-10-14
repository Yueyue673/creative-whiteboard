"""Asset confirmation must not invalidate another author's unchanged version."""
from django.test import TestCase, override_settings

from . import test_media as fixtures
from .models import Account, MediaAsset, Membership


class MediaConfirmationTests(TestCase):
    setUp = fixtures.MediaAPITests.setUp
    url = fixtures.MediaAPITests.url
    api = fixtures.MediaAPITests.api
    upload = fixtures.MediaAPITests.upload

    def test_unchanged_confirmation_preserves_asset_row_and_collaborators_version(self):
        original = self.upload()
        asset = original.json()
        before = MediaAsset.objects.values().get()
        fields = {key: asset[key] for key in ("title", "notes", "tags", "folderId")}
        confirmed = self.api("assets/items/" + asset["id"], "PATCH", fields, original["ETag"])
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        self.assertEqual(confirmed["ETag"], original["ETag"])
        self.assertEqual(MediaAsset.objects.values().get(), before)
        other = self.api("assets/items/" + asset["id"], "PATCH", {"notes": "Other author's own note"},
                         original["ETag"], client=self.editor_client, account=self.editor)
        self.assertEqual(other.status_code, 200, other.content)
        self.assertEqual(other.json()["asset"]["notes"], "Other author's own note")

    def test_each_unchanged_partial_field_needs_no_write_or_extra_quota(self):
        original = self.upload()
        asset = original.json()
        before = MediaAsset.objects.values().get()
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):
            for key in ("title", "notes", "tags", "folderId"):
                result = self.api("assets/items/" + asset["id"], "PATCH", {key: asset[key]}, original["ETag"])
                self.assertEqual(result.status_code, 200, result.content)
                self.assertEqual(result["ETag"], original["ETag"])
        self.assertEqual(MediaAsset.objects.values().get(), before)

    def test_stale_equal_fields_still_require_conflict_review(self):
        original = self.upload()
        asset = original.json()
        changed = self.api("assets/items/" + asset["id"], "PATCH", {"notes": "New own words"}, original["ETag"])
        before = MediaAsset.objects.values().get()
        result = self.api("assets/items/" + asset["id"], "PATCH", {"notes": "New own words"}, original["ETag"])
        self.assertEqual(result.status_code, 409)
        self.assertTrue(result.json()["preserveDraft"])
        self.assertEqual(result["ETag"], changed["ETag"])
        self.assertEqual(MediaAsset.objects.values().get(), before)

    def test_unchanged_fields_cannot_bypass_identity_membership_or_readonly_checks(self):
        original = self.upload()
        asset = original.json()
        before = MediaAsset.objects.values().get()
        data = {"notes": asset["notes"]}
        self.assertEqual(self.api("assets/items/" + asset["id"], "PATCH", data, original["ETag"],
                                 client=self.editor_client).status_code, 409)
        Membership.objects.filter(workspace=self.shared, account=self.editor).update(role="viewer")
        self.assertEqual(self.api("assets/items/" + asset["id"], "PATCH", data, original["ETag"],
                                 client=self.editor_client, account=self.editor).status_code, 403)
        Membership.objects.filter(workspace=self.shared, account=self.editor).delete()
        self.assertEqual(self.api("assets/items/" + asset["id"], "PATCH", data, original["ETag"],
                                 client=self.editor_client, account=self.editor).status_code, 404)
        self.assertEqual(self.api("assets/items/" + asset["id"], "PATCH", data, original["ETag"],
                                 workspace=self.personal).status_code, 404)
        Account.objects.filter(pk=self.owner.pk).update(is_active=False)
        self.assertEqual(self.api("assets/items/" + asset["id"], "PATCH", data, original["ETag"]).status_code, 401)
        self.assertEqual(MediaAsset.objects.values().get(), before)

    def test_equal_fields_do_not_bypass_precondition_or_validation(self):
        original = self.upload()
        asset = original.json()
        before = MediaAsset.objects.values().get()
        for data, etag, status in [({}, original["ETag"], 400), ({"notes": ""}, None, 428),
                                   ({"tags": None}, original["ETag"], 400),
                                   ({"notes": "", "path": "/private"}, original["ETag"], 400)]:
            result = self.api("assets/items/" + asset["id"], "PATCH", data, etag)
            self.assertEqual(result.status_code, status, result.content)
        self.assertEqual(MediaAsset.objects.values().get(), before)

    def test_authored_whitespace_tag_order_and_empty_tags_remain_real_changes(self):
        original = self.upload()
        asset = original.json()
        value = {"title": "  Own title  ", "notes": "\nOwn words\n  ", "tags": ["", "tag", "tag\nsecond"]}
        saved = self.api("assets/items/" + asset["id"], "PATCH", value, original["ETag"])
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertNotEqual(saved["ETag"], original["ETag"])
        for key, expected in value.items():
            self.assertEqual(saved.json()["asset"][key], expected)
        reordered = {"tags": list(reversed(value["tags"]))}
        changed = self.api("assets/items/" + asset["id"], "PATCH", reordered, saved["ETag"])
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertNotEqual(changed["ETag"], saved["ETag"])
        self.assertEqual(changed.json()["asset"]["tags"], reordered["tags"])
