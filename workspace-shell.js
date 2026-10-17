// One explorer for the whole window; the canvas remains responsible for editing.
(() => {
 let open=false,panel='manager',explorerFrame=null,outlineTimer,libraryIds=[],folder='',drag=false,dragWidth=null,sizeFrame=0,lastOutlineKey='',compact=false,compactLibrary=false;
 try{const p=JSON.parse(localStorage.getItem('creative-sidebar-state')||'{}');open=!!p.open;panel=['manager','assetPane','outline'].includes(p.tab)?p.tab:'manager'}catch{}
 const host=$('globalExplorer'),work=$('workspace'),sidebarIcon=$('openBoards').innerHTML,readingModes=new WeakMap();
 // An expanded paper belongs to its pane. Full-window focus remains an explicit choice.
 function readingLayout(){
  for(const frame of frames.values()){
   const mode=readingModes.get(frame),fullWindow=!!mode?.open&&(!model.split||mode.fullWindow);
   frame.classList.toggle('pane-modal',fullWindow);
   if(!mode?.open)continue;
   const key=JSON.stringify([model.split,fullWindow]);if(mode.reported===key)continue;mode.reported=key;
   frame.contentWindow.postMessage({type:'pane-reading-layout',split:model.split,fullWindow},location.origin);
  }
 }
 const explorer=()=>explorerFrame?.contentWindow.whiteboardExplorer;
 const shown=()=>open&&(!compact||compactLibrary);
 // Initial explorer readiness ends an old insertion-return scope, but belongs to
 // the explicit library navigation that requested this first load.
 let returnEpoch=0,libraryRevealEpoch=0;
 const invalidateReturn=reason=>{returnEpoch++;if(reason!=='explorer-ready')libraryRevealEpoch++};
 const returnScope=()=>JSON.stringify([panel,explorer()?.selection(),explorerFrame?.contentDocument?.getElementById('assetSearch')?.value]);
 function trackReturnContext(doc){for(const type of ['pointerdown','keydown','input','change','wheel','touchmove'])doc.addEventListener(type,invalidateReturn,{capture:true,passive:true})}
 trackReturnContext(document);document.addEventListener('visibilitychange',invalidateReturn);window.addEventListener('resize',invalidateReturn);
 function captureInsertionReturn(){const tab=current();return compact&&shown()&&tab&&!document.hidden?{epoch:returnEpoch,tabId:tab.id,boardId:tab.boardId,scope:returnScope()}:null}
 function returnFromInsertion(context){const tab=current();if(!context||!tab||!compact||!shown()||document.hidden||context.epoch!==returnEpoch||context.tabId!==tab.id||context.boardId!==tab.boardId||context.scope!==returnScope()||document.querySelector('dialog[open],.board-frame.pane-modal'))return false;showCanvas();pane(tab)?.focus();return true}
 function sizing(){
  const next=innerWidth<=680&&model.narrowView!=='split';if(next!==compact){if(next)compactLibrary=open&&document.activeElement===explorerFrame;compact=next}
  let p;try{p=JSON.parse(localStorage.getItem('creative-interface')||'{}')}catch{p={}}
  const visible=shown(),covering=compact&&visible,width=Math.min(innerWidth*.45,Math.max(260,Math.min(520,dragWidth??p.width??340)));
  work.style.setProperty('--explorer-width',visible?width+'px':'0px');work.style.setProperty('--split-number',model.ratio/100);work.classList.toggle('explorer-overlay',covering);$('shellHeader').style.zoom=p.scale||1;work.style.height=(innerHeight-$('shellHeader').getBoundingClientRect().height)+'px';host.hidden=!visible;
  readingLayout();$('frameDeck').inert=covering&&!document.querySelector('.board-frame.pane-modal:not([hidden])');$('tabHeaders').inert=covering;
  const button=$('openBoards');button.setAttribute('aria-expanded',String(visible));button.setAttribute('aria-label',covering?'返回白板':'展开或收起内容与白板');button.title=covering?'返回白板':'内容与白板 · Ctrl+\\';
  if(button.dataset.returning!==String(covering)){button.dataset.returning=String(covering);button.innerHTML=covering?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12"/></svg>':sidebarIcon}
  layoutPaneFrames();
 }
 function showCanvas(){if(!compact||!compactLibrary)return;invalidateReturn();compactLibrary=false;sizing()}
 async function revealLibraryAsset(assetId,source){
  if(typeof assetId!=='string')return false;
  const tab=model.tabs.find(t=>frames.get(t.id)?.contentWindow===source);if(!tab||current()?.id!==tab.id)return false;
  let untouched=true;const sourceDoc=source.document,cancel=()=>untouched=false,events=['pointerdown','keydown','input','change','wheel','touchmove'];
  for(const type of events)sourceDoc.addEventListener(type,cancel,{capture:true,passive:true});
  try{
   invalidateReturn();const epoch=libraryRevealEpoch;panel='assetPane';open=true;compactLibrary=true;ensure();sizing();localStorage.setItem('creative-sidebar-state',JSON.stringify({open,tab:panel}));
   const active=()=>untouched&&epoch===libraryRevealEpoch&&current()?.id===tab.id&&frames.get(tab.id)?.contentDocument===sourceDoc&&shown()&&panel==='assetPane'&&!document.hidden&&!document.querySelector('dialog[open]');
   const started=Date.now();while(!explorer()){if(!active())return false;if(Date.now()-started>15000)throw Error('内容库未能打开');await new Promise(resolve=>setTimeout(resolve,50))}
   if(!active())return false;const ready=explorer();return typeof ready.revealAsset==='function'?await ready.revealAsset(assetId,active):await ready.show('assetPane');
  }finally{for(const type of events)sourceDoc.removeEventListener(type,cancel,true)}
 }
 function focusExplorer(){if(!compact||!shown())return;const field=explorerFrame?.contentDocument?.getElementById(panel==='assetPane'?'assetSearch':panel==='outline'?'search':'boardSearch');if(field&&!field.closest('[hidden]'))field.focus({preventScroll:true})}
 function ensure(){if(explorerFrame)return;explorerFrame=document.createElement('iframe');explorerFrame.id='explorerFrame';explorerFrame.title='内容与白板';explorerFrame.style.visibility='hidden';explorerFrame.setAttribute('aria-busy','true');explorerFrame.src='/index.html?pane=1&explorer=1&panel='+encodeURIComponent(panel);explorerFrame.onload=()=>{invalidateReturn('explorer-ready');trackReturnContext(explorerFrame.contentDocument);explorerFrame.style.removeProperty('visibility');explorerFrame.removeAttribute('aria-busy');lastOutlineKey='';const ready=explorer();if(ready)ready.show(ready.selection().panel||panel);sync();updateStatus();focusExplorer()};host.prepend(explorerFrame)}
 function sync(){clearTimeout(outlineTimer);outlineTimer=setTimeout(()=>{if(!open||drag||resizing||!explorer())return;const view=pane(current()),state=view?.state();if(!state){if(!current()){lastOutlineKey='';explorer().setBoard(null)}return}const key=JSON.stringify([state.boardId,state.name,state.revision,panel,panel==='outline'?view.selection():null]);if(key===lastOutlineKey)return;lastOutlineKey=key;explorer().setBoard(view.snapshot())},60)}
 function toggle(nextPanel){invalidateReturn();if(nextPanel){panel=nextPanel;open=true;compactLibrary=true}else if(compact&&!shown()){open=true;compactLibrary=true}else{open=!open;compactLibrary=open}if(open){ensure();explorer()?.show(panel);sync()}sizing();localStorage.setItem('creative-sidebar-state',JSON.stringify({open,tab:panel}));if(shown())focusExplorer();else pane(current())?.focus()}
 const narrowLayout=document.createElement('button');narrowLayout.id='narrowLayout';narrowLayout.onclick=()=>{model.narrowView=model.narrowView==='split'?'focus':'split';$('shellMore').open=false;renderTabs();if(!shown())pane(current())?.focus()};$('externalWindow').before(narrowLayout);
 const beforeRender=renderTabs;renderTabs=function(){beforeRender();const b=$('splitToggle');b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>';b.title=model.split?'合并分栏':'左右分栏';b.setAttribute('aria-label',b.title);narrowLayout.hidden=!model.split;narrowLayout.textContent=model.narrowView==='split'?'小窗口聚焦当前白板':'小窗口始终并排';sizing();if(open||!current())ensure();sync()};
 $('openBoards').onclick=()=>toggle();
 const beforeCommand=command;command=async function(name){if(compact&&shown()&&name!=='settings')showCanvas();if(name==='settings'){$('shellMore').open=false;return whiteboardAppearance.open()}if(name==='sidebar')return toggle();if(name==='ai'){const selection=open?explorer()?.selection():null;const view=pane(current()),state=view?.state(),usable=state?.boardId===current()?.boardId&&!state?.loading&&!!state?.boardId,target=usable?view:explorer();if(!usable)toggle(panel);return target?.command('ai',{libraryIds:selection?.ids||[],scope:selection?.panel==='assetPane'&&selection.ids.length?'library':null})}if(['help','search','recovery'].includes(name)){const view=pane(current()),state=view?.state();if(state?.loadError&&!state.loading){$('shellMore').open=false;try{return await view.command(name)}catch(error){return toast(error.message)}}if(!state?.boardId||state.loading){toggle(panel);return explorer()?.command(name)}}return beforeCommand(name)};
 window.addEventListener('message',async e=>{if(e.origin!==location.origin)return;const d=e.data;if(e.source===explorerFrame?.contentWindow){try{if(d?.type==='pane-ready'){explorerFrame.style.removeProperty('visibility');explorerFrame.removeAttribute('aria-busy')}else if(d?.type==='explorer-import-state')updateStatus();else if(d?.type==='explorer-catalog'){for(const t of model.tabs)pane(t)?.refreshLibrary()?.catch(err=>toast(err.message))}else if(d?.type==='explorer-dialog')explorerFrame.classList.toggle('explorer-modal',d.open);else if(d?.type==='explorer-toggle')toggle();else if(d?.type==='explorer-panel'){panel=d.panel;localStorage.setItem('creative-sidebar-state',JSON.stringify({open,tab:panel}));sync()}else if(d?.type==='explorer-shortcut')stepTab(d.reverse?-1:1);else if(d?.type==='explorer-selection'){libraryIds=d.ids;folder=d.folder;updateStatus()}else if(d?.type==='explorer-open'){boards=await api('/api/boards');openBoard(d.boardId)}else if(d?.type==='explorer-create'){await createBoard(d.name,model.side,d.folder||'');await explorer()?.refresh()}else if(d?.type==='explorer-place')await whiteboardLibraryTransfer.place(d,e.source);else if(d?.type==='explorer-focus'){showCanvas();pane(current())?.focusNode(d.nodeId);pane(current())?.focus()}else if(d?.type==='explorer-command'){showCanvas();await pane(current())?.command(d.command,{folder})}}catch(err){toast(err.message)}return}const tab=model.tabs.find(t=>frames.get(t.id)?.contentWindow===e.source);if(!tab)return;if(d?.type==='pane-dialog'){readingModes.set(frames.get(tab.id),{open:!!d.open,fullWindow:!!d.fullWindow});sizing()}else if(d?.type==='pane-library-reveal'){revealLibraryAsset(d.assetId,e.source).catch(err=>toast(err.message))}else if(d?.type==='pane-sidebar'){if(d.panel)toggle(d.panel);else toggle()}else if(['pane-state','pane-active'].includes(d?.type))sync()});
 $('splitter').onpointermove=e=>{if(!resizing)return;const r=$('frameDeck').getBoundingClientRect();model.ratio=Math.max(20,Math.min(80,(e.clientX-r.left)/r.width*100));renderTabs()};
 const grip=document.createElement('div');grip.id='explorerGrip';grip.setAttribute('role','separator');grip.setAttribute('aria-label','调整侧栏宽度');host.append(grip);
 grip.onpointerdown=e=>{if(e.button!==0)return;drag=true;dragWidth=host.getBoundingClientRect().width;grip.setPointerCapture(e.pointerId);work.classList.add('explorer-resizing');e.preventDefault()};grip.onpointermove=e=>{if(!drag)return;dragWidth=Math.max(260,Math.min(520,e.clientX));if(!sizeFrame)sizeFrame=requestAnimationFrame(()=>{sizeFrame=0;sizing()})};const stop=()=>{if(!drag)return;drag=false;cancelAnimationFrame(sizeFrame);sizeFrame=0;let p;try{p=JSON.parse(localStorage.getItem('creative-interface')||'{}')}catch{p={}}p.width=dragWidth;localStorage.setItem('creative-interface',JSON.stringify(p));dragWidth=null;work.classList.remove('explorer-resizing');sizing();sync()};grip.onpointerup=stop;grip.onpointercancel=stop;grip.onlostpointercapture=stop;
 window.addEventListener('storage',e=>{if(e.key==='creative-interface')sizing()});window.addEventListener('creative-appearance-sizing',sizing);window.addEventListener('resize',sizing);sizing();
 window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===explorerFrame?.contentWindow&&e.data?.type==='explorer-reveal-insertion')window.whiteboardLibraryTransfer?.reveal?.(e.data.requestId,e.source)});
 window.whiteboardWorkspace={toggle,explorer,sync,showCanvas,captureInsertionReturn,returnFromInsertion,revealAsset:revealLibraryAsset};
})();
