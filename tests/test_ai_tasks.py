import json
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
        self.assertEqual(self.request('/api/proposals/good', 'PUT', proposal, {'If-Match':'new'})[0],200)
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

if __name__ == '__main__':
    unittest.main()
