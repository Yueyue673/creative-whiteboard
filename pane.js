
// Canvas tabs and the shared explorer have separate views of the same content model.
(() => {
 if(parent===window||new URLSearchParams(location.search).get('pane')!=='1')return;
 const params=new URLSearchParams(location.search),explorer=params.get('explorer')==='1';
 if(explorer&&['manager','assetPane','outline'].includes(params.get('panel')))workspaceTab=params.get('panel');
 document.documentElement.classList.add('embedded-pane',explorer?'explorer-pane':'canvas-pane');
 const style=document.createElement('style');style.textContent='.embedded-pane body>header{display:none!important}.embedded-pane main{height:100dvh!important}.embedded-pane #workspaceSidebar{top:0!important}.canvas-pane #workspaceSidebar{display:none!important}.embedded-pane #windowWorkspace,.embedded-pane #hint{display:none!important}.explorer-pane #canvas,.explorer-pane #editor{display:none!important}.explorer-pane #workspaceSidebar{position:absolute!important;inset:0 auto auto 0!important;width:100%!important;height:calc(100dvh / var(--interface-scale,1))!important;min-width:0!important;max-width:none!important;border:0!important;resize:none!important;transform:none!important;zoom:var(--interface-scale,1)!important}.explorer-pane .workspace-tabs{margin-top:6px!important}.explorer-pane .sidebar-top{display:none!important}';document.head.append(style);
 $('workspaceSidebar').hidden=!explorer;
 const send=(type,extra={})=>parent.postMessage({type,...extra},location.origin);
 const parentHasDialog=()=>{try{return !!parent.document.querySelector('dialog[open]')}catch{return false}};
 function syncDialogClosing(sync){
  const dialog=$('dialog'),close=dialog.close;
  dialog.close=function(...args){
   if(this.open)document.documentElement.classList.remove('pane-dialog-open');
   try{return close.apply(this,args)}finally{sync()}
  };
  // Original dismissal cleanups restore focus synchronously; expose their source first.
  dialog.addEventListener('close',sync,true);
 }
 let visible=true,reporting=false,lastState='',listeningVisible=false;
 let editingPlace=null;
 function captureEditingPlace(field=document.activeElement){
  if(!field?.closest('.live-layout')||!field.matches('input,textarea')||field.readOnly||field.disabled)return;
  editingPlace={field,boardId,editorId,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft};
 }
 function restoreEditingPlace(){
  const place=editingPlace,field=place?.field;
  if(!place||place.boardId!==boardId||place.editorId!==editorId||!field.isConnected||field.closest('[hidden]')||field.readOnly||field.disabled||field.value!==place.value)return false;
  field.focus({preventScroll:true});if(Number.isInteger(place.start)&&Number.isInteger(place.end))field.setSelectionRange(place.start,place.end,place.direction);field.scrollTop=place.top;field.scrollLeft=place.left;return true;
 }
 // A parent picker can move focus before the iframe becomes hidden. Retain the
 // mounted original while it is still active, including native range changes.
 document.addEventListener('focusin',event=>{if(event.target===canvas)editingPlace=null;else captureEditingPlace(event.target)});
 document.addEventListener('input',event=>captureEditingPlace(event.target));
 document.addEventListener('selectionchange',()=>captureEditingPlace());

 function state(){return {boardId,name:board?.name||'',dirty:!!dirty,blocked:!!blocked,saving:!!savePromise,loading:!!loading,pendingImports:window.whiteboardImports?.pendingCanvas()||false,contentDirty,savingContent,saveError,loadTargetId,loadError,loadErrorCode,revision:contentRevision}}
 function report(){if(explorer||reporting)return;reporting=true;queueMicrotask(()=>{reporting=false;const next=state(),key=JSON.stringify(next);if(key===lastState)return;lastState=key;send('pane-state',{state:next})})}
 const initialLoad=loadBoard;loadBoard=async function(id,options){if(explorer||board&&boardId&&id!==boardId){$('boards').value=boardId;send(explorer?'explorer-open':'pane-open',{boardId:id});return false}const loaded=await initialLoad(id,options);if(explorer)await showWorkspaceTab(workspaceTab);else report();return loaded};
 const oldChange=change,oldPersist=persist;change=function(viewOnly=false){if(explorer)return;oldChange(viewOnly);report()};persist=async function(){if(explorer)return true;const result=oldPersist();report();try{return await result}finally{report()}};
 function pauseMedia(doc=document){doc.querySelectorAll('audio,video').forEach(m=>m.pause());for(const frame of doc.querySelectorAll('iframe'))try{if(frame.contentDocument)pauseMedia(frame.contentDocument)}catch{}}
 if(explorer){
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Tab'&&!e.isComposing&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();send('explorer-shortcut',{reverse:e.shiftKey})}},true);
  drawNodes=()=>{}; // This document presents lists, never a second hidden canvas.
  const show=showWorkspaceTab;showWorkspaceTab=async function(panel){const pending=show(panel);$('workspaceSidebar').hidden=false;send('explorer-panel',{panel});await pending};
  toggleSidebar=()=>send('explorer-toggle');$('sidebarToggle').onclick=toggleSidebar;
  const placements=new Map(),returnRequests=new WeakMap();let placementPending=false,previewDestination=null,previewDestinationEpoch=0;
  const ownsPreview=scope=>scope&&previewDestination===scope&&$('dialog').open&&scope.preview.isConnected&&$('pieceList')===scope.preview;
  const placementDestination=()=>ownsPreview(previewDestination)?previewDestination.target:parent.whiteboardLibraryTransfer?.destination();
  window.addEventListener('message',e=>{
   if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='explorer-place-result')return;
   const request=placements.get(e.data.requestId);if(!request)return;
   placements.delete(e.data.requestId);placementPending=false;
   request.buttons.forEach(({button,disabled})=>{if(button.isConnected)button.disabled=disabled});
   if(e.data.error){if(request.position)request.position._insertionError=e.data.error;toast(e.data.error)}if(Array.isArray(e.data.ids)&&e.data.ids.length)returnRequests.set(e.data.ids,e.data.requestId);request.resolve(e.data.ids||false);
  });
  commitLibraryBatch=function(items,position,destination=placementDestination()){
   if(placementPending){toast('上一批内容还在添加，请稍候。');return Promise.resolve(false)}
   if(!items.length){toast('没有可添加的内容');return Promise.resolve(false)}
   placementPending=true;const requestId=uid(),buttons=[...$('dialogActions').querySelectorAll('button')].filter(button=>button.hasAttribute('data-library-place')||button.hasAttribute('data-library-destination')||['添加整个组合','添加选中内容'].includes(button.textContent)).map(button=>({button,disabled:button.disabled}));
   buttons.forEach(({button})=>button.disabled=true);
   const returnContext=$('dialog').open&&$('pieceList')?parent.whiteboardWorkspace?.captureInsertionReturn?.():null;return new Promise(resolve=>{placements.set(requestId,{resolve,buttons,position});send('explorer-place',{items,position,requestId,destination,returnContext})});
  };
  selectNode=function(id){send('explorer-focus',{nodeId:id})};focusNode=function(n){if(n)send('explorer-focus',{nodeId:n.id})};
  const captureOutline=renderOutline;renderOutline=function(){captureOutline();$('items').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>send('explorer-focus',{nodeId:b.dataset.open}))};
  const captureAssets=renderAssets;renderAssets=function(){captureAssets();queueMicrotask(()=>send('explorer-selection',{ids:[...assetSelected],folder:assetFolder}))};
  const saveCatalog=saveAssets;saveAssets=async function(next){const ok=await saveCatalog(next);if(ok)send('explorer-catalog');return ok};
  $('assetList').addEventListener('click',()=>queueMicrotask(()=>send('explorer-selection',{ids:[...assetSelected],folder:assetFolder})));
  window.whiteboardExplorer={show:showWorkspaceTab,revealAsset:revealLibraryItem,pending:()=>window.whiteboardImports?.pending()||false,selection:()=>({ids:[...assetSelected],folder:assetFolder,panel:workspaceTab}),setBoard:snapshot=>{board=snapshot?clone(snapshot.board):{format:'creative-board',version:1,name:'',folder:'',nodes:[],edges:[],view:{x:0,y:0,z:1}};boardId=snapshot?.boardId||'';selected=new Set(snapshot?.selected||[]);if(workspaceTab==='outline')renderOutline();window.dispatchEvent(new Event('creative-research-context'))},refresh:async()=>{await loadFolders();await listBoards();await loadAssets()}};
  whiteboardExplorer.placementDestination=placementDestination;
  const previewWithDestination=previewAsset;
  previewAsset=async function(id){
   const epoch=++previewDestinationEpoch;await previewWithDestination(id);
   if(epoch!==previewDestinationEpoch||!$('dialog').open||!$('pieceList')||typeof parent.whiteboardLibraryTransfer?.chooseDestination!=='function'||typeof parent.whiteboardLibraryTransfer?.destinationName!=='function')return;
   const place=$('dialogActions').querySelector('[data-library-place]');if(!place)return;
   const scope={preview:$('pieceList'),target:parent.whiteboardLibraryTransfer?.destination()||null};previewDestination=scope;
   const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');row.className='reuse-destination';label.textContent='放到';button.type='button';button.dataset.libraryDestination='';row.append(label,button);place.before(row);
   const paint=()=>{const name=parent.whiteboardLibraryTransfer?.destinationName(scope.target)||'选择白板';button.textContent=name+' ▾';button.title=name;button.setAttribute('aria-label','选择放入的白板，当前：'+name)};paint();
   button.onclick=async()=>{
    if(!ownsPreview(scope)||placementPending||parentHasDialog())return;
    const wasDisabled=place.disabled;place.disabled=true;button.disabled=true;
    try{const target=await parent.whiteboardLibraryTransfer.chooseDestination(window);if(!ownsPreview(scope))return;if(target)scope.target=target;paint()}
    catch(error){if(ownsPreview(scope))toast(error.message)}
    finally{if(ownsPreview(scope)){place.disabled=wasDisabled;button.disabled=false;button.focus({preventScroll:true})}}
   };
   onDialogDismiss(()=>{if(previewDestination===scope)previewDestination=null});
  };
  whiteboardExplorer.revealInserted=ids=>{const requestId=returnRequests.get(ids);if(!requestId)return;returnRequests.delete(ids);send('explorer-reveal-insertion',{requestId})};
  whiteboardExplorer.command=async function(name,extra={}){
   if(name==='ai'){
    await loadAssets();assetSelected=new Set(extra.libraryIds||[]);await whiteboardAI.compose();
    if(extra.scope==='library'&&$('aiTaskScope')){$('aiTaskScope').value='library';$('aiTaskScope').dispatchEvent(new Event('change'))}
   }else if(name==='help')wfHelp();else if(name==='search')wfOpenSearch();else if(name==='recovery')await wfRecovery(boardId?'board':'library');
  };
  askCollectSelection=()=>send('explorer-command',{command:'collect'});
  const oldNew=newBoard;newBoard=async name=>{if(board){send('explorer-create',{name,folder:folderSelected});return}return oldNew(name)};
  let modal=false;const syncDialog=()=>{const next=!!document.querySelector('dialog[open]');document.documentElement.classList.toggle('pane-dialog-open',next);if(next!==modal){modal=next;send('explorer-dialog',{open:modal})}};
  new MutationObserver(syncDialog).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});syncDialogClosing(syncDialog);syncDialog();
  const modalStyle=document.createElement('style');modalStyle.textContent='.explorer-pane.pane-dialog-open body{background:transparent!important}.explorer-pane.pane-dialog-open main{visibility:hidden}.explorer-pane.pane-dialog-open{background:transparent}';document.head.append(modalStyle);
 }else{
  let modal=false,fullWindow=false,readingButton=null,restoreAfterLayout=false;
  function reportReading(){send('pane-dialog',{open:modal,fullWindow})}
  const syncDialog=()=>{
   const dialog=$('dialog'),next=dialog.open&&dialog.classList.contains('immersive-dialog');document.documentElement.classList.toggle('pane-dialog-open',next);
   if(listeningVisible&&dialog.open&&!next)send('pane-listening-end');
   if(next===modal)return;modal=next;fullWindow=false;restoreAfterLayout=false;
   if(modal){
    const heading=dialog.querySelector('.immersive-heading'),actions=heading?.querySelector('div');
    if(actions){const button=document.createElement('button');button.id='readingFullWindow';button.type='button';button.textContent='全屏';button.hidden=true;readingButton=button;actions.prepend(button);
     button.onpointerdown=()=>captureEditingPlace();
     button.onclick=()=>{if(readingButton!==button||!button.isConnected||!modal||!dialog.open||heading!==dialog.querySelector('.immersive-heading'))return;fullWindow=!fullWindow;restoreAfterLayout=true;reportReading()};
    }
   }else{readingButton=null}
   reportReading();
  };
  window.addEventListener('message',e=>{
   if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='pane-reading-layout'||!modal||!readingButton?.isConnected)return;
   const button=readingButton;button.hidden=!e.data.split;button.textContent=e.data.fullWindow?'返回分栏':'全屏';button.setAttribute('aria-label',e.data.fullWindow?'返回分栏编辑':'全屏编辑');
   button.closest('.immersive-heading')?.classList.toggle('reading-switchable',!!e.data.split);
   if(restoreAfterLayout){restoreAfterLayout=false;requestAnimationFrame(()=>{if(readingButton===button&&modal&&document.hasFocus())restoreEditingPlace()})}
  });
  new MutationObserver(syncDialog).observe($('dialog'),{attributes:true,attributeFilter:['open','class']});syncDialogClosing(syncDialog);syncDialog();
  // The existing dialog observer owns this state; avoid a root :has() query on every content mutation.
  const modalStyle=document.createElement('style');modalStyle.textContent='.canvas-pane.pane-dialog-open body{background:transparent!important}.canvas-pane.pane-dialog-open main{visibility:hidden}.canvas-pane.pane-dialog-open{background:transparent}';document.head.append(modalStyle);
  toggleSidebar=()=>send('pane-sidebar');showWorkspaceTab=async panel=>send('pane-sidebar',{panel});revealLibraryItem=async id=>{const host=parent.whiteboardWorkspace;if(typeof host?.revealAsset==='function')return host.revealAsset(id,window);send('pane-sidebar',{panel:'assetPane'})};$('sidebarToggle').onclick=toggleSidebar;
  const sidebarObserver=new MutationObserver(()=>{if(!$('workspaceSidebar').hidden)$('workspaceSidebar').hidden=true});sidebarObserver.observe($('workspaceSidebar'),{attributes:true,attributeFilter:['hidden']});
  function setListening(next){if(listeningVisible===next)return;listeningVisible=next;document.documentElement.classList.toggle('listening-writing',next)}
  function canvasReady(){
   const deadline=performance.now()+1500;let prior='';return new Promise(resolve=>{const check=()=>{if(!visible||frameElement?.hidden||parentHasDialog())return resolve(false);if(performance.now()>deadline)return resolve(false);if(modal||frameElement?.classList.contains('pane-modal')){requestAnimationFrame(check);return}const size=canvas.clientWidth+':'+canvas.clientHeight;if(size===prior)return resolve(true);prior=size;requestAnimationFrame(check)};requestAnimationFrame(check)});
  }
  const closedViewScope=()=>window.whiteboardHosted?String(whiteboardHosted.account.id)+':'+whiteboardHosted.workspace:'local';
  function captureClosedView(){
   if(!board||loading||dirty||savePromise||blocked||saveError||etag==='new'||window.whiteboardImports?.pendingCanvas())return null;
   captureEditingPlace();captureReading();pauseMedia();
   const place=editingPlace,field=place?.field,live=place?.editorId===editorId&&field?.isConnected;
   const selector=live&&(field.id?'#'+CSS.escape(field.id):field.dataset.row!==undefined&&field.dataset.col!==undefined?'[data-row="'+field.dataset.row+'"][data-col="'+field.dataset.col+'"]':field.dataset.column!==undefined?'[data-column="'+field.dataset.column+'"]':null);
   const root=editorId?document.querySelector('.inner.live-layout'):null,area=root?.querySelector('.edit-scroll'),details=root?.querySelector('#inlineMeta');
   // Undo entries are immutable JSON snapshots. Keep their values, never a live
   // document, DOM input or asynchronous writer from the closed iframe.
   return {boardId,version:etag,scope:closedViewScope(),selected:[...selected],history:history.slice(),future:future.slice(),view:{...view()},width:canvas.clientWidth,height:canvas.clientHeight,editorId,
    writing:root?{expanded:!!whiteboardReading?.isEditing(),preview:root.querySelector('#notePreview')?.getAttribute('aria-pressed')==='true',details:!!details?.open,scroll:area?.scrollTop||0,detailsScroll:details?.scrollTop||0}:null,
    field:selector?{selector,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft}:null};
  }
  function restoreClosedView(place){
   if(!place||!board||loading||dirty||savePromise||blocked||saveError||place.boardId!==boardId||place.version!==etag||place.scope!==closedViewScope()||whiteboardHostedRoleIsReadOnly())return false;
   history=place.history.slice();future=place.future.slice();selected=new Set(place.selected.filter(id=>board.nodes.some(n=>n.id===id)));
   if(place.width===canvas.clientWidth&&place.height===canvas.clientHeight){Object.assign(view(),place.view);moveView()}
   if(place.editorId&&board.nodes.some(n=>n.id===place.editorId)){
    if(place.writing?.expanded)whiteboardReading.open(place.editorId);else openEditor(place.editorId);
    const root=document.querySelector('.inner.live-layout'),area=root?.querySelector('.edit-scroll'),details=root?.querySelector('#inlineMeta'),preview=root?.querySelector('#notePreview');
    if(place.writing&&details)details.open=place.writing.details;growContentFields(root);
    if(place.writing?.preview&&preview)preview.click();
    const field=root?.querySelector(place.field?.selector||':not(*)');
    if(field&&field.value===place.field.value){if(!field.hidden&&(!details?.contains(field)||details.open))field.focus({preventScroll:true});else preview?.focus({preventScroll:true});if(Number.isInteger(place.field.start)&&Number.isInteger(place.field.end))field.setSelectionRange(place.field.start,place.field.end,place.field.direction);field.scrollTop=place.field.top;field.scrollLeft=place.field.left;captureEditingPlace(field)}
    if(place.writing){if(area)area.scrollTop=place.writing.scroll;if(details)details.scrollTop=place.writing.detailsScroll}
   }
   else refreshSelectionUI();
   updateButtons();return true;
  }
  function whiteboardHostedRoleIsReadOnly(){return window.whiteboardHosted?.role==='viewer'||window.whiteboardHosted?.paused}
  window.whiteboardPane={state,setListening,viewport:()=>({width:width||canvas.clientWidth,height:height||canvas.clientHeight}),canvasReady,selection:()=>[...selected],flush:()=>persist(),snapshot:()=>board?{board:clone(board),boardId,selected:[...selected]}:null,refreshLibrary:()=>loadAssets(),focus:()=>{if(parentHasDialog())return;if($('dialog').open){if($('dialog').classList.contains('immersive-dialog')&&!restoreEditingPlace())$('dialog').focus({preventScroll:true});return}if(restoreEditingPlace())return;const active=document.activeElement;if(active?.closest('.live-layout')&&active.matches('input,textarea,[contenteditable=true]')&&!active.readOnly){active.focus({preventScroll:true});return}canvas.tabIndex=-1;canvas.focus({preventScroll:true})},setVisible:next=>{if(visible&&!next){captureEditingPlace();captureReading();pauseMedia();persist().catch(()=>{})}visible=next;if(next&&entryPending)scheduleEntryViewport()},insertLibrary:async (items,position)=>{const targetId=boardId;if(!board||loading||blocked||saveError)throw Error('目标白板尚未准备好，请先处理提示。');await loadAssets();if(boardId!==targetId||loading||blocked||saveError)throw Error('目标白板状态已改变，内容尚未添加。');return commitLibraryBatch(items,position)},focusNode:id=>{const n=board?.nodes.find(n=>n.id===id);if(n){selected=new Set([id]);editorId=null;refreshSelectionUI();focusNode(n);report()}},command:async(name,extra={})=>{if(name==='sidebar')toggleSidebar();else if(name==='ai'){await loadAssets();assetSelected=new Set(extra.libraryIds||[]);$('aiWorkspace').click();if(extra.scope==='library'&&$('aiTaskScope')){$('aiTaskScope').value='library';$('aiTaskScope').dispatchEvent(new Event('change'))}}else if(name==='settings')whiteboardAppearance.open();else if(name==='help')wfHelp();else if(name==='search')wfOpenSearch();else if(name==='recovery')await wfRecovery();else if(name==='rename')$('rename').click();else if(name==='group')groupSelection();else if(name==='collect'){assetFolder=extra.folder||'';askCollectSelection()}else if(name==='export')exportJSON();else if(name==='markdown')exportMarkdown()}};
  whiteboardPane.captureClosedView=captureClosedView;whiteboardPane.restoreClosedView=restoreClosedView;
  // A saved translation uses the canvas size that was current when it was
  // written. Preserve its world centre on a fresh, differently sized canvas.
  const viewportValid=v=>v&&Number.isFinite(v.width)&&Number.isFinite(v.height)&&v.width>=1&&v.height>=1&&v.width<=100000&&v.height<=100000;
  const paneViewport=()=>({width:width||canvas.clientWidth,height:height||canvas.clientHeight});
  // The coordinate basis belongs to the saved document, not the live camera.
  // Match its camera stamp so an older client cannot leave a stale basis active.
  const contextValid=v=>v?.version===1&&viewportValid(v)&&[v.x,v.y,v.z].every(Number.isFinite)&&v.z>0;
  const contextMatches=v=>contextValid(v)&&v.x===view().x&&v.y===view().y&&v.z===view().z;
  let entryPending=null,entryFrame=0;
  const entryRecovery=document.createElement('section'),entryText=document.createElement('p'),fitButton=$('fit'),fitHome=fitButton.parentNode,fitNext=fitButton.nextSibling;
  entryRecovery.id='offscreenEntry';entryRecovery.className='inline-ui';entryRecovery.hidden=true;entryText.id='offscreenEntryText';entryRecovery.append(entryText);canvas.append(entryRecovery);
  const entryStyle=document.createElement('style');entryStyle.textContent='#offscreenEntry:not([hidden]){position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;pointer-events:none;color:var(--ui-text,#222)}#offscreenEntry p{margin:0;color:var(--ui-muted,#666);font-size:15px;line-height:1.5}#offscreenEntry #fit{pointer-events:auto;min-height:44px;min-width:116px;padding:10px 18px;border:1px solid var(--ui-accent,#977346);background:var(--ui-raised,#eee);color:var(--ui-text,#222);border-radius:6px;font-size:14px}';document.head.append(entryStyle);
  function clearEntryRecovery(){
   if(entryRecovery.hidden)return;const focused=document.activeElement===fitButton;
   fitHome.insertBefore(fitButton,fitNext?.parentNode===fitHome?fitNext:null);fitButton.textContent='全览';fitButton.removeAttribute('aria-describedby');entryRecovery.hidden=true;
   if(focused)fitButton.focus({preventScroll:true});
  }
  function showLegacyEntryRecovery(){
   const size=paneViewport(),v=view(),inFrame=board.nodes.some(n=>n.x*v.z+v.x+n.w*v.z>0&&n.x*v.z+v.x<size.width&&n.y*v.z+v.y+n.h*v.z>0&&n.y*v.z+v.y<size.height);
   if(!board.nodes.length||inFrame)return;entryText.textContent=board.nodes.length+' 项内容在画面外';fitButton.textContent='回到内容';fitButton.setAttribute('aria-describedby',entryText.id);entryRecovery.append(fitButton);entryRecovery.hidden=false;
  }
  function applyEntryViewport(){
   const target=entryPending,size=paneViewport();if(!target||board!==target||loading||modal||frameElement?.classList.contains('pane-modal')||parentHasDialog()||!visible||size.width<1||size.height<1)return false;
   entryPending=null;const basis=board.viewContext;
   if(contextMatches(basis)){view().x+=(size.width-basis.width)/2;view().y+=(size.height-basis.height)/2;moveView()}
   else showLegacyEntryRecovery();return true;
  }
  function scheduleEntryViewport(){
   cancelAnimationFrame(entryFrame);const deadline=performance.now()+1500;
   const check=()=>{if(!entryPending||applyEntryViewport()||performance.now()>deadline)return;entryFrame=requestAnimationFrame(check)};entryFrame=requestAnimationFrame(check);
  }
  const viewportLoad=loadBoard;loadBoard=async function(...args){clearEntryRecovery();entryPending=null;const loaded=await viewportLoad(...args);if(loaded&&board){entryPending=board;scheduleEntryViewport()}return loaded};
  const viewportPersist=persist;persist=async function(...args){
   if(board&&dirty&&!savePromise&&!loading&&!blocked){const size=paneViewport();if(viewportValid(size)&&[view().x,view().y,view().z].every(Number.isFinite)&&view().z>0&&(!Object.hasOwn(board,'viewContext')||contextValid(board.viewContext)))board.viewContext={...board.viewContext,version:1,...size,x:view().x,y:view().y,z:view().z}}
   return viewportPersist(...args);
  };
  const viewportMove=moveView;moveView=function(...args){clearEntryRecovery();return viewportMove(...args)};
  const cancelEntryOnInput=e=>{if(e.target.closest?.('#offscreenEntry'))return;entryPending=null;clearEntryRecovery()};
  for(const type of ['pointerdown','keydown','wheel'])canvas.addEventListener(type,cancelEntryOnInput,true);
  if(board&&!loading){entryPending=board;scheduleEntryViewport()}

  // Keep a fully visible selection in the same relative space when opening a
  // sidebar or a second pane. Neutral and intentionally cropped views keep
  // their existing centre, as does the relationship overview. Neither the
  // authored geometry nor zoom changes.
  function resizeViewAxis(axis,before,after,start,size){
   const v=view(),extent=size*v.z,leading=start*v.z+v[axis],oldRoom=before-extent-32,newRoom=after-extent-32;
   if(oldRoom>0&&newRoom>0&&leading>=16&&leading+extent<=before-16)return 16+(leading-16)*newRoom/oldRoom-start*v.z;
   return v[axis]+(after-before)/2;
  }
  // Dialogs temporarily fill the window; retain the original pane size and camera until they return.
  let width=0,height=0,timer;new ResizeObserver(entries=>{const r=entries[0].contentRect;if(modal||frameElement?.classList.contains('pane-modal')||r.width<1||r.height<1)return;const dx=r.width-width,dy=r.height-height;if(Math.abs(dx)<.01&&Math.abs(dy)<.01)return;if(board&&width&&height&&entryPending!==board){
   const chosen=!loading&&!gesture&&!canvas.classList.contains('space-overview')?board.nodes.filter(n=>selected.has(n.id)):[],x=chosen.length?Math.min(...chosen.map(n=>n.x)):0,y=chosen.length?Math.min(...chosen.map(n=>n.y)):0,w=chosen.length?Math.max(...chosen.map(n=>n.x+n.w))-x:0,h=chosen.length?Math.max(...chosen.map(n=>n.y+n.h))-y:0;
   view().x=chosen.length?resizeViewAxis('x',width,r.width,x,w):view().x+dx/2;view().y=chosen.length?resizeViewAxis('y',height,r.height,y,h):view().y+dy/2;
   moveView();window.whiteboardNavigation?.revealCaret?.(document.activeElement);clearTimeout(timer);timer=setTimeout(()=>{if(board&&!loading)change(true)},250)
  }width=r.width;height=r.height;if(entryPending===board&&!loading)applyEntryViewport()}).observe(canvas);
  document.addEventListener('pointerdown',()=>{send('pane-active');queueMicrotask(report)},true);document.addEventListener('creative-board-pan-start',()=>send('pane-active'));document.addEventListener('creative-document-active',()=>send('pane-active'));
  document.addEventListener('keydown',e=>{send('pane-active');if((e.ctrlKey||e.metaKey)&&e.key==='Tab'&&!e.isComposing&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();send('pane-shortcut',{reverse:e.shiftKey})}},true);
  if($('windowWorkspace'))$('windowWorkspace').onclick=()=>send('pane-split');
  window.addEventListener('creative-board-loading',report);window.addEventListener('creative-import-state',report);if(board)report();
 }
 // Reveal the original layout when its owner is ready; later optional programs
 // and pending data must not block controls that are already usable.
 send('pane-ready');
})();
