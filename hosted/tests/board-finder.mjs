import assert from 'node:assert/strict';
import {BoardFinder,checkedBoardMatches} from '../core/portal_assets/board-finder.js';
const scope={account:7,workspace:'876fa44d-ad85-41cf-830c-72188fb9ea31',key:'original'};
const reply=query=>({account:scope.account,workspace:scope.workspace,query,coverage:'currentSupportedText',scannedBoards:2,items:[{id:'target',name:'Own <literal> title',context:'便签正文',excerpt:'Own **exact** words',updated:17}]});
const held=()=>{let release;return {promise:new Promise(r=>release=r),release};},tick=()=>new Promise(r=>setImmediate(r));
class Element{
 children=[];listeners=new Map();attributes=new Map();value='';textContent='';open=false;disabled=false;parentElement=null;
 append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}
 replaceChildren(...items){for(const item of this.children)item.parentElement=null;this.children=[];this.append(...items);}
 addEventListener(name,fn){this.listeners.set(name,[...(this.listeners.get(name)||[]),fn]);}
 setAttribute(name,value){this.attributes.set(name,value);}removeAttribute(name){this.attributes.delete(name);}
 focus(){document.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;for(const fn of this.listeners.get('close')||[])fn();}
}
function fixture(){
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},events=new Map();globalThis.document={activeElement:null,getElementById:$,createElement:()=>new Element(),addEventListener:(n,fn)=>events.set(n,fn),querySelector:()=>[...elements.values()].find(e=>e.open)||null};
 const calls=[],tabs=[],navigated=[],captures=[],restored=[];let available=true,popup=true,mode='ok',gate=null,holdIdentity=false;
 globalThis.window={open:()=>{if(!popup)return null;const tab={closed:false,opener:'old',location:{href:'about:blank',replace:path=>navigated.push(path)},close(){this.closed=true;}};tabs.push(tab);return tab;}};
 globalThis.fetch=async(path,options)=>{calls.push({path,options});if(path==='/api/session'){if(holdIdentity)await gate.promise;return new Response(JSON.stringify({account:{id:mode==='changed'?8:7}}));}
  if(path.endsWith('/workspace'))return new Response(JSON.stringify(mode==='denied'?{error:'Access withdrawn'}:{id:scope.workspace,role:'viewer'}),{status:mode==='denied'?404:200});
  if(path.includes('/search?')){if(gate&&!holdIdentity)await gate.promise;const query=new URL(path,'https://fixture.test').searchParams.get('q');return new Response(JSON.stringify(reply(query)));}throw Error('Unrequested route');};
 const originalScope={...scope},place={original:true},finder=new BoardFinder({scope:originalScope,canRead:()=>available,name:()=>'',capture:()=>{captures.push(place);return place;},restore:p=>restored.push(p)});
 finder.open();return {finder,$,calls,tabs,navigated,restored,originalScope,setMode:x=>mode=x,setRead:x=>available=x,setPopup:x=>popup=x,hold(identity=false){gate=held();holdIdentity=identity;return gate;},release(){gate.release();gate=null;}};
}
async function find(f,query='Own words'){f.$('boardFinderQuery').value=query;await f.finder.search();return f.$('boardFinderResults').children[0];}
async function check(label,fn){await fn();console.log('PASS '+label);}

