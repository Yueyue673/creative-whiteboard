const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.PAPER_BLOCK_ORIGIN_PROOF||path.join(R,'artifacts','paper-block-origin'),PY=process.env.PYTHON||'python';assert(R&&O&&!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),proof={at:new Date().toISOString(),complete:false,syntheticOnly:true,prototypeOnly:false,sourceIntegrated:true,DOMOverrides:false,moduleOverrides:false,cases:[],errors:[]},save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));let proc,browser,exit,base,fd;
function waitForIntercept(promise, stage) {
 let timer;
 const deadline = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error('No /api/assets intercept during '+stage)), 9000);
 });
 return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
function waitForCompletion(promise, stage, timeoutMs=9000) {
 let timer;
 const deadline = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error('Timed out waiting for '+stage)), timeoutMs);
 });
 return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
(async()=>{try{
proof.head=execFileSync('git',['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();proof.taskSHA256=hash(fs.readFileSync(__filename));proof.serverSHA256=hash(fs.readFileSync(R+'/server.py'));proof.fixtureSHA256=hash(fs.readFileSync(R+'/tests/local_start_fixture.py'));proof.hostedDockerfileSHA256=hash(fs.readFileSync(R+'/hosted/Dockerfile'));proof.defaultVariablesOmitted=Object.fromEntries(['PYTHON','GIT_EXE','CREATIVE_BOARD_TEST_ROOT'].map(k=>[k,!process.env[k]]));proof.runtimeFiles={};for(const name of ["cells.js", "appearance.js", "document-paper.js", "document-paper.css", "note-editor.js", "note-editor.css", "refinement.js", "refinement.css", "workflow.js", "workflow.css", "pane.js", "workspace.js", "workspace.css", "workspace-shell.js", "workspace-shell.css", "shell.js", "shell.css", "index.html", "navigation.js", "library-copies.js", "canvas-objects.js", "canvas-objects.css", "theme.js", "theme.css", "library-spatial.js", "library-spatial.css"])proof.runtimeFiles[name]=hash(fs.readFileSync(R+'/'+name));save();const hooks=O+'/hooks',data=O+'/given-data';fs.mkdirSync(data);execFileSync(PY,[R+'/tests/local_start_fixture.py','--write-hooks',hooks],{windowsHide:true});const port=await require(R+'/tests/browser-port.cjs')();base='http://127.0.0.1:'+port;const env={...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:data,PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',START_FIXTURE_DATA_DENIED:'0',START_FIXTURE_LIFETIME:'240'};for(const k of Object.keys(env))if(k.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[k];fd=fs.openSync(O+'/server.log','w');proc=spawn(PY,[R+'/server.py'],{cwd:R,env,windowsHide:true,stdio:['ignore',fd,fd]});exit=new Promise((res,rej)=>{proc.once('exit',(code,signal)=>res({code,signal}));proc.once('error',rej)});proof.ownedServer={pid:proc.pid,port,data};save();let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);for(const[n,h]of Object.entries(proof.runtimeFiles))assert.equal(hash(Buffer.from(await(await fetch(base+'/'+n)).arrayBuffer())),h);proof.servedRuntimeExact=true;save();







proof.prototypeOnly=false;proof.sourceIntegrated=true;proof.DOMOverrides=false;proof.moduleOverrides=false;proof.systemClipboardAccessed=false;proof.platformOverrides=[];proof.controlledNetworkConditions=true;proof.controlledOwnerRecordInputs=true;proof.realHostedAccountTested=false;proof.physicalDeviceTested=false;
const req=async(route,method='GET',body,tag)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(r.ok,route+' '+r.status);return{value:await r.json(),tag:r.headers.get('etag')}};
const note=(id,title,body)=>({id,type:'note',title,body,x:20,y:20,w:340,h:220,tags:[],color:'#fff0aa',sizeMode:'manual'}),original=note('given-origin-node','给定原件内部标题','给定库中原件的原话。\n核对来源，不改写。'),other={...original,body:'给定另一份同名原件，不应打开。'},catalog={folders:[],folderIds:{},assets:[{id:'given-origin',title:'给定同名资源',mime:'application/x-creative-bundle',folder:'',path:'',size:0,tags:[],notes:'',bundle:{nodes:[original],edges:[]}},{id:'given-other-origin',title:'给定同名资源',mime:'application/x-creative-bundle',folder:'',path:'',size:0,tags:[],notes:'',bundle:{nodes:[other],edges:[]}}]};const catalogTag=(await req('/api/assets')).tag;await req('/api/assets','PUT',catalog,catalogTag);const savedCatalog=(await req('/api/assets')).value;
browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
for(const width of [1360,320]){
 const row={width,phase:'setup',guards:[]};proof.cases.push(row);const pass=name=>{row.guards.push({name,passed:true});save()};
 const step=async(name,action)=>{row.phase=name;save();const value=await waitForCompletion(Promise.resolve().then(action),name+' at '+width+'px');row.lastCompletedPhase=name;save();return value};
 const id='given-paper-origin-'+width,paragraph={...note('given-body','',Array.from({length:18},(_,i)=>'给定自己的第'+(i+1)+'行原话').join('\n')),documentParagraph:true},copy={...note('given-copy','给定已改名副本','给定自己改编后的副本，和库中原文不同。'),libraryOrigin:{id:'given-origin',nodeId:original.id,name:'给定同名资源',source:{}}},plain=note('given-plain','给定无来源便签','没有原件记录，不猜标题。'),paper={id:'given-paper',type:'table',documentMode:true,title:'给定连续写作',body:'',tags:[],color:'#fffefa',x:20,y:20,w:640,h:720,columns:['正文'],rows:[['']],cellItems:[[[paragraph,copy,plain]]],sizeMode:'manual'};await req('/api/boards/'+id,'PUT',{format:'creative-board',version:1,name:'给定文中原件回访',nodes:[paper],edges:[],view:{x:0,y:0,z:1}},'new');
 let networkMode='normal',entered=null,release=null;const c=await browser.newContext({viewport:{width,height:900}});await c.route('**/*',async r=>{const url=new URL(r.request().url());if(url.origin!==base)return r.abort();if(url.pathname==='/api/assets'&&r.request().method()==='GET'){
 if(networkMode==='duplicate'){const bad=structuredClone(savedCatalog);bad.assets.push({...bad.assets[0]});return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bad)})}
 if(networkMode==='duplicateRoot'){const bad=structuredClone(savedCatalog);bad.assets[0].bundle.nodes.push({...bad.assets[0].bundle.nodes[0]});return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bad)})}
 if(networkMode==='typeChanged'){const bad=structuredClone(savedCatalog);bad.assets[0].bundle.nodes[0]={...bad.assets[0].bundle.nodes[0],type:'table',columns:['给定列'],rows:[['给定值']]};return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bad)})}
 if(networkMode==='missing'){const bad=structuredClone(savedCatalog);bad.assets=bad.assets.filter(a=>a.id!=='given-origin');return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bad)})}
 if(networkMode==='failure')return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'给定读取暂时失败'})});
 if(networkMode==='delayed'){networkMode='normal';await new Promise(resolve=>{const timer=setTimeout(resolve,5000);release=()=>{clearTimeout(timer);resolve()};entered?.(r.request())})}
 }return r.continue()});const p=await c.newPage();p.setDefaultTimeout(9000);p.on('pageerror',e=>proof.errors.push(e.message));await p.goto(base+'/?board='+id);await p.waitForFunction(id=>pane(current())?.state()?.boardId===id&&!pane(current()).state().loading,id);const f=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await f.waitForFunction(()=>assetCatalogReady&&assetById('given-origin'));await f.locator('#fit').click();await f.locator('#nodes>[data-id=given-paper]').click({position:{x:6,y:6}});await f.locator('#nodes>[data-id=given-paper] .block-read').click();await f.locator('#immersiveSurface [data-document-paper]').waitFor();assert.equal(await f.locator('[data-paper-origin]').count(),1);const before=await f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)}));pass('the native expanded paper exposes one existing origin without changing the original draft model');
 assert.equal(await f.locator('[data-paper-origin]').count(),1);assert.equal(await f.locator('[data-paper-origin]').getAttribute('data-paper-origin'),'given-copy');pass('the optional control appears only on a text block with a recorded original and never guesses from same-title resources');
 const field=f.locator('#immersiveSurface [data-cell-item="1"] [data-cell-note-field=body]');await field.focus();await field.evaluate(el=>{el.setSelectionRange(3,9);el.scrollTop=4});const selection=await field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,top:el.scrollTop}));const writerScroll=await f.locator('#immersiveSurface .edit-scroll').evaluate(el=>el.scrollTop);await f.locator('[data-paper-origin=given-copy]').click();await f.locator('.note-source-peek .note-source-card').waitFor();const shown=await f.locator('.note-source-peek .note-source-card').innerText();row.shownOriginalText=shown;row.sourceFields=await f.locator('.note-source-peek .note-source-card').evaluate(el=>({values:[...el.querySelectorAll('textarea,input')].map(f=>f.value),context:whiteboardNoteEditor.sourceContext(el)}));save();assert.equal(row.sourceFields.context?.library?.id,'given-origin');assert.equal(row.sourceFields.context?.node?.body,original.body);assert([shown,...row.sourceFields.values].join('\n').includes(original.body));assert(![shown,...row.sourceFields.values].join('\n').includes(other.body));assert.equal(await f.locator('.note-source-peek textarea:not([readonly])').count(),0);assert.deepEqual(await f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)})),before);await p.screenshot({path:O+'/'+width+'-source-peek.png'});pass('the original source renderer shows the exact recorded resource read-only without changing draft or undo history');
 await f.locator(width===320?'#immersiveReturn':'.source-peek-return').click();await f.locator('.note-source-peek').waitFor({state:'detached'});assert(await field.evaluate(el=>document.activeElement===el));assert.deepEqual(await field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,top:el.scrollTop})),selection);assert.equal(await f.locator('#immersiveSurface .edit-scroll').evaluate(el=>el.scrollTop),writerScroll);pass('return from the existing source viewer restores the same authored field and range');
 await field.focus();await f.locator('[data-paper-origin=given-copy]').focus();await p.keyboard.press('Enter');await f.locator('.note-source-peek .note-source-card').waitFor();await f.locator(width===320?'#immersiveReturn':'.source-peek-return').click();await f.locator('.note-source-peek').waitFor({state:'detached'});assert(await field.evaluate(el=>document.activeElement===el));assert.deepEqual(await field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,top:el.scrollTop})),selection);pass('keyboard opening and return retain the previous native text range without a pointer event');
 await p.keyboard.insertText('给定接续');await p.keyboard.press('Control+z');assert.equal(await field.inputValue(),selection.value);await p.keyboard.press('Control+Shift+z');assert((await field.inputValue()).includes('给定接续'));assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise);assert.deepEqual((await req('/api/assets')).value,savedCatalog);pass('continued native writing undo redo and save leave both same-title library originals exact');
 const currentSnapshot=()=>f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)})),guardBefore=await currentSnapshot();
 for(const mode of ['duplicate','duplicateRoot','missing','typeChanged','failure']){networkMode=mode;await f.locator('[data-paper-origin=given-copy]').click();await f.locator('.note-source-status').filter({hasText:mode==='failure'?'读取暂时失败':mode==='typeChanged'?'类型':'唯一对应'}).waitFor();assert.equal(await f.locator('.note-source-peek .note-source-card').count(),0);assert.deepEqual(await currentSnapshot(),guardBefore);await f.locator(width===320?'#immersiveReturn':'.source-peek-return').click();await f.locator('.note-source-peek').waitFor({state:'detached'});assert(await field.evaluate(el=>document.activeElement===el));}networkMode='normal';pass('controlled duplicate resource or root identity missing or changed original and read failure show an explanation without guessing or changing authored content');
 let reached;const reachedPromise=new Promise(resolve=>reached=resolve);entered=reached;networkMode='delayed';
 await step('cancel-read: open source',()=>f.locator('[data-paper-origin=given-copy]').click());
 const delayedRequest=await step('cancel-read: request intercepted',()=>waitForIntercept(reachedPromise,'cancel during read at '+width+'px'));
 assert.equal(delayedRequest.method(),'GET');
 assert.equal(delayedRequest.url(),base+'/api/assets');
 assert.equal(delayedRequest.frame(),f);
 await step('cancel-read: return to writer',()=>f.locator(width===320?'#immersiveReturn':'.source-peek-return').click());
 await step('cancel-read: source viewer detached',()=>f.locator('.note-source-peek').waitFor({state:'detached'}));
 await step('cancel-read: focus writer',()=>field.focus());
 await step('cancel-read: continue writing',()=>p.keyboard.insertText('给定取消后继续写'));
 const afterCancel=await step('cancel-read: authored snapshot',currentSnapshot),activeField=await step('cancel-read: active field',()=>field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd})));
 release();
 const response=await step('cancel-read: response received',()=>delayedRequest.response());
 assert(response,'the intercepted original request must receive a response');
 assert.equal(response.request(),delayedRequest);
 assert.equal(response.status(),200);
 row.lateResponse={status:response.status(),path:new URL(response.url()).pathname,interceptedRequest:true};save();
 const lateBody=await step('cancel-read: exact complete response body',()=>response.body());
 row.lateResponse.completeBodyRead=true;row.lateResponse.bodySHA256=hash(lateBody);row.lateResponse.bytes=lateBody.length;save();
 const lateCatalog=JSON.parse(lateBody.toString('utf8'));
 assert.deepEqual(lateCatalog,savedCatalog);
 await step('cancel-read: settled writer retained',async()=>{
  await f.waitForTimeout(50);assert.equal(await f.locator('.note-source-peek').count(),0);assert.deepEqual(await currentSnapshot(),afterCancel);assert(await field.evaluate(el=>document.activeElement===el));assert.deepEqual(await field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd})),activeField);
 });
 pass('cancel during a controlled read delay then write keeps late completion from reopening or stealing the writer');
 let ownerReached;const ownerPromise=new Promise(resolve=>ownerReached=resolve);entered=ownerReached;networkMode='delayed';
 await step('owner-read: open source',()=>f.locator('[data-paper-origin=given-copy]').click());
 await step('owner-read: request intercepted',()=>waitForIntercept(ownerPromise,'owner change during read at '+width+'px'));
 const ownerBefore=await step('owner-read: original snapshot',currentSnapshot);
 await step('owner-read: change controlled owner',()=>f.evaluate(()=>{board.nodes.find(n=>n.id==='given-paper').cellItems[0][0].find(n=>n.id==='given-copy').libraryOrigin.id='given-other-origin'}));release();
 await step('owner-read: invalidated viewer detached',()=>f.locator('.note-source-peek').waitFor({state:'detached'}));
 await step('owner-read: restore controlled owner',()=>f.evaluate(()=>{board.nodes.find(n=>n.id==='given-paper').cellItems[0][0].find(n=>n.id==='given-copy').libraryOrigin.id='given-origin'}));
 assert.deepEqual(await step('owner-read: protected snapshot',currentSnapshot),ownerBefore);
 pass('a controlled owner-origin change while reading invalidates the response without guessing another same-title source or editing draft text');
 await step('readback: save authored content',async()=>{assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise)});
 const saved=(await step('readback: saved board',()=>req('/api/boards/'+id))).value;
 await step('readback: fresh page',()=>p.reload());
 await step('readback: fresh board ready',()=>p.waitForFunction(id=>pane(current())?.state()?.boardId===id&&!pane(current()).state().loading,id));
 const fresh=await step('readback: fresh frame',async()=>await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame());
 assert.deepEqual(await step('readback: exact nodes',()=>fresh.evaluate(()=>board.nodes)),saved.nodes);
 assert.deepEqual((await step('readback: exact original catalog',()=>req('/api/assets'))).value,savedCatalog);
 pass('fresh saved readback retains authored text and exact origin with both library originals unchanged');
 row.phase='complete';save();await c.close();
}
assert.deepEqual(proof.errors,[]);proof.complete=true;
}catch(e){proof.failure=e.stack;save();throw e}finally{if(browser)await browser.close();if(proc&&proc.exitCode===null)proc.kill();if(exit)proof.ownedServerExit=await exit;if(fd!==undefined)fs.closeSync(fd);if(base){let closed=false;for(let i=0;i<60;i++){try{await fetch(base+'/api/health',{signal:AbortSignal.timeout(200)})}catch{closed=true;break}await new Promise(r=>setTimeout(r,100))}proof.ownedPortClosed=closed;assert(closed)}save()}})().catch(e=>{console.error(e);process.exitCode=1});
