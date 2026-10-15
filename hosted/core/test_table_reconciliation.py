"""Exact strings in existing stable cells; ambiguous changes remain private."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

from django.db import close_old_connections
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings

from . import test_documents as fixtures
from .documents import document_etag, put_document, usage
from .json_data import document_bytes
from .models import Account, ConflictDraft, WorkspaceDocument
from .reconciliation import ReconciliationConflict, reconcile_board, reconcile_values
from .scope import WorkspaceScope


def original():
    value = fixtures.sample_board()
    value['nodes'][0].update(type='table', columns=['A', 'B'],
        rows=[['Original A', 'Original B'], ['Original C', 'Original D']],
        rowIds=['row-a', 'row-b'], columnIds=['col-a', 'col-b'],
        columnWidths=[160, 170], cellItems=[[[{'body': '  Own raw  '}], []], [[], []]],
        cellImages=[[[], []], [[], []]], opaque={'keep': [True, 1, '  Original  ']})
    return value


class TableCellModelTests(SimpleTestCase):
    def test_disjoint_complete_strings_and_independent_fields_are_exact_and_immutable(self):
        base = original(); own = deepcopy(base); peer = deepcopy(base)
        own['nodes'][0]['rows'][0][0] = '  Own **raw**\r\n第二行 😀  '
        peer['nodes'][0]['rows'][0][1] = '  Peer\n\t  '
        peer['nodes'][0]['title'] = 'Peer title'
        before = [document_bytes(value) for value in (base, own, peer)]
        result = reconcile_values(base, own, peer)
        self.assertEqual(result['nodes'][0]['rows'][0], [own['nodes'][0]['rows'][0][0], peer['nodes'][0]['rows'][0][1]])
        self.assertEqual(result['nodes'][0]['title'], 'Peer title')
        for key in ('rowIds', 'columnIds', 'columnWidths', 'cellItems', 'cellImages', 'opaque'):
            self.assertEqual(result['nodes'][0][key], base['nodes'][0][key])
        self.assertEqual(before, [document_bytes(value) for value in (base, own, peer)])

    def test_same_cell_overlap_refuses_complete_operation_and_identical_strings_converge(self):
        base = original(); own = deepcopy(base); peer = deepcopy(base)
        own['nodes'][0]['rows'][0] = ['Own A', 'Own B']
        peer['nodes'][0]['rows'][0][1] = 'Peer B'
        with self.assertRaises(ReconciliationConflict): reconcile_values(base, own, peer)
        peer['nodes'][0]['rows'][0][1] = 'Own B'
        self.assertEqual(reconcile_values(base, own, peer), own)

    def test_axes_geometry_embedded_and_opaque_changes_refuse_cell_splitting(self):
        for field, value in [('rowIds', ['row-b', 'row-a']), ('columnIds', ['col-b', 'col-a']),
                ('columns', ['Changed', 'B']), ('columnWidths', [170, 170]), ('x', 99), ('sizeMode', 'auto'),
                ('cellItems', [[[], []], [[], []]]), ('cellImages', [[['changed'], []], [[], []]]),
                ('opaque', {'keep': [1, 1, '  Original  ']})]:
            with self.subTest(field=field):
                base = original(); own = deepcopy(base); peer = deepcopy(base)
                own['nodes'][0]['rows'][0][0] = 'Own A'; peer['nodes'][0][field] = value
                with self.assertRaises(ReconciliationConflict): reconcile_values(base, own, peer)
        base = original(); own = deepcopy(base); peer = deepcopy(base)
        own['nodes'][0]['rows'][0][0] = 'Own'; peer['nodes'][0]['rows'].append(['', ''])
        peer['nodes'][0]['rowIds'].append('new-row')
        with self.assertRaises(ReconciliationConflict): reconcile_values(base, own, peer)

    def test_legacy_or_malformed_axes_and_nontext_cells_never_gain_inferred_identity(self):
        for field, value in [('rowIds', None), ('columnIds', ['col-a', 'col-a']),
                ('rowIds', ['row-a', '']), ('rowIds', ['row-a', 1]), ('rowIds', ['x' * 101, 'row-b']),
                ('rows', [['Original A', 'Original B'], ['Original C']]),
                ('rows', [['Original A', 'Original B'], ['Original C', True]])]:
            with self.subTest(field=field, value=value):
                base = original()
                if value is None: del base['nodes'][0][field]
                else: base['nodes'][0][field] = value
                own = deepcopy(base); peer = deepcopy(base)
                own['nodes'][0]['rows'][0][0] = 'Own'; peer['nodes'][0]['rows'][0][1] = 'Peer'
                with self.assertRaises(ReconciliationConflict): reconcile_values(base, own, peer)
        base = original(); base['nodes'][0]['rowIds'][0] = '😀' * 100
        own = deepcopy(base); peer = deepcopy(base)
        own['nodes'][0]['rows'][0][0] = 'Own'; peer['nodes'][0]['rows'][0][1] = 'Peer'
        self.assertEqual(reconcile_values(base, own, peer)['nodes'][0]['rows'][0], ['Own', 'Peer'])


class TableCellAPITests(TestCase):
    setUp = fixtures.DocumentAPITests.setUp
    url = fixtures.DocumentAPITests.url
    api = fixtures.DocumentAPITests.api
    create = fixtures.DocumentAPITests.create

    def prepare(self):
        base = original(); tag = self.create(value=base)
        peer = deepcopy(base); peer['nodes'][0]['rows'][0][1] = '  Peer exact\r\n😀  '
        result = self.api('boards/one/reconcile', 'POST', {'baseETag': tag, 'board': peer}, client=self.editor_client, account=self.editor)
        self.assertEqual(result.status_code, 200)
        return base, tag, peer

    def test_retained_base_merges_cells_and_canonical_history_keeps_both_actual_authors(self):
        base, tag, peer = self.prepare()
        own = deepcopy(base); own['nodes'][0]['rows'][0][0] = '  Own exact\r\n第二行  '
        result = self.api('boards/one/reconcile', 'POST', {'baseETag': tag, 'board': own})
        self.assertEqual(result.status_code, 200, result.content); self.assertTrue(result.json()['merged'])
        stored = WorkspaceDocument.objects.get(workspace=self.shared, key='one')
        self.assertEqual(stored.revision, 3); self.assertEqual(stored.updated_by_id, self.owner.pk)
        self.assertEqual(result['ETag'], document_etag(stored)); self.assertEqual(result.json()['board'], stored.value)
        self.assertEqual(stored.value['nodes'][0]['rows'][0], [own['nodes'][0]['rows'][0][0], peer['nodes'][0]['rows'][0][1]])
        self.assertEqual(stored.versions.get(revision=1).value, base)
        self.assertEqual(stored.versions.get(revision=2).value, peer)
        self.assertFalse(ConflictDraft.objects.exists())

    def test_overlap_keeps_exact_private_input_without_partially_accepting_other_cells(self):
        base, tag, peer = self.prepare()
        own = deepcopy(base); own['nodes'][0]['rows'][0] = ['Own independent A', 'Own conflicting B']
        result = self.api('boards/one/reconcile', 'POST', {'baseETag': tag, 'board': own})
        self.assertEqual(result.status_code, 409)
        stored = WorkspaceDocument.objects.get(workspace=self.shared, key='one')
        self.assertEqual(stored.value, peer); self.assertEqual(stored.revision, 2)
        draft = ConflictDraft.objects.get(); self.assertEqual(draft.value, own); self.assertEqual(draft.actor_id, self.owner.pk)

    def test_quota_failure_rolls_back_combined_cells_history_and_actor(self):
        base, tag, _ = self.prepare(); stored = WorkspaceDocument.objects.get(workspace=self.shared, key='one')
        before = document_bytes(stored.value); history = list(stored.versions.values())
        own = deepcopy(base); own['nodes'][0]['rows'][0][0] = 'Own longer original ' * 1000
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=usage(self.shared.pk)['totalBytes'] + 1):
            result = self.api('boards/one/reconcile', 'POST', {'baseETag': tag, 'board': own})
        self.assertEqual(result.status_code, 413)
        after = WorkspaceDocument.objects.get(pk=stored.pk)
        self.assertEqual(document_bytes(after.value), before); self.assertEqual(after.revision, stored.revision)
        self.assertEqual(after.updated_by_id, stored.updated_by_id); self.assertEqual(list(after.versions.values()), history)
        self.assertFalse(ConflictDraft.objects.exists())


class ConcurrentTableCellTests(TransactionTestCase):
    setUp = fixtures.DocumentAPITests.setUp

    def test_two_real_transactions_preserve_different_cells_in_one_table(self):
        base = original(); _, tag = put_document(WorkspaceScope(self.shared, 'owner'), self.owner, 'board', 'one', base, 'new')
        barrier = Barrier(2)
        def submit(account_id, column):
            close_old_connections()
            try:
                account = Account.objects.get(pk=account_id); value = deepcopy(base)
                value['nodes'][0]['rows'][0][column] = '  Author ' + str(column) + '\r\n😀  '
                barrier.wait(timeout=10)
                return reconcile_board(WorkspaceScope(self.shared, 'owner' if column == 0 else 'editor'), account, 'one', value, tag)
            finally: close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(submit, account.pk, column) for column, account in enumerate((self.owner, self.editor))]
            self.assertTrue(all(future.result(timeout=30)[0]['saved'] for future in futures))
        stored = WorkspaceDocument.objects.get(workspace=self.shared, key='one')
        self.assertEqual(stored.revision, 3)
        self.assertEqual(stored.value['nodes'][0]['rows'][0], ['  Author 0\r\n😀  ', '  Author 1\r\n😀  '])
        self.assertFalse(ConflictDraft.objects.exists())
