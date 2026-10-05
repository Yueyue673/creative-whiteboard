from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
import json, hashlib, os, re, threading, uuid, math
from app_paths import APP_ROOT, DATA_ROOT
ROOT=DATA_ROOT
DATA=ROOT/'内容'
LOCK=threading.Lock()
PORT=int(os.environ.get('CREATIVE_BOARD_PORT','18746'))

def encoded(obj): return json.dumps(obj,ensure_ascii=False,indent=2).encode('utf-8')
def digest(raw): return hashlib.sha256(raw).hexdigest()
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
  if n.get('type') not in ['note','frame','image','table']: raise ValueError('内容类型无效')
  if n.get('type')=='table':
   if not isinstance(n.get('columns'),list) or not 1<=len(n['columns'])<=100 or any(not isinstance(c,str) for c in n['columns']): raise ValueError('表格列无效')
   if not isinstance(n.get('rows'),list) or len(n['rows'])>5000 or any(not isinstance(r,list) or len(r)!=len(n['columns']) or any(not isinstance(c,str) for c in r) for r in n['rows']): raise ValueError('表格行无效')
  for k in ['x','y','w','h']:
   if not isinstance(n.get(k),(int,float)) or not -1000000<n[k]<1000000: raise ValueError('位置数据无效')
  for k in ['title','body','userText','annotation','url']:
   if k in n and not isinstance(n[k],str): raise ValueError('文字字段无效')
 for e in b['edges']:
  if e.get('from') not in ids or e.get('to') not in ids: raise ValueError('连线指向不存在的内容')
 return b

from assets import AssetMixin
from workflow_backend import workflow_get,workflow_put,snapshot

