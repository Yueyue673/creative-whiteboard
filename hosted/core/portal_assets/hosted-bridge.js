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
 async function trashRows(rows){const result=[];for(const row of rows){const id=await ticket(row.id,row.etag);trash.set(id,{key:row.id,etag:row.etag});result.push({...row,id,names:[row.name],folders:[]});}return result;}
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
 Object.defineProperty(window,'whiteboardHosted',{value:Object.freeze({...original,mediaURL,previewURL,get paused(){return paused;}})});
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return rawFetch(input,options);
  if(paused)return new Response(JSON.stringify({error:'原账号或权限已改变，原输入仍保留',code:'account_changed',preserveDraft:true}),{status:409,headers:{'Content-Type':'application/json'}});
  const suffix=url.pathname.slice(5);
  let mapped=suffix==='assets'?'native/assets':suffix==='search'?'native/search':/^history\//.test(suffix)?'native/'+suffix:suffix;
  if(suffix.startsWith('checkpoints/'))mapped='native/checkpoints/'+(suffix.startsWith('checkpoints/library/')?suffix.slice(12):'board/'+suffix.slice(12));
  url.pathname=base+mapped;
  const headers=new Headers(options.headers||{});headers.set('X-Creative-Account',String(account));
  let method=(options.method||'GET').toUpperCase();if(!['GET','HEAD'].includes(method))headers.set('X-CSRFToken',decodeURIComponent(csrf()));
  let restored=null;
  if(method==='PUT'&&/^trash\/[a-f0-9]{32}$/.test(suffix)){
   const id=suffix.slice(6);
   if(!trash.has(id)){
    const r=await rawFetch(base+'trash',{headers:{'X-Creative-Account':String(account)},credentials:'same-origin',cache:'no-store',redirect:'error'});
    if(!r.ok)return r;await trashRows(await r.json());
   }
   restored=trash.get(id);if(!restored)return new Response(JSON.stringify({error:'原删除记录已改变，请重新核对回收站'}),{status:409,headers:{'Content-Type':'application/json'}});
   url.pathname=base+'boards/'+encodeURIComponent(restored.key)+'/restore';method='POST';headers.set('If-Match',restored.etag);
  }
  const response=await rawFetch(url,{...options,method,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(response.status===401)freeze('原登录已经失效。');
  if(response.status===409){const value=await response.clone().json().catch(()=>({}));if(value.code==='account_changed')freeze('登录账号已经改变。');}
  if(response.ok&&method==='GET'&&suffix==='trash')return jsonResponse(await trashRows(await response.json()),response);
  if(response.ok&&method==='DELETE'&&/^boards\/[^/]+$/.test(suffix)){
   const key=suffix.slice(7),etag=response.headers.get('ETag'),id=await ticket(key,etag);trash.set(id,{key,etag});return jsonResponse({ids:[key],ticket:id,folders:[]},response);
  }
  if(response.ok&&restored)return jsonResponse({ids:[restored.key],ticket:suffix.slice(6),folders:[]},response);
  if(response.ok&&/^history\//.test(suffix)){
   const value=await response.json();if(Array.isArray(value))return jsonResponse(value.map(row=>({...row,count:row.count??0})),response);return jsonResponse(value,response);
  }
  return response;
 };
 async function check(){if(paused)return;try{const response=await rawFetch('/api/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});if(response.ok&&(await response.json()).account?.id!==account)freeze('登录账号已经改变。');}catch{/* An interrupted connection does not establish logout. */}}
 window.addEventListener('focus',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});window.addEventListener('pageshow',e=>{if(e.persisted)check();});
 window.addEventListener('message',event=>{if(event.data?.type==='creative-static-preview-close'&&event.source===document.getElementById('htmlDocument')?.contentWindow)document.getElementById('dialog')?.close();});
 try{const channel=new BroadcastChannel('creative-account-session');channel.onmessage=event=>{if(event.data?.type==='changed')check();};}catch{}
 document.addEventListener('DOMContentLoaded',()=>{
  const menu=document.querySelector('#shellMore>div');if(menu){for(const [text,path]of [['账号、工作区与成员',`/w/${workspace}/manage/`],['切换工作区','/spaces']]){const button=document.createElement('button');button.textContent=text;button.onclick=()=>location.assign(path);menu.append(button);}}
  if(original.role==='viewer'){
   const status=document.getElementById('shellStatus');if(status)status.title='这个工作区只有阅读权限，服务器不会接受编辑';
   document.documentElement.dataset.hostedRole='viewer';
  }
 });
})();
