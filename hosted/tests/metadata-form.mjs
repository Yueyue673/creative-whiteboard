import assert from 'node:assert/strict';
import {BoardMetadata} from '../core/portal_assets/board-metadata.js';

// Small event fixture for the actual controller; native dialog, text undo,
// cookies and layout are accepted separately in original-page HTTPS checks.
class Field {
  children=[]; listeners=new Map(); value=''; open=false; hidden=false; disabled=false; readOnly=false;
  constructor(tag='input'){this.tagName=tag;}
  addEventListener(type,fn){const old=this.listeners.get(type)||[];this.listeners.set(type,[...old,fn]);}
  emit(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  append(...rows){for(const row of rows){row.parentElement=this;this.children.push(row);}}
  replaceChildren(...rows){for(const row of this.children)row.parentElement=null;this.children=[];this.append(...rows);}
  querySelectorAll(tag){return this.children.flatMap(row=>[...(row.tagName===tag?[row]:[]),...row.querySelectorAll(tag)]);}
  querySelector(tag){return this.querySelectorAll(tag)[0]||null;}
  setAttribute(){}
  focus(){}
  scrollIntoView(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
  get lastElementChild(){return this.children.at(-1);}
  get options(){return this.children;}
  get selectedOptions(){return this.children.filter(row=>row.value===this.value);}
}
const asset={id:'e88c7496-cfff-4c3e-914f-9c5436e24eb7',title:'Own title',notes:'  Own words\n',tags:['first','second'],folderId:'source',filename:'own.png',contentHash:'a'.repeat(64),size:17,etag:'"'+'b'.repeat(64)+'"'};
async function fixture({viewer=false}={}){
  const ids=['closeMetadata','metadataDialog','resumeMetadata','metadataForm','metadataTitle','metadataNotes','metadataFolder','addMetadataTag','metadataTags','checkMetadataVersion','useMetadataVersion','exportMetadata','discardMetadata','metadataState','editMetadata','saveMetadata','metadataComparison','metadataTarget','metadataCurrent'];
  const elements=new Map(ids.map(id=>[id,new Field(id==='metadataDialog'?'dialog':'input')]));
  globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Field(tag)};
  globalThis.Option=class extends Field{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  globalThis.confirm=()=>true;
  let current=structuredClone(asset);const calls=[],saved=[];
  const api={access:async()=>{},read:async()=>structuredClone(current),folders:async()=>[{id:'source',name:'Own source'}],update:async(id,data,expected)=>{calls.push({id,data:structuredClone(data),expected});current={...current,...data,etag:'"'+'c'.repeat(64)+'"'};return structuredClone(current);}};
  const form=new BoardMetadata(api,{account:1,workspace:'79ea2e4e-fc7b-4b27-82f0-aa4931e8f0fa'},row=>saved.push(row));
  form.sync(true,!viewer);await form.open(asset.id);
  return {form,api,calls,saved,$:id=>elements.get(id)};
}
function input(field,value){field.value=value;field.oninput();}
function key(field,{key='s',isComposing=false,ctrlKey=true}={}){
  const event={key,isComposing,ctrlKey,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
  field.emit('keydown',event);return event;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function check(name,fn){await fn();console.log('PASS '+name);}

await check('Closed form keeps its own fields and original destination despite late input and submit.',async()=>{
  const {form,calls,$}=await fixture();input($('metadataNotes'),'Retained own note');$('metadataDialog').close();
  input($('metadataNotes'),'Late hidden replacement');$('metadataFolder').value='';$('metadataFolder').onchange();
  $('metadataForm').onsubmit({preventDefault(){}});await tick();assert.equal(calls.length,0);
  await form.open();assert.equal($('metadataNotes').value,'Retained own note');assert.equal($('metadataFolder').value,'source');
  await form.save();assert.equal(calls.length,1);assert.equal(calls[0].data.notes,'Retained own note');assert.equal(calls[0].data.folderId,'source');
});
await check('Detached tag input and remove button cannot rewrite another row or the replacement original form.',async()=>{
  const {form,calls,$}=await fixture(),old=$('metadataTags').querySelector('textarea'),remove=$('metadataTags').querySelector('button');
  remove.onclick();input(old,'Removed row overwrite');remove.onclick();await form.save();assert.deepEqual(calls[0].data.tags,['second']);
  $('discardMetadata').onclick();await form.open('e88c7496-cfff-4c3e-914f-9c5436e24eb7');input(old,'Another draft overwrite');remove.onclick();
  assert.equal(form.dirty,false);assert.equal($('saveMetadata').disabled,true);
});
await check('Ctrl/Command save belongs to the original draft and retains later words while its real controller awaits acknowledgement.',async()=>{
  const {form,api,calls,$}=await fixture();let release;const held=new Promise(resolve=>release=resolve),original=api.update;
  api.update=async(...args)=>{const row=await original(...args);await held;return row;};input($('metadataNotes'),'Submitted');
  const command=key($('metadataDialog'));assert(command.prevented&&command.stopped);await tick();input($('metadataNotes'),'Later own words');release();await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].data.notes,'Submitted');assert.equal($('metadataNotes').value,'Later own words');assert(form.dirty);
  assert($('metadataState').textContent.includes('后来继续写'));
});
await check('Unfinished composition, readonly, closed and unchanged forms cannot issue a save; native undo is left alone.',async()=>{
  const {calls,$}=await fixture();input($('metadataNotes'),'Unfinished');assert(key($('metadataDialog'),{isComposing:true}).prevented);
  const undo=key($('metadataDialog'),{key:'z'});assert.equal(undo.prevented,false);assert.equal(undo.stopped,false);
  $('metadataDialog').close();key($('metadataDialog'));await tick();assert.equal(calls.length,0);
  const view=await fixture({viewer:true});key(view.$('metadataDialog'));await tick();assert.equal(view.calls.length,0);
  const unchanged=await fixture();key(unchanged.$('metadataDialog'));await tick();assert.equal(unchanged.calls.length,0);
});
await check('Fresh readonly downgrade pauses the original input rather than submitting it with an old editor state.',async()=>{
  const {form,calls,$}=await fixture();input($('metadataNotes'),'My held words');form.sync(true,false);key($('metadataDialog'));await tick();
  assert.equal(calls.length,0);assert.equal($('metadataNotes').value,'My held words');assert.equal($('metadataNotes').readOnly,true);assert(form.pending);
});
