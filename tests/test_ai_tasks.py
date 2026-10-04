import json
import base64
import io
import zipfile
import unittest
import test_server


class AITaskTest(unittest.TestCase):
    setUpClass = classmethod(test_server.ServerTest.setUpClass.__func__)
    tearDownClass = classmethod(test_server.ServerTest.tearDownClass.__func__)
    request = test_server.ServerTest.request

    def make_task(self, name):
        note = dict(id='one', type='note', title='观察', body='我的原文', tags=[], x=0, y=0, w=300, h=200)
        other = dict(note, id='other', title='未选择', body='不应被导出')
        board = dict(format='creative-board', version=1, name='编排', nodes=[note, other], edges=[], view=dict(x=0, y=0, z=1))
        status, headers, _ = self.request('/api/boards/'+name, 'PUT', board, {'If-Match':'new'})
        self.assertEqual(status, 200)
        request = dict(id=name, resource='board', targetId=name, baseETag=headers['ETag'], ids=['one'], nodeIds=['one'], task='补标签', keepWords=True, keepNotes=True, allowAdd=False, allowDelete=False)
        pack = dict(format='creative-board-context', version=1, resource='board', targetId=name, baseETag=headers['ETag'], requestId=name, selectedIds=['one'], request=request, data=dict(board, nodes=[note]))
        status, _, raw = self.request('/api/ai/tasks/'+name, 'PUT', pack)
        self.assertEqual(status, 200, raw)
        return board, json.loads(raw)

    def test_task_survives_and_excludes_unselected_content(self):
        _, pack = self.make_task('ai-persist')
        status, _, raw = self.request('/api/ai/tasks/ai-persist')
        self.assertEqual(status, 200)
        self.assertNotIn('不应被导出', raw.decode())
        self.assertEqual(json.loads(raw)['request'], pack['request'])
        self.assertEqual(self.request('/api/ai/tasks')[0], 200)

    def test_submission_rejects_changes_outside_rules(self):
        _, pack = self.make_task('ai-rules')
        proposal = dict(format='creative-board-proposal', version=1, resource='board', targetId='ai-rules', requestId=pack['requestId'], baseETag=pack['baseETag'], title='标签', changes=[dict(op='update',entity='node',targetId='one',before=dict(tags=[]),after=dict(tags=['观察']))])
        self.assertEqual(self.request('/api/proposals/good', 'PUT', proposal, {'If-Match':'new'})[0],400)
        for index, change in enumerate([
            dict(op='update',entity='node',targetId='other',before=dict(tags=[]),after=dict(tags=['错误'])),
            dict(op='update',entity='node',targetId='one',before=dict(body='我的原文'),after=dict(body='替换')),
            dict(op='delete',entity='node',targetId='one',before=pack['data']['nodes'][0]),
            dict(op='add',entity='node',targetId='new',value=dict(id='new')),
        ]):
            self.assertEqual(self.request('/api/proposals/reject'+str(index), 'PUT',dict(proposal,changes=[change]), {'If-Match':'new'})[0],400)
        del proposal['requestId']
        self.assertEqual(self.request('/api/proposals/no-task', 'PUT',proposal, {'If-Match':'new'})[0],400)

    def test_navigation_does_not_expire_but_content_does(self):
        board, pack = self.make_task('ai-navigation')
        board['view'] = dict(x=500,y=-120,z=.7)
        self.assertEqual(self.request('/api/boards/ai-navigation','PUT',board,{'If-Match':pack['baseETag']})[0],200)
        _, _, raw = self.request('/api/ai/tasks/ai-navigation/current')
        state=json.loads(raw)
        self.assertTrue(state['contentUnchanged'])
        board['nodes'][0]['body']='新内容'
        self.assertEqual(self.request('/api/boards/ai-navigation','PUT',board,{'If-Match':state['baseETag']})[0],200)
        self.assertFalse(json.loads(self.request('/api/ai/tasks/ai-navigation/current')[2])['contentUnchanged'])

    def test_forged_selection_is_rejected(self):
        _, pack = self.make_task('ai-forged')
        pack['requestId']=pack['request']['id']='forged'
        pack['request']['ids'].append('other')
        self.assertEqual(self.request('/api/ai/tasks/forged','PUT',pack)[0],400)

    def test_research_replies_do_not_change_authored_work(self):
        _,pack=self.make_task('research-readonly')
        before=self.request('/api/boards/research-readonly')[2]
        sources=[dict(id='paper',title='Source title',url='https://example.com/original',finding='A sourced observation',limitations='Only covers the stated conditions')]
        reply=dict(format='creative-board-references',version=1,requestId=pack['requestId'],sources=sources)
        status,_,raw=self.request('/api/ai/references/sources','PUT',reply,{'If-Match':'new'})
        self.assertEqual(status,200,raw)
        self.assertEqual(self.request('/api/ai/references/sources')[0],200)
        self.assertEqual(self.request('/api/ai/references')[0],200)
        self.assertEqual(self.request('/api/boards/research-readonly')[2],before)
        for index,extra in enumerate([dict(changes=[]),dict(title='AI copy'),dict(data=dict(nodes=[]))]):
            self.assertEqual(self.request('/api/ai/references/forbidden'+str(index),'PUT',dict(reply,**extra),{'If-Match':'new'})[0],400)
        reply['sources'][0]['url']='javascript:alert(1)'
        self.assertEqual(self.request('/api/ai/references/bad-url','PUT',reply,{'If-Match':'new'})[0],400)
        self.assertTrue(pack['aiPolicy']['readOnly'])
        self.assertEqual(pack['request']['mode'],'research-reference-only')

    def test_visual_material_survives_and_archive_matches(self):
        _,pack=self.make_task('ai-images-base')
        pack['requestId']=pack['request']['id']='ai-images'
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY/0AAAAASUVORK5CYII=')
        pack['visualInput']=[dict(kind='image',nodeIds=['one'],data='data:image/png;base64,'+base64.b64encode(png).decode())]
        status,_,raw=self.request('/api/ai/tasks/ai-images','PUT',pack)
        self.assertEqual(status,200,raw)
        result=json.loads(raw);image=result['visuals']['images'][0]
        self.assertEqual(result['spatial']['items'][0]['id'],'one')
        self.assertNotIn('不应被导出',raw.decode())
        self.assertNotIn('visualInput',result)
        self.assertEqual(self.request('/api/ai/tasks/ai-images/files/'+image['name'])[2],png)
        status,_,archive=self.request('/api/ai/tasks/ai-images/bundle')
        self.assertEqual(status,200)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            self.assertEqual(z.read(image['archivePath']),png)
            self.assertEqual(json.loads(z.read('task.json'))['requestId'],'ai-images')
        pack['requestId']=pack['request']['id']='ai-images-outside'
        pack['visualInput'][0]['nodeIds']=['other']
        self.assertEqual(self.request('/api/ai/tasks/ai-images-outside','PUT',pack)[0],400)

    def test_media_marker_validation_and_preservation_rules(self):
        board,pack=self.make_task('ai-markers')
        timeline={'/api/media/file':{'markers':[{'id':'mark','time':2.5,'title':'观察','note':'保留现场声音'}],'startMarkerId':'mark'}}
        proposal=dict(format='creative-board-proposal',version=1,requestId=pack['requestId'],resource='board',targetId='ai-markers',baseETag=pack['baseETag'],title='标记',changes=[dict(op='update',entity='node',targetId='one',before=dict(mediaTimeline=None),after=dict(mediaTimeline=timeline))])
        self.assertEqual(self.request('/api/proposals/marker-protected','PUT',proposal,{'If-Match':'new'})[0],400)
        board['nodes'][0]['mediaTimeline']=timeline
        status,headers,_=self.request('/api/boards/ai-markers','PUT',board,{'If-Match':pack['baseETag']})
        self.assertEqual(status,200)
        timeline['/api/media/file']['startMarkerId']='missing'
        self.assertEqual(self.request('/api/boards/ai-markers','PUT',board,{'If-Match':headers['ETag']})[0],400)

if __name__ == '__main__':
    unittest.main()
