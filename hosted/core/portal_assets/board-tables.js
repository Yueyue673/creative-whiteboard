import {tableShape,axisKeys,indexFor,tableLayoutKey,structuralCheck,editTable,removalInfo} from './table-model.js';
import {CellNotes} from './board-cell-notes.js';
import {TablePaste} from './board-table-paste.js';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const payloads=(n,key,r,c)=>Array.isArray(n[key]?.[r]?.[c])?n[key][r][c]:[];
const columnWidth=(n,c)=>{const value=n.columnWidths?.[c];return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.max(100,Math.min(900,value)):160;};
export function tableCard(n){
  const card=el('article',undefined,'card reference-card table-card');card.append(el('span','表格','reference-type'),el('h2',n.title||'未命名表格','card-title'));
  const table=el('table'),head=el('tr');for(const name of n.columns.slice(0,5))head.append(el('th',name));table.append(head);
  for(let r=0;r<Math.min(6,n.rows.length);r++){const tr=el('tr');for(let c=0;c<Math.min(5,n.columns.length);c++){const td=el('td',n.rows[r][c]),count=payloads(n,'cellItems',r,c).length+payloads(n,'cellImages',r,c).length;if(count)td.append(el('span',`附 ${count} 项`,'table-attachment-count'));tr.append(td);}table.append(tr);}card.append(table);
  card.append(el('p',`${n.rows.length} 行 · ${n.columns.length} 列 · 点击编辑文字与行列`,'reference-caption'));return card;
}
export class TableEditor{
  constructor(callbacks){this.c=callbacks;this.nodeID=null;this.rowPage=0;this.colPage=0;this.target=null;this.lastField='tableTitle';this.rendered='';this.renderEpoch=0;
    this.cellNotes=new CellNotes({...callbacks,capture:()=>this.capture(),message:text=>$('tableState').textContent=text,
      change:next=>{this.rendered='';this.c.change(next);},returnCell:place=>{if(this.c.node()?.id===place?.node)this.restore(place);},select:id=>this.c.select(id)});
    this.paste=new TablePaste({...callbacks,capture:()=>this.capture(),restore:place=>this.restore(place),validField:field=>field.dataset.layout===String(this.renderEpoch)&&this.rendered===JSON.stringify([tableLayoutKey(this.c.node()),this.rowPage,this.colPage]),message:text=>$('tableState').textContent=text,
      change:next=>{this.rendered='';this.c.change(next);},single:(target,value)=>{const n=this.c.node();return this.change({kind:'cell',row:axisKeys(n,'row')[target.row],column:axisKeys(n,'column')[target.column],value});}});
    for(const [id,kind] of [['tableTitle','title'],['tableBody','body']]){$(id).onfocus=()=>{this.lastField=id;this.c.endGroup();};$(id).oninput=()=>this.change({kind,value:$(id).value},id);}
    for(const [id,k] of [['tableWidth','w'],['tableHeight','h']])$(id).onchange=()=>{if($(id).reportValidity())this.change({kind:'geometry',patch:{[k]:Number($(id).value)}});};
    $('tableColumnWidth').onchange=()=>{if($('tableColumnWidth').reportValidity()&&this.target)this.change({kind:'width',column:this.target.column,value:Number($('tableColumnWidth').value)});};
    $('tableAddRow').onclick=()=>this.structure('add','row');$('tableAddColumn').onclick=()=>this.structure('add','column');
    for(const b of document.querySelectorAll('[data-table-order]'))b.onclick=()=>this.structure('move',b.dataset.axis,Number(b.dataset.tableOrder));
    $('tableRemoveRow').onclick=()=>this.structure('remove','row');$('tableRemoveColumn').onclick=()=>this.structure('remove','column');
    for(const [id,axis,d] of [['tableRowsPrevious','row',-1],['tableRowsNext','row',1],['tableColumnsPrevious','column',-1],['tableColumnsNext','column',1]])$(id).onclick=()=>{if(axis==='row')this.rowPage+=d;else this.colPage+=d;this.sync();$('tableGridScroll').scrollTop=0;$('tableGridScroll').scrollLeft=0;};
    $('tableGrid').addEventListener('focusin',e=>{const f=e.target.closest('[data-table-cell],[data-table-heading]');if(!f)return;this.target={row:f.dataset.rowKey??this.target?.row??null,column:f.dataset.columnKey};this.lastField=f.id;this.c.endGroup();this.syncControls();});
    $('tableGrid').addEventListener('input',e=>{const f=e.target.closest('[data-table-cell],[data-table-heading]'),n=this.c.node();if(!f||!n||f.dataset.layout!==String(this.renderEpoch)||this.rendered!==JSON.stringify([tableLayoutKey(n),this.rowPage,this.colPage]))return;this.change(f.hasAttribute('data-table-heading')?{kind:'heading',column:f.dataset.columnKey,value:f.value}:{kind:'cell',row:f.dataset.rowKey,column:f.dataset.columnKey,value:f.value},f.id);});
    $('tableGrid').addEventListener('keydown',e=>{if(e.isComposing||!e.ctrlKey||e.key!=='Enter'||!e.target.hasAttribute('data-table-cell')||!this.c.canBrowse())return;e.preventDefault();const n=this.c.node();if(!n)return;const r=indexFor(n,'row',e.target.dataset.rowKey)+(e.shiftKey?-1:1),c=indexFor(n,'column',e.target.dataset.columnKey);if(r>=0&&r<n.rows.length)this.jump(r,c);});
    $('deleteTable').onclick=()=>{const n=this.c.node();if(!n||!this.c.canEdit())return;let description;try{tableShape(n);description=`只从白板移除这个表格及其连线？\n${n.rows.length} 行、${n.columns.length} 列及单元格内容会从这张白板移除，素材库原文件保留。可以撤销，也可先导出。`;}catch{return;}if(confirm(description)&&this.c.node()===n&&this.c.canEdit())this.c.remove(n.id);};
  }
  select(){const n=this.c.node();if(!n)return;if(this.nodeID!==n.id){this.nodeID=n.id;this.rowPage=this.colPage=0;this.target=null;this.lastField='tableTitle';}this.rendered='';$('tableTitle').value=n.title||'';$('tableBody').value=n.body||'';$('tableWidth').value=n.w;$('tableHeight').value=n.h;$('tableState').textContent='';this.sync();}
  change(action,group=null){const n=this.c.node();if(!n||!this.c.canEdit())return false;try{const next=editTable(n,action);if(['title','body'].includes(action.kind)&&n[action.kind]===action.value)return false;if(action.kind==='cell'&&n.rows[indexFor(n,'row',action.row)][indexFor(n,'column',action.column)]===action.value)return false;if(action.kind==='heading'&&n.columns[indexFor(n,'column',action.column)]===action.value)return false;this.c.change(next,group);$('tableState').textContent='';return true;}catch(e){$('tableState').textContent=e.message;return false;}}
  sync(){this.paste.sync();const n=this.c.node();if(!n)return;
    try{tableShape(n);}catch(e){$('tableState').textContent=e.message;$('tableGrid').replaceChildren();return;}
    this.rowPage=Math.max(0,Math.min(this.rowPage,Math.max(0,Math.ceil(n.rows.length/20)-1)));this.colPage=Math.max(0,Math.min(this.colPage,Math.ceil(n.columns.length/6)-1));
    const layout=tableLayoutKey(n),signature=JSON.stringify([layout,this.rowPage,this.colPage]);
    if(signature!==this.rendered){this.rendered=signature;this.render(n,layout);}
    const rowIndex=new Map(axisKeys(n,'row').map((key,i)=>[key,i])),colIndex=new Map(axisKeys(n,'column').map((key,i)=>[key,i]));
    for(const f of $('tableGrid').querySelectorAll('input,textarea')){const c=colIndex.get(f.dataset.columnKey),heading=f.hasAttribute('data-table-heading'),value=heading?n.columns[c]:n.rows[rowIndex.get(f.dataset.rowKey)][c];if(f.value!==value)f.value=value;f.readOnly=!this.c.canEdit();if(heading)f.closest('th').style.width=columnWidth(n,c)+'px';}
    this.syncControls();this.cellNotes.sync();
  }
  render(n,layout){this.renderEpoch++;const root=$('tableGrid');root.replaceChildren();const r0=this.rowPage*20,c0=this.colPage*6,head=el('thead'),row=el('tr');row.append(el('th','行','table-row-number'));
    const rKeys=axisKeys(n,'row'),cKeys=axisKeys(n,'column');
    for(let c=c0;c<Math.min(c0+6,n.columns.length);c++){const th=el('th'),field=el('input');field.type='text';field.id=`table-heading-${c}`;field.value=n.columns[c];field.dataset.tableHeading='';field.dataset.columnKey=cKeys[c];field.dataset.layout=String(this.renderEpoch);field.setAttribute('aria-label',`第${c+1}列名称`);field.placeholder=`第${c+1}列 · 由你命名`;th.style.width=columnWidth(n,c)+'px';th.append(field);row.append(th);}head.append(row);root.append(head);const body=el('tbody');
    for(let r=r0;r<Math.min(r0+20,n.rows.length);r++){const tr=el('tr');tr.append(el('th',String(r+1),'table-row-number'));for(let c=c0;c<Math.min(c0+6,n.columns.length);c++){
      const td=el('td'),field=el('textarea');field.rows=3;field.id=`table-cell-${r}-${c}`;field.value=n.rows[r][c];field.dataset.tableCell='';field.dataset.rowKey=rKeys[r];field.dataset.columnKey=cKeys[c];field.dataset.layout=String(this.renderEpoch);field.setAttribute('aria-label',`第${r+1}行第${c+1}列原文`);td.append(field);
      const items=payloads(n,'cellItems',r,c),images=payloads(n,'cellImages',r,c);if(items.length||images.length){const details=el('details',undefined,'table-preserved'),summary=el('summary',`已有内容 ${items.length} 项 · 图片 ${images.length} 张`);details.append(summary);for(const item of items.slice(0,6))details.append(el('p',typeof item?.title==='string'?item.title:'保留的单元格内容'));for(const image of images.slice(0,6))details.append(el('p',typeof image?.name==='string'?image.name:'保留的图片引用'));details.append(el('p','嵌入便签可另开编辑，其他内容和文件引用保留。','caption'));td.append(details);}
      const open=el('button','此格内容','cell-notes-open');open.dataset.cellNotes=`${r}:${c}`;open.dataset.referenceRead='';open.disabled=!this.c.canBrowse();open.onclick=()=>{this.target={row:rKeys[r],column:cKeys[c]};this.lastField=`table-cell-${r}-${c}`;this.cellNotes.open(rKeys[r],cKeys[c]);};td.append(open);tr.append(td);
    }body.append(tr);}root.append(body);
    if(!n.rows.length){const tr=el('tr'),td=el('td','还没有行。添加一行，再填写自己的内容。','table-empty');td.colSpan=Math.min(6,n.columns.length)+1;tr.append(td);body.append(tr);}
  }
  get pending(){return this.cellNotes.pending||this.paste.pending;}
  syncControls(){const n=this.c.node();if(!n)return;const editable=Boolean(this.c.canEdit());let safe=true;try{structuralCheck(n);$('tableStructureState').textContent='行列移动会带着对应文字、图片和嵌入内容一起移动。';}catch(e){safe=false;$('tableStructureState').textContent=e.message;}
    const rows=axisKeys(n,'row'),cols=axisKeys(n,'column');let r=rows.indexOf(this.target?.row),c=cols.indexOf(this.target?.column);if(c<0)c=0;if(r<0&&rows.length)r=0;this.target={row:rows[r]??null,column:cols[c]};
    $('tableCellLocation').textContent=r<0?`第${c+1}列 · 尚无行`:`当前：第${r+1}行 · 第${c+1}列`;$('tableColumnWidth').value=n.columnWidths?.[c]??160;$('tableColumnWidth').disabled=!editable||!safe;
    $('tableRowsRange').textContent=n.rows.length?`行 ${this.rowPage*20+1}—${Math.min(n.rows.length,(this.rowPage+1)*20)} / ${n.rows.length}`:'0 行';$('tableColumnsRange').textContent=`列 ${this.colPage*6+1}—${Math.min(n.columns.length,(this.colPage+1)*6)} / ${n.columns.length}`;
    for(const [axis,single] of [['Rows',n.rows.length<=20],['Columns',n.columns.length<=6]]){const range=$(`table${axis}Range`);range.closest('.table-pagination').classList.toggle('single-page',single);for(const direction of ['Previous','Next'])$(`table${axis}${direction}`).hidden=single;}
    for(const [id,disabled] of [['tableRowsPrevious',this.rowPage===0],['tableRowsNext',(this.rowPage+1)*20>=n.rows.length],['tableColumnsPrevious',this.colPage===0],['tableColumnsNext',(this.colPage+1)*6>=n.columns.length]])$(id).disabled=disabled||!this.c.canBrowse();
    $('tableAddRow').disabled=!editable||!safe||n.rows.length>=5000;$('tableAddColumn').disabled=!editable||!safe||n.columns.length>=100;
    $('tableRemoveRow').disabled=!editable||!safe||r<0;$('tableRemoveColumn').disabled=!editable||!safe||n.columns.length===1;
    for(const b of document.querySelectorAll('[data-table-order]')){const i=b.dataset.axis==='row'?r:c,length=b.dataset.axis==='row'?n.rows.length:n.columns.length,d=Number(b.dataset.tableOrder);b.disabled=!editable||!safe||i<0||i+d<0||i+d>=length;}
  }
  capture(){const n=this.c.node();if(!n)return null;const f=$(this.lastField),r=this.target?.row,c=this.target?.column;return {node:n.id,row:r,column:c,field:this.lastField,kind:f?.hasAttribute('data-table-cell')?'cell':f?.hasAttribute('data-table-heading')?'heading':'field',start:f?.selectionStart,end:f?.selectionEnd,fieldScroll:f?.scrollTop,rowPage:this.rowPage,colPage:this.colPage,scrollTop:$('tableGridScroll').scrollTop,scrollLeft:$('tableGridScroll').scrollLeft};}
  restore(place,focus=true){const n=this.c.node();if(!place||!n||place.node!==n.id)return false;this.rowPage=place.rowPage;this.colPage=place.colPage;let r=axisKeys(n,'row').indexOf(place.row),c=axisKeys(n,'column').indexOf(place.column);if(c<0)c=0;if(r<0)r=0;this.target={row:axisKeys(n,'row')[r]??null,column:axisKeys(n,'column')[c]};if(place.kind!=='field'){this.rowPage=Math.floor(r/20);this.colPage=Math.floor(c/6);}this.sync();
    const id=place.kind==='cell'&&n.rows.length?`table-cell-${r}-${c}`:place.kind==='heading'?`table-heading-${c}`:place.kind==='field'?place.field:'tableTitle',f=$(id);if(f&&focus){f.focus({preventScroll:true});if(typeof place.start==='number')f.setSelectionRange(place.start,place.end);f.scrollTop=place.fieldScroll||0;this.lastField=id;}$('tableGridScroll').scrollTop=place.scrollTop;$('tableGridScroll').scrollLeft=place.scrollLeft;return Boolean(f&&focus);
  }
  jump(r,c,kind='cell'){const n=this.c.node();if(!n)return;this.restore({node:n.id,row:axisKeys(n,'row')[r]??null,column:axisKeys(n,'column')[c],kind,start:0,end:0,rowPage:Math.floor(r/20),colPage:Math.floor(c/6),scrollTop:0,scrollLeft:0});}
  structure(kind,axis,delta){const n=this.c.node();if(!n||!this.c.canEdit()||!this.target)return;const key=axis==='row'?this.target.row:this.target.column,place=this.capture(),oldR=axisKeys(n,'row').indexOf(this.target.row),oldC=axisKeys(n,'column').indexOf(this.target.column);let info;
    try{if(kind==='remove'){info=removalInfo(n,axis,key);if(!confirm(`移除第${info.index+1}${axis==='row'?'行':'列'}？\n含 ${info.text} 格文字、${info.items} 项嵌入内容、${info.images} 张图片引用。\n素材库原文件保留，可以撤销；也可先导出白板。`))return;}if(this.c.node()!==n||!this.c.canEdit())return;const next=editTable(n,{kind,axis,key,delta});let r=oldR,c=oldC;if(kind==='move'){if(axis==='row')r+=delta;else c+=delta;}if(kind==='remove'){if(axis==='row')r=Math.min(r,next.rows.length-1);else c=Math.min(c,next.columns.length-1);}
      this.c.change(next);$('tableState').textContent='';if(kind==='add'){this.jump(axis==='row'?next.rows.length-1:Math.max(0,oldR),axis==='column'?next.columns.length-1:Math.max(0,oldC),axis==='column'?'heading':'cell');}
      else this.restore({...place,row:axisKeys(next,'row')[r]??null,column:axisKeys(next,'column')[c]});
    }catch(e){$('tableState').textContent=e.message;}
  }
}
