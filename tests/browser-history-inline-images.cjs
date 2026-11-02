// Actual source guard: JSON history semantics and visible point-based writing, Undo/Redo and save/readback.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib'),os=require('node:os'),{spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const W=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.HISTORY_INLINE_IMAGES_PROOF||path.join(W,'artifacts','history-inline-images'),PY=process.env.PYTHON||'python';
assert(!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});const D=fs.mkdtempSync(path.join(os.tmpdir(),'wb-hi-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),raw=fs.readFileSync(W+'/index.html','utf8');
assert.equal(raw.split('history.push(snapshotHistoryBoard(board))').length-1,2);assert.equal(raw.split('future.push(snapshotHistoryBoard(board))').length-1,1);
assert(raw.includes('clone=x=>JSON.parse(JSON.stringify(x))'));
const proof={at:new Date().toISOString(),complete:false,prototypeOnly:false,sourceIntegrated:true,sourceWorktreeChanged:false,privateContentRead:false,physicalDeviceVerified:false,moduleOverrides:false,DOMOverrides:false,ownedDataRoot:D,driverSHA256:hash(fs.readFileSync(__filename)),indexSHA256:hash(raw),cases:[],pageErrors:[],limits:['Native point/click and textarea input in owned headless browser with synthetic data; no physical finger, controller, headset, IME or author-use claim.','Only managed JavaScript heap observations; not total RAM or FPS.','Exact local source without module/DOM overrides. Generic clone, save format and history limit unchanged; full exact CI and physical behavior are separate.']};
const save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));save();
const table=Array.from({length:256},(_,n)=>{let x=n;for(let i=0;i<8;i++)x=x&1?0xedb88320^(x>>>1):x>>>1;return x>>>0});
function crc(b){let x=0xffffffff;for(const v of b)x=table[(x^v)&255]^(x>>>8);return(x^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4);return b}
function png(seed){const width=1024,height=768,raw=Buffer.alloc((width*3+1)*height);let x=seed>>>0;for(let y=0;y<height;y++){const row=y*(width*3+1);for(let n=1;n<=width*3;n++){x^=x<<13;x^=x>>>17;x^=x<<5;raw[row+n]=x&255}}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:1})),chunk('IEND',Buffer.alloc(0))])}
const images=Array.from({length:2},(_,i)=>{const b=png(12345+i*9876);return {data:'data:image/png;base64,'+b.toString('base64'),name:'owned-inline-'+i+'.png'}});
const note=(id,x,y,w=260,h=230)=>({id,type:'note',title:id==='writer'?'接着写（合成）':'图片（合成）',body:id==='writer'?'*原文字模式*\n先保留观察。':'',userText:'',annotation:'',tags:[],textFormat:'plain',sizeMode:'manual',x,y,w,h,color:'#fff0aa',fontSize:18,titleFontSize:23});
const given={format:'creative-board',version:1,name:'内嵌图片与续写（合成）',folder:'',view:{x:0,y:0,z:1},nodes:[note('writer',15,25),...images.map((image,i)=>({...note('picture-'+i,400+i*430,35,390,345),images:[image],source:{board:'given-synthetic-source',nodeIds:['original-'+i]},canvasObject:{kind:'image',crop:{x:10,y:10,w:80,h:80},marks:[{kind:'rect',points:[[10,20],[30,40]],stroke:'#3F2300',fill:'none',weight:1}]}})),{...note('table',400,420,500,220),type:'table',title:'资料表（合成）',columns:['材料','备注'],rows:[['原件','保留来源'],['副本','继续使用']],rowIds:['row-one','row-two'],columnIds:['col-one','col-two']}],edges:[{id:'given-edge',from:'writer',to:'picture-0',label:'观察来源'}]};
proof.givenJSONBytes=Buffer.byteLength(JSON.stringify(given));proof.givenSHA256=hash(JSON.stringify(given));fs.writeFileSync(O+'/given.json',JSON.stringify(given));
let proc,exit,fd,browser,base;
async function req(url,method='GET',body,tag){const r=await fetch(base+url,{method,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(r.ok,url+' '+r.status);return {value:await r.json(),tag:r.headers.get('etag')}}
async function getFrame(p,id){await p.waitForFunction(id=>current()?.boardId===id&&pane(current())?.state()?.boardId===id&&!pane(current()).state().loading,id);return await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame()}
async function visibleHistory(f,which){const button=f.locator('#'+which);if(await button.isVisible())await button.click();else{await f.locator('#creationMore').click();await f.getByRole('menuitem',{name:which==='undo'?'撤销  Ctrl+Z':'重做  Ctrl+Shift+Z',exact:true}).click()}}
async function setupContext(width,mode){const c=await browser.newContext({viewport:{width,height:900},hasTouch:true});c.setDefaultTimeout(10000);c.setDefaultNavigationTimeout(15000);await c.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));await c.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base)return route.abort();return route.continue()});return c}
(async()=>{try{
 const hooks=O+'/hooks';execFileSync(PY,[W+'/tests/local_start_fixture.py','--write-hooks',hooks],{windowsHide:true});const port=await require(W+'/tests/browser-port.cjs')();base='http://127.0.0.1:'+port;
 const env={...process.env,CREATIVE_BOARD_DATA_DIR:D,CREATIVE_BOARD_PORT:String(port),PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',START_FIXTURE_DATA_DENIED:'0',START_FIXTURE_LIFETIME:'240'};delete env.PYTHONHOME;for(const k of Object.keys(env))if(k.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[k];
 fd=fs.openSync(O+'/server.log','w');proc=spawn(PY,[W+'/server.py'],{cwd:W,env,windowsHide:true,stdio:['ignore',fd,fd]});exit=new Promise((resolve,reject)=>{proc.once('exit',(code,signal)=>resolve({code,signal}));proc.once('error',reject)});proof.ownedServer={pid:proc.pid,port,lifetimeSeconds:240};save();
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);assert.equal(hash(Buffer.from(await(await fetch(base+'/index.html')).arrayBuffer())),hash(raw));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});proof.browserVersion=browser.version();save();
 for(const width of [1360,320]){const mode='exact-source';
  const id='history-'+width+'-'+mode;await req('/api/boards/'+id,'PUT',given,'new');const c=await setupContext(width,mode),p=await c.newPage(),row={width,height:900,mode,boardId:id,phase:'open',cycles:[],nativeControlSequence:[]};proof.cases.push(row);p.on('pageerror',e=>{proof.pageErrors.push({width,mode,message:e.message});save()});p.on('crash',()=>{row.crashed=true;save();browser.close().catch(()=>{})});save();
  try{
   await p.goto(base+'/?board='+id);const f=await getFrame(p,id);await f.evaluate(()=>whiteboardPane.canvasReady());assert(await f.evaluate(()=>typeof snapshotHistoryBoard==='function'));
   await f.waitForFunction(()=>[...document.querySelectorAll('[data-id^="picture-"] img')].length>=2&&[...document.querySelectorAll('[data-id^="picture-"] img')].every(i=>i.complete&&i.naturalWidth===1024));
   row.semanticGuards=await f.evaluate(async()=>{
   const snapshot=snapshotHistoryBoard,original=clone,results=[];
   const semanticModel=()=>({format:'creative-board',version:1,nodes:[{id:'given',type:'note',body:'*plain text*',textFormat:'plain',images:[{data:'data:image/png;base64,'+'A'.repeat(1024*1024),name:'semantic-only-payload'}],source:{nodeIds:['given']},canvasObject:{kind:'image',crop:{x:10,y:10,w:80,h:80},marks:[]}}],edges:[],view:{x:0,y:0,z:1}});
   async function check(name,decorate,inspect){
    
    const a=semanticModel(),b=semanticModel(),left={calls:0},right={calls:0};decorate?.(a,left);decorate?.(b,right);
    let x,y,xe,ye;try{x=original(a)}catch(e){xe=e.name}try{y=snapshot(b)}catch(e){ye=e.name}
    if(xe||ye){if(xe!==ye)throw Error(name+' error classes differ');if(left.calls!==right.calls)throw Error(name+' hook calls differ');results.push({name,errorClass:xe,matched:true,hookCalls:right.calls});return}
    if(JSON.stringify(x)!==JSON.stringify(y))throw Error(name+' JSON value differs');
    if(left.calls!==right.calls)throw Error(name+' hook calls differ');
    inspect?.(y,b);
    results.push({name,matched:true,hookCalls:right.calls});
   }
   await check('plain fields, nested mutable isolation, originals, crop and source ids',null,(copy,source)=>{if(copy===source||copy.nodes===source.nodes||copy.nodes[0].images[0]===source.nodes[0].images[0])throw Error('Shared mutable model');copy.nodes[0].images[0].name='changed';copy.nodes[0].source.nodeIds.push('later');copy.nodes[0].canvasObject.crop.x=55;if(source.nodes[0].images[0].name==='changed'||source.nodes[0].source.nodeIds.includes('later')||source.nodes[0].canvasObject.crop.x!==10)throw Error('Original mutated')});
   await check('undefined, functions, symbols, NaN, infinity and negative zero',b=>{b.extra={absent:undefined,fn:()=>1,sym:Symbol('given'),nan:NaN,infinite:Infinity,negativeZero:-0};b.array=[undefined,()=>1,Symbol('given'),NaN,-0]});
   await check('array holes become null',b=>{b.extra=new Array(5);b.extra[2]='present'});
   await check('own __proto__ and constructor remain ordinary JSON members',b=>{b.extra=JSON.parse('{"__proto__":{"retained":"given"},"constructor":"given"}')},copy=>{if(!Object.hasOwn(copy.extra,'__proto__')||Object.getPrototypeOf(copy.extra)!==Object.prototype||Object.prototype.retained!==undefined)throw Error('Prototype changed')});
   await check('null-prototype object normalizes like JSON',b=>{b.extra=Object.assign(Object.create(null),{title:'given',nested:[1,true,null]})});
   await check('sibling aliases are separate mutable copies',b=>{const shared={values:[1,2]};b.extra={first:shared,second:shared}},copy=>{copy.extra.first.values.push(3);if(copy.extra.second.values.length!==2)throw Error('Alias retained')});
   await check('date and typed array use original serialization fallback',b=>{b.extra={date:new Date('2020-01-01T00:00:00Z'),typed:new Uint8Array([2,4,8])}});
   await check('getter invokes only the original serialization once', (b,s)=>{Object.defineProperty(b,'extra',{enumerable:true,get(){s.calls++;return {value:'given'}}})});
   await check('toJSON invokes only original hook once',(b,s)=>{b.extra={toJSON(){s.calls++;return {value:'normalized'}}}});
   await check('function toJSON invokes the original hook once',(b,s)=>{b.extra=()=>1;b.extra.toJSON=()=>{s.calls++;return {value:'normalized function'}}});
   await check('function toJSON getter invokes the original hook once',(b,s)=>{b.extra=()=>1;Object.defineProperty(b.extra,'toJSON',{get(){s.calls++;return ()=>({value:'normalized function'})}})});
   await check('function toJSON preserves the original error',(b,s)=>{b.extra=()=>1;b.extra.toJSON=()=>{s.calls++;throw TypeError('given function hook failure')}});
   await check('deep graph falls back without changing JSON',b=>{let value=b.extra={};for(let i=0;i<140;i++)value=value.child={i}});
   await check('cycles preserve original error',b=>{b.extra=b});
   await check('BigInt preserves original error',b=>{b.extra=BigInt(1)});
   const old=original({missing:undefined,number:NaN}),native=structuredClone({missing:undefined,number:NaN});
   return {cases:results,plainStructuredCloneRejectedForJSONSemantics:!Object.hasOwn(old,'missing')&&Object.hasOwn(native,'missing')&&old.number===null&&Number.isNaN(native.number)};
  });assert.equal(row.semanticGuards.cases.length,15);assert(row.semanticGuards.cases.every(x=>x.matched));assert(row.semanticGuards.plainStructuredCloneRejectedForJSONSemantics);save();
   const cdp=await c.newCDPSession(p);await cdp.send('HeapProfiler.collectGarbage');row.heapBefore=await cdp.send('Runtime.getHeapUsage');await p.screenshot({path:O+'/'+width+'-'+mode+'-before.png'});
   let previous=given.nodes[0].body;
   for(let i=0;i<3;i++){
    row.phase='native-writing-cycle-'+i;save();const block=f.locator('#nodes>[data-id="writer"]');await block.click({position:{x:80,y:85}});await block.locator('.block-read').click();const field=f.locator('#immersiveSurface #body');await field.waitFor({state:'visible'});assert.equal(await field.inputValue(),previous);row.nativeControlSequence.push('select writer','visible Edit');
    const next=previous+'\n第'+(i+1)+'次合成续写。';const started=Date.now();await field.fill(next);const elapsed=Date.now()-started;await f.locator('#immersiveReturn').click();row.nativeControlSequence.push('textarea input','visible Return');await visibleHistory(f,'undo');row.nativeControlSequence.push('visible Undo');await f.waitForFunction(value=>board.nodes.find(n=>n.id==='writer').body===value,previous);await visibleHistory(f,'redo');row.nativeControlSequence.push('visible Redo');await f.waitForFunction(value=>board.nodes.find(n=>n.id==='writer').body===value,next);
    const state=await f.evaluate(()=>({board:clone(board),historyCount:history.length,futureCount:future.length,historyBodies:history.map(x=>x.nodes.find(n=>n.id==='writer').body)}));for(const n of given.nodes.slice(1))assert.deepEqual(state.board.nodes.find(x=>x.id===n.id),n);assert.equal(state.board.nodes[0].textFormat,'plain');assert.equal(state.board.nodes[0].body,next);assert.equal(state.historyCount,i+1);assert.equal(state.futureCount,0);assert.deepEqual(state.historyBodies,Array.from({length:i+1},(_,j)=>given.nodes[0].body+Array.from({length:j},(_,k)=>'\n第'+(k+1)+'次合成续写。').join('')));row.cycles.push({index:i,bodySHA256:hash(next),historyCount:state.historyCount,futureCount:state.futureCount,pointControlFlowPassed:true,inputAutomationWallMilliseconds:elapsed,allNonWriterNodesExact:true,plainFormatPreserved:true});previous=next;save();
   }
   row.phase='save-and-fresh-readback';save();assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise);await cdp.send('HeapProfiler.collectGarbage');row.heapAfter=await cdp.send('Runtime.getHeapUsage');row.managedHeapDelta=row.heapAfter.usedSize-row.heapBefore.usedSize;const model=await f.evaluate(()=>clone(board));const saved=(await req('/api/boards/'+id)).value;assert.deepEqual(saved,model);row.savedSHA256=hash(JSON.stringify(saved));await p.screenshot({path:O+'/'+width+'-'+mode+'-after.png'});
   const fresh=await setupContext(width,mode);try{const page=await fresh.newPage();await page.goto(base+'/?board='+id);const again=await getFrame(page,id);assert.deepEqual(await again.evaluate(()=>clone(board)),saved);row.newWorkbenchReadbackExact=true}finally{await fresh.close()}
   row.finalBoardSHA256=hash(JSON.stringify(saved));row.phase='complete';row.complete=true;save();
  }finally{await c.close()}
 }
 assert.deepEqual(proof.pageErrors,[]);proof.complete=true;save();
}catch(e){proof.failure=e.stack;save();throw e}finally{
 if(browser){await browser.close();proof.ownedBrowserStopped=true}if(proc&&proc.exitCode===null)proc.kill();if(exit)proof.ownedServerExit=await exit;if(fd!==undefined)fs.closeSync(fd);if(base){let closed=false;for(let i=0;i<40;i++){try{await fetch(base+'/api/health',{signal:AbortSignal.timeout(200)})}catch{closed=true;break}await new Promise(r=>setTimeout(r,100))}proof.ownedPortClosed=closed}proof.finishedAt=new Date().toISOString();save();
}})().catch(e=>{console.error(String(e));process.exitCode=1});
