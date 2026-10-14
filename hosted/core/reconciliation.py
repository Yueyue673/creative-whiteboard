"""Conservative original-value reconciliation, with a server-retained base.

Not text generation, a CRDT, or a realtime transport. Ambiguous changes remain
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
        result.update(deepcopy(choice(*values)))
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
