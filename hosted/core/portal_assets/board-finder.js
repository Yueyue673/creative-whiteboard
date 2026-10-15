import {BoardTransport,BoardError,boardScope} from './board-transport.js';
const $=id=>document.getElementById(id);
const node=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;if(cls)e.className=cls;return e;};
export function checkedBoardMatches(value,query,scope){
  if(!value||value.account!==scope.account||value.workspace!==scope.workspace||value.query!==query||!['currentSupportedText','limited'].includes(value.coverage)||!Number.isSafeInteger(value.scannedBoards)||value.scannedBoards<0||value.scannedBoards>500||!Array.isArray(value.items)||value.items.length>40||value.items.length>value.scannedBoards)throw new BoardError('查找回复无法核对，请重新查找。',0,'protocol');
  const seen=new Set(),items=value.items.map(row=>{
    if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.id)||seen.has(row.id)||typeof row.name!=='string'||[...row.name].length>1000||typeof row.context!=='string'||[...row.context].length>180||typeof row.excerpt!=='string'||[...row.excerpt].length>142||!Number.isFinite(row.updated)||row.updated<0)throw new BoardError('查找结果无法核对，请重新查找。',0,'protocol');
    seen.add(row.id);return Object.freeze({...row});
  });return Object.freeze({...value,items:Object.freeze(items)});
}

