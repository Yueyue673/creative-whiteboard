import {tableShape,tableLayoutKey,indexFor} from './table-model.js';
const own=(n,k)=>Object.prototype.hasOwnProperty.call(n,k);
const fail=()=>{throw Error('原单元格内容已改变；这份输入仍保留，请先导出并重新核对。');};
function cellAt(n,row,column){tableShape(n);const r=indexFor(n,'row',row),c=indexFor(n,'column',column);if(own(n,'cellItems')&&!Array.isArray(n.cellItems)||n.cellItems?.[r]!==undefined&&!Array.isArray(n.cellItems[r]))throw Error('原嵌入内容无法核对；原文仍可导出。');const cell=n.cellItems?.[r]?.[c];if(cell!==undefined&&!Array.isArray(cell))throw Error('原单元格内容无法核对；原文仍可导出。');return {r,c,items:cell||[]};}
export function cellTarget(n,row,column){const {r,c,items}=cellAt(n,row,column);return {table:n.id,row,column,rowIndex:r,columnIndex:c,layout:tableLayoutKey(n),cell:JSON.stringify(items)};}
export function noteTarget(n,row,column,index){const t=cellTarget(n,row,column),{items}=cellAt(n,row,column),item=items[index];if(!Number.isInteger(index)||index<0||item?.type!=='note')throw Error('此处只编辑嵌入便签的原文；其他内容保持原样。');for(const key of ['title','body','userText','annotation'])if(own(item,key)&&typeof item[key]!=='string')throw Error('这张便签的文字格式无法核对；原文保持不变。');return {...t,index,original:JSON.stringify(item)};}
function current(n,t,whole=false){if(n?.id!==t.table||tableLayoutKey(n)!==t.layout)fail();const found=cellAt(n,t.row,t.column);if(whole?JSON.stringify(found.items)!==t.cell:JSON.stringify(found.items[t.index])!==t.original)fail();return found;}
export function validateNotePatch(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('原文修改格式无效。');for(const [key,value] of Object.entries(patch)){
  if(['title','body','userText','annotation'].includes(key)){if(typeof value!=='string')throw Error('请填写自己的原文。');}
  else if(key==='color'){if(typeof value!=='string'||!/^#[a-f0-9]{6}$/i.test(value))throw Error('请填写完整颜色值，例如 #e8e5dc。');}
  else if(key==='textFormat'){if(!['plain','markdown'].includes(value))throw Error('文字显示方式无效。');}
  else if(key==='paperStyle'){if(!['plain','lined','grid'].includes(value))throw Error('纸面样式无效。');}
  else if(key==='fontSize'){if(typeof value!=='number'||!Number.isFinite(value)||value<10||value>40)throw Error('字号须在10至40内。');}
  else throw Error('这项原始属性保持不变。');
}return patch;}
function replaceCell(n,r,c,items){const grid=n.cellItems?[...n.cellItems]:[];while(grid.length<=r)grid.push([]);const row=[...grid[r]];while(row.length<=c)row.push([]);row[c]=items;grid[r]=row;return {...n,cellItems:grid};}
export function editCellNote(n,t,patch){validateNotePatch(patch);const {r,c,items}=current(n,t),item=items[t.index];if(item?.type!=='note')fail();const next=[...items];next[t.index]={...item,...patch};return replaceCell(n,r,c,next);}
export function canAddCellNote(n){tableShape(n);if(own(n,'cellItems')&&(!Array.isArray(n.cellItems)||n.cellItems.length>n.rows.length||n.cellItems.some(row=>!Array.isArray(row)||row.length>n.columns.length||row.some(cell=>!Array.isArray(cell)))))throw Error('原嵌入内容的范围无法核对；保留原文后再添加。');return true;}
export function addCellNote(n,t,generate=()=>crypto.randomUUID()){canAddCellNote(n);const {r,c,items}=current(n,t,true);if(items.length>=5000)throw Error('此格内容已达到上限，请先核对原文。');let id;for(let i=0;i<20;i++){const v=generate();if(typeof v==='string'&&v.length>0&&v.length<=100&&!items.some(item=>item?.id===v)){id=v;break;}}if(!id)throw Error('无法创建新的便签编号；原内容保持不变。');const note={id,type:'note',title:'',body:'',x:0,y:0,w:270,h:190,sizeMode:'auto',textFormat:'plain',paperStyle:'plain',color:'#e8e5dc',fontSize:16};return {node:replaceCell(n,r,c,[...items,note]),index:items.length};}
export function formatNoteText(raw,start,end,kind){if(typeof raw!=='string'||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>raw.length)throw Error('请重新选择原文。');const wrappers={bold:['**','**'],italic:['*','*'],strike:['~~','~~'],code:['`','`'],fence:['```\n','\n```']},prefixes={heading:'# ',quote:'> ',bullet:'- ',number:'1. ',task:'- [ ] '};let from=start,to=end,replacement,caret;
  if(wrappers[kind]){const [a,b]=wrappers[kind];replacement=a+raw.slice(start,end)+b;caret=[start+a.length,end+a.length];}
  else{if(!own(prefixes,kind))throw Error('无法识别这项格式。');from=start===0?0:raw.lastIndexOf('\n',start-1)+1;to=raw.indexOf('\n',end);if(to===-1)to=raw.length;replacement=raw.slice(from,to).split('\n').map((line,i)=>(kind==='number'?`${i+1}. `:prefixes[kind])+line).join('\n');caret=[from,from+replacement.length];}
  return {text:raw.slice(0,from)+replacement+raw.slice(to),start:caret[0],end:caret[1]};
}
