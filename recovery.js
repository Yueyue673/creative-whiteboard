// Human-initiated recovery keeps deleted hierarchy and current creative work intact.
(() => {
 'use strict';
 let epoch=0,restoring=false,owner=null;
 const dialog=$('dialog');
 const batches=catalog=>Array.isArray(catalog.trash)?catalog.trash.filter(t=>t&&typeof t.id==='string'&&Array.isArray(t.assetIds)&&Array.isArray(t.folders)):[];
 const active=token=>token===epoch&&dialog.open&&owner?.isConnected;
 const prefix=(path,folder)=>path===folder||path.startsWith(folder+'/');
 const unarchive=item=>{delete item.archived;delete item.archiveBatch;delete item.archivedAt;return item};
 const addFolders=(catalog,paths)=>catalog.folders=[...new Set([...catalog.folders,...paths.filter(path=>typeof path==='string'&&path)])];
 // Native close events may arrive after a new view has reopened the same dialog.
 dialog.addEventListener('close',()=>{if(dialog.open)return;owner=null;dialog.classList.remove('wf-dialog')});

 // A batch stores classification and IDs, never a second copy of the media or words.
 const deleteBefore=deleteExplorer;
 deleteExplorer=async function(kind){
  if(kind!=='asset')return deleteBefore(kind);
  if(explorerBusy)return;
  const picked=assetFolderPick,target=picked?libraryFolderTarget(picked):null,ids=new Set(assetSelected),location=libraryFolderTarget(assetFolder);
  const placements=new Map(assetIndex.assets.filter(a=>ids.has(a.id)&&!a.archived).map(a=>[a.id,libraryFolderIdentity(a.folder)]));
  if(!picked&&!ids.size)return;
  explorerBusy=true;
  try{
   await loadAssets();
   const folder=target?libraryFolderLocation(target):null;
   if(target&&!folder)return toast('原文件夹已移除，请重新选择后再删除');
   if(!target&&[...ids].some(id=>{const item=assetById(id);return !item||item.archived||placements.get(id)!==libraryFolderIdentity(item.folder)}))return toast('选中的内容已被移走，请重新选择后再删除');
   const next=clone(assetIndex),removed=next.assets.filter(a=>!a.archived&&(folder?prefix(a.folder||'',folder):ids.has(a.id)));
   const folders=folder?allAssetFolders().filter(path=>prefix(path,folder)):[];
   if(!removed.length&&!folders.length)return toast('这项内容已移走，请重新选择');
   const ticket={id:uid(),kind:folder?'folder':'items',title:folder?folder.split('/').at(-1):removed[0].title,folder:folder||libraryFolderLocation(location),folders,folderIds:Object.fromEntries(folders.map(path=>[path,next.folderIds?.[path]])),assetIds:removed.map(a=>a.id),savedAt:Date.now()/1000};
   for(const item of removed){item.archived=true;item.archiveBatch=ticket.id;item.archivedAt=ticket.savedAt}
   next.folders=next.folders.filter(path=>!folders.includes(path));
   next.trash=[...batches(next),ticket];
   if(await saveAssets(next)){
    // Saving removes only the deleted selection. A new view or selection chosen
    // while the request was in flight is preserved by folder navigation sync.
    toast('已移入回收站 · Ctrl+Z 撤销');
   }
  }catch(e){toast(e.message)}finally{explorerBusy=false}
 };

 function recoveryDialog(body,actions){
  showDialog(body,actions);owner=$('dialogBody').firstElementChild;dialog.classList.add('wf-dialog');
 }
 function historyRow(title,detail,attribute,label='恢复'){
  return '<div class="wf-history-row"><div><b>'+esc(title)+'</b><small>'+esc(detail)+'</small></div><button '+attribute+'>'+label+'</button></div>';
 }
 function restoreAction(button,action){
  button.dataset.recoveryAction='true';
  button.disabled=restoring;
  button.onclick=()=>wfSafe(async()=>{
   if(restoring)return;restoring=true;
   for(const current of dialog.querySelectorAll('[data-recovery-action]'))current.disabled=true;
   try{await action()}finally{
    restoring=false;
    for(const current of dialog.querySelectorAll('[data-recovery-action]'))current.disabled=false;
    if(button.isConnected)button.disabled=false;
   }
  });
 }
 async function restoreLibrary(token,ticketId,assetId){
  await loadAssets();if(!active(token))return;
  const next=clone(assetIndex),ticket=ticketId?batches(next).find(t=>t.id===ticketId):null;
  if(ticketId&&!ticket){toast('这份删除记录已处理');return loadTab('trash')}
  const ids=ticket?new Set(ticket.assetIds):new Set([assetId]);
  const removed=next.assets.filter(a=>ids.has(a.id)&&a.archived&&(!ticket||a.archiveBatch===ticket.id));
  if(!ticket&&!removed.length){toast('这项内容已经恢复或移走');return loadTab('trash')}
  removed.forEach(unarchive);
  addFolders(next,[...(ticket?.folders||[]),...removed.map(a=>a.folder)]);
  for(const [path,id] of Object.entries(ticket?.folderIds||{}))if(id&&!next.folderIds?.[path])next.folderIds={...next.folderIds,[path]:id};
  if(ticket)next.trash=batches(next).filter(t=>t.id!==ticket.id);
  if(await saveAssets(next)){
   toast(ticket?.kind==='folder'?'已恢复文件夹和其中的内容':'已恢复到内容库');
   if(active(token))await loadTab('trash');
  }
 }
 async function loadTrash(token){
  await loadAssets();if(!active(token))return;
  const tickets=await(await api('/api/trash')).json();if(!active(token))return;
  const library=batches(assetIndex).slice().sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
  const grouped=new Set(library.flatMap(t=>t.assetIds.filter(id=>assetById(id)?.archived&&assetById(id).archiveBatch===t.id))),legacy=assetIndex.assets.filter(a=>a.archived&&!grouped.has(a.id));
  $('wfRecoveryInfo').textContent='一次删除的文件夹和内容可以一起恢复。媒体仍引用原文件，不增加一份拷贝。';
  $('wfRecoveryList').innerHTML=tickets.map((t,i)=>historyRow(t.names.join('、')||t.folders.join('、')||'已删除文件夹','白板 · '+wfDate(t.savedAt),'data-ticket="'+i+'"')).join('')+
   library.map((t,i)=>historyRow(t.title||'已删除内容',(t.kind==='folder'?'文件夹 · ':'内容库 · ')+t.assetIds.filter(id=>assetById(id)?.archived&&assetById(id).archiveBatch===t.id).length+' 项 · '+(t.folder||'根目录')+' · '+wfDate(t.savedAt),'data-trash-batch="'+i+'"')).join('')+
   legacy.map(a=>historyRow(a.title,'内容库 · '+(a.folder||'根目录'),'data-archived="'+esc(a.id)+'"','恢复到库')).join('')||'<p class="wf-empty">回收站是空的。</p>';
  for(const button of $('wfRecoveryList').querySelectorAll('[data-ticket]'))restoreAction(button,async()=>{
   await api('/api/trash/'+tickets[Number(button.dataset.ticket)].id,{method:'PUT'});
   await loadFolders();await listBoards();toast('已恢复白板');if(active(token))await loadTab('trash');
  });
  for(const button of $('wfRecoveryList').querySelectorAll('[data-trash-batch]'))restoreAction(button,()=>restoreLibrary(token,library[Number(button.dataset.trashBatch)].id));
  for(const button of $('wfRecoveryList').querySelectorAll('[data-archived]'))restoreAction(button,()=>restoreLibrary(token,null,button.dataset.archived));
 }
 async function loadTab(tab){
  const token=++epoch,target=boardId,kind=tab==='board'?'boards':'library',key=tab==='board'?target:'catalog';
  if(!$('wfRecoveryList'))return;
  for(const button of $('dialogBody').querySelectorAll('[data-recovery-tab]')){
   const selected=button.dataset.recoveryTab===tab;
   button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  }
  $('wfCheckpoint').hidden=tab==='trash';$('wfCheckpoint').disabled=false;
  $('wfCheckpoint').textContent=tab==='library'?'保存内容库恢复点':'保存白板恢复点';
  $('wfRecoveryList').setAttribute('aria-busy','true');$('wfRecoveryList').textContent='正在读取…';
  $('wfRecoveryInfo').textContent='';
  $('wfCheckpoint').onclick=()=>wfSafe(async()=>{
   const button=$('wfCheckpoint');button.disabled=true;
   try{
    await api(tab==='library'?'/api/checkpoints/library/catalog':'/api/checkpoints/'+target,{method:'PUT'});
    toast(tab==='library'?'已保存内容库恢复点':'已保存白板恢复点');
    if(active(token))await loadTab(tab);
   }finally{if(button.isConnected)button.disabled=false}
  });
  try{
   if(tab==='trash'){await loadTrash(token);return}
   const rows=await(await api('/api/history/'+kind+'/'+key)).json();if(!active(token))return;
   $('wfRecoveryInfo').textContent='自动保存修改前的版本，也可以手动留一个恢复点。取回时先查看内容；旧版本可以另存，不覆盖现在写的。';
   $('wfRecoveryList').innerHTML=rows.map((r,i)=>historyRow(wfDate(r.savedAt),r.count+' '+(tab==='board'?'块内容':'项库中内容'),'data-revision="'+i+'"','查看并取回')).join('')||'<p class="wf-empty">还没有历史记录。可以先保存一个恢复点。</p>';
   for(const button of $('wfRecoveryList').querySelectorAll('[data-revision]'))button.onclick=()=>wfSafe(()=>wfOpenRevision(kind,key,rows[Number(button.dataset.revision)]));
  }catch(e){if(active(token)){$('wfRecoveryList').textContent='读取失败：'+e.message;toast(e.message)}}
  finally{if(active(token))$('wfRecoveryList').setAttribute('aria-busy','false')}
 }
 wfRecovery=async function(tab='board'){
  const token=++epoch;if(!await persist()||token!==epoch)return;
  recoveryDialog('<h2>恢复与历史记录</h2><div class="wf-toolbar recovery-toolbar"><div role="tablist" aria-label="恢复范围"><button role="tab" data-recovery-tab="board">当前白板</button><button role="tab" data-recovery-tab="library">内容库历史</button><button role="tab" data-recovery-tab="trash">回收站</button></div><button id="wfCheckpoint">保存一个恢复点</button></div><p id="wfRecoveryInfo" class="wf-explain"></p><div id="wfRecoveryList" class="wf-list" role="tabpanel">正在读取…</div>',[['关闭',()=>dialog.close()]]);
  const tabs=[...$('dialogBody').querySelectorAll('[data-recovery-tab]')];
  tabs.forEach((button,i)=>{
   button.onclick=()=>wfSafe(()=>loadTab(button.dataset.recoveryTab));
   button.onkeydown=e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].focus();tabs[next].click();
   };
  });
  await loadTab(tab);
 };

 function chosenRevision(ids,value){return value.assets.filter(a=>ids.has(a.id)).map(a=>unarchive(clone(a)))}
 async function recoverLibraryCopy(token,ids,value){
  if(!ids.size)return toast('先勾选内容');
  await loadAssets();if(!active(token))return;
  const next=clone(assetIndex);
  for(const original of chosenRevision(ids,value)){
   original.id=uid();original.title=(original.title||'未命名内容')+' · 恢复副本';original.updated=Date.now();
   next.assets.push(original);addFolders(next,[original.folder]);
  }
  if(await saveAssets(next)){dialog.close();toast('已另存所选旧内容，当前版本保留')}
 }
 async function recoverLibraryReview(token,ids,value){
  if(!ids.size)return toast('先勾选内容');
  await loadAssets();if(!active(token))return;
  const changes=chosenRevision(ids,value).map(old=>({field:old.id,label:old.title,before:clone(assetById(old.id)??null),after:old}));
  const baseline=assetETag;
  wfReview('确认要恢复的库中内容','这里会更新勾选项的当前版本。只想保留一份旧内容时，可以返回历史记录，选择另存。',changes,async chosen=>{
   await loadAssets();if(!active(token))return false;if(assetETag!==baseline)return toast('内容库已变化，请重新比较'),false;
   const next=clone(assetIndex);
   for(const c of chosen){next.assets=next.assets.filter(a=>a.id!==c.field);next.assets.push(clone(c.after));addFolders(next,[c.after.folder])}
   return saveAssets(next);
  });
  owner=$('dialogBody').firstElementChild;
 }
 function libraryRevision(token,revision){
  const value=revision.value,ids=new Set();
  recoveryDialog('<h2>从内容库历史中取回</h2><p class="wf-explain">'+wfDate(revision.savedAt)+'。勾选旧内容后，可以另存为副本；需要替换当前版本时，再查看差异。</p><input id="wfRevisionSearch" placeholder="搜索这份记录"><p id="wfRevisionCount" class="wf-explain"></p><div id="wfRevisionItems" class="wf-list"></div>',[['返回',()=>wfSafe(()=>wfRecovery('library'))],['另存勾选内容',()=>wfSafe(()=>recoverLibraryCopy(token,ids,value))],['比较并恢复',()=>wfSafe(()=>recoverLibraryReview(token,ids,value))]]);
  function draw(){
   const q=$('wfRevisionSearch').value.toLowerCase();
   const items=value.assets.filter(a=>!a.archived&&(!q||wfLibraryText(a).toLowerCase().includes(q)));
   $('wfRevisionItems').innerHTML=items.map(a=>'<label class="wf-history-row"><input type="checkbox" value="'+esc(a.id)+'"'+(ids.has(a.id)?' checked':'')+'><div><b>'+esc(a.title)+'</b><small>'+esc(a.folder||'根目录')+'</small><small>'+esc(wfLibraryText(a).slice(0,160))+'</small></div></label>').join('')||'<p class="wf-empty">没有匹配的内容。</p>';
   for(const input of $('wfRevisionItems').querySelectorAll('input'))input.onchange=()=>{input.checked?ids.add(input.value):ids.delete(input.value);count()};
   count();
  }
  function count(){$('wfRevisionCount').textContent=ids.size?'已选 '+ids.size+' 项（搜索后仍保留所选项）':'先勾选要取回的内容'}
  $('wfRevisionSearch').oninput=draw;draw();
  const actions=$('dialogActions').querySelectorAll('button');
  restoreAction(actions[1],()=>recoverLibraryCopy(token,ids,value));
  restoreAction(actions[2],()=>recoverLibraryReview(token,ids,value));
 }
 function boardRevision(key,revision){
  const value=revision.value;
  recoveryDialog('<h2>'+esc(value.name)+' · '+wfDate(revision.savedAt)+'</h2><p class="wf-explain">把勾选内容添加回当前白板，或者把整份记录另存为白板。现在的内容不会被覆盖。</p><div class="wf-list">'+value.nodes.map(n=>'<label class="wf-history-row"><input type="checkbox" data-recover-node="'+esc(n.id)+'"><div><b>'+esc(n.title||'未命名内容')+'</b><small>'+esc((n.body||n.userText||'').slice(0,160))+'</small></div></label>').join('')+'</div>',[['返回',()=>wfSafe(()=>wfRecovery('board'))],['添加勾选内容',()=>{
   if(boardId!==key)return toast('当前白板已切换，请重新打开历史记录');
   const ids=new Set([...$('dialogBody').querySelectorAll('[data-recover-node]:checked')].map(e=>e.dataset.recoverNode));
   if(!ids.size)return toast('先勾选内容');
   const bundle=subsetBundle({bundle:{nodes:value.nodes,edges:value.edges}},ids);dialog.close();insertBundle(bundle);toast('已取回所选内容 · Ctrl+Z 撤销');
  }],['整份记录另存为白板',()=>wfSafe(async()=>{
   const id=uid(),restored=clone(value);restored.name=value.name+' · 恢复 '+new Date(revision.savedAt*1000).toLocaleDateString('zh-CN');
   if(!folderData.folders.some(f=>f.id===restored.folder))restored.folder='';
   await api('/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(restored)});
   dialog.close();await loadBoard(id);toast('已另存恢复版本，原白板保留');
  })]]);
 }
 wfOpenRevision=async function(kind,key,row){
  const token=++epoch,revision=await(await api('/api/history/'+kind+'/'+key+'/'+row.id)).json();
  if(!active(token))return;
  if(kind==='library')libraryRevision(token,revision);else boardRevision(key,revision);
 };
})();
