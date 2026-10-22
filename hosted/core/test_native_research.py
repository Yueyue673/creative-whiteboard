import base64
import copy
import io
import json
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.test import Client, SimpleTestCase, TestCase, override_settings

from .documents import document_etag, put_document, usage
from .media import upload_stream, update_asset, asset_etag
from .models import Account, Membership, ResearchRecord, WorkspaceDocument, DocumentRevision
from .native_views import snapshot as library_snapshot
from .scope import WorkspaceScope
from .services import create_shared_workspace

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')


@override_settings(HOSTED_NATIVE_RESEARCH=True)
class NativeResearchTests(TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='creative-scoped-research-');self.addCleanup(self.tmp.cleanup)
        self.override=override_settings(HOSTED_DATA_ROOT=Path(self.tmp.name));self.override.enable();self.addCleanup(self.override.disable)
        self.owner=Account.objects.create_user('research@example.test','fixture-only-password');self.other=Account.objects.create_user('foreign@example.test','fixture-only-password')
        self.space=create_shared_workspace(self.owner,'Original research fixture');self.foreign=create_shared_workspace(self.other,'Isolated fixture');self.scope=WorkspaceScope(self.space,'owner')
        self.board={'format':'creative-board','version':1,'name':'Original author title','folder':'','nodes':[{'id':i,'type':'note','title':i,'body':'Exact author words '+i,'x':0,'y':0,'w':300,'h':200} for i in ['chosen','other']],'edges':[],'view':{'x':0,'y':0,'z':1}}
        _,self.tag=put_document(self.scope,self.owner,'board','A',self.board,'new');self.client.force_login(self.owner);self.base=f'/w/{self.space.pk}/api/'

    def pack(self,key='task'):
        req={'id':key,'resource':'board','targetId':'A','baseETag':self.tag,'task':'Find original published sources; do not rewrite.','ids':['chosen'],'nodeIds':['chosen'],'keepWords':True,'keepNotes':True,'allowAdd':False,'allowDelete':False}
        return {'format':'creative-board-context','version':1,'resource':'board','targetId':'A','baseETag':self.tag,'requestId':key,'selectedIds':['chosen'],'request':req,'data':{**copy.deepcopy(self.board),'nodes':[copy.deepcopy(self.board['nodes'][0])]},'visualInput':[{'kind':'image','nodeIds':['chosen'],'ownerId':'chosen','data':'data:image/png;base64,'+base64.b64encode(PNG).decode()}]}

    def call(self,path,method='GET',value=None,tag=None,account=None):
        headers={'HTTP_X_CREATIVE_ACCOUNT':str(account or self.owner.pk)}
        if tag is not None:headers['HTTP_IF_MATCH']=tag
        return getattr(self.client,method.lower())(self.base+path,data=json.dumps(value) if value is not None else None,content_type='application/json',**headers)

    def save(self,key='task'):
        response=self.call('ai/tasks/'+key,'PUT',self.pack(key),'new');self.assertEqual(response.status_code,200,response.content);return response.json()

    def authored(self):return [list(model.objects.order_by('pk').values()) for model in [WorkspaceDocument,DocumentRevision]]

    def test_task_is_immutable_exact_scoped_and_survives_a_new_client(self):
        before=self.authored();value=self.pack();value['request'].update(keepWords=False,allowAdd=True);value['files']=[{'path':'/etc/passwd'}];value['localTaskPath']='/private/server/path';value['proposalRules']={'write':True}
        saved=self.call('ai/tasks/task','PUT',value,'new');self.assertEqual(saved.status_code,200,saved.content);pack=saved.json()
        self.assertEqual(pack['data']['nodes'],[self.board['nodes'][0]]);self.assertNotIn('Exact author words other',saved.content.decode());self.assertNotIn('localTaskPath',pack);self.assertNotIn('proposalRules',pack)
        self.assertTrue(pack['request']['keepWords']);self.assertFalse(pack['request']['allowAdd']);self.assertTrue(pack['aiPolicy']['readOnly']);self.assertEqual(pack['files'],[])
        self.client=Client();self.client.force_login(self.owner);self.assertEqual(self.call('ai/tasks/task').json(),pack)
        self.assertEqual(self.call('ai/tasks/task','PUT',value,'new').status_code,409);self.assertEqual(ResearchRecord.objects.count(),1);self.assertEqual(before,self.authored())
        self.assertEqual(self.call('ai/tasks').json()[0]['id'],'task')

    def test_task_images_and_bundle_contain_exact_bytes_and_no_storage_paths(self):
        pack=self.save();image=pack['visuals']['images'][0]
        url=f'ai/tasks/task/files/{image["name"]}';self.assertEqual(self.call(url).content,PNG)
        archive=self.call('ai/tasks/task/bundle');self.assertEqual(archive.status_code,200)
        with zipfile.ZipFile(io.BytesIO(archive.content)) as source:
            self.assertEqual(source.read(image['archivePath']),PNG);self.assertEqual(json.loads(source.read('task.json')),pack)
            self.assertIn('不创作',source.read('说明.txt').decode())
        self.assertNotIn(self.tmp.name,archive.content.decode(errors='ignore'))
        self.assertEqual(self.call('ai/tasks/task/files/not-recorded.png').status_code,404)

    def test_current_ignores_camera_but_tracks_authored_content_and_preserves_snapshot(self):
        original=self.save();self.assertTrue(self.call('ai/tasks/task/current').json()['contentUnchanged'])
        value=copy.deepcopy(self.board);value['view']['x']=500;_,tag=put_document(self.scope,self.owner,'board','A',value,self.tag)
        self.assertTrue(self.call('ai/tasks/task/current').json()['contentUnchanged']);value['nodes'][0]['body']='Exact later author words';put_document(self.scope,self.owner,'board','A',value,tag)
        self.assertFalse(self.call('ai/tasks/task/current').json()['contentUnchanged']);self.assertEqual(self.call('ai/tasks/task').json(),original)

    def test_stale_source_and_forged_selection_are_rejected_without_records(self):
        value=self.pack();value['data']['nodes'][0]['body']='Forged';self.assertEqual(self.call('ai/tasks/task','PUT',value,'new').status_code,409)
        value=self.pack();value['request']['ids'].append('other');self.assertEqual(self.call('ai/tasks/task','PUT',value,'new').status_code,400)
        changed=copy.deepcopy(self.board);changed['nodes'][0]['body']='Changed';put_document(self.scope,self.owner,'board','A',changed,self.tag)
        self.assertEqual(self.call('ai/tasks/task','PUT',self.pack(),'new').status_code,409);self.assertEqual(ResearchRecord.objects.count(),0)

    def test_foreign_workspace_and_changed_login_cannot_read_material_or_images(self):
        pack=self.save();image=pack['visuals']['images'][0]['name']
        for suffix in ['ai/tasks','ai/tasks/task','ai/tasks/task/current','ai/tasks/task/bundle','ai/tasks/task/files/'+image,'ai/references','proposals']:
            self.assertEqual(self.call(suffix,account=self.other.pk).status_code,409)
            response=self.client.get(f'/w/{self.foreign.pk}/api/'+suffix,HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk));self.assertEqual(response.status_code,404)
        self.assertEqual(self.client.get(self.base+'ai/tasks/task/files/'+image+'?account='+str(self.other.pk)).status_code,409)

    def test_viewer_reads_but_cannot_prepare_or_submit_and_removed_member_reads_nothing(self):
        pack=self.save();Membership.objects.create(workspace=self.space,account=self.other,role='viewer');self.client.force_login(self.other)
        self.assertEqual(self.call('ai/tasks/task',account=self.other.pk).status_code,200)
        self.assertEqual(self.call('ai/tasks/other','PUT',self.pack('other'),'new',account=self.other.pk).status_code,403)
        self.assertEqual(self.call('ai/references/new','PUT',{},'new',account=self.other.pk).status_code,403)
        Membership.objects.filter(workspace=self.space,account=self.other).delete()
        self.assertEqual(self.call('ai/tasks/task',account=self.other.pk).status_code,404)
        self.assertEqual(self.call('ai/tasks/task/files/'+pack['visuals']['images'][0]['name'],account=self.other.pk).status_code,404)

    def test_csrf_and_missing_account_and_missing_create_precondition_are_refused(self):
        client=Client(enforce_csrf_checks=True);client.force_login(self.owner)
        self.assertEqual(client.put(self.base+'ai/tasks/task',data=json.dumps(self.pack()),content_type='application/json',HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk),HTTP_IF_MATCH='new').status_code,403)
        self.assertEqual(self.client.get(self.base+'ai/tasks').status_code,428)
        self.assertEqual(self.call('ai/tasks/task','PUT',self.pack()).status_code,428);self.assertEqual(ResearchRecord.objects.count(),0)

    def reply(self):return {'format':'creative-board-references','version':1,'requestId':'task','sources':[{'id':'source','title':'Original title','url':'https://example.test/original','finding':'Sourced observation','limitations':'Only the stated conditions'}]}

    def test_sources_persist_separately_and_never_change_authored_work(self):
        self.save();before=self.authored();reply=self.reply();response=self.call('ai/references/ref','PUT',reply,'new');self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(self.call('ai/references/ref').json()['sources'],reply['sources']);self.assertEqual(self.call('ai/references').json()[0]['count'],1)
        self.assertEqual(self.call('ai/references/ref','PUT',reply,'new').status_code,409);self.assertEqual(before,self.authored())

    def test_sources_require_original_task_and_safe_links_and_reject_write_back_fields(self):
        self.save()
        for index,change in enumerate([{'requestId':'absent'},{'changes':[]},{'data':{}},{'title':'AI copy'}]):
            response=self.call('ai/references/ref'+str(index),'PUT',{**self.reply(),**change},'new');self.assertIn(response.status_code,[400,404])
        for url in ['javascript:alert(1)','file:///etc/passwd','https://user:secret@example.test','https://[broken']:
            value=self.reply();value['sources'][0]['url']=url;self.assertEqual(self.call('ai/references/ref','PUT',value,'new').status_code,400)
        self.assertEqual(ResearchRecord.objects.filter(kind='reference').count(),0)

    def test_invalid_image_scope_and_payload_do_not_leave_partial_records(self):
        for index,change in enumerate([{'nodeIds':['other']},{'data':'data:text/html;base64,AAAA'},{'locations':[{'nodeId':'other','ownerId':'other','path':'/private'}]},{'data':'data:image/png;base64,invalid'}]):
            value=self.pack('bad'+str(index));value['visualInput'][0].update(change);self.assertEqual(self.call('ai/tasks/bad'+str(index),'PUT',value,'new').status_code,400)
        self.assertEqual(ResearchRecord.objects.count(),0)

    def test_quota_rolls_back_task_and_images_and_counts_saved_material(self):
        before=self.authored()
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):self.assertEqual(self.call('ai/tasks/task','PUT',self.pack(),'new').status_code,413)
        self.assertEqual(ResearchRecord.objects.count(),0);self.assertEqual(before,self.authored());self.save();self.assertGreater(usage(self.space.pk)['researchBytes'],len(PNG))

    def test_stop_new_preparation_preserves_existing_material_sources_and_bundle(self):
        self.save()
        with override_settings(HOSTED_NATIVE_RESEARCH=False):
            self.assertEqual(self.call('ai/tasks/new','PUT',self.pack('new'),'new').status_code,503)
            for suffix in ['ai/tasks/task','ai/tasks','ai/tasks/task/bundle']:self.assertEqual(self.call(suffix).status_code,200)
        self.assertEqual(ResearchRecord.objects.count(),1)

    def test_legacy_proposals_list_and_read_are_scoped_and_all_write_back_stays_blocked(self):
        self.assertEqual(self.call('proposals').json(),[]);self.assertEqual(self.call('proposals/old').status_code,404)
        old={'format':'creative-board-proposal','title':'Original legacy record','changes':[{'body':'Legacy words only'}]}
        ResearchRecord.objects.create(workspace=self.space,kind='legacy',key='old',value=old,summary={'title':'Original legacy record'},byte_size=200,created_by=self.owner)
        before=self.authored();self.assertEqual(self.call('proposals/old').json(),old)
        for suffix in ['proposals/old','proposals/old/status']:self.assertEqual(self.call(suffix,'PUT',{'status':'applied'},'new').status_code,400)
        self.assertEqual(self.authored(),before);self.assertEqual(ResearchRecord.objects.get(key='old').value,old)

    def test_library_uses_exact_native_catalog_version_and_excludes_unselected_names(self):
        catalog={'version':1,'folders':['Chosen','Unselected private name'],'assets':[{'id':'bundle','title':'Chosen bundle','folder':'Chosen','mime':'application/x-creative-bundle','path':'','bundle':{'nodes':[self.board['nodes'][0]],'edges':[]}}]}
        put_document(self.scope,self.owner,'library','catalog',catalog,'new');native,tag,_,_=library_snapshot(self.scope,self.owner);value=self.pack();value.update(resource='library',targetId='catalog',baseETag=tag,data={'assets':native['assets'],'folders':native['folders']},selectedIds=['bundle']);value['request'].update(resource='library',targetId='catalog',baseETag=tag,ids=['bundle'],nodeIds=[]);value['visualInput']=[]
        response=self.call('ai/tasks/task','PUT',value,'new');self.assertEqual(response.status_code,200,response.content);self.assertEqual(response.json()['data']['folders'],['Chosen']);self.assertNotIn('Unselected private name',response.content.decode())

    def test_registered_file_excerpt_is_scoped_and_never_reads_client_paths(self):
        raw=b'<p>Exact registered paragraph</p><script>do not extract this</script>';asset=upload_stream(self.scope,self.owner,io.BytesIO(raw),len(raw),'generic.html','')
        board=copy.deepcopy(self.board);board['nodes'][0]['assetId']=str(asset.pk);_,self.tag=put_document(self.scope,self.owner,'board','A',board,self.tag);self.board=board
        value=self.pack();value['files']=[{'path':'/etc/passwd'}];response=self.call('ai/tasks/task','PUT',value,'new');self.assertEqual(response.status_code,200,response.content);files=response.json()['files'];self.assertEqual(files[0]['id'],str(asset.pk));self.assertIn('Exact registered paragraph',files[0]['text']);self.assertNotIn('do not extract',files[0]['text']);self.assertNotIn('path',files[0])

    def test_library_current_is_account_independent_and_media_metadata_changes_refuse_stale_tasks(self):
        asset=upload_stream(self.scope,self.owner,io.BytesIO(PNG),len(PNG),'generic.png','')
        native,tag,_,_=library_snapshot(self.scope,self.owner);value=self.pack();value.update(resource='library',targetId='catalog',baseETag=tag,data={'assets':native['assets']},selectedIds=[str(asset.pk)]);value['request'].update(resource='library',targetId='catalog',baseETag=tag,ids=[str(asset.pk)],nodeIds=[]);value['visualInput']=[]
        self.assertEqual(self.call('ai/tasks/task','PUT',value,'new').status_code,200)
        Membership.objects.create(workspace=self.space,account=self.other,role='viewer');self.client.force_login(self.other)
        self.assertTrue(self.call('ai/tasks/task/current',account=self.other.pk).json()['contentUnchanged'])
        self.client.force_login(self.owner);update_asset(self.scope,self.owner,asset.pk,{'title':'Changed title'},asset_etag(asset));value['requestId']=value['request']['id']='stale'
        self.assertEqual(self.call('ai/tasks/stale','PUT',value,'new').status_code,409)

    def test_malformed_image_owners_and_locations_are_user_errors_not_server_failures(self):
        for index,change in enumerate([{'ownerId':[]},{'locations':[{'nodeId':{},'ownerId':'chosen','path':'data'}]},{'locations':[{'nodeId':'chosen','ownerId':[],'path':'data'}]}]):
            value=self.pack('bad'+str(index));value['visualInput'][0].update(change);self.assertEqual(self.call('ai/tasks/bad'+str(index),'PUT',value,'new').status_code,400)
        self.assertEqual(ResearchRecord.objects.count(),0)

    def test_operator_flag_stops_source_reply_writes_without_hiding_existing_sources(self):
        self.save();response=self.call('ai/references/ref','PUT',self.reply(),'new');self.assertEqual(response.status_code,200)
        with override_settings(HOSTED_NATIVE_RESEARCH=False):
            self.assertEqual(self.call('ai/references/new','PUT',self.reply(),'new').status_code,503)
            self.assertEqual(self.call('ai/references/ref').json()['sources'],self.reply()['sources'])

    def test_foreign_media_reference_never_authorizes_reading_another_workspace_file(self):
        asset=upload_stream(WorkspaceScope(self.foreign,'owner'),self.other,io.BytesIO(PNG),len(PNG),'foreign.png','')
        board=copy.deepcopy(self.board);board['nodes'][0]['assetId']=str(asset.pk);_,self.tag=put_document(self.scope,self.owner,'board','A',board,self.tag);self.board=board
        with patch('core.native_research.open_media',side_effect=AssertionError('A foreign file must not be opened')):
            response=self.call('ai/tasks/task','PUT',self.pack(),'new');self.assertEqual(response.status_code,200,response.content);self.assertEqual(response.json()['files'],[])

    def test_reply_quota_and_oversize_request_leave_existing_material_untouched(self):
        pack=self.save()
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):self.assertEqual(self.call('ai/references/ref','PUT',self.reply(),'new').status_code,413)
        with override_settings(HOSTED_MAX_RESEARCH_BYTES=100):self.assertEqual(self.call('ai/tasks/new','PUT',self.pack('new'),'new').status_code,413)
        self.assertEqual(ResearchRecord.objects.filter(kind='reference').count(),0);self.assertEqual(self.call('ai/tasks/task').json(),pack)

    def test_legacy_edge_without_identity_refuses_material_without_server_failure(self):
        board=copy.deepcopy(self.board);board['edges']=[{'from':'chosen','to':'chosen'}];_,self.tag=put_document(self.scope,self.owner,'board','A',board,self.tag);self.board=board
        response=self.call('ai/tasks/task','PUT',self.pack(),'new');self.assertEqual(response.status_code,409);self.assertIn('连线',response.json()['error']);self.assertEqual(ResearchRecord.objects.count(),0)


