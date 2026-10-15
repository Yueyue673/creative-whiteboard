/* Original-value reconciliation mirrors the server's conservative groups.
   Strings are selected whole. This is not character merging or a CRDT. */
export class ReconciliationError extends Error {}
const missing = Symbol('absent original field');
const own = (value, key) => Object.hasOwn(value, key);
const groups = [
  ['id','type','x','y','w','h','sizeMode'], ['title'], ['body','userText','textFormat'],
  ['annotation'], ['color','paperStyle'],
  ['rows','columns','rowIds','columnIds','columnWidths','cellItems','cellImages'],
];
const union = (...values) => [...new Set(values.flat())];
const keys = value => Object.keys(value);
const pick = (value, selected) => Object.fromEntries(selected.filter(key=>own(value,key)).map(key=>[key,value[key]]));

export function valueEqual(a,b) {
  if (a===missing || b===missing) return a===b;
  if (typeof a!==typeof b || a===null || b===null) return a===b;
  if (typeof a!=='object') return a===b;
  if (Array.isArray(a)!==Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length===b.length && a.every((value,index)=>valueEqual(value,b[index]));
  const left=keys(a), right=keys(b);
  return left.length===right.length && left.every(key=>own(b,key)&&valueEqual(a[key],b[key]));
}
function choose(base, incoming, current) {
  if (valueEqual(incoming,current)||valueEqual(base,incoming)) return current;
  if (valueEqual(base,current)) return incoming;
  throw new ReconciliationError('这部分内容又被修改，原输入保持不变。');
}
function stableCells(value) {
  const {rows,columns}=value;
  if(!Array.isArray(rows)||rows.length>5000||!Array.isArray(columns)||columns.length<1||columns.length>100||columns.some(value=>typeof value!=='string'))return false;
  for(const [name,length] of [['rowIds',rows.length],['columnIds',columns.length]]){
    const ids=value[name];
    if(!Array.isArray(ids)||ids.length!==length||ids.some(id=>typeof id!=='string'||![...id].length||[...id].length>100)||new Set(ids).size!==length)return false;
  }
  return rows.every(row=>Array.isArray(row)&&row.length===columns.length&&row.every(cell=>typeof cell==='string'));
}
const withoutRows=value=>pick(value,keys(value).filter(key=>key!=='rows'));
function tableCells(base,incoming,current) {
  try{return choose(base,incoming,current);}catch(error){if(!(error instanceof ReconciliationError))throw error;}
  const values=[base,incoming,current],context=values.map(withoutRows);
  if(!values.every(stableCells)||context.slice(1).some(value=>!valueEqual(context[0],value)))throw new ReconciliationError('表格行列、尺寸或格内资料又被修改，原输入保持不变。');
  // A conflicting cell refuses the complete operation, before any write.
  return {...current,rows:base.rows.map((row,r)=>row.map((_,c)=>choose(base.rows[r][c],incoming.rows[r][c],current.rows[r][c])))};
}
/* A clean focused cell can receive other cells without replacing its input.
   Pending typing, composition, gestures and dialogs are guarded by the caller. */
export function canReceiveTableCell(base,next,rowKey,columnKey,fieldValue) {
  if(base?.type!=='table'||next?.type!=='table'||!stableCells(base)||!stableCells(next)||!valueEqual(withoutRows(base),withoutRows(next)))return false;
  const row=base.rowIds.indexOf(rowKey),column=base.columnIds.indexOf(columnKey);
  return row>=0&&column>=0&&typeof fieldValue==='string'&&base.rows[row][column]===fieldValue&&next.rows[row][column]===fieldValue;
}
function node(base,incoming,current) {
  if ([base,incoming,current].includes(missing)) return choose(base,incoming,current);
  if (incoming.type!==base.type || current.type!==base.type) return choose(base,incoming,current);
  const all=union(keys(base),keys(incoming),keys(current)),known=new Set(groups.flat()),unknown=all.filter(key=>!known.has(key));
  const opaque=[base,incoming,current].map(value=>pick(value,unknown));
  if (base.type==='image'||opaque.slice(1).some(value=>!valueEqual(opaque[0],value))) return choose(base,incoming,current);
  const selected=base.type==='table'?[union(groups[0],groups[5]),...groups.slice(1,5),unknown]:[...groups,unknown];
  return Object.fromEntries(selected.flatMap(group=>Object.entries((base.type==='table'&&group.includes('rows')?tableCells:choose)(...[base,incoming,current].map(value=>pick(value,group))))));
}
function sequence(base,incoming,current,isNodes) {
  try { return structuredClone(choose(base,incoming,current)); } catch(error) { if(!(error instanceof ReconciliationError))throw error; }
  if (![base,incoming,current].every(Array.isArray)) throw new ReconciliationError('内容顺序无法合并，原输入保持不变。');
  const order=[base,incoming,current].map(rows=>rows.map(row=>row?.id));
  if (order.some(ids=>ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)) throw new ReconciliationError('内容编号无法核对。');
  const maps=[base,incoming,current].map(rows=>new Map(rows.map(row=>[row.id,row]))),original=maps[0];
  for(const ids of order.slice(1)){
    const surviving=ids.filter(id=>original.has(id)),set=new Set(surviving);
    if(!valueEqual(surviving,order[0].filter(id=>set.has(id)))||!valueEqual(ids.slice(0,surviving.length),surviving))throw new ReconciliationError('内容顺序又被修改，未自动重排。');
  }
  const combined=new Map();
  for(const id of union(...order)){
    const values=maps.map(map=>map.has(id)?map.get(id):missing),value=isNodes?node(...values):choose(...values);
    if(value!==missing)combined.set(id,structuredClone(value));
  }
  return [...order[2],...order[1].filter(id=>!maps[2].has(id))].filter(id=>combined.has(id)).map(id=>combined.get(id));
}
export function reconcileValues(base,incoming,current) {
  const entries=[];
  for(const key of union(keys(base),keys(incoming),keys(current))){
    const values=[base,incoming,current].map(value=>own(value,key)?value[key]:missing);
    const value=['nodes','edges'].includes(key)?sequence(...values,key==='nodes'):choose(...values);
    if(value!==missing)entries.push([key,structuredClone(value)]);
  }
  return Object.fromEntries(entries);
}
export function boardRaw(value) {
  const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(keys(value).sort().map(key=>[key,sort(value[key])])):value;
  return JSON.stringify(sort(value),null,2);
}
/* JSON numbers that JavaScript would round or change from decimal to integer
   must not be silently rewritten with an unrelated edit. Scan outside strings. */
function exactNumbers(raw) {
  const normalized=token=>{
    const [mantissa,exponent='0']=token.toLowerCase().split('e');
    const negative=mantissa.startsWith('-'),unsigned=negative?mantissa.slice(1):mantissa;
    const [whole,fraction='']=unsigned.split('.');let digits=(whole+fraction).replace(/^0+/,'')||'0';
    let power=Number(exponent)-fraction.length;
    while(digits.length>1&&digits.endsWith('0')){digits=digits.slice(0,-1);power++;}
    return digits==='0'?'0':`${negative?'-':''}${digits}e${power}`;
  };
  const tokens=/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for(const match of raw.matchAll(tokens)){
    const token=match[0];if(token.startsWith('"'))continue;const number=Number(token);
    if(!Number.isFinite(number)||(Number.isInteger(number)&&/[.eE]/.test(token))||normalized(token)!==normalized(String(number)))throw new ReconciliationError('原数据含有当前编辑器不能准确保留的数值，原文件可导出，未启用共同编辑。');
  }
}
export function validateLiveBoard(value,originalRaw) {
  if(typeof originalRaw==='string')exactNumbers(originalRaw);
  if (!value||value.format!=='creative-board'||value.version!==1||typeof value.name!=='string'||!Array.isArray(value.nodes)||!Array.isArray(value.edges)||value.nodes.length>5000||value.edges.length>10000)throw new ReconciliationError('完整白板返回结果无法核对。');
  const ids=new Set();
  for(const item of value.nodes){
    if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(item.id)||ids.has(item.id)||!['note','table','frame','image'].includes(item.type))throw new ReconciliationError('返回内容的编号或类型无法核对。');
    ids.add(item.id);
    if(['x','y','w','h'].some(key=>typeof item[key]!=='number'||!Number.isFinite(item[key])||Math.abs(item[key])>=1000000)||item.w<=0||item.h<=0)throw new ReconciliationError('返回内容的尺寸无法核对。');
    if(['title','body','userText','annotation','url'].some(key=>own(item,key)&&typeof item[key]!=='string'))throw new ReconciliationError('返回原文字段无法核对。');
  }
  if(value.edges.some(edge=>!edge||!ids.has(edge.from)||!ids.has(edge.to)))throw new ReconciliationError('返回连线无法核对。');
  const pending=[[value,0]];
  while(pending.length){const[item,depth]=pending.pop();if(depth>64||(typeof item==='number'&&(!Number.isFinite(item)||(Number.isInteger(item)&&!Number.isSafeInteger(item)))))throw new ReconciliationError('原数据含有当前编辑器不能准确表示的数值或结构，未启用共同编辑。');if(item&&typeof item==='object')for(const child of Object.values(item))pending.push([child,depth+1]);}
  return value;
}

