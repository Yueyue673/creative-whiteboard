"""Read-only, current-workspace bundle-copy locations with pre-load budgets."""
import time
from django.db import transaction
from .media_search import current_reader
from .models import WorkspaceDocument
from .native_library import BUNDLE
from .services import APIError
from library_usage import MAX_RECORDS, MAX_BYTES, MAX_RESULTS, board_copies, copy_response, scan_budget, label, tick, CopyScanLimit


@transaction.atomic
def library_copies(scope, account, identity):
    current_reader(scope, account)
    budget = scan_budget()
    catalogs = WorkspaceDocument.objects.filter(
        workspace=scope.workspace, kind="library", key="catalog",
        deleted_at__isnull=True, purged_at__isnull=True)
    meta = catalogs.values("pk", "byte_size", "updated_at").first()
    if meta and meta["byte_size"] > MAX_BYTES:
        raise APIError("内容库记录较大，暂时不能完成这次查找", 413)
    catalog = catalogs.filter(pk=meta["pk"], byte_size=meta["byte_size"], updated_at=meta["updated_at"]).only("value").first() if meta else None
    found = False
    try:
        for item in catalog.value.get("assets", []) if catalog else []:
            tick(budget)
            if isinstance(item, dict) and item.get("id") == identity and item.get("mime") == BUNDLE and not item.get("archived"):
                found = True
                break
    except CopyScanLimit:
        raise APIError("内容库记录较大，暂时不能完成这次查找", 413) from None
    if not found:
        raise APIError("这份内容库原件不存在或已移出内容库", 404)
    records = WorkspaceDocument.objects.filter(
        workspace=scope.workspace, kind="board",
        deleted_at__isnull=True, purged_at__isnull=True)
    selected, charged, limited = [], 0, False
    for row in records.order_by("-updated_at", "pk").values("pk", "byte_size", "updated_at")[:MAX_RECORDS + 1]:
        if len(selected) >= MAX_RECORDS or row["byte_size"] < 0 or charged + row["byte_size"] > MAX_BYTES or time.monotonic() > budget["deadline"]:
            limited = True
            break
        charged += row["byte_size"]
        selected.append(row)
    items, scanned = [], 0
    for meta in selected:
        if time.monotonic() > budget["deadline"]:
            limited = True
            break
        # Match metadata in the same SQL statement that loads JSON. A larger or
        # later concurrent version is skipped rather than bypassing the budget.
        record = records.filter(pk=meta["pk"], byte_size=meta["byte_size"], updated_at=meta["updated_at"]).only("key", "value", "updated_at").first()
        if record is None:
            limited = True
            continue
        found = board_copies(record.value, identity, budget, MAX_RESULTS - len(items))
        if found.get("interrupted"):
            limited = True
            break
        scanned += 1
        limited |= found["limited"]
        for item in found["items"]:
            items.append({**item, "boardId": record.key,
                          "boardName": label(record.value.get("name", "")),
                          "folder": label(record.value.get("folder", "")),
                          "updated": record.updated_at.timestamp()})
        if len(items) >= MAX_RESULTS:
            limited = True
            break
    current_reader(scope, account)
    result = copy_response(identity, items, scanned, limited)
    result.update(account=account.pk, workspace=str(scope.workspace.pk))
    return result

