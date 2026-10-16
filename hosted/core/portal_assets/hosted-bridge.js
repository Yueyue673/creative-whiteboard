/* Cloud transport for the original workbench; the workbench remains its owner. */
(() => {
 'use strict';
 const original=Object.freeze(JSON.parse(document.getElementById('hosted-workbench-context').textContent));
 const account=original.account.id,workspace=original.workspace,base=original.base,rawFetch=window.fetch.bind(window);
 let paused=false;const trash=new Map();
 const NativeChannel=window.BroadcastChannel;
 if(NativeChannel)window.BroadcastChannel=class extends NativeChannel{constructor(name){super(name==='creative-account-session'?name:`creative-hosted-native:${account}:${workspace}:`+name);}};
 const jsonResponse=(value,response)=>{const headers=new Headers(response.headers);headers.delete('Content-Length');return new Response(JSON.stringify(value),{status:response.status,headers});};
 async function ticket(key,etag){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(workspace+'\0'+key+'\0'+etag));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32);}
 async function trashRows(rows){const result=[];for(const row of rows){if(row.kind==='folder'){trash.set(row.id,{kind:'folder',id:row.id,etag:row.etag});result.push(row);}else{const id=await ticket(row.id,row.etag);trash.set(id,{kind:'board',key:row.id,etag:row.etag});result.push({...row,id,names:[row.name],folders:[]});}}return result;}
 function scopedStorage(storage){
  const prefix=`creative-hosted-native:${account}:${workspace}:`;
  return Object.freeze({
   getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,value),removeItem:key=>storage.removeItem(prefix+key),
   key:index=>Object.keys(storage).filter(k=>k.startsWith(prefix))[index]?.slice(prefix.length)??null,
   get length(){return Object.keys(storage).filter(k=>k.startsWith(prefix)).length;},
   clear(){Object.keys(storage).filter(k=>k.startsWith(prefix)).forEach(k=>storage.removeItem(k));}
  });
 }
 for(const name of ['localStorage','sessionStorage']){
  let storage;try{storage=window[name];}catch{storage={getItem(){throw Error('浏览器存储暂时不可用');},setItem(){throw Error('浏览器未保存偏好');},removeItem(){throw Error('浏览器存储暂时不可用');}};}
  try{const prefix=`creative-hosted-native:${account}:${workspace}:`;Object.defineProperty(window,name,{value:scopedStorage(storage)});
   if(name==='localStorage')window.addEventListener('storage',event=>{if(event.storageArea!==storage)return;if(event.key!==null&&!event.key.startsWith(prefix)){event.stopImmediatePropagation();return;}if(event.key!==null)Object.defineProperty(event,'key',{value:event.key.slice(prefix.length)});Object.defineProperty(event,'storageArea',{value:window.localStorage});},true);
  }catch{document.open();document.write('<!doctype html><meta charset="utf-8"><p>此浏览器无法隔离工作区记录，工作台已停止打开。请换一个浏览器再登录；原内容没有改动。</p>');document.close();return;}
 }
 function csrf(){return document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-creative_csrf='))?.slice('__Host-creative_csrf='.length)||'';}
 function freeze(message){
  if(paused)return;paused=true;
  const banner=document.createElement('aside');banner.id='hostedAccountPaused';banner.setAttribute('role','alert');banner.style.cssText='position:fixed;inset:0 0 auto;z-index:2147483647;padding:16px;background:#332a26;color:#fff0d4;border-bottom:1px solid #d2b788;font:14px/1.8 system-ui';
  banner.textContent=message+' 原工作台的输入仍保留。可以导出当前白板，请在新页面检查原账号。';
  const link=document.createElement('a');link.href='/';link.target='_blank';link.rel='noopener';link.textContent=' 检查登录 ↗';link.style.color='inherit';banner.append(link);document.body.prepend(banner);
 }
 const mediaURL=id=>base+'media/'+encodeURIComponent(id)+'?account='+encodeURIComponent(account);
 const previewURL=id=>base+'native/preview/'+encodeURIComponent(id)+'?account='+encodeURIComponent(account);
 Object.defineProperty(window,'whiteboardHosted',{value:Object.freeze({...original,mediaURL,previewURL,checkIdentity:check,pause:freeze,get paused(){return paused;}})});
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return rawFetch(input,options);
  if(paused)return new Response(JSON.stringify({error:'原账号或权限已改变，原输入仍保留',code:'account_changed',preserveDraft:true}),{status:409,headers:{'Content-Type':'application/json'}});
  const suffix=url.pathname.slice(5);
  let mapped=suffix==='assets'?'native/assets':suffix==='search'?'native/search':suffix==='trash'?'native/trash':/^folders\/[^/]+$/.test(suffix)?'native/'+suffix:/^history\//.test(suffix)?'native/'+suffix:suffix;
  if(suffix.startsWith('checkpoints/'))mapped='native/checkpoints/'+(suffix.startsWith('checkpoints/library/')?suffix.slice(12):'board/'+suffix.slice(12));
  url.pathname=base+mapped;
  const headers=new Headers(options.headers||{});headers.set('X-Creative-Account',String(account));
  let method=(options.method||'GET').toUpperCase();if(!['GET','HEAD'].includes(method))headers.set('X-CSRFToken',decodeURIComponent(csrf()));
  let restored=null;
  if(method==='PUT'&&/^trash\/[a-f0-9]{32}$/.test(suffix)){
   const id=suffix.slice(6);
   if(!trash.has(id)){
    const r=await rawFetch(base+'native/trash',{headers:{'X-Creative-Account':String(account)},credentials:'same-origin',cache:'no-store',redirect:'error'});
    if(!r.ok)return r;await trashRows(await r.json());
   }
   restored=trash.get(id);if(!restored)return new Response(JSON.stringify({error:'原删除记录已改变，请重新核对回收站'}),{status:409,headers:{'Content-Type':'application/json'}});
   url.pathname=restored.kind==='folder'?base+'native/trash/'+restored.id+'/restore':base+'boards/'+encodeURIComponent(restored.key)+'/restore';method='POST';headers.set('If-Match',restored.etag);
  }
  let response;
  if(method==='DELETE'&&/^folders\/[^/]+$/.test(suffix)){
   // Original lifecycle has flushed and frozen affected local views. Bind the
   // batch to a fresh server plan; any intervening board/placement change is
   // refused atomically. No new global workspace or filesystem path is used.
   const preview=await rawFetch(url,{method:'GET',headers,credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!preview.ok)response=preview;
   else{const value=await preview.json();if(typeof value.plan!=='string')throw Error('整夹删除范围无法核对，原内容保留');headers.set('Content-Type','application/json');options={...options,body:JSON.stringify({plan:value.plan})};}
  }
  response=response||await rawFetch(url,{...options,method,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});
  const revision=response.headers.get('X-Creative-Revision');
  if(revision&&(revision==='new'||/^"[a-f0-9]{64}"$/.test(revision))&&revision!==response.headers.get('ETag')){
   const stable=new Headers(response.headers);stable.set('ETag',revision);stable.delete('Content-Length');stable.delete('Content-Encoding');
   response=new Response(response.body,{status:response.status,statusText:response.statusText,headers:stable});
  }
  if(response.status===401)freeze('原登录已经失效。');
  if(response.status===409){const value=await response.clone().json().catch(()=>({}));if(value.code==='account_changed')freeze('登录账号已经改变。');}
  if(response.ok&&method==='GET'&&suffix==='trash')return jsonResponse(await trashRows(await response.json()),response);
  if(response.ok&&method==='DELETE'&&/^boards\/[^/]+$/.test(suffix)){
   const key=suffix.slice(7),etag=response.headers.get('ETag'),id=await ticket(key,etag);trash.set(id,{key,etag});return jsonResponse({ids:[key],ticket:id,folders:[]},response);
  }
  if(response.ok&&restored)return jsonResponse(restored.kind==='folder'?{...await response.json(),ticket:suffix.slice(6)}:{ids:[restored.key],ticket:suffix.slice(6),folders:[]},response);
  if(response.ok&&/^history\//.test(suffix)){
   const value=await response.json();if(Array.isArray(value))return jsonResponse(value.map(row=>({...row,count:row.count??0})),response);return jsonResponse(value,response);
  }
  return response;
 };
 async function check(){if(paused)return false;try{const response=await rawFetch('/api/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});if(!response.ok)return false;if((await response.json()).account?.id!==account){freeze('登录账号已经改变。');return false;}return true;}catch{return false;/* An interrupted connection does not establish logout. */}}
 window.addEventListener('focus',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});window.addEventListener('pageshow',e=>{if(e.persisted)check();});
 window.addEventListener('message',event=>{if(event.data?.type==='creative-static-preview-close'&&event.source===document.getElementById('htmlDocument')?.contentWindow)document.getElementById('dialog')?.close();});
 try{const channel=new BroadcastChannel('creative-account-session');channel.onmessage=event=>{if(event.data?.type==='changed')check();};}catch{}
 document.addEventListener('DOMContentLoaded',()=>{
  setupShellReception();
  const menu=document.querySelector('#shellMore>div');if(menu){
   const reception=document.createElement('button');reception.textContent='设备更新';reception.onclick=()=>{document.getElementById('shellMore').open=false;receptionAction('settings');};menu.append(reception);
   for(const [text,path]of [['账号、工作区与成员',`/w/${workspace}/manage/`],['切换工作区','/spaces']]){const button=document.createElement('button');button.textContent=text;button.onclick=()=>location.assign(path);menu.append(button);}
  }
  if(original.role==='viewer'){
   const status=document.getElementById('shellStatus');if(status)status.title='这个工作区只有阅读权限，服务器不会接受编辑';
   document.documentElement.dataset.hostedRole='viewer';
  }
  setupNativeReception().catch(()=>{/* Existing saving/export remain available if the reception modules cannot load. */});
 });

 function receptionControl(element,message,action){
  element.onclick=message?action:null;element.onkeydown=message?event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();action();}}:null;
  element.style.textDecoration=message?'underline':'';element.style.cursor=message?'pointer':'';
  if(message){element.setAttribute('role','button');element.tabIndex=0;element.setAttribute('aria-label',message+' 检查设备更新');}
  else{element.removeAttribute('role');element.removeAttribute('tabindex');element.removeAttribute('aria-label');}
 }
 function receptionLabel(mode){return ['editing','history'].includes(mode)?'有更新':mode==='offline'?'连接中断':mode==='disabled'?'接收已暂停':'需检查';}
 function receptionAction(kind='review'){const target=frames.get(current()?.id)?.contentWindow;if(target)target.postMessage({type:'creative-native-reception-action',account,workspace,kind},location.origin);}
 function setupShellReception(){
  if(!document.getElementById('shellHeader'))return;
  const peers=new WeakMap(),previous=updateStatus;
  function act(){receptionAction();}
  updateStatus=function(){
   previous();const element=document.getElementById('shellStatus'),state=pane(current())?.state(),peer=peers.get(frames.get(current()?.id)?.contentWindow);
   const show=peer?.message&&!otherBoardIssues().length&&state&&!state.blocked&&!state.deleted&&!state.saveError&&!state.loadError&&!state.loading&&!state.contentDirty&&!state.savingContent&&!state.pendingImports&&!window.whiteboardWorkspace?.explorer()?.pending?.();
   receptionControl(element,show?peer.message:'',act);if(show){element.textContent=receptionLabel(peer.mode);element.title=peer.message+' 点击检查设备更新。';}
  };
  window.addEventListener('message',event=>{
   const data=event.data;if(event.origin!==location.origin||data?.type!=='creative-native-reception'||data.account!==account||data.workspace!==workspace||typeof data.message!=='string'||data.message.length>300||!['ready','editing','history','offline','unchecked','unavailable','disabled'].includes(data.mode))return;
   if(![...frames.values()].some(frame=>frame.contentWindow===event.source))return;
   peers.set(event.source,{mode:data.mode,message:data.message});updateStatus();
  });
 }

 async function setupNativeReception(){
  if(!document.getElementById('canvas')||new URLSearchParams(location.search).get('explorer')==='1')return;
  // A device's pan/zoom is a browser preference, never a competing full-board
  // save. Authored changes still use the original guarded cloud save path.
  function report(){if(window.whiteboardPane&&parent!==window)parent.postMessage({type:'pane-state',state:window.whiteboardPane.state()},location.origin);}
  function cameraValue(value){return value&&['x','y','z'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key]))&&value.z>0&&value.z<=32;}
  function rememberCamera(){if(!boardId||!cameraValue(board?.view))return;try{localStorage.setItem('creative-board-camera:'+boardId,JSON.stringify(board.view));}catch{/* The mounted view is retained even if browser preferences are unavailable. */}}
  const previousChange=change;change=function(viewOnly=false){if(!viewOnly)return previousChange(viewOnly);rememberCamera();report();};
  function restoreCamera(){if(loading||loadError||!board||!boardId)return;try{const value=JSON.parse(localStorage.getItem('creative-board-camera:'+boardId)||'null');if(cameraValue(value)){board.view={x:value.x,y:value.y,z:value.z};moveView();}}catch{/* An unavailable preference does not change the loaded document. */}}
  window.addEventListener('creative-board-loading',restoreCamera);restoreCamera();
  if(dirty&&!contentDirty&&!savePromise&&!savingContent&&!blocked&&!saveError){clearTimeout(saveTimer);dirty=false;}
  const [{BoardTransport},{valueEqual},{prepareNativeReception,applyReceivedBoard}]=await Promise.all([import('/portal-assets/board-transport.js'),import('/portal-assets/board-reconciliation.js'),import('/portal-assets/native-reception.js')]);
  const preference='creative-native-reception-enabled';let enabled=true;try{enabled=localStorage.getItem(preference)!=='false';}catch{}
  let epoch=0,pending=null,pendingEpoch=0,composing=false,stopped=false,timer=null,mode='ready',message='';const pointers=new Set();
  const copy=value=>structuredClone(value),withoutView=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='view'));
  function status(next,text=''){
   if(next==='ready'&&!enabled){next='disabled';text='自动接收已暂停，自己的保存不受影响。可在设备更新中恢复或检查一次。';}
   if(next===mode&&text===message)return;mode=next;message=text;
   if(parent!==window&&window.whiteboardPane)parent.postMessage({type:'creative-native-reception',account,workspace,mode,message},location.origin);
   else{const element=document.getElementById('status');receptionControl(element,message,options);element.textContent=message?receptionLabel(mode):'自动保存';element.title=message;}
  }
  function present(){return !document.hidden&&!stopped&&(!window.frameElement||window.frameElement.getClientRects().length>0);}
  function clean(){return !paused&&!!board&&!!boardId&&etag!=='new'&&!dirty&&!contentDirty&&!savePromise&&!savingContent&&!loading&&!blocked&&!saveError&&!document.body.inert&&!window.whiteboardImports?.pendingCanvas()&&!window.whiteboardBoardDocument?.state()?.deleted;}
  function occupied(){return composing||pointers.size||!!gesture||document.body.classList.contains('canvas-gesture')||document.getElementById('canvas').classList.contains('document-panning')||!!document.querySelector('dialog[open]')||!!document.activeElement?.matches('input,textarea,[contenteditable="true"],[contenteditable=""]');}
  function options(){
   if(mode==='disabled'){settings();return;}
   if(mode!=='history'){receive(true);return;}
   showDialog('<h2>核对其他设备的更新</h2><p>更新涉及当前撤销或重做的内容，原白板和操作步骤都还保留。</p><p>可以继续当前编辑，也可以先导出备份再重新读取。重新读取会清空当前撤销和重做步骤。</p>',[['继续当前',()=>document.getElementById('dialog').close()],['导出当前内容',()=>exportJSON()],['重新读取',()=>{document.getElementById('dialog').close();confirmReload();}]]);
  }
  function setEnabled(value,persist=true){
   enabled=value;epoch++;clearTimeout(timer);if(persist)try{localStorage.setItem(preference,String(value));}catch{}
   status('ready');if(enabled)schedule(150);
  }
  function settings(){
   showDialog('<h2>设备更新</h2><p>'+(enabled?'正在定期检查其他设备保存的内容，当前输入、操作或未完成的保存会先保留。':'自动接收已暂停，当前白板和操作步骤仍保留，自己的保存不受影响。')+'</p><p>开关只保存在当前浏览器的这个账号与工作区。视角也留在本设备；同时编辑同一内容仍需核对保存冲突。</p>',[['返回',()=>document.getElementById('dialog').close()],[enabled?'暂停自动接收':'恢复自动接收',()=>{document.getElementById('dialog').close();setEnabled(!enabled);} ],['检查一次',()=>{document.getElementById('dialog').close();receive(true).then(()=>{if(mode==='history')options();});}]]);
  }
  window.addEventListener('storage',event=>{if(event.key===preference)setEnabled(event.newValue!=='false',false);});
  window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='creative-native-reception-action'&&event.data.account===account&&event.data.workspace===workspace){if(event.data.kind==='settings')settings();else options();}});
  function same(snapshot){return snapshot.epoch===epoch&&clean()&&boardId===snapshot.id&&etag===snapshot.etag&&contentRevision===snapshot.revision&&JSON.stringify(board)===snapshot.raw&&history===snapshot.history&&future===snapshot.future&&history.length===snapshot.undoLength&&future.length===snapshot.redoLength;}
  function adopt(next,tag,steps){
   // Unchanged DOM fields retain handlers closing over the original node.
   // Keep those live objects (and the board used by spatial return contexts).
   applyReceivedBoard(board,next);
   etag=tag;history=steps.undo;future=steps.redo;contentRevision++;
   const ids=new Set(board.nodes.map(node=>node.id));selected=new Set([...selected].filter(id=>ids.has(id)));if(edgeId&&!board.edges.some(edge=>edge.id===edgeId))edgeId=null;
   const row=boardList.find(row=>row.id===boardId);if(row){row.name=board.name;row.folder=board.folder||'';row.count=board.nodes.length;}
   for(const option of document.getElementById('boards').options)if(option.value===boardId)option.textContent=board.name;
   render();renderFolders();status('ready');
   report();
   window.dispatchEvent(new Event('creative-research-context'));
  }
  function receive(manual=false){
   if(pending)return manual&&pendingEpoch!==epoch?pending.then(()=>receive(true)):pending;
   if((!enabled&&!manual)||!present()||!clean())return Promise.resolve({skipped:true});
   if(mode==='editing'&&occupied())return Promise.resolve({deferred:true});
   const snapshot={epoch,id:boardId,etag,revision:contentRevision,raw:JSON.stringify(board),value:copy(board),history,future,undoLength:history.length,redoLength:future.length};
   const transport=new BoardTransport({account,workspace,key:snapshot.id});
   const task=Promise.resolve().then(async()=>{
    try{
     const result=await transport.readLatest(snapshot.etag);
     if(!same(snapshot)||!present())return {skipped:true};
     if(result.unchanged){status('ready');return {unchanged:true};}
     if(occupied()){status('editing','其他设备有更新，结束当前输入或操作后接收。');return {deferred:true};}
     if(!await check()){if(!paused)status('offline','暂时无法核对登录，当前白板和输入仍保留。');return {received:false};}
     await transport.workspace();
     if(!same(snapshot)||!present()||occupied())return {skipped:true};
     // Remote cameras never move this device. An otherwise identical revision
     // only advances its checked ETag, preserving every mounted field/history.
     if(valueEqual(withoutView(snapshot.value),withoutView(result.value))){etag=result.etag;status('ready');return {changed:false};}
     let steps;try{steps=prepareNativeReception(snapshot.value,result.value,snapshot.history,snapshot.future);}catch{status('history','其他设备有更新，当前撤销和重做步骤仍保留。');return {deferred:true,history:true};}
     if(!same(snapshot)||!present()||occupied())return {skipped:true};
     adopt(steps.board,result.etag,steps);return {changed:true};
    }catch(error){
     if(!same(snapshot)||!present())return {skipped:true};
     if(error.code==='account_changed'||error.status===401){freeze('原登录已经失效或改变。');return {paused:true};}
     if([403,404,410].includes(error.status)){
      if(!await check()){if(!paused)status('offline','暂时无法核对登录，当前白板和输入仍保留。');return {received:false};}
      try{await transport.workspace();}catch(access){if(access.code==='account_changed'||[401,403,404,410].includes(access.status)){freeze('原工作区的访问权限已改变。');return {paused:true};}status('offline','暂时无法核对工作区，当前白板和输入仍保留。');return {received:false};}
      if(!same(snapshot))return {skipped:true};
      status('unavailable','原白板已删除或暂时不可读取，当前内容仍保留；可先导出备份。');return {received:false};
     }
     status(error.code==='offline'?'offline':'unchecked',error.code==='offline'?'连接暂时中断，当前白板和输入仍保留。':'这份设备更新暂时无法完整核对，当前白板和操作步骤仍保留。');return {received:false};
    }
   });
   pending=task;pendingEpoch=snapshot.epoch;task.finally(()=>{if(pending===task)pending=null;}).catch(()=>{});return task;
  }
  function schedule(delay=4000){clearTimeout(timer);if(stopped||!enabled)return;timer=setTimeout(async()=>{await receive();schedule();},delay);}
  document.addEventListener('compositionstart',()=>{composing=true;},true);document.addEventListener('compositionend',()=>{composing=false;schedule(150);},true);
  document.addEventListener('pointerdown',event=>pointers.add(event.pointerId),true);for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>pointers.delete(event.pointerId),true);
  document.addEventListener('focusout',()=>schedule(150));window.addEventListener('focus',()=>schedule(150));document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(150);});
  window.addEventListener('blur',()=>pointers.clear());
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});window.addEventListener('pageshow',()=>{stopped=false;schedule(150);});
  Object.defineProperty(window,'whiteboardNativeSync',{value:Object.freeze({check:()=>receive(true),get state(){return {mode,message,enabled,pending:!!pending,account,workspace,board:typeof boardId==='string'?boardId:null};}})});
  status('ready');
  schedule(1000);
 }
})();
