'use strict';
const $=id=>document.getElementById(id),uid=()=>crypto.randomUUID(),frames=new Map(),closingTabs=new Set();
let boards=[],model={tabs:[],active:{left:null,right:null},side:'left',split:false,ratio:50},pickerSide='left',pickerResolve=null,pickerEpoch=0,contextTab=null,dragTab=null,toastTimer,lastLayout='',layoutLoaded=false,savingTimer,savingTab='',savingSince=0;
let pickerFolders=null,tabFolderPending=false,tabFolderAttempted=false,tabFolderEpoch=0;
// Labels use catalog metadata only, never a canvas snapshot or a stored path.
function receiveTabLocations(value){
 if(Array.isArray(value.boards))boards=value.boards;
 if(Array.isArray(value.folders)){pickerFolders=value.folders;tabFolderEpoch++}
 renderTabs();
}
function tabLocations(){
 const counts=new Map(),locations=new Map(),folders=pickerFolders&&new Map(pickerFolders.map(f=>[f.id,f]));
 for(const tab of model.tabs)counts.set(tab.name,(counts.get(tab.name)||0)+1);
 let needsFolders=false;
 for(const tab of model.tabs)if(counts.get(tab.name)>1){
  const board=boards.find(b=>b.id===tab.boardId);
  locations.set(tab.id,board?pickerLocation(board,folders):'位置暂时无法读取');
  if(board?.folder&&!folders)needsFolders=true;
 }
 if(needsFolders&&!tabFolderPending&&!tabFolderAttempted){
  tabFolderPending=true;tabFolderAttempted=true;const epoch=tabFolderEpoch;
  api('/api/folders').then(value=>{if(epoch===tabFolderEpoch){pickerFolders=value.folders;tabFolderEpoch++}}).catch(()=>{}).finally(()=>{tabFolderPending=false;renderTabs()});
 }
 return locations;
}
let closedTab=null,pendingClosedView=null,closedIntent=0;
function clearPendingClosedView(){if(pendingClosedView)clearTimeout(pendingClosedView.timer);pendingClosedView=null}
function discardClosedTab(){const saved=closedTab;if(!saved)return;closedTab=null;clearTimeout(saved.timer);const focused=saved.notice.contains(document.activeElement);saved.notice.remove();if(focused&&!document.hidden)pane(current())?.focus()}
function positionClosedNotice(){if(closedTab)closedTab.notice.style.top=($('tabHeaders').getBoundingClientRect().bottom+(innerWidth<680?64:8))+'px'}
function rememberClosedTab(tab,index,view){
 discardClosedTab();clearPendingClosedView();
 const context=view?.captureClosedView?.()||null,notice=document.createElement('div');notice.id='closedTabNotice';notice.setAttribute('role','status');
 const label=document.createElement('span');label.textContent='已关闭：'+tab.name;label.title=label.textContent;
 const undo=document.createElement('button');undo.type='button';undo.textContent='撤销关闭';
 const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','收起关闭提示');notice.append(label,undo,dismiss);document.body.append(notice);
 const saved={tab:{...tab},index,context,notice};closedTab=saved;positionClosedNotice();saved.timer=setTimeout(discardClosedTab,20000);
 dismiss.onclick=()=>{discardClosedTab();pane(current())?.focus()};undo.onclick=()=>{
  if(closedTab!==saved)return;discardClosedTab();clearPendingClosedView();
  const existing=model.tabs.find(t=>t.boardId===saved.tab.boardId);if(existing){activate(existing.id);return}
  const tab={...saved.tab,side:model.split?saved.tab.side:'left'};
  if(saved.context){const row={tabId:tab.id,context:saved.context,intent:closedIntent,applying:false};pendingClosedView=row;row.timer=setTimeout(()=>{if(pendingClosedView===row)clearPendingClosedView()},20000)}
  model.tabs.splice(Math.min(saved.index,model.tabs.length),0,tab);model.side=tab.side;model.active[tab.side]=tab.id;window.whiteboardWorkspace?.showCanvas?.();createFrame(tab);renderTabs();
 };
}
async function applyClosedView(tab){
 const row=pendingClosedView,view=pane(tab),state=view?.state();if(!row||row.applying||row.tabId!==tab?.id||!state)return;
 if(state.loadError){clearPendingClosedView();return}if(state.loading||state.boardId!==tab.boardId)return;
 row.applying=true;
 try{
  const ready=await view.canvasReady();if(pendingClosedView!==row)return;
  if(row.intent!==closedIntent||current()?.id!==tab.id||document.hidden||document.querySelector('dialog[open]')){clearPendingClosedView();return}
  const restored=ready&&view.restoreClosedView(row.context);clearPendingClosedView();if(!restored)toast('已打开当前保存的内容；刚才的编辑位置未恢复。');
 }catch(error){if(pendingClosedView===row){clearPendingClosedView();toast('白板已重新打开，编辑位置未恢复。')}}
}
function cancelClosedViewIntent(){if(pendingClosedView){closedIntent++;clearPendingClosedView()}}
for(const type of ['pointerdown','keydown'])document.addEventListener(type,cancelClosedViewIntent,true);
window.addEventListener('message',e=>{if(pendingClosedView&&e.origin===location.origin&&e.data?.type==='pane-active'&&model.tabs.some(t=>frames.get(t.id)?.contentWindow===e.source))cancelClosedViewIntent()});
window.addEventListener('resize',positionClosedNotice);window.addEventListener('pagehide',()=>{discardClosedTab();clearPendingClosedView()});document.addEventListener('visibilitychange',()=>{if(document.hidden){discardClosedTab();clearPendingClosedView()}});
function toast(text){$('shellToast').textContent=text;$('shellToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('shellToast').hidden=true,4500)}
async function api(path,options){const r=await fetch(path,options);if(!r.ok){let value;try{value=await r.json()}catch{}throw Error(value?.error||'读取失败，请稍后再试')}return r.json()}
function saveLayout(){if(layoutLoaded){const url=new URL(location.href),tab=current();if(url.searchParams.has('board')){if(tab)url.searchParams.set('board',tab.boardId);else url.searchParams.delete('board');if(url.href!==location.href)window.history.replaceState(null,'',url)}}const value=JSON.stringify(model);if(value===lastLayout)return;try{sessionStorage.setItem('creative-board-tabs',value);localStorage.setItem('creative-board-tabs-last',value);lastLayout=value}catch{toast('浏览器未能记住布局；白板内容仍单独保存')}}
function pane(tab){try{return frames.get(tab?.id)?.contentWindow.whiteboardPane}catch{return null}}
function current(side=model.side){return model.tabs.find(t=>t.id===model.active[side])}
function revealTab(id){const item=Array.from(document.querySelectorAll('.tab[data-tab]')).find(el=>el.dataset.tab===id),list=item?.closest('.tabs');if(!list?.clientWidth)return;const tab=item.getBoundingClientRect(),bounds=list.getBoundingClientRect();if(tab.width>bounds.width||tab.left<bounds.left)list.scrollLeft+=tab.left-bounds.left;else if(tab.right>bounds.right)list.scrollLeft+=tab.right-bounds.right}
function revealActiveTabs(){for(const side of ['left','right'])if(side==='left'||model.split)revealTab(model.active[side])}
function normalizeLayout(){for(const side of ['left','right'])if(!model.tabs.some(t=>t.id===model.active[side]&&t.side===side))model.active[side]=model.tabs.find(t=>t.side===side)?.id||null;if(!model.split){for(const t of model.tabs)t.side='left';model.active.left=model.active.left||model.active.right||model.tabs[0]?.id||null;model.active.right=null;model.side='left'}model.ratio=Math.max(20,Math.min(80,Number(model.ratio)||50))}
function otherBoardIssues(){const active=current();return model.tabs.filter(tab=>tab.id!==active?.id).map(tab=>({tab,state:pane(tab)?.state()})).filter(({tab,state})=>state&&(state.boardId===tab.boardId||state.loadTargetId===tab.boardId)&&(state.blocked||state.saveError||state.loadError))}
function updateStatus(){
 applyClosedView(current());
 const t=current(),s=pane(t)?.state(),ready=!!s&&s.boardId===t?.boardId&&!s.loading,importing=!!(s?.pendingImports||window.whiteboardWorkspace?.explorer()?.pending?.()),pending=s?.contentDirty||s?.savingContent||importing;
 clearTimeout(savingTimer);if(!pending){savingSince=0;savingTab=''}else if(savingTab!==(t?.id||'library')){savingSince=Date.now();savingTab=t?.id||'library'}
 const slow=pending&&Date.now()-savingSince>=1000;
 const text=s?.restored?'已恢复 · 当前草稿保留':s?.deleted?'已删除 · 当前内容保留':s?.blocked?'有冲突 · 修改已保留':s?.saveError?'保存失败 · 请保留窗口':s?.loadError?'无法打开 · 可重试':(t&&!ready)?'正在打开…':slow?(importing?'正在添加素材…':'正在保存…'):t?'自动保存':'选择一张白板';
 const problems=otherBoardIssues(),localProblem=!!(s?.blocked||s?.saveError||s?.loadError),status=$('shellStatus');
 if(problems.length&&!localProblem){
  let button=status.querySelector('.other-board-issue');
  if(!button){button=document.createElement('button');button.type='button';button.className='other-board-issue';status.replaceChildren(button)}
  button.textContent='另有 '+problems.length+' 张待处理';
  button.setAttribute('aria-label','另有 '+problems.length+' 张白板保存或打开未完成，查看“'+problems[0].tab.name+'”');
  // Read the live collection on activation. A closed/replaced issue must never
  // send a delayed click back to an older tab, or retry its write implicitly.
  button.onclick=()=>{if(!button.isConnected||button.parentElement!==status)return;const next=otherBoardIssues()[0];if(next)activate(next.tab.id)};
  status.title='当前：'+text+'；另有 '+problems.length+' 张白板需处理，点击查看“'+problems[0].tab.name+'”';
 }else{
  if(status.querySelector('.other-board-issue')||status.textContent!==text)status.textContent=text;
  status.title=s?.loadError||((s?.saveError||s?.blocked)?'修改尚未保存，请先处理提示':importing?'正在把素材放入原先选定的位置':s?.dirty||s?.saving?'修改正在本机保存':'内容已保存到本机');
 }
 status.dataset.problem=String(localProblem||problems.length>0);
 if(pending&&!slow)savingTimer=setTimeout(updateStatus,1020-(Date.now()-savingSince));
 const title=(problems.length?'另有 '+problems.length+' 张待处理 · ':'')+(t?t.name+' · 创作白板':'创作白板');if(document.title!==title)document.title=title;
 for(const button of document.querySelectorAll('#shellHeader [data-command]')){const kind=button.dataset.command,source=window.whiteboardWorkspace?.explorer(),library=source?.selection();button.disabled=!ready&&kind!=='settings'&&!(['help','search','recovery'].includes(kind)&&(source||s?.loadError&&!s.loading))&&!(kind==='ai'&&library?.panel==='assetPane'&&library.ids.length)}updateTabStates()
}
function updateTabStates(){for(const item of document.querySelectorAll('.tab[data-tab]')){const t=model.tabs.find(t=>t.id===item.dataset.tab);if(!t)continue;const active=model.active[t.side]===t.id,s=pane(t)?.state();item.setAttribute('aria-current',String(active));item.querySelector('.tab-open').setAttribute('aria-selected',String(active));const mark=item.querySelector('.state');mark.textContent=s?.blocked||s?.saveError||s?.loadError?'!':'';mark.title=s?.loadError?'白板暂时无法读取':mark.textContent?'修改尚未保存':''}}
function layoutPaneFrames(){
 const focused=model.split&&model.narrowView!=='split'&&$('frameDeck').getBoundingClientRect().width<720;
 $('workspace').classList.toggle('workspace-focus',focused);$('workspace').dataset.focusSide=model.side;
 for(const t of model.tabs){const visible=(t.side==='left'||model.split)&&model.active[t.side]===t.id&&(!focused||t.side===model.side);if(visible&&!frames.has(t.id))createFrame(t);const frame=frames.get(t.id);if(!frame)continue;if(!visible)pane(t)?.setVisible(false);frame.hidden=!visible;frame.style.left=focused?'0':t.side==='right'?model.ratio+'%':'0';frame.style.width=focused||!model.split?'100%':t.side==='left'?model.ratio+'%':(100-model.ratio)+'%';frame.setAttribute('aria-hidden',String(!visible));if(visible)pane(t)?.setVisible(true)}
}
function renderTabs(){normalizeLayout();const locations=tabLocations();$('workspace').classList.toggle('has-tab-locations',locations.size>0);$('workspace').classList.toggle('is-split',model.split);$('workspace').style.setProperty('--split',model.ratio+'%');$('splitToggle').setAttribute('aria-pressed',String(model.split));$('splitToggle').textContent=model.split?'合并分栏':'左右分栏';$('splitter').setAttribute('aria-valuenow',String(Math.round(model.ratio)));
for(const side of ['left','right']){const group=document.querySelector('.tab-group[data-side='+side+']'),list=group.querySelector('.tabs'),scroll=list.scrollLeft;group.classList.toggle('active-pane',model.side===side);const tabs=model.tabs.filter(t=>t.side===side),key=JSON.stringify(tabs.map(t=>[t.id,t.name,locations.get(t.id)||'']));if(list.dataset.structure===key)continue;list.dataset.structure=key;list.replaceChildren();for(const t of tabs){const item=document.createElement('div');item.className='tab';item.dataset.tab=t.id;item.draggable=true;item.setAttribute('aria-current',String(model.active[side]===t.id));const open=document.createElement('button');open.className='tab-open';open.setAttribute('role','tab');open.setAttribute('aria-selected',String(model.active[side]===t.id));const location=locations.get(t.id);open.title=t.name+(location?'\n'+location:'');if(location){open.classList.add('with-location');open.setAttribute('aria-label',t.name+' · '+location);const label=document.createElement('span'),path=document.createElement('small');label.className='tab-name';label.textContent=t.name;path.className='tab-location';path.textContent=location;open.append(label,path)}else open.textContent=t.name;open.onclick=()=>activate(t.id);const state=document.createElement('span');state.className='state';const close=document.createElement('button');close.className='tab-close';close.textContent='×';close.setAttribute('aria-label','关闭标签：'+t.name+(location?' · '+location:''));close.onclick=()=>closeTab(t.id);item.append(open,state,close);item.oncontextmenu=e=>{e.preventDefault();contextTab=t.id;$('tabContext').hidden=false;$('tabContext').style.left=Math.min(e.clientX,innerWidth-170)+'px';$('tabContext').style.top=Math.min(e.clientY,innerHeight-100)+'px'};item.ondragstart=e=>{dragTab=t.id;e.dataTransfer.setData('application/x-creative-tab',t.id);e.dataTransfer.effectAllowed='move';$('workspace').classList.add('tab-dragging')};item.ondragend=()=>{dragTab=null;$('workspace').classList.remove('tab-dragging')};item.ondragover=e=>{if(dragTab)e.preventDefault()};item.ondrop=e=>{e.preventDefault();e.stopPropagation();moveTab(dragTab,side,t.id)};list.append(item)}list.scrollLeft=scroll}
layoutPaneFrames();for(const t of model.tabs){const frame=frames.get(t.id);if(frame)frame.title=t.name+(locations.has(t.id)?' · '+locations.get(t.id):'')}
for(const side of ['left','right'])document.querySelector('.empty-pane[data-side='+side+']').hidden=!!current(side);updateStatus();saveLayout();revealActiveTabs()}
// Layout and opening can reach the same tab synchronously; retain its mounted document.
function createFrame(t){if(frames.has(t.id))return frames.get(t.id);const f=document.createElement('iframe');f.className='board-frame';f.dataset.tabId=t.id;f.title=t.name;f.hidden=true;f.style.visibility='hidden';f.setAttribute('aria-busy','true');frames.set(t.id,f);f.src='/index.html?pane=1&board='+encodeURIComponent(t.boardId)+'&tabId='+t.id;f.onload=()=>{f.style.removeProperty('visibility');f.removeAttribute('aria-busy');renderTabs();if(current()?.id===t.id&&!document.querySelector('dialog[open]')&&!$('frameDeck').inert)pane(t)?.focus()};$('frameDeck').append(f)}
function openBoard(id,side=model.side,requestedDocument=null){const b=boards.find(b=>b.id===id)||requestedDocument;if(!b){toast('这张白板已经不存在，请重新选择');return}if(closedTab?.tab.boardId===id)discardClosedTab();const existing=model.tabs.find(t=>t.boardId===id);if(existing){if(existing.side!==side)moveTab(existing.id,side);else activate(existing.id);return}if(side==='right')model.split=true;const t={id:uid(),boardId:id,name:b.name,side};model.tabs.push(t);model.active[side]=t.id;model.side=side;window.whiteboardWorkspace?.showCanvas?.();createFrame(t);renderTabs()}
function activate(id){const t=model.tabs.find(t=>t.id===id);if(!t)return;const old=current();if(old&&old.id!==id)pane(old)?.flush().catch(()=>{});model.side=t.side;model.active[t.side]=id;window.whiteboardWorkspace?.showCanvas?.();renderTabs();pane(t)?.focus()}
async function closeTab(id){
 const tab=model.tabs.find(tab=>tab.id===id);if(!tab||closingTabs.has(id))return;
 closingTabs.add(id);const button=document.querySelector('.tab[data-tab="'+id+'"] .tab-close');if(button)button.disabled=true;
 try{
  const view=pane(tab);
  if(view?.state().pendingImports)toast('素材正在添加，完成并保存后关闭此标签。');
  if(view&&!await view.flush()){activate(id);toast('这张白板还有未保存的修改。请先另存或处理冲突，再关闭标签。');return}
  const index=model.tabs.indexOf(tab);if(index===-1)return;
  rememberClosedTab(tab,index,view);
  frames.get(id)?.remove();frames.delete(id);model.tabs.splice(index,1);
  if(model.active[tab.side]===id){const next=model.tabs.slice(0,index).reverse().find(item=>item.side===tab.side)||model.tabs.find(item=>item.side===tab.side);model.active[tab.side]=next?.id||null}
  renderTabs();pane(current())?.focus();
 }catch(error){toast(error.message)}
 finally{closingTabs.delete(id);if(button?.isConnected)button.disabled=false}
}
// Explicit resource recovery reuses the same tab and the existing guarded view restore.
// Never reload another pane or replace a writer whose save/import is unfinished.
window.whiteboardShellResources=Object.freeze({async reopen(source){
 const tab=model.tabs.find(t=>frames.get(t.id)?.contentWindow===source),frame=tab&&frames.get(tab.id),view=tab&&pane(tab);
 if(!tab||current()!==tab||closingTabs.has(tab.id)||!view)return false;
 closingTabs.add(tab.id);
 const events=new AbortController(),revision=view.state().revision;let continued=false;
 for(const type of ['pointerdown','keydown','input','compositionstart'])source.document.addEventListener(type,()=>{continued=true},{capture:true,signal:events.signal});
 try{
  const owns=()=>!continued&&view.state().revision===revision&&model.tabs.includes(tab)&&current()===tab&&frames.get(tab.id)===frame&&pane(tab)===view;
  const state=view.state();if(state.loading||state.boardId!==tab.boardId||state.pendingImports||state.blocked)return false;
  if(!await view.flush()||!owns())return false;
  // Fresh hosted entry URLs already bind the original account and workspace.
  if(source.whiteboardHosted&&!await source.whiteboardHosted.checkIdentity())return false;
  if(!owns())return false;
  const latest=view.state();if(latest.dirty||latest.saving||latest.saveError||latest.blocked||latest.pendingImports||latest.loading||latest.boardId!==tab.boardId)return false;
  const context=view.captureClosedView();if(!context)return false;
  discardClosedTab();clearPendingClosedView();
  const row={tabId:tab.id,context,intent:closedIntent,applying:false};pendingClosedView=row;row.timer=setTimeout(()=>{if(pendingClosedView===row)clearPendingClosedView()},20000);
  frame.remove();frames.delete(tab.id);createFrame(tab);renderTabs();return true;
 }finally{events.abort();closingTabs.delete(tab.id)}
}});
function moveTab(id,side,before){const t=model.tabs.find(t=>t.id===id);if(!t)return;const old=t.side;if(side==='right')model.split=true;if(before&&before!==id){model.tabs=model.tabs.filter(n=>n.id!==id);model.tabs.splice(Math.max(0,model.tabs.findIndex(n=>n.id===before)),0,t)}t.side=side;if(old!==side&&model.active[old]===id)model.active[old]=model.tabs.find(n=>n.side===old)?.id||null;model.active[side]=id;model.side=side;dragTab=null;$('workspace').classList.remove('tab-dragging');renderTabs();pane(t)?.focus()}
function toggleSplit(){if(model.split){const keep=current()?.id;for(const t of model.tabs)t.side='left';model.split=false;model.active.left=keep||model.active.left;model.side='left'}else{model.split=true;const active=current();if(model.tabs.filter(t=>t.side==='left').length>1&&active){moveTab(active.id,'right');return}}renderTabs()}
async function picker(side=model.side,purpose=null){
 const epoch=++pickerEpoch;pickerResolve?.(null);pickerResolve=null;pickerSide=side;
 const [boardResult,folderResult]=await Promise.allSettled([api('/api/boards'),api('/api/folders')]);
 if(epoch!==pickerEpoch)return null;
 if(boardResult.status==='rejected'){toast(boardResult.reason.message);return null}
 boards=boardResult.value;pickerFolders=folderResult.status==='fulfilled'?folderResult.value.folders:null;tabFolderEpoch++;renderTabs();
 $('boardQuery').value='';$('newBoardName').value='';$('boardPicker').querySelector('h2').textContent=purpose?.title||'打开白板';
 $('pickerHint').hidden=!purpose;$('pickerHint').textContent=purpose?.hint||'在'+(side==='right'?'右':'左')+'侧打开；已打开的白板会使用原标签。';
 const answer=purpose?new Promise(resolve=>pickerResolve=resolve):null;
 drawChoices();if(!$('boardPicker').open)$('boardPicker').showModal();$(purpose?.focusNew?'newBoardName':'boardQuery').focus();return answer;
}
function finishPicker(id,side=pickerSide){const resolve=pickerResolve;pickerResolve=null;$('boardPicker').close();openBoard(id,side);resolve?.(model.tabs.find(t=>t.boardId===id)||null)}
$('boardPicker').addEventListener('close',()=>{if(!$('boardPicker').open){const resolve=pickerResolve;pickerResolve=null;resolve?.(null);pane(current())?.focus()}});
function pickerLocation(board,folders){
 if(!board.folder)return '我的白板';
 if(!folders)return '位置暂时无法读取';
 const parts=[],seen=new Set();let id=board.folder;
 while(id&&!seen.has(id)){
  seen.add(id);const folder=folders.get(id);
  if(!folder){parts.unshift('原文件夹不存在');break}
  parts.unshift(folder.name);id=folder.parent;
 }
 return parts.join(' › ');
}
function drawChoices(){
 const list=$('boardChoices');list.replaceChildren();const q=$('boardQuery').value.trim().toLowerCase(),folders=pickerFolders&&new Map(pickerFolders.map(f=>[f.id,f]));
 for(const b of boards){
  const location=pickerLocation(b,folders);if(![b.name,location].join(' ').toLowerCase().includes(q))continue;
  const btn=document.createElement('button'),name=document.createElement('span'),path=document.createElement('small'),meta=document.createElement('small');
  name.className='board-choice-name';name.textContent=b.name;
  path.className='board-choice-location';path.textContent=location;path.title=location;
  meta.className='board-choice-state';meta.textContent=model.tabs.some(t=>t.boardId===b.id)?'已打开':b.count+' 块内容';
  btn.title=b.name+'\n'+location;btn.dataset.boardChoice=b.id;btn.append(name,meta,path);btn.onclick=()=>finishPicker(b.id);list.append(btn);
 }
 if(!list.children.length)list.textContent='没有找到，可以新建一张白板。';
}
async function createBoard(name,side,folder="",show=true){const id=uid(),data={format:'creative-board',version:1,name:name||'未命名白板',folder,nodes:[],edges:[],view:{x:80,y:80,z:1}};await api('/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(data)});boards.push({id,name:data.name,folder:data.folder,count:0});if(show)openBoard(id,side);return id}
async function command(name){const t=current(),view=pane(t);if(!view||view.state().loading||view.state().boardId!==t.boardId)return toast('白板还在打开，请稍等');$('shellMore').open=false;try{await view.command(name)}catch(e){toast(e.message)}}
function stepTab(offset){const tabs=model.tabs.filter(t=>t.side===model.side);if(!tabs.length)return;const index=tabs.findIndex(t=>t.id===model.active[model.side]);activate(tabs[(index+offset+tabs.length)%tabs.length].id)}
window.addEventListener('message',async e=>{if(e.origin!==location.origin)return;const tab=model.tabs.find(t=>frames.get(t.id)?.contentWindow===e.source);if(!tab)return;const d=e.data;if(d?.type==='pane-board-locations'){receiveTabLocations(d)}else if(d?.type==='pane-ready'){const frame=frames.get(tab.id);frame.style.removeProperty('visibility');frame.removeAttribute('aria-busy')}else if(d?.type==='pane-state'){if(d.state?.boardId===tab.boardId){const name=d.state.name||tab.name;if(name!==tab.name){tab.name=name;renderTabs()}else updateStatus()}else if(d.state?.loadTargetId===tab.boardId)updateStatus()}else if(d?.type==='pane-active'){if(model.active[tab.side]===tab.id&&document.activeElement===frames.get(tab.id)){$('shellMore').open=false;$('tabContext').hidden=true;model.side=tab.side;document.querySelectorAll('.tab-group').forEach(el=>el.classList.toggle('active-pane',el.dataset.side===tab.side));updateStatus();saveLayout()}}else if(d?.type==='pane-open'){try{boards=await api('/api/boards');openBoard(d.boardId,tab.side)}catch(err){toast(err.message)}}else if(d?.type==='pane-shortcut'){model.side=tab.side;stepTab(d.reverse?-1:1)}else if(d?.type==='pane-split'){model.side=tab.side;toggleSplit()}else if(d?.type==='pane-import-notice')toast(d.text);else if(d?.type==='pane-picker')picker(tab.side)});
$('openBoards').onclick=()=>current()?command('sidebar'):picker();$('boardQuery').oninput=drawChoices;document.querySelectorAll('.add-tab,.choose-board').forEach(b=>b.onclick=()=>picker(b.dataset.side));$('createBoard').onclick=async()=>{const button=$('createBoard');if(button.disabled)return;const epoch=pickerEpoch,side=pickerSide,name=$('newBoardName').value.trim();button.disabled=true;$('newBoardName').disabled=true;try{const id=await createBoard(name,side,'',false);if(epoch===pickerEpoch&&$('boardPicker').open)finishPicker(id,side);else{toast('白板已创建，可在白板列表中打开。');if($('boardPicker').open)drawChoices()}}catch(e){toast(e.message)}finally{button.disabled=false;$('newBoardName').disabled=false}};$('newBoardName').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){$('createBoard').click();e.preventDefault()}};$('splitToggle').onclick=toggleSplit;
document.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>command(b.dataset.command));document.querySelectorAll('[data-tab-action]').forEach(b=>b.onclick=()=>{const id=contextTab;$('tabContext').hidden=true;if(b.dataset.tabAction==='close')closeTab(id);else{const t=model.tabs.find(t=>t.id===id);if(t)moveTab(id,t.side==='left'?'right':'left')}});document.addEventListener('pointerdown',e=>{if(!e.target.closest('#shellMore'))$('shellMore').open=false;if(!e.target.closest('#tabContext'))$('tabContext').hidden=true});
document.querySelectorAll('.tab-group').forEach(el=>{el.addEventListener('dragover',e=>{if(dragTab)e.preventDefault()});el.addEventListener('drop',e=>{if(dragTab){e.preventDefault();moveTab(dragTab,el.dataset.side)}});el.addEventListener('pointerdown',()=>{model.side=el.dataset.side;updateStatus()})});$('rightDropTarget').ondragover=e=>e.preventDefault();$('rightDropTarget').ondrop=e=>{e.preventDefault();moveTab(dragTab,'right')};
let resizing=false;const divider=$('splitter');divider.onpointerdown=e=>{if(e.button!==0)return;resizing=true;e.preventDefault();divider.setPointerCapture(e.pointerId);$('workspace').classList.add('resizing')};divider.onpointermove=e=>{if(!resizing)return;const r=$('workspace').getBoundingClientRect();model.ratio=Math.max(20,Math.min(80,(e.clientX-r.left)/r.width*100));renderTabs()};const endResize=()=>{resizing=false;$('workspace').classList.remove('resizing');saveLayout()};divider.onpointerup=endResize;divider.onpointercancel=endResize;divider.onlostpointercapture=endResize;divider.ondblclick=()=>{model.ratio=50;renderTabs()};divider.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();model.ratio=e.key==='Home'?50:model.ratio+(e.key==='ArrowLeft'?-2:2);renderTabs()};
$('externalWindow').onclick=async()=>{const t=current();if(!t)return;const w=window.open('about:blank','_blank','popup,width=1200,height=850');if(!w)return toast('请允许本站打开新窗口');try{if(!await pane(t).flush()){w.close();return toast('请先处理未保存修改')}w.location.replace('/?board='+encodeURIComponent(t.boardId));$('shellMore').open=false}catch(e){w.close();toast(e.message)}};
window.addEventListener('keydown',e=>{if(e.isComposing||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){$('shellMore').open=false;$('tabContext').hidden=true;return}if((e.ctrlKey||e.metaKey)&&e.key==='Tab'){e.preventDefault();stepTab(e.shiftKey?-1:1)}});window.addEventListener('beforeunload',e=>{if(window.whiteboardWorkspace?.explorer()?.pending?.()||model.tabs.some(t=>{const s=pane(t)?.state();return s?.dirty||s?.saving||s?.pendingImports})){e.preventDefault();e.returnValue=''}});
const tabResize=new ResizeObserver(revealActiveTabs);
for(const list of document.querySelectorAll('.tabs')){tabResize.observe(list);list.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey||Math.abs(e.deltaX)>=Math.abs(e.deltaY)||list.scrollWidth<=list.clientWidth)return;const step=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?list.clientWidth:1),next=Math.max(0,Math.min(list.scrollWidth-list.clientWidth,list.scrollLeft+step));if(next===list.scrollLeft)return;e.preventDefault();list.scrollLeft=next},{passive:false})}
(async()=>{
 const params=new URLSearchParams(location.search),requested=params.get('board'),creating=params.get('create')==='1',initialPickerEpoch=pickerEpoch;
 try{
  try{boards=await api('/api/boards')}catch(error){if(!requested)throw error;toast('白板列表暂时未能读取：'+error.message)}
  layoutLoaded=true;let saved,sessionLayout;try{sessionLayout=JSON.parse(sessionStorage.getItem('creative-board-tabs')||'null');saved=sessionLayout||JSON.parse(localStorage.getItem('creative-board-tabs-last')||'null')}catch{}
  // A fresh board link starts alone; reloading its own window keeps the work arranged there.
  const returning=performance.getEntriesByType('navigation')[0]?.type==='reload'&&sessionLayout&&Array.isArray(sessionLayout.tabs)&&sessionLayout.tabs.some(t=>t.id===sessionLayout.active?.[sessionLayout.side||'left']&&t.boardId===requested);
  if(requested&&!returning){openBoard(requested,'left',{name:'指定的白板'})}
  else if(saved&&Array.isArray(saved.tabs)){
   model={...model,...saved,tabs:saved.tabs.filter(t=>boards.some(b=>b.id===t.boardId)).map(t=>({...t,side:t.side==='right'?'right':'left',name:boards.find(b=>b.id===t.boardId).name})),active:saved.active||{left:null,right:null}};
   const seen=new Set();model.tabs=model.tabs.filter(t=>{if(seen.has(t.boardId))return false;seen.add(t.boardId);return true});normalizeLayout();renderTabs();
  }else if(boards.length){const last=localStorage.getItem('creative-board-last');openBoard(boards.some(b=>b.id===last)?last:boards[0].id,'left')}
  else if(!creating)await createBoard('我的白板','left');
  else renderTabs();
  if(creating){const url=new URL(location.href);url.searchParams.delete('create');window.history.replaceState(null,'',url);if(pickerEpoch===initialPickerEpoch&&!document.querySelector('dialog[open]'))await picker(model.side,{title:'新建白板',hint:'填写名称后新建；也可以选择已有白板。取消不会新增内容。',focusNew:true})}
 }catch(error){layoutLoaded=true;toast(error.message);renderTabs()}
})();

