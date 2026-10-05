
// Canvas tabs and the shared explorer have separate views of the same content model.
(() => {
 if(parent===window||new URLSearchParams(location.search).get('pane')!=='1')return;
 const explorer=new URLSearchParams(location.search).get('explorer')==='1';
 document.documentElement.classList.add('embedded-pane',explorer?'explorer-pane':'canvas-pane');
 const style=document.createElement('style');style.textContent='.embedded-pane body>header{display:none!important}.embedded-pane main{height:100dvh!important}.embedded-pane #workspaceSidebar{top:0!important}.canvas-pane #workspaceSidebar{display:none!important}.embedded-pane #windowWorkspace,.embedded-pane #hint{display:none!important}.explorer-pane #canvas,.explorer-pane #editor{display:none!important}.explorer-pane #workspaceSidebar{position:absolute!important;inset:0 auto auto 0!important;width:100%!important;height:calc(100dvh / var(--interface-scale,1))!important;min-width:0!important;max-width:none!important;border:0!important;resize:none!important;transform:none!important;zoom:var(--interface-scale,1)!important}.explorer-pane .workspace-tabs{margin-top:6px!important}.explorer-pane .sidebar-top{display:none!important}';document.head.append(style);
 $('workspaceSidebar').hidden=!explorer;
 const send=(type,extra={})=>parent.postMessage({type,...extra},location.origin);
 let visible=true,reporting=false,lastState='';
 function state(){return {boardId,name:board?.name||'',dirty:!!dirty,blocked:!!blocked,saving:!!savePromise,loading:!!loading,contentDirty,savingContent,saveError,revision:contentRevision}}
 function report(){if(explorer||reporting)return;reporting=true;queueMicrotask(()=>{reporting=false;const next=state(),key=JSON.stringify(next);if(key===lastState)return;lastState=key;send('pane-state',{state:next})})}
 const initialLoad=loadBoard;loadBoard=async function(id){if(board&&boardId&&id!==boardId){$('boards').value=boardId;send(explorer?'explorer-open':'pane-open',{boardId:id});return}await initialLoad(id);if(explorer)await showWorkspaceTab(workspaceTab);else report()};
 const oldChange=change,oldPersist=persist;change=function(viewOnly=false){if(explorer)return;oldChange(viewOnly);report()};persist=async function(){if(explorer)return true;const result=oldPersist();report();try{return await result}finally{report()}};
 function pauseMedia(doc=document){doc.querySelectorAll('audio,video').forEach(m=>m.pause());for(const frame of doc.querySelectorAll('iframe'))try{if(frame.contentDocument)pauseMedia(frame.contentDocument)}catch{}}
 if(explorer){
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Tab'&&!e.isComposing&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();send('explorer-shortcut',{reverse:e.shiftKey})}},true);
  drawNodes=()=>{}; // This document presents lists, never a second hidden canvas.
  const show=showWorkspaceTab;showWorkspaceTab=async function(panel){await show(panel);$('workspaceSidebar').hidden=false;send('explorer-panel',{panel})};
  toggleSidebar=()=>send('explorer-toggle');$('sidebarToggle').onclick=toggleSidebar;
  commitLibraryBatch=function(items){send('explorer-place',{items});return Promise.resolve(true)};
  selectNode=function(id){send('explorer-focus',{nodeId:id})};focusNode=function(n){if(n)send('explorer-focus',{nodeId:n.id})};
  const captureOutline=renderOutline;renderOutline=function(){captureOutline();$('items').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>send('explorer-focus',{nodeId:b.dataset.open}))};
  const captureAssets=renderAssets;renderAssets=function(){captureAssets();queueMicrotask(()=>send('explorer-selection',{ids:[...assetSelected],folder:assetFolder}))};
  const saveCatalog=saveAssets;saveAssets=async function(next){const ok=await saveCatalog(next);if(ok)send('explorer-catalog');return ok};
  $('assetList').addEventListener('click',()=>queueMicrotask(()=>send('explorer-selection',{ids:[...assetSelected],folder:assetFolder})));
  window.whiteboardExplorer={show:showWorkspaceTab,selection:()=>({ids:[...assetSelected],folder:assetFolder,panel:workspaceTab}),setBoard:snapshot=>{board=snapshot?clone(snapshot.board):{format:'creative-board',version:1,name:'',folder:'',nodes:[],edges:[],view:{x:0,y:0,z:1}};boardId=snapshot?.boardId||'';selected=new Set(snapshot?.selected||[]);if(workspaceTab==='outline')renderOutline()},refresh:async()=>{await loadFolders();await listBoards();await loadAssets()}};
  whiteboardExplorer.command=async function(name,extra={}){
   if(name==='ai'){
    await loadAssets();assetSelected=new Set(extra.libraryIds||[]);await whiteboardAI.compose();
    if(extra.scope==='library'&&$('aiTaskScope')){$('aiTaskScope').value='library';$('aiTaskScope').dispatchEvent(new Event('change'))}
   }else if(name==='help')wfHelp();else if(name==='search')wfOpenSearch();else if(name==='recovery')await wfRecovery(boardId?'board':'library');
  };
  askCollectSelection=()=>send('explorer-command',{command:'collect'});
  const oldNew=newBoard;newBoard=async name=>{if(board){send('explorer-create',{name,folder:folderSelected});return}return oldNew(name)};
  let modal=false;new MutationObserver(()=>{const next=!!document.querySelector('dialog[open]');if(next!==modal){modal=next;send('explorer-dialog',{open:modal})}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  const modalStyle=document.createElement('style');modalStyle.textContent='.explorer-pane:has(dialog[open]) body{background:transparent!important}.explorer-pane:has(dialog[open]) main{visibility:hidden}.explorer-pane:has(dialog[open]){background:transparent}';document.head.append(modalStyle);
 }else{
  toggleSidebar=()=>send('pane-sidebar');showWorkspaceTab=async panel=>send('pane-sidebar',{panel});$('sidebarToggle').onclick=toggleSidebar;
  const sidebarObserver=new MutationObserver(()=>{if(!$('workspaceSidebar').hidden)$('workspaceSidebar').hidden=true});sidebarObserver.observe($('workspaceSidebar'),{attributes:true,attributeFilter:['hidden']});
  window.whiteboardPane={state,selection:()=>[...selected],flush:()=>persist(),snapshot:()=>board?{board:clone(board),boardId,selected:[...selected]}:null,refreshLibrary:()=>loadAssets(),focus:()=>{if($('dialog').open)return;const active=document.activeElement;if(active?.closest('.live-layout')&&active.matches('input,textarea,[contenteditable=true]')&&!active.readOnly){active.focus({preventScroll:true});return}canvas.tabIndex=-1;canvas.focus({preventScroll:true})},setVisible:next=>{if(visible&&!next){captureReading();pauseMedia();persist().catch(()=>{})}visible=next},insertLibrary:async items=>{await loadAssets();return commitLibraryBatch(items)},focusNode:id=>{const n=board?.nodes.find(n=>n.id===id);if(n){selected=new Set([id]);editorId=null;refreshSelectionUI();focusNode(n);report()}},command:async(name,extra={})=>{if(name==='sidebar')toggleSidebar();else if(name==='ai'){await loadAssets();assetSelected=new Set(extra.libraryIds||[]);$('aiWorkspace').click();if(extra.scope==='library'&&$('aiTaskScope')){$('aiTaskScope').value='library';$('aiTaskScope').dispatchEvent(new Event('change'))}}else if(name==='settings')whiteboardAppearance.open();else if(name==='help')wfHelp();else if(name==='search')wfOpenSearch();else if(name==='recovery')await wfRecovery();else if(name==='rename')$('rename').click();else if(name==='group')groupSelection();else if(name==='collect'){assetFolder=extra.folder||'';askCollectSelection()}else if(name==='export')exportJSON();else if(name==='markdown')exportMarkdown()}};
  let width=0,height=0,timer;new ResizeObserver(entries=>{const r=entries[0].contentRect;if(r.width<1||r.height<1)return;const dx=r.width-width,dy=r.height-height;if(Math.abs(dx)<.01&&Math.abs(dy)<.01)return;if(board&&width&&height){view().x+=dx/2;view().y+=dy/2;moveView();clearTimeout(timer);timer=setTimeout(()=>{if(board&&!loading)change(true)},250)}width=r.width;height=r.height}).observe(canvas);
  document.addEventListener('pointerdown',()=>{send('pane-active');queueMicrotask(report)},true);document.addEventListener('creative-board-pan-start',()=>send('pane-active'));document.addEventListener('creative-document-active',()=>send('pane-active'));
  document.addEventListener('keydown',e=>{send('pane-active');if((e.ctrlKey||e.metaKey)&&e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();send('pane-shortcut',{reverse:e.shiftKey})}},true);
  if($('windowWorkspace'))$('windowWorkspace').onclick=()=>send('pane-split');
  if(board)report();
 }
})();
