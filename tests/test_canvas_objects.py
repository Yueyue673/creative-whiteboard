import copy
import unittest
from board_schema import valid_board


class CanvasObjectValidationTest(unittest.TestCase):
 def board(self):
  return {'format':'creative-board','version':1,'name':'synthetic','nodes':[{'id':'art','type':'note','x':0,'y':0,'w':360,'h':225,'canvasObject':{'kind':'image','crop':{'x':10,'y':20,'w':70,'h':60},'marks':[{'kind':'arrow','stroke':'#364152','fill':'none','weight':.8,'points':[[20,20],[80,80]]}]},'original':{'unchanged':[True,42]}}],'edges':[]}

 def test_original_document_returned_without_flattening(self):
  value=self.board();before=copy.deepcopy(value);self.assertIs(valid_board(value),value);self.assertEqual(value,before)

 def test_invalid_editor_metadata_is_rejected(self):
  cases=[{'kind':'script'},{'kind':'image','crop':{'x':0,'y':0,'w':0,'h':10}},{'kind':'image','crop':{'x':90,'y':0,'w':20,'h':10}},{'kind':'rect','stroke':'red" onload="x'},{'kind':'text','fontFamily':'a'*101},{'kind':'line','points':[[0,float('inf')]]},{'kind':'line','points':[[0,101]]},{'kind':'line','points':None},{'kind':'image','marks':[{'kind':'line','points':None}]},{'kind':'image','marks':[{'kind':'line','points':[[0,0]]}]*501},{'kind':'image','marks':[{'kind':'line','points':[[0,0]]*5000}]*5},{'kind':'rect','rough':'yes'}]
  for metadata in cases:
   with self.subTest(metadata=str(metadata)[:120]):
    value=self.board();value['nodes'][0]['canvasObject']=metadata
    with self.assertRaises(ValueError):valid_board(value)

 def test_scale_font_and_document_flags_are_bounded(self):
  for key,bad in [('contentScale',0),('contentScale',5.01),('contentScale',True),('fontFamily',['not text']),('inkColor','url(file)'),('documentMode','true'),('documentParagraph',1)]:
   with self.subTest(key=key,bad=bad):
    value=self.board();value['nodes'][0][key]=bad
    with self.assertRaises(ValueError):valid_board(value)

 def test_nested_objects_use_the_same_validation(self):
  value=self.board();item=value['nodes'][0];value['nodes']=[{'id':'doc','type':'table','documentMode':True,'columns':['正文'],'rows':[['']],'cellItems':[[[item]]],'x':0,'y':0,'w':640,'h':720}];self.assertIs(valid_board(value),value);item['canvasObject']['marks'][0]['weight']=99
  with self.assertRaises(ValueError):valid_board(value)


if __name__=='__main__':unittest.main()