window.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)e.preventDefault()},{passive:false});
window.addEventListener('keydown',e=>{
 if(e.isComposing||document.querySelector('dialog[open]')||!(e.ctrlKey||e.metaKey))return;
 if(e.key.toLowerCase()==='k'){e.preventDefault();e.stopImmediatePropagation();command('search')}
 else if(e.key==='\\'){e.preventDefault();e.stopImmediatePropagation();window.whiteboardWorkspace?.toggle()}
});

// Named board pairs remember navigation, never document contents or hidden tabs.
(()=>{
 const key='creative-board-pairs',limit=12;let dialog=null;
 const entry=document.createElement('button');entry.type='button';entry.id='boardPairs';entry.textContent='白板组合';document.querySelector('#shellMore>div').append(entry);
 const style=document.createElement('style');style.textContent='.board-pairs{width:min(560px,calc(100vw - 28px));max-height:calc(100dvh - 28px);overflow:auto;border:1px solid var(--ui-line,#ccc);border-radius:10px;padding:22px;background:var(--ui-panel,#faf9f5);color:var(--ui-text,#30302c)}.board-pairs::backdrop{background:#0005}.board-pairs h2{font-size:22px;margin:0 0 8px}.board-pairs p{line-height:1.7}.board-pairs label{display:block}.board-pairs input{display:block;width:100%;padding:10px;margin:6px 0}.board-pairs button{min-height:44px;white-space:normal}.board-pairs-list{display:grid;gap:8px;margin:18px 0}.board-pair-row{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:6px}.board-pair-row button{text-align:left;padding:12px;overflow-wrap:anywhere}.board-pair-row small{display:block;opacity:.7;margin-top:5px}.board-pair-remove{text-align:center!important;padding:6px!important}.board-pairs-actions{display:flex;justify-content:space-between;gap:10px}.board-pairs-message{min-height:1.7em}.board-pairs-current{font-size:13px;opacity:.75}.board-pairs-undo{margin-left:8px}';document.head.append(style);
 const id=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!/[\u0000-\u001f]/.test(value);
 function valid(row){return row&&id(row.id)&&typeof row.name==='string'&&row.name.trim()===row.name&&row.name.length>0&&row.name.length<=40&&id(row.left)&&typeof row.split==='boolean'&&(row.split?id(row.right)&&row.right!==row.left:row.right===null)&&Number.isFinite(row.ratio)&&row.ratio>=20&&row.ratio<=80&&['left','right'].includes(row.side)&&(!row.split?row.side==='left':true)&&['focus','split'].includes(row.narrowView)}
 function read(){
  try{const raw=localStorage.getItem(key);if(raw===null)return {value:{format:'creative-board-pairs',version:1,pairs:[]},raw};if(raw.length>65536)throw Error();const value=JSON.parse(raw);if(value?.format!=='creative-board-pairs'||value.version!==1||!Array.isArray(value.pairs)||value.pairs.length>limit||!value.pairs.every(valid)||new Set(value.pairs.map(row=>row.id)).size!==value.pairs.length||new Set(value.pairs.map(row=>row.name)).size!==value.pairs.length)throw Error();return {value,raw}}catch{return {error:'浏览器中的组合记录暂时无法读取，原记录保留。'}}
 }
 function write(value){const raw=JSON.stringify(value);try{localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)return '组合已在别处改变，请重新查看。';return ''}catch{return '浏览器未能保存组合，请稍后重试。'}}
 function capture(){const left=current('left'),right=model.split?current('right'):null;return {left:left?.boardId||null,right:right?.boardId||null,split:model.split,ratio:model.ratio,side:model.split?model.side:'left',narrowView:model.narrowView==='split'?'split':'focus'}}
 function ready(value){return [value.left,value.split?value.right:null].filter(Boolean).every(id=>{const tab=model.tabs.find(t=>t.boardId===id),state=tab&&pane(tab)?.state();return state?.boardId===id&&!state.loading&&!state.loadError})&&!!value.left&&(!value.split||!!value.right)}
 function name(id){return model.tabs.find(t=>t.boardId===id)?.name||boards.find(b=>b.id===id)?.name||'原白板暂时不可用'}
 entry.onclick=()=>{
  if(!entry.isConnected||dialog?.open||document.hidden||window.whiteboardHosted?.paused)return;$('shellMore').open=false;
  const d=document.createElement('dialog');dialog=d;d.className='board-pairs';d.setAttribute('aria-label','白板组合');const opening=capture(),scope=window.whiteboardHosted||null;let busy=false,undo=null;
  d.innerHTML='<h2>白板组合</h2><p>记住当前显示的白板与分栏，其他标签继续保留。组合只存在本浏览器，白板内容按原方式保存。</p><p class="board-pairs-current"></p><div class="board-pairs-list"></div><label>组合名称<input maxlength="40" aria-label="组合名称" autocomplete="off"></label><div class="board-pairs-actions"><button type="button" data-pair-save>记住当前组合</button><button type="button" data-pair-close>返回白板</button></div><p role="status" class="board-pairs-message"></p>';
  const list=d.querySelector('.board-pairs-list'),input=d.querySelector('input'),save=d.querySelector('[data-pair-save]'),status=d.querySelector('[role=status]');
  d.querySelector('.board-pairs-current').textContent='当前：'+[opening.left,opening.right].filter(Boolean).map(name).join(' · ');
  const owns=()=>dialog===d&&d.isConnected&&d.open&&(window.whiteboardHosted||null)===scope&&!scope?.paused;
  function message(text,action){status.textContent=text;if(action){const b=document.createElement('button');b.type='button';b.className='board-pairs-undo';b.textContent='撤销移除';b.onclick=()=>{if(owns()&&!busy)action()};status.append(b)}}
  function paint(){
   const store=read();list.replaceChildren();save.disabled=busy||!!store.error||!ready(opening);input.disabled=busy;
   if(store.error){message(store.error);return}
   if(!store.value.pairs.length){const empty=document.createElement('small');empty.textContent='常用的对照搭好后，可以记在这里。';list.append(empty)}
   for(const row of store.value.pairs){
    const line=document.createElement('div'),open=document.createElement('button'),remove=document.createElement('button'),title=document.createElement('span'),description=document.createElement('small');line.className='board-pair-row';open.type=remove.type='button';open.dataset.boardPairId=row.id;open.setAttribute('aria-label','打开组合：'+row.name);title.textContent=row.name;description.textContent=[row.left,row.right].filter(Boolean).map(name).join(' · ');open.append(title,description);open.disabled=remove.disabled=busy;remove.className='board-pair-remove';remove.textContent='×';remove.setAttribute('aria-label','移除组合：'+row.name);
    open.onclick=async()=>{
     if(!owns()||busy||!open.isConnected)return;const initial=read();if(initial.error||JSON.stringify(initial.value.pairs.find(value=>value.id===row.id))!==JSON.stringify(row)){paint();message('组合已有变化，请重新选择。');return}
     busy=true;undo=null;message('');paint();const intent=JSON.stringify(capture());
     try{
      const fresh=await api('/api/boards');if(!owns()||JSON.stringify(capture())!==intent)return;
      const latest=read();if(latest.error||JSON.stringify(latest.value.pairs.find(value=>value.id===row.id))!==JSON.stringify(row)){paint();message('组合已有变化，请重新选择。');return}
      if(!Array.isArray(fresh)||[row.left,row.right].filter(Boolean).some(id=>!fresh.some(value=>value.id===id))){message('组合中有白板暂时不可用，当前标签保留。');return}
      boards=fresh;openBoard(row.left,'left');if(row.right)openBoard(row.right,'right');model.split=row.split;model.ratio=row.ratio;model.narrowView=row.narrowView;model.side=row.side;renderTabs();d.close();
     }catch{if(owns())message('暂时无法打开组合，请稍后重试。')}
     finally{busy=false;if(owns())paint()}
    };
    remove.onclick=()=>{
     if(!owns()||busy||!remove.isConnected)return;const latest=read();if(latest.error)return message(latest.error);const at=latest.value.pairs.findIndex(value=>value.id===row.id);if(at<0||JSON.stringify(latest.value.pairs[at])!==JSON.stringify(row)){paint();return message('组合已有变化，请重新选择。')}
     latest.value.pairs.splice(at,1);const error=write(latest.value);if(error){paint();return message(error)}undo={row,index:at};paint();message('已移除“'+row.name+'”，白板保留。',()=>{
      if(!undo||undo.row!==row)return;const current=read();if(current.error)return message(current.error);if(current.value.pairs.length>=limit||current.value.pairs.some(value=>value.id===row.id||value.name===row.name)){paint();return message('组合已有后续变化，未覆盖。')}
      current.value.pairs.splice(Math.min(undo.index,current.value.pairs.length),0,row);const error=write(current.value);if(error)return message(error);undo=null;paint();message('已恢复“'+row.name+'”。');
     });
    };line.append(open,remove);list.append(line);
   }
  }
  save.onclick=()=>{
   if(!owns()||busy)return;const label=input.value.trim();if(!label){message('先给这组白板起个名字。');input.focus();return}if(JSON.stringify(capture())!==JSON.stringify(opening)||!ready(opening))return message('当前白板组合已有变化，请重新打开后再记住。');
   const store=read();if(store.error)return message(store.error);if(store.value.pairs.some(row=>row.name===label))return message('名称已存在，请换个名称。');if(store.value.pairs.length>=limit)return message('已记住12组，请先移除一组。');
   store.value.pairs.push({id:uid(),name:label,...opening});const error=write(store.value);if(error)return message(error);input.value='';undo=null;paint();message('已记住“'+label+'”。');
  };
  input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();save.click()}};d.querySelector('[data-pair-close]').onclick=()=>d.close();
  const storage=event=>{if(owns()&&event.key===key){undo=null;paint()}};window.addEventListener('storage',storage);
  d.addEventListener('close',()=>{window.removeEventListener('storage',storage);d.remove();if(dialog===d)dialog=null;const tab=current();queueMicrotask(()=>{if(current()===tab&&document.hasFocus()&&!document.hidden&&!document.querySelector('dialog[open]'))pane(tab)?.focus()})},{once:true});document.body.append(d);d.showModal();paint();if(!save.disabled)input.focus();else d.querySelector('[data-pair-close]').focus();
 };
})();

