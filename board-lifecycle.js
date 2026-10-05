// Deleting a board coordinates its open views without merging or discarding drafts.
(() => {
 'use strict';
 const shell=!!$('shellHeader'),embedded=!shell&&parent!==window&&new URLSearchParams(location.search).get('pane')==='1';
 const explorer=embedded&&new URLSearchParams(location.search).get('explorer')==='1';
 const ownerId=uid(),remembered=new Map();let busy=false,queue=Promise.resolve();
 async function request(path,options={}){
  const response=await fetch(path,options),value=await response.json().catch(()=>({}));
  if(!response.ok){const error=Error(value.error||'操作未完成，请重试');error.code=response.status;throw error}
  return {value,etag:response.headers.get('ETag')};
 }
 function controller(){return embedded?parent.whiteboardBoardLifecycle:window.whiteboardBoardLifecycle}
 const changed=()=>{if(shell)updateStatus();else window.whiteboardPane?.state()};
 const dirtyWork=state=>state?.contentDirty||state?.savingContent||state?.blocked||state?.saveError;

 if(!shell){
  let held=0,inertBefore=false,coordinated=false,deleted=null;
  const persistBefore=persist,loadBefore=loadBoard,changeBefore=change;
  function freeze(on){
   if(on){if(!held++){inertBefore=document.body.inert;document.body.inert=true}clearTimeout(saveTimer)}
   else if(held&&!--held)document.body.inert=inertBefore;
  }
  function deletedNotice(){
   if(!deleted)return;
   $('notice').hidden=false;
   const draft=dirtyWork({contentDirty,savingContent,blocked:deleted.hadConflict,saveError});
   $('notice').innerHTML='<div>'+(deleted.restored?'这张白板已恢复。当前窗口的草稿仍保留，请选择另存或查看恢复版本。':draft?'这张白板已在另一处删除。你的未保存内容仍在本窗口，请先另存。':'这张白板已移入回收站。可以恢复原件，或将当前内容另存。')+'</div><button id="deletedCopy">另存当前内容</button><button id="deletedRestore">'+(deleted.restored?'查看恢复的白板':'恢复原白板')+'</button>';
   $('deletedCopy').onclick=()=>wfSafe(()=>controller().copy(boardId));
   $('deletedRestore').onclick=()=>wfSafe(async()=>{
    if(deleted.restored)return dirty?confirmReload():loadBoard(boardId);
    await controller().restore(deleted.ticket);
   });
   $('status').textContent=deleted.restored?'已恢复 · 当前草稿保留':'白板已删除 · 当前内容保留';
  }
  function markDeleted(value){
   if(!value.ids.includes(boardId))return;
   deleted={ticket:value.ticket,restored:false,hadConflict:blocked};
   clearTimeout(saveTimer);blocked=true;deletedNotice();changed();
  }
  async function restored(value){
   if(!deleted||!value.ids.includes(boardId))return;
   deleted.restored=true;
   if(contentDirty||savingContent||deleted.hadConflict||saveError){deletedNotice();return}
   try{await loadBoard(boardId)}catch(e){deletedNotice();toast('原白板已恢复，暂时未能读取：'+e.message)}
  }
  persist=async function(){
   if(deleted){deletedNotice();return !dirty}
   if(held&&!coordinated)return !dirty;
   const result=await persistBefore();if(deleted)deletedNotice();return result;
  };
  change=function(...args){changeBefore(...args);if(deleted){clearTimeout(saveTimer);deletedNotice()}};
  loadBoard=async function(id){
   await loadBefore(id);
   if(boardId===id&&!loading&&!blocked){deleted=null;changed()}
  };
  async function materialize(){
   freeze(true);
   try{
    const value=clone(board),folders=(await request('/api/folders')).value.folders,id=uid();
    value.name+='（另存）';if(value.folder&&!folders.some(f=>f.id===value.folder))value.folder='';
    await request('/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)});
    return {id,name:value.name,folder:value.folder||'',count:value.nodes.length};
   }finally{freeze(false)}
  }
  window.whiteboardBoardDocument={
   freeze,markDeleted,restored,materialize,
   flush:async()=>{coordinated=true;try{await window.whiteboardImports?.idle();return await persistBefore()}finally{coordinated=false}},
   detach:()=>{clearTimeout(saveTimer);if(typeof captureReading==='function')captureReading()},
   state:()=>({boardId,dirty,contentDirty,savingContent,blocked,saveError,deleted:!!deleted,loading})
  };
  if(window.whiteboardPane){const stateBefore=whiteboardPane.state;whiteboardPane.state=()=>({...stateBefore(),deleted:!!deleted,restored:!!deleted?.restored})}
 }
 function documentView(tab){return frames.get(tab.id)?.contentWindow.whiteboardBoardDocument}
 async function refresh(){
  if(shell){boards=(await request('/api/boards')).value;await window.whiteboardWorkspace?.explorer()?.refresh()}
  else{await loadFolders();await listBoards()}
 }
 async function affected(entry){
  if(entry.type==='board')return [entry.id];
  const [catalog,list]=await Promise.all([request('/api/folders'),request('/api/boards')]);
  const ids=new Set([entry.id]);let previous;
  do{previous=ids.size;catalog.value.folders.filter(f=>ids.has(f.parent)).forEach(f=>ids.add(f.id))}while(previous!==ids.size);
  return list.value.filter(b=>ids.has(b.folder)).map(b=>b.id);
 }
 function removeTabs(ids,ticket){
  const old=model.tabs.slice(),removed=old.filter(t=>ids.includes(t.boardId)),activeBefore={...model.active},sideBefore=model.side;
  if(!removed.length)return;
  for(const tab of removed){documentView(tab)?.detach();frames.get(tab.id)?.remove();frames.delete(tab.id)}
  model.tabs=old.filter(t=>!removed.includes(t));
  for(const side of ['left','right'])if(removed.some(t=>t.id===model.active[side])){
   const index=old.findIndex(t=>t.id===model.active[side]);
   model.active[side]=old.slice(0,index).reverse().find(t=>t.side===side&&!removed.includes(t))?.id||model.tabs.find(t=>t.side===side)?.id||null;
  }
  if(!current()){const other=model.side==='left'?'right':'left';if(current(other))model.side=other}
  if(ticket)remembered.set(ticket,{tabs:removed.map(t=>({...t,index:old.indexOf(t)})),activeBefore,activeAfter:{...model.active},sideBefore,sideAfter:model.side});
  renderTabs();window.whiteboardWorkspace?.sync();
 }
 async function onDeleted(value,local=false){
  if(local&&shell)boards=boards.filter(b=>!value.ids.includes(b.id));
  if(!local)await refresh();
  if(shell){
   const ids=value.ids.filter(id=>!boards.some(b=>b.id===id)),clean=[];let drafts=0;
   for(const tab of model.tabs.filter(t=>ids.includes(t.boardId))){
    const state=pane(tab)?.state();
    if(!local&&dirtyWork(state)){documentView(tab)?.markDeleted(value);drafts++}
    else clean.push(tab.boardId);
   }
   removeTabs(clean,value.ticket);updateStatus();
   if(drafts)toast('白板已在另一处删除，未保存内容保留在原标签中。');
  }else if(value.ids.includes(boardId)){
   if(local)whiteboardBoardDocument.markDeleted(value);
   else try{await request('/api/boards/'+boardId)}catch(e){if(e.code===404)whiteboardBoardDocument.markDeleted(value);else throw e}
  }
  if(local)try{await refresh()}catch(e){toast('已移入回收站，列表暂时未能刷新：'+e.message)}
 }
 async function onRestored(value,local=false){
  if(local&&shell&&Array.isArray(value.boards)){
   const ids=new Set(value.boards.map(b=>b.id));boards=[...boards.filter(b=>!ids.has(b.id)),...value.boards];
  }
  try{await refresh()}catch(e){if(!local)throw e;toast('已恢复，列表暂时未能刷新：'+e.message)}
  if(shell){
   for(const tab of model.tabs.filter(t=>value.ids.includes(t.boardId)))await documentView(tab)?.restored(value);
   const saved=remembered.get(value.ticket);
   if(saved){
    for(const tab of saved.tabs.slice().sort((a,b)=>a.index-b.index))if(boards.some(b=>b.id===tab.boardId)&&!model.tabs.some(t=>t.boardId===tab.boardId)){
     const {index,...restored}=tab;model.tabs.splice(Math.min(index,model.tabs.length),0,restored);
    }
    for(const side of ['left','right'])if(!model.active[side]||model.active[side]===saved.activeAfter[side]){
     if(model.tabs.some(t=>t.id===saved.activeBefore[side]))model.active[side]=saved.activeBefore[side];
    }
    if(model.side===saved.sideAfter&&model.active[saved.sideBefore]===saved.activeBefore[saved.sideBefore])model.side=saved.sideBefore;
    remembered.delete(value.ticket);renderTabs();
   }
   updateStatus();window.whiteboardWorkspace?.sync();
  }else await whiteboardBoardDocument.restored(value);
 }
 const channel=!embedded&&typeof BroadcastChannel==='function'?new BroadcastChannel('creative-board-lifecycle'):null;
 function announce(type,value){channel?.postMessage({type,ownerId,...value})}
 channel?.addEventListener('message',e=>{
  const value=e.data;
  if(!value||value.ownerId===ownerId||!['deleted','restored','created'].includes(value.type)||!Array.isArray(value.ids)||!value.ids.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id))||value.type!=='created'&&!/^[a-f0-9]{32}$/.test(value.ticket))return;
  queue=queue.then(()=>value.type==='deleted'?onDeleted(value):value.type==='restored'?onRestored(value):refresh()).catch(e=>toast(e.message));
 });
 if(!embedded)window.whiteboardBoardLifecycle={
  async remove(entry){
   if(busy)throw Error('正在处理上一项操作，请稍候');busy=true;
   const held=[],inertBefore=document.body.inert;
   try{
    const ids=await affected(entry);document.body.inert=true;
    if(shell){
     for(const tab of model.tabs.filter(t=>ids.includes(t.boardId))){
      const view=pane(tab),doc=documentView(tab);
      if(frames.has(tab.id)&&(!view||view.state().loading||!doc))throw Error('白板还在打开，请稍后再删除');
      if(doc){doc.freeze(true);held.push(doc)}
     }
     for(const doc of held)if(!await doc.flush())throw Error('白板还有未保存的修改，删除已取消。请先处理保存提示。');
    }else if(ids.includes(boardId)){
     whiteboardBoardDocument.freeze(true);held.push(whiteboardBoardDocument);
     if(!await whiteboardBoardDocument.flush())throw Error('还有未保存的修改，删除已取消。');
    }
    const path='/api/'+(entry.type==='folder'?'folders':'boards'),base=entry.type==='folder'?'/api/folders':path+'/'+entry.id;
    const current=await request(base),result=await request(path+'/'+entry.id,{method:'DELETE',headers:{'If-Match':current.etag}});
    announce('deleted',result.value);await onDeleted(result.value,true);return result.value;
   }finally{held.forEach(doc=>doc.freeze(false));document.body.inert=inertBefore;busy=false}
  },
  async restore(ticket){
   const result=await request('/api/trash/'+ticket,{method:'PUT'});const value={ticket,...result.value};
   announce('restored',value);await onRestored(value,true);return value;
  },
  async restored(value){announce('restored',value);await onRestored(value,true)},
  created(ids){announce('created',{ids})},
  async copy(id){
   if(shell){
    const tab=model.tabs.find(t=>t.boardId===id),doc=tab&&documentView(tab);if(!doc)return;
    const copy=await doc.materialize();announce('created',{ids:[copy.id]});boards.push(copy);removeTabs([id]);openBoard(copy.id,tab.side);
    try{await refresh()}catch(e){toast('副本已保存，列表暂时未能刷新：'+e.message);return}
    toast('已另存当前内容，原件的删除或恢复状态保留');
   }else{const copy=await whiteboardBoardDocument.materialize();announce('created',{ids:[copy.id]});await loadBoard(copy.id);toast('已另存当前内容')}
  }
 };
 if(shell){const createBefore=createBoard;createBoard=async function(...args){const id=await createBefore(...args);announce('created',{ids:[id]});return id}}
 if(!shell){
  const deleteBefore=deleteExplorer,undoBefore=undoExplorer,apiBefore=api;
  deleteExplorer=async function(kind){
   if(kind!=='board')return deleteBefore(kind);
   if(explorerBusy||!boardEntry)return;
   explorerBusy=true;
   try{
    const result=await controller().remove({...boardEntry});explorerUndo.push({kind:'board',ticket:result.ticket});
    boardList=boardList.filter(b=>!result.ids.includes(b.id));folderData.folders=folderData.folders.filter(f=>!(result.folderIds||[]).includes(f.id));renderFolders();
    try{await loadFolders();await listBoards()}catch(e){toast('已移入回收站，列表暂时未能刷新：'+e.message)}
    enterBoardFolder(folderData.folders.some(f=>f.id===folderSelected)?folderSelected:'');
    $('boardContents').focus({preventScroll:true});toast('已移入回收站 · Ctrl+Z 撤销');
   }catch(e){toast(e.message)}finally{explorerBusy=false}
  };
  undoExplorer=async function(){
   if(workspaceTab==='assetPane'||explorerUndo.at(-1)?.kind!=='board')return undoBefore();
   if(explorerBusy)return;explorerBusy=true;
   try{
    const item=explorerUndo.at(-1);await api('/api/trash/'+item.ticket,{method:'PUT'});explorerUndo.pop();
    try{await loadFolders();await listBoards();renderFolders()}catch(e){toast('已恢复，列表暂时未能刷新：'+e.message)}
    toast('已恢复');
   }catch(e){toast(e.message)}finally{explorerBusy=false}
  };
  api=async function(path,options){
   const response=await apiBefore(path,options);
   const match=/^\/api\/trash\/([a-f0-9]{32})$/.exec(path);
   if(match&&options?.method==='PUT'){
    const value={ticket:match[1],...await response.clone().json()};await controller().restored(value);
   }
   const created=/^\/api\/boards\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
   if(created&&options?.method==='PUT'&&options.headers?.['If-Match']==='new')controller().created([created[1]]);
   return response;
  };
 }
})();
