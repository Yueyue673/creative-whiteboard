"""Bounded, non-destructive inspection of records the original account can read.

This is evidence for navigation, never an orphan/deletion certificate. Other
authors' private submissions and unsaved browser input are deliberately excluded.
"""
import re
import time

from django.db import transaction
from django.utils import timezone

from .models import ConflictDraft, DocumentRevision, MediaAsset, WorkspaceDocument
from .services import APIError


MAX_RECORDS = 500
MAX_BYTES = 8 * 1024 * 1024
MAX_NODES = 100000
MAX_RESULTS = 100
MAX_SECONDS = 1.2


class ScanLimit(Exception):
    pass


def reference_match(value, asset_id, budget):
    """Inspect all JSON fields, including nested cells/cues and unknown extensions.

    Explicit assetId fields are direct references; other occurrences only show
    that an ID appears in saved content. Do not return excerpts or execute URLs.
    """
    pattern = re.compile(r"(?<![A-Za-z0-9_-])" + re.escape(str(asset_id)) + r"(?![A-Za-z0-9_-])", re.I)
    stack = [(None, value)]
    found = None
    while stack:
        budget["nodes"] += 1
        if budget["nodes"] > MAX_NODES or time.monotonic() > budget["deadline"]:
            raise ScanLimit
        key, item = stack.pop()
        if isinstance(item, dict):
            for name, child in item.items():
                stack.append((name, child))
                stack.append((None, name))
        elif isinstance(item, list):
            stack.extend((None, child) for child in item)
        elif isinstance(item, str):
            if key == "assetId" and item.lower() == str(asset_id):
                found = "direct"
            elif found is None and pattern.search(item):
                found = "mentioned"
    return found


@transaction.atomic
def inspect_references(scope, account, asset_id):
    # One database snapshot; no file reads, registrations, content writes or
    # cleanup. Every query stays in the immutable URL workspace/account scope.
    asset = MediaAsset.objects.filter(pk=asset_id, workspace=scope.workspace).only("pk").first()
    if asset is None:
        raise APIError("素材不存在", 404)
    documents = WorkspaceDocument.objects.filter(workspace=scope.workspace, purged_at__isnull=True)
    sources = [
        ("board", documents.filter(kind="board", deleted_at__isnull=True), "updated_at"),
        ("trash", documents.filter(kind="board", deleted_at__isnull=False), "updated_at"),
        ("catalog", documents.exclude(kind="board"), "updated_at"),
        ("history", DocumentRevision.objects.filter(document__workspace=scope.workspace, document__purged_at__isnull=True, document__kind="board"), "created_at"),
        ("catalogHistory", DocumentRevision.objects.filter(document__workspace=scope.workspace, document__purged_at__isnull=True).exclude(document__kind="board"), "created_at"),
        ("draft", ConflictDraft.objects.filter(workspace=scope.workspace, actor=account), "created_at"),
    ]
    counts = {category: 0 for category, _, _ in sources}
    rows, scanned, scanned_bytes, limited = [], 0, 0, False
    budget = {"nodes": 0, "deadline": time.monotonic() + MAX_SECONDS}
    for category, query, date_field in sources:
        identities = []
        # Check byte/record budgets before deserializing JSON bodies. Pick the
        # newest records first; stop conservatively if any limit is reached.
        for meta in query.order_by("-" + date_field, "pk").values("pk", "byte_size")[:MAX_RECORDS + 1]:
            if len(identities) + scanned >= MAX_RECORDS or scanned_bytes + meta["byte_size"] > MAX_BYTES or time.monotonic() > budget["deadline"]:
                limited = True
                break
            identities.append(meta["pk"])
            scanned_bytes += meta["byte_size"]
        if identities:
            detail = query.filter(pk__in=identities).order_by("-" + date_field, "pk")
            if category in ("history", "catalogHistory"):
                # A tiny old version must not deserialize its possibly large
                # current board again, once per version, outside the byte budget.
                detail = detail.select_related("document").only("id", "value", "revision", "created_at", "document__kind", "document__key")
            for record in detail.iterator(chunk_size=1):
                try:
                    match = reference_match(record.value, asset_id, budget)
                except ScanLimit:
                    limited = True
                    break
                scanned += 1
                if not match:
                    continue
                counts[category] += 1
                if len(rows) >= MAX_RESULTS:
                    continue
                doc = record.document if category in ("history", "catalogHistory") else record
                rows.append({"category": category, "kind": doc.kind, "key": doc.key,
                             "id": str(record.pk), "name": str(record.value.get("name", ""))[:1000],
                             "revision": getattr(record, "revision", None),
                             "savedAt": getattr(record, date_field).timestamp(), "match": match})
        if limited:
            break
    return {"workspace": str(scope.workspace.pk), "account": account.pk, "assetId": str(asset.pk),
            "checkedAt": timezone.now().timestamp(), "coverage": "limited" if limited else "visibleSavedRecords",
            "scannedRecords": scanned, "counts": counts, "items": rows,
            "hiddenResults": sum(counts.values()) - len(rows),
            "privateSubmissionsExcluded": True, "browserInputExcluded": True, "deletionSafe": False}
