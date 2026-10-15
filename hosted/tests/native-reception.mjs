import assert from 'node:assert/strict';
import {prepareNativeReception,applyReceivedBoard} from '../core/portal_assets/native-reception.js';
const clone=structuredClone;
const original={format:'creative-board',version:1,name:'Original',nodes:[{id:'one',type:'note',x:0,y:0,w:300,h:200,title:'Original title',body:'  Original 😀\r\n',color:'#eeeeee'},{id:'two',type:'note',x:400,y:0,w:300,h:200,title:'Second',body:'Second'}],edges:[{id:'edge',from:'one',to:'two'}],view:{x:42,y:53,z:1}};
let groups=0;function test(name,run){run();groups++;console.log('PASS '+name);}
test('Native full snapshots retain peer edits in both Undo and Redo without moving this device',()=>{
 const base=clone(original),undo=clone(original),redo=clone(original),peer=clone(original);base.nodes[0].title='Own title';redo.nodes[0].title='Own later title';peer.nodes[0].title=base.nodes[0].title;peer.nodes[0].body='  Exact peer 😀\r\n';peer.view={x:999,y:888,z:2};
 const before=JSON.stringify([base,peer,undo,redo]),result=prepareNativeReception(base,peer,[undo],[redo]);
 assert.equal(result.undo[0].nodes[0].title,'Original title');assert.equal(result.redo[0].nodes[0].title,'Own later title');
 for(const value of [result.board,...result.undo,...result.redo]){assert.equal(value.nodes[0].body,'  Exact peer 😀\r\n');assert.deepEqual(value.view,original.view);}
 assert.equal(JSON.stringify([base,peer,undo,redo]),before);
});
test('A retained mounted field handler still writes the live node after peer geometry and another note change',()=>{
 const live=clone(original),root=live,node=live.nodes[0],edge=live.edges[0],write=value=>node.body=value,peer=clone(original);peer.nodes[0].x=30;peer.nodes[1].body='Peer second';peer.edges[0].label='Peer edge';
 const result=prepareNativeReception(live,peer,[],[]);applyReceivedBoard(live,result.board);
 assert.equal(live,root);assert.equal(live.nodes[0],node);assert.equal(live.edges[0],edge);assert.equal(node.x,30);write('Exact retained field input');
 assert.equal(live.nodes[0].body,'Exact retained field input');assert.equal(live.nodes[1].body,'Peer second');assert.equal(live.edges[0].label,'Peer edge');
});
test('Overlapping undo, removed edited nodes, and broken edges refuse before touching live history',()=>{
 const base=clone(original),undo=clone(original),peer=clone(original);base.nodes[0].title='Own';peer.nodes[0].title='Other';const before=JSON.stringify([base,undo,peer]);
 assert.throws(()=>prepareNativeReception(base,peer,[undo],[]));assert.equal(JSON.stringify([base,undo,peer]),before);
 const removed=clone(base);removed.nodes.shift();removed.edges=[];assert.throws(()=>prepareNativeReception(base,removed,[undo],[]));
 const malformed=clone(base);malformed.edges.push({id:'bad',from:'one',to:'missing'});assert.throws(()=>applyReceivedBoard(base,malformed));assert.equal(JSON.stringify([base,undo,peer]),before);
});
test('Bounded history work refuses before adoption while each browser camera stays independent',()=>{
 const base=clone(original),peer=clone(original);peer.nodes[1].title='Peer';const before=JSON.stringify([base,peer]);
 assert.throws(()=>prepareNativeReception(base,peer,[clone(base)],[],{maxBytes:1}));let ticks=0;
 assert.throws(()=>prepareNativeReception(base,peer,[clone(base)],[],{now:()=>ticks++*200}));assert.equal(JSON.stringify([base,peer]),before);
});
test('Original root and node prototype-looking authored keys remain own data properties',()=>{
 const live=clone(original),peer=JSON.parse(JSON.stringify(original).slice(0,-1)+',"__proto__":{"rootAuthored":true}}');
 Object.defineProperty(peer.nodes[0],'__proto__',{value:{nodeAuthored:true},enumerable:true,writable:true,configurable:true});
 const plan=prepareNativeReception(live,peer,[],[]);applyReceivedBoard(live,plan.board);
 assert.equal(Object.getPrototypeOf(live),Object.prototype);assert.equal(Object.getPrototypeOf(live.nodes[0]),Object.prototype);
 assert(Object.hasOwn(live,'__proto__'));assert(Object.hasOwn(live.nodes[0],'__proto__'));assert.deepEqual(live.__proto__,{rootAuthored:true});assert.equal(Object.prototype.rootAuthored,undefined);assert.equal(Object.prototype.nodeAuthored,undefined);
});
console.log(groups+' original workbench reception groups passed');
