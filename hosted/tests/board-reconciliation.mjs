import assert from 'node:assert/strict';
import {reconcileValues,OwnHistory,boardRaw,validateLiveBoard,valueEqual} from '../core/portal_assets/board-reconciliation.js';
const clone=structuredClone;
const original={format:'creative-board',version:1,name:'Original',nodes:[{id:'one',type:'note',x:0,y:0,w:300,h:200,sizeMode:'manual',title:'One',body:'  Original\r\n',color:'#eeeeee'},{id:'two',type:'note',x:400,y:0,w:300,h:200,title:'Two',body:'Second'}],edges:[],view:{x:42,y:53,z:1}};
let groups=0;const test=(name,fn)=>{fn();groups++;console.log('PASS '+name);};
test('Whole original text and independent note fields reconcile without altering their bases',()=>{
 const a=clone(original),b=clone(original);a.nodes[0].body='Own \r\n  ';b.nodes[0].color='#123456';b.nodes[1].title='Peer title';const before=[boardRaw(original),boardRaw(a),boardRaw(b)],v=reconcileValues(original,a,b);
 assert.equal(v.nodes[0].body,a.nodes[0].body);assert.equal(v.nodes[0].color,b.nodes[0].color);assert.equal(v.nodes[1].title,b.nodes[1].title);assert.deepEqual(before,[boardRaw(original),boardRaw(a),boardRaw(b)]);
 const identical=clone(a);assert.deepEqual(reconcileValues(original,a,identical),a);
});
test('Overlapping text, dependent layout, changed unknowns and image properties refuse',()=>{
 for(const type of ['body','layout','opaque','image']){const a=clone(original),b=clone(original);if(type==='body'){a.nodes[0].body='Own';b.nodes[0].body='Peer';}if(type==='layout'){a.nodes[0].x=10;b.nodes[0].w=333;}if(type==='opaque'){a.nodes[0].body='Own';b.nodes[0].extension={meaning:'Peer'};}if(type==='image'){for(const v of [original,a,b])v.nodes[0].type='image';a.nodes[0].title='Own';b.nodes[0].body='Peer';}assert.throws(()=>reconcileValues(original,a,b));original.nodes[0].type='note';}
});
test('Stable additions preserve peer order; deletion against edits, reorder and identity collisions refuse',()=>{
 const a=clone(original),b=clone(original);a.nodes.push({...a.nodes[0],id:'own'});b.nodes.push({...b.nodes[0],id:'peer'});assert.deepEqual(reconcileValues(original,a,b).nodes.map(n=>n.id),['one','two','peer','own']);
 a.nodes=original.nodes.slice(1);b.nodes[0].body='Later';assert.throws(()=>reconcileValues(original,a,b));
 a.nodes=clone(original.nodes).reverse();b.nodes[1].body='Changed';assert.throws(()=>reconcileValues(original,a,b));
 a.nodes=[...clone(original.nodes),{...original.nodes[0],id:'shared',body:'Own'}];b.nodes=[...clone(original.nodes),{...original.nodes[0],id:'shared',body:'Peer'}];assert.throws(()=>reconcileValues(original,a,b));
});
test('Table axes, cells and geometry stay one unit, while independent titles can reconcile',()=>{
 const base=clone(original);Object.assign(base.nodes[0],{type:'table',rows:[['Original']],columns:['Column']});const a=clone(base),b=clone(base);a.nodes[0].rows=[['Own']];b.nodes[0].w=350;assert.throws(()=>reconcileValues(base,a,b));b.nodes[0].w=300;b.nodes[0].title='Peer';const v=reconcileValues(base,a,b);assert.deepEqual(v.nodes[0].rows,[['Own']]);assert.equal(v.nodes[0].title,'Peer');
});
test('Inverse own edits preserve peer fields/additions; redo restores only own operation',()=>{
 const history=new OwnHistory(),own=clone(original);history.begin(original);own.nodes[0].body='Own';history.record(own);history.boundary();const peer=clone(own);peer.nodes[1].title='Peer';peer.nodes.push({...peer.nodes[1],id:'peer'});const undo=history.apply(peer);assert.equal(undo.nodes[0].body,original.nodes[0].body);assert.equal(undo.nodes[1].title,'Peer');assert.equal(undo.nodes.at(-1).id,'peer');assert.deepEqual(history.apply(undo,true),peer);assert.equal(history.undoEntries.length,1);
 const overlapping=clone(peer);overlapping.nodes[0].body='Later peer';const before=history.bytes();assert.throws(()=>history.apply(overlapping));assert.equal(history.undoEntries.length,1);assert.equal(history.bytes(),before);
});
test('Consecutive typing groups and bounded history keep original immutable snapshots',()=>{
 const history=new OwnHistory(),v=clone(original);history.begin(v,'typing');v.nodes[0].body='a';history.record(v);history.begin(v,'typing');v.nodes[0].body='ab';history.record(v);assert.equal(history.undoEntries.length,1);assert.equal(history.apply(v).nodes[0].body,original.nodes[0].body);history.clear();
 for(let i=0;i<35;i++){history.begin(v);v.nodes[0].title=String(i);history.record(v);history.boundary();}assert.equal(history.undoEntries.length,30);assert.ok(history.bytes()>0);
});
test('Own appended content can be undone alongside peer appended content',()=>{
 const history=new OwnHistory(),own=clone(original);history.begin(original);own.nodes.push({...own.nodes[0],id:'own'});history.record(own);history.boundary();const peer=clone(own);peer.nodes.push({...peer.nodes[0],id:'peer'});assert.deepEqual(history.apply(peer).nodes.map(n=>n.id),['one','two','peer']);
});
test('Prototype-looking keys and Boolean versus integer remain exact and never pollute objects',()=>{
 const base=JSON.parse(boardRaw(original).slice(0,-1)+',"__proto__":{"own":true},"opaque":true}'),a=clone(base),b=clone(base);a.opaque=1;b.nodes[1].title='Peer';const v=reconcileValues(base,a,b);assert.equal(v.opaque,1);assert.equal(valueEqual(true,1),false);assert.deepEqual(v.__proto__,{own:true});assert.equal(Object.prototype.own,undefined);assert.equal(Object.hasOwn(JSON.parse(boardRaw(v)),'__proto__'),true);
});
test('Malformed IDs, missing endpoints, unsafe or lossy numeric originals stop before live adoption',()=>{
 for(const edit of [v=>v.nodes.push(clone(v.nodes[0])),v=>v.nodes[0].w=-1,v=>v.edges.push({from:'one',to:'missing'}),v=>v.opaque=9007199254740992]){const v=clone(original);edit(v);assert.throws(()=>validateLiveBoard(v));}
 for(const token of ['1.0','1e0','0.1234567890123456789','1e309']){const raw=boardRaw(original).slice(0,-1)+',"opaque":'+token+'}';assert.throws(()=>validateLiveBoard(JSON.parse(raw),raw));}
 for(const token of ['1.25','0.0000001','1e-7','0.30000000000000004']){const raw=boardRaw(original).slice(0,-1)+',"opaque":'+token+',"literal":"1.0 \\"quoted\\""}';validateLiveBoard(JSON.parse(raw),raw);}
});
console.log(groups+' original-value reconciliation groups passed');
