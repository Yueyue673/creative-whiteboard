import copy
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import Client, SimpleTestCase, TestCase, TransactionTestCase, override_settings

from . import test_documents as fixtures
from .documents import document_etag, put_document, usage
from .json_data import document_bytes
from .models import Account, ConflictDraft, DocumentRevision, Membership, WorkspaceDocument
from .reconciliation import ReconciliationConflict, reconcile_board, reconcile_values
from .scope import WorkspaceScope


def original():
    value = fixtures.sample_board('  Literal own **text**\r\n第二行 😀  ')
    second = copy.deepcopy(value['nodes'][0]); second.update(id='second', title='Second own title', y=400)
    value['nodes'].append(second)
    value['nodes'][0]['opaque'] = {'original': [True, 1.0, '  original  ']}
    value['opaqueBoard'] = {'unknown': [29]}
    return value


class ReconciliationModelTests(SimpleTestCase):
    def test_separated_original_note_lines_preserve_literal_endings_and_inputs(self):
        for ending in ('\n','\r\n'):
            for final in ('',ending):
                for a,c in ((0,2),(2,0)):
                    rows=['  第一行 😀 e\u0301\t','Unchanged separator','  Third **literal**  ']
                    base=original();base['nodes'][0]['body']=ending.join(rows)+final
                    incoming=copy.deepcopy(base);current=copy.deepcopy(base)
                    own=rows[:];peer=rows[:];both=rows[:]
                    own[a]+=' / own';peer[c]+=' / peer';both[a]=own[a];both[c]=peer[c]
                    incoming['nodes'][0]['body']=ending.join(own)+final
                    current['nodes'][0]['body']=ending.join(peer)+final
                    snapshots=[document_bytes(v) for v in (base,incoming,current)]
                    result=reconcile_values(base,incoming,current)
                    self.assertEqual(result['nodes'][0]['body'],ending.join(both)+final)
                    self.assertEqual(document_bytes(result),document_bytes(reconcile_values(base,current,incoming)))
                    self.assertEqual(snapshots,[document_bytes(v) for v in (base,incoming,current)])
        base=original();base['nodes'][0]['body']='first\r\nmiddle\nthird\r\n'
        incoming=copy.deepcopy(base);current=copy.deepcopy(base)
        incoming['nodes'][0]['body']='own\r\nmiddle\nthird\r\n';current['nodes'][0]['body']='first\r\nmiddle\npeer\r\n'
        self.assertEqual(reconcile_values(base,incoming,current)['nodes'][0]['body'],'own\r\nmiddle\npeer\r\n')

    def test_ambiguous_note_lines_and_dependent_context_still_refuse_whole_operation(self):
        text='first\nseparator\nthird\nanother separator\nfifth'
        for own,peer in [('own\nseparator\nthird\nanother separator\nfifth',text.replace('first','peer')),
                         (text.replace('first','own'),text.replace('separator','adjacent',1)),
                         (text.replace('first','own')+'\nadded',text.replace('fifth','peer')),
                         (text.replace('first','own').replace('\n','\r\n'),text.replace('fifth','peer')),
                         (text.replace('first','third'),text.replace('fifth','peer')),
                         (text.replace('first','same'),text.replace('fifth','same')),
                         (text.replace('first',' \t'),text.replace('fifth','peer')),
                         (text.replace('first','own').replace('third','other own'),text.replace('fifth','peer'))]:
            base=original();base['nodes'][0]['body']=text
            incoming=copy.deepcopy(base);current=copy.deepcopy(base)
            incoming['nodes'][0]['body']=own;current['nodes'][0]['body']=peer
            before=[document_bytes(v) for v in (base,incoming,current)]
            with self.assertRaises(ReconciliationConflict):reconcile_values(base,incoming,current)
            self.assertEqual(before,[document_bytes(v) for v in (base,incoming,current)])
        for patch_value in ({'textFormat':'plain'},{'userText':'peer'},{'opaque':{'meaning':'peer'}}):
            base=original();base['nodes'][0]['body']=text
            incoming=copy.deepcopy(base);current=copy.deepcopy(base)
            incoming['nodes'][0]['body']=text.replace('first','own');current['nodes'][0]['body']=text.replace('fifth','peer')
            current['nodes'][0].update(patch_value)
            with self.assertRaises(ReconciliationConflict):reconcile_values(base,incoming,current)

    def test_note_line_range_and_original_identity_are_bounded(self):
        for text in ('first\nmiddle\nfirst\nlast\nfifth',' \t\nmiddle\nthird','中'*21845+'\nmiddle\nthird','\n'.join(str(i) for i in range(2049)),'first\rbroken\nmiddle\nthird'):
            base=original();base['nodes'][0]['body']=text
            incoming=copy.deepcopy(base);current=copy.deepcopy(base)
            own=text.split('\n');peer=own[:];own[0]='own';peer[-1]='peer'
            incoming['nodes'][0]['body']='\n'.join(own);current['nodes'][0]['body']='\n'.join(peer)
            with self.assertRaises(ReconciliationConflict):reconcile_values(base,incoming,current)

    def test_disjoint_notes_and_fields_preserve_originals_without_mutating_inputs(self):
        base = original(); incoming = copy.deepcopy(base); current = copy.deepcopy(base)
        incoming['nodes'][0]['body'] = '  My own\nnew text  '
        current['nodes'][0]['title'] = 'Other own title'
        current['nodes'][1]['annotation'] = 'Another own observation'
        snapshots = [document_bytes(value) for value in (base, incoming, current)]
        result = reconcile_values(base, incoming, current)
        self.assertEqual(result['nodes'][0]['body'], incoming['nodes'][0]['body'])
        self.assertEqual(result['nodes'][0]['title'], current['nodes'][0]['title'])
        self.assertEqual(result['nodes'][1]['annotation'], current['nodes'][1]['annotation'])
        self.assertEqual(result['nodes'][0]['w'], 320)
        self.assertEqual(result['nodes'][0]['sizeMode'], 'manual')
        self.assertEqual(document_bytes(result['nodes'][0]['opaque']), document_bytes(base['nodes'][0]['opaque']))
        self.assertEqual(snapshots, [document_bytes(value) for value in (base, incoming, current)])

    def test_overlapping_text_layout_and_structural_table_changes_are_refused(self):
        for local_patch, remote_patch in [({'body':'Own A'}, {'body':'Own B'}), ({'x':30}, {'y':80}),
                                           ({'textFormat':'plain'}, {'body':'Own B'}),
                                           ({'paperStyle':'grid'}, {'color':'#112233'}),
                                           ({'opaque':{'first':1}}, {'opaque':{'second':2}}),
                                           ({'opaque':{'first':1}}, {'body':'Other own text'}),
                                           ({'rows':[['Own cell']]}, {'columns':['Own heading']}),
                                           ({'type':'frame'}, {'title':'New title'})]:
            with self.subTest(local=local_patch):
                base=original();incoming=copy.deepcopy(base);current=copy.deepcopy(base)
                incoming['nodes'][0].update(local_patch);current['nodes'][0].update(remote_patch)
                with self.assertRaises(ReconciliationConflict): reconcile_values(base,incoming,current)

    def test_append_order_is_authoritative_and_original_order_changes_are_refused(self):
        base=original();incoming=copy.deepcopy(base);current=copy.deepcopy(base)
        local=copy.deepcopy(base['nodes'][0]);local['id']='local-new'
        remote=copy.deepcopy(local);remote['id']='remote-new'
        incoming['nodes'].append(local);current['nodes'].append(remote)
        result=reconcile_values(base,incoming,current)
        self.assertEqual([node['id'] for node in result['nodes']], ['note','second','remote-new','local-new'])
        incoming['nodes']=list(reversed(base['nodes']))
        current['nodes'][0]['title']='Other title'
        with self.assertRaises(ReconciliationConflict): reconcile_values(base,incoming,current)

    def test_delete_vs_edit_and_new_identity_collisions_preserve_both_inputs(self):
        base=original();incoming=copy.deepcopy(base);current=copy.deepcopy(base)
        incoming['nodes'].pop(0);current['nodes'][0]['body']='Other original edit'
        with self.assertRaises(ReconciliationConflict): reconcile_values(base,incoming,current)
        incoming=copy.deepcopy(base);current=copy.deepcopy(base)
        for value,title in ((incoming,'Own addition'),(current,'Other addition')):
            node=copy.deepcopy(base['nodes'][0]);node.update(id='new-same-id',title=title);value['nodes'].append(node)
        with self.assertRaises(ReconciliationConflict): reconcile_values(base,incoming,current)
        incoming=copy.deepcopy(base);incoming['nodes'].pop(0);current=copy.deepcopy(base);current['nodes'][1]['body']='Other second'
        result=reconcile_values(base,incoming,current)
        self.assertEqual([n['id'] for n in result['nodes']],['second'])
        self.assertEqual(result['nodes'][0]['body'],'Other second')

    def test_unknown_values_and_boolean_numeric_changes_are_not_normalized(self):
        base=original();incoming=copy.deepcopy(base);current=copy.deepcopy(base)
        incoming['nodes'][0]['opaque']['original'][0]=1
        current['nodes'][1]['title']='Other title'
        result=reconcile_values(base,incoming,current)
        self.assertIs(type(result['nodes'][0]['opaque']['original'][0]),int)
        self.assertIs(type(base['nodes'][0]['opaque']['original'][0]),bool)
        self.assertIs(type(result['nodes'][0]['opaque']['original'][1]),float)
        incoming['opaqueBoard']={'same':True};current['opaqueBoard']={'same':1}
        with self.assertRaises(ReconciliationConflict): reconcile_values(base,incoming,current)

    def test_legacy_edges_without_ids_are_whole_and_dangling_refs_are_not_invented(self):
        base=original();base['edges']=[{'from':'note','to':'second','label':'Own relation'}]
        incoming=copy.deepcopy(base);current=copy.deepcopy(base)
        incoming['edges'][0]['label']='Local relation';current['edges'][0]['label']='Remote relation'
        with self.assertRaises(ReconciliationConflict): reconcile_values(base,incoming,current)