/* Inverse application changes only this author's operation when its original
   target still agrees. Another author's later overlapping edit is refused. */
export class OwnHistory {
  undoEntries=[]; redoEntries=[]; pending=null; group=null; totalBytes=0;
  size(value){return new TextEncoder().encode(boardRaw(value)).length;}
  begin(value,group=null){if(group&&group===this.group&&this.pending)return;const size=this.size(value);this.pending={before:structuredClone(value),after:structuredClone(value),beforeBytes:size,afterBytes:size};this.undoEntries.push(this.pending);this.totalBytes+=size*2;this.redoEntries=[];this.group=group;}
  record(value){if(!this.pending)return;const size=this.size(value);this.totalBytes+=size-this.pending.afterBytes;this.pending.afterBytes=size;this.pending.after=structuredClone(value);while(this.undoEntries.length>30||this.totalBytes>24*1024*1024&&this.undoEntries.length>1){const removed=this.undoEntries.shift();this.totalBytes-=removed.beforeBytes+removed.afterBytes;}}
  bytes(){return this.totalBytes;}
  boundary(){this.pending=null;this.group=null;}
  clear(){this.undoEntries=[];this.redoEntries=[];this.totalBytes=0;this.boundary();}
  apply(current,redo=false){
    const from=redo?this.redoEntries:this.undoEntries,to=redo?this.undoEntries:this.redoEntries,entry=from.at(-1);
    if(!entry)return null;
    const value=reconcileValues(redo?entry.before:entry.after,redo?entry.after:entry.before,current);
    validateLiveBoard(value);from.pop();to.push(entry);this.totalBytes+=(redo?1:-1)*(entry.beforeBytes+entry.afterBytes);this.boundary();return value;
  }
}
