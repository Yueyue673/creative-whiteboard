import copy
import io
import json
import uuid
from pathlib import Path

from django.conf import settings
from django.test import Client, TestCase, override_settings

from .documents import put_document
from .media import upload_stream
from .models import Account, Membership, WorkspaceDocument
from .scope import WorkspaceScope
from .services import create_personal_workspace, create_shared_workspace


class OriginalWorkbenchTests(TestCase):
    def setUp(self):
        self.owner=Account.objects.create_user('native@example.test','fixture-only-password',display_name='Original owner')
        self.other=Account.objects.create_user('other@example.test','fixture-only-password',display_name='Other')
        self.space=create_shared_workspace(self.owner,'Original workbench')
        self.foreign=create_personal_workspace(self.other)
        self.scope=WorkspaceScope(self.space,'owner');self.client.force_login(self.owner)
        self.base=f'/w/{self.space.pk}/api/';self.app=f'/w/{self.space.pk}/app/'

    def call(self,path,method='GET',value=None,tag=None,identity=None):
        h={'HTTP_X_CREATIVE_ACCOUNT':str(self.owner.pk if identity is None else identity)}
        if tag is not None:h['HTTP_IF_MATCH']=tag
        return getattr(self.client,method.lower())(path,data=json.dumps(value) if value is not None else None,content_type='application/json',**h)

    def read(self):return self.call(self.base+'native/assets')

    def test_actual_original_shell_and_canvas_program_are_used(self):
        shell=self.client.get(self.app)
        self.assertEqual(shell.status_code,200);text=shell.content.decode()
        original=(settings.PROGRAM_ROOT/'shell.html').read_text('utf-8')
        for token in ['id="shellHeader"','id="tabHeaders"','id="splitToggle"','id="boardPicker"']:
            self.assertIn(token,original);self.assertIn(token,text)
        self.assertIn(self.app+'shell.js?account=',text)
        self.assertNotIn('board-editor.js',text)
        self.assertIn("'nonce-",shell['Content-Security-Policy']);self.assertNotIn("script-src 'self' 'unsafe-inline'",shell['Content-Security-Policy'])
        self.assertEqual(shell['X-Frame-Options'],'SAMEORIGIN')
        script=self.client.get(self.app+'shell.js').content.decode()
        self.assertIn(self.app+'index.html?account='+str(self.owner.pk)+'&pane=1',script)
        self.assertEqual(self.client.get(self.app+'server.py').status_code,404)

    def test_program_and_html_require_fresh_membership_and_original_account(self):
        self.assertEqual(self.client.get(f'/w/{self.foreign.pk}/app/').status_code,404)
        self.assertEqual(self.client.get(self.app+'shell.js?account='+str(self.other.pk)).status_code,409)
        Membership.objects.filter(workspace=self.space,account=self.owner).delete()
        for name in ['','index.html','shell.js','hosted-bridge.js']:
            self.assertEqual(self.client.get(self.app+name).status_code,404)
        guest=Client();self.assertEqual(guest.get(self.app+'shell.js').status_code,401)
        self.assertNotIn(self.owner.email,guest.get(self.app).content.decode())

    def test_original_external_window_keeps_exact_account_workspace_and_board(self):
        script = self.client.get(self.app+'shell.js').content.decode()
        self.assertNotIn("w.location.replace('/?board='", script)
        self.assertIn('w.location.replace("'+self.app+'?account='+str(self.owner.pk)+'&board="+encodeURIComponent(t.boardId))', script)
        self.assertIn('if(!await pane(t).flush())', script)
        personal = create_personal_workspace(self.owner)
        personal_app = f'/w/{personal.pk}/app/'
        other_script = self.client.get(personal_app+'shell.js').content.decode()
        self.assertIn('w.location.replace("'+personal_app+'?account='+str(self.owner.pk)+'&board="', other_script)
        self.assertNotIn('w.location.replace("'+self.app, other_script)

    def test_old_external_window_url_refuses_a_new_account_instead_of_rebinding(self):
        Membership.objects.create(workspace=self.space,account=self.other,role='editor')
        self.client.force_login(self.other)
        response = self.client.get(self.app+'?account='+str(self.owner.pk)+'&board=one')
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()['code'],'account_changed')
        self.assertFalse(WorkspaceDocument.objects.filter(workspace=self.space).exists())

    def test_native_library_reuses_registered_original_bytes_and_atomic_metadata(self):
        asset=upload_stream(self.scope,self.owner,io.BytesIO(b'original synthetic bytes'),24,'original.txt','')
        read=self.read();self.assertEqual(read.status_code,200)
        value=read.json();item=value['assets'][0]
        self.assertEqual(item['id'],str(asset.pk));self.assertTrue(item['path'].endswith('original.txt'))
        value['folders']=['Folder'];value['folderIds']={'Folder':'stable-folder'}
        item.update(title='Own title',notes='Exact own notes',tags=['Own'],folder='Folder')
        saved=self.call(self.base+'native/assets','PUT',value,read['ETag']);self.assertEqual(saved.status_code,200,saved.content)
        asset.refresh_from_db();self.assertEqual((asset.title,asset.notes,asset.folder_id),('Own title','Exact own notes','stable-folder'))
        self.assertEqual(asset.filename,'original.txt')
        stale=self.call(self.base+'native/assets','PUT',value,read['ETag']);self.assertEqual(stale.status_code,409)
        self.assertFalse(stale.json()['draftSaved'])
        asset.refresh_from_db();self.assertEqual(asset.notes,'Exact own notes')

    def test_forged_paths_and_missing_media_do_not_commit_other_changes(self):
        raw=b'exact fixture';asset=upload_stream(self.scope,self.owner,io.BytesIO(raw),len(raw),'fixture.txt','')
        read=self.read();value=read.json();value['assets'][0]['path']='/etc/passwd'
        value['assets'][0]['title']='Must not save'
        self.assertEqual(self.call(self.base+'native/assets','PUT',value,read['ETag']).status_code,400)
        asset.refresh_from_db();self.assertEqual(asset.title,'fixture.txt')
        value=read.json();value['assets']=[]
        self.assertEqual(self.call(self.base+'native/assets','PUT',value,read['ETag']).status_code,409)
        self.assertFalse(WorkspaceDocument.objects.filter(workspace=self.space,kind='library').exists())

    def test_original_folder_save_acknowledgement_can_immediately_target_an_upload(self):
        current=self.read();value=current.json()
        value['folders']=['Incoming'];value['folderIds']={'Incoming':'original-folder'}
        saved=self.call(self.base+'native/assets','PUT',value,current['ETag'])
        self.assertEqual(saved.status_code,200,saved.content)
        self.assertEqual(saved.json().get('folderIds'),{'Incoming':'original-folder'})
        uploaded=self.client.post(self.base+'assets/upload',data=b'original file in chosen folder',content_type='application/octet-stream',
            HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk),HTTP_X_FILE_NAME='chosen.txt',HTTP_X_FOLDER_ID=saved.json()['folderIds']['Incoming'])
        self.assertEqual(uploaded.status_code,201,uploaded.content)
        self.assertEqual(uploaded.json()['folder'],'Incoming')
        self.assertEqual(uploaded.json()['folderId'],'original-folder')

    def test_original_folder_rename_acknowledgement_preserves_identity_without_reload(self):
        current=self.read();value=current.json()
        value['folders']=['Before'];value['folderIds']={'Before':'retained-folder'}
        saved=self.call(self.base+'native/assets','PUT',value,current['ETag'])
        self.assertEqual(saved.status_code,200,saved.content)
        renamed=copy.deepcopy(value);renamed['folders']=['After'];renamed['folderIds']={'After':'retained-folder'}
        result=self.call(self.base+'native/assets','PUT',renamed,saved['ETag'])
        self.assertEqual(result.status_code,200,result.content)
        self.assertEqual(result.json().get('folderIds'),{'After':'retained-folder'})
        uploaded=self.client.post(self.base+'assets/upload',data=b'original file after rename',content_type='application/octet-stream',
            HTTP_X_CREATIVE_ACCOUNT=str(self.owner.pk),HTTP_X_FILE_NAME='renamed.txt',HTTP_X_FOLDER_ID=result.json()['folderIds']['After'])
        self.assertEqual(uploaded.status_code,201,uploaded.content)
        self.assertEqual(uploaded.json()['folder'],'After')
        self.assertNotIn('Before',self.read().json()['folderIds'])

    def test_reusable_literal_original_note_bundle_roundtrips_without_file_authority(self):
        read=self.read();value=read.json()
        item={'id':str(uuid.uuid4()),'title':'Original content','path':'','folder':'','mime':'application/x-creative-bundle','size':0,'notes':'','tags':[],
              'bundle':{'nodes':[{'id':'own','type':'note','x':0,'y':0,'w':320,'h':180,'body':'Exact original **text**'}],'edges':[]}}
        value['assets']=[item]
        saved=self.call(self.base+'native/assets','PUT',value,read['ETag']);self.assertEqual(saved.status_code,200,saved.content)
        self.assertEqual(self.read().json()['assets'],[item])
        value['assets'][0]['path']='C:/private.txt'
        self.assertEqual(self.call(self.base+'native/assets','PUT',value,saved['ETag']).status_code,400)

    def test_foreign_account_viewer_and_quota_checks_apply_to_original_facade(self):
        value=self.read().json();tag=self.read()['ETag']
        self.assertEqual(self.call(self.base+'native/assets','PUT',value,tag,identity=self.other.pk).status_code,409)
        self.assertEqual(self.call(f'/w/{self.foreign.pk}/api/native/assets').status_code,404)
        Membership.objects.create(workspace=self.space,account=self.other,role='viewer')
        self.client.force_login(self.other)
        self.assertEqual(self.call(self.base+'native/assets','PUT',value,tag,identity=self.other.pk).status_code,403)

    def test_search_history_and_checkpoint_keep_the_original_content_and_version(self):
        board={'format':'creative-board','version':1,'name':'Original title','nodes':[{'id':'note','type':'note','x':0,'y':0,'w':320,'h':180,'body':'Exact original needle'}],'edges':[],'view':{'x':0,'y':0,'z':1}}
        _,tag=put_document(self.scope,self.owner,'board','one',board,'new')
        result=self.call(self.base+'native/search?q=needle');self.assertEqual(result.status_code,200);self.assertEqual(result.json()['results'][0]['boardId'],'one')
        rows=self.call(self.base+'native/history/boards/one').json();self.assertEqual(rows[0]['count'],1)
        self.assertEqual(self.call(self.base+'native/checkpoints/boards/one','PUT').status_code,200)
        self.assertEqual(self.call(self.base+'boards/one')['ETag'],tag)
        revision=self.call(self.base+'native/history/boards/one/'+rows[0]['id']);self.assertEqual(revision.json()['value'],board)

    def test_quota_failure_rolls_back_both_metadata_and_catalog(self):
        raw=b'exact';asset=upload_stream(self.scope,self.owner,io.BytesIO(raw),len(raw),'original.txt','')
        read=self.read();value=read.json();value['assets'][0]['title']='Rejected own title'
        with override_settings(HOSTED_MAX_WORKSPACE_BYTES=1):
            self.assertEqual(self.call(self.base+'native/assets','PUT',value,read['ETag']).status_code,413)
        asset.refresh_from_db();self.assertEqual(asset.title,'original.txt');self.assertEqual(self.read()['ETag'],read['ETag'])

    def test_client_file_reference_cannot_name_another_workspaces_media(self):
        row={'id':str(uuid.uuid4()),'mime':'application/x-creative-file-reference','title':'Foreign','folder':''}
        response=self.call(self.base+'assets','PUT',{'version':1,'folders':[],'assets':[row]},'new')
        self.assertEqual(response.status_code,400)
        self.assertFalse(WorkspaceDocument.objects.filter(workspace=self.space,kind='library').exists())

    @override_settings(HOSTED_NATIVE_WORKBENCH=True)
    def test_opt_in_entry_routes_to_original_workbench_and_management_stays_available(self):
        personal=create_personal_workspace(self.owner)
        self.assertEqual(self.client.get('/').url,f'/w/{personal.pk}/app/')
        self.assertEqual(self.client.get(f'/w/{self.space.pk}/').url,self.app)
        self.assertEqual(self.client.get(f'/w/{self.space.pk}/b/one/').url,self.app+'?board=one')
        self.assertEqual(self.client.get('/spaces').status_code,200)
        self.assertEqual(self.client.get(f'/w/{self.space.pk}/manage/').status_code,200)

    @override_settings(HOSTED_NATIVE_WORKBENCH=True)
    def test_new_entry_keeps_create_intent_and_never_creates_on_get_or_head(self):
        before=list(WorkspaceDocument.objects.values())
        for method in ('get','head'):
            response=getattr(self.client,method)(f'/w/{self.space.pk}/new/explicit-request/')
            self.assertEqual(response.status_code,302)
            self.assertEqual(response.url,self.app+'?create=1')
        self.assertEqual(list(WorkspaceDocument.objects.values()),before)

    @override_settings(HOSTED_NATIVE_WORKBENCH=True)
    def test_anonymous_new_entry_retains_destination_until_login(self):
        response=Client().get(f'/w/{self.space.pk}/new/explicit-request/')
        self.assertEqual(response.status_code,200)
        self.assertContains(response,f'/w/{self.space.pk}/new/explicit-request/')
        self.assertNotContains(response,'id="shellHeader"')

    @override_settings(HOSTED_NATIVE_WORKBENCH=False)
    def test_disabled_native_entry_keeps_legacy_create_contract(self):
        response=self.client.get(f'/w/{self.space.pk}/new/explicit-request/')
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.creative_editor)
        self.assertContains(response,'"create": true')

    def test_original_preview_control_bridge_has_exact_script_hash_and_no_authored_code(self):
        raw=b'<h1>Original preview</h1><script>window.UNTRUSTED=true</script>'
        row=upload_stream(self.scope,self.owner,io.BytesIO(raw),len(raw),'fixture.html','')
        response=self.call(self.base+'native/preview/'+str(row.pk)+'?account='+str(self.owner.pk))
        self.assertEqual(response.status_code,200);self.assertNotIn(b'window.UNTRUSTED',response.content)
        self.assertIn(b'creative-document-protected',response.content)
        from .native_preview import SCRIPT_HASH
        self.assertIn("script-src 'sha256-"+SCRIPT_HASH+"'",response['Content-Security-Policy'])
        self.assertIn('sandbox allow-scripts',response['Content-Security-Policy'])
        self.assertNotIn(b'http-equiv="Content-Security-Policy"',response.content)
