import copy
import json
import time
import uuid
from unittest.mock import patch
from contextlib import closing

from django.test import Client, SimpleTestCase, TestCase, override_settings

from .cleanup import apply_cleanup, preview_cleanup
from .documents import document_etag, put_document, save_revision, usage
from .models import Account, DocumentRevision, Membership, NativeFolderTrash, WorkspaceDocument
from .native_folders import batch_etag, preview, remove, restore
from .scope import WorkspaceScope
from .services import APIError, create_shared_workspace
from .test_documents import sample_board


@override_settings(HOSTED_NATIVE_FOLDER_DELETE=True)
class NativeFolderTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('folder@example.test', 'fixture-only-password')
        self.editor = Account.objects.create_user('editor@example.test', 'fixture-only-password')
        self.foreign = create_shared_workspace(self.editor, 'Independent fixture')
        self.space = create_shared_workspace(self.owner, 'Original folder fixture')
        Membership.objects.create(workspace=self.space, account=self.editor, role='editor')
        self.scope = WorkspaceScope(self.space, 'owner')
        self.catalog = {'folders': [{'id': 'parent', 'name': 'Keep parent'}, {'id': 'folder', 'name': 'Own folder', 'parent': 'parent'}, {'id': 'child', 'name': 'Own child', 'parent': 'folder'}]}
        _, self.tag = put_document(self.scope, self.owner, 'folders', 'catalog', self.catalog, 'new')
        self.originals = {}
        for key, folder in [('one', 'folder'), ('two', 'child'), ('outside', 'parent')]:
            value = sample_board('  Exact original ' + key + ' 😀\r\n');value['folder'] = folder
            put_document(self.scope, self.owner, 'board', key, value, 'new');self.originals[key] = value
        self.client.force_login(self.owner)
        self.base = f'/w/{self.space.pk}/api/'

    def snapshot(self):
        return {model.__name__: list(model.objects.order_by('pk').values()) for model in [WorkspaceDocument, DocumentRevision, NativeFolderTrash]}

    def delete(self, actor=None):
        actor = actor or self.owner
        token = preview(self.scope, actor, 'folder', self.tag)['plan']
        return remove(self.scope, actor, 'folder', self.tag, token)

    def batch(self):
        return NativeFolderTrash.objects.get(workspace=self.space)

    def call(self, suffix, method='GET', value=None, tag=None, account=None):
        headers = {'HTTP_X_CREATIVE_ACCOUNT': str(account or self.owner.pk)}
        if tag is not None:headers['HTTP_IF_MATCH'] = tag
        return getattr(self.client, method.lower())(self.base + suffix, data=json.dumps(value) if value is not None else None, content_type='application/json', **headers)

    def test_original_hierarchy_and_exact_boards_roundtrip_preserves_unrelated_work(self):
        outside = copy.deepcopy(WorkspaceDocument.objects.get(workspace=self.space, key='outside').__dict__)
        result = self.delete();self.assertEqual(set(result['ids']), {'one', 'two'});self.assertEqual(set(result['folderIds']), {'folder', 'child'})
        self.assertEqual(WorkspaceDocument.objects.get(workspace=self.space, kind='folders').value, {'folders': [self.catalog['folders'][0]]})
        batch = self.batch();self.assertGreater(usage(self.space.pk)['trashMetadataBytes'], 0)
        current = WorkspaceDocument.objects.get(workspace=self.space, kind='folders')
        put_document(self.scope, self.owner, 'folders', 'catalog', {'folders': current.value['folders'] + [{'id': 'later', 'name': 'Later work'}]}, document_etag(current))
        restored = restore(self.scope, self.owner, batch.pk, batch_etag(batch));self.assertEqual(set(restored['ids']), {'one', 'two'})
        self.assertFalse(NativeFolderTrash.objects.exists())
        self.assertEqual({row['id'] for row in WorkspaceDocument.objects.get(workspace=self.space, kind='folders').value['folders']}, {'parent', 'folder', 'child', 'later'})
        for key, value in self.originals.items():
            row=WorkspaceDocument.objects.get(workspace=self.space, kind='board', key=key);self.assertEqual(row.value, value);self.assertIsNone(row.deleted_at)
        outside_after = WorkspaceDocument.objects.get(workspace=self.space, key='outside').__dict__;outside.pop('_state');outside_after.pop('_state');self.assertEqual(outside, outside_after)

    def test_plan_refuses_a_board_save_after_preview_without_partial_delete(self):
        plan=preview(self.scope,self.owner,'folder',self.tag)['plan'];row=WorkspaceDocument.objects.get(workspace=self.space,key='two')
        value={**row.value,'name':'Exact later name'};put_document(self.scope,self.editor,'board','two',value,document_etag(row));before=self.snapshot()
        with self.assertRaisesMessage(APIError,'刚刚有变化'):remove(self.scope,self.owner,'folder',self.tag,plan)
        self.assertEqual(self.snapshot(),before)

    def test_new_board_and_move_into_folder_after_preview_are_not_silently_deleted(self):
        for key in ['new', 'outside']:
            with self.subTest(key=key):
                plan=preview(self.scope,self.owner,'folder',self.tag)['plan']
                if key=='new':put_document(self.scope,self.editor,'board',key,{**sample_board('Exact new'),'folder':'child'},'new')
                else:
                    row=WorkspaceDocument.objects.get(workspace=self.space,key=key);put_document(self.scope,self.editor,'board',key,{**row.value,'folder':'folder'},document_etag(row))
                before=self.snapshot()
                with self.assertRaises(APIError):remove(self.scope,self.owner,'folder',self.tag,plan)
                self.assertEqual(self.snapshot(),before)

    def test_changed_catalog_and_plan_scope_or_expiry_refuse_before_writing(self):
        token=preview(self.scope,self.owner,'folder',self.tag)['plan'];before=self.snapshot()
        for scope,actor,key,plan in [(WorkspaceScope(self.foreign,'owner'),self.editor,'folder',token),(self.scope,self.editor,'folder',token),(self.scope,self.owner,'child',token),(self.scope,self.owner,'folder',token+'tampered')]:
            with self.assertRaises(APIError):remove(scope,actor,key,self.tag,plan)
        with patch('django.core.signing.time.time',return_value=time.time()+301):
            with self.assertRaises(APIError):remove(self.scope,self.owner,'folder',self.tag,token)
        self.assertEqual(self.snapshot(),before)
        put_document(self.scope,self.owner,'folders','catalog',{'folders':self.catalog['folders']+[{'id':'new','name':'New'}]},self.tag);after=self.snapshot()
        with self.assertRaises(APIError):remove(self.scope,self.owner,'folder',self.tag,token)
        self.assertEqual(self.snapshot(),after)

    def test_role_change_is_rechecked_inside_the_write_lock(self):
        scope=WorkspaceScope(self.space,'editor');token=preview(scope,self.editor,'folder',self.tag)['plan']
        Membership.objects.filter(workspace=self.space,account=self.editor).update(role='viewer');before=self.snapshot()
        with self.assertRaises(APIError) as caught:remove(scope,self.editor,'folder',self.tag,token)
        self.assertEqual(caught.exception.status,403);self.assertEqual(self.snapshot(),before)

    def test_quota_and_mid_batch_write_failure_roll_back_every_document(self):
        before=self.snapshot();plan=preview(self.scope,self.owner,'folder',self.tag)['plan']
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=usage(self.space.pk)['totalBytes']+1):
            with self.assertRaises(APIError) as caught:remove(self.scope,self.owner,'folder',self.tag,plan)
        self.assertEqual(caught.exception.status,413);self.assertEqual(self.snapshot(),before)
        calls=0
        def fail_later(document):
            nonlocal calls
            calls+=1
            if calls==2:raise RuntimeError('Synthetic second-write failure')
            return save_revision(document)
        with patch('core.native_folders.save_revision',side_effect=fail_later):
            with self.assertRaises(RuntimeError):remove(self.scope,self.owner,'folder',self.tag,plan)
        self.assertEqual(self.snapshot(),before)

    def test_empty_folder_has_a_persistent_restorable_record(self):
        current={'folders':self.catalog['folders']+[{'id':'empty','name':'Empty'}]};_,tag=put_document(self.scope,self.owner,'folders','catalog',current,self.tag)
        result=remove(self.scope,self.owner,'empty',tag,preview(self.scope,self.owner,'empty',tag)['plan']);self.assertEqual(result['ids'],[])
        batch=self.batch();restore(self.scope,self.owner,batch.pk,batch_etag(batch));self.assertEqual(WorkspaceDocument.objects.get(workspace=self.space,kind='folders').value,current)

    def test_restore_refuses_id_collision_missing_parent_or_changed_board_atomically(self):
        self.delete();batch=self.batch();before=self.snapshot()
        row=WorkspaceDocument.objects.get(workspace=self.space,key='one');row.revision_token=uuid.uuid4();row.save();changed=self.snapshot()
        with self.assertRaisesMessage(APIError,'另外处理'):restore(self.scope,self.owner,batch.pk,batch_etag(batch))
        self.assertEqual(self.snapshot(),changed)
        row.revision_token=before['WorkspaceDocument'][next(i for i,r in enumerate(before['WorkspaceDocument']) if r['key']=='one')]['revision_token'];row.save()
        catalog=WorkspaceDocument.objects.get(workspace=self.space,kind='folders');put_document(self.scope,self.owner,'folders','catalog',{'folders':catalog.value['folders']+[self.catalog['folders'][1]]},document_etag(catalog));collision=self.snapshot()
        with self.assertRaisesMessage(APIError,'编号已另有内容'):restore(self.scope,self.owner,batch.pk,batch_etag(batch))
        self.assertEqual(self.snapshot(),collision)

    def test_restore_with_removed_parent_keeps_entire_batch(self):
        self.delete();batch=self.batch()
        outside=WorkspaceDocument.objects.get(workspace=self.space,key='outside');put_document(self.scope,self.owner,'board','outside',{**outside.value,'folder':''},document_etag(outside))
        catalog=WorkspaceDocument.objects.get(workspace=self.space,kind='folders');put_document(self.scope,self.owner,'folders','catalog',{'folders':[]},document_etag(catalog));before=self.snapshot()
        with self.assertRaisesMessage(APIError,'上级'):restore(self.scope,self.owner,batch.pk,batch_etag(batch))
        self.assertEqual(self.snapshot(),before)

    def test_restore_quota_failure_keeps_record_and_all_tombstones(self):
        self.delete();batch=self.batch();before=self.snapshot()
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):
            with self.assertRaises(APIError):restore(self.scope,self.owner,batch.pk,batch_etag(batch))
        self.assertEqual(self.snapshot(),before)
        restore(self.scope,self.owner,batch.pk,batch_etag(batch))

    def test_group_members_cannot_be_individually_purged_and_break_recovery(self):
        self.delete();before=self.snapshot()
        for action in [lambda:preview_cleanup(self.scope,self.owner,'board','one','discard_board'),lambda:apply_cleanup(self.scope,self.owner,'board','one','discard_board','"'+'0'*64+'"','discard_board')]:
            with self.assertRaisesMessage(APIError,'整夹回收记录'):action()
        self.assertEqual(self.snapshot(),before)

    def test_protected_routes_return_persistent_batch_after_new_client_and_restore_exactly_once(self):
        response=self.call('native/folders/folder',tag=self.tag);self.assertEqual(response.status_code,200)
        removed=self.call('native/folders/folder','DELETE',{'plan':response.json()['plan']},self.tag);self.assertEqual(removed.status_code,200,removed.content);ticket=removed.json()['ticket']
        self.client=Client();self.client.force_login(self.owner)
        rows=self.call('native/trash').json();self.assertEqual(len(rows),1);self.assertEqual((rows[0]['kind'],rows[0]['id'],rows[0]['boardCount']),('folder',ticket,2))
        self.assertEqual(rows[0]['folderCount'],2);self.assertEqual(rows[0]['folders'],['Own folder'])
        restored=self.call('native/trash/'+ticket+'/restore','POST',{},rows[0]['etag']);self.assertEqual(restored.status_code,200,restored.content);self.assertEqual(set(restored.json()['ids']),{'one','two'})
        self.assertEqual(self.call('native/trash/'+ticket+'/restore','POST',{},rows[0]['etag']).status_code,404)

    def test_account_workspace_viewer_and_csrf_boundaries_refuse_mutations(self):
        read=self.call('native/folders/folder',tag=self.tag);plan=read.json()['plan'];before=self.snapshot()
        self.assertEqual(self.call('native/folders/folder','DELETE',{'plan':plan},self.tag,account=self.editor.pk).status_code,409)
        self.client.force_login(self.editor);Membership.objects.filter(workspace=self.space,account=self.editor).update(role='viewer')
        self.assertEqual(self.call('native/folders/folder','DELETE',{'plan':plan},self.tag,account=self.editor.pk).status_code,403)
        csrf=Client(enforce_csrf_checks=True);csrf.force_login(self.owner);self.assertEqual(csrf.delete(self.base+'native/folders/folder',data=json.dumps({'plan':plan}),content_type='application/json',HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk),HTTP_IF_MATCH=self.tag).status_code,403)
        Membership.objects.filter(workspace=self.space,account=self.editor).delete();self.assertEqual(self.call('native/trash',account=self.editor.pk).status_code,404)
        self.assertEqual(self.snapshot(),before)

    def test_operator_can_disable_new_folder_deletes_without_disabling_existing_recovery(self):
        self.delete();batch=self.batch();before=self.snapshot()
        with override_settings(HOSTED_NATIVE_FOLDER_DELETE=False):
            denied=self.call('native/folders/parent','DELETE',{'plan':'not-used'},self.tag)
            self.assertEqual(denied.status_code,503);self.assertEqual(self.snapshot(),before)
            row=self.call('native/trash').json()[0]
            restored=self.call('native/trash/'+batch.pk.hex+'/restore','POST',{},row['etag']);self.assertEqual(restored.status_code,200)
        self.assertFalse(NativeFolderTrash.objects.exists())


