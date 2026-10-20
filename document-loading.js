// Read failures remain visible, and retries retain the current document until a read succeeds.
(() => {
 'use strict';
 if(new URLSearchParams(location.search).get('explorer')==='1')return;
 const host=document.createElement('section');host.id='boardLoadState';host.className='inline-ui';host.hidden=true;
 host.innerHTML='<div class="board-load-card"><h2 id="boardLoadHeading"></h2><p id="boardLoadDetail"></p><p id="boardLoadRetained" hidden>当前白板仍保留，可以继续使用。</p><div><button id="boardLoadRetry">重试</button><button id="boardLoadOther">选择其他白板</button></div></div>';
 canvas.append(host);
 const disabled=new Map(),controls=['add','addTable','import','undo','redo','rename','frame','export','markdown','reload','plus','minus','fit'];
 function update(){
  const unready=loading||!board,pending=loading||!board&&!loadError;host.hidden=!unready&&!loadError;
  host.dataset.mode=loading||!board?'overlay':'banner';
  $('world').inert=unready;canvas.classList.toggle('document-unready',unready);
  if(unready)for(const id of controls){const button=$(id);if(button&&!disabled.has(button)){disabled.set(button,button.disabled);button.disabled=true}}
  else if(disabled.size){for(const [button,value] of disabled)button.disabled=value;disabled.clear();updateButtons()}
  if(host.hidden)return;
  $('boardLoadHeading').textContent=pending?'正在打开白板…':'这张白板暂时打不开';
  $('boardLoadDetail').textContent=pending?'':loadError;
  $('boardLoadRetained').hidden=loading||!board;
  $('boardLoadRetry').hidden=pending;$('boardLoadRetry').disabled=pending;
  $('boardLoadOther').hidden=pending;$('boardLoadOther').textContent=board?'留在当前白板':'选择其他白板';
  host.setAttribute('aria-busy',String(pending));host.setAttribute('role',pending?'status':'region');host.setAttribute('aria-label',pending?'正在打开白板':'白板读取提示');
 }
 $('boardLoadRetry').onclick=async()=>{try{if(loadTargetId)await switchBoard(loadTargetId);else await openInitialBoard()}catch(e){toast(e.message)}};
 $('boardLoadOther').onclick=()=>{
  if(board){loadError='';loadErrorCode=0;loadTargetId=boardId;window.dispatchEvent(new Event('creative-board-loading'));return}
  if(parent!==window&&new URLSearchParams(location.search).get('pane')==='1')parent.postMessage({type:'pane-picker'},location.origin);
  else showWorkspaceTab('manager');
 };
 for(const type of ['pointerdown','dblclick','wheel'])host.addEventListener(type,e=>e.stopPropagation());
 host.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['Tab','k','K','\\'].includes(e.key))return;e.stopPropagation()});
 host.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();toast('白板还没有打开，文件尚未添加。')});
 window.addEventListener('creative-board-loading',update);update();
})();

// Missing drawing tools must never present authored objects as editable notes.
// Install after parser scripts, before the first asynchronous document read completes.
(() => {
 'use strict';
 if(new URLSearchParams(location.search).get('explorer')==='1')return;
 const unavailable=n=>!!n?.canvasObject&&!window.whiteboardCanvasObjects;
 const names={image:'图片',rect:'方框',ellipse:'圆圈',arrow:'箭头',line:'直线',freehand:'画笔',text:'文字'};
 const notice=n=>'<div class="object-unavailable"><b>'+esc(n.title||names[n.canvasObject.kind]||'图形')+'</b><span>绘图工具未载入</span><button type="button" class="inline-ui" data-object-resource>重新打开工具</button></div>';
 function explain(){
  const scope=board,id=boardId;
  showDialog('<h2>绘图工具没有载入</h2><p>图片和图形暂时无法显示或编辑。你可以先写其他便签，也可以重新打开工具。</p><p id="objectResourceStatus" role="status"></p>',[['继续写便签',()=>$('dialog').close()]]);
  let reopen;try{reopen=parent!==window&&parent.whiteboardShellResources?.reopen}catch{}
  if(!reopen){$('objectResourceStatus').textContent='保存修改后，可用浏览器重新载入此页。';return}
  const button=document.createElement('button');button.type='button';button.textContent='保存后重新打开';$('dialogActions').append(button);
  button.onclick=async()=>{
   if(board!==scope||boardId!==id||loading)return;button.disabled=true;
   try{const restored=await reopen(window);if(restored)return;$('objectResourceStatus').textContent='当前窗口已保留。请先处理保存或素材添加提示，再试一次。'}catch{if($('objectResourceStatus'))$('objectResourceStatus').textContent='暂时无法重新打开，当前窗口已保留。'}finally{if(button.isConnected)button.disabled=false}
  };
 }
 window.whiteboardDocumentResources={unavailable,explain};
 window.addEventListener('DOMContentLoaded',()=>{
  if(window.whiteboardCanvasObjects)return;
  const markup=noteMarkup;
  noteMarkup=function(n,readOnly=false){
   const html=markup(n,readOnly);if(!unavailable(n))return html;
   const start=html.indexOf('<div class="inner'),end=html.indexOf('<span class="port');
   return html.slice(0,start).replace('class="node ','class="node unavailable-object ')+'<div class="inner">'+notice(n)+'</div>'+html.slice(end);
  };
  // Cell copies share the same authored metadata; keep ordinary cells editable.
  const cellMarkup=cellContentMarkup;
  cellContentMarkup=function(n,r,c){
   const html=cellMarkup(n,r,c),items=n.cellItems?.[r]?.[c]||[];if(!items.some(unavailable))return html;
   const template=document.createElement('template');template.innerHTML=html;
   for(const section of template.content.querySelectorAll('[data-cell-item]')){const item=items[+section.dataset.cellItem];if(!unavailable(item))continue;const handle=section.querySelector('[data-cell-move]');section.replaceChildren();if(handle)section.append(handle);section.insertAdjacentHTML('beforeend',notice(item))}
   return template.innerHTML;
  };
  const open=openEditor;openEditor=function(id){if(unavailable(board?.nodes.find(n=>n.id===id)))return explain();return open(id)};
  const read=whiteboardReading.open;whiteboardReading.open=function(id){if(unavailable(board?.nodes.find(n=>n.id===id)))return explain();return read(id)};
  function mount(){for(const el of $('nodes').children){const n=board?.nodes.find(n=>n.id===el.dataset.id);if(!unavailable(n))continue;const button=el.querySelector('.block-read');if(button){button.textContent='重新打开工具';button.title='绘图工具未载入';button.setAttribute('aria-label','重新打开工具');button.onclick=e=>{e.stopPropagation();explain()}}}}
  const draw=drawNodes;drawNodes=function(){draw();mount()};const refresh=refreshSelectionUI;refreshSelectionUI=function(){refresh();mount()};
  document.addEventListener('click',e=>{if(!e.target.closest('[data-object-resource]'))return;e.preventDefault();e.stopImmediatePropagation();explain()},true);
 },{once:true});
})();
