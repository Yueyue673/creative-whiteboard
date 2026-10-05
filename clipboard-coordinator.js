// One clipboard queue belongs to the application window, not to an individual
// canvas frame. Its executor also survives closing the frame that started it.
(() => {
 'use strict';
 try {
  if(parent!==window&&parent.whiteboardClipboardCoordinator){
   window.whiteboardClipboardCoordinator=parent.whiteboardClipboardCoordinator;return;
  }
 } catch {}
 let pending=null;
 const nativeEvents=new WeakSet();
 function write(pack,text=JSON.stringify(pack),{success,error,formats}={}){
  const previous=pending,request={pack,text,cancelled:false,promise:null};pending=request;
  request.promise=(async()=>{
   try{
    if(previous)await previous.promise;
    if(pending!==request||request.cancelled)return false;
    const data=formats?await formats:null;
    if(pending!==request||request.cancelled)return false;
    if(data&&data['text/html']&&navigator.clipboard.write&&window.ClipboardItem){
     request.text=data['text/plain'];
     await navigator.clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(data).map(([type,value])=>[type,new Blob([value],{type})])))]);
    }else await navigator.clipboard.writeText(text);
    if(pending!==request||request.cancelled)return false;
    success?.();return true;
   }catch{if(pending===request&&!request.cancelled)error?.();return false}
   finally{if(pending===request)pending=null}
  })();return request.promise;
 }
 async function payload(text,files){const writing=pending;if(!writing)return {text,files};if(!await writing.promise)return null;return {text:writing.text,files:[]}}
 async function ready(){const writing=pending;return !writing||await writing.promise}
 function nativeText(e){
  if(!e.isTrusted||nativeEvents.has(e))return false;
  nativeEvents.add(e);
  const field=e.target?.closest?.('input,textarea');
  let text,html='';
  if(field){
   if(field.type==='password'||!Number.isInteger(field.selectionStart)||field.selectionStart===field.selectionEnd)return false;
   text=field.value.slice(field.selectionStart,field.selectionEnd);
  }else{
   const selection=e.target?.ownerDocument?.getSelection();
   if(!selection||selection.isCollapsed||!selection.rangeCount)return false;
   text=selection.toString();if(!text)return false;
   const container=e.target.ownerDocument.createElement('div');
   for(let i=0;i<selection.rangeCount;i++)container.append(selection.getRangeAt(i).cloneContents());
   html=container.innerHTML;
  }
  // The browser still performs native copy/cut. Only a pending older write
  // requires a repair. Do not request clipboard-read permission to do this.
  if(pending){
   const formats=html?new Promise(resolve=>setTimeout(async()=>{
    const fallback={'text/plain':text,'text/html':html};
    try{
     const permission=await navigator.permissions.query({name:'clipboard-read'});
     if(permission.state==='granted'){
      const items=await navigator.clipboard.read();
      for(const item of items)if(item.types.includes('text/plain')){
       const copied=await (await item.getType('text/plain')).text();
       if(copied.replace(/\r\n/g,'\n').trimEnd()===text.replace(/\r\n/g,'\n').trimEnd()){
        fallback['text/plain']=copied;
        if(item.types.includes('text/html'))fallback['text/html']=await (await item.getType('text/html')).text();
        break;
       }
      }
     }
    }catch{}
    resolve(fallback);
   },0)):null;
   write(null,text,{formats});
  }
  return true;
 }
 window.whiteboardClipboardCoordinator={write,payload,ready,nativeText,get pending(){return pending}};
 window.addEventListener('copy',nativeText,true);
 window.addEventListener('cut',nativeText,true);
})();
