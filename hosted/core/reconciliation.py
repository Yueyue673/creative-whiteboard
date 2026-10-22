"""Conservative original-value reconciliation, with a server-retained base.

Only two bounded, unambiguous, separated existing note-body lines can be
combined within a string. Not text generation, a CRDT, or a realtime transport. Ambiguous changes remain
the submitting author's separate conflict copy. No client-supplied base or
another author's private conflict submission is an authority.
"""
from copy import deepcopy

from django.conf import settings
from django.db import transaction

from .documents import (document_etag, find_document, put_document,
                        require_current_editor, require_precondition,
                        revision_etag, validate_document, valid_key)
from .json_data import document_bytes
from .models import WorkspaceDocument
from .services import APIError, locked_workspace


class ReconciliationConflict(ValueError):
    pass


MISSING = object()
NODE_GROUPS = (
    frozenset(("id", "type", "x", "y", "w", "h", "sizeMode")),
    frozenset(("title",)),
    frozenset(("body", "userText", "textFormat")),
    frozenset(("annotation",)),
    frozenset(("color", "paperStyle")),
    frozenset(("rows", "columns", "rowIds", "columnIds", "columnWidths", "cellItems", "cellImages")),
)


def same(first, second):
    if first is MISSING or second is MISSING:
        return first is second
    # Python True == 1 must not hide an author's opaque JSON change.
    return document_bytes(first) == document_bytes(second)


def choice(base, incoming, current):
    if same(incoming, current) or same(base, incoming):
        return current
    if same(base, current):
        return incoming
    raise ReconciliationConflict("Overlapping original-value changes")


def merge_original_note_lines(base, incoming, current):
    values = (base, incoming, current)
    try:
        if any(not isinstance(value, str) or len(value) > 65536 or len(value.encode("utf-8")) > 65536 for value in values):
            raise ReconciliationConflict("Unsupported original text range")
    except UnicodeError:
        raise ReconciliationConflict("Unsupported original scalar") from None
    parts = [value.split("\n") for value in values]
    if any(len(rows) > 2048 or len(rows) != len(parts[0]) or any("\r" in line and (i == len(rows)-1 or "\r" in line[:-1] or not line.endswith("\r")) for i, line in enumerate(rows)) for rows in parts):
        raise ReconciliationConflict("Original line count or ending changed")
    if any(any(line.endswith("\r") != parts[0][i].endswith("\r") for i, line in enumerate(rows)) for rows in parts[1:]):
        raise ReconciliationConflict("Original line ending changed")
    changed = [[i for i, line in enumerate(rows) if line != parts[0][i]] for rows in parts[1:]]
    if any(len(indices) != 1 for indices in changed) or abs(changed[0][0]-changed[1][0]) < 2:
        raise ReconciliationConflict("Adjacent or overlapping original edits")
    a, c = (indices[0] for indices in changed)
    merged = parts[0][:]
    merged[a], merged[c] = parts[1][a], parts[2][c]
    for rows in (*parts, merged):
        for i in (a, c):
            line = rows[i][:-1] if rows[i].endswith("\r") else rows[i]
            if not line.strip(" \t") or rows.count(rows[i]) != 1:
                raise ReconciliationConflict("Ambiguous repeated or blank original line")
    return "\n".join(merged)


def note_body_group(base, incoming, current):
    try:
        return choice(base, incoming, current)
    except ReconciliationConflict:
        pass
    values = (base, incoming, current)
    context = [{key: item for key, item in value.items() if key != "body"} for value in values]
    if any("body" not in value or not isinstance(value["body"], str) for value in values) or any(not same(context[0], value) for value in context[1:]):
        raise ReconciliationConflict("Original format or supplementary text changed")
    return {**deepcopy(current), "body": merge_original_note_lines(base["body"], incoming["body"], current["body"])}


def stable_cells(value):
    """Only stored, unchanged axes can identify an existing textual cell."""
    rows, columns = value.get("rows"), value.get("columns")
    if not isinstance(rows, list) or len(rows) > 5000 or not isinstance(columns, list) or not 1 <= len(columns) <= 100:
        return False
    if any(not isinstance(column, str) for column in columns):
        return False
    for name, length in (("rowIds", len(rows)), ("columnIds", len(columns))):
        ids = value.get(name)
        if not isinstance(ids, list) or len(ids) != length or any(not isinstance(key, str) or not 1 <= len(key) <= 100 for key in ids) or len(set(ids)) != length:
            return False
    return all(isinstance(row, list) and len(row) == len(columns) and all(isinstance(cell, str) for cell in row) for row in rows)


def table_cells(base, incoming, current):
    try:
        return choice(base, incoming, current)
    except ReconciliationConflict:
        pass
    values = (base, incoming, current)
    context = [{key: item for key, item in value.items() if key != "rows"} for value in values]
    if not all(stable_cells(value) for value in values) or any(not same(context[0], value) for value in context[1:]):
        raise ReconciliationConflict("Table axes, layout or embedded content changed")
    # Select each complete original string. A single overlap refuses the whole
    # operation; no partial cell writes, inferred identities or text synthesis.
    rows = [[deepcopy(choice(*cells)) for cells in zip(*versions)] for versions in zip(*(value["rows"] for value in values))]
    return {**deepcopy(current), "rows": rows}