await check('Strict scoped bounded results retain literal author text and never coerce duplicate, external or foreign identities.',async()=>{
 const value=reply('Own words'),raw=JSON.stringify(value),checked=checkedBoardMatches(value,'Own words',scope);assert(Object.isFrozen(checked.items[0]));assert.equal(checked.items[0].name,'Own <literal> title');assert.equal(JSON.stringify(value),raw);
 for(const patch of [{account:8},{workspace:'wrong'},{query:'other'},{coverage:'allPrivateInputs'},{scannedBoards:501},{items:[{...value.items[0],id:'../other'}]},{items:[...value.items,...value.items]},{items:[{...value.items[0],updated:Infinity}]}])assert.throws(()=>checkedBoardMatches({...value,...patch},'Own words',scope));
});
await check('Actual finder keeps its immutable original scope and reads only explicit search plus fresh identity/workspace.',async()=>{
 const f=fixture();f.originalScope.account=8;f.originalScope.workspace='changed';await find(f);assert.equal(f.finder.scope.account,7);assert.equal(f.finder.scope.workspace,scope.workspace);assert.equal(f.calls.length,3);assert(f.calls.every(x=>['GET',undefined].includes(x.options.method)&&x.options.headers['X-Creative-Account']==='7'&&x.options.cache==='no-store'));assert(f.calls[1].path.startsWith('/w/'+scope.workspace+'/api/search?'));
});
await check('Closed or superseded searches cannot show late content, restore twice or replace the later exact query.',async()=>{
 const f=fixture(),gate=f.hold();f.$('boardFinderQuery').value='Earlier';const pending=f.finder.search();await tick();f.finder.close();gate.release();await pending;assert.equal(f.$('boardFinderResults').children.length,0);assert.equal(f.restored.length,1);f.release();f.finder.open();await find(f,'Later exact');assert.equal(f.$('boardFinderQuery').value,'Later exact');assert.equal(f.$('boardFinderResults').children.length,1);
});
await check('Duplicate result activation opens one blank tab, fresh checks precede the fixed target, and close retains the original place.',async()=>{
 const f=fixture(),button=await find(f),gate=f.hold(true),first=button.onclick();await button.onclick();assert.equal(f.tabs.length,1);assert.equal(f.tabs[0].opener,null);gate.release();await first;assert.deepEqual(f.navigated,[`/w/${scope.workspace}/b/target/`]);assert.equal(f.$('boardFinderDialog').open,false);assert.equal(f.restored.length,1);
});
await check('A later query closes the pending blank tab; an older fresh check cannot navigate it or clear the later query.',async()=>{
 const f=fixture(),button=await find(f),gate=f.hold(true),pending=button.onclick();f.$('boardFinderQuery').value='Later exact';for(const fn of f.$('boardFinderQuery').listeners.get('input'))fn();assert.equal(f.tabs[0].closed,true);gate.release();await pending;assert.deepEqual(f.navigated,[]);assert.equal(f.$('boardFinderQuery').value,'Later exact');
});
await check('Fresh account/permission refusal closes blank output and never retargets old results under the new login.',async()=>{
 for(const mode of ['changed','denied']){const f=fixture(),button=await find(f);f.setMode(mode);await button.onclick();assert.equal(f.tabs[0].closed,true);assert.deepEqual(f.navigated,[]);assert.equal(f.$('showBoardFinder').disabled,true);assert.equal(f.$('submitBoardFinder').disabled,true);assert.equal(f.$('boardFinderQuery').value,'Own words');}
});
await check('Popup refusal is visible and retryable; read suspension invalidates retained controls without changing a query.',async()=>{
 const f=fixture(),button=await find(f);f.setPopup(false);await button.onclick();assert(f.$('boardFinderState').textContent.includes('没有打开'));assert.equal(f.$('boardFinderResults').children[0],button);f.setRead(false);f.finder.sync();const count=f.calls.length;await button.onclick();await f.finder.search();assert.equal(f.calls.length,count);assert.equal(f.$('boardFinderQuery').value,'Own words');
});
await check('A placeholder used for another page is never replaced or closed by a late choice or cancellation.',async()=>{
 const f=fixture(),button=await find(f),gate=f.hold(true),pending=button.onclick();f.tabs[0].location.href='https://chosen.example.test/';gate.release();await pending;assert.deepEqual(f.navigated,[]);assert.equal(f.tabs[0].closed,false);assert(f.$('boardFinderState').textContent.includes('没有替换'));f.finder.close();assert.equal(f.tabs[0].closed,false);
});
