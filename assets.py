from pathlib import Path
from urllib.parse import urlparse,unquote,quote
import json,hashlib,mimetypes,os,re,threading,uuid
from workflow_backend import snapshot
from app_paths import APP_ROOT, DATA_ROOT
ROOT=DATA_ROOT
INDEX=ROOT/'素材目录.json'
FILES=ROOT/'素材文件'
LOCK=threading.Lock()
def data():
 return json.loads(INDEX.read_text(encoding='utf-8')) if INDEX.exists() else {'version':1,'folders':[],'assets':[]}
def save(d):
 if INDEX.exists():snapshot('library','catalog',INDEX.read_bytes())
 raw=json.dumps(d,ensure_ascii=False,indent=2).encode('utf-8');tmp=INDEX.with_suffix('.tmp');tmp.write_bytes(raw);os.replace(tmp,INDEX);return hashlib.sha256(raw).hexdigest()
def kind(path):return mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
class AssetMixin:
 def asset_get(self,p):
  if p=='/api/assets':
   raw=INDEX.read_bytes() if INDEX.exists() else json.dumps(data(),ensure_ascii=False).encode('utf-8')
   self.reply(200,raw,etag=hashlib.sha256(raw).hexdigest() if INDEX.exists() else 'new');return True
  preview=re.fullmatch(r'/api/preview/([a-zA-Z0-9_-]+)(?:/(.*))?',p)
  if preview:
   item=next((a for a in data()['assets'] if a['id']==preview[1]),None)
   if not item:self.reply(404,{'error':'文件未登记'});return True
   source=Path(item['path']).resolve()
   project=Path(os.environ.get('CREATIVE_BOARD_PREVIEW_ROOT',str(source.parent))).expanduser().resolve()
   root=project if source.is_relative_to(project) else source.parent
   if not preview[2]:
    self.send_response(302);self.send_header('Location','/api/preview/'+preview[1]+'/'+quote(source.relative_to(root).as_posix()));self.end_headers();return True
   target=(root/unquote(preview[2])).resolve()
   if not target.is_relative_to(root) or not target.is_file():self.reply(404,{'error':'页面引用的文件不存在或超出所在目录'});return True
   if target.suffix.lower() not in ['.html','.htm','.css','.js','.mjs','.json','.txt','.svg','.png','.jpg','.jpeg','.webp','.gif','.woff','.woff2','.ttf','.mp3','.wav','.m4a','.mp4','.webm','.pdf','.csv']:
    self.reply(415,{'error':'此文件请使用下载入口'});return True
   raw=target.read_bytes();mime=kind(target)
   if target.suffix.lower() in ['.html','.htm']:
    bridge=b'''<script>(()=>{let scale=1;addEventListener('beforeunload',()=>parent.postMessage({type:'creative-document-leaving'},'*'));addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='creative-document-probe')parent.postMessage({type:'creative-document-protected',nonce:e.data.nonce},'*')});function setZoom(z){scale=Math.max(.25,Math.min(5,Number(z)||1));document.documentElement.style.zoom=scale;parent.postMessage({type:'creative-document-zoom',scale},'*')}addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();e.stopImmediatePropagation();parent.postMessage({type:'creative-document-board-wheel',x:e.clientX,y:e.clientY,width:innerWidth,height:innerHeight,delta:e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1)},'*')}},{capture:true,passive:false});addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();parent.postMessage({type:'creative-preview-close'},'*')}if((e.ctrlKey||e.metaKey)&&['+','=','-','0','Add','Subtract'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();setZoom(e.key==='0'?1:scale*(e.key==='-'||e.key==='Subtract'?1/1.1:1.1))}},true);addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='creative-set-document-zoom')setZoom(e.data.scale)});parent.postMessage({type:'creative-document-ready'},'*')})();</script>'''
    bridge+=b'<script>'+ (APP_ROOT/'preview-pan.js').read_bytes()+b'</script>'
    head=re.search(br'<head(?:\s[^>]*)?>',raw,re.I)
    if head:raw=raw[:head.end()]+bridge+raw[head.end():]
    else:
     start=re.search(br'<!doctype[^>]*>',raw,re.I)
     pos=start.end() if start else 0
     raw=raw[:pos]+bridge+raw[pos:]
   self.send_response(200);self.send_header('Content-Type',mime+('; charset=utf-8' if mime.startswith('text/') or mime in ['application/json','application/javascript'] else ''));self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-cache');self.send_header('Access-Control-Allow-Origin','null');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',"sandbox allow-scripts; default-src 'self' https: data: blob:; script-src 'self' https: 'unsafe-inline' 'unsafe-eval'; style-src 'self' https: 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'");self.end_headers();self.wfile.write(raw);return True
  m=re.fullmatch(r'/api/media/([a-zA-Z0-9_-]+)',p)
  if not m:return False
  item=next((a for a in data()['assets'] if a['id']==m[1]),None)
  if not item:self.reply(404,{'error':'找不到素材'});return True
  f=Path(item['path'])
  if not f.is_file():self.reply(404,{'error':'原文件已移动或不可用'});return True
  size=f.stat().st_size;start=0;end=size-1;status=200
  rng=self.headers.get('Range','')
  if rng:
   found=re.fullmatch(r'bytes=(\d*)-(\d*)',rng)
   if not found:self.reply(416,{'error':'无效范围'});return True
   a,b=found.groups()
   if a:start=int(a);end=min(int(b),size-1) if b else size-1
   elif b:start=max(0,size-int(b))
   if start>=size or end<start:self.reply(416,{'error':'超出范围'});return True
   status=206
  mime=kind(f);safe=mime.startswith(('image/','audio/','video/')) or mime=='application/pdf'
  self.send_response(status);self.send_header('Content-Type',mime if safe else 'application/octet-stream');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',"sandbox; default-src 'none'; media-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'");self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(max(0,end-start+1)));self.send_header('Cache-Control','no-cache')
  if not safe:self.send_header('Content-Disposition','attachment')
  if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
  self.end_headers()
  try:
   with f.open('rb') as stream:
    stream.seek(start);remaining=end-start+1
    while remaining>0:
     chunk=stream.read(min(1024*1024,remaining))
     if not chunk:break
     self.wfile.write(chunk);remaining-=len(chunk)
  except (BrokenPipeError,ConnectionResetError):pass
  return True
 def asset_put(self):
  if urlparse(self.path).path!='/api/assets':return False
  try:
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<20*1024*1024:raise ValueError('素材目录过大')
   d=json.loads(self.rfile.read(length))
   if not isinstance(d.get('assets'),list) or not isinstance(d.get('folders'),list):raise ValueError('素材目录格式无效')
   ids=set()
   for a in d['assets']:
    if not isinstance(a,dict) or not re.fullmatch(r'[a-zA-Z0-9_-]+',a.get('id','')) or a['id'] in ids or not all(isinstance(a.get(k),str) for k in ['title','path','folder']):raise ValueError('素材信息无效')
    ids.add(a['id'])
   if any(not isinstance(f,str) for f in d['folders']):raise ValueError('文件夹格式无效')
   with LOCK:
    etag=hashlib.sha256(INDEX.read_bytes()).hexdigest() if INDEX.exists() else 'new'
    if self.headers.get('If-Match')!=etag:self.reply(409,{'error':'素材目录已被修改，请刷新素材库后再操作'});return True
    etag=save(d)
   self.reply(200,{'saved':True},etag=etag)
  except Exception as e:self.reply(400,{'error':str(e)})
  return True
 def do_POST(self):
  if not self.allowed() or self.headers.get('Origin') not in [None,'http://'+self.headers.get('Host','')]:self.reply(403,{'error':'仅限本机'});return
  if urlparse(self.path).path!='/api/assets/upload':self.reply(404,{'error':'不存在'});return
  f=None
  try:
   length=int(self.headers.get('Content-Length','0'))
   if not 0<length<=256*1024*1024:raise ValueError('拖入文件最多256MB；更大的素材请通过目录登记原路径')
   name=Path(unquote(self.headers.get('X-File-Name','文件'))).name
   folder=unquote(self.headers.get('X-Folder',''))
   ident=uuid.uuid4().hex;ext=Path(name).suffix[:20];FILES.mkdir(exist_ok=True);f=FILES/(ident+ext)
   with f.open('wb') as stream:
    remaining=length
    while remaining:
     chunk=self.rfile.read(min(1024*1024,remaining))
     if not chunk:raise ValueError('上传未完成')
     stream.write(chunk);remaining-=len(chunk)
   item={'id':ident,'title':name,'path':str(f),'folder':folder,'mime':kind(f),'notes':'','tags':[],'size':length}
   with LOCK:
    d=data();d['assets'].append(item)
    if folder and folder not in d['folders']:d['folders'].append(folder)
    save(d)
   self.reply(200,item)
  except Exception as e:
   if f and f.exists():f.unlink()
   self.reply(400,{'error':str(e)})