def grouped_node(base, incoming, current):
    if any(value is MISSING for value in (base, incoming, current)):
        return choice(base, incoming, current)
    if not all(isinstance(value, dict) for value in (base, incoming, current)):
        raise ReconciliationConflict("Unsupported node")
    if incoming.get("type") != base.get("type") or current.get("type") != base.get("type"):
        return choice(base, incoming, current)
    keys = set(base) | set(incoming) | set(current)
    known = frozenset().union(*NODE_GROUPS)
    unknown = keys - known
    opaque = [{key: value[key] for key in unknown if key in value}
              for value in (base, incoming, current)]
    if base.get("type") == "image" or any(not same(opaque[0], value) for value in opaque[1:]):
        # A changed attachment/unknown extension can give nearby fields new
        # meaning. Keep that node whole rather than infer those relationships.
        return choice(base, incoming, current)
    groups = (*NODE_GROUPS, unknown)
    if base.get("type") == "table":
        groups = (NODE_GROUPS[0] | NODE_GROUPS[5], *NODE_GROUPS[1:5], unknown)
    result = {}
    for group in groups:
        values = [{key: value[key] for key in group if key in value}
                  for value in (base, incoming, current)]
        if base.get("type") == "table" and "rows" in group:
            selected = table_cells(*values)
        elif base.get("type") == "note" and "body" in group:
            selected = note_body_group(*values)
        else:
            selected = choice(*values)
        result.update(deepcopy(selected))
    return result


def sequence(base, incoming, current, *, nodes=False):
    try:
        return deepcopy(choice(base, incoming, current))
    except ReconciliationConflict:
        pass
    if not all(isinstance(value, list) for value in (base, incoming, current)):
        raise ReconciliationConflict("Unsupported sequence")
    indices, orders = [], []
    for values in (base, incoming, current):
        if any(not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"] for row in values):
            raise ReconciliationConflict("Sequence has no stable identities")
        order = [row["id"] for row in values]
        if len(order) != len(set(order)):
            raise ReconciliationConflict("Sequence has duplicate identities")
        indices.append(dict(zip(order, values)))
        orders.append(order)
    original, local, remote = indices
    for order in orders[1:]:
        surviving = [key for key in order if key in original]
        survivors = set(surviving)
        if surviving != [key for key in orders[0] if key in survivors] or order[:len(surviving)] != surviving:
            raise ReconciliationConflict("Concurrent sequence order change")
    combined = {}
    for key in set(original) | set(local) | set(remote):
        values = [index.get(key, MISSING) for index in indices]
        value = grouped_node(*values) if nodes else choice(*values)
        if value is not MISSING:
            combined[key] = deepcopy(value)
    order = orders[2] + [key for key in orders[1] if key not in remote]
    return [combined[key] for key in order if key in combined]


def reconcile_values(base, incoming, current):
    result = {}
    for key in set(base) | set(incoming) | set(current):
        values = [value.get(key, MISSING) for value in (base, incoming, current)]
        value = sequence(*values, nodes=key == "nodes") if key in ("nodes", "edges") else choice(*values)
        if value is not MISSING:
            result[key] = deepcopy(value)
    return result


def retained_base(document, expected):
    rows = list(document.versions.order_by("-revision").values("id", "revision", "deleted")[:settings.HOSTED_HISTORY_LIMIT])
    base = next((row for row in rows if revision_etag(document, row["id"]) == expected), None)
    if base is None or base["deleted"]:
        return None
    intervening = [row for row in rows if row["revision"] >= base["revision"]]
    if any(row["deleted"] for row in intervening) or len(intervening) != document.revision - base["revision"] + 1:
        return None
    return document.versions.get(pk=base["id"]).value


def reconcile_board(scope, account, key, incoming, expected):
    key = valid_key(key)
    if not isinstance(expected, str):
        raise APIError("原版本格式无效")
    expected = require_precondition(expected)
    if expected == "new":
        raise APIError("请先通过创建白板流程确认原编号，再接续共同编辑", 428)
    validate_document(WorkspaceDocument.Kind.BOARD, incoming)
    with transaction.atomic():
        workspace = locked_workspace(scope.workspace.pk)
        require_current_editor(workspace, account)
        document = find_document(workspace.pk, "board", key, include_deleted=True)
        current_tag = document_etag(document) if document else "new"
        candidate = incoming
        merged = expected != current_tag
        if merged and document and not document.deleted_at:
            base = retained_base(document, expected)
            if base is not None:
                try:
                    candidate = reconcile_values(base, incoming, document.value)
                    validate_document("board", candidate)
                except (ReconciliationConflict, APIError):
                    candidate = None
            else:
                candidate = None
        elif merged or (document and document.deleted_at):
            candidate = None
        if candidate is None:
            return put_document(scope, account, "board", key, incoming, expected)
        outcome, etag = put_document(scope, account, "board", key, candidate, current_tag)
        if outcome.get("saved"):
            outcome = {**outcome, "merged": merged, "board": candidate}
        return outcome, etag
