import assert from 'node:assert/strict';
import {reconcileValues,OwnHistory,boardRaw,canReceiveTableCell} from '../core/portal_assets/board-reconciliation.js';
const clone=structuredClone;
const base={format:'creative-board',version:1,name:'Original',nodes:[{id:'table',type:'table',x:0,y:0,w:360,h:240,sizeMode:'manual',title:'Original',columns:['A','B'],rows:[['Original A','Original B'],['Original C','Original D']],rowIds:['row-a','row-b'],columnIds:['col-a','col-b'],columnWidths:[160,170],cellItems:[[[{body:'  Own raw  '}],[]],[[],[]]],cellImages:[[[],[]],[[],[]]],opaque:{keep:[true,1,'  Original  ']}}],edges:[],view:{x:42,y:53,z:1}};
const table=value=>value.nodes[0];
let groups=0;const test=(name,fn)=>{fn();groups++;console.log('PASS '+name);};
test('Different stable cells retain complete exact strings and independent titles without mutating originals',()=>{
 const a=clone(base),b=clone(base);table(a).rows[0][0]='  Own **raw**\r\n第二行 😀  ';table(b).rows[0][1]='  Peer\n\t  ';table(b).title='Peer';const before=[base,a,b].map(boardRaw),v=reconcileValues(base,a,b);
 assert.deepEqual(table(v).rows[0],[table(a).rows[0][0],table(b).rows[0][1]]);assert.equal(table(v).title,'Peer');assert.deepEqual([base,a,b].map(boardRaw),before);
 for(const field of ['rowIds','columnIds','columnWidths','cellItems','cellImages','opaque'])assert.deepEqual(table(v)[field],table(base)[field]);
});
test('One overlapping string refuses all cells; identical whole strings converge',()=>{
 const a=clone(base),b=clone(base);table(a).rows[0]=['Own A','Own B'];table(b).rows[0][1]='Peer B';assert.throws(()=>reconcileValues(base,a,b));table(b).rows[0][1]='Own B';assert.deepEqual(reconcileValues(base,a,b),a);
});
test('Concurrent axes, geometry, embedded content and opaque changes refuse cell splitting',()=>{
 for(const [field,value] of [['rowIds',['row-b','row-a']],['columnIds',['col-b','col-a']],['columns',['Changed','B']],['columnWidths',[170,170]],['x',99],['sizeMode','auto'],['cellItems',[[[],[]],[[],[]]]],['cellImages',[[['changed'],[]],[[],[]]]],['opaque',{keep:[1,1,'  Original  ']}]]){
  const a=clone(base),b=clone(base);table(a).rows[0][0]='Own';table(b)[field]=value;assert.throws(()=>reconcileValues(base,a,b),field);
 }
 const a=clone(base),b=clone(base);table(a).rows[0][0]='Own';table(b).rows.push(['','']);table(b).rowIds.push('new-row');assert.throws(()=>reconcileValues(base,a,b));
});
test('Legacy IDs, invalid axes, ragged or nontext rows stay conservative; codepoint IDs match the server',()=>{
 for(const [field,value] of [['rowIds',undefined],['columnIds',['col-a','col-a']],['rowIds',['row-a','']],['rowIds',['row-a',1]],['rowIds',['x'.repeat(101),'row-b']],['rows',[['Original A','Original B'],['Original C']]],['rows',[['Original A','Original B'],['Original C',true]]]]){
  const old=clone(base);if(value===undefined)delete table(old)[field];else table(old)[field]=value;const a=clone(old),b=clone(old);table(a).rows[0][0]='Own';table(b).rows[0][1]='Peer';assert.throws(()=>reconcileValues(old,a,b));
 }
 const old=clone(base);table(old).rowIds[0]='😀'.repeat(100);const a=clone(old),b=clone(old);table(a).rows[0][0]='Own';table(b).rows[0][1]='Peer';assert.deepEqual(table(reconcileValues(old,a,b)).rows[0],['Own','Peer']);
});
test('Undo and redo invert only the own cell; later overlapping peer input refuses without popping history',()=>{
 const h=new OwnHistory(),a=clone(base);h.begin(base);table(a).rows[0][0]='Own';h.record(a);h.boundary();const b=clone(a);table(b).rows[0][1]='Peer';const undo=h.apply(b);assert.deepEqual(table(undo).rows[0],['Original A','Peer']);assert.deepEqual(h.apply(undo,true),b);
 const later=clone(b);table(later).rows[0][0]='Later peer';const bytes=h.bytes();assert.throws(()=>h.apply(later));assert.equal(h.undoEntries.length,1);assert.equal(h.bytes(),bytes);
});
test('Input typed during a pending save rebases onto canonical independent cells exactly',()=>{
 const submitted=clone(base),peer=clone(base);table(submitted).rows[0][0]='Own first';table(peer).rows[0][1]='Peer';const canonical=reconcileValues(base,submitted,peer),later=clone(submitted);table(later).rows[1][0]='  Own later\n😀  ';const next=reconcileValues(submitted,later,canonical);assert.deepEqual(table(next).rows,[['Own first','Peer'],['  Own later\n😀  ','Original D']]);
 table(later).rows[0][1]='Overlapping later';assert.throws(()=>reconcileValues(submitted,later,canonical));
});
test('Only an unchanged exact focused cell on unchanged stored axes may receive other cells',()=>{
 const old=table(base),next=clone(old);next.rows[0][1]='Peer';assert.equal(canReceiveTableCell(old,next,'row-a','col-a','Original A'),true);
 for(const [r,c,value] of [['row-a','col-b','Original B'],['missing','col-a','Original A'],['row-a','col-a','Unsaved'],['row-a','col-a',undefined]])assert.equal(canReceiveTableCell(old,next,r,c,value),false);
 for(const change of [v=>v.rowIds.reverse(),v=>v.w++,v=>v.cellItems[0][0].push({body:'Changed'}),v=>v.opaque.keep[0]=1,v=>delete v.columnIds,v=>v.rows[0][0]='Changed']){const v=clone(next);change(v);assert.equal(canReceiveTableCell(old,v,'row-a','col-a','Original A'),false);}
 assert.equal(canReceiveTableCell(undefined,next,'row-a','col-a','Original A'),false);
});
console.log(groups+' exact table-cell reconciliation groups passed');
