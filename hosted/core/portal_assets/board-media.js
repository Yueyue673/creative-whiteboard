import {BoardTransport, BoardError, boardScope, validETag} from './board-transport.js';
import {folderCatalog,folderEntries} from './folder-plan.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FOLDER = /^[A-Za-z0-9_-]{1,100}$/;
const TYPES = new Map([
  ...['png','jpeg','gif','webp'].map(type=>['image/'+type,'image']),
  ...['wav','flac','mpeg','ogg','mp4'].map(type=>['audio/'+type,'audio']),
  ...['ogg','webm','mp4'].map(type=>['video/'+type,'video']),
]);
export const validAssetId = value => typeof value==='string' && UUID.test(value);
export const mediaKind = mime => TYPES.get(mime) || 'attachment';
export const canPreviewHTML = asset => asset?.mime==='application/octet-stream' && typeof asset.filename==='string' && /\.html?$/i.test(asset.filename) && Number.isSafeInteger(asset.size) && asset.size>0 && asset.size<=512*1024;
const htmlFrameHandlers=new WeakMap();
export function htmlPreviewFrame(plan,title,close){
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
  frame.title='HTML静态预览 · '+title;frame.className='static-html-preview';frame.dataset.staticHtml='';
  const handler=event=>{if(event.source===frame.contentWindow&&event.origin==='null'&&event.data?.type==='creative-static-preview-close'&&frame.isConnected)close();};
  htmlFrameHandlers.set(frame,handler);window.addEventListener('message',handler);
  return frame;
}
export function checkedReferences(value,scope,id){
  const categories=['board','trash','catalog','history','catalogHistory','draft'],integer=n=>Number.isSafeInteger(n)&&n>=0;
  if(!value||value.workspace!==scope.workspace||value.account!==scope.account||value.assetId!==id||!validAssetId(id)||
     !['limited','visibleSavedRecords'].includes(value.coverage)||!Number.isFinite(value.checkedAt)||value.checkedAt<=0||
     !integer(value.scannedRecords)||value.scannedRecords>500||!value.counts||
     categories.some(k=>!integer(value.counts[k]))||Object.keys(value.counts).length!==categories.length||
     !Array.isArray(value.items)||value.items.length>100||!integer(value.hiddenResults)||
     value.privateSubmissionsExcluded!==true||value.browserInputExcluded!==true||value.deletionSafe!==false)
    throw new BoardError('关联检查回复无法核对，请重新查看；这不是删除依据。',0,'protocol');
  const seen=new Set(),listed=Object.fromEntries(categories.map(k=>[k,0]));
  const items=value.items.map(row=>{
    const historical=['history','catalogHistory'].includes(row?.category),draft=row?.category==='draft';
    if(!row||!categories.includes(row.category)||!['board','folders','library'].includes(row.kind)||
       !FOLDER.test(row.key)||typeof row.id!=='string'||!(/^[1-9][0-9]*$/.test(row.id)||validAssetId(row.id))||
       ((historical||draft)&&!validAssetId(row.id))||typeof row.name!=='string'||row.name.length>1000||
       !Number.isFinite(row.savedAt)||row.savedAt<=0||!['direct','mentioned'].includes(row.match)||
       (draft?row.revision!==null:!integer(row.revision)||row.revision<1)||
       (['board','trash','history'].includes(row.category)&&row.kind!=='board')||
       (['catalog','catalogHistory'].includes(row.category)&&row.kind==='board')||seen.has(row.category+':'+row.id))
      throw new BoardError('关联记录无法逐项核对，请重新查看。',0,'protocol');
    seen.add(row.category+':'+row.id);listed[row.category]++;return Object.freeze({...row});
  });
  const total=categories.reduce((n,k)=>n+value.counts[k],0);
  if(total>value.scannedRecords||total!==items.length+value.hiddenResults||categories.some(k=>listed[k]>value.counts[k]))
    throw new BoardError('关联数量无法核对，请重新查看。',0,'protocol');
  return Object.freeze({...value,counts:Object.freeze({...value.counts}),items:Object.freeze(items)});
}
export function bytesLabel(value) {
  if(value<1024)return value+' B';
  return value<1024*1024?(value/1024).toFixed(1)+' KB':(value/1024/1024).toFixed(1)+' MB';
}
function csrf() {
  const item=document.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('__Host-creative_csrf='));
  try{return item?decodeURIComponent(item.slice(item.indexOf('=')+1)):'';}catch{return '';}
}

