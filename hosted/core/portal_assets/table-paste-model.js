import {tableShape,structuralCheck,axisKeys,indexFor} from './table-model.js';
export const pasteLimits=Object.freeze({text:1048576,rows:5000,columns:100,cells:50000});
export function parseTablePaste(text,delimiter='\t'){
  if(typeof text!=='string'||!text.length)throw Error('先粘贴自己的表格内容。');
  if(text.length>pasteLimits.text)throw Error('一次最多粘贴约100万字符；请分成几次。');
  if(!['\t',','].includes(delimiter))throw Error('请选择制表符或逗号分隔。');
  const rows=[];let row=[],value='',quoted=false,closed=false,start=true,cells=0;
  const field=()=>{row.push(value);if(row.length>pasteLimits.columns||++cells>pasteLimits.cells)throw Error('一次最多100列、50000格；请分成几次。');value='';closed=false;start=true;};
  const record=()=>{field();if(rows.length&&row.length!==rows[0].length)throw Error(`第${rows.length+1}行有${row.length}格，与第一行的${rows[0].length}格不同；请核对分隔方式和原文。`);rows.push(row);if(rows.length>pasteLimits.rows)throw Error('一次最多5000行；请分成几次。');row=[];};
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
    if(ch===delimiter){field();continue;}
    if(ch==='\r'||ch==='\n'){record();if(ch==='\r'&&text[i+1]==='\n')i++;continue;}
    if(closed)throw Error('引号结束后还有未分隔的文字；请核对原文，内容没有应用。');
    if(ch==='"'){if(!start)throw Error('格内引号需要双写并包在引号里；请核对原文。');quoted=true;start=false;continue;}
    value+=ch;start=false;
  }
  if(quoted)throw Error('有一格的引号尚未结束；请核对原文，内容没有应用。');
  if(row.length||value.length||closed||!rows.length)record();
  return rows;
}
function matrixShape(matrix){
  if(!Array.isArray(matrix)||!matrix.length||matrix.length>pasteLimits.rows||!Array.isArray(matrix[0])||!matrix[0].length||matrix[0].length>pasteLimits.columns||matrix.length*matrix[0].length>pasteLimits.cells||matrix.some(row=>!Array.isArray(row)||row.length!==matrix[0].length||row.some(value=>typeof value!=='string')))throw Error('粘贴内容的行列范围无法核对。');
  let length=0;for(const row of matrix)for(const value of row){length+=value.length;if(length>pasteLimits.text)throw Error('粘贴原文超过了本次容量。');}
}
export function tablePasteTarget(n,row,column){
  tableShape(n);const r=n.rows.length?indexFor(n,'row',row):0,c=indexFor(n,'column',column);
  return Object.freeze({table:n.id,row:r,column:c,base:JSON.stringify(n)});
}
export function checkTablePasteTarget(n,target){
  tableShape(n);if(!target||target.table!==n.id||!Number.isInteger(target.row)||target.row<0||target.row>=Math.max(1,n.rows.length)||!Number.isInteger(target.column)||target.column<0||target.column>=n.columns.length||JSON.stringify(n)!==target.base)throw Error('原表格或起点已改变；粘贴原文仍保留，请导出后重新选择。');
}
export function planTablePaste(n,target,matrix){
  checkTablePasteTarget(n,target);matrixShape(matrix);
  const rows=Math.max(n.rows.length,target.row+matrix.length),columns=Math.max(n.columns.length,target.column+matrix[0].length);
  if(rows>5000||columns>100)throw Error('从这个起点粘贴会超出5000行或100列；原表格保持不变。');
  const addedRows=rows-n.rows.length,addedColumns=columns-n.columns.length;if(addedRows||addedColumns)structuralCheck(n);
  let changed=0,overwritten=0,items=0,images=0;
  for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix[r].length;c++){
    const y=target.row+r,x=target.column+c,before=n.rows[y]?.[x]??'';
    if(before!==matrix[r][c]){changed++;if(before.length)overwritten++;}
    for(const [key,count] of [['cellItems','items'],['cellImages','images']]){const cell=n[key]?.[y]?.[x];if(Array.isArray(cell)){if(count==='items')items+=cell.length;else images+=cell.length;}}
  }
  return {rows,columns,addedRows,addedColumns,changed,overwritten,items,images};
}
function nextID(ids,generate){for(let i=0;i<20;i++){const id=generate();if(typeof id==='string'&&id.length>0&&id.length<=100&&!ids.includes(id))return id;}throw Error('无法核对新的行列编号；原表格保持不变。');}
export function applyTablePaste(n,target,matrix,generate=()=>crypto.randomUUID()){
  const plan=planTablePaste(n,target,matrix);if(!plan.changed&&!plan.addedRows&&!plan.addedColumns)return n;
  let next;
  if(plan.addedRows||plan.addedColumns){
    next=structuredClone(n);
    for(const [key,axis,length] of [['rowIds','row',plan.rows],['columnIds','column',plan.columns]]){
      const ids=next[key]??[];if(!next[key])for(const _ of axisKeys(n,axis))ids.push(nextID(ids,generate));while(ids.length<length)ids.push(nextID(ids,generate));next[key]=ids;
    }
    while(next.columns.length<plan.columns)next.columns.push('');
    next.rows=Array.from({length:plan.rows},(_,r)=>Array.from({length:plan.columns},(_,c)=>n.rows[r]?.[c]??''));
    for(const key of ['cellItems','cellImages'])if(Object.prototype.hasOwnProperty.call(n,key))next[key]=Array.from({length:plan.rows},(_,r)=>Array.from({length:plan.columns},(_,c)=>next[key][r]?.[c]??[]));
    if(next.columnWidths)while(next.columnWidths.length<plan.columns)next.columnWidths.push(160);
  }else{next={...n,rows:[...n.rows]};for(let r=0;r<matrix.length;r++)next.rows[target.row+r]=[...next.rows[target.row+r]];}
  for(let r=0;r<matrix.length;r++)for(let c=0;c<matrix[r].length;c++)next.rows[target.row+r][target.column+c]=matrix[r][c];
  return next;
}
