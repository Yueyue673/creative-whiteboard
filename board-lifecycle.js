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
 const copyScope=(host=window.whiteboardHosted)=>{host=host||null;return {host,key:host?JSON.stringify([host.account?.id,host.workspace,host.base]):''}};
 const sameCopyScope=saved=>saved.host===(window.whiteboardHosted||null)&&saved.key===copyScope().key&&!window.whiteboardHosted?.paused;
 const copySignature=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

 if(!shell){
  let held=0,inertBefore=false,coordinated=false,deleted=null;
  const copyAttempts=new WeakMap();let materializing=false;
  function copyNotice(){const button=$('deletedCopy'),status=$('deletedCopyState'),attempt=board&&copyAttempts.get(board);if(button){button.textContent=attempt?.changed?'另存结果需要核对':attempt?.confirmed?(contentRevision===attempt.revision?'打开已另存副本':'另存当前新修改'):attempt?'核对这次另存':'另存当前内容';button.disabled=materializing||!!attempt?.changed}if(status)status.textContent=attempt?.changed?'这次另存已有变化，未覆盖，当前草稿仍保留。请从白板列表核对。':attempt?.confirmed?(contentRevision===attempt.revision?'此前另存已确认；原稿仍保留，可打开已另存副本。':'此前另存已确认；后来新写的内容仍保留，可另存当前新修改。'):attempt?'本次另存尚未确认；核对只读取同一次结果，不重新创建。':''}
  const ownsCopy=attempt=>board===attempt.source&&boardId===attempt.board&&!loading&&sameCopyScope(attempt.scope);
  const persistBefore=persist,loadBefore=loadBoard,changeBefore=change;
  function freeze(on){
   if(on){if(!held++){inertBefore=document.body.inert;document.body.inert=true}clearTimeout(saveTimer)}
   else if(held&&!--held)document.body.inert=inertBefore;
  }
  function deletedNotice(){
   if(!deleted)return;
   $('notice').hidden=false;
   const draft=dirtyWork({contentDirty,savingContent,blocked:deleted.hadConflict,saveError});
   $('notice').innerHTML='<div>'+(deleted.restored?'这张白板已恢复。当前窗口的草稿仍保留，请选择另存或查看恢复版本。':draft?'这张白板已在另一处删除。你的未保存内容仍在本窗口，请先另存。':'这张白板已移入回收站。可以恢复原件，或将当前内容另存。')+'</div><button id="deletedCopy">另存当前内容</button><button id="deletedRestore">'+(deleted.restored?'查看恢复的白板':'恢复原白板')+'</button><span id="deletedCopyState" role="status" style="display:block;margin-top:6px"></span>';
   copyNotice();
   $('deletedCopy').onclick=()=>wfSafe(()=>controller().copy(boardId,window.whiteboardBoardDocument));
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
  loadBoard=async function(id,options){
   const loaded=await loadBefore(id,options);
   if(boardId===id&&!loading&&!blocked){deleted=null;changed()}
   return loaded;
  };
  async function materialize(){
   if(materializing)throw Error('正在处理这次另存，请稍候');if(!board||loading)throw Error('原稿尚未准备好，请稍后再另存。');
   const context={source:board,board:boardId,scope:copyScope()};let attempt=copyAttempts.get(board);if(attempt&&!ownsCopy(attempt))throw Error('这次另存所属位置已变化，原稿保留，请先核对账号和工作区。');
   if(attempt?.confirmed&&contentRevision!==attempt.revision)attempt=null;
   materializing=true;freeze(true);copyNotice();
   try{
    if(!ownsCopy(context))throw Error('原稿所属位置已变化，另存已停止。');
    if(window.whiteboardHosted&&!await window.whiteboardHosted.checkIdentity())throw Error('原账号或工作区尚未确认，原稿保留。');if(!ownsCopy(context))throw Error('原稿所属位置已变化，另存已停止。');
    if(attempt){
     if(attempt.changed)throw Error('这次另存已有变化，未覆盖，当前草稿仍保留。请从白板列表核对。');
     let saved;try{saved=(await request('/api/boards/'+attempt.id,{cache:'no-store'})).value}catch(error){if(error.code===404)throw Error('暂时没有找到这次另存。请稍后再核对；原稿仍保留，本次没有重复提交。');throw error}
     if(!ownsCopy(context))throw Error('原稿所属位置已变化，核对已停止。');
     if(copySignature(saved)!==attempt.signature){attempt.changed=true;throw Error('这次另存已有变化，未覆盖，当前草稿仍保留。请从白板列表核对。')}
    }else{
     await window.whiteboardImports?.idle();if(!ownsCopy(context))throw Error('原稿所属位置已变化，另存已停止。');
     const folders=(await request('/api/folders')).value.folders;if(!ownsCopy(context))throw Error('原稿所属位置已变化，另存已停止。');
     const value=clone(board),revision=contentRevision,id=uid();value.name+='（另存）';if(value.folder&&!folders.some(f=>f.id===value.folder))value.folder='';
     attempt={...context,id,value,revision,signature:copySignature(value)};copyAttempts.set(context.source,attempt);copyNotice();
     await request('/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)});if(!ownsCopy(context))throw Error('原稿所属位置已变化，请保留原稿并核对这次另存。');
    }
    attempt.confirmed=true;return {id:attempt.id,name:attempt.value.name,folder:attempt.value.folder||'',count:attempt.value.nodes.length,revision:attempt.revision};
   }catch(error){if(attempt&&!attempt.changed&&!error.message.includes('本次没有重复提交'))throw Error('本次另存尚未确认，可核对这次另存。原稿仍保留。 '+(error.message==='Failed to fetch'?'连接暂时中断。':error.message));throw error}
   finally{materializing=false;freeze(false);copyNotice()}
  }
  window.whiteboardBoardDocument={
   freeze,markDeleted,restored,materialize,
   flush:async()=>{coordinated=true;try{return window.whiteboardImports?await whiteboardImports.flush(persistBefore):await persistBefore()}finally{coordinated=false}},
   detach:()=>{clearTimeout(saveTimer);if(typeof captureReading==='function')captureReading()},
   state:()=>({boardId,dirty,contentDirty,savingContent,blocked,saveError,deleted:!!deleted,loading,revision:contentRevision})
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
 function removeTabs(ids,ticket,onlyTab){
  const old=model.tabs.slice(),removed=old.filter(t=>ids.includes(t.boardId)&&(!onlyTab||t===onlyTab)),activeBefore={...model.active},sideBefore=model.side;
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
  async copy(id,requestedDocument){
   const scope=copyScope();
   if(shell){
    const tab=model.tabs.find(t=>t.boardId===id&&(!requestedDocument||documentView(t)===requestedDocument)),frame=tab&&frames.get(tab.id),doc=tab&&documentView(tab),side=tab?.side;if(!doc||doc.state().boardId!==id)return;
    const writerScope=copyScope(frame.contentWindow.whiteboardHosted),writerOwns=()=>writerScope.host===(frame.contentWindow.whiteboardHosted||null)&&writerScope.key===copyScope(frame.contentWindow.whiteboardHosted).key&&!frame.contentWindow.whiteboardHosted?.paused;
    if(!sameCopyScope(scope)||writerScope.key!==scope.key||!writerOwns())return toast('当前白板的账号或工作区尚未对应，原稿保留，请先核对。');
    const copy=await doc.materialize();if(!sameCopyScope(scope)||!writerOwns())return;announce('created',{ids:[copy.id]});if(!boards.some(row=>row.id===copy.id))boards.push(copy);
    const retained=!model.tabs.includes(tab)||frames.get(tab.id)!==frame||documentView(tab)!==doc||current()!==tab||tab.side!==side||doc.state().boardId!==id||doc.state().revision!==copy.revision;
    if(!retained){removeTabs([id],undefined,tab);openBoard(copy.id,side)}
    try{await refresh()}catch(e){toast('另存已确认，列表暂时未能刷新：'+e.message);return}
    toast(retained?'此前另存已确认。当前标签和后来新写的内容仍保留，可从白板列表打开另存。':'已另存当前内容，原件的删除或恢复状态保留');
   }else{
    if(boardId!==id)return;const source=board,copy=await whiteboardBoardDocument.materialize();if(!sameCopyScope(scope))return;announce('created',{ids:[copy.id]});
    if(board!==source||boardId!==id||contentRevision!==copy.revision){toast('此前另存已确认，后来新写的内容仍保留，可从白板列表打开另存。');return}
    if(await loadBoard(copy.id,{discardCurrent:true,expectedRevision:copy.revision}))toast('已另存当前内容');
   }
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