class Handler(AssetMixin, BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def reply(self,status,data,kind='application/json; charset=utf-8',etag=None):
  raw=data if isinstance(data,bytes) else encoded(data)
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
  if etag:self.send_header('ETag',etag)
  self.end_headers();self.wfile.write(raw)
 def allowed(self):return self.headers.get('Host','') in [f'127.0.0.1:{PORT}',f'localhost:{PORT}']
 def do_GET(self):
  if not self.allowed():self.reply(403,{'error':'仅限本机'});return
  p=urlparse(self.path).path
  if workflow_get(self,p):return
  if self.asset_get(p):return
  if p=='/api/health':self.reply(200,{'app':'creative-board','version':1});return
  if p=='/api/folders':
   f=ROOT/'目录.json';raw=f.read_bytes() if f.exists() else encoded({'folders':[]})
   self.reply(200,raw,etag=digest(raw) if f.exists() else 'new');return
  if p=='/api/boards':
   rows=[]
   for f in DATA.glob('*.json'):
    try:
     raw=f.read_bytes();b=json.loads(raw);rows.append({'id':f.stem,'name':b['name'],'count':len(b['nodes']),'folder':b.get('folder',''),'updated':f.stat().st_mtime})
    except Exception:pass
   self.reply(200,sorted(rows,key=lambda x:x['updated'],reverse=True));return
  m=re.fullmatch(r'/api/boards/([a-zA-Z0-9_-]{1,100})',p)
  if m:
   f=DATA/(m[1]+'.json')
   if not f.exists():self.reply(404,{'error':'找不到这张白板'});return
   raw=f.read_bytes();self.reply(200,raw,etag=digest(raw));return
  if p in ['/workspace.js','/workspace.css','/workflow.js','/workflow.css','/shell.js','/shell.css','/pane.js','/cells.js','/theme.css','/theme.js','/experience.js','/appearance.js','/refinement.css','/refinement.js','/ai-workflow.js','/workspace-shell.js','/workspace-shell.css','/media-controls.js','/media-markers.js','/navigation.js','/context-capture.js','/autosize.js','/library-clipboard.js','/explorer-navigation.js','/recovery.js','/board-lifecycle.js']:
   self.reply(200,(APP_ROOT/p[1:]).read_bytes(),'text/javascript; charset=utf-8' if p.endswith('.js') else 'text/css; charset=utf-8');return
  if p=='/vendor/html2canvas.min.js':
   self.reply(200,(APP_ROOT/'vendor/html2canvas.min.js').read_bytes(),'text/javascript; charset=utf-8');return
  if p=='/':
   self.reply(200,(APP_ROOT/'shell.html').read_bytes(),'text/html; charset=utf-8');return
  if p=='/index.html':
   self.reply(200,(APP_ROOT/'index.html').read_bytes(),'text/html; charset=utf-8');return
  self.reply(404,{'error':'不存在'})
 def do_DELETE(self):
  if not self.allowed() or self.headers.get('Origin') not in [None,f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}']:
   self.reply(403,{'error':'仅限本机'});return
  m=re.fullmatch(r'/api/(boards|folders)/([a-zA-Z0-9_-]{1,100})',urlparse(self.path).path)
  if not m:self.reply(404,{'error':'不存在'});return
  try:
   with LOCK:
    catalog=ROOT/'目录.json';folders=json.loads(catalog.read_bytes())
    f=DATA/(m[2]+'.json') if m[1]=='boards' else catalog
    if not f.exists():raise ValueError('内容已不存在')
    if self.headers.get('If-Match')!=digest(f.read_bytes()):self.reply(409,{'error':'内容已改变，请刷新后再删除'});return
    ids=set()
    if m[1]=='folders':
     if not any(x['id']==m[2] for x in folders['folders']):raise ValueError('文件夹不存在')
     ids.add(m[2])
     while True:
      more={x['id'] for x in folders['folders'] if x.get('parent') in ids}
      if more<=ids:break
      ids|=more
    files=[f] if m[1]=='boards' else [x for x in DATA.glob('*.json') if json.loads(x.read_bytes()).get('folder') in ids]
    snapshot={'boards':{x.stem:json.loads(x.read_bytes()) for x in files},'folders':[x for x in folders['folders'] if x['id'] in ids]}
    trash=ROOT/'回收站';trash.mkdir(exist_ok=True);ticket=uuid.uuid4().hex
    (trash/(ticket+'.json')).write_bytes(encoded(snapshot))
    for x in files:x.unlink()
    if ids:
     folders['folders']=[x for x in folders['folders'] if x['id'] not in ids]
     tmp=catalog.with_suffix('.tmp');tmp.write_bytes(encoded(folders));os.replace(tmp,catalog)
   self.reply(200,{'ticket':ticket,'ids':list(snapshot['boards']),'folderIds':[f['id'] for f in snapshot['folders']]})
  except Exception as e:self.reply(400,{'error':str(e)})
 def restore_trash(self,ticket):
  with LOCK:
   f=ROOT/'回收站'/(ticket+'.json');snapshot=json.loads(f.read_bytes());catalog=ROOT/'目录.json';folders=json.loads(catalog.read_bytes())
   if any((DATA/(i+'.json')).exists() for i in snapshot['boards']):raise ValueError('存在同编号白板，未覆盖现有内容')
   if any(x['id']==y['id'] for x in folders['folders'] for y in snapshot['folders']):raise ValueError('存在同编号文件夹')
   folders['folders']+=snapshot['folders'];known={x['id'] for x in folders['folders']}
   for x in folders['folders']:
    if x.get('parent') and x['parent'] not in known:x['parent']=''
   for i,b in snapshot['boards'].items():
    if b.get('folder') not in known:b['folder']=''
    (DATA/(i+'.json')).write_bytes(encoded(b))
   tmp=catalog.with_suffix('.tmp');tmp.write_bytes(encoded(folders));os.replace(tmp,catalog);f.unlink()
  self.reply(200,{'restored':True,'ids':list(snapshot['boards']),'boards':[{'id':i,'name':b['name'],'folder':b.get('folder',''),'count':len(b['nodes'])} for i,b in snapshot['boards'].items()]})
 def do_PUT(self):
  if not self.allowed() or self.headers.get('Origin') not in [None,f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}']:
   self.reply(403,{'error':'仅限本机页面写入'});return
  if workflow_put(self,urlparse(self.path).path):return
  restore=re.fullmatch(r'/api/trash/([a-f0-9]{32})',urlparse(self.path).path)
  if restore:
   try:self.restore_trash(restore[1])
   except Exception as e:self.reply(400,{'error':str(e)})
   return
  if self.asset_put():return
  is_folders=urlparse(self.path).path=='/api/folders'
  m=re.fullmatch(r'/api/boards/([a-zA-Z0-9_-]{1,100})',urlparse(self.path).path)
  if not m and not is_folders:self.reply(404,{'error':'不存在'});return
  try:
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>40*1024*1024:raise ValueError('单张白板不能超过40MB')
   b=json.loads(self.rfile.read(length))
   if is_folders:
    if not isinstance(b,dict) or not isinstance(b.get('folders'),list) or len(b['folders'])>1000: raise ValueError('目录无效')
    ids=set()
    for item in b['folders']:
     if not isinstance(item,dict) or not isinstance(item.get('id'),str) or item['id'] in ids or not isinstance(item.get('name'),str) or not isinstance(item.get('parent',''),str): raise ValueError('文件夹无效')
     ids.add(item['id'])
    lookup={x['id']:x for x in b['folders']}
    for item in b['folders']:
     seen={item['id']};parent=item.get('parent','')
     while parent:
      if parent in seen or parent not in lookup: raise ValueError('文件夹关系无效')
      seen.add(parent);parent=lookup[parent].get('parent','')
    f=ROOT/'目录.json'
   else:
    valid_board(b);f=DATA/(m[1]+'.json')
   with LOCK:
    current=digest(f.read_bytes()) if f.exists() else 'new'
    if self.headers.get('If-Match')!=current:self.reply(409,{'error':'文件已被另一个窗口或工具修改。请重新读取，或把当前内容另存一份。'});return
    if not is_folders and f.exists():snapshot('boards',m[1],f.read_bytes())
    raw=encoded(b);tmp=f.with_suffix('.tmp');tmp.write_bytes(raw);os.replace(tmp,f)
   self.reply(200,{'saved':True},etag=digest(raw))
  except Exception as e:self.reply(400,{'error':str(e)})

if __name__=='__main__':
 DATA.mkdir(parents=True,exist_ok=True)
 for filename,value in [("目录.json",{"folders":[]}),("素材目录.json",{"version":1,"folders":[],"assets":[]})]:
  target=ROOT/filename
  if not target.exists():target.write_bytes(encoded(value))
 print(f"Creative Whiteboard: http://127.0.0.1:{PORT}/",flush=True)
 print(f"Data: {ROOT}",flush=True)
 ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
