import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mediaElement,stopMedia,bytesLabel} from '../core/portal_assets/board-media.js';
import {MediaCues} from '../core/portal_assets/media-cues.js';

// Execute the real canvas-card function and cue lifecycle together. Socket,
// playback, focus and screen geometry are covered separately by native HTTPS.
const source=readFileSync(new URL('../core/portal_assets/board-editor.js',import.meta.url),'utf8');
const cardCode=source.slice(source.indexOf('function mediaCard(node){'),source.indexOf('\nfunction drawCanvas('));
class Element{
  children=[];parentElement=null;listeners=new Map();attributes=new Map();dataset={};textContent='';disabled=false;hidden=false;paused=true;readyState=0;error=null;
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.className='';this.classList={add:n=>{if(!this.className.split(' ').includes(n))this.className+=' '+n;},remove:n=>{this.className=this.className.split(' ').filter(x=>x!==n).join(' ');},contains:n=>this.className.split(' ').includes(n)};}
  append(...items){for(const item of items){item.remove();item.parentElement=this;this.children.push(item);}}
  replaceChildren(...items){for(const item of this.children)item.parentElement=null;this.children=[];this.append(...items);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  replaceWith(item){const p=this.parentElement,i=p?.children.indexOf(this);if(!p)return;item.remove();p.children[i]=item;item.parentElement=p;this.parentElement=null;}
  matches(selector){return selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector.startsWith('[')?Object.hasOwn(this.dataset,'mediaCue'):this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){return this.children.flatMap(item=>[...(selector.split(',').some(s=>item.matches(s))?[item]:[]),...item.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){let e=this;while(e){if(e.matches(selector))return e;e=e.parentElement;}return null;}
  contains(e){return e===this||this.children.some(x=>x.contains(e));}
  get isConnected(){return this===document.body||Boolean(this.parentElement?.isConnected);}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  setAttribute(key,value){this.attributes.set(key,value);}
  removeAttribute(key){this.attributes.delete(key);}
  focus(){document.activeElement=this;}pause(){this.paused=true;}load(){this.readyState=0;}scrollIntoView(){}
}
const tick=()=>new Promise(r=>setImmediate(r)),gate=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
const original={id:'12345678-1234-1234-1234-123456789abc',kind:'audio',mime:'audio/wav',contentHash:'a'.repeat(64),title:'Original exact author name',filename:'original.wav',size:123,mediaURL:'/w/fixed/api/media/original?account=7'};
function fixture(){
  const fields=new Map(),$=id=>{if(!fields.has(id))fields.set(id,new Element());return fields.get(id);};
  globalThis.document={body:new Element('body'),activeElement:null,getElementById:$,createElement:tag=>new Element(tag)};const nodes=[{id:'source',type:'image',assetId:original.id,title:'Own card title'}],reads=[];let asset={...original},created=0;
  const api={access:async()=>{},read:async id=>{reads.push(id);return {...asset};},url:()=>asset.mediaURL};const context={board:{nodes},mediaAllowed:true,mediaCards:new Map(),mediaAPI:api,element:(tag,text,cls)=>{const e=new Element(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;},mediaElement,stopMedia,bytesLabel,Number,document};
  const cues=new MediaCues({api,node:id=>nodes.find(n=>n.id===id),canCreate:()=>context.mediaAllowed,canRead:()=>context.mediaAllowed,canEdit:()=>context.mediaAllowed,active:()=>null,cards:()=>document.body,create:()=>created++});context.cues=cues;
  vm.createContext(context);vm.runInContext(cardCode+'\nthis.card=mediaCard(board.nodes[0]);',context);document.body.append(context.card);
  return {context,card:context.card,cues,api,reads,nodes,set:patch=>asset={...asset,...patch},get created(){return created;}};
}
async function open(f){await f.card.querySelector('.media-reopen').onclick();return f.card.querySelector('audio');}
async function check(name,fn){await fn();console.log('PASS '+name);}

await check('A real card offers one manual source retry and tears down old cue controls/listeners before a fresh mounted player.',async()=>{
  const f=fixture(),player=await open(f),binding=f.cues.bindings.get(player);player.currentTime=12;player.onerror();assert.equal(binding.button.disabled,true);assert.equal(binding.button.onclick,null);assert.equal(f.cues.bindings.size,0);assert.equal(f.card.querySelectorAll('.media-cue-title').length,0);assert.equal(player.paused,true);const count=f.reads.length;await tick();assert.equal(f.reads.length,count);
  const next=await open(f);assert.equal(f.cues.bindings.size,1);assert.equal(f.card.querySelectorAll('.media-cue-title').length,1);assert.equal(next.paused,true);next.duration=120;for(const fn of next.listeners.get('loadedmetadata')||[])fn();assert.equal(next.currentTime,12);
});
await check('Failed metadata retries retain the same source time; changed original bytes never inherit it.',async()=>{
  const f=fixture(),player=await open(f);player.currentTime=12;player.onerror();const read=f.api.read;f.api.read=async()=>{throw Error('Connection unavailable');};await open(f);assert.equal(f.card.querySelectorAll('.media-retry-state').length,1);f.api.read=read;f.set({contentHash:'b'.repeat(64)});const next=await open(f);assert.equal(next.listeners.get('loadedmetadata').length,1);assert.equal(next.currentTime,undefined);
});
await check('Detached retry/error callbacks and removed original cards cannot fetch or replace a later source.',async()=>{
  const f=fixture(),player=await open(f),error=player.onerror;player.onerror();const retry=f.card.querySelector('.media-reopen').onclick,next=await open(f),count=f.reads.length;error();await retry();assert.equal(f.card.querySelector('audio'),next);assert.equal(f.reads.length,count);
  next.onerror();const removed=f.card.querySelector('.media-reopen').onclick;f.nodes.length=0;await removed();assert.equal(f.reads.length,count);
});
await check('Account pause and late verified metadata cannot revive a retained old card or duplicate cue bindings.',async()=>{
  const f=fixture(),hold=gate(),read=f.api.read;f.api.read=async id=>{await hold.promise;return read(id);};const pending=open(f);await tick();f.context.mediaAllowed=false;f.card.remove();hold.release();await pending;assert.equal(f.card.querySelector('audio'),null);assert.equal(f.cues.bindings.size,0);
});
await check('A capture waiting for original metadata cannot create a note after that exact player has been replaced.',async()=>{
  const f=fixture(),player=await open(f);player.currentTime=12;player.duration=120;player.readyState=2;const binding=f.cues.bindings.get(player);f.cues.controls(binding);assert.equal(binding.button.disabled,false);
  const hold=gate(),read=f.api.read;f.api.read=async id=>{await hold.promise;return read(id);};const pending=f.cues.capture(binding);await tick();player.onerror();hold.release();await pending;assert.equal(f.created,0);assert.equal(f.cues.creating,null);assert.equal(f.cues.bindings.size,0);
});
