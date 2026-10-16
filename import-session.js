// File work belongs to the document and attachment target chosen when it starts.
(() => {
 'use strict';
 const explorer = new URLSearchParams(location.search).get('explorer') === '1';
 const tasks = new Map();
 const fileJobs = new Map();
 const libraryFailures = new WeakSet();
 const placements = new Map();
 const libraryUploads = new Map(), libraryShelf = document.createElement('div');
 libraryShelf.className='library-imports';
 let libraryObserver=null;
 function libraryLocation(target) {
  if(!target.path)return '';
  if(target.id)return Object.entries(assetIndex.folderIds || {}).find(([,id])=>id===target.id)?.[0] ?? null;
  return libraryFolderPaths().includes(target.path)?target.path:null;
 }
 function alignLibraryUploads() {
  const list=$('assetList'),query=$('assetSearch')?.value.trim().toLowerCase() || '';
  if(!list)return;
  const shown=[...libraryUploads.values()].filter(value=>libraryLocation(value.target)===assetFolder&&(!query||value.names.toLowerCase().includes(query)));
  for(const value of libraryUploads.values())value.element.hidden=!shown.includes(value);
  if(shown.length){if(libraryShelf.parentElement!==list)list.prepend(libraryShelf);}
  else libraryShelf.remove();
 }
 function beginLibraryUpload(files,folder,key) {
  for(const value of [...libraryUploads.values()])if(value.failed&&value.key===key)value.remove();
  const id=uid(),target=libraryFolderTarget(folder),element=document.createElement('div');
  element.className='library-import-row';element.setAttribute('role','status');element.setAttribute('aria-live','polite');
  const icon=document.createElement('span'),copy=document.createElement('div'),name=document.createElement('b'),stage=document.createElement('small'),reason=document.createElement('p'),close=document.createElement('button');
  icon.className='library-import-symbol';icon.setAttribute('aria-hidden','true');icon.textContent='↑';
  name.textContent=files[0].name+(files.length>1?' 等 '+files.length+' 项':'');
  name.title=files.map(file=>file.name).join('、');stage.textContent='上传中';reason.hidden=close.hidden=true;
  close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭上传提示');
  copy.append(name,stage,reason);element.append(icon,copy,close);libraryShelf.append(element);
  const preview={id,key,target,element,names:name.title,failed:false,error:'',
   visible(){const r=element.getBoundingClientRect(),list=$('assetList').getBoundingClientRect();return element.isConnected&&!element.hidden&&!$('assetPane').hidden&&r.width>0&&r.height>0&&r.bottom>list.top&&r.top<list.bottom;},
   acknowledge(){},phase(){},
   fail(message){this.failed=true;this.error=message;stage.textContent='未完成';reason.textContent=message;reason.hidden=close.hidden=false;element.classList.add('is-failed');},
   remove(){libraryUploads.delete(id);element.remove();if(!libraryUploads.size){libraryShelf.remove();libraryObserver?.disconnect();libraryObserver=null;}},
   complete(){if(!this.failed)this.remove();}
  };
  close.onclick=event=>{event.stopPropagation();preview.remove();if(failurePlacement===preview){failure='';failurePlacement=null;}updateFeedback();};
  libraryUploads.set(id,preview);alignLibraryUploads();
  if(!libraryObserver){libraryObserver=new MutationObserver(()=>updateFeedback());libraryObserver.observe($('assetPane'),{attributes:true,attributeFilter:['hidden']});}
  return preview;
 }
 const renderBeforeUploads=renderAssets;
 renderAssets=function(...args){const result=renderBeforeUploads(...args);if(libraryUploads.size){alignLibraryUploads();updateFeedback();}return result;};
 let placementFrame = 0, placementObserver = null;
 function watchPlacements() {
  if (!placements.size) {placementObserver?.disconnect();placementObserver=null;return;}
  if (placementObserver) return;
  placementObserver=new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.import-placement')))schedulePlacements();});
  for(const host of [$('nodes'),$('dialog')])placementObserver.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['open','style']});
 }
 function positionPlacements() {
  placementFrame = 0;
  for (const placement of placements.values()) placement.align();
  updateFeedback();
 }
 function schedulePlacements() {if (!placementFrame) placementFrame = requestAnimationFrame(positionPlacements);}
 function beginInsertion(items, position, target) {
  if (explorer || !board || loading) return null;
  const existing = placements.get(position?._insertion);
  if (existing?.ownerId === boardId && !existing.failed) return existing;
  const ownerId = boardId, id = uid(), first = items[0] || {};
  const signature=JSON.stringify([ownerId,target?._importDestination || null,items.map(item=>[item.id || '',item.name || item.title || '',item.type || item.mime || '',item.size || 0,item.lastModified || 0]),position?{x:position.x,y:position.y}:null]);
  for(const previous of [...placements.values()])if(previous.failed&&previous.signature===signature)previous.remove();
  const point = {x:Number.isFinite(position?.x) ? position.x : center().x, y:Number.isFinite(position?.y) ? position.y : center().y, _insertion:id};
  const dimensions=items.map(item=>{
   const nodes=item.bundle?.nodes;
   if(nodes?.length)return {w:Math.max(...nodes.map(n=>n.x+n.w))-Math.min(...nodes.map(n=>n.x)),h:Math.max(...nodes.map(n=>n.y+n.h))-Math.min(...nodes.map(n=>n.y))};
   return window.whiteboardExperience?.fileFrame({title:item.name || item.title,mime:item.type || item.mime || ''}) || {w:340,h:200};
  });
  const columns=Math.min(4,Math.ceil(Math.sqrt(dimensions.length||1))),frame={w:0,h:0};let x=0,y=0,rowHeight=0;
  for(const [index,size]of dimensions.entries()){frame.w=Math.max(frame.w,x+size.w);frame.h=Math.max(frame.h,y+size.h);x+=size.w+60;rowHeight=Math.max(rowHeight,size.h);if((index+1)%columns===0){x=0;y+=rowHeight+70;rowHeight=0;}}
  if(!dimensions.length)Object.assign(frame,{w:340,h:200});
  if (!position && !target) {
   for (let i = 0; i <= board.nodes.length + placements.size; i++) {
    const occupied = [...board.nodes, ...[...placements.values()].filter(value => !value.target).map(value => ({...value.point,...value.frame}))];
    const hits = occupied.filter(n => n.x < point.x + frame.w && n.x + n.w > point.x && n.y < point.y + frame.h && n.y + n.h > point.y);
    if (!hits.length) break;
    point.y = Math.max(...hits.map(n => n.y + n.h)) + 70;
   }
  }
  const element = document.createElement('div');element.className = 'import-placement inline-ui';element.dataset.insertion = id;
  const copy=document.createElement('div');copy.className='import-placement-copy';
  const symbol = document.createElement('span'), name = document.createElement('strong'), stage = document.createElement('span'), reason = document.createElement('p'), close = document.createElement('button');
  symbol.className = 'import-placement-symbol';symbol.setAttribute('aria-hidden','true');symbol.innerHTML = '<svg viewBox="0 0 40 32" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="1" width="38" height="30" rx="4"/><circle cx="12" cy="10" r="3"/><path d="m3 26 10-9 7 6 7-11 11 14"/></svg>';
  name.className = 'import-placement-name';name.textContent = first.name || first.title || '新内容';name.title = items.map(item => item.name || item.title || '新内容').join('、');
  if (items.length > 1) name.textContent += ' 等 ' + items.length + ' 项';
  stage.className = 'import-placement-stage';stage.textContent = '上传中';reason.hidden = close.hidden = true;
  close.type = 'button';close.textContent = '×';close.setAttribute('aria-label','关闭失败提示');
  copy.append(symbol,name,stage,reason,close);element.append(copy);$('world').append(element);
  function fitCopy(clip) {
   const rect=element.getBoundingClientRect(),scale=rect.width/element.offsetWidth || 1,left=Math.max(rect.left,clip.left),top=Math.max(rect.top,clip.top),width=Math.max(0,Math.min(rect.right,clip.right)-left),height=Math.max(0,Math.min(rect.bottom,clip.bottom)-top);
   Object.assign(copy.style,{left:((left-rect.left)/scale)+'px',top:((top-rect.top)/scale)+'px',width:(width/scale)+'px',height:(height/scale)+'px'});
   element.classList.toggle('is-cropped',width<180 || height<110);
   return {width,height};
  }
  const placement = {
   id, ownerId, signature, point, frame, target, element, failed:false,error:'',
   onScreen:{width:0,height:0},
   visible() {return !element.hidden&&this.onScreen.width>=(this.failed?120:80)&&this.onScreen.height>=(this.failed?100:50)&&(!frameElement||!!frameElement.getClientRects().length);},
   align() {
    element.hidden = boardId !== ownerId;
    if (element.hidden) return;
    let rect;
    if (target) {
     const resolved = resolveAttachment(target), node = resolved && [...$('nodes').children].find(el => el.dataset.id === resolved.nodeId);
     const immersive=$('immersiveSurface'),surface=resolved&&(immersive?.closest('dialog[open]')&&immersive.dataset.id===resolved.nodeId?immersive:node);
     const cell = surface && (Number.isInteger(resolved.r) ? surface.querySelector('[data-cell="'+resolved.r+','+resolved.c+'"]') : surface);
     if (!cell?.isConnected) {element.hidden = true;return;}
     rect = cell.getBoundingClientRect();element.classList.add('is-attachment');
     const dialog = cell.closest('dialog[open]');
     if (dialog) {
      if (element.parentElement !== dialog) dialog.append(element);
      const bounds=dialog.getBoundingClientRect(),scale=bounds.width/dialog.offsetWidth || 1;
      Object.assign(element.style,{left:((rect.left-bounds.left)/scale+dialog.scrollLeft-dialog.clientLeft)+'px',top:((rect.top-bounds.top)/scale+dialog.scrollTop-dialog.clientTop)+'px',width:(rect.width/scale)+'px',height:(rect.height/scale)+'px'});this.onScreen=fitCopy(bounds);return;
     }
    }
    if (element.parentElement !== $('world')) $('world').append(element);
    const p = rect ? worldPoint(rect.left,rect.top) : point;
    Object.assign(element.style,{left:p.x+'px',top:p.y+'px',width:(rect ? rect.width/view().z : frame.w)+'px',height:(rect ? rect.height/view().z : frame.h)+'px'});
    this.onScreen=fitCopy(canvas.getBoundingClientRect());
   },
   phase(text) {if (!this.failed) stage.textContent = text;},
   fail(text) {this.failed=true;this.error=text;element.classList.add('is-failed');stage.textContent='未添加';reason.textContent=text;reason.hidden=close.hidden=false;this.align();},
   remove() {placements.delete(id);element.remove();watchPlacements();},
   complete() {
    if (this.failed) return;
    placements.delete(id);watchPlacements();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {element.remove();return;}
    element.classList.add('is-complete');setTimeout(()=>element.remove(),160);
   },
   acknowledge() {if (!matchMedia('(prefers-reduced-motion: reduce)').matches) element.animate([{opacity:.55},{opacity:1}],{duration:180});}
  };
  close.onclick = event => {event.stopPropagation();placement.remove();updateFeedback();};
  placements.set(id,placement);placement.align();watchPlacements();return placement;
 }
 const drawBeforePlacements=drawNodes;drawNodes=function(...args){const result=drawBeforePlacements(...args);if(placements.size)schedulePlacements();return result;};
 const moveBeforePlacements=moveView;moveView=function(...args){const result=moveBeforePlacements(...args);if(placements.size){positionPlacements();updateFeedback();}return result;};
 document.addEventListener('scroll',()=>{if(placements.size)schedulePlacements();else if(libraryUploads.size)updateFeedback();},true);
 window.addEventListener('resize',()=>{if(placements.size)schedulePlacements();else if(libraryUploads.size)updateFeedback();});
 const feedback = document.createElement('aside');
 feedback.id = 'importFeedback'; feedback.hidden = true;
 feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
 feedback.setAttribute('aria-atomic', 'true');
 const heading = document.createElement('strong'), detail = document.createElement('span'), dismiss = document.createElement('button');
 dismiss.type = 'button'; dismiss.textContent = '关闭';
 feedback.append(heading, detail, dismiss); document.body.append(feedback);
 let failure = '', failurePlacement = null;
 function updateFeedback() {
  const active = [...tasks.values()].filter(task => task.label && !matchingPlacements(task).some(placement=>placement.visible())), latest = active.at(-1);
   const error=(failurePlacement?.visible()?'':failure)||[...placements.values(),...libraryUploads.values()].filter(placement=>placement.failed&&!placement.visible()).at(-1)?.error||'';
  feedback.hidden = !latest && !error;
  feedback.classList.toggle('import-failed', !!error);
  heading.textContent = error ? '未添加' : latest?.label || '';
  detail.textContent = error || latest?.names || '';
  dismiss.hidden = !error || !!latest;
 }
  dismiss.onclick = () => {failure = '';failurePlacement?.remove();failurePlacement=null;for(const placement of [...placements.values(),...libraryUploads.values()])if(placement.failed)placement.remove();updateFeedback();};
 function filesLabel(files, action) {
  return {label:action || (files.every(file=>/\.(md|txt|csv|tsv|json)$/i.test(file.name))?'读取中':'上传中'), names:files.map(file => file.name).join('、'), files};
 }
 function matchingPlacements(entry) {
  return [...new Set([entry.placement,...[...tasks.values()].filter(other=>!entry.libraryUpload&&!other.libraryUpload&&entry.filesKey && other.filesKey===entry.filesKey && other.ownerId===entry.ownerId).map(other=>other.placement)].filter(Boolean))];
 }
 function reportFailure(entry, message) {
  const matching=matchingPlacements(entry);
  for(const placement of matching) placement.fail(message);
  if(!matching.length){failure=message;failurePlacement=null;}
  else if(!matching.some(placement=>placements.get(placement.id)===placement)){failure=message;failurePlacement=matching[0];}
 }
  function fileKey(operation, files, destination = '', owner = boardId) {
  if (!files.length) return '';
  // Only coalesce a matching in-flight selection at the same destination.
  // Once settled, the author can intentionally insert that file again.
   return JSON.stringify([operation, owner, destination, files.map(file => [file.name, file.size, file.type, file.lastModified]).sort()]);
 }
 let preparingPlacement = false;
 const pendingCanvas = () => [...tasks.values()].some(task => task.kind === 'canvas');
 const announce = () => {
  updateFeedback();
  window.dispatchEvent(new Event('creative-import-state'));
  if (explorer && parent !== window) parent.postMessage({type:'explorer-import-state'}, location.origin);
 };
 function run(action, kind = 'canvas', info = {}) {
  if (kind === 'canvas' && !explorer && (loading || !board)) {
   notice('白板打开后再试');
   return Promise.resolve(false);
  }
  if (info.key && fileJobs.has(info.key)) {
   fileJobs.get(info.key).placement?.acknowledge();
   return fileJobs.get(info.key).result;
  }
  if (!tasks.size) {failure = '';failurePlacement=null;}
  const token = {}, entry = {kind, promise:null, ownerId:boardId, ...info};
  entry.filesKey = info.files?.length ? JSON.stringify(info.files.map(file=>[file.name,file.size,file.type,file.lastModified]).sort()) : '';
   entry.placement = info.placement || (info.libraryUpload ? beginLibraryUpload(info.files,info.folder,info.key) : kind==='canvas' && info.spatial ? beginInsertion(info.items || info.files || [],info.point,info.target) : null);
  entry.ownsPlacement = !!entry.placement && !info.borrowed;
  for(const placement of matchingPlacements(entry))placement.phase(info.label || '添加中');
  let finish;
  entry.promise = new Promise(resolve => finish = resolve);
  tasks.set(token, entry); announce();
  if (info.key) fileJobs.set(info.key, entry);
  entry.result = (async () => {
   try {
    const result = await action(entry.placement?.point);
     if (result === false && entry.label && !entry.placement?.failed) reportFailure(entry,entry.placement?.point?._insertionError || '未能添加');
    return result;
   } catch (error) {
    if (entry.label) reportFailure(entry,error.message || '连接失败');
     if(entry.libraryUpload && error && typeof error==='object')libraryFailures.add(error);
    throw error;
   } finally {
    if(entry.ownsPlacement)entry.placement.complete();
    tasks.delete(token); if (info.key) fileJobs.delete(info.key);
    finish(); announce();
   }
  })();
  return entry.result;
 }
 async function idle() {
  for (;;) {
   const pending = [...tasks.values()].filter(task => task.kind === 'canvas');
   if (!pending.length) return;
   await Promise.all(pending.map(task => task.promise));
  }
 }
 async function flush(operation = () => persist()) {
  for (;;) {
   await idle();
   if (!await operation()) return false;
   if (!pendingCanvas() && !dirty && !savePromise) return true;
  }
 }
 function notice(text, target) {
  if(target){const matching=[...tasks.values()].filter(entry=>entry.target?._importDestination===target._importDestination);if(matching.length){for(const entry of matching)reportFailure(entry,text);updateFeedback();return;}}
  toast(text);
  if (parent !== window && !explorer) parent.postMessage({type:'pane-import-notice', text}, location.origin);
 }
 function attachmentTarget(target) {
  if (target._importDestination) return target;
  const node = board?.nodes.find(node => node.id === target.nodeId);
  let cell = null;
  if (node?.type === 'table' && Number.isInteger(target.r) && Number.isInteger(target.c)) {
   tableAxisIds(node);
   cell = {rowId:node.rowIds[target.r], columnId:node.columnIds[target.c]};
  }
  return {...target, _importDestination:{boardId, nodeId:node?.id, cell}};
 }
 function resolveAttachment(target) {
  const saved = target._importDestination;
  if (!saved) return target;
  const node = board?.nodes.find(node => node.id === target.nodeId);
  if (saved.boardId !== boardId || node?.id !== saved.nodeId || !node) return null;
  if (saved.cell) {
   if (node.type !== 'table' || !saved.cell.rowId || !saved.cell.columnId) return null;
   const r = node.rowIds?.indexOf(saved.cell.rowId) ?? -1, c = node.columnIds?.indexOf(saved.cell.columnId) ?? -1;
   return r >= 0 && c >= 0 && node.rows[r]?.[c] !== undefined ? {...target, r, c} : null;
  }
  return target;
 }
 const upload = uploadFiles;
 uploadFiles = function(files, folder = assetFolder) {
  const snapshot = [...files];
   const canvasOwner=[...tasks.values()].some(task=>task.kind==='canvas'&&snapshot.every(file=>task.files?.includes(file)));
  return run(async () => {
   const preparation=window.whiteboardImagePreparation?.prepare(snapshot);
   try{const added=await upload(snapshot,folder);preparation?.remember(added);return added}
   finally{preparation?.dispose()}
   }, 'library', snapshot.length ? {...filesLabel(snapshot,'上传中'), libraryUpload:!canvasOwner, folder, key:fileKey('upload', snapshot, libraryFolderIdentity(folder),canvasOwner?boardId:'library')} : {});
 };
 const importBefore = importFiles;
 importFiles = function(files, position) {
  const snapshot = [...files], point = position || (!explorer && board ? center() : undefined);
  return run(anchor => importBefore(snapshot, anchor || point), explorer ? 'library' : 'canvas', snapshot.length ? {...filesLabel(snapshot), spatial:true, point, key:fileKey('import', snapshot)} : {});
 };
 const pasteBefore = pastePayload;
 pastePayload = function(text, files = [], anchor = pasteAnchor()) {
  const snapshot = [...files], saved = {...anchor}, point=anchor._insertionPoint || (!explorer&&board?worldPoint(anchor.x,anchor.y):undefined);
  return run(position => pasteBefore(text, snapshot, {...saved,...(position?{_insertionPoint:position}:{})}), explorer ? 'library' : 'canvas', snapshot.length ? {...filesLabel(snapshot), spatial:true, point, borrowed:placements.has(point?._insertion), key:fileKey('paste', snapshot, text)} : {});
 };
 const pasteMenuBefore = pasteBlocks;
 pasteBlocks = function(anchor = pasteAnchor()) {
  const saved={...anchor},point=!explorer&&board?worldPoint(anchor.x,anchor.y):undefined;
  return run(position => pasteMenuBefore({...saved,...(position?{_insertionPoint:position}:{})}), explorer ? 'library' : 'canvas',{label:'读取中',names:'剪贴板',items:[{title:'剪贴板'}],point,spatial:true});
 };
 const placeBefore = placeAssets;
 placeAssets = function(ids, position) {
  if (explorer && preparingPlacement) return Promise.resolve(false);
  const snapshot = [...ids], items=snapshot.map(id=>assetById(id)).filter(Boolean), destination=explorer?parent.whiteboardLibraryTransfer?.destination():null;
  const inherited=placements.get(position?._insertion), preview=inherited || (explorer?parent.whiteboardLibraryTransfer?.preview(destination,items):null);
  const point = position || preview?.point;
  if (explorer) preparingPlacement = true;
  return run(anchor => placeBefore(snapshot, anchor || point), explorer ? 'library' : 'canvas', {label:'读取中', names:items.map(item=>item.title).join('、'), items, point, spatial:true, placement:preview, borrowed:!!inherited})
   .finally(() => {if (explorer) preparingPlacement = false;});
 };
 const attachBefore = attachFiles;
 attachFiles = function(files, target) {
  const snapshot = [...files], destination = attachmentTarget(target);
  return run(() => attachBefore(snapshot, destination), 'canvas', {...filesLabel(snapshot), spatial:true, target:destination, key:fileKey('attach', snapshot, destination._importDestination)});
 };
 const chooseBefore = chooseImages;
 chooseImages = function(target) {return chooseBefore(attachmentTarget(target));};
 const attachAssetsBefore = attachAssets;
 attachAssets = function(ids, target) {
  const snapshot = [...new Set(ids)], saved = attachmentTarget(target);
  const append = () => {
   const destination = resolveAttachment(saved);
   if (!destination) {
    notice('原位置已移走，文件留在内容库。',saved);
    return false;
   }
   if (snapshot.some(id => !assetById(id) || assetById(id).archived)) {
    notice('所选内容已变动，刷新内容库后再试。',saved);
    return false;
   }
   return attachAssetsBefore(snapshot, destination);
  };
  if (snapshot.every(id => assetById(id))) return append();
  // A shared-library upload may reach this cell before its catalog refresh.
  return run(async () => {
   try {await loadAssets();} catch (error) {notice(error.message,saved); return false;}
   return append();
  },'canvas',{label:'读取中',names:'附件',items:snapshot.map(id=>assetById(id) || {id,title:'附件'}),spatial:true,target:saved,key:JSON.stringify(['attach-assets',boardId,snapshot,saved._importDestination])});
 };
 for (const name of ['switchBoard', 'newBoard', 'confirmReload', 'saveCopy']) {
  const before = window[name];
  window[name] = async function(...args) {await idle(); return before(...args);};
 }
 if (window.whiteboardPane) {
  const flushBefore = whiteboardPane.flush;
  whiteboardPane.flush = () => flush(flushBefore);
  whiteboardPane.beginInsertion = (items,position) => beginInsertion(items,position);
  const insertBefore=whiteboardPane.insertLibrary;
  whiteboardPane.insertLibrary=(items,position)=>run(point=>insertBefore(items,point || position),'canvas',{label:'添加中',names:items.map(item=>item.asset?.title || '内容').join('、'),items:items.map(item=>({...item.asset,bundle:item.bundle})),point:position,spatial:true,borrowed:placements.has(position?._insertion)});
 }
 window.addEventListener('beforeunload', event => {
  if (!tasks.size) return;
  event.preventDefault(); event.returnValue = '';
 });
 window.whiteboardImports = {
  idle,
  flush,
   handlesLibraryError:error=>!!error&&typeof error==='object'&&libraryFailures.has(error),
  pending:() => tasks.size > 0,
  pendingCanvas
 };
})();