class NativeResearchMigrationTests(SimpleTestCase):
    def test_schema8_preserves_existing_rows_and_refuses_to_drop_retained_material(self):
        import os,subprocess,sys
        from django.conf import settings
        with tempfile.TemporaryDirectory(prefix='creative-research-migration-') as temporary:
            env=dict(os.environ,DJANGO_SETTINGS_MODULE='service.settings',CREATIVE_BOARD_HOSTED_DATA_DIR=temporary,CREATIVE_BOARD_HOSTED_SECRET='fixture-secret-'+'z'*64,CREATIVE_BOARD_HOSTED_HOSTS='localhost',CREATIVE_BOARD_HOSTED_ORIGINS='',PYTHONIOENCODING='utf-8');env.pop('CREATIVE_BOARD_HOSTED_TRUST_PROXY',None)
            def run(*args):return subprocess.run([sys.executable,*args],cwd=settings.BASE_DIR,env=env,text=True,capture_output=True,encoding='utf-8',timeout=30)
            self.assertEqual(run('manage.py','migrate','--noinput').returncode,0)
            seed="""import django,json
django.setup()
from core.models import Account
from core.services import create_shared_workspace
from core.scope import WorkspaceScope
from core.documents import put_document
from core.test_documents import sample_board
owner=Account.objects.create_user('owner@example.test','fixture-only-pass');space=create_shared_workspace(owner,'Exact original');put_document(WorkspaceScope(space,'owner'),owner,'board','A',sample_board('Exact retained author words'),'new')
"""
            self.assertEqual(run('-c',seed).returncode,0);self.assertEqual(run('manage.py','migrate','core','0007','--noinput').returncode,0)
            snapshot="""import hashlib,json,sqlite3,os
from contextlib import closing
with closing(sqlite3.connect(os.path.join(os.environ['CREATIVE_BOARD_HOSTED_DATA_DIR'],'accounts.sqlite3'))) as db:
 names=[r[0] for r in db.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'core_%' AND name!='core_researchrecord' ORDER BY name\")]
 print(json.dumps({name:hashlib.sha256(json.dumps(list(db.execute('SELECT * FROM '+name+' ORDER BY 1'))).encode()).hexdigest() for name in names}))
"""
            before=run('-c',snapshot);self.assertEqual(before.returncode,0,before.stderr)
            self.assertEqual(run('manage.py','migrate','--noinput').returncode,0);self.assertEqual(run('-c',snapshot).stdout,before.stdout)
            seed="""import django
django.setup()
from core.models import Account,Workspace,ResearchRecord
ResearchRecord.objects.create(workspace=Workspace.objects.get(),created_by=Account.objects.get(),kind='task',key='retained',value={'literal':'Exact retained material'},summary={'task':'Original question'},byte_size=100)
"""
            self.assertEqual(run('-c',seed).returncode,0);denied=run('manage.py','migrate','core','0007','--noinput');self.assertNotEqual(denied.returncode,0);self.assertIn('IrreversibleError',denied.stderr)
            check=run('-c',"import django;django.setup();from core.models import ResearchRecord;assert ResearchRecord.objects.get().value=={'literal':'Exact retained material'}")
            self.assertEqual(check.returncode,0,check.stderr)
