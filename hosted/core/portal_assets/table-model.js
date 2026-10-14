const own=(n,k)=>Object.prototype.hasOwnProperty.call(n,k);
const idOK=id=>typeof id==='string'&&id.length>0&&id.length<=100;
export function tableShape(n){
  if(n?.type!=='table'||!Array.isArray(n.columns)||n.columns.length<1||n.columns.length>100||n.columns.some(x=>typeof x!=='string')||!Array.isArray(n.rows)||n.rows.length>5000||n.rows.some(r=>!Array.isArray(r)||r.length!==n.columns.length||r.some(x=>typeof x!=='string')))throw Error('表格文字结构无法核对；原内容仍可导出。');
  for(const [key,axis] of [['rowIds','rows'],['columnIds','columns']])if(own(n,key)&&(!Array.isArray(n[key])||n[key].length!==n[axis].length||n[key].some(id=>!idOK(id))||new Set(n[key]).size!==n[key].length))throw Error('行列编号无法核对；原内容保持不变。');
  return n;
}
export function axisKeys(n,axis){if(n?.type!=='table'||!Array.isArray(n.rows)||!Array.isArray(n.columns))throw Error('表格结构无法核对。');return axis==='row'?(n.rowIds||n.rows.map((_,i)=>`legacy-row:${i}`)):(n.columnIds||n.columns.map((_,i)=>`legacy-column:${i}`));}
export function tableLayoutKey(n){return JSON.stringify([n.id,axisKeys(n,'row'),axisKeys(n,'column')]);}
export function indexFor(n,axis,key){const i=axisKeys(n,axis).indexOf(key);if(i<0)throw Error('刚才的行列已改变；请重新选择单元格。');return i;}
export function structuralCheck(n){
  tableShape(n);
  for(const key of ['cellItems','cellImages'])if(own(n,key)&&(!Array.isArray(n[key])||n[key].length>n.rows.length||n[key].some(row=>!Array.isArray(row)||row.length>n.columns.length||row.some(cell=>!Array.isArray(cell)))))throw Error('已有单元格内容的范围无法核对；可编辑文字，但请先保留原文，再整理行列。');
  if(own(n,'columnWidths')&&(!Array.isArray(n.columnWidths)||n.columnWidths.length!==n.columns.length||n.columnWidths.some(w=>typeof w!=='number'||!Number.isFinite(w)||w<=0)))throw Error('已有列宽无法核对；整理行列保持暂停，原文仍可导出。');
  return n;
}
function nextID(ids,generate){for(let i=0;i<20;i++){const id=generate();if(idOK(id)&&!ids.includes(id))return id;}throw Error('无法创建新的行列编号；原内容保持不变。');}
function prepare(n,generate){
  structuralCheck(n);const next=structuredClone(n);
  if(!own(next,'rowIds')){next.rowIds=[];for(const _ of next.rows)next.rowIds.push(nextID(next.rowIds,generate));}
  if(!own(next,'columnIds')){next.columnIds=[];for(const _ of next.columns)next.columnIds.push(nextID(next.columnIds,generate));}
  for(const key of ['cellItems','cellImages'])if(own(next,key))next[key]=next.rows.map((_,r)=>next.columns.map((_,c)=>next[key][r]?.[c]??[]));
  return next;
}
export function editTable(n,action,generate=()=>crypto.randomUUID()){
  tableShape(n);let next;
  if(['title','body'].includes(action.kind)){if(typeof action.value!=='string')throw Error('请填写自己的原文。');return {...n,[action.kind]:action.value};}
  if(action.kind==='cell'){const r=indexFor(n,'row',action.row),c=indexFor(n,'column',action.column);if(typeof action.value!=='string')throw Error('单元格原文格式无效。');next={...n,rows:[...n.rows]};next.rows[r]=[...n.rows[r]];next.rows[r][c]=action.value;return next;}
  if(action.kind==='heading'){const c=indexFor(n,'column',action.column);if(typeof action.value!=='string')throw Error('列名格式无效。');next={...n,columns:[...n.columns]};next.columns[c]=action.value;return next;}
  if(action.kind==='geometry'){const patch=action.patch;if(!patch||Object.keys(patch).some(k=>!['w','h'].includes(k))||Object.values(patch).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<80||v>999000))throw Error('表格宽高须在80至999000内。');return {...n,...patch};}
  if(action.kind==='width'){structuralCheck(n);const c=indexFor(n,'column',action.column);if(typeof action.value!=='number'||!Number.isFinite(action.value)||action.value<100||action.value>900)throw Error('新的列宽须在100至900内。');const widths=n.columnWidths?[...n.columnWidths]:n.columns.map(()=>160);widths[c]=action.value;return {...n,columnWidths:widths};}
  if(!['add','move','remove'].includes(action.kind)||!['row','column'].includes(action.axis))throw Error('无法识别这项行列操作。');
  const axis=action.axis,oldIndex=action.kind==='add'?null:indexFor(n,axis,action.key);next=prepare(n,generate);
  const axisArray=axis==='row'?next.rows:next.columns,ids=axis==='row'?next.rowIds:next.columnIds;
  if(action.kind==='add'){
    if(axisArray.length>=(axis==='row'?5000:100))throw Error('最多保留5000行、100列。');
    ids.push(nextID(ids,generate));
    if(axis==='row'){next.rows.push(next.columns.map(()=>''));for(const k of ['cellItems','cellImages'])if(own(next,k))next[k].push(next.columns.map(()=>[]));}
    else{next.columns.push('');for(const row of next.rows)row.push('');for(const k of ['cellItems','cellImages'])if(own(next,k))for(const row of next[k])row.push([]);if(own(next,'columnWidths'))next.columnWidths.push(160);}
  }else{
    if(action.kind==='remove'&&axis==='column'&&next.columns.length===1)throw Error('至少保留一列。');
    const to=oldIndex+action.delta;
    if(action.kind==='move'&&(![-1,1].includes(action.delta)||to<0||to>=axisArray.length))throw Error('已经在行列边缘。');
    const apply=array=>{if(action.kind==='remove')array.splice(oldIndex,1);else array.splice(to,0,array.splice(oldIndex,1)[0]);};
    apply(axisArray);apply(ids);
    if(axis==='row'){for(const k of ['cellItems','cellImages'])if(own(next,k))apply(next[k]);}
    else{for(const row of next.rows)apply(row);for(const k of ['cellItems','cellImages'])if(own(next,k))for(const row of next[k])apply(row);if(own(next,'columnWidths'))apply(next.columnWidths);}
  }
  return next;
}
export function removalInfo(n,axis,key){
  structuralCheck(n);const index=indexFor(n,axis,key),positions=axis==='row'?n.columns.map((_,c)=>[index,c]):n.rows.map((_,r)=>[r,index]);
  return {index,text:positions.filter(([r,c])=>n.rows[r][c].length>0).length,items:positions.reduce((s,[r,c])=>s+(n.cellItems?.[r]?.[c]?.length||0),0),images:positions.reduce((s,[r,c])=>s+(n.cellImages?.[r]?.[c]?.length||0),0)};
}
