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
  focus(){globalThis.document.activeElement=this;} scrollIntoView(){} load(){} pause(){this.paused=true;}
  showModal(){this.open=true;} close(){this.open=false;for(const fn of this.listeners.get('close')||[])fn();}
  get options(){return this.children;} get selectedOptions(){return this.children.filter(row=>row.value===this.value);}
}
const scope={account:7,workspace:'876fa44d-ad85-41cf-830c-72188fb9ea31'},id='79ea2e4e-fc7b-4b27-82f0-aa4931e8f0fa';
const source={id,filename:'Own source.wav',title:'Own title',notes:'Own exact words',tags:[],folder:'',folderId:'',size:17,contentHash:'a'.repeat(64),mime:'audio/wav',kind:'audio',mediaURL:'/w/'+scope.workspace+'/api/media/'+id+'?account=7',etag:'"'+'b'.repeat(64)+'"'};
const tick=()=>new Promise(resolve=>setImmediate(resolve)),held=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
async function fixture(){
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:$,createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  $('mediaDialog').append($('mediaDetails'));$('mediaDetails').append($('mediaPreview'));
  let row={...source};const calls=[];
  const api={asset:x=>x,access:async()=>{},cancel(){},list:async()=>({items:[{...row}],next:null}),read:async key=>{calls.push(key);return {...row};},folders:async()=>[],quota:async()=>({workspaceBytes:17,workspaceLimitBytes:100,singleUploadLimitBytes:100}),search:async query=>({items:[],coverage:'registeredMetadata'})};
  const library=new BoardLibrary(api,()=>{throw Error('Unrequested board mutation');},scope);library.sync(true,true);await library.open();$('mediaItems').children[0].onclick();await $('mediaPreview').children[0].onclick();
  const player=$('mediaPreview').children[0];player.paused=false;
  return {library,api,$,player,calls,set:value=>row={...row,...value}};
}
async function check(name,fn){await fn();console.log('PASS '+name);}


await check('A local choice warns on departure; clearing only the active page choice preserves the destination and original player.',async()=>{
 const f=await fixture(),file={name:'Own original.png',size:17};f.$('uploadFolder').value='stable-folder';f.library.choose(file,[file]);assert.equal(f.library.pending,true);const original=f.player;f.library.clearFile();assert.equal(f.$('mediaPreview').children[0],original);assert.equal(original.paused,false);f.library.choose(file,[file]);f.library.close();f.library.clearFile();assert(f.$('mediaImportLabel').textContent.includes(file.name));await f.library.open();f.library.clearFile();assert.equal(f.library.pending,false);assert.equal(f.$('mediaFile').value,'');assert.equal(f.$('uploadFolder').value,'stable-folder');assert.equal(f.$('clearChosenMedia').hidden,true);assert(f.$('uploadState').textContent.includes('未删除'));
});
await check('A confirmed choice cannot be resent by a repeated or hidden upload action, nor by changing the destination.',async()=>{
 const f=await fixture(),file={name:'Own original.png',size:17};let sent=0;f.api.upload=async()=>{sent++;return {...source};};f.library.choose(file,[file]);await f.library.upload();assert.equal(sent,1);assert.equal(f.$('uploadMedia').disabled,true);assert.equal(f.$('uploadMedia').textContent,'已上传');assert.equal(f.library.pending,false);f.$('uploadFolder').value='another-folder';await f.library.upload();assert.equal(sent,1);assert.equal(f.library.pending,false);f.library.choose({...file},[{...file}]);assert.equal(f.$('uploadMedia').disabled,false);assert.equal(f.library.pending,true);
});
await check('Closing or selecting another original while waiting does not let the upload acknowledgement change the current preview.',async()=>{
 for(const close of [false,true]){const f=await fixture(),gate=held();let reads=0;const list=f.api.list;f.api.list=async()=>{reads++;return list();};f.api.upload=async()=>{await gate.promise;return {...source,id:'a'.repeat(8)+'-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};};f.library.choose({name:'Own original.png',size:17});const pending=f.library.upload();await tick();if(close){f.library.close();await f.library.open();}else f.library.select({...source,id:'b'.repeat(8)+'-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});const expected=f.$('mediaPreview').children[0],before=reads;gate.release();await pending;assert.equal(reads,before);assert.equal(f.$('mediaPreview').children[0],expected);assert.equal(f.$('uploadMedia').disabled,true);assert.equal(f.library.pending,false);}
});
await check('A pending upload cannot be cleared or replaced; its explicit confirmation can still complete.',async()=>{
 const f=await fixture(),gate=held(),file={name:'Own pending.png',size:17};f.api.upload=async()=>{await gate.promise;return {...source};};f.library.choose(file);const pending=f.library.upload();await tick();f.library.clearFile();f.library.choose({name:'Late replacement.png',size:8});assert.equal(f.$('clearChosenMedia').disabled,true);assert(f.$('mediaImportLabel').textContent.includes(file.name));assert.equal(f.library.pending,true);gate.release();await pending;assert.equal(f.library.pending,false);
});
await check('Unconfirmed and rejected uploads retain the exact selection; clearing never claims to remove an unconfirmed server result.',async()=>{
 for(const code of ['upload_uncertain','quota_exceeded']){const f=await fixture(),file={name:'Own retained.png',size:17};f.api.upload=async()=>{throw Object.assign(Error('Unconfirmed own upload'),{code});};f.library.choose(file);await f.library.upload();assert.equal(f.library.pending,true);assert.equal(f.$('uploadMedia').disabled,false);assert(f.$('mediaImportLabel').textContent.includes(file.name));f.library.clearFile();assert.equal(f.library.pending,false);if(code==='upload_uncertain')assert(f.$('uploadState').textContent.includes('上次上传结果仍未确认'));assert(f.$('uploadState').textContent.includes('未删除'));}
});
await check('Permission withdrawal cannot turn an unverified reply into a completed selection or send the chosen file under another identity.',async()=>{
 const f=await fixture(),gate=held(),file={name:'Own account.png',size:17};let sent=0;f.api.upload=async()=>{sent++;await gate.promise;return {...source};};f.library.choose(file);const pending=f.library.upload();await tick();f.library.sync(false,false);gate.release();await pending;assert.equal(f.library.pending,true);assert.equal(f.$('uploadMedia').disabled,true);assert(f.$('mediaImportLabel').textContent.includes('已选文件'));await f.library.upload();assert.equal(sent,1);f.library.clearFile();assert.equal(f.library.pending,false);
});
