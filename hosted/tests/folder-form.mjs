import assert from 'node:assert/strict';
import {BoardFolders} from '../core/portal_assets/board-folders.js';

// Test asynchronous ownership of the real controller's retained operation.
// Native dialogs, review, actual TLS saves and narrow layout are checked apart.
class Field {
  children=[];listeners=new Map();value='';open=false;hidden=false;disabled=false;readOnly=false;style={setProperty(){}};
  constructor(tag='input'){this.tagName=tag;}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  append(...rows){this.children.push(...rows);}
  replaceChildren(...rows){this.children=[];this.append(...rows);}
  showModal(){this.open=true;} close(){this.open=false;for(const fn of this.listeners.get('close')||[])fn();}
  scrollIntoView(){} focus(){}
}
const original={value:{version:1,folders:['Original','Original/Child','Other'],folderIds:{Original:'source','Original/Child':'child',Other:'other'},assets:[]},etag:'"'+'a'.repeat(64)+'"'},scope={account:7,workspace:'876fa44d-ad85-41cf-830c-72188fb9ea31'};
const tick=()=>new Promise(r=>setImmediate(r)),hold=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
function fixture(){
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Field());return elements.get(id);};globalThis.document={getElementById:$,createElement:tag=>new Field(tag)};globalThis.Option=class extends Field{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  let current=structuredClone(original),reads=0,prompts=0;const writes=[],saved=[];globalThis.confirm=()=>{prompts++;return true;};
  const api={access:async()=>{},catalog:async()=>{reads++;return structuredClone(current);},updateCatalog:async(value,expected)=>{writes.push({value:structuredClone(value),expected});current={value:structuredClone(value),etag:'"'+'b'.repeat(64)+'"'};return structuredClone(current);}};
  const form=new BoardFolders(api,scope,value=>saved.push(structuredClone(value)));form.sync(true,true);
  const input=(id,value)=>{$(id).value=value;($(id).oninput||$(id).onchange)();};
  return {form,api,$,input,writes,saved,get reads(){return reads;},get prompts(){return prompts;}};
}
async function check(name,fn){await fn();console.log('PASS '+name);}

await check('Hidden late fields and submit cannot replace a retained operation or commit its prior review; reopen shows exactly the retained fields.',async()=>{
  const f=fixture();await f.form.open();f.input('folderKind','rename');f.input('folderTarget','source');f.input('folderName','Own exact name');f.form.prepare();f.$('foldersDialog').close();f.input('folderKind','remove');f.input('folderTarget','other');f.input('folderName','Hidden replacement');f.$('folderForm').onsubmit({preventDefault(){}});await f.form.save();assert.equal(f.writes.length,0);await f.form.open();assert.equal(f.$('folderKind').value,'rename');assert.equal(f.$('folderTarget').value,'source');assert.equal(f.$('folderName').value,'Own exact name');await f.form.save();assert.equal(f.writes.length,1);assert.equal(f.writes[0].value.folderIds['Own exact name'],'source');assert.equal(f.writes[0].value.folderIds['Own exact name/Child'],'child');assert.equal(f.writes[0].value.folderIds.Other,'other');
});
await check('A reopened initial read invalidated by close finishes with a fresh original-scope tree instead of an indefinitely loading empty form.',async()=>{
  const f=fixture(),gate=hold(),read=f.api.catalog;let count=0;f.api.catalog=async()=>{count++;if(count===1)await gate.promise;return read();};const pending=f.form.open();await tick();f.$('foldersDialog').close();await f.form.open();gate.release();await pending;assert.equal(count,2);assert.equal(f.$('folderForm').hidden,false);assert.equal(f.$('folderName').readOnly,false);assert.equal(f.$('folderTarget').children.length,4);
});
await check('Closing again cancels an explicitly queued reopen, so a late read cannot fetch again or reopen the dialog.',async()=>{
  const f=fixture(),gate=hold(),read=f.api.catalog;let count=0;f.api.catalog=async()=>{count++;await gate.promise;return read();};const pending=f.form.open();await tick();f.$('foldersDialog').close();await f.form.open();f.$('foldersDialog').close();gate.release();await pending;assert.equal(count,1);assert.equal(f.$('foldersDialog').open,false);assert.equal(f.$('folderForm').hidden,true);
});
await check('A submitted save acknowledges only its captured review after close; later real author words survive busy reopening and stay unconfirmed.',async()=>{
  const f=fixture();await f.form.open();f.input('folderName','Submitted');f.form.prepare();const gate=hold(),update=f.api.updateCatalog;f.api.updateCatalog=async(...args)=>{const reply=await update(...args);await gate.promise;return reply;};const pending=f.form.save();await tick();f.input('folderName','Later own words');f.$('foldersDialog').close();f.input('folderName','Hidden late words');await f.form.open();assert.equal(f.$('folderName').value,'Later own words');gate.release();await pending;assert(f.form.dirty);assert.equal(f.$('folderName').value,'Later own words');assert(f.writes[0].value.folders.includes('Submitted'));assert(!f.writes[0].value.folders.includes('Later own words'));assert.equal(f.writes.length,1);assert(f.$('folderState').textContent.includes('后来填写'));
});
await check('Canceled inspection cannot adopt a late comparison when reopened; the original input and basis remain until a new explicit check.',async()=>{
  const f=fixture();await f.form.open();f.input('folderName','Own comparison words');const gate=hold(),read=f.api.catalog;f.api.catalog=async()=>{await gate.promise;return read();};const pending=f.form.inspect();await tick();f.$('foldersDialog').close();await f.form.open();gate.release();await pending;assert.equal(f.$('folderComparison').hidden,true);assert.equal(f.$('folderName').value,'Own comparison words');assert(f.$('folderState').textContent.includes('重新查看'));assert.equal(f.writes.length,0);
});
await check('Paused reopen keeps only the author operation and target; it does not repopulate cached directory choices or use new access to save.',async()=>{
  const f=fixture();await f.form.open();f.input('folderKind','rename');f.input('folderTarget','source');f.input('folderName','Own paused name');f.form.sync(false,false);f.$('foldersDialog').close();const reads=f.reads;await f.form.open();assert.equal(f.$('folderName').value,'Own paused name');assert.equal(f.$('folderName').readOnly,true);assert.equal(f.$('folderTree').children.length,0);assert.equal(f.$('folderTarget').children.length,1);assert.equal(f.$('folderTarget').value,'source');assert.equal(f.reads,reads);await f.form.save();assert.equal(f.writes.length,0);
});
await check('Closed inspection, export and discard are inert; retained author input remains recoverable without hidden dialogs or file creation.',async()=>{
  const f=fixture();await f.form.open();f.input('folderName','Own retained words');f.$('foldersDialog').close();const reads=f.reads;await f.form.inspect();f.form.export();f.$('discardFolders').onclick();assert.equal(f.prompts,0);assert.equal(f.reads,reads);assert(f.form.pending);await f.form.open();assert.equal(f.$('folderName').value,'Own retained words');
});
