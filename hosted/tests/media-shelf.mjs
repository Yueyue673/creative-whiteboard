import assert from 'node:assert/strict';
import {BoardLibrary} from '../core/portal_assets/board-library.js';

// Exercise the actual asynchronous library controller. Native media playback,
// TLS, dialog focus and the 320px layout are checked with synthetic originals.
class Element {
  children=[];listeners=new Map();dataset={};attributes=new Map();value='';open=false;hidden=false;disabled=false;paused=true;textContent='';
  constructor(tag='input'){this.tagName=tag;}
  append(...rows){for(const row of rows){row.parentElement=this;this.children.push(row);}}
  replaceChildren(...rows){for(const row of this.children)row.parentElement=null;this.children=[];this.append(...rows);}
  querySelectorAll(selector){return this.children.flatMap(row=>[...(selector.split(',').some(tag=>tag===row.tagName||tag.startsWith('.')&&row.className?.split(' ').includes(tag.slice(1)))?[row]:[]),...row.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  setAttribute(key,value){this.attributes.set(key,value);}
  removeAttribute(key){this.attributes.delete(key);}
  focus(){} scrollIntoView(){} load(){} pause(){this.paused=true;}
  showModal(){this.open=true;} close(){this.open=false;for(const fn of this.listeners.get('close')||[])fn();}
  get options(){return this.children;} get selectedOptions(){return this.children.filter(row=>row.value===this.value);}
}
const scope={account:7,workspace:'876fa44d-ad85-41cf-830c-72188fb9ea31'},id='79ea2e4e-fc7b-4b27-82f0-aa4931e8f0fa';
const source={id,archived:false,filename:'Own source.wav',title:'Own title',notes:'Own exact words',tags:[],folder:'',folderId:'',size:17,contentHash:'a'.repeat(64),mime:'audio/wav',kind:'audio',mediaURL:'/w/'+scope.workspace+'/api/media/'+id+'?account=7',etag:'"'+'b'.repeat(64)+'"'};
const tick=()=>new Promise(resolve=>setImmediate(resolve)),held=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
async function fixture(){
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:$,createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  $('mediaDialog').append($('mediaDetails'));$('mediaDetails').append($('mediaPreview'));
  let row={...source};const calls=[];
  const api={asset:x=>x,access:async()=>{},cancel(){},list:async(after,archived)=>({items:row.archived===archived?[{...row}]:[],next:null}),read:async key=>{calls.push(key);return {...row};},folders:async()=>[],quota:async()=>({workspaceBytes:17,workspaceLimitBytes:100,singleUploadLimitBytes:100}),search:async query=>({items:[],coverage:'registeredMetadata'})};
  api.update=async(key,data,etag)=>{calls.push({key,data,etag});row={...row,...data,etag:'\"'+'c'.repeat(64)+'\"'};return {...row};};
  const library=new BoardLibrary(api,()=>{throw Error('Unrequested board mutation');},scope);library.sync(true,true);await library.open();$('mediaItems').children[0].onclick();await $('mediaPreview').children[0].onclick();
  const player=$('mediaPreview').children[0];player.paused=false;
  return {library,api,$,player,calls,set:value=>row={...row,...value}};
}
async function check(name,fn){await fn();console.log('PASS '+name);}


await check('Switching shelves retains the original mounted preview and search text; archived sources cannot be newly inserted.',async()=>{
 const f=await fixture();f.set({archived:true});f.library.shelf(true);await tick();assert.equal(f.$('mediaPreview').children[0],f.player);assert.equal(f.player.paused,false);assert.equal(f.$('insertMedia').disabled,true);assert.equal(f.$('archiveMedia').textContent,'恢复到素材库');assert(f.$('mediaSelectionState').textContent.includes('已收起'));f.$('mediaSearch').value='own';f.library.find();await tick();f.library.shelf(false);await tick();assert.equal(f.$('mediaSearch').value,'own');assert.equal(f.$('mediaPreview').children[0],f.player);
});
await check('Explicit archive and restore submit only the selected immutable original and its exact latest version, preserving source playback.',async()=>{
 const f=await fixture();await f.library.changeShelf();assert.equal(f.$('archiveMedia').textContent,'恢复到素材库');assert.equal(f.$('mediaItems').children.length,0);assert.equal(f.$('mediaPreview').children[0],f.player);assert.equal(f.player.paused,false);await f.library.changeShelf();assert.equal(f.$('mediaItems').children.length,1);assert.equal(f.$('insertMedia').disabled,false);const writes=f.calls.filter(x=>typeof x==='object');assert.equal(writes.length,2);assert.deepEqual(writes[0],{key:id,data:{archived:true},etag:source.etag});assert.deepEqual(writes[1].data,{archived:false});assert.notEqual(writes[1].etag,source.etag);
});
await check('Uncertain commit is never replayed; a fresh original read unlocks the next explicit action with its new version.',async()=>{
 const f=await fixture();let count=0;f.api.update=async()=>{count++;f.set({archived:true,etag:'"'+'d'.repeat(64)+'"'});throw Object.assign(Error('Not confirmed'),{code:'uncertain'});};await f.library.changeShelf();assert.equal(f.$('archiveMedia').disabled,true);await f.library.changeShelf();assert.equal(count,1);assert(f.$('mediaShelfState').textContent.includes('刷新'));await f.library.refresh();assert.equal(f.$('archiveMedia').disabled,false);assert.equal(f.$('archiveMedia').textContent,'恢复到素材库');assert.equal(count,1);assert.equal(f.$('mediaPreview').children[0],f.player);
});
await check('Closing during a confirmed action does not reopen, rebuild or retry a hidden original; next open reads its resulting state.',async()=>{
 const f=await fixture(),gate=held(),update=f.api.update;let count=0;f.api.update=async(...args)=>{count++;const result=await update(...args);await gate.promise;return result;};const pending=f.library.changeShelf();await tick();f.library.close();gate.release();await pending;assert.equal(f.$('mediaDialog').open,false);assert.equal(f.$('mediaPreview').children.length,0);assert.equal(count,1);await f.library.open();assert.equal(f.$('archiveMedia').textContent,'恢复到素材库');assert.equal(count,1);
});
await check('Readonly and paused original-account pages cannot archive; pending duplicate clicks and detached source buttons cannot retarget an action.',async()=>{
 const f=await fixture();f.library.sync(true,false);await f.library.changeShelf();assert.equal(f.calls.filter(x=>typeof x==='object').length,0);f.library.sync(true,true);const gate=held(),update=f.api.update,old=f.$('mediaItems').children[0];f.api.update=async(...args)=>{await gate.promise;return update(...args);};const pending=f.library.changeShelf();await tick();await f.library.changeShelf();old.onclick();f.library.sync(false,false);gate.release();await pending;assert.equal(f.$('showMedia').disabled,true);assert.equal(f.$('mediaPreview').children.length,0);assert.equal(f.calls.filter(x=>typeof x==='object').length,1);
});
await check('A delayed older shelf response cannot replace a newer shelf or its caption.',async()=>{
 const f=await fixture(),gate=held();f.api.list=async(after,archived)=>{if(archived)await gate.promise;return {items:archived?[]:[source],next:null};};f.library.shelf(true);await tick();f.library.shelf(false);await tick();assert.equal(f.$('mediaItems').children.length,1);assert.equal(f.$('activeMedia').attributes.get('aria-pressed'),'true');gate.release();await tick();assert.equal(f.$('mediaItems').children.length,1);assert(!f.$('mediaMessage').textContent.includes('还没有收起'));
});
