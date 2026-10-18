"""Pure document validation shared by the desktop and hosted services."""
import math

def valid_media_timeline(node):
 timeline=node.get('mediaTimeline',{})
 if not isinstance(timeline,dict) or len(timeline)>100:raise ValueError('时间标记格式不正确')
 for source,data in timeline.items():
  if not isinstance(source,str) or len(source)>2000 or not isinstance(data,dict):raise ValueError('时间标记来源无效')
  markers=data.get('markers',[])
  if not isinstance(markers,list) or len(markers)>1000:raise ValueError('时间标记数量超出范围')
  ids=set()
  for marker in markers:
   if not isinstance(marker,dict) or not isinstance(marker.get('id'),str) or marker['id'] in ids:raise ValueError('时间标记编号无效')
   ids.add(marker['id']);time=marker.get('time')
   if not isinstance(time,(int,float)) or not math.isfinite(time) or not 0<=time<=604800:raise ValueError('时间标记位置无效')
   if not isinstance(marker.get('title',''),str) or len(marker.get('title',''))>200 or not isinstance(marker.get('note',''),str) or len(marker.get('note',''))>20000:raise ValueError('时间标记文字无效')
  if data.get('startMarkerId') is not None and data['startMarkerId'] not in ids:raise ValueError('重播起点不存在')
 for row in node.get('cellItems',[]):
  for cell in row:
   for item in cell:valid_media_timeline(item)
def valid_board(b):
 if not isinstance(b,dict) or b.get('format')!='creative-board' or b.get('version')!=1: raise ValueError('白板格式不正确')
 if not isinstance(b.get('name'),str): raise ValueError('缺少名称')
 if not isinstance(b.get('nodes'),list) or len(b['nodes'])>5000: raise ValueError('内容数量超出范围')
 if not isinstance(b.get('edges'),list) or len(b['edges'])>10000: raise ValueError('连线数量超出范围')
 ids=set()
 for n in b['nodes']:
  if not isinstance(n,dict) or not isinstance(n.get('id'),str) or n['id'] in ids: raise ValueError('内容编号重复或无效')
  ids.add(n['id'])
  valid_media_timeline(n)
  if 'sizeMode' in n and n['sizeMode'] not in ('auto','manual'):raise ValueError('尺寸模式无效')
  if 'textFormat' in n and n['textFormat'] not in ('plain','markdown'):raise ValueError('文字格式无效')
  if 'paperStyle' in n and n['paperStyle'] not in ('plain','lined','grid'):raise ValueError('纸面样式无效')
  if n.get('type') not in ['note','frame','image','table']: raise ValueError('内容类型无效')
  if n.get('type')=='table':
   if not isinstance(n.get('columns'),list) or not 1<=len(n['columns'])<=100 or any(not isinstance(c,str) for c in n['columns']): raise ValueError('表格列无效')
   if not isinstance(n.get('rows'),list) or len(n['rows'])>5000 or any(not isinstance(r,list) or len(r)!=len(n['columns']) or any(not isinstance(c,str) for c in r) for r in n['rows']): raise ValueError('表格行无效')
   for key,axis in [('rowIds','rows'),('columnIds','columns')]:
    if key in n:
     values=n[key]
     if not isinstance(values,list) or len(values)!=len(n[axis]) or any(not isinstance(v,str) or not 0<len(v)<=100 for v in values) or len(set(values))!=len(values):raise ValueError('表格行列编号无效')
  for k in ['x','y','w','h']:
   if not isinstance(n.get(k),(int,float)) or not -1000000<n[k]<1000000: raise ValueError('位置数据无效')
  for k in ['title','body','userText','annotation','url']:
   if k in n and not isinstance(n[k],str): raise ValueError('文字字段无效')
 for e in b['edges']:
  if e.get('from') not in ids or e.get('to') not in ids: raise ValueError('连线指向不存在的内容')
 return b


def valid_folders(value):
 if not isinstance(value,dict) or not isinstance(value.get('folders'),list) or len(value['folders'])>1000: raise ValueError('目录无效')
 ids=set()
 for item in value['folders']:
  if not isinstance(item,dict) or not isinstance(item.get('id'),str) or item['id'] in ids or not isinstance(item.get('name'),str) or not isinstance(item.get('parent',''),str): raise ValueError('文件夹无效')
  ids.add(item['id'])
 lookup={item['id']:item for item in value['folders']}
 for item in value['folders']:
  seen={item['id']};parent=item.get('parent','')
  while parent:
   if parent in seen or parent not in lookup: raise ValueError('文件夹关系无效')
   seen.add(parent);parent=lookup[parent].get('parent','')
 return value
