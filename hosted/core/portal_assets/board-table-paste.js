import {parseTablePaste,tablePasteTarget,checkTablePasteTarget,planTablePaste,applyTablePaste,pasteLimits} from './table-paste-model.js';
import {axisKeys} from './table-model.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export class TablePaste{
  constructor(c){
    this.c=c;this.draft=null;this.plan=null;this.timer=null;this.active=false;
    $('tablePaste').onclick=()=>this.open();$('closeTablePaste').onclick=()=>this.close();
    $('tablePasteDialog').addEventListener('cancel',event=>{event.preventDefault();this.close();});
    $('tablePasteDialog').addEventListener('close',()=>{if(this.active&&!$('tablePasteDialog').open)this.finishClose();});
    $('tablePasteDialog').addEventListener('keydown',event=>{
      if(event.key==='Tab'&&!event.isComposing){const fields=[...$('tablePasteDialog').querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(field=>!field.disabled&&field.tabIndex>=0&&field.getClientRects().length),first=fields[0],last=fields.at(-1);if(first&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}}
      if(!event.isComposing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();$('tablePasteState').textContent='这份粘贴尚未应用；核对下方预览后，选择应用或导出。';}
    });
    for(const id of ['tablePasteSource','tablePasteDelimiter'])$(id).addEventListener('focus',()=>$(id).scrollIntoView({block:'nearest',inline:'nearest'}));
    $('applyTablePaste').addEventListener('focus',()=>{
      if(!this.plan)return;const preview=$('tablePastePreview').parentElement,rect=preview.getBoundingClientRect(),top=$('tablePasteDialog').querySelector('.panel-heading').getBoundingClientRect().bottom+8,bottom=$('tablePasteDialog').querySelector('.table-paste-actions').getBoundingClientRect().top-8;
      // Sticky controls use actual bounds; combined scroll padding/margins can otherwise hide the last row.
      if(rect.bottom>bottom)$('tablePasteDialog').scrollTop+=rect.bottom-bottom;else if(rect.top<top)$('tablePasteDialog').scrollTop+=rect.top-top;
    });
    $('tablePasteSource').oninput=()=>this.input();$('tablePasteDelimiter').onchange=()=>this.input();
    $('applyTablePaste').onclick=()=>this.apply();$('tablePasteSingle').onclick=()=>this.single();$('exportTablePaste').onclick=()=>this.export();
    $('discardTablePaste').onclick=()=>{if(this.pending&&!confirm('明确放弃这份尚未应用的粘贴原文？原表格保持不变。'))return;this.returnPlace=this.draft?.place;this.draft=null;this.close();this.sync();};
    $('tableGrid').addEventListener('paste',event=>{
      const field=event.target.closest('[data-table-cell]'),text=event.clipboardData?.getData('text/plain');if(!field||field.readOnly||!this.c.canEdit()||!this.c.validField(field)||typeof text!=='string'||!text.includes('\t')||text.length>pasteLimits.text)return;
      if(this.pending){event.preventDefault();this.open();$('tablePasteState').textContent='先处理刚才保留的粘贴原文，再粘贴另一份。';return;}
      try{const matrix=parseTablePaste(text);if(matrix.length===1&&matrix[0].length===1)return;}catch{/* Keep ambiguous source for explicit review rather than silently splitting it. */}
      event.preventDefault();this.open(text,field);
    });
  }
  get pending(){return Boolean(this.draft?.text.length);}
  open(text='',field=null){
    if(!this.draft){const n=this.c.node(),place=this.c.capture();if(!n||!this.c.canEdit()||!place)return;try{this.draft={ref:n,target:tablePasteTarget(n,field?.dataset.rowKey??place.row,field?.dataset.columnKey??place.column),place,text,delimiter:'\t',single:field?{start:field.selectionStart,end:field.selectionEnd,original:field.value}:null};}catch(error){this.c.message(error.message);return;}}
    $('tablePasteSource').value=this.draft.text;$('tablePasteDelimiter').value=this.draft.delimiter;
    $('tablePasteContext').textContent=`${this.draft.ref.title||'未命名表格'} · 从第${this.draft.target.row+1}行、第${this.draft.target.column+1}列开始`;
    if(!$('tablePasteDialog').open)$('tablePasteDialog').showModal();this.active=true;$('tablePasteDialog').scrollTop=0;this.preview();$('tablePasteSource').focus({preventScroll:true});$('tablePasteSource').scrollIntoView({block:'nearest',inline:'nearest'});
  }
  finishClose(){this.active=false;clearTimeout(this.timer);const place=this.draft?.place??this.returnPlace;if(this.draft&&!this.pending)this.draft=null;this.c.restore(place);this.sync();}
  close(){if(!$('tablePasteDialog').open)return;this.active=false;$('tablePasteDialog').close();this.finishClose();}
  input(){if(!this.draft)return;this.draft.text=$('tablePasteSource').value;this.draft.delimiter=$('tablePasteDelimiter').value;this.plan=null;$('applyTablePaste').disabled=true;$('tablePasteState').textContent='正在核对这份粘贴…';clearTimeout(this.timer);this.timer=setTimeout(()=>this.preview(),120);this.sync();}
  current(){if(!this.draft||this.c.node()!==this.draft.ref)return false;try{checkTablePasteTarget(this.c.node(),this.draft.target);return true;}catch{return false;}}
  sync(){
    const current=this.current(),editable=current&&Boolean(this.c.canEdit());
    $('tablePaste').textContent=this.pending?'继续未应用的粘贴':'批量粘贴表格内容';$('tablePaste').disabled=!this.draft&&!this.c.canEdit();
    $('applyTablePaste').disabled=!editable||!this.plan||(!this.plan.changed&&!this.plan.addedRows&&!this.plan.addedColumns);
    $('tablePasteSingle').hidden=!this.draft?.single;$('tablePasteSingle').disabled=!editable||!this.pending;
    $('exportTablePaste').disabled=!this.pending;
    if(this.draft&&!current)$('tablePasteState').textContent='原表格或起点已改变；粘贴原文仍保留，请导出后重新选择。';
    else if(this.draft&&!editable)$('tablePasteState').textContent='编辑已暂停；粘贴原文仍保留，可以导出或放弃。';
  }
  preview(){
    this.plan=null;const root=$('tablePastePreview');root.replaceChildren();$('tablePasteSummary').textContent='';$('tablePasteState').textContent='';
    if(!this.draft)return;try{
      if(!this.current())throw Error('原表格或起点已改变；粘贴原文仍保留，请导出后重新选择。');
      const matrix=parseTablePaste(this.draft.text,this.draft.delimiter),plan=planTablePaste(this.c.node(),this.draft.target,matrix);this.plan=plan;
      const growth=[plan.addedRows?`增加${plan.addedRows}行`:'',plan.addedColumns?`增加${plan.addedColumns}列`:''].filter(Boolean).join('、');
      $('tablePasteSummary').textContent=`${matrix.length}行 × ${matrix[0].length}列 · 改变${plan.changed}格文字 · 覆盖${plan.overwritten}格已有文字${growth?' · '+growth:''}。范围内${plan.items}项嵌入内容、${plan.images}张图片保留；列名与表格手动尺寸保留。粘贴的空单元格会清空对应文字。`;
      const head=el('thead'),hr=el('tr');hr.append(el('th','落点'));for(let c=0;c<Math.min(6,matrix[0].length);c++)hr.append(el('th',`第${this.draft.target.column+c+1}列`));head.append(hr);root.append(head);const body=el('tbody');
      for(let r=0;r<Math.min(8,matrix.length);r++){const tr=el('tr');tr.append(el('th',`第${this.draft.target.row+r+1}行`));for(let c=0;c<Math.min(6,matrix[r].length);c++){
        const td=el('td'),y=this.draft.target.row+r,x=this.draft.target.column+c,before=this.c.node().rows[y]?.[x]??'',after=matrix[r][c];
        if(before!==after&&before.length){const old=el('span',before.slice(0,240));old.className='paste-before';td.append(old);}
        const fresh=el('span',after.length?after.slice(0,240):'（空文字）');fresh.className='paste-after';td.append(fresh);if(before.length>240||after.length>240)td.append(el('small','长原文仅预览前240字；应用保留完整原文。'));tr.append(td);
      }body.append(tr);}root.append(body);
      $('tablePasteState').textContent=matrix.length>8||matrix[0].length>6?'这里只预览前8行、6列；应用范围以行列数量为准。':!plan.changed&&!growth?'文字与原表格相同，无需应用。':'确认前只在此页预览，没有改动白板。';
      $('applyTablePaste').textContent=plan.overwritten?`替换${plan.overwritten}格文字并应用`:'应用到原表格';
    }catch(error){$('tablePasteState').textContent=error.message;}this.sync();
  }
  apply(){if(!this.draft||!this.current()||!this.c.canEdit())return;try{
    const next=applyTablePaste(this.c.node(),this.draft.target,parseTablePaste(this.draft.text,this.draft.delimiter));if(next===this.c.node()){this.preview();return;}
    const target=this.draft.target,place={...this.draft.place,row:axisKeys(next,'row')[target.row]??null,column:axisKeys(next,'column')[target.column]};this.draft=null;this.returnPlace=place;this.c.change(next);this.close();this.c.message('已应用这次粘贴；可以一次撤销。');
  }catch(error){$('tablePasteState').textContent=error.message;this.sync();}}
  single(){if(!this.draft?.single||!this.current()||!this.c.canEdit()||!this.pending)return;
    const d=this.draft,s=d.single,value=s.original.slice(0,s.start)+d.text+s.original.slice(s.end);if(this.c.single(d.target,value)===false&&value!==s.original)return;const caret=s.start+d.text.replace(/\r\n?/g,'\n').length;this.returnPlace={...d.place,start:caret,end:caret};this.draft=null;this.close();this.c.message('按单格原文粘贴；分隔符和换行都保留，可以撤销。');
  }
  export(){if(!this.pending)return;const url=URL.createObjectURL(new Blob([this.draft.text],{type:'text/plain;charset=utf-8'})),a=el('a');a.href=url;a.download='table-paste-original.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