class ReconciliationAPITests(TestCase):
    setUp=fixtures.DocumentAPITests.setUp
    url=fixtures.DocumentAPITests.url
    api=fixtures.DocumentAPITests.api
    create=fixtures.DocumentAPITests.create

    def submit(self,value,tag,**kwargs):
        return self.api('boards/one/reconcile','POST',{'baseETag':tag,'board':value},**kwargs)

    def stored(self):
        return WorkspaceDocument.objects.get(workspace=self.shared,kind='board',key='one')

    def test_separated_same_note_authors_keep_exact_history_and_inverse_own_operation(self):
        base=original();base['nodes'][0]['body']='  First original 😀  \r\nUnchanged separator\r\nThird original\r\n'
        tag=self.create(value=base);remote=copy.deepcopy(base);remote['nodes'][0]['body']=remote['nodes'][0]['body'].replace('Third original','Third peer')
        self.assertEqual(self.api('boards/one','PUT',remote,tag,client=self.editor_client,account=self.editor).status_code,200)
        own=copy.deepcopy(base);own['nodes'][0]['body']=own['nodes'][0]['body'].replace('First original','First own')
        result=self.submit(own,tag);self.assertEqual(result.status_code,200,result.content);self.assertTrue(result.json()['merged'])
        combined=copy.deepcopy(remote);combined['nodes'][0]['body']=combined['nodes'][0]['body'].replace('First original','First own')
        self.assertEqual(document_bytes(result.json()['board']),document_bytes(combined))
        # The browser's inverse operation uses the author's own original pair.
        undone=reconcile_values(own,base,combined);self.assertEqual(document_bytes(undone),document_bytes(remote))
        undo_save=self.submit(undone,result['ETag']);self.assertEqual(undo_save.status_code,200)
        redone=reconcile_values(base,own,undone);redo_save=self.submit(redone,undo_save['ETag']);self.assertEqual(redo_save.status_code,200)
        doc=self.stored();self.assertEqual(doc.revision,5);self.assertEqual(document_bytes(doc.value),document_bytes(combined))
        for revision,value in enumerate((base,remote,combined,remote,combined),1):self.assertEqual(document_bytes(doc.versions.get(revision=revision).value),document_bytes(value))
        self.assertFalse(ConflictDraft.objects.exists())

    def test_overlapping_same_note_keeps_peer_and_exact_private_recovery_copy(self):
        base=original();base['nodes'][0]['body']='First original\nUnchanged separator\nThird original';tag=self.create(value=base)
        remote=copy.deepcopy(base);remote['nodes'][0]['body']=remote['nodes'][0]['body'].replace('First original','First peer')
        self.api('boards/one','PUT',remote,tag,client=self.editor_client,account=self.editor)
        own=copy.deepcopy(base);own['nodes'][0]['body']=own['nodes'][0]['body'].replace('First original','  First own 😀  ')
        result=self.submit(own,tag);self.assertEqual(result.status_code,409);self.assertTrue(result.json()['draftSaved'])
        self.assertEqual(document_bytes(self.stored().value),document_bytes(remote));draft=ConflictDraft.objects.get()
        self.assertEqual(document_bytes(draft.value),document_bytes(own));self.assertEqual(draft.actor_id,self.owner.pk)
        self.assertEqual(self.api('conflicts/'+str(draft.pk),client=self.editor_client,account=self.editor).status_code,404)

    def test_note_line_candidate_cannot_bypass_fresh_role_or_workspace_quota(self):
        base=original();base['nodes'][0]['body']='First original\nUnchanged separator\nThird original';tag=self.create(value=base)
        remote=copy.deepcopy(base);remote['nodes'][0]['body']=remote['nodes'][0]['body'].replace('Third original','Third peer')
        self.api('boards/one','PUT',remote,tag,client=self.editor_client,account=self.editor)
        doc=self.stored();before=document_bytes(doc.value);versions=list(doc.versions.values());own=copy.deepcopy(base);own['nodes'][0]['body']=own['nodes'][0]['body'].replace('First original','First own '+'x'*1000)
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=usage(self.shared.pk)['totalBytes']+1):self.assertEqual(self.submit(own,tag).status_code,413)
        with patch('core.reconciliation.require_current_editor',side_effect=fixtures.APIError('Fresh loss',403)):self.assertEqual(self.submit(own,tag).status_code,403)
        after=self.stored();self.assertEqual(document_bytes(after.value),before);self.assertEqual(after.revision,doc.revision);self.assertEqual(after.updated_by_id,doc.updated_by_id);self.assertEqual(list(after.versions.values()),versions);self.assertFalse(ConflictDraft.objects.exists())

    def test_disjoint_author_submissions_are_combined_and_canonical_response_matches_history(self):
        base=original();tag=self.create(value=base)
        remote=copy.deepcopy(base);remote['nodes'][1]['body']='Remote own literal\r\nline'
        accepted=self.api('boards/one','PUT',remote,tag,client=self.editor_client,account=self.editor)
        self.assertEqual(accepted.status_code,200)
        local=copy.deepcopy(base);local['nodes'][0]['title']='Local own title'
        result=self.submit(local,tag)
        self.assertEqual(result.status_code,200,result.content)
        self.assertTrue(result.json()['merged'])
        current=self.stored();self.assertEqual(result['ETag'],document_etag(current))
        self.assertEqual(document_bytes(result.json()['board']),document_bytes(current.value))
        self.assertEqual(current.value['nodes'][0]['title'],'Local own title')
        self.assertEqual(current.value['nodes'][1]['body'],remote['nodes'][1]['body'])
        self.assertEqual(current.updated_by_id,self.owner.pk)
        self.assertEqual(current.revision,3)
        self.assertEqual(document_bytes(current.versions.get(revision=2).value),document_bytes(remote))
        self.assertEqual(document_bytes(current.versions.get(revision=1).value),document_bytes(base))
        self.assertFalse(ConflictDraft.objects.exists())
        unchanged=self.submit(current.value,result['ETag'])
        self.assertTrue(unchanged.json()['unchanged']);self.assertFalse(unchanged.json()['merged'])
        self.assertEqual(unchanged['ETag'],result['ETag'])
        stale_noop=self.submit(base,tag)
        self.assertEqual(stale_noop.status_code,200)
        self.assertTrue(stale_noop.json()['unchanged'])
        self.assertEqual(stale_noop['ETag'],result['ETag'])
        self.assertEqual(self.stored().revision,3)

    def test_overlapping_original_text_is_exact_private_conflict_and_regular_put_stays_conditional(self):
        base=original();tag=self.create(value=base)
        remote=copy.deepcopy(base);remote['nodes'][0]['body']='Other author exact text'
        current=self.api('boards/one','PUT',remote,tag)['ETag']
        local=copy.deepcopy(base);local['nodes'][0]['body']='  Own draft 😀\r\n  '
        result=self.submit(local,tag)
        self.assertEqual(result.status_code,409)
        self.assertTrue(result.json()['draftSaved'])
        draft=ConflictDraft.objects.get();self.assertEqual(draft.actor_id,self.owner.pk)
        self.assertEqual(document_bytes(draft.value),document_bytes(local))
        self.assertEqual(document_bytes(self.stored().value),document_bytes(remote))
        regular=copy.deepcopy(base);regular['nodes'][1]['title']='Independent legacy PUT'
        self.assertEqual(self.api('boards/one','PUT',regular,tag).status_code,409)
        other=self.api('conflicts/'+str(draft.pk),client=self.editor_client,account=self.editor)
        self.assertEqual(other.status_code,404)
        self.assertEqual(document_etag(self.stored()),current)

    def test_unretained_cross_workspace_or_fabricated_base_is_never_a_merge_authority(self):
        base=original();tag=self.create(value=base)
        foreign=self.create(value=base,workspace=self.personal)
        remote=copy.deepcopy(base);remote['nodes'][1]['title']='Current other change'
        current=self.api('boards/one','PUT',remote,tag)['ETag']
        local=copy.deepcopy(base);local['nodes'][0]['title']='Own change'
        for wrong in (foreign,'"'+'a'*64+'"'):
            self.assertEqual(self.submit(local,wrong).status_code,409)
            self.assertEqual(document_etag(self.stored()),current)
        DocumentRevision.objects.filter(document=self.stored(),revision=1).delete()
        self.assertEqual(self.submit(local,tag).status_code,409)
        self.assertEqual(document_bytes(self.stored().value),document_bytes(remote))

    def test_history_gap_and_trash_restore_barrier_refuse_old_pages(self):
        base=original();tag=self.create(value=base)
        one=copy.deepcopy(base);one['nodes'][1]['title']='Other one'
        second=self.api('boards/one','PUT',one,tag)['ETag']
        two=copy.deepcopy(one);two['nodes'][1]['body']='Other two'
        third=self.api('boards/one','PUT',two,second)['ETag']
        DocumentRevision.objects.filter(document=self.stored(),revision=2).delete()
        local=copy.deepcopy(base);local['nodes'][0]['title']='Local pending'
        self.assertEqual(self.submit(local,tag).status_code,409)
        removed=self.api('boards/one','DELETE',etag=third)
        self.assertEqual(removed.status_code,200)
        result=self.submit(local,third);self.assertEqual(result.status_code,409)
        self.assertEqual(result.json()['code'],'deleted')
        restored=self.api('boards/one/restore','POST',etag=removed['ETag'])
        self.assertEqual(restored.status_code,200)
        self.assertEqual(self.submit(local,third).status_code,409)
        self.assertEqual(document_bytes(self.stored().value),document_bytes(two))

    def test_each_mutation_rechecks_fixed_account_workspace_fresh_role_and_csrf(self):
        base=original();tag=self.create(value=base);local=copy.deepcopy(base);local['name']='Own new name'
        self.assertEqual(self.submit(local,tag,workspace=self.other_personal).status_code,404)
        self.assertEqual(self.submit(local,tag,identity=False).status_code,428)
        self.assertEqual(self.submit(local,tag,account=self.editor).status_code,409)
        self.assertEqual(self.submit(local,tag,client=Client()).status_code,401)
        Membership.objects.filter(workspace=self.shared,account=self.editor).update(role='viewer')
        self.assertEqual(self.submit(local,tag,client=self.editor_client,account=self.editor).status_code,403)
        secure=Client(enforce_csrf_checks=True);secure.force_login(self.owner)
        self.assertEqual(self.submit(local,tag,client=secure).status_code,403)
        with patch('core.reconciliation.require_current_editor',side_effect=fixtures.APIError('Fresh loss',403)):
            self.assertEqual(self.submit(local,tag).status_code,403)
        self.assertEqual(document_etag(self.stored()),tag);self.assertFalse(ConflictDraft.objects.exists())

    def test_invalid_envelopes_preconditions_and_original_board_fail_without_writes(self):
        base=original();tag=self.create(value=base)
        for envelope in ({}, {'baseETag':tag,'board':base,'extra':True}, {'baseETag':True,'board':base}, {'baseETag':None,'board':base}, {'baseETag':tag,'board':None}):
            self.assertEqual(self.api('boards/one/reconcile','POST',envelope).status_code,400)
        for missing in ('','new'):
            self.assertEqual(self.submit(base,missing).status_code,428)
        self.assertEqual(self.api('boards/one/reconcile','POST',{'baseETag':tag,'board':base},etag=tag).status_code,400)
        invalid=copy.deepcopy(base);invalid['nodes'][0]['w']=-10
        self.assertEqual(self.submit(invalid,tag).status_code,400)
        self.assertEqual(document_etag(self.stored()),tag)
        self.assertFalse(ConflictDraft.objects.exists())

    def test_invalid_combined_edges_retains_current_and_authors_exact_unapplied_copy(self):
        base=original();tag=self.create(value=base)
        remote=copy.deepcopy(base);remote['edges']=[{'id':'edge','from':'note','to':'second','label':'Own relation'}]
        self.api('boards/one','PUT',remote,tag)
        local=copy.deepcopy(base);local['nodes'].pop(0)
        result=self.submit(local,tag);self.assertEqual(result.status_code,409)
        self.assertEqual(document_bytes(self.stored().value),document_bytes(remote))
        self.assertEqual(document_bytes(ConflictDraft.objects.get().value),document_bytes(local))

    def test_quota_error_rolls_back_merged_content_history_and_actor(self):
        base=original();tag=self.create(value=base)
        remote=copy.deepcopy(base);remote['nodes'][1]['title']='Remote title'
        self.api('boards/one','PUT',remote,tag)
        current=self.stored();before=document_bytes(current.value);history=list(current.versions.values())
        local=copy.deepcopy(base);local['nodes'][0]['body']='Own much larger original '*1000
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=usage(self.shared.pk)['totalBytes']+1):
            self.assertEqual(self.submit(local,tag).status_code,413)
        after=self.stored();self.assertEqual(document_bytes(after.value),before)
        self.assertEqual(after.updated_by_id,current.updated_by_id);self.assertEqual(after.revision,current.revision)
        self.assertEqual(history,list(after.versions.values()));self.assertFalse(ConflictDraft.objects.exists())