// Files never use the current-workspace cookie or a URL supplied in a board.
export class BoardMedia {
  #scope; #identity; #pending=null;
  constructor(scope){this.#scope=boardScope(scope);this.#identity=new BoardTransport(this.#scope);}
  get base(){return `/w/${this.#scope.workspace}/api/`;}
  url(id){if(!validAssetId(id))throw new TypeError('素材编号无效');return this.base+'media/'+id+'?account='+this.#scope.account;}
  async access(edit=false){
    await this.#identity.assertIdentity();const workspace=await this.#identity.workspace();
    if(edit&&workspace.role==='viewer')throw new BoardError('此工作区只有阅读权限，文件仍保留在当前页面。',403,'readonly');
    return workspace;
  }
  asset(value){
    if(!value||!validAssetId(value.id)||typeof value.title!=='string'||typeof value.filename!=='string'||
       typeof value.mime!=='string'||!Number.isSafeInteger(value.size)||value.size<1||
       !/^[a-f0-9]{64}$/.test(value.contentHash)||!validETag(value.etag)||
       typeof value.folderId!=='string'||(value.folderId&&!FOLDER.test(value.folderId))||
       (value.archived!==undefined&&typeof value.archived!=='boolean')||typeof value.folder!=='string'||typeof value.notes!=='string'||value.notes.length>65536||
       !Array.isArray(value.tags)||value.tags.length>50||value.tags.some(tag=>typeof tag!=='string'||tag.length>100))
      throw new BoardError('素材返回结果无法核对，请重新检查列表。',0,'protocol');
    return Object.freeze({...value, archived:value.archived===true,mediaURL:this.url(value.id),kind:mediaKind(value.mime)});
  }
  async #request(path,method='GET',data,expected){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    const headers={'Accept':'application/json','X-Creative-Account':String(this.#scope.account)};
    if(method!=='GET'){headers['X-CSRFToken']=csrf();headers['Content-Type']='application/json';headers['If-Match']=expected;}
    try{
      let response;
      try{response=await fetch(this.base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),
        credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});}
      catch{throw new BoardError(method==='GET'?'连接中断，未读取素材；请检查连接后再试。':'未确认保存结果，输入仍在当前页面；请先核对服务器版本。',0,method==='GET'?'offline':'uncertain');}
      let value;try{value=await response.json();}catch{throw new BoardError('素材返回结果无法核对。',response.status,'protocol');}
      if(!response.ok)throw new BoardError(value?.error||'原工作区的操作未完成，请保留输入。',response.status,value?.code||'request_failed',value);
      return {value,etag:(response.headers.get('X-Creative-Revision')||response.headers.get('ETag'))};
    }finally{clearTimeout(timeout);}
  }
  async #get(path){return (await this.#request(path)).value;}
  async list(after=null,archived=false){
    if(typeof archived!=='boolean')throw new TypeError('素材显示范围无效');
    if(after!==null&&!validAssetId(after))throw new TypeError('素材翻页编号无效');
    const value=await this.#get('assets/items?limit=40'+(after?'&after='+after:'')+(archived?'&shelf=archived':''));
    if(!Array.isArray(value.items)||value.items.length>40||!(value.next===null||validAssetId(value.next)))throw new BoardError('素材列表无法核对。',0,'protocol');
    const items=value.items.map(item=>this.asset(item));
    if(items.some(item=>item.archived!==archived))throw new BoardError('素材显示范围无法核对，请刷新。',0,'protocol');
    return {items,next:value.next};
  }
  async search(query,archived=false){
    if(typeof archived!=='boolean')throw new TypeError('素材显示范围无效');
    if(typeof query!=='string'||!query.trim()||[...query].length>120||/[\p{Cc}\p{Cs}]/u.test(query))throw new TypeError('查找词须为1至120个字符。');
    query=query.trim();await this.access();const value=await this.#get('assets/search?q='+encodeURIComponent(query)+(archived?'&shelf=archived':''));
    if(!value||value.account!==this.#scope.account||value.workspace!==this.#scope.workspace||value.query!==query||
       !['registeredMetadata','limited'].includes(value.coverage)||!Number.isSafeInteger(value.scannedAssets)||value.scannedAssets<0||value.scannedAssets>500||
       !Number.isFinite(value.checkedAt)||value.checkedAt<=0||!Array.isArray(value.items)||value.items.length>40)
      throw new BoardError('素材查找回复无法核对，请重新查找。',0,'protocol');
    const seen=new Set(),items=value.items.map(row=>{
      if(!row||!['素材名称','原文件名','说明','标签'].includes(row.context)||typeof row.excerpt!=='string'||[...row.excerpt].length>142)
        throw new BoardError('素材查找线索无法核对，请重新查找。',0,'protocol');
      const asset=this.asset(row.asset);if(asset.archived!==archived)throw new BoardError('素材查找范围无法核对，请刷新。',0,'protocol');
      if(seen.has(asset.id))throw new BoardError('素材查找记录重复，请重新查找。',0,'protocol');
      seen.add(asset.id);return Object.freeze({asset,context:row.context,excerpt:row.excerpt});
    });
    if(items.length>value.scannedAssets)throw new BoardError('素材查找数量无法核对，请重新查找。',0,'protocol');
    await this.access();return Object.freeze({...value,items:Object.freeze(items)});
  }
  async read(id){
    if(!validAssetId(id))throw new TypeError('素材编号无效');
    const result=await this.#request('assets/items/'+id),asset=this.asset(result.value);
    if(asset.id!==id||asset.etag!==result.etag)throw new BoardError('素材编号或版本无法核对。',0,'protocol');
    return asset;
  }
  async references(id){
    if(!validAssetId(id))throw new TypeError('素材编号无效');
    await this.access();const result=checkedReferences(await this.#get('assets/items/'+id+'/references'),this.#scope,id);
    await this.access();return result;
  }
  async htmlPreview(asset){
    if(!validAssetId(asset?.id)||!canPreviewHTML(asset))throw new BoardError('这份文件暂时只提供原文件下载。',0,'unsupported');
    await this.access();const result=await this.#get('assets/items/'+asset.id+'/html-preview');
    const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    const expected=`${this.base}html-preview/${asset.id}?account=${this.#scope.account}&hash=${asset.contentHash}&render=${result?.previewHash}`;
    if(!result||result.account!==this.#scope.account||result.workspace!==this.#scope.workspace||result.assetId!==asset.id||
       result.contentHash!==asset.contentHash||!hash(result.contentHash)||!hash(result.previewHash)||result.url!==expected||
       result.mode!=='static'||result.exitBridge!=='escape-close-v1'||typeof result.omittedMarkup!=='boolean'||!Number.isSafeInteger(result.size)||result.size<1||result.size>1024*1024||result.limitBytes!==512*1024)
      throw new BoardError('HTML预览回复无法核对，请重新查看。',0,'protocol');
    await this.access();return Object.freeze({...result});
  }
  async update(id,data,expected){
    if(!validAssetId(id)||!validETag(expected))throw new TypeError('缺少原素材编号或版本');
    const result=await this.#request('assets/items/'+id,'PATCH',data,expected),asset=this.asset(result.value?.asset);
    if(result.value?.saved!==true||asset.id!==id||asset.etag!==result.etag)
      throw new BoardError('保存回复无法核对，输入仍保留；请检查服务器版本。',0,'protocol');
    return asset;
  }
  async folders(){
    return folderEntries((await this.catalog()).value);
  }
  async catalog(){
    const result=await this.#request('assets');
    if(!validETag(result.etag,true))throw new BoardError('目录版本无法核对，请保留输入。',0,'protocol');
    return {value:folderCatalog(result.value),etag:result.etag};
  }
  async updateCatalog(value,expected){
    if(!validETag(expected,true))throw new TypeError('缺少原目录版本');
    const submitted=folderCatalog(value),result=await this.#request('assets','PUT',submitted,expected);
    if(result.value?.saved!==true||!validETag(result.etag))throw new BoardError('目录保存回复无法核对，请保留输入并检查服务器版本。',0,'protocol');
    const current=await this.catalog();
    if(current.etag!==result.etag||JSON.stringify(current.value)!==JSON.stringify(submitted))
      throw new BoardError('保存后的目录无法逐项核对，请保留输入并检查服务器版本。',0,'protocol');
    return current;
  }
  async quota(){
    const value=await this.#get('media-quota');
    for(const key of ['workspaceBytes','workspacePendingBytes','workspaceLimitBytes','accountUploadedBytes','accountPendingBytes','accountLimitBytes','singleUploadLimitBytes'])
      if(!Number.isSafeInteger(value[key])||value[key]<0)throw new BoardError('容量返回结果无法核对。',0,'protocol');
    return value;
  }
  cancel(){if(this.#pending){this.#pending.canceled=true;this.#pending.xhr.abort();}}
  async upload(file,folderId,onProgress=()=>{}){
    if(!(file instanceof File)||!file.size)throw new TypeError('请选择一个非空文件');
    if(folderId&&!FOLDER.test(folderId))throw new TypeError('上传位置无效');
    if(this.#pending)throw new BoardError('上一个上传尚未结束。',0,'pending');
    // Reserve this page before the asynchronous identity check, too.
    const xhr=new XMLHttpRequest(),pending={xhr,canceled:false};this.#pending=pending;
    try{
      await this.access(true);
      if(pending.canceled)throw new BoardError('上传已取消，原文件仍在当前页面。',0,'upload_uncertain');
      const value=await new Promise((resolve,reject)=>{
        const uncertain=()=>reject(new BoardError('未确认上传结果，原文件仍在页面；先刷新素材列表检查，避免重复上传。',0,'upload_uncertain'));
        xhr.upload.addEventListener('progress',event=>onProgress(event.lengthComputable?event.loaded/event.total:null));
        xhr.upload.addEventListener('load',()=>onProgress(1));
        xhr.addEventListener('error',uncertain);xhr.addEventListener('abort',uncertain);xhr.addEventListener('timeout',uncertain);
        xhr.addEventListener('load',()=>{
          let result;try{result=JSON.parse(xhr.responseText);}catch{uncertain();return;}
          if(xhr.responseURL!==location.origin+this.base+'assets/upload'){uncertain();return;}
          if(xhr.status!==201){reject(new BoardError(result?.error||'上传未完成，原文件仍在页面。',xhr.status,result?.code||'upload_failed'));return;}
          try{resolve(this.asset(result));}catch{uncertain();}
        });
        xhr.open('POST',this.base+'assets/upload');xhr.timeout=120000;
        xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('Accept','application/json');
        xhr.setRequestHeader('X-Creative-Account',String(this.#scope.account));xhr.setRequestHeader('X-CSRFToken',csrf());
        xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));if(folderId)xhr.setRequestHeader('X-Folder-Id',folderId);
        // Browser sends File bytes and its actual Content-Length. No multipart or conversion.
        xhr.send(file);
      });
      try{await this.access(true);}catch(error){
        throw new BoardError('收到上传回复，但原账号权限复核未完成；文件仍在页面，请先在原工作区检查素材列表。',error.status,'upload_uncertain');
      }
      if(pending.canceled)throw new BoardError('未确认上传结果，原文件仍在页面；先刷新素材列表检查，避免重复上传。',0,'upload_uncertain');
      return value;
    }finally{if(this.#pending===pending)this.#pending=null;}
  }
}

export function stopMedia(root){
  for(const frame of root.querySelectorAll('iframe[data-static-html]')){const handler=htmlFrameHandlers.get(frame);if(handler)window.removeEventListener('message',handler);htmlFrameHandlers.delete(frame);frame.onload=null;frame.onerror=null;frame.removeAttribute('src');frame.srcdoc='';frame.remove();}
  for(const item of root.querySelectorAll('img,audio,video')){
    if(item.pause)item.pause();item.removeAttribute('src');if(item.load)item.load();
  }
}
export function mediaElement(asset){
  const kind=mediaKind(asset.mime);if(kind==='attachment')return null;
  const item=document.createElement(kind==='image'?'img':kind);
  item.className='protected-media';item.src=asset.mediaURL;
  if(kind==='image'){item.alt=asset.title||asset.filename;item.decoding='async';item.tabIndex=0;}
  else{item.controls=true;item.preload='metadata';if(kind==='video')item.playsInline=true;}
  return item;
}
