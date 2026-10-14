import copy
from django.test import Client,TestCase
from . import test_documents as fixtures
from .models import Membership

class LiveBoardTests(TestCase):
 setUp=fixtures.DocumentAPITests.setUp
 api=fixtures.DocumentAPITests.api
 url=fixtures.DocumentAPITests.url
 create=fixtures.DocumentAPITests.create
 def latest(self,tag,**kwargs):
  headers={'HTTP_X_CREATIVE_ACCOUNT':str(kwargs.pop('account',self.owner).pk),'HTTP_IF_NONE_MATCH':tag}
  return (kwargs.pop('client',None) or self.client).get(self.url('boards/one/live',kwargs.pop('workspace',None)),**headers)
 def test_conditional_reads_keep_exact_scoped_original_and_role_even_without_body(self):
  original=fixtures.sample_board();tag=self.create(value=original)
  current=self.latest(tag);self.assertEqual(current.status_code,304);self.assertEqual(current.content,b'')
  self.assertEqual(current['ETag'],tag);self.assertEqual(current['X-Creative-Account'],str(self.owner.pk));self.assertEqual(current['X-Creative-Workspace'],str(self.shared.pk));self.assertEqual(current['X-Creative-Board'],'one');self.assertEqual(current['X-Creative-Role'],'owner')
  changed=copy.deepcopy(original);changed['nodes'][0]['body']='Other own original'
  newer=self.api('boards/one','PUT',changed,tag)['ETag']
  response=self.latest(tag);self.assertEqual(response.status_code,200);self.assertEqual(response.json(),changed);self.assertEqual(response['ETag'],newer)
 def test_membership_and_account_are_rechecked_before_any_304(self):
  tag=self.create();self.assertEqual(self.latest(tag,account=self.editor).status_code,409);self.assertEqual(self.latest(tag,workspace=self.other_personal).status_code,404);self.assertEqual(self.latest(tag,client=Client()).status_code,401)
  Membership.objects.filter(workspace=self.shared,account=self.editor).update(role='viewer')
  result=self.latest(tag,client=self.editor_client,account=self.editor);self.assertEqual(result.status_code,304);self.assertEqual(result['X-Creative-Role'],'viewer')
  Membership.objects.filter(workspace=self.shared,account=self.editor).delete();self.assertEqual(self.latest(tag,client=self.editor_client,account=self.editor).status_code,404)
 def test_missing_deleted_and_arbitrary_paths_are_not_live_data_sources(self):
  tag=self.create();self.api('boards/one','DELETE',etag=tag);self.assertEqual(self.latest(tag).status_code,404)
  self.assertEqual(self.client.get('/api/boards/one/live').status_code,404)
 def test_reconciliation_response_identifies_original_destination(self):
  value=fixtures.sample_board();tag=self.create(value=value);value['nodes'][0]['title']='Own new title'
  result=self.api('boards/one/reconcile','POST',{'baseETag':tag,'board':value});self.assertEqual(result.status_code,200);self.assertEqual(result['X-Creative-Account'],str(self.owner.pk));self.assertEqual(result['X-Creative-Workspace'],str(self.shared.pk));self.assertEqual(result['X-Creative-Board'],'one');self.assertEqual(result['X-Creative-Role'],'owner')
