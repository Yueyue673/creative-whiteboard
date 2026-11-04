'use strict';
// Real save/history functions with a given authoritative acknowledgement.
// Native Django/browser coverage is separate from this deterministic control.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..');
const workspace=fs.readFileSync(path.join(root,'workspace.js'),'utf8'),workflow=fs.readFileSync(path.join(root,'workflow.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b)}
const source=between(workspace,'function loadAssets(){','function allAssetFolders()')+
 between(workflow,'const wfCanonical=','const wfText=')+
 between(workflow,'const wfLibraryUndo=[]','const wfUndoExplorer=');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(native=true){
 let sequence=1,tag='catalog-1',fail=false,writes=0;
 const file=(id,title)=>({id,title,filename:id+'.png',path:'/given/'+id,mime:'image/png',size:70,contentHash:'a'.repeat(64),folder:'',folderId:'',notes:'Original notes',tags:['Given'],attachmentBoard:'given-board',etag:'"'+id.repeat(64)+'"',updated:1});
 let store={version:1,folders:[],folderIds:{},assets:[file('a','Original A'),file('b','Original B')]};
 if(!native)for(const item of store.assets)delete item.etag;
 const ctx=vm.createContext({console,Set,Map,Promise,clone:copy,assetIndex:copy(store),assetETag:tag,assetWritesPending:new Set(),assetWriteSequence:0,assetReadSequence:0,assetReadState:'ready',assetReadError:'',assetReadPending:null,assetCatalogReady:true,assetSelected:new Set(),assetFolder:'',notices:[],
  prepareLibraryFolderIds(){},syncLibraryFolderNavigation(){},renderAssets(){},renderAssetReadState(){},allAssetFolders:()=>[],enterAssetFolder(){},toast:text=>ctx.notices.push(text),assetById:id=>ctx.assetIndex.assets.find(item=>item.id===id),
  api:async(route,options)=>{
   assert.equal(route,'/api/assets');
   if(options){
    assert.equal(options.method,'PUT');assert.equal(options.headers['If-Match'],tag);
    if(fail)throw Error('Given save refusal');
    writes++;store=JSON.parse(options.body);sequence++;tag='catalog-'+sequence;
    if(native){const item=store.assets.find(row=>row.id==='a');item.etag='"'+sequence.toString(16).padStart(64,'0')+'"';item.updated=sequence+.25;item.folderId=store.folderIds[item.folder]||''}
    return {headers:{get:name=>name==='ETag'?tag:null},json:async()=>({saved:true,folderIds:copy(store.folderIds),...(native?{fileStates:store.assets.map(({id,etag,updated,folderId})=>({id,etag,updated,folderId}))}:{})})};
   }
   return {headers:{get:name=>name==='ETag'?tag:null},json:async()=>copy(store)};
  }
 });
 vm.runInContext(source+`
 globalThis.actions={undo:wfUndoLibrary,redo:wfRedoLibrary,
  edit:async title=>{await loadAssets();const next=clone(assetIndex);next.assets.find(item=>item.id==='a').title=title;next.assets.find(item=>item.id==='a').updated=999;return saveAssets(next)},
  history:()=>clone({undo:wfLibraryUndo,redo:wfLibraryRedo})};`,ctx);
 return {ctx,actions:ctx.actions,server:()=>copy(store),writes:()=>writes,setFailure:value=>fail=value,
  external:(id,title)=>{const item=store.assets.find(row=>row.id===id);item.title=title;sequence++;item.etag='"'+sequence.toString(16).padStart(64,'0')+'"';item.updated=sequence+.5;tag='catalog-'+sequence}};
}
(async()=>{
 const f=fixture(),other=f.server().assets.find(item=>item.id==='b');
 await f.actions.edit('First A');assert.deepEqual(copy(f.ctx.assetIndex),f.server());
 await f.actions.edit('Second A');
 for(const [action,title]of [['undo','First A'],['undo','Original A'],['redo','First A'],['redo','Second A']]){
  const old=f.server().assets.find(item=>item.id==='a').etag;await f.actions[action]();assert.equal(f.server().assets.find(item=>item.id==='a').title,title);
  assert.notEqual(f.server().assets.find(item=>item.id==='a').etag,old);assert.deepEqual(copy(f.ctx.assetIndex),f.server());assert.deepEqual(f.server().assets.find(item=>item.id==='b'),other);
 }
 const history=copy(f.actions.history()),writes=f.writes();
 f.external('a','Later page');await f.actions.undo();assert.equal(f.server().assets.find(item=>item.id==='a').title,'Later page');assert.equal(f.writes(),writes);assert.deepEqual(copy(f.actions.history()),history);
 f.external('a','Second A');await f.actions.undo();assert.equal(f.writes(),writes);assert.deepEqual(copy(f.actions.history()),history);assert(f.ctx.notices.at(-1).includes('后来又被改过'));
 const failure=fixture();await failure.actions.edit('Saved A');const beforeFailure=copy(failure.actions.history()),saved=failure.server();failure.setFailure(true);await failure.actions.undo();assert.deepEqual(failure.server(),saved);assert.deepEqual(copy(failure.actions.history()),beforeFailure);
 failure.setFailure(false);await failure.actions.undo();assert.equal(failure.server().assets.find(item=>item.id==='a').title,'Original A');await failure.actions.redo();assert.equal(failure.server().assets.find(item=>item.id==='a').title,'Saved A');
 const independent=fixture();await independent.actions.edit('Saved A');independent.external('b','Later unrelated B');const unrelated=independent.server().assets.find(item=>item.id==='b');await independent.actions.undo();assert.equal(independent.server().assets.find(item=>item.id==='a').title,'Original A');assert.deepEqual(independent.server().assets.find(item=>item.id==='b'),unrelated);
 const local=fixture(false);await local.actions.edit('Local first');await local.actions.edit('Local second');
 for(const [action,title]of [['undo','Local first'],['undo','Original A'],['redo','Local first'],['redo','Local second']]){await local.actions[action]();assert.equal(local.server().assets.find(item=>item.id==='a').title,title);assert.deepEqual(copy(local.ctx.assetIndex),local.server())}
 assert.equal(local.writes(),6);
 console.log(JSON.stringify({complete:true,controls:['authoritative save metadata','two edits undo twice/redo twice','later changed text refusal','same text new revision refusal','failed save retains history and confirmed retry works','unrelated later file survives','original acknowledgement without file revisions'],nativeBrowserTest:false}));
})().catch(error=>{console.error(error);process.exitCode=1});