class NativeFolderMigrationTests(SimpleTestCase):
    def test_existing_rows_survive_upgrade_and_active_batch_blocks_schema_rollback(self):
        import hashlib
        import os
        from pathlib import Path
        import sqlite3
        import subprocess
        import sys
        import tempfile
        from django.conf import settings
        with tempfile.TemporaryDirectory(prefix='creative-folder-migration-') as temporary:
            root=Path(temporary);env=dict(os.environ,DJANGO_SETTINGS_MODULE='service.settings',CREATIVE_BOARD_HOSTED_DATA_DIR=str(root/'data'),CREATIVE_BOARD_HOSTED_SECRET='fixture-secret-'+'z'*64,CREATIVE_BOARD_HOSTED_HOSTS='localhost',CREATIVE_BOARD_HOSTED_ORIGINS='',PYTHONIOENCODING='utf-8');env.pop('CREATIVE_BOARD_HOSTED_TRUST_PROXY',None)
            def run(*args):return subprocess.run([sys.executable,*args],cwd=settings.BASE_DIR,env=env,capture_output=True,text=True,encoding='utf-8',timeout=30)
            self.assertEqual(run('manage.py','migrate','--noinput').returncode,0)
            self.assertEqual(run('manage.py','migrate','core','0006','--noinput').returncode,0)
            seed='''
import django
django.setup()
from core.models import Account,WorkspaceDocument
from core.services import create_shared_workspace
from core.documents import save_revision
from core.json_data import document_bytes
from core.test_documents import sample_board
owner=Account.objects.create_user('migration@example.test','fixture-only-password')
space=create_shared_workspace(owner,'Retained store')
for kind,key,value in [('folders','catalog',{'folders':[{'id':'folder','name':'Exact folder'}]}),('board','one',{**sample_board('  Exact old words 😀\\r\\n'),'folder':'folder'})]:
 row=WorkspaceDocument.objects.create(workspace=space,kind=kind,key=key,value=value,byte_size=len(document_bytes(value)),updated_by=owner);save_revision(row)
'''
            seeded=run('-c',seed);self.assertEqual(seeded.returncode,0,seeded.stderr)
            database=root/'data/accounts.sqlite3'
            def snapshot():
                with closing(sqlite3.connect(database)) as db:
                    tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('django_migrations','core_nativefoldertrash')")]
                    return {table:hashlib.sha256(json.dumps(db.execute('SELECT * FROM "'+table+'" ORDER BY 1').fetchall()).encode()).hexdigest() for table in tables}
            before=snapshot();upgraded=run('manage.py','migrate','--noinput');self.assertEqual(upgraded.returncode,0,upgraded.stderr);self.assertEqual(snapshot(),before)
            delete='''
import django
django.setup()
from core.models import Account,Workspace,WorkspaceDocument
from core.scope import WorkspaceScope
from core.documents import document_etag
from core.native_folders import preview,remove
owner=Account.objects.get();scope=WorkspaceScope(Workspace.objects.get(),'owner');tag=document_etag(WorkspaceDocument.objects.get(kind='folders'))
remove(scope,owner,'folder',tag,preview(scope,owner,'folder',tag)['plan'])
'''
            deleted=run('-c',delete);self.assertEqual(deleted.returncode,0,deleted.stderr);retained=snapshot()
            refused=run('manage.py','migrate','core','0006','--noinput');self.assertNotEqual(refused.returncode,0);self.assertIn('IrreversibleError',refused.stderr);self.assertEqual(snapshot(),retained)
            with closing(sqlite3.connect(database)) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM core_nativefoldertrash').fetchone()[0],1)
            recovered=run('-c',"import django;django.setup();from core.models import NativeFolderTrash;from core.native_folders import restore,batch_etag;from core.scope import WorkspaceScope;b=NativeFolderTrash.objects.select_related('workspace','created_by').get();restore(WorkspaceScope(b.workspace,'owner'),b.created_by,b.pk,batch_etag(b))");self.assertEqual(recovered.returncode,0,recovered.stderr)
            rolled_back=run('manage.py','migrate','core','0006','--noinput');self.assertEqual(rolled_back.returncode,0,rolled_back.stderr)
