import {RecoveryReview} from './recovery-review.js';
import {BoardTransport} from './board-transport.js';

const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};

export class BoardRecovery {
  constructor(c){
    this.c=c;this.review=new RecoveryReview();this.epoch=0;this.task=null;this.place=null;this.suppressReturn=false;
    const button=$('openRecovery'),dialog=$('recoveryDialog');
    button.onpointerdown=()=>{this.place=c.capture?.();};
    button.addEventListener('focus',event=>{const place=c.capture?.(event.relatedTarget);if(place)this.place=place;});
    button.onclick=()=>this.open();$('closeRecovery').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{if(dialog.open)return;this.epoch++;this.task=null;this.review.clear();this.controls();const place=this.place;this.place=null;if(!this.suppressReturn)c.restore?.(place);this.suppressReturn=false;});
    $('applyRecovery').onclick=()=>this.apply();
    c.session.addEventListener('change',()=>this.controls());
  }
  controls(){const summary=this.review.summary;$('applyRecovery').hidden=!summary;$('applyRecovery').disabled=Boolean(this.task)||!summary||summary.identical||!this.c.canEdit();}
  active(epoch,row){return epoch===this.epoch&&$('recoveryDialog').open&&(!row||row.isConnected&&$('recoveryList').contains(row));}
  showReview(raw){
    const summary=this.review.select(this.c.raw(),raw),root=$('recoveryReview');root.replaceChildren();root.hidden=false;
    const heading=el('h3',summary.identical?'与当前页面相同':'应用后，当前页面会变成什么');heading.id='recoveryReviewHeading';heading.tabIndex=-1;root.setAttribute('aria-labelledby',heading.id);root.append(heading);
    root.append(el('p','来自：'+(summary.sourceName||'未命名白板'),'recovery-source'));
    const counts=el('dl',undefined,'recovery-counts');
    for(const [name,count] of [['新增',summary.added],['替换',summary.changed],['移除',summary.removed],['保持',summary.unchanged]]){const group=el('div');group.append(el('dt',name),el('dd',String(count)));counts.append(group);}root.append(counts);
    root.append(el('p',`内容 ${summary.beforeCount} → ${summary.afterCount} 项。${summary.identical?'这份输入无需再次应用。':'这是整份白板替换，不会自动合并两份原文。'}`));
    const flags=[];
    if(summary.nameChanged)flags.push('白板名称');if(summary.relationsChanged)flags.push(`连线（${summary.beforeRelations} → ${summary.afterRelations}）`);if(summary.orderChanged)flags.push('内容列表或顺序');if(summary.viewChanged)flags.push('副本保存的视角');if(summary.otherChanged)flags.push('其他白板字段');
    if(flags.length)root.append(el('p','同时替换：'+flags.join('、')+'。'));
    if(summary.changes.length){const list=el('ul',undefined,'recovery-changes');for(const change of summary.changes.slice(0,12)){const item=el('li'),kind=el('span',{added:'新增',changed:'替换',removed:'移除'}[change.kind]);kind.dataset.kind=change.kind;item.append(kind,el('span',change.label));list.append(item);}root.append(list);if(summary.changes.length>12)root.append(el('p',`另有 ${summary.changes.length-12} 项，完整原文可在下方查看或导出。`));}
    $('recoveryPreview').value=raw;$('recoveryPreviewLabel').hidden=false;$('recoveryPreviewLabel').open=false;this.controls();root.scrollIntoView({block:'nearest'});heading.focus({preventScroll:true});
  }
  row(label,raw,description,epoch){
    const row=el('section',undefined,'recovery-row');row.append(el('h3',label),el('p',description));
    const value=JSON.parse(raw),note=value.nodes.find(node=>node&&typeof node==='object'&&node.type==='note'&&(typeof node.body==='string'||typeof node.title==='string'));
    if(note)row.append(el('p',(typeof note.body==='string'?note.body:note.title).slice(0,140),'recovery-excerpt'));
    const inspect=el('button','查看与对照');inspect.setAttribute('aria-pressed','false');inspect.onclick=()=>{if(!this.active(epoch,row)||this.task)return;try{this.showReview(raw);for(const item of $('recoveryList').children){item.dataset.selected=String(item===row);item.querySelector('button')?.setAttribute('aria-pressed',String(item===row));}$('recoveryMessage').textContent='先核对替换范围，再决定应用；查看没有修改白板。';$('recoveryReview').scrollIntoView({block:'nearest'});}catch(error){this.review.clear();$('recoveryReview').hidden=$('recoveryPreviewLabel').hidden=true;$('recoveryMessage').textContent=error.message+' 这份原文仍可导出。';this.controls();}};
    const exportButton=el('button','导出这份输入');exportButton.onclick=()=>{if(this.active(epoch,row))this.c.download(raw,'recovered-input');};
    row.append(inspect,exportButton);$('recoveryList').append(row);
  }
  async open(){
    const dialog=$('recoveryDialog');if(dialog.open)return;const epoch=++this.epoch;this.suppressReturn=false;this.task=null;this.review.clear();$('recoveryList').replaceChildren();$('recoveryPreviewLabel').hidden=$('recoveryReview').hidden=true;$('recoveryMessage').textContent='正在核对原账号与工作区…';this.controls();dialog.showModal();
    const conflict=this.c.session.state.conflict;
    if(conflict)this.row(conflict.accepted?'收到保存确认后仍待核对的输入':'这次提交但未应用的输入',conflict.submittedRaw,conflict.accepted?'刚才一次已收到保存确认；完整结果或后来输入还未合并。':conflict.draftSaved?'服务器也保留了这次提交的副本；后来输入请使用当前页面导出。':'服务器没有确认另外保存这次输入，请保留浏览器副本或导出。',epoch);
    try{const rows=await this.c.session.recoverableDrafts();if(!this.active(epoch))return;for(const row of rows){const value=JSON.parse(row.raw);this.row(value.name||'未命名输入',row.raw,new Date(row.updatedAt).toLocaleString('zh-CN')+' · 当前浏览器保留',epoch);}$('recoveryMessage').textContent=rows.length||conflict?'选择一份对照当前页面；原服务器版本不会因查看而改变。':'没有发现这个账号与白板的浏览器副本。';}
    catch(error){if(this.active(epoch))$('recoveryMessage').textContent=error.message;}
  }
  async apply(){
    const dialog=$('recoveryDialog'),epoch=this.epoch,source=this.review.source;
    if(!this.active(epoch)||!source||this.task||!this.c.canEdit())return;
    if(!this.review.matches(this.c.raw())){this.showReview(source);$('recoveryMessage').textContent='当前页面已有变化，摘要已重新对照。请核对后再应用。';return;}
    if(this.review.summary.identical)return;
    const task={epoch};this.task=task;this.controls();
    try{
      if(!confirm('按上方摘要，用这份完整输入替换当前页面？可撤销；保存仍受原版本与权限核对。'))return;
      const transport=new BoardTransport(this.c.scope);await transport.assertIdentity();const workspace=await transport.workspace();
      if(!this.active(epoch)||this.task!==task||this.review.source!==source)return;
      if(workspace.role==='viewer'){await this.c.session.checkAccess();throw new Error('当前只有阅读权限，原输入未应用。');}
      if(!this.c.canEdit())throw new Error('当前页面已暂停，原输入未应用。');
      if(!this.review.matches(this.c.raw())){this.showReview(source);$('recoveryMessage').textContent='核对期间当前页面又有变化，摘要已更新。请重新核对后再应用。';return;}
      const value=this.review.value(this.c.raw());this.c.apply(value);this.suppressReturn=true;dialog.close();this.c.afterApply?.();
    }catch(error){if(this.active(epoch))$('recoveryMessage').textContent=error.message+' 原页面与这份输入均保留。';}
    finally{if(this.task===task){this.task=null;this.controls();}}
  }
}
