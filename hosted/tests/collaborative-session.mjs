import assert from 'node:assert/strict';
import {BoardSession} from '../core/portal_assets/board-session.js';
import {boardRaw} from '../core/portal_assets/board-reconciliation.js';
const scope={account:1,workspace:'12345678-1234-1234-1234-123456789abc',key:'original'};
const original={format:'creative-board',version:1,name:'Own',nodes:[{id:'one',type:'note',x:0,y:0,w:300,h:200,title:'Original',body:'Original'}],edges:[]};
const tag=letter=>'"'+letter.repeat(64)+'"',clone=structuredClone;
globalThis.document={cookie:'__Host-creative_csrf=synthetic'};
let fetcher,groups=0;globalThis.fetch=(...args)=>fetcher(...args);
const response=(value,etag=tag('a'),extra={},status=200)=>new Response(status===304?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json',ETag:etag,...extra}});
const scoped=(role='editor')=>({'X-Creative-Account':'1','X-Creative-Workspace':scope.workspace,'X-Creative-Board':scope.key,'X-Creative-Role':role});
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),release:(...args)=>resolve(...args)};};
function fixture(handler){let aclCalls=0;fetcher=async(path,options)=>{
 if(path==='/api/session')return response({account:{id:1}});
 if(path.endsWith('/workspace')){aclCalls++;return handler?.acl?.(aclCalls)||response({id:scope.workspace,role:'editor'});}
 if(path.endsWith('/reconcile'))return handler.save(JSON.parse(options.body));
 if(path.endsWith('/live'))return handler.live(options);
 return response(original);
 };}
