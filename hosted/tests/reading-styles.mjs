import assert from 'node:assert/strict';
import {ReadingStyles,READING_PRESETS,paperReadingKey} from '../core/portal_assets/paper-reading.js';
const scope={account:7,workspace:'876fa44d-ad85-41cf-830c-72188fb9ea31'},tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};let seq=0,writes=0,tail=Promise.resolve();
 const locks={request(key,fn){const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;}};
 const store=new ReadingStyles(scope,{storage:()=>({...storage,setItem:(k,v)=>{writes++;storage.setItem(k,v);}}),locks,uuid:()=>('00000000-0000-0000-0000-'+String(++seq).padStart(12,'0'))});
 return {store,map,storage,locks,get writes(){return writes;}};
}
let count=0;async function check(name,fn){await fn();count++;console.log('PASS '+name);}
const fresh={kind:'save',name:'Own reading',font:'book',overview:'paper'};
await check('Four ready combinations are finite and saved styles keep the original account/workspace, apart from the legacy preference key.',async()=>{
 const f=fixture(),a=await f.store.change(fresh);assert.equal(READING_PRESETS.length,4);assert(READING_PRESETS.every(row=>['smart','paper'].includes(row.overview)));assert.equal(f.map.get(paperReadingKey(scope)),undefined);assert(f.store.key.startsWith(paperReadingKey(scope)));const other=new ReadingStyles({...scope,account:8},{storage:()=>f.storage,locks:f.locks});assert.deepEqual(other.read(),[]);assert.equal(a.profile.name,fresh.name);
});
await check('Concurrent tab writers merge under the same browser lock; a stale update or removal cannot overwrite the newer saved original.',async()=>{
 const f=fixture(),other=new ReadingStyles(scope,{storage:()=>f.storage,locks:f.locks,uuid:()=>crypto.randomUUID()});await Promise.all([f.store.change(fresh),other.change({...fresh,name:'Another own style'})]);assert.equal(f.store.read().length,2);const original=f.store.read()[0];const accepted=await other.change({...original,kind:'save',name:'Own renamed style',font:'clear'});await assert.rejects(f.store.change({...original,kind:'save',name:'Stale own name'}),/其他页面改变/);await assert.rejects(f.store.change({kind:'remove',id:original.id,revision:original.revision}),/其他页面改变/);assert.deepEqual(f.store.read().find(x=>x.id===original.id),accepted.profile);
});
await check('An exact unchanged confirmation preserves the saved revision and performs no write; a different style cannot take an existing literal name.',async()=>{
 const f=fixture(),first=(await f.store.change(fresh)).profile,before=f.writes;assert.equal((await f.store.change({...first,kind:'save'})).profile.revision,first.revision);assert.equal(f.writes,before);await assert.rejects(f.store.change(fresh),/同名/);assert.equal(f.writes,before);
});
await check('Removing and explicitly restoring only the chosen style retains other changes; conflicting names and occupied restored identities are not overwritten.',async()=>{
 const f=fixture(),first=(await f.store.change(fresh)).profile;await f.store.change({...fresh,name:'Other style'});const removed=(await f.store.change({...first,kind:'remove'})).removed;await f.store.change({...fresh,name:'Later style'});const restored=(await f.store.change({kind:'restore',profile:removed})).profile;assert.equal(restored.id,first.id);assert.notEqual(restored.revision,first.revision);assert.equal(f.store.read().length,3);await assert.rejects(f.store.change({kind:'restore',profile:removed}),/没有覆盖/);await f.store.change({...restored,kind:'remove'});await f.store.change(fresh);await assert.rejects(f.store.change({kind:'restore',profile:removed}),/没有覆盖/);
});
await check('Queued actions use captured values and can be canceled after closing; later caller input cannot retarget the captured name or font.',async()=>{
 const f=fixture();let release;const hold=new Promise(r=>release=r);f.locks.request('held',()=>hold);const input={...fresh},pending=f.store.change(input);input.name='Later input';input.font='mono';release();const saved=await pending;assert.equal(saved.profile.name,fresh.name);assert.equal(saved.profile.font,fresh.font);let release2;const held=new Promise(r=>release2=r);f.locks.request('held',()=>held);let open=true;const canceled=f.store.change({...fresh,name:'Closed later'},()=>open);open=false;release2();await assert.rejects(canceled,/页面已关闭/);assert.equal(f.store.read().length,1);
});
await check('Malformed or refused local storage, invalid names/styles, missing locks and full catalogs never silently clear or overwrite originals.',async()=>{
 const f=fixture();for(const name of ['', 'x'.repeat(41),'line\nname'])await assert.rejects(f.store.change({...fresh,name}));await assert.rejects(f.store.change({...fresh,font:'url(https://external.invalid)'}));for(let i=0;i<12;i++)await f.store.change({...fresh,name:'Own '+i});const full=f.map.get(f.store.key);await assert.rejects(f.store.change(fresh),/最多保存12/);assert.equal(f.map.get(f.store.key),full);f.map.set(f.store.key,'{"version":1,"styles":[{}]}');const malformed=f.map.get(f.store.key);await assert.rejects(f.store.change(fresh),/核对/);assert.equal(f.map.get(f.store.key),malformed);const refused=new ReadingStyles(scope,{storage:()=>({getItem:()=>null,setItem(){throw Error('Denied');}}),locks:f.locks});await assert.rejects(refused.change(fresh),/未确认保存/);const unsupported=new ReadingStyles(scope,{storage:()=>f.storage,locks:null});await assert.rejects(unsupported.change(fresh),/暂不支持/);assert.equal(f.map.get(f.store.key),malformed);
});
console.log(count+' named reading-style cases passed');
