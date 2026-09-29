from pathlib import Path
from urllib.parse import parse_qs,urlparse
from html.parser import HTMLParser
from functools import lru_cache
import json,hashlib,time,re,os,threading
from app_paths import APP_ROOT, DATA_ROOT
ROOT=DATA_ROOT
HISTORY=ROOT/'历史记录'
PROPOSALS=ROOT/'AI待审核'
HLOCK=threading.RLock()

def rawjson(value):return json.dumps(value,ensure_ascii=False,indent=2).encode('utf-8')
def safe_id(value):return bool(re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',value))
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
def node_text(n):return ' '.join(str(v) for v in [*(n.get(k,'') for k in ['title','body','userText','annotation','url']),*n.get('tags',[]),*n.get('columns',[]),*(c for row in n.get('rows',[]) for c in row)] if v)
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
    d=json.loads(f.read_bytes());rows.append({'id':f.stem,'savedAt':f.stat().st_mtime,'names':[b['name'] for b in d['boards'].values()],'folders':[x['name'] for x in d['folders']]})
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
 m=re.fullmatch(r'/api/checkpoints/([a-zA-Z0-9_-]{1,100})',p)
 if m:
  f=ROOT/'内容'/(m[1]+'.json')
  if not f.exists():handler.reply(404,{'error':'白板不存在'});return True
  snapshot('boards',m[1],f.read_bytes(),True);handler.reply(200,{'saved':True});return True
 m=re.fullmatch(r'/api/proposals/([a-zA-Z0-9_-]{1,100})(/status)?',p)
 if not m:return False
 try:
  length=int(handler.headers.get('Content-Length','0'))
  if not 0<length<4*1024*1024:raise ValueError('提案不能超过4MB')
  value=json.loads(handler.rfile.read(length));PROPOSALS.mkdir(exist_ok=True);f=PROPOSALS/(m[1]+'.json')
  with HLOCK:
   old=f.read_bytes() if f.exists() else None;tag=hashlib.sha256(old).hexdigest() if old else 'new'
   if handler.headers.get('If-Match')!=tag:handler.reply(409,{'error':'提案已改变，请重新读取'});return True
   if m[2]:
    if not old:raise ValueError('提案不存在')
    d=json.loads(old);d['reviewStatus']=value.get('status','reviewed');d['acceptedChanges']=value.get('accepted',[]);d['reviewedAt']=time.time();value=d
   elif value.get('format')!='creative-board-proposal' or value.get('version')!=1 or value.get('resource') not in ('board','library') or not isinstance(value.get('baseETag'),str) or not isinstance(value.get('changes'),list) or len(value['changes'])>1000:raise ValueError('提案格式无效')
   raw=rawjson(value);tmp=f.with_suffix('.tmp');tmp.write_bytes(raw);os.replace(tmp,f)
  handler.reply(200,{'saved':True},etag=hashlib.sha256(raw).hexdigest())
 except Exception as e:handler.reply(400,{'error':str(e)})
 return True
