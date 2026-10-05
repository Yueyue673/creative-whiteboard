from pathlib import Path
from urllib.parse import parse_qs,urlparse
from html.parser import HTMLParser
from functools import lru_cache
import json,hashlib,time,re,os,threading
from app_paths import APP_ROOT, DATA_ROOT
from ai_context import spatial_context, save_visuals, task_archive, context_folders, research_task, research_material, visual_bytes, VisualUnavailable, AI_POLICY
ROOT=DATA_ROOT
HISTORY=ROOT/'历史记录'
PROPOSALS=ROOT/'AI待审核'
TASKS=ROOT/'AI任务'
REFERENCES=ROOT/'参考资料'
HLOCK=threading.RLock()

def validate_references(value):
 if not isinstance(value,dict) or set(value)-{'format','version','requestId','sources'}:raise ValueError('资料回复只能包含任务编号与来源，不能包含创作内容或修改提案')
 if value.get('format')!='creative-board-references' or value.get('version')!=1:raise ValueError('资料回复格式无效')
 if not safe_id(value.get('requestId','')):raise ValueError('缺少有效的研究任务编号')
 task=json.loads((TASKS/(value['requestId']+'.json')).read_bytes())
 sources=value.get('sources')
 if not isinstance(sources,list) or not 1<=len(sources)<=200:raise ValueError('请提供 1 至 200 个来源')
 ids=set()
 for s in sources:
  if not isinstance(s,dict) or set(s)-{'id','title','url','author','published','finding','limitations'}:raise ValueError('来源包含不支持的内容或修改字段')
  for key,limit in [('id',100),('title',500),('url',3000),('finding',12000)]:
   if not isinstance(s.get(key),str) or not s[key].strip() or len(s[key])>limit:raise ValueError('来源字段无效：'+key)
  if s['id'] in ids:raise ValueError('来源编号重复')
  ids.add(s['id']);url=urlparse(s['url'])
  if url.scheme not in ('http','https') or not url.hostname or url.username or url.password:raise ValueError('请提供可核对的 http(s) 原文链接')
  for key,limit in [('author',500),('published',100),('limitations',12000)]:
   if key in s and (not isinstance(s[key],str) or len(s[key])>limit):raise ValueError('来源字段无效：'+key)
 return {**value,'task':task['request']['task'],'createdAt':time.time(),'verification':'外部助手提供的来源，尚未自动核对原文；与创作分开保存'}