export class BoardFinder{
  constructor(c){
    this.c=c;this.scope=boardScope(c.scope);this.api=new BoardTransport(this.scope);this.epoch=0;this.controller=null;this.active=false;this.paused=false;this.result=null;this.attempt=null;this.lastPlace=null;
    $('showBoardFinder').onclick=()=>this.open();$('closeBoardFinder').onclick=()=>this.close();
    $('boardFinderDialog').addEventListener('cancel',e=>{e.preventDefault();this.close();});
    $('boardFinderDialog').addEventListener('close',()=>{if(!$('boardFinderDialog').open&&this.active)this.finishClose();});
    $('boardFinderDialog').addEventListener('keydown',e=>{
      if(e.key!=='Tab'||e.isComposing)return;
      const fields=[...$('boardFinderDialog').querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(item=>!item.closest('[hidden]')&&item.getClientRects().length);
      const index=fields.indexOf(document.activeElement);
      if(fields.length&&(index<0||e.shiftKey&&index===0||!e.shiftKey&&index===fields.length-1)){e.preventDefault();fields[e.shiftKey?fields.length-1:0].focus({preventScroll:true});}
    });
    $('boardFinderForm').onsubmit=e=>{e.preventDefault();this.search();};
    $('boardFinderQuery').addEventListener('input',()=>{this.invalidate();this.message('');});
    $('clearBoardFinder').onclick=()=>{this.invalidate();$('boardFinderQuery').value='';this.message('');$('boardFinderQuery').focus({preventScroll:true});};
    document.addEventListener('focusin',e=>{if(this.active||e.target===$('showBoardFinder'))return;this.lastPlace=c.capture(e.target);});
    const remember=()=>{if(!this.active&&document.activeElement!==$('showBoardFinder'))this.lastPlace=c.capture(document.activeElement);};
    document.addEventListener('input',remember);document.addEventListener('selectionchange',remember);
    document.addEventListener('keydown',e=>{if(e.isComposing||e.altKey||e.shiftKey||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='k'||document.querySelector('dialog[open]')||!this.allowed())return;e.preventDefault();this.open();});
  }
  allowed(){return !this.paused&&Boolean(this.c.canRead());}
  blank(tab){try{return !tab.closed&&tab.location.href==='about:blank';}catch{return false;}}
  closeBlank(tab){if(tab&&this.blank(tab))tab.close();}
  live(token,query){return token===this.epoch&&this.active&&$('boardFinderDialog').open&&this.allowed()&&$('boardFinderQuery').value.trim()===query;}
  message(value){$('boardFinderState').textContent=value;}
  invalidate(){
    ++this.epoch;this.controller?.abort();this.controller=null;this.closeBlank(this.attempt?.tab);this.attempt=null;this.result=null;
    $('boardFinderResults').replaceChildren();$('boardFinderForm').removeAttribute('aria-busy');$('submitBoardFinder').disabled=!this.allowed();
  }
  sync(){
    $('showBoardFinder').disabled=!this.allowed();
    if(this.active&&!this.allowed()){this.invalidate();this.message('原页面的访问状态已改变。查找词仍在这里；请关闭后在新页面核对账号和权限。');}
  }
  open(){
    if(!this.allowed()||document.querySelector('dialog[open]'))return;
    this.place=this.c.capture(document.activeElement)||this.lastPlace;this.active=true;this.invalidate();this.message('');
    $('boardFinderScope').textContent=this.c.name()||'原工作区';$('boardFinderDialog').showModal();$('boardFinderQuery').focus({preventScroll:true});
  }
  close(){if($('boardFinderDialog').open)$('boardFinderDialog').close();if(this.active)this.finishClose();}
  finishClose(){this.active=false;this.invalidate();const place=this.place;this.place=null;this.message('');if(place)this.c.restore(place);this.c.afterClose?.();}
  async read(query,signal){
    let response;try{response=await fetch(`/w/${this.scope.workspace}/api/search?q=`+encodeURIComponent(query),{headers:{Accept:'application/json','X-Creative-Account':String(this.scope.account)},credentials:'same-origin',cache:'no-store',redirect:'error',signal});}
    catch{throw new BoardError('连接暂时中断，查找词已保留。恢复后可以再试。',0,'offline');}
    let value;try{value=await response.json();}catch{throw new BoardError('查找回复无法核对，请重新查找。',response.status,'protocol');}
    if(!response.ok)throw new BoardError(value?.error||'暂时无法查找，请稍后再试。',response.status,value?.code||'request_failed');
    return checkedBoardMatches(value,query,this.scope);
  }
  fail(error){if([401,404].includes(error.status)||error.code==='account_changed'){this.paused=true;this.invalidate();$('showBoardFinder').disabled=true;}this.message(error.message);}
  async search(){
    if(!this.active||!$('boardFinderDialog').open||!this.allowed())return;
    const query=$('boardFinderQuery').value.trim();this.invalidate();
    if(!query){this.message('填写记得的一句话，或白板名称。');$('boardFinderQuery').focus();return;}
    if([...query].length>120||/[\p{Cc}\p{Cs}]/u.test(query)){this.message('查找词须为1至120个字符，不含换行或控制字符。');return;}
    const token=this.epoch,controller=new AbortController();this.controller=controller;const timeout=setTimeout(()=>controller.abort(),30000);
    $('boardFinderForm').setAttribute('aria-busy','true');$('submitBoardFinder').disabled=true;this.message('正在查找原工作区已保存的文字…');
    try{
      await this.api.assertIdentity();if(!this.live(token,query))return;
      const result=await this.read(query,controller.signal);if(!this.live(token,query))return;
      await this.api.workspace();if(!this.live(token,query))return;this.result=result;
      const rows=result.items.map(row=>{
        const button=node('button',undefined,'board-finder-result');button.type='button';
        button.append(node('strong',row.name.trim()?row.name:'未命名白板'),node('span',row.context,'board-finder-context'),node('span',row.excerpt,'board-finder-excerpt'),node('small',row.id===this.scope.key?'当前白板 · 在新标签打开 ↗':'在新标签打开 ↗'));
        button.onclick=()=>this.openResult(row,button,result,token,query);return button;
      });$('boardFinderResults').replaceChildren(...rows);
      this.message((rows.length?`找到 ${rows.length} 张白板。`:'这次没有找到匹配白板。')+(result.coverage==='limited'?' 本次只检查了一部分内容，没有结果也不代表不存在。':''));
    }catch(error){if(this.live(token,query))this.fail(error);}
    finally{clearTimeout(timeout);if(token===this.epoch){this.controller=null;$('boardFinderForm').removeAttribute('aria-busy');$('submitBoardFinder').disabled=!this.allowed();}}
  }
  async openResult(row,button,result,token,query){
    const valid=()=>this.live(token,query)&&this.result===result&&button.parentElement===$('boardFinderResults')&&result.items.includes(row);
    if(!valid()||this.attempt)return;
    const tab=window.open('about:blank','_blank');if(!tab){this.message('浏览器没有打开新标签。请允许本次打开后再试；原编辑和查找词仍保留。');return;}tab.opener=null;
    const attempt={tab};this.attempt=attempt;for(const item of $('boardFinderResults').children)item.disabled=true;this.message('正在核对原账号与工作区…');
    try{
      await this.api.assertIdentity();if(!valid()){this.closeBlank(tab);return;}
      await this.api.workspace();if(!valid()||tab.closed){this.closeBlank(tab);return;}
      if(!this.blank(tab)){this.attempt=null;this.message('新标签已打开其他内容，没有替换它。原编辑和查找词仍保留。');return;}
      this.attempt=null;tab.location.replace(`/w/${this.scope.workspace}/b/${encodeURIComponent(row.id)}/`);this.close();
    }catch(error){this.closeBlank(tab);if(valid())this.fail(error);}
    finally{if(this.attempt===attempt){this.attempt=null;if(valid())for(const item of $('boardFinderResults').children)item.disabled=false;}}
  }
}