class ConcurrentReconciliationTests(TransactionTestCase):
    setUp=fixtures.DocumentAPITests.setUp

    def test_two_actual_transactions_preserve_independent_author_edits(self):
        scope=WorkspaceScope(self.shared,'owner');base=original()
        _,tag=put_document(scope,self.owner,'board','one',base,'new')
        barrier=Barrier(2)
        def submit(account_id,index):
            close_old_connections()
            try:
                account=Account.objects.get(pk=account_id)
                value=copy.deepcopy(base);value['nodes'][index]['body']='Own exact '+str(index)+' 😀\r\n'
                barrier.wait(timeout=10)
                return reconcile_board(WorkspaceScope(self.shared,'owner' if index==0 else 'editor'),account,'one',value,tag)
            finally: close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(submit,self.owner.pk,0),pool.submit(submit,self.editor.pk,1)]
            results=[future.result(timeout=30) for future in futures]
        self.assertTrue(all(result[0]['saved'] for result in results))
        current=WorkspaceDocument.objects.get(workspace=self.shared,key='one')
        self.assertEqual(current.revision,3)
        for i,node in enumerate(current.value['nodes']):self.assertEqual(node['body'],'Own exact '+str(i)+' 😀\r\n')
        self.assertFalse(ConflictDraft.objects.exists())
