"""Bounded identity matching of saved bundle copies, with no file or network reads."""
import re
import time

MAX_RECORDS = 500
MAX_BYTES = 8 * 1024 * 1024
MAX_PARTS = 100000
MAX_RESULTS = 40
MAX_SECONDS = 1.2
MAX_DEPTH = 16
IDENTITY = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")


class CopyScanLimit(Exception):
    pass


class CopyResultsFull(Exception):
    pass


def copy_query(values):
    if set(values) != {"id"} or len(values["id"]) != 1:
        raise ValueError("请选择一份内容库原件")
    value = values["id"][0]
    if not isinstance(value, str) or not IDENTITY.fullmatch(value):
        raise ValueError("内容库原件编号无效")
    return value


def node_identity(value):
    return isinstance(value, str) and 0 < len(value) <= 1000 and "\x00" not in value


def label(value):
    if not isinstance(value, str):
        return ""
    return value if len(value) <= 500 else value[:500] + "…"


def scan_budget():
    return {"parts": 0, "deadline": time.monotonic() + MAX_SECONDS}


def tick(budget):
    budget["parts"] += 1
    if budget["parts"] > MAX_PARTS or time.monotonic() > budget["deadline"]:
        raise CopyScanLimit


def board_copies(value, identity, budget=None, maximum=MAX_RESULTS):
    """Only actual libraryOrigin identities, in known root/cell node positions.

    A budget-interrupted board contributes no uncertain partial rows. A result
    cap can keep the known first rows and explicitly reports limited coverage.
    Unknown fields and physical-file references never imply a bundle copy.
    """
    budget = scan_budget() if budget is None else budget
    items, limited = [], False
    if not isinstance(value, dict) or not isinstance(value.get("nodes"), list):
        return {"items": [], "limited": True}
    nodes = value["nodes"]
    try:
        roots = {}
        for node in nodes:
            tick(budget)
            if isinstance(node, dict):
                key = node.get("id")
                if isinstance(key, str):
                    roots[key] = roots.get(key, 0) + 1

        def walk(node, root, context, depth):
            nonlocal limited
            tick(budget)
            if depth > MAX_DEPTH:
                raise CopyScanLimit
            if not isinstance(node, dict):
                limited = True
                return
            origin = node.get("libraryOrigin")
            if isinstance(origin, dict) and origin.get("id") == identity:
                key = node.get("id")
                if not node_identity(key):
                    limited = True
                else:
                    if len(items) >= maximum:
                        raise CopyResultsFull
                    items.append({"rootId": root["id"], "nodeId": key,
                                  "title": label(node.get("title")),
                                  "context": context[:180]})
            if node.get("type") != "table":
                return
            grid = node.get("cellItems", [])
            if not isinstance(grid, list):
                limited = True
                return
            for row_index, row in enumerate(grid, 1):
                tick(budget)
                if not isinstance(row, list):
                    limited = True
                    continue
                for column_index, cell in enumerate(row, 1):
                    tick(budget)
                    if not isinstance(cell, list):
                        limited = True
                        continue
                    for item_index, child in enumerate(cell, 1):
                        walk(child, root, context + f" · 第{row_index}行第{column_index}列第{item_index}项", depth + 1)

        for index, root in enumerate(nodes, 1):
            tick(budget)
            key = root.get("id") if isinstance(root, dict) else None
            if not node_identity(key) or roots.get(key) != 1:
                limited = True
                continue
            walk(root, root, f"第{index}块", 0)
    except CopyResultsFull:
        return {"items": items, "limited": True}
    except CopyScanLimit:
        return {"items": [], "limited": True, "interrupted": True}
    return {"items": items, "limited": limited}


def copy_response(identity, items, scanned, limited):
    return {"assetId": identity, "items": items, "scannedBoards": scanned,
            "coverage": "limited" if limited else "currentSupportedCopies",
            "checkedAt": time.time(),
            "excludes": ["trash", "history", "privateDrafts", "browserInput",
                         "fileContents", "untrackedCopies", "unknownFields"],
            "limits": {"boards": MAX_RECORDS, "bytes": MAX_BYTES,
                       "parts": MAX_PARTS, "results": MAX_RESULTS, "depth": MAX_DEPTH}}