// A deliberate alternative keeps the mounted original available to return to.
(() => {
 'use strict';
 const menu=document.querySelector('#shellMore>div');if(!menu)return;let dialog=null;
 const entry=document.createElement('button');entry.type='button';entry.id='boardVariant';entry.textContent='另起一版';menu.insertBefore(entry,menu.querySelector('[data-command=export]'));
 const scope=host=>({host:host||null,key:host?JSON.stringify([host.account?.id,host.workspace,host.base]):''});
 const same=(saved,host)=>saved.host===(host||null)&&saved.key===scope(host).key&&!host?.paused;
 entry.onclick=()=>{
  if(!entry.isConnected||dialog?.open||document.hidden||document.querySelector('dialog[open]'))return;
  const tab=current(),frame=tab&&frames.get(tab.id),view=tab&&pane(tab),source=frame?.contentWindow,sourceDocument=frame?.contentDocument;
  const shellScope=scope(window.whiteboardHosted),writerScope=scope(source?.whiteboardHosted),side=tab?.side;
  const ready=()=>{const state=view?.state();return state?.boardId===tab?.boardId&&!state.loading&&!state.loadError&&!state.blocked&&!state.saveError&&!state.deleted};
  if(!tab||!view||!ready()||shellScope.key!==writerScope.key||!same(shellScope,window.whiteboardHosted)||!same(writerScope,source.whiteboardHosted))return toast('先在当前白板处理打开或保存提示，再另起一版。');
  $('shellMore').open=false;const d=document.createElement('dialog');dialog=d;d.className='board-variant';d.setAttribute('aria-label','另起一版');let busy=false,committed=false,attempt=null,changedSaved=false;
  d.innerHTML='<h2>另起一版</h2><p>把当前内容、连线与摆放另存到新白板，原标签保留，可随时回去。两版各自编辑，媒体仍共用原文件，已有跳转保留原目的地。</p><label>新版本名称<input aria-label="新版本名称" maxlength="120" autocomplete="off"></label><div class="board-variant-actions"><button type="button" data-variant-close>返回原稿</button><button type="button" data-variant-create>创建并打开新版本</button></div><p role="status"></p>';
  const input=d.querySelector('input'),create=d.querySelector('[data-variant-create]'),status=d.querySelector('[role=status]');input.value=(view.state().name+'（新方案）').slice(0,120);
  const owner=()=>model.tabs.includes(tab)&&current()===tab&&tab.side===side&&frames.get(tab.id)===frame&&frame.contentDocument===sourceDocument&&pane(tab)===view&&same(shellScope,window.whiteboardHosted)&&same(writerScope,source.whiteboardHosted)&&ready();
  const owns=()=>dialog===d&&d.isConnected&&d.open&&owner()&&!document.hidden;
  const message=text=>status.textContent=text;
  const signature=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  function selectionPlan(){
   const snapshot=view.snapshot(),ids=snapshot?.selected;
   if(snapshot?.boardId!==tab.boardId||!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||snapshot.board.nodes.filter(n=>n.id===id).length!==1)||typeof source.selectionBundle!=='function')return null;
   const frames=snapshot.board.nodes.filter(n=>ids.includes(n.id)&&n.type==='frame');if(frames.some(f=>snapshot.board.nodes.some(n=>n.type==='frame'&&n.id!==f.id&&n.x>=f.x&&n.x<f.x+f.w&&n.y>=f.y&&n.y<f.y+f.h)))return null;
   const bundle=source.selectionBundle(),nodeIds=new Set(bundle.nodes.map(n=>n.id));
   if(!bundle.nodes.length||nodeIds.size!==bundle.nodes.length||bundle.nodes.some(n=>typeof n.id!=='string')||bundle.edges.some(e=>!nodeIds.has(e.from)||!nodeIds.has(e.to)))return null;
   return {selected:ids.slice().sort(),bundle};
  }
  const plan=selectionPlan(),planSignature=plan&&signature(plan);let range=null;
  if(plan){
   const label=document.createElement('label'),preview=document.createElement('section'),summary=document.createElement('p'),list=document.createElement('ul');label.textContent='取用范围';range=document.createElement('select');range.setAttribute('aria-label','取用范围');range.innerHTML='<option value="board">当前整张白板</option><option value="selection">只取当前选中内容</option>';label.append(range);preview.className='board-variant-selection';preview.hidden=true;preview.setAttribute('aria-label','选中内容范围');
   summary.textContent='本次共 '+plan.bundle.nodes.length+' 块、其中 '+plan.bundle.edges.length+' 条连线。连向其他内容的线不会复制；已有跳转保留原目的地。';
   for(const n of plan.bundle.nodes.slice(0,10)){const row=document.createElement('li'),title=document.createElement('b'),detail=document.createElement('small');title.textContent=n.title||'未命名内容';const text=String(n.body||n.userText||n.annotation||(n.type==='table'?(n.columns||[]).join(' · '):'')||'');detail.textContent=(n.type==='frame'?'分组':n.type==='table'?'表格':n.type==='image'?'图片':n.mediaId?'音视频':n.assetId?'文件':'便签')+(text?' · '+text.slice(0,100)+(text.length>100?'…':''):'');row.append(title,detail);list.append(row)}
   if(plan.bundle.nodes.length>10){const more=document.createElement('li');more.textContent='还有 '+(plan.bundle.nodes.length-10)+' 块，按当前选中范围一并保留。';list.append(more)}preview.append(summary,list);input.parentElement.before(label,preview);range.onchange=()=>{preview.hidden=range.value!=='selection'};
  }else if(view.snapshot()?.selected?.length){const explain=document.createElement('p');explain.textContent='当前选择暂不能完整取用。可以整张白板另起一版，或返回原稿只选需要的具体内容。';input.parentElement.before(explain)}
  function complete(){
   committed=true;const {id,value,revision}=attempt,copy={id,name:value.name,folder:value.folder||'',count:value.nodes.length};
   if(!same(shellScope,window.whiteboardHosted)||!same(writerScope,source.whiteboardHosted))return;
   if(!boards.some(row=>row.id===id))boards.push(copy);window.whiteboardBoardLifecycle?.created([id]);
   if(owns()&&view.state().revision===revision){d.close();openBoard(id,side);toast('新版本已保存，原稿标签保留。')}
   else if(owns())message('新版本已保存。期间原稿有了新修改，仍留在原稿，可从白板列表打开新版本。');
   else if(!document.hidden)toast('新版本已保存，可在白板列表中打开。');
  }
  create.onclick=async()=>{
   if(!owns()||busy||committed||changedSaved)return;const name=attempt?.value.name||input.value.trim();if(!name){message('给新版本起个名字。');input.focus();return}
       const selectionMode=range?.value==='selection';busy=true;input.disabled=create.disabled=true;if(range)range.disabled=true;message(attempt?'正在核对这次创建…':'正在准备当前内容…');
   try{
    if(!attempt)await source.whiteboardImports?.idle();if(!owns())return;
    if(source.whiteboardHosted&&!await source.whiteboardHosted.checkIdentity())throw Error('原账号或工作区尚未确认，原稿保留。');if(!owns())return;
    if(attempt){
     // An uncertain response is not permission to send a second create.
     const response=await fetch('/api/boards/'+attempt.id,{cache:'no-store'});if(!owns())return;
     if(response.status===404){message('暂时没有找到这次创建。可以稍后再核对；原稿保留，本次没有重复提交。');return}
     if(!response.ok)throw Error('暂时未能核对这次创建，请稍后再试。');
     const saved=await response.json();if(!owns())return;
     if(signature(saved)!==attempt.signature){changedSaved=true;message('这次创建的白板已有变化。未覆盖，请先从白板列表核对。');return}
     complete();return;
    }
    const folderData=await api('/api/folders');if(!owns())return;
    // Snapshot only after all waits. The original save and undo owners stay intact.
    const snapshot=view.snapshot(),copiedRevision=view.state().revision;if(!snapshot||snapshot.boardId!==tab.boardId)throw Error('原白板已有变化，请返回后重新打开。');
         const value=snapshot.board;if(selectionMode){const currentPlan=selectionPlan();if(!currentPlan||signature(currentPlan)!==planSignature)throw Error('所选内容已有变化，请返回原稿重新选择。');value.nodes=currentPlan.bundle.nodes;value.edges=currentPlan.bundle.edges}value.name=name;if(value.folder&&!folderData.folders.some(folder=>folder.id===value.folder))value.folder='';
    attempt={id:uid(),value,revision:copiedRevision,signature:signature(value)};message('正在保存新版本…');await api('/api/boards/'+attempt.id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)});complete();
   }catch(error){if(owns())message(committed?'新版本已保存，暂时未能打开，可从白板列表继续。':attempt?'本次保存尚未确认，可核对这次创建。原稿保留。 '+(error.message==='Failed to fetch'?'连接暂时中断。':error.message||''):error.message||'暂时未能创建新版本，原稿保留。')}
   finally{busy=false;if(owns()){input.disabled=!!attempt;if(range)range.disabled=!!attempt;create.disabled=committed||changedSaved;create.textContent=changedSaved?'已保存内容需要核对':attempt&&!committed?'核对这次创建':'创建并打开新版本'}}
  };
  input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();create.click()}};
  d.querySelector('[data-variant-close]').onclick=()=>d.close();
  d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;queueMicrotask(()=>{if(owner()&&document.hasFocus()&&!document.hidden&&!document.querySelector('dialog[open]'))view.focus()})},{once:true});
  document.body.append(d);d.showModal();input.focus();input.select();
 };
})();
