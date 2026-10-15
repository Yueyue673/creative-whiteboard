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
async function fixture(navigation={}){
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:$,createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  $('mediaDialog').append($('mediaDetails'));$('mediaDetails').append($('mediaPreview'));
  let row={...source};const calls=[];
  const api={asset:x=>x,access:async()=>{},cancel(){},list:async()=>({items:[{...row}],next:null}),read:async key=>{calls.push(key);return {...row};},folders:async()=>[],quota:async()=>({workspaceBytes:17,workspaceLimitBytes:100,singleUploadLimitBytes:100}),search:async query=>({items:[],coverage:'registeredMetadata'})};
  const library=new BoardLibrary(api,()=>{throw Error('Unrequested board mutation');},scope,navigation);library.sync(true,true);await library.open();$('mediaItems').children[0].onclick();await $('mediaPreview').children[0].onclick();
  const player=$('mediaPreview').children[0];player.paused=false;
  return {library,api,$,player,calls,set:value=>row={...row,...value}};
}
async function check(name,fn){await fn();console.log('PASS '+name);}


await check('Returning focuses the actual selected result; a closed library cannot steal focus through a late return action.',async()=>{
 const f=await fixture(),browser=new Element('section');f.$('mediaSearch').closest=()=>browser;f.library.backToList();assert.equal(document.activeElement,f.$('mediaItems').children[0]);const saved=document.activeElement;f.library.close();f.library.backToList();assert.equal(document.activeElement,saved);
});
await check('A selected original outside filtered results returns to the exact search instead of injecting or selecting another file.',async()=>{
 const f=await fixture();f.$('mediaSearch').closest=()=>null;f.$('mediaSearch').value='Own exact query';f.api.list=async()=>({items:[],next:null});await f.library.refresh();f.library.backToList();assert.equal(document.activeElement,f.$('mediaSearch'));assert.equal(f.$('mediaSearch').value,'Own exact query');assert.equal(f.$('mediaItems').children.length,0);assert.equal(f.$('mediaPreview').children[0],f.player);
});
await check('A file chosen during a pending original read is retained without upload; closed late drop callbacks cannot replace it.',async()=>{
 const f=await fixture(),gate=held(),file={name:'Own exact + file.txt',size:17},files=[file];let uploaded=0;f.api.upload=async()=>uploaded++;f.api.list=async()=>{await gate.promise;return {items:[source],next:null};};const pending=f.library.refresh();await tick();f.library.choose(file,files);assert.equal(f.$('mediaFile').files,files);assert(f.$('mediaImportLabel').textContent.includes(file.name));assert.equal(f.$('uploadMedia').disabled,true);gate.release();await pending;assert.equal(f.$('uploadMedia').disabled,false);assert.equal(uploaded,0);f.library.close();let prevented=false;const event={preventDefault(){prevented=true;this.defaultPrevented=true;},dataTransfer:{types:['Files'],files:[{name:'Closed late file.txt',size:19}]}};f.$('mediaDialog').ondrop(event);f.$('mediaDrop').ondrop(event);assert(prevented);assert(f.$('mediaImportLabel').textContent.includes(file.name));assert.equal(f.$('mediaFile').files,files);assert.equal(uploaded,0);
});
await check('A read-only or paused page prevents file navigation and retains its selected local file without exposing an active importer.',async()=>{
 const f=await fixture(),file={name:'Own retained.txt',size:8};f.library.choose(file,[file]);f.library.sync(true,false);let prevented=false;f.$('mediaDialog').ondrop({preventDefault(){prevented=true;},dataTransfer:{types:['Files'],files:[{name:'Readonly dropped.txt',size:8}]}});assert(prevented);assert.equal(f.$('mediaImport').hidden,true);assert(f.$('mediaMessage').textContent.includes('阅读权限'));assert(f.$('mediaImportLabel').textContent.includes(file.name));f.library.sync(false,false);f.library.backToList();assert.equal(f.$('mediaImport').hidden,true);
});