async function test(name,fn){await fn();groups++;console.log('PASS '+name);}
await test('Opening adopts the fresh post-read role rather than a role fetched before the document',async()=>{
 fixture({acl:count=>response({id:scope.workspace,role:count===1?'editor':'viewer'})});const s=new BoardSession(scope,{reconcile:true});try{await s.open();assert.equal(s.state.status,'readonly');assert.equal(s.state.role,'viewer');assert.throws(()=>s.updateRaw(boardRaw(original)));}finally{await s.close();}
});
await test('Successful canonical authority is adopted before a second save and keeps independent peer values',async()=>{
 let adopted,requests=[];fixture({save:body=>{requests.push(body);const v=clone(body.board);v.nodes[0].title='Peer';return response({saved:true,merged:true,board:v},tag(requests.length===1?'b':'c'),scoped());}});
 const s=new BoardSession(scope,{reconcile:true,onAdopt:raw=>{adopted=JSON.parse(raw);}});try{await s.open();const own=clone(original);own.nodes[0].body='Own';await s.updateRaw(boardRaw(own));assert.equal((await s.save()).adopted,true);assert.equal(adopted.nodes[0].title,'Peer');assert.equal(s.state.dirty,false);assert.equal(s.state.etag,tag('b'));adopted.nodes[0].body='Later';await s.updateRaw(boardRaw(adopted));await s.save();assert.equal(requests[1].baseETag,tag('b'));assert.equal(requests[1].board.nodes[0].title,'Peer');}finally{await s.close();}
});
await test('Late accepted response rebases later exact typing against its submitted snapshot',async()=>{
 const hold=deferred(),arrived=deferred();fixture({save:async body=>{arrived.release();await hold.promise;const value=clone(body.board);value.nodes[0].title='Peer';return response({saved:true,merged:true,board:value},tag('b'),scoped());}});
 const s=new BoardSession(scope,{reconcile:true});try{await s.open();const own=clone(original);own.nodes[0].body='First';await s.updateRaw(boardRaw(own));const saving=s.save();await arrived.promise;own.nodes[0].body='Later\r\n  ';await s.updateRaw(boardRaw(own));hold.release();const result=await saving;assert.equal(result.remainingDirty,true);assert.equal(JSON.parse(s.exportRaw()).nodes[0].body,'Later\r\n  ');assert.equal(JSON.parse(s.exportRaw()).nodes[0].title,'Peer');assert.equal(s.state.etag,tag('b'));}finally{hold.release();await s.close();}
});
await test('Closing while an accepted response waits for adoption never replaces input or triggers a callback',async()=>{
 const wait=deferred(),arrived=deferred();let adopts=0;fixture({save:body=>response({saved:true,merged:false,board:body.board},tag('b'),scoped())});const s=new BoardSession(scope,{reconcile:true,onAdopt:()=>adopts++,waitForAdoption:()=>{arrived.release();return wait.promise;}});
 try{await s.open();const own=clone(original);own.nodes[0].body='Own';await s.updateRaw(boardRaw(own));const saving=s.save();await arrived.promise;await s.close();wait.release();assert.equal((await saving).adopted,false);assert.equal(adopts,0);assert.equal(s.state.etag,tag('a'));assert.equal(JSON.parse(s.exportRaw()).nodes[0].body,'Own');}finally{wait.release();await s.close();}
});
await test('An in-flight clean read cannot replace later typing; its fresh downgrade still stops editing',async()=>{
 for(const role of ['editor','viewer']){const hold=deferred(),arrived=deferred();let adopts=0;fixture({live:async()=>{arrived.release();await hold.promise;const peer=clone(original);peer.nodes[0].title='Peer';return response(peer,tag('b'),scoped(role));}});const s=new BoardSession(scope,{reconcile:true,onAdopt:()=>adopts++});try{await s.open();const receiving=s.syncRemote();await arrived.promise;const own=clone(original);own.nodes[0].body='Own later';await s.updateRaw(boardRaw(own));hold.release();await receiving;assert.equal(adopts,0);assert.equal(JSON.parse(s.exportRaw()).nodes[0].body,'Own later');assert.equal(s.state.etag,tag('a'));assert.equal(s.state.status,role==='viewer'?'readonly':'ready');}finally{hold.release();await s.close();}}
});
await test('Wrong destination or missing canonical board never confirms the input as clean',async()=>{
 for(const kind of ['scope','canonical']){fixture({save:body=>response({saved:true,merged:false,...(kind==='scope'?{board:body.board}:{})},tag('b'),{...scoped(),...(kind==='scope'?{'X-Creative-Board':'foreign'}:{})})});let adopts=0;const s=new BoardSession(scope,{reconcile:true,onAdopt:()=>adopts++});try{await s.open();const own=clone(original);own.nodes[0].body='Original own input';await s.updateRaw(boardRaw(own));await assert.rejects(s.save());assert.equal(adopts,0);assert.equal(s.state.dirty,true);assert.equal(s.state.etag,tag('a'));assert.equal(s.state.status,'conflict');assert.equal(JSON.parse(s.exportRaw()).nodes[0].body,'Original own input');if(kind==='canonical')assert.equal(s.state.conflict.accepted,true);}finally{await s.close();}}
});
await test('Overlapping later typing remains exact after save acknowledgement and retains its old base for recovery',async()=>{
 const hold=deferred(),arrived=deferred();fixture({save:async body=>{arrived.release();await hold.promise;const v=clone(body.board);v.nodes[0].title='Server peer';return response({saved:true,merged:true,board:v},tag('b'),scoped());}});const s=new BoardSession(scope,{reconcile:true});try{await s.open();const own=clone(original);own.nodes[0].body='Submitted';await s.updateRaw(boardRaw(own));const saving=s.save();await arrived.promise;own.nodes[0].title='Later own title';await s.updateRaw(boardRaw(own));hold.release();assert.equal((await saving).adopted,false);assert.equal(s.state.status,'conflict');assert.equal(s.state.conflict.accepted,true);assert.equal(JSON.parse(s.exportRaw()).nodes[0].title,'Later own title');assert.equal(s.state.etag,tag('a'));}finally{hold.release();await s.close();}
});
await test('Creation and direct recovery updates refuse lossy numeric raw input before replacing existing originals',async()=>{
 fixture({});const raw=boardRaw(original).slice(0,-1)+',"decimal":1.0}';const create=new BoardSession(scope,{reconcile:true});try{await assert.rejects(create.open(raw));assert.equal(create.state.status,'paused');}finally{await create.close();}
 const s=new BoardSession(scope,{reconcile:true});try{await s.open();const before=s.exportRaw();assert.throws(()=>s.updateRaw(raw));assert.equal(s.exportRaw(),before);assert.equal(s.state.dirty,false);}finally{await s.close();}
});
console.log(groups+' collaborative session groups passed');
await test('A late separated-line acknowledgement rebases newer own typing and sends the exact next canonical base',async()=>{
 const savedOriginal=clone(original),literal='First original\nUnchanged separator\nThird original';original.nodes[0].body=literal;
 const hold=deferred(),arrived=deferred(),requests=[];let adopted;
 fixture({save:async body=>{requests.push(body);if(requests.length===1){arrived.release();await hold.promise;}const v=clone(body.board);v.nodes[0].body=v.nodes[0].body.replace('Third original','Third peer');return response({saved:true,merged:requests.length===1,board:v},tag(requests.length===1?'b':'c'),scoped());}});
 const s=new BoardSession(scope,{reconcile:true,onAdopt:raw=>{adopted=JSON.parse(raw);}});
 try{await s.open();const own=clone(original);own.nodes[0].body=literal.replace('First original','First own');await s.updateRaw(boardRaw(own));const saving=s.save();await arrived.promise;own.nodes[0].body=literal.replace('First original','First newer own');await s.updateRaw(boardRaw(own));hold.release();assert.equal((await saving).remainingDirty,true);assert.equal(adopted.nodes[0].body,'First newer own\nUnchanged separator\nThird peer');assert.equal(s.state.etag,tag('b'));assert.equal(s.state.dirty,true);await s.save();assert.equal(requests[1].board.nodes[0].body,adopted.nodes[0].body);assert.equal(requests[1].baseETag,tag('b'));assert.equal(s.state.dirty,false);}finally{hold.release();await s.close();Object.assign(original,savedOriginal);}
});
await test('A late same-line response retains pending original text and its recovery base',async()=>{
 const savedOriginal=clone(original),literal='First original\nUnchanged separator\nThird original';original.nodes[0].body=literal;
 const hold=deferred(),arrived=deferred();let adopts=0;fixture({save:async body=>{arrived.release();await hold.promise;const v=clone(body.board);v.nodes[0].body=v.nodes[0].body.replace('First own','First peer');return response({saved:true,merged:true,board:v},tag('b'),scoped());}});
 const s=new BoardSession(scope,{reconcile:true,onAdopt:()=>adopts++});
 try{await s.open();const own=clone(original);own.nodes[0].body=literal.replace('First original','First own');await s.updateRaw(boardRaw(own));const saving=s.save();await arrived.promise;own.nodes[0].body=literal.replace('First original','First later own');const raw=boardRaw(own);await s.updateRaw(raw);hold.release();assert.equal((await saving).adopted,false);assert.equal(adopts,0);assert.equal(s.exportRaw(),raw);assert.equal(s.state.status,'conflict');assert.equal(s.state.etag,tag('a'));assert.equal(s.state.dirty,true);}finally{hold.release();await s.close();Object.assign(original,savedOriginal);}
});
