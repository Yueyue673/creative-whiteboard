"""Read-only literal search of registered metadata, never source file contents."""
import time

from django.utils import timezone

from .media import asset_json
from .models import Account, MediaAsset, Membership, WorkspaceDocument
from .scope import valid_membership
from .services import APIError
from .workspace_search import ScanLimit, excerpt, search_query

MAX_RECORDS = 500
MAX_BYTES = 8 * 1024 * 1024
MAX_PARTS = 100000
MAX_RESULTS = 40
MAX_SECONDS = 1.2


def tick(budget):
    budget["parts"] += 1
    if budget["parts"] > MAX_PARTS or time.monotonic() > budget["deadline"]:
        raise ScanLimit


def current_reader(scope, account):
    member = Membership.objects.select_related("workspace").filter(workspace=scope.workspace, account=account).first()
    fresh = Account.objects.filter(pk=account.pk, is_active=True).only("password").first()
    if not member or not valid_membership(member) or fresh is None:
        raise APIError("原工作区访问已改变，请在新页面核对", 404)
    if fresh.password != account.password:
        raise APIError("原账号登录状态已改变，请在新页面核对", 409)


def metadata_parts(asset, budget):
    for label, value in (("素材名称", asset.title), ("原文件名", asset.filename), ("说明", asset.notes)):
        tick(budget)
        if isinstance(value, str):
            yield label, value
    if isinstance(asset.tags, list):
        for tag in asset.tags:
            tick(budget)
            if isinstance(tag, str):
                yield "标签", tag


def search_assets(scope, account, query, *, archived=False):
    query = search_query([query])
    current_reader(scope, account)
    budget = {"parts": 0, "deadline": time.monotonic() + MAX_SECONDS}
    rows = MediaAsset.objects.filter(workspace=scope.workspace, archived=archived).order_by("-updated_at", "pk")
    identities, byte_count, scanned, limited = [], 0, 0, False
    # Metadata byte sizes are charged before loading text/JSON. Source blobs,
    # arbitrary URLs and paths are neither opened nor requested by this scan.
    for meta in rows.values("pk", "byte_size")[:MAX_RECORDS + 1]:
        if len(identities) >= MAX_RECORDS or byte_count + meta["byte_size"] > MAX_BYTES or time.monotonic() > budget["deadline"]:
            limited = True
            break
        identities.append(meta["pk"])
        byte_count += meta["byte_size"]
    catalog = WorkspaceDocument.objects.filter(workspace=scope.workspace, kind="library", key="catalog", deleted_at__isnull=True, purged_at__isnull=True)
    meta = catalog.values("byte_size").first()
    if meta and byte_count + meta["byte_size"] > MAX_BYTES:
        # Do not fabricate folder names when the original catalog can't be read.
        identities = []
        limited = True
    folders = {}
    if identities and meta:
        value = catalog.values_list("value", flat=True).first()
        if isinstance(value, dict) and isinstance(value.get("folderIds"), dict):
            try:
                for name, identity in value["folderIds"].items():
                    tick(budget)
                    if isinstance(name, str) and isinstance(identity, str):
                        folders[identity] = name
            except ScanLimit:
                identities = []
                limited = True
    results = []
    for asset in rows.filter(pk__in=identities).iterator(chunk_size=1):
        hit = None
        try:
            for context, raw in metadata_parts(asset, budget):
                found = excerpt(raw, query)
                tick(budget)
                if found is not None:
                    hit = {"asset": asset_json(asset, account, folders), "context": context, "excerpt": found}
                    break
        except ScanLimit:
            limited = True
            break
        scanned += 1
        if hit:
            if len(results) >= MAX_RESULTS:
                limited = True
                break
            results.append(hit)
    # Unlike a long DB snapshot, this final fresh check observes withdrawal
    # during scanning. It never changes account or workspace to finish a query.
    current_reader(scope, account)
    return {"account": account.pk, "workspace": str(scope.workspace.pk), "query": query, "items": results,
            "scannedAssets": scanned, "coverage": "limited" if limited else "registeredMetadata",
            "checkedAt": timezone.now().timestamp(), "excludes": ["fileContents", "history", "privateDrafts", "browserInput"],
            "limits": {"assets": MAX_RECORDS, "bytes": MAX_BYTES, "parts": MAX_PARTS, "results": MAX_RESULTS}}