def rawjson(value):return json.dumps(value,ensure_ascii=False,indent=2).encode('utf-8')
def safe_id(value):return bool(re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',value))
def content_digest(value):
 def normalize(v):
  if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
  if isinstance(v,list):return [normalize(x) for x in v]
  if isinstance(v,float) and v.is_integer():return int(v)
  return v
 content={k:v for k,v in value.items() if k!='view'}
 return hashlib.sha256(json.dumps(normalize(content),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def snapshot(kind,key,raw,force=False):
 if not raw:return
 with HLOCK:
  folder=HISTORY/kind/key;folder.mkdir(parents=True,exist_ok=True)
  digest=hashlib.sha256(raw).hexdigest();items=sorted(folder.glob('*.json'))
  if items and digest[:16] in items[-1].name:return
  # Preserve the beginning of each edit interval rather than every keystroke.
  if items and not force and time.time()-items[-1].stat().st_mtime<60:return
  name=str(time.time_ns())+'_'+digest[:16]+'.json'
  obj=json.loads(raw);(folder/name).write_bytes(rawjson({'savedAt':time.time(),'value':obj,'hash':digest}))
  items=sorted(folder.glob('*.json'));total=sum(f.stat().st_size for f in items)
  while len(items)>40 or (len(items)>2 and total>200*1024*1024):
   old=items.pop(0);total-=old.stat().st_size;old.unlink()

def history_rows(kind,key):
 rows=[]
 for f in (HISTORY/kind/key).glob('*.json'):
  try:
   d=json.loads(f.read_bytes());v=d['value'];rows.append({'id':f.stem,'savedAt':d['savedAt'],'name':v.get('name','内容库'),'count':len(v.get('nodes',v.get('assets',[])))})
  except Exception:continue
 return sorted(rows,key=lambda x:x['savedAt'],reverse=True)

class VisibleText(HTMLParser):
 def __init__(self):super().__init__();self.parts=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'):self.skip+=1
 def handle_endtag(self,tag):
  if tag in ('script','style'):self.skip=max(0,self.skip-1)
 def handle_data(self,text):
  if not self.skip:self.parts.append(text)
@lru_cache(maxsize=256)
def file_excerpt(path,stamp,size):
 try:
  p=Path(path)
  if p.suffix.lower() not in ('.txt','.md','.csv','.tsv','.json','.html','.htm','.log','.yaml','.yml'):return ''
  with p.open('rb') as f:text=f.read(262144).decode('utf-8',errors='replace')
  if p.suffix.lower() in ('.html','.htm'):
   parser=VisibleText();parser.feed(text);text=' '.join(parser.parts)
  return text
 except (OSError,ValueError):return ''
def node_text(n):
 text=' '.join(str(v) for v in [*(n.get(k,'') for k in ['title','body','userText','annotation','url']),*n.get('tags',[]),*n.get('columns',[]),*(c for row in n.get('rows',[]) for c in row)] if v)
 text+=' '+ ' '.join(m.get('title','')+' '+m.get('note','') for t in n.get('mediaTimeline',{}).values() for m in t.get('markers',[]))
 text+=' '+ ' '.join(node_text(item) for row in n.get('cellItems',[]) for cell in row for item in cell)
 return text
def snippet(text,q):
 clean=' '.join(text.split());i=clean.lower().find(q.lower());i=max(0,i-45);return ('…' if i else '')+clean[i:i+210]+('…' if len(clean)>i+210 else '')
def search(q):
 rows=[]
 for f in (ROOT/'内容').glob('*.json'):
  try:b=json.loads(f.read_bytes())
  except Exception:continue
  for n in b.get('nodes',[]):
   text=node_text(n)
   if q.lower() in text.lower():rows.append({'kind':'board','boardId':f.stem,'id':n['id'],'title':n.get('title') or '未命名内容','location':b['name'],'snippet':snippet(text,q)})
 try:catalog=json.loads((ROOT/'素材目录.json').read_bytes())
 except Exception:catalog={'assets':[]}
 for a in catalog['assets']:
  if a.get('archived'):continue
  text=' '.join(str(a.get(k,'')) for k in ['title','notes','folder','path'])+' '+json.dumps(a.get('tags',[]),ensure_ascii=False)
  text+=' '+ ' '.join(node_text(n) for n in a.get('bundle',{}).get('nodes',[]))
  field='标题、正文与备注'
  if q.lower() not in text.lower() and a.get('path'):
   try:
    p=Path(a['path']);st=p.stat();text=file_excerpt(str(p),st.st_mtime_ns,st.st_size);field='文件正文（最多读取前256KB）'
   except OSError:continue
  if q.lower() in text.lower():rows.append({'kind':'library','id':a['id'],'title':a['title'],'location':a.get('folder') or '内容库根目录','snippet':snippet(text,q),'matchedIn':field})
 return {'results':rows[:150],'total':len(rows),'note':'搜索白板、组合正文、备注与文件名；文本文件读取前256KB，音视频和PDF不做全文识别。'}

def workflow_get(handler,p):
 if p=='/api/ai/references':
  rows=[]
  for f in REFERENCES.glob('*.json'):
   try:
    d=json.loads(f.read_bytes());rows.append({'id':f.stem,'task':d['task'],'count':len(d['sources']),'createdAt':d['createdAt']})
   except (OSError,ValueError,KeyError):continue
  handler.reply(200,sorted(rows,key=lambda r:r['createdAt'],reverse=True));return True
 m=re.fullmatch(r'/api/ai/references/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  try:handler.reply(200,(REFERENCES/(m[1]+'.json')).read_bytes())
  except OSError:handler.reply(404,{'error':'参考资料不存在'})
  return True
 m=re.fullmatch(r'/api/ai/tasks/([a-zA-Z0-9_-]{1,100})/(bundle|files/([0-9]{2}_(?:viewport|overview|image|video-frame)\.png))',p)
 if m:
  try:
   pack=json.loads((TASKS/(m[1]+'.json')).read_bytes())
   if m[2]=='bundle':handler.reply(200,task_archive(pack,TASKS,'http://'+handler.headers['Host']),'application/zip')
   else:
    image=next((image for image in pack.get('visuals',{}).get('images',[]) if image.get('name')==m[3]),None)
    if not image:raise FileNotFoundError()
    handler.reply(200,visual_bytes(pack,TASKS,image),'image/png')
  except VisualUnavailable as error:handler.reply(409,{'error':str(error)+'，请重新准备材料'})
  except (OSError,ValueError,KeyError,TypeError,AttributeError):handler.reply(404,{'error':'任务附件不存在'})
  return True
 m=re.fullmatch(r'/api/ai/tasks/([a-zA-Z0-9_-]{1,100})/current',p)
 if m:
  try:
   task=json.loads((TASKS/(m[1]+'.json')).read_bytes());source=ROOT/'内容'/(task['targetId']+'.json') if task['resource']=='board' else ROOT/'素材目录.json';raw=source.read_bytes()
   handler.reply(200,{'baseETag':hashlib.sha256(raw).hexdigest(),'contentUnchanged':content_digest(json.loads(raw))==task.get('contentETag')})
  except (OSError,ValueError,KeyError):handler.reply(404,{'error':'原任务或内容已不存在'})
  return True
 if p=='/api/ai/tasks':
  rows=[]
  for f in TASKS.glob('*.json'):
   try:
    d=json.loads(f.read_bytes());rows.append({'id':f.stem,'task':d['request']['task'],'resource':d['resource'],'targetId':d['targetId'],'createdAt':d.get('createdAt',0),'count':len(d['selectedIds'])})
   except (OSError,ValueError,KeyError):continue
  handler.reply(200,sorted(rows,key=lambda x:x['createdAt'],reverse=True));return True
 m=re.fullmatch(r'/api/ai/tasks/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  f=TASKS/(m[1]+'.json')
  if not f.exists():handler.reply(404,{'error':'找不到这份 AI 任务，请重新创建'})
  else:
   try:handler.reply(200,research_material(json.loads(f.read_bytes()),TASKS,'http://'+handler.headers['Host'])[0])
   except (OSError,ValueError,TypeError):handler.reply(400,{'error':'这份研究任务无法读取，请重新准备材料'})
  return True
 if p=='/api/search':
  q=parse_qs(urlparse(handler.path).query).get('q',[''])[0].strip()[:200];handler.reply(200,search(q) if q else {'results':[],'total':0});return True
 m=re.fullmatch(r'/api/history/(boards|library)/([a-zA-Z0-9_-]{1,100})(?:/([0-9]+_[a-f0-9]+))?',p)
 if m:
  if m[3]:
   f=HISTORY/m[1]/m[2]/(m[3]+'.json')
   if not f.exists():handler.reply(404,{'error':'记录不存在'})
   else:handler.reply(200,f.read_bytes())
  else:handler.reply(200,history_rows(m[1],m[2]))
  return True
 if p=='/api/trash':
  rows=[]
  for f in (ROOT/'回收站').glob('*.json'):
   try:
    d=json.loads(f.read_bytes());rows.append({'id':f.stem,'savedAt':f.stat().st_mtime,'ids':list(d['boards']),'names':[b['name'] for b in d['boards'].values()],'folders':[x['name'] for x in d['folders']]})
   except Exception:continue
  handler.reply(200,sorted(rows,key=lambda x:x['savedAt'],reverse=True));return True
 if p=='/api/proposals':
  PROPOSALS.mkdir(exist_ok=True);rows=[]
  for f in PROPOSALS.glob('*.json'):
   try:
    d=json.loads(f.read_bytes());rows.append({'id':f.stem,'title':d.get('title',f.stem),'resource':d.get('resource'),'targetId':d.get('targetId'),'count':len(d.get('changes',[])),'status':d.get('reviewStatus','pending')})
   except Exception:continue
  handler.reply(200,rows);return True
 m=re.fullmatch(r'/api/proposals/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  f=PROPOSALS/(m[1]+'.json')
  if not f.exists():handler.reply(404,{'error':'提案不存在'})
  else:
   raw=f.read_bytes();handler.reply(200,raw,etag=hashlib.sha256(raw).hexdigest())
  return True
 return False

def workflow_put(handler,p):
 if re.fullmatch(r'/api/proposals/[a-zA-Z0-9_-]{1,100}(?:/status)?',p):
  handler.reply(400,{'error':'AI 只提供研究资料与参考，已关闭修改创作的提案接口'});return True
 m=re.fullmatch(r'/api/ai/references/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  try:
   length=int(handler.headers.get('Content-Length','0'))
   if not 0<length<=4*1024*1024:raise ValueError('资料回复过大')
   value=validate_references(json.loads(handler.rfile.read(length)))
   REFERENCES.mkdir(exist_ok=True);f=REFERENCES/(m[1]+'.json')
   with HLOCK:
    if f.exists() or handler.headers.get('If-Match')!='new':handler.reply(409,{'error':'资料已存在，请另存新记录'});return True
    tmp=f.with_suffix('.tmp');tmp.write_bytes(rawjson(value));os.replace(tmp,f)
   handler.reply(200,{'saved':True})
  except (OSError,ValueError,KeyError,TypeError) as e:handler.reply(400,{'error':str(e)})
  return True
 m=re.fullmatch(r'/api/ai/tasks/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  try:
   length=int(handler.headers.get('Content-Length','0'))
   if not 0<length<=16*1024*1024:raise ValueError('任务内容过大，请缩小选择范围')
   value=json.loads(handler.rfile.read(length))
   if not isinstance(value,dict) or not isinstance(value.get('request'),dict):raise ValueError('研究任务格式不正确')
   request=value['request']
   if value.get('format')!='creative-board-context' or value.get('version')!=1 or value.get('requestId')!=m[1] or request.get('id')!=m[1]:raise ValueError('任务格式不正确')
   if value.get('resource') not in ('board','library'):raise ValueError('整理范围不正确')
   if not isinstance(request.get('task'),str) or not request['task'].strip():raise ValueError('缺少整理要求')
   for flag in ['keepWords','keepNotes','allowAdd','allowDelete']:
    if type(request.get(flag)) is not bool:raise ValueError('任务规则格式不正确')
   value=research_task(value);request=value['request']
   if value['resource']=='board':
    if not safe_id(value.get('targetId','')):raise ValueError('白板编号不正确')
    source=ROOT/'内容'/(value['targetId']+'.json')
   else:source=ROOT/'素材目录.json'
   raw=source.read_bytes();base=json.loads(raw)
   if hashlib.sha256(raw).hexdigest()!=value.get('baseETag'):handler.reply(409,{'error':'内容刚刚有变化，请重新创建任务'});return True
   if any(request.get(k)!=value.get(k) for k in ['resource','targetId','baseETag']):raise ValueError('任务与所选范围不一致')
   nodes=base.get('nodes',[]) if value['resource']=='board' else base.get('assets',[])
   selected=value.get('data',{}).get('nodes' if value['resource']=='board' else 'assets',[])
   selected_ids=[n['id'] for n in selected];lookup={n['id']:n for n in nodes}
   if not selected_ids or len(set(selected_ids))!=len(selected_ids) or any(i not in lookup for i in selected_ids):raise ValueError('选择内容不存在或重复')
   if any(lookup[n['id']]!=n for n in selected):raise ValueError('内容已变化，请重新读取')
   edges=[]
   if value['resource']=='board':
    edges=[e for e in base.get('edges',[]) if e['from'] in selected_ids and e['to'] in selected_ids]
    if request.get('nodeIds')!=selected_ids:raise ValueError('所选内容与任务规则不一致')
    value['data']={**base,'nodes':selected,'edges':edges}
   else:value['data']={'assets':selected,'folders':context_folders(selected)}
   ids=selected_ids+[e['id'] for e in edges]
   if set(request.get('ids',[]))!=set(ids) or set(value.get('selectedIds',[]))!=set(ids):raise ValueError('授权范围与选择内容不一致')
   value['createdAt']=time.time();value['contentETag']=content_digest(base);value['files']=context_files(value['data']);value['spatial']=spatial_context(value['data'])
   TASKS.mkdir(exist_ok=True);f=TASKS/(m[1]+'.json')
   with HLOCK:
    if f.exists():handler.reply(409,{'error':'任务已存在，请创建新任务'});return True
    save_visuals(value,TASKS,'http://'+handler.headers['Host'])
    value['localTaskPath']=str(f)
    tmp=f.with_suffix('.tmp');tmp.write_bytes(rawjson(value));os.replace(tmp,f)
   handler.reply(200,{**value,'localTaskPath':str(f)})
  except Exception as e:handler.reply(400,{'error':str(e)})
  return True
 if p=='/api/checkpoints/library/catalog':
  try:
   f=ROOT/'素材目录.json'
   raw=f.read_bytes() if f.exists() else rawjson({'version':1,'folders':[],'assets':[]})
   snapshot('library','catalog',raw,True);handler.reply(200,{'saved':True})
  except (OSError,ValueError) as e:handler.reply(400,{'error':str(e)})
  return True
 m=re.fullmatch(r'/api/checkpoints/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  f=ROOT/'内容'/(m[1]+'.json')
  if not f.exists():handler.reply(404,{'error':'白板不存在'});return True
  snapshot('boards',m[1],f.read_bytes(),True);handler.reply(200,{'saved':True});return True
 return False

def context_files(data):
 ids=set()
 def visit(obj):
  if isinstance(obj,dict):
   for k,v in obj.items():
    if k in ('assetId','mediaId') and isinstance(v,str):ids.add(v)
    elif isinstance(v,(dict,list)):visit(v)
  elif isinstance(obj,list):
   for v in obj:visit(v)
 visit(data)
 if 'assets' in data:ids.update(a['id'] for a in data['assets'] if a.get('path'))
 try:catalog=json.loads((ROOT/'素材目录.json').read_bytes())
 except (OSError,ValueError):return []
 out=[]
 for a in catalog.get('assets',[]):
  if a['id'] not in ids or not a.get('path'):continue
  item={k:a.get(k) for k in ['id','title','path','mime','notes','tags','size']};item['coverage']='文件引用；画面和声音未自动分析'
  try:
   p=Path(a['path']);st=p.stat();text=file_excerpt(str(p),st.st_mtime_ns,st.st_size)
   if text:item.update(text=text[:12000],truncated=len(text)>12000 or st.st_size>262144,coverage='可读取的文字摘录，最多12000字符')
  except OSError:item['coverage']='原文件暂时不可用'
  out.append(item)
 return out
