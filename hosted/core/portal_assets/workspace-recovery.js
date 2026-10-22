import {BoardDrafts, checkRaw} from './board-drafts.js';
import {BoardTransport} from './board-transport.js';
import {recoverWorkspaceDrafts} from './board-session.js';

const $=id=>document.getElementById(id);
const contextElement=$('board-context')||$('portal-context');
const context=contextElement?JSON.parse(contextElement.textContent):null;
if(context?.account?.id&&context.workspace&&$('browserRecoveryDialog'))initialise(context);

function initialise(context){
  // This manager never adopts a new cookie's account or another workspace.
  const transport=new BoardTransport({account:context.account.id,workspace:context.workspace,key:'_recovery'});
  const drafts=new BoardDrafts(transport.scope),dialog=$('browserRecoveryDialog');
  let rows=[],selected=null,removed=false,busy=false,allowed=false,validSelection=false,epoch=0;
  const bytes=raw=>new TextEncoder().encode(raw).length;
  const name=row=>checkRaw(row.raw).name;
  const stamp=row=>new Date(row.updatedAt).toLocaleString('zh-CN',{hour12:false});
  const setMessage=text=>{$('browserRecoveryState').textContent=text;};
  async function access(){await transport.assertIdentity();await transport.workspace();}
  function controls(){
    $('refreshBrowserRecovery').disabled=busy;
    $('showWorkspaceRecovery').disabled=busy;
    $('ackBrowserRecovery').disabled=busy||!selected||removed||!allowed||!validSelection;
    $('removeBrowserRecovery').disabled=busy||!selected||removed||!allowed||!validSelection||!$('ackBrowserRecovery').checked;
    $('exportBrowserRecovery').disabled=!selected;
    for(const button of $('browserRecoveryList').querySelectorAll('button'))button.disabled=busy||!allowed;
  }
  function renderSelected(){
    $('browserRecoveryEmpty').hidden=Boolean(selected);$('browserRecoverySelected').hidden=!selected;
    if(!selected){controls();return;}
    $('browserRecoveryTitle').textContent=name(selected);
    $('browserRecoveryInfo').textContent=`${stamp(selected)} · ${bytes(selected.raw).toLocaleString()} 字节 · 原白板编号 ${selected.key}${removed?' · 这份副本已移除，原文仍在这页可导出':''}`;
    $('browserRecoveryRaw').value=selected.raw;
    $('checkBrowserRecoveryBoard').href=`/w/${encodeURIComponent(transport.scope.workspace)}/b/${encodeURIComponent(selected.key)}/`;
    controls();
  }
  function renderRows(){
    const list=$('browserRecoveryList');list.replaceChildren();
    if(!rows.length){const p=document.createElement('p');p.className='browser-recovery-caption';p.textContent=allowed?'这里没有保留的浏览器副本。':'暂未读取副本。';list.append(p);}
    for(const row of rows){
      const value=checkRaw(row.raw),button=document.createElement('button');button.type='button';button.className='browser-recovery-row';button.setAttribute('aria-pressed',String(selected&&JSON.stringify(selected)===JSON.stringify(row)&&!removed));
      const title=document.createElement('strong'),info=document.createElement('small'),excerpt=document.createElement('span');
      title.textContent=value.name.slice(0,120)||'未命名白板';info.textContent=`${stamp(row)} · ${bytes(row.raw).toLocaleString()} 字节`;
      const note=value.nodes.find(node=>node&&typeof node==='object'&&node.type==='note'&&(typeof node.body==='string'||typeof node.title==='string'));
      excerpt.textContent=(typeof note?.body==='string'?note.body:typeof note?.title==='string'?note.title:'保留白板完整原文').slice(0,140);
      button.append(title,info,excerpt);button.onclick=()=>inspect(row);list.append(button);
    }
    controls();
  }
  function failure(error,token,message=''){
    if(token!==epoch)return;
    allowed=false;validSelection=false;rows=[];$('ackBrowserRecovery').checked=false;
    setMessage(message||`${error.message||'暂时无法核对访问权限。'} 已查看的原文仍可导出；未读取新副本。`);renderRows();renderSelected();
  }
  async function refresh(){
    if(busy)return;const token=++epoch;busy=true;allowed=false;$('ackBrowserRecovery').checked=false;controls();setMessage('正在核对原账号，并读取这个工作区的浏览器副本…');
    try{
      const result=await recoverWorkspaceDrafts(transport.scope);
      if(token!==epoch||!dialog.open)return;
      rows=result;allowed=true;
      // A previously inspected row stays an exact snapshot; refresh never
      // silently replaces its raw input or reuses a cleanup confirmation.
      validSelection=Boolean(selected&&!removed&&rows.some(row=>JSON.stringify(row)===JSON.stringify(selected)));
      if(selected&&!removed&&!validSelection){setMessage('已查看的副本已变化或不在列表。原文仍可导出，请重新选择列表中的当前副本后再处理。');}
      else setMessage(`找到 ${rows.length} 份浏览器输入；选择一份查看完整原文。`);
      renderRows();renderSelected();
    }catch(error){failure(error,token);}
    finally{busy=false;controls();}
  }
  async function inspect(row){
    if(busy)return;const token=++epoch;busy=true;$('ackBrowserRecovery').checked=false;controls();setMessage('正在核对这份副本…');
    try{
      await access();const current=await drafts.readReviewed(row);await access();
      if(token!==epoch||!dialog.open)return;
      if(current.missing)throw new Error('这份副本已不在浏览器中，请刷新列表。');
      selected=current;removed=false;allowed=true;validSelection=true;$('browserRecoveryCleanup').open=false;renderRows();renderSelected();setMessage('已读取这一份原文。请核对后决定导出或处理；没有修改服务器白板。');
      $('browserRecoveryRaw').focus({preventScroll:true});$('browserRecoverySelected').scrollIntoView({block:'nearest'});
    }catch(error){failure(error,token);}
    finally{busy=false;controls();}
  }
  async function remove(){
    if(busy||!selected||removed||!allowed||!validSelection||!$('ackBrowserRecovery').checked)return;
    const reviewed=selected,token=++epoch;busy=true;$('ackBrowserRecovery').checked=false;controls();let committed=false;
    try{
      await access();const result=await drafts.removeReviewed(reviewed);committed=result.removed;
      if(selected?.id===reviewed.id)removed=result.removed||result.missing;
      await access();
      if(token!==epoch||!dialog.open)return;
      rows=rows.filter(row=>row.id!==reviewed.id);allowed=true;
      setMessage(result.removed?'已移除核对过的这一份浏览器副本。服务器白板不变，这页原文仍可导出。':'这份副本已经不在浏览器中，本次没有移除其他输入。');renderRows();renderSelected();
    }catch(error){failure(error,token,committed?'这份浏览器副本已移除，但之后未能确认原账号的访问状态；这页原文仍可导出。':`${error.message||'未确认清理完成。'} 这页原文仍可导出；请刷新后重新核对。`);}
    finally{busy=false;controls();}
  }
  function close(){++epoch;$('ackBrowserRecovery').checked=false;dialog.close();}
  $('showWorkspaceRecovery').hidden=false;
  $('showWorkspaceRecovery').onclick=()=>{if(busy)return;dialog.showModal();refresh();};
  $('closeBrowserRecovery').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('refreshBrowserRecovery').onclick=refresh;$('removeBrowserRecovery').onclick=remove;$('ackBrowserRecovery').onchange=controls;
  $('exportBrowserRecovery').onclick=()=>{
    if(!selected)return;
    const url=URL.createObjectURL(new Blob([selected.raw],{type:'application/json;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download=(name(selected).replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,80)||'whiteboard')+'-浏览器原文.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('已发起这份原文的导出，请核对浏览器下载结果。');
  };
  async function recheck(){
    if(!dialog.open||busy)return;const token=epoch;
    try{await access();}catch(error){failure(error,token);}
  }
  window.addEventListener('focus',recheck);window.addEventListener('pageshow',recheck);document.addEventListener('visibilitychange',()=>{if(!document.hidden)recheck();});
  try{const channel=new BroadcastChannel('creative-account-session');channel.onmessage=recheck;}catch{}
}
