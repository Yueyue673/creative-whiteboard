const $=id=>document.getElementById(id);
const el=(tag,text,style)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(style)node.className=style;return node;};
class AccountError extends Error{constructor(message,status=0,code='',accepted=false){super(message);Object.assign(this,{status,code,accepted});}}
const protocol=message=>{throw new AccountError(message,0,'protocol');};

export class AccountTransport{
  constructor(account){if(!Number.isSafeInteger(account)||account<1)protocol('页面所属账号无效。');this.account=account;Object.freeze(this);}
  async request(path,method='GET',value,tag){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),headers={'Accept':'application/json','X-Creative-Account':String(this.account)};
    if(method==='POST'){
      const cookie=document.cookie.split(';').map(p=>p.trim()).find(p=>p.startsWith('__Host-creative_csrf='));
      try{headers['X-CSRFToken']=cookie?decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)):'';}catch{headers['X-CSRFToken']='';}
      headers['Content-Type']='application/json';if(tag)headers['If-Match']=tag;
    }
    try{
      let response,text;
      try{response=await fetch(path,{method,headers,body:method==='POST'?JSON.stringify(value):undefined,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});text=await response.text();}
      catch{throw new AccountError(method==='POST'?'请求回复尚未确认。请重新核对登录记录；不要直接重复提交。':'暂时不能读取，尚未核对当前登录。',0,'offline');}
      if(new TextEncoder().encode(text).length>65536)protocol('回复超出核对范围，请重新读取。');
      let data;try{data=JSON.parse(text);}catch{protocol('回复无法核对；若已提交操作，请先检查结果，勿直接重试。');}
      if(!response.ok)throw new AccountError(typeof data?.error==='string'?data.error:'账号操作未完成。',response.status,data?.code||'request');
      return {data,tag:response.headers.get('ETag')};
    }finally{clearTimeout(timer);}
  }
  async guard(){const {data}=await this.request('/api/session');if(data.account?.id!==this.account)throw new AccountError('原账号的登录已失效或改变。保留原页面的创作输入，请在新页面重新登录原账号后处理。',401,'account_changed');}
  async sessions(){
    await this.guard();const result=await this.request('/api/account/sessions');await this.guard();
    if(!/^"[a-f0-9]{64}"$/.test(result.tag||'')||!Array.isArray(result.data.sessions)||result.data.sessions.length>100)protocol('登录列表尚不能核对，请重新读取。');
    const rows=result.data.sessions,ids=new Set();let current=0;
    for(const row of rows){
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.id)||ids.has(row.id)||typeof row.label!=='string'||row.label.length>64||typeof row.current!=='boolean'||!['startedAt','expiresAt'].every(k=>typeof row[k]==='string'&&Number.isFinite(Date.parse(row[k]))))protocol('登录记录内容不一致，尚未授权退出操作。');
      ids.add(row.id);if(row.current)current++;
    }
    if(current!==1)protocol('当前登录未能核对，尚未授权退出操作。');
    return Object.freeze({tag:result.tag,rows:rows.map(row=>Object.freeze({...row}))});
  }
  async changePassword(value){
    await this.guard();const {data}=await this.request('/api/account/password','POST',value);
    if(data.accepted!==true||data.passwordChanged!==true||data.currentKept!==true||data.othersRevoked!==true)protocol('改密码请求已发送，但回复无法核对；请先检查登录，勿直接重试。');
    try{await this.guard();}catch(error){throw new AccountError('服务器已确认密码更改，之后未能核对当前登录；请在新页面检查，未重复提交。',error.status,error.code,true);}
    return {accepted:true,verified:true};
  }
  async revoke(selection,password){
    await this.guard();const path=selection.id?`/api/account/sessions/${selection.id}/revoke`:'/api/account/sessions/revoke-others';
    const {data}=await this.request(path,'POST',{password,confirm:true},selection.tag);
    if(data.accepted!==true||data.currentKept!==true||data.revoked!==selection.ids.length)protocol('退出请求已发送，但回复无法核对；请重新读取记录，勿直接重试。');
    try{const latest=await this.sessions();if(latest.rows.some(row=>selection.ids.includes(row.id)))throw new AccountError('所选登录仍在列表中。');}
    catch(error){throw new AccountError(error.status===401||error.code==='account_changed'?'服务器已确认退出所选登录，之后原账号登录失效或改变；请保留输入，在新页面检查原账号。':'服务器已确认退出所选登录，之后未能核对列表；请重新读取，未重复提交。',error.status,error.code,true);}
    return {accepted:true,verified:true};
  }
}

