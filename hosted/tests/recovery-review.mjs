import assert from 'node:assert/strict';
import {RecoveryReview} from '../core/portal_assets/recovery-review.js';
const clone=structuredClone,raw=value=>JSON.stringify(value,null,2);
const base={format:'creative-board',version:1,name:'Original',nodes:[{id:'a',type:'note',x:1,y:2,w:300,h:180,sizeMode:'manual',title:'  Literal title  ',body:'  Original\r\n😀  ',opaque:{keep:[true,1]}},{id:'b',type:'table',x:400,y:2,w:360,h:240,title:'Original table',rows:[['Own']],columns:['Column']}],edges:[],view:{x:42,y:53,z:1},extension:{keep:[true,1]}};
let groups=0;function test(name,fn){fn();groups++;console.log('PASS '+name);}
test('Readable replacement counts include whole-node, deletion, addition, ordering and board metadata without editing originals',()=>{
 const next=clone(base);next.name='Own replacement';next.nodes[0].body='  Own exact\r\n第二行 😀  ';next.nodes.pop();next.nodes.push({...clone(next.nodes[0]),id:'c',title:'New own title'});next.edges=[{from:'a',to:'c'}];next.extension.keep[0]=1;next.view.x=99;
 const before=raw(base),source=raw(next),r=new RecoveryReview(),s=r.select(before,source);assert.deepEqual([s.added,s.changed,s.removed,s.unchanged],[1,1,1,0]);assert.deepEqual(s.changes.map(x=>x.kind),['changed','removed','added']);assert.equal(s.nameChanged,true);assert.equal(s.relationsChanged,true);assert.equal(s.orderChanged,true);assert.equal(s.otherChanged,true);assert.equal(s.viewChanged,true);assert.equal(r.source,source);assert.deepEqual(r.value(before),next);assert.equal(raw(base),before);assert.equal(raw(next),source);
});
test('A different node order or relation label is visible even when individual nodes do not change',()=>{
 const next=clone(base);next.nodes.reverse();const r=new RecoveryReview(),s=r.select(raw(base),raw(next));assert.deepEqual([s.changed,s.added,s.removed],[0,0,0]);assert.equal(s.orderChanged,true);assert.equal(s.identical,false);
 const edgeBase=clone(base);edgeBase.edges=[{from:'a',to:'b',label:'Own first'}];const edgeNext=clone(edgeBase);edgeNext.edges[0].label='Own second';assert.equal(r.select(raw(edgeBase),raw(edgeNext)).relationsChanged,true);
});
test('Missing versus null and opaque Boolean versus number remain distinct replacement changes',()=>{
 const r=new RecoveryReview(),next=clone(base);next.extension.keep[0]=1;let s=r.select(raw(base),raw(next));assert.equal(s.otherChanged,true);assert.equal(s.identical,false);
 delete next.view;s=r.select(raw(base),raw(next));assert.equal(s.viewChanged,true);next.view=null;s=r.select(raw({...base,view:undefined}),raw(next));assert.equal(s.viewChanged,true);
});
test('Reviewed source and current input are exact immutable snapshots; a later page change refuses application',()=>{
 const r=new RecoveryReview(),current=raw(base),next=clone(base);next.nodes[0].body='Candidate';const source=raw(next),summary=r.select(current,source);assert(Object.isFrozen(summary));assert(Object.isFrozen(summary.changes));assert(Object.isFrozen(summary.changes[0]));next.nodes[0].body='Later external mutation';assert.equal(r.value(current).nodes[0].body,'Candidate');const adopted=r.value(current);adopted.nodes[0].body='Later adopted mutation';assert.equal(r.value(current).nodes[0].body,'Candidate');assert.equal(r.matches(current+' '),false);assert.throws(()=>r.value(current+' '));assert.equal(r.source,source);r.clear();assert.equal(r.summary,null);assert.equal(r.source,null);assert.throws(()=>r.value(current));
});
test('Unsupported originals fail before replacing a selected review; lossy numeric tokens are never normalized',()=>{
 const r=new RecoveryReview();r.select(raw(base),raw(base));const invalid=clone(base);invalid.nodes.push(clone(invalid.nodes[0]));assert.throws(()=>r.select(raw(base),raw(invalid)));assert.equal(r.summary,null);assert.equal(r.source,null);
 for(const token of ['1.0','0.1234567890123456789','9007199254740993']){const source=raw(base).slice(0,-1)+',"unsafe":'+token+'}';assert.throws(()=>r.select(raw(base),source));assert.equal(r.source,null);}
 const bad=clone(base);bad.edges=[{from:'a',to:'missing'}];assert.throws(()=>r.select(raw(base),raw(bad)));
});
test('Semantically identical raw data needs no application while the complete selected raw remains exportable',()=>{
 const r=new RecoveryReview(),source=JSON.stringify(base);assert.equal(r.select(raw(base),source).identical,true);assert.equal(r.source,source);assert.deepEqual(r.value(raw(base)),base);
});
test('Authored labels remain literal, codepoint-bounded and cannot pollute object prototypes',()=>{
 const next=JSON.parse(raw(base).slice(0,-1)+',"__proto__":{"keep":true}}');next.nodes[0].title='<img src=x onerror=alert(1)> '+ '😀'.repeat(100);const r=new RecoveryReview(),s=r.select(raw(base),raw(next));assert(s.changes[0].label.startsWith('<img'));assert.equal([...s.changes[0].label].length,80);assert.equal(Object.prototype.keep,undefined);assert.equal(Object.hasOwn(r.value(raw(base)),'__proto__'),true);assert.deepEqual(r.value(raw(base)).__proto__,{keep:true});
});
test('Large valid selections count every removed original without silently trimming the replacement plan',()=>{
 const many=clone(base);many.nodes=Array.from({length:5000},(_,i)=>({...clone(base.nodes[0]),id:'node-'+i}));const empty={...clone(many),nodes:[]};const r=new RecoveryReview(),s=r.select(raw(many),raw(empty));assert.equal(s.removed,5000);assert.equal(s.changes.length,5000);assert.equal(r.value(raw(many)).nodes.length,0);
});
console.log(groups+' original recovery review groups passed');
