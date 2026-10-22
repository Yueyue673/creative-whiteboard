import assert from 'node:assert/strict';
import {BoardTransport} from '../core/portal_assets/board-transport.js';
const scope={account:1,workspace:'11111111-1111-4111-8111-111111111111',key:'large'},tag='"'+'a'.repeat(64)+'"',next='"'+'b'.repeat(64)+'"',board={format:'creative-board',version:1,name:'Synthetic',nodes:[],edges:[],view:{x:0,y:0,z:1}};
globalThis.document={cookie:'__Host-creative_csrf=synthetic'};
let expected,writeCount=0;
globalThis.fetch=async(path,options)=>{
 const headers={'ETag':'W/'+tag,'X-Creative-Revision':tag};
 if(path.endsWith('/live')){assert.equal(options.headers['If-None-Match'],tag);return new Response(null,{status:304,headers:{...headers,'X-Creative-Account':'1','X-Creative-Workspace':scope.workspace,'X-Creative-Board':scope.key,'X-Creative-Role':'owner'}})}
 if(options.method==='PUT'){expected=options.headers['If-Match'];writeCount++;return new Response('{"saved":true}',{headers:{'ETag':'W/'+next,'X-Creative-Revision':next}})}
 return new Response(JSON.stringify(board),{headers});
};
const t=new BoardTransport(scope),read=await t.read();assert.equal(read.etag,tag);assert.equal((await t.readLatest(read.etag)).unchanged,true);assert.equal((await t.save(JSON.stringify(board),read.etag)).etag,next);assert.equal(expected,tag);assert.equal(writeCount,1);
globalThis.fetch=async()=>new Response(JSON.stringify(board),{headers:{ETag:tag}});assert.equal((await t.read()).etag,tag);
console.log('PASS Compressed representation validators never replace the strong application revision; writes/live checks stay guarded and old uncompressed servers remain compatible.');
