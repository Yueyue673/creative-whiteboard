// Read failures remain visible, and retries retain the current document until a read succeeds.
(() => {
 'use strict';
 if(new URLSearchParams(location.search).get('explorer')==='1')return;
 const host=document.createElement('section');host.id='boardLoadState';host.className='inline-ui';host.hidden=true;
 host.innerHTML='<div class="board-load-card"><h2 id="boardLoadHeading"></h2><p id="boardLoadDetail"></p><p id="boardLoadRetained" hidden>当前白板仍保留，可以继续使用。</p><div><button id="boardLoadRetry">重试</button><button id="boardLoadOther">选择其他白板</button></div></div>';
 canvas.append(host);
 const disabled=new Map(),controls=['add','addTable','import','undo','redo','rename','frame','export','markdown','reload','plus','minus','fit'];
 function update(){
  const unready=loading||!board;host.hidden=!loading&&!loadError;
  host.dataset.mode=loading||!board?'overlay':'banner';
  $('world').inert=unready;
  if(unready)for(const id of controls){const button=$(id);if(button&&!disabled.has(button)){disabled.set(button,button.disabled);button.disabled=true}}
  else if(disabled.size){for(const [button,value] of disabled)button.disabled=value;disabled.clear();updateButtons()}
  if(host.hidden)return;
  $('boardLoadHeading').textContent=loading?'正在打开白板…':'这张白板暂时打不开';
  $('boardLoadDetail').textContent=loading?'':loadError;
  $('boardLoadRetained').hidden=loading||!board;
  $('boardLoadRetry').hidden=loading;$('boardLoadRetry').disabled=loading;
  $('boardLoadOther').hidden=loading;$('boardLoadOther').textContent=board?'留在当前白板':'选择其他白板';
  host.setAttribute('aria-busy',String(loading));host.setAttribute('role',loading?'status':'region');host.setAttribute('aria-label',loading?'正在打开白板':'白板读取提示');
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