await check('Explicit library close restores its captured original place once, including native close and a repeated close event.',async()=>{
 const place={original:'exact field'},restored=[];let captured=0,finished=0;
 const f=await fixture({capture:()=>{captured++;return place;},restore:value=>restored.push(value),afterClose:()=>finished++});
 await f.library.open();assert.equal(captured,1);f.library.close();f.library.close();
 for(const callback of f.$('mediaDialog').listeners.get('close'))callback();
 assert.equal(finished,1);assert.deepEqual(restored,[place]);assert.equal(f.$('mediaPreview').children.length,0);
});
await check('A native dialog close releases the original captured place; reopening captures its later place afresh.',async()=>{
 let place={original:'first field'};const restored=[];let finished=0;
 const f=await fixture({capture:()=>place,restore:value=>restored.push(value),afterClose:()=>finished++});
 f.$('mediaDialog').close();assert.deepEqual(restored,[place]);const next={original:'later field'};place=next;
 await f.library.open();f.library.close();assert.equal(restored.at(-1),next);assert.equal(finished,2);
});
await check('A library opened without a writing place closes normally and never invents a restore target.',async()=>{
 let finished=0;const f=await fixture({capture:()=>null,restore:()=>{throw Error('No captured field');},afterClose:()=>finished++});
 f.library.close();assert.equal(finished,1);
});

async function referenceFixture(open){
 const f=await fixture();globalThis.window={open};
 f.api.references=async()=>({counts:{board:1},coverage:'visibleSavedRecords',hiddenResults:0,scannedRecords:1,checkedAt:1,items:[{category:'board',kind:'board',key:'own-board',name:'Own original board',revision:1,savedAt:1,match:'direct'}]});
 await f.library.references();const item=f.$('mediaReferenceRows').children[0],link=item.children.at(-1);
 return {...f,item,link,click:()=>link.listeners.get('click')[0]({preventDefault(){}})};
}
function referenceTab(){const tab={closed:false,close(){this.closed=true;},location:{href:'about:blank',replace(value){this.href=value;}}};return tab;}
await check('A reused reference tab is not replaced or closed after success or failure of the delayed original read.',async()=>{
 for(const failure of [false,true]){const tab=referenceTab(),f=await referenceFixture(()=>tab),gate=held();
 f.api.read=async()=>{await gate.promise;if(failure)throw Error('Original read unavailable');return source;};
 const pending=f.click();await tick();tab.location.href='https://example.test/own-later-page';gate.release();await pending;
 assert.equal(tab.closed,false);assert.equal(tab.location.href,'https://example.test/own-later-page');assert(!f.link.attributes.has('aria-busy'));
 }
});
await check('Pending reference clicks create only one blank tab; close cancels that blank and late replies cannot navigate it.',async()=>{
 let opened=0;const tab=referenceTab(),f=await referenceFixture(()=>{opened++;return tab;}),gate=held();f.api.read=async()=>{await gate.promise;return source;};
 const pending=f.click();await tick();await f.click();assert.equal(opened,1);
 f.library.close();assert.equal(tab.closed,true);gate.release();await pending;assert.equal(tab.location.href,'about:blank');assert.equal(opened,1);
});
await check('A current untouched reference tab opens the exact original workspace target; a closed target is never reopened.',async()=>{
 for(const closed of [false,true]){let opened=0;const tab=referenceTab(),f=await referenceFixture(()=>{opened++;return tab;}),gate=held();f.api.read=async()=>{await gate.promise;return source;};
 const pending=f.click();await tick();tab.closed=closed;gate.release();await pending;
 assert.equal(opened,1);assert.equal(tab.location.href,closed?'about:blank':f.link.href);assert.equal(tab.closed,closed);
 }
});
await check('Blocked, detached or paused reference links do not start hidden source checks or create a new tab.',async()=>{
 let opened=0;const f=await referenceFixture(()=>{opened++;return null;});let checks=0;f.api.access=async()=>checks++;f.api.read=async()=>checks++;
 await f.click();assert.equal(opened,1);assert.equal(checks,0);
 f.$('mediaReferenceRows').replaceChildren();await f.click();assert.equal(opened,1);assert.equal(checks,0);
 f.library.sync(false,false);await f.click();assert.equal(opened,1);assert.equal(checks,0);
});

await check('Refreshing associations cancels only the earlier blank; its late completion cannot release or navigate a newer attempt.',async()=>{
 const tabs=[],f=await referenceFixture(()=>{const tab=referenceTab();tabs.push(tab);return tab;}),gate=held();f.api.read=async()=>{await gate.promise;return source;};
 const earlier=f.click();await tick();await f.library.references();assert.equal(tabs[0].closed,true);
 const nextItem=f.$('mediaReferenceRows').children[0],nextLink=nextItem.children.at(-1);const later=nextLink.listeners.get('click')[0]({preventDefault(){}});await tick();assert.equal(tabs.length,2);
 gate.release();await Promise.all([earlier,later]);assert.equal(tabs[0].location.href,'about:blank');assert.equal(tabs[1].location.href,nextLink.href);assert.equal(tabs[1].closed,false);
});
