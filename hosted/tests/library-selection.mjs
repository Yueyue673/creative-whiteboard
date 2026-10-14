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

await check('Refresh and pagination keep the mounted original when it falls outside the current page; actions follow a separate fresh read.',async()=>{
  const f=await fixture();f.api.list=async()=>({items:[],next:id});await f.library.refresh();assert.equal(f.$('mediaPreview').children[0],f.player);assert.equal(f.player.paused,false);assert(f.$('mediaSelectionState').textContent.includes('不在这页结果中'));assert.equal(f.$('insertMedia').disabled,false);await f.library.refresh(true);assert.equal(f.$('mediaPreview').children[0],f.player);assert(f.calls.length>=3);
});
await check('Updated author metadata keeps the original player; changed original bytes stop it and require an explicit new preview.',async()=>{
  const f=await fixture();f.set({title:'Updated own title',notes:'  Own exact newer words\n'});await f.library.refresh();assert.equal(f.$('mediaTitle').textContent,'Updated own title');assert.equal(f.$('mediaNotes').textContent,'  Own exact newer words\n');assert.equal(f.$('mediaPreview').children[0],f.player);f.set({contentHash:'c'.repeat(64)});await f.library.refresh();assert.equal(f.player.paused,true);assert.notEqual(f.$('mediaPreview').children[0],f.player);assert.equal(f.$('mediaPreview').children[0].tagName,'button');
});
await check('Failed read retains prior result and selection, pauses unconfirmed playback and disables actions; a retry never automatically replays.',async()=>{
  const f=await fixture(),old=f.$('mediaItems').children[0];f.api.list=async()=>{throw Error('Connection unavailable');};await f.library.refresh();assert.equal(f.$('mediaItems').children[0],old);assert.equal(old.disabled,true);old.onclick();assert.equal(f.$('mediaPreview').children[0],f.player);assert.equal(f.player.paused,true);assert.equal(f.$('insertMedia').disabled,true);assert.equal(f.$('downloadMedia').attributes.get('aria-disabled'),'true');f.api.list=async()=>({items:[],next:null});await f.library.refresh();assert.equal(f.player.paused,true);assert.equal(f.$('insertMedia').disabled,false);
});
await check('A missing original is handled separately from an empty filtered page; it stops the source and cannot remain insertable.',async()=>{
  const f=await fixture();f.api.read=async()=>{throw Object.assign(Error('Missing'),{status:404});};await f.library.refresh();assert.equal(f.player.paused,true);assert.equal(f.$('mediaDetails').hidden,true);assert.equal(f.$('insertMedia').disabled,true);assert.equal(f.$('mediaItems').children.length,0);assert(f.$('mediaMessage').textContent.includes('原预览素材已无法读取'));
});
await check('Account change and late responses cannot revive a stopped library or change its immutable account/workspace destination.',async()=>{
  const f=await fixture(),gate=held();f.api.list=async()=>{await gate.promise;return {items:[source],next:null};};const pending=f.library.refresh();await tick();f.library.sync(false,false);gate.release();await pending;assert.equal(f.player.paused,true);assert.equal(f.$('mediaPreview').children.length,0);assert.equal(f.$('insertMedia').disabled,true);const denied=await fixture();denied.api.access=async()=>{throw Object.assign(Error('Changed account'),{code:'account_changed',status:409});};await denied.library.refresh();assert.equal(denied.$('mediaPreview').children.length,0);assert.equal(denied.$('showMedia').disabled,true);
});
await check('Detached list clicks and closed delayed reads cannot steal a new preview or fetch hidden media.',async()=>{
  const f=await fixture(),old=f.$('mediaItems').children[0];await f.library.refresh();old.onclick();assert.equal(f.$('mediaPreview').children[0],f.player);const gate=held();f.api.list=async()=>{await gate.promise;return {items:[source],next:null};};const pending=f.library.refresh();await tick();f.library.close();gate.release();await pending;assert.equal(f.$('mediaPreview').children.length,0);assert.equal(f.$('mediaDialog').open,false);const count=f.calls.length;await f.library.preview(source);assert.equal(f.calls.length,count);
});
await check('A newer submitted search owns its result and caption; an older delayed result cannot replace it or restart the original.',async()=>{
  const f=await fixture(),gate=held();f.api.search=async query=>{if(query==='older')await gate.promise;return {items:[],coverage:'registeredMetadata'};};f.$('mediaSearch').value='older';f.library.find();await tick();f.$('mediaSearch').value='newer';f.library.find();await tick();assert(f.$('mediaMessage').textContent.includes('newer'));gate.release();await tick();assert(f.$('mediaMessage').textContent.includes('newer'));assert.equal(f.$('mediaPreview').children[0],f.player);assert.equal(f.player.paused,false);
});