const source=$('board-context')||$('portal-context');
if(source){const context=JSON.parse(source.textContent);if(context.account)install(context.account);}
function install(account){
  const transport=new AccountTransport(account.id),dialog=$('accountDialog'),entry=$('openAccount');
  let epoch=0,busy=false,review=null,selection=null,tab='sessions',lastOutcome='',accessLost=false;
  let channel;try{channel=new BroadcastChannel('creative-account-session');}catch{}
  const valid=token=>dialog.open&&token===epoch;
  function message(text,error=false,pending=false){$('accountState').textContent=text;$('accountState').dataset.error=String(error);$('accountState').dataset.pending=String(pending);}
  function clearSecrets(){dialog.querySelectorAll('input[type=password]').forEach(input=>{input.value='';});$('accountRevokeConfirm').checked=false;}
  function clearSelection(){selection=null;$('accountRevokeForm').hidden=true;$('accountRevokeConfirm').checked=false;$('accountRevokePassword').value='';}
  function invalidate(){review=null;clearSelection();$('accountSessionRows').replaceChildren(el('p','登录列表尚未核对，请重新读取。','account-caption'));}
  function notify(){channel?.postMessage({type:'changed'});window.dispatchEvent(new Event('creative-account-check'));}
  function controls(){
    dialog.querySelectorAll('button,input').forEach(node=>{if(node.id!=='closeAccount')node.disabled=busy||accessLost;});
    $('prepareOtherSessions').disabled=busy||accessLost||!review||!review.rows.some(row=>!row.current);
    $('confirmRevokeSessions').disabled=busy||accessLost||!selection||!$('accountRevokeConfirm').checked;
    $('closeAccount').disabled=false;
  }
  function fail(error,token){
    if(!valid(token))return;
    if(error.status===401||error.code==='account_changed'){accessLost=true;invalidate();clearSecrets();notify();controls();}
    message(error.message,true);
  }
  function render(){
    const nodes=review.rows.map(row=>{
      const item=el('article',undefined,'account-session-row'+(row.current?' current':''));item.dataset.sessionId=row.id;
      const top=el('div',undefined,'account-session-top');top.append(el('strong',row.label),el('small',row.current?'当前登录':'其他登录'));item.append(top);
      const stamp=value=>new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      item.append(el('p',`建立：${stamp(row.startedAt)}`),el('p',`到期：${stamp(row.expiresAt)}`));
      if(!row.current){const button=el('button','选择退出这次登录');button.type='button';button.onclick=()=>prepare(row.id);item.append(button);}
      return item;
    });$('accountSessionRows').replaceChildren(...nodes);
  }
  async function load(){
    if(busy||accessLost)return;const token=epoch;busy=true;invalidate();controls();message('正在读取这个账号的登录记录…');
    try{const value=await transport.sessions();if(!valid(token))return;review=value;render();message(lastOutcome||`已核对 ${value.rows.length} 次登录。`);}
    catch(error){fail(error,token);}finally{busy=false;controls();if(dialog.open&&token!==epoch&&$('accountState').dataset.pending==='true')message('上一项读取已结束。请重新读取这页的登录记录；未沿用旧列表。');}
  }
  function prepare(id=null){
    if(busy||accessLost||!review)return;const rows=review.rows.filter(row=>!row.current&&(!id||row.id===id));if(!rows.length)return;
    clearSecrets();selection=Object.freeze({id,tag:review.tag,ids:Object.freeze(rows.map(row=>row.id))});
    $('accountRevokeTitle').textContent=id?'退出这一次登录':'退出刚刚读取的其他登录';
    $('accountRevokeScope').textContent=id?`确认退出 ${rows[0].label} 这次登录，保留当前登录。`:`确认退出刚刚列表中的 ${rows.length} 次其他登录，保留当前登录。`;
    $('accountRevokeForm').hidden=false;controls();$('accountRevokePassword').focus();
  }
  function selectTab(next){
    if(busy||accessLost)return;tab=next;clearSecrets();clearSelection();
    $('accountSessionsPane').hidden=next!=='sessions';$('accountPasswordPane').hidden=next!=='password';
    $('accountSessionsTab').setAttribute('aria-pressed',String(next==='sessions'));$('accountPasswordTab').setAttribute('aria-pressed',String(next==='password'));
    message(lastOutcome);if(next==='sessions')load();
  }
  async function write(kind,event){
    event.preventDefault();if(busy||accessLost)return;if(kind==='revoke'&&(!selection||!$('accountRevokeConfirm').checked))return;
    const token=epoch,chosen=selection;
    const value=kind==='password'?{oldPassword:$('accountOldPassword').value,newPassword:$('accountNewPassword').value,confirmation:$('accountConfirmPassword').value}:$('accountRevokePassword').value;
    if(kind==='password'&&value.newPassword!==value.confirmation){message('两次新密码不一致，尚未提交。',true);return;}
    busy=true;controls();message('正在核对并提交这项账号操作；关闭面板不会撤回已发送的请求。');
    try{
      if(kind==='password')await transport.changePassword(value);else await transport.revoke(chosen,value);
      lastOutcome=kind==='password'?'密码已更改，当前登录已核对，其他登录已失效。':'所选登录已退出，列表结果已核对；当前登录保留。';notify();
      if(valid(token)){invalidate();message(lastOutcome);}
    }catch(error){
      if(kind==='password'&&!error.accepted&&['offline','protocol'].includes(error.code))error.message='密码更改结果尚未确认。请在新页面检查新密码能否登录，勿直接重复修改。';
      lastOutcome=error.accepted?error.message:(error.code==='offline'||error.code==='protocol'?error.message:'');
      if(valid(token)){invalidate();fail(error,token);}if(error.accepted)notify();
    }finally{clearSecrets();busy=false;controls();if(dialog.open&&token!==epoch&&$('accountState').dataset.pending==='true')message('上一项操作已结束。请重新读取登录记录，或重新打开面板查看核对结果；未重复提交。');}
  }
  function close(){++epoch;clearSecrets();clearSelection();dialog.close();}
  entry.hidden=false;entry.title=`账号与登录 · ${account.name}`;entry.onclick=()=>{
    ++epoch;invalidate();clearSecrets();lastOutcome=lastOutcome||'';
    $('accountDisplayName').textContent=account.name;$('accountEmail').textContent=account.email;$('accountAvatar').textContent=Array.from(account.name)[0]||'◈';
    dialog.showModal();if(busy){message('上一项操作仍在核对；尚未重复提交。',false,true);controls();}else selectTab(tab);
  };
  $('closeAccount').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open){clearSecrets();clearSelection();}});
  $('accountSessionsTab').onclick=()=>selectTab('sessions');$('accountPasswordTab').onclick=()=>selectTab('password');
  $('refreshAccountSessions').onclick=()=>{lastOutcome='';load();};$('prepareOtherSessions').onclick=()=>prepare();
  $('accountRevokeConfirm').onchange=controls;$('cancelRevokeSessions').onclick=()=>{clearSelection();controls();};
  $('accountPasswordForm').onsubmit=event=>write('password',event);$('accountRevokeForm').onsubmit=event=>write('revoke',event);
  async function check(){if(!dialog.open||busy)return;const token=epoch;try{await transport.guard();}catch(error){fail(error,token);}}
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});if(channel)channel.onmessage=event=>{if(event.data?.type==='changed')check();};
  controls();
}
