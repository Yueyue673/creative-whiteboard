"""Literal search of supported authored text in current, readable boards.

No history, trash, conflict drafts, file contents, arbitrary paths or external
requests. Size and record budgets are checked before loading JSON documents.
"""
import time
import unicodedata

from django.db import transaction
from django.utils import timezone

from .models import WorkspaceDocument
from .services import APIError


MAX_RECORDS = 500
MAX_BYTES = 8 * 1024 * 1024
MAX_PARTS = 100000
MAX_RESULTS = 40
MAX_SECONDS = 1.2
EXCERPT_LENGTH = 140
TEXT_FIELDS = {"title": "标题", "body": "正文", "userText": "原文", "annotation": "批注", "name": "名称"}


class ScanLimit(Exception):
    pass


def search_query(values):
    if len(values) != 1 or not isinstance(values[0], str):
        raise APIError("请填写一个查找词")
    value = values[0].strip()
    if not value or len(value) > 120 or any(unicodedata.category(char) in ("Cc", "Cs") for char in value):
        raise APIError("查找词须为1至120个字符，不含换行或控制字符")
    return value


def tick(budget):
    budget["parts"] += 1
    if budget["parts"] > MAX_PARTS or time.monotonic() > budget["deadline"]:
        raise ScanLimit


def authored_parts(value, budget):
    """Known author fields only, with table/cell context and original text."""
    tick(budget)
    if not isinstance(value, dict):
        return
    if isinstance(value.get("name"), str):
        yield "白板名称", value["name"]
    nodes = value.get("nodes")
    # Iterators keep traversal space bounded even for a wide table.
    stack = [("indexed", enumerate(nodes if isinstance(nodes, list) else [], 1), "")]
    while stack:
        tick(budget)
        kind, items, prefix = stack[-1]
        try:
            index, item = next(items) if kind == "indexed" else (None, next(items))
        except StopIteration:
            stack.pop()
            continue
        if kind == "indexed":
            if not isinstance(item, dict):
                continue
            where = (prefix + f"第{index}项").strip()[:160]
            for key, label in TEXT_FIELDS.items():
                tick(budget)
                raw = item.get(key)
                if isinstance(raw, str):
                    yield (where + " · " + label)[:180], raw
            image = item.get("canvasObject")
            if isinstance(image, dict) and image.get("kind") == "image" and isinstance(image.get("marks"), list):
                for index, mark in enumerate(image["marks"][:500], 1):
                    tick(budget)
                    if isinstance(mark, dict) and mark.get("kind") == "text" and isinstance(mark.get("text"), str):
                        yield (where + f" · 图片标注{index}")[:180], mark["text"]
            if item.get("type") == "table":
                columns = item.get("columns")
                if isinstance(columns, list):
                    for column, raw in enumerate(columns, 1):
                        tick(budget)
                        if isinstance(raw, str):
                            yield (where + f" · 第{column}列名称")[:180], raw
                rows = item.get("rows")
                if isinstance(rows, list):
                    for row, cells in enumerate(rows, 1):
                        tick(budget)
                        if not isinstance(cells, list):
                            continue
                        for column, raw in enumerate(cells, 1):
                            tick(budget)
                            if isinstance(raw, str):
                                yield (where + f" · 第{row}行第{column}列")[:180], raw
                grid = item.get("cellItems")
                if isinstance(grid, list):
                    stack.append(("cells", enumerate(grid, 1), where))
        elif kind == "cells":
            # Cell grids are handled lazily rather than flattening attachments.
            row, cells = item
            if isinstance(cells, list):
                stack.append(("cellRow", enumerate(cells, 1), prefix + f" · 第{row}行"))
        elif kind == "cellRow":
            column, cell = item
            if isinstance(cell, list):
                stack.append(("indexed", enumerate(cell, 1), prefix + f"第{column}列 · 嵌入"))
    edges = value.get("edges")
    if isinstance(edges, list):
        for index, edge in enumerate(edges, 1):
            tick(budget)
            if isinstance(edge, dict) and isinstance(edge.get("label"), str):
                yield f"第{index}条连线", edge["label"]


def excerpt(raw, query):
    """Case-insensitive literal match, keeping the author's original characters.

    Casefold expansion (e.g. Straße/STRASSE) needs an original-character offset;
    returning a slice of the folded text would silently rewrite the excerpt.
    """
    folded = raw.casefold()
    start = folded.find(query.casefold())
    if start < 0:
        return None
    offset = 0
    original_start = None
    for index, char in enumerate(raw):
        next_offset = offset + len(char.casefold())
        if next_offset > start:
            original_start = index
            break
        offset = next_offset
    left = max(0, original_start - 24)
    # Long queries can expand during case folding. Keep every excerpt bounded
    # even then; ellipses indicate a slice, not a rewritten complete document.
    right = min(len(raw), left + EXCERPT_LENGTH)
    return ("…" if left else "") + raw[left:right] + ("…" if right < len(raw) else "")


@transaction.atomic
def search_boards(scope, account, query):
    query = search_query([query])
    records = WorkspaceDocument.objects.filter(workspace=scope.workspace, kind="board", deleted_at__isnull=True, purged_at__isnull=True)
    budget = {"parts": 0, "deadline": time.monotonic() + MAX_SECONDS}
    identities, byte_count, scanned, limited = [], 0, 0, False
    for meta in records.order_by("-updated_at", "pk").values("pk", "byte_size")[:MAX_RECORDS + 1]:
        if len(identities) >= MAX_RECORDS or byte_count + meta["byte_size"] > MAX_BYTES or time.monotonic() > budget["deadline"]:
            limited = True
            break
        identities.append(meta["pk"])
        byte_count += meta["byte_size"]
    results = []
    for record in records.filter(pk__in=identities).order_by("-updated_at", "pk").only("key", "value", "updated_at").iterator(chunk_size=1):
        hit = None
        try:
            for label, raw in authored_parts(record.value, budget):
                found = excerpt(raw, query)
                tick(budget)
                if found is not None:
                    hit = {"id": record.key, "name": record.value.get("name", ""), "context": label, "excerpt": found,
                           "updated": record.updated_at.timestamp()}
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
    return {"account": account.pk, "workspace": str(scope.workspace.pk), "query": query, "items": results,
            "scannedBoards": scanned, "coverage": "limited" if limited else "currentSupportedText",
            "checkedAt": timezone.now().timestamp(), "excludes": ["trash", "history", "privateDrafts", "browserInput", "fileContents", "unknownFields"],
            "limits": {"boards": MAX_RECORDS, "bytes": MAX_BYTES, "parts": MAX_PARTS, "results": MAX_RESULTS}}
