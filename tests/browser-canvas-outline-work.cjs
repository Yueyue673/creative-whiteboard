const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.CANVAS_OUTLINE_PROOF||path.join(R,'artifacts','canvas-outline-work'),PY=process.env.PYTHON||'python';
assert(!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),proof={at:new Date().toISOString(),syntheticOnly:true,prototypeOnly:false,complete:false,cases:[],errors:[]};
proof.driverPID=process.pid;
const save=()=>fs.writeFileSync(path.join(O,'result.json'),JSON.stringify(proof,null,2));
(async()=>{let server,browser,exit,fd;
try{
 proof.head=execFileSync(process.env.GIT_EXE||'git',['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 proof.source={};for(const name of ['server.py','index.html','note-editor.js','autosize.js','navigation.js','workflow.js','workflow.css','workspace.js','pane.js'])proof.source[name]=hash(fs.readFileSync(path.join(R,name)));
 proof.taskSHA256=hash(fs.readFileSync(__filename));proof.serverSHA256=proof.source['server.py'];proof.fixtureSHA256=hash(fs.readFileSync(path.join(R,'tests/local_start_fixture.py')));proof.hostedDockerfileSHA256=hash(fs.readFileSync(path.join(R,'hosted/Dockerfile')));proof.conditions={viewport:[1360,900],cards:[10,200,800],writingCharacters:40000,nativeKeys:'Given continuation.',delayBetweenKeysMs:25,instrumented:true};save();
 const hooks=path.join(O,'hooks');execFileSync(PY,[path.join(R,'tests/local_start_fixture.py'),'--write-hooks',hooks],{windowsHide:true});
 const data=path.join(O,'given-data');fs.mkdirSync(data);
 const port=await require(path.join(R,'tests/browser-port.cjs'))(),base='http://127.0.0.1:'+port;
 const env={...process.env,CREATIVE_BOARD_DATA_DIR:data,CREATIVE_BOARD_PORT:String(port),PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',START_FIXTURE_LIFETIME:'90',START_FIXTURE_DATA_DENIED:'0'};
 delete env.PYTHONHOME;for(const key of Object.keys(env))if(key.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[key];
 fd=fs.openSync(path.join(O,'server.log'),'w');server=spawn(PY,[path.join(R,'server.py')],{cwd:R,env,windowsHide:true,stdio:['ignore',fd,fd]});exit=new Promise((resolve,reject)=>{server.once('exit',(code,signal)=>resolve({code,signal}));server.once('error',reject)});proof.ownedServer={pid:server.pid,port,data};save();
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,60))}assert(ready);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 for(const count of proof.conditions.cards){
  const row={mode:'canvas-writing',count,phase:'start'};proof.cases.push(row);save();
  const nodes=[{id:'writing',type:'note',title:'Given continuous writing',body:'Given paragraph for continued writing. '.repeat(1100).slice(0,40000),sizeMode:'manual',x:60,y:60,w:410,h:400,color:'#fff0aa',tags:[]}];
  for(let i=1;i<count;i++)nodes.push({id:'given-'+i,type:'note',title:'Given material '+i,body:'Given material remains literal and independent.',sizeMode:'auto',x:2000+(i%25)*330,y:Math.floor(i/25)*180,w:300,h:120,color:'#ffffff',tags:[]});
  const value={format:'creative-board',version:1,name:'Given dense writing '+count,nodes,edges:[],view:{x:0,y:0,z:1}};
  const id='given-dense-'+count;assert((await fetch(base+'/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)})).ok);
  let releaseLive;const context=await browser.newContext({viewport:{width:1360,height:900}});try{
   const p=await context.newPage();p.on('pageerror',e=>{proof.errors.push(e.message);save()});p.setDefaultTimeout(12000);await p.goto(base+'/?board='+id);
   await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);
   const f=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();
   await f.locator('[data-id=writing]').dblclick();await f.locator('#body').waitFor();await f.locator('#body').focus();await p.keyboard.press('Control+End');
   await f.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   row.canvasRole=await f.evaluate(()=>({role:document.documentElement.classList.contains('canvas-pane'),sidebarVisible:getComputedStyle(document.getElementById('workspaceSidebar')).display!=='none'}));assert(row.canvasRole.role&&!row.canvasRole.sidebarVisible);
   proof.servedSource=proof.servedSource||{};for(const[name,digest]of Object.entries(proof.source)){if(name==='server.py')continue;const response=await fetch(base+'/'+name);assert(response.ok);const actual=hash(Buffer.from(await response.arrayBuffer()));assert.equal(actual,digest);proof.servedSource[name]=actual}
   const beforeOthers=await f.evaluate(()=>clone(board.nodes.slice(1)));
   row.givenOtherSnapshotSHA256=hash(Buffer.from(JSON.stringify(beforeOthers)));
   await f.evaluate(()=>{
    window.observation={inputs:[],stages:{},longTasks:[]};
    if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')){window.observer=new PerformanceObserver(list=>observation.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'})}
    window.stageOriginals={};for(const name of ['undoPoint','drawNodes','growContentFields','fitContentLayouts','renderOutline','change','moveView'])if(typeof window[name]==='function'){const original=window[name];stageOriginals[name]=original;window[name]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{const row=observation.stages[name]||={calls:0,ms:0};row.calls++;row.ms+=performance.now()-t}}}
    const field=document.getElementById('body'),original=field.oninput;if(typeof original!=='function')throw Error('Original live input handler missing');
    field.oninput=function(event){const row={start:performance.now()};observation.inputs.push(row);try{return original.call(this,event)}finally{row.handlerMs=performance.now()-row.start;requestAnimationFrame(()=>row.nextAnimationFrameMs=performance.now()-row.start)}};
    observation.historyBefore=history.length;observation.field=field;observation.firstOther=document.querySelector('[data-id=given-1]');observation.initialOther=JSON.stringify(board.nodes.slice(1));
   });
   await p.keyboard.type(proof.conditions.nativeKeys,{delay:25});await f.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   row.measurement=await f.evaluate(()=>{
    const o=observation,clean=JSON.parse(JSON.stringify({inputs:o.inputs,stages:o.stages,longTasks:o.longTasks,historyDelta:history.length-o.historyBefore,sameField:document.getElementById('body')===o.field,sameFirstOther:document.querySelector('[data-id=given-1]')===o.firstOther,otherModelExact:JSON.stringify(board.nodes.slice(1))===o.initialOther}));
    for(const[name,original]of Object.entries(stageOriginals))window[name]=original;if(window.observer)observer.disconnect();return clean;
   });save();
   assert.equal(row.measurement.inputs.length,proof.conditions.nativeKeys.length);assert.equal(row.measurement.historyDelta,1);assert(row.measurement.sameField&&row.measurement.sameFirstOther&&row.measurement.otherModelExact);
   const expectedBody=value.nodes[0].body+proof.conditions.nativeKeys;assert.equal(await f.locator('#body').inputValue(),expectedBody);
   await f.locator('#inlineDone').click();await f.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.equal(await f.evaluate(()=>board.nodes[0].body),value.nodes[0].body);await p.keyboard.press('Control+Shift+z');assert.equal(await f.evaluate(()=>board.nodes[0].body),expectedBody);
   await f.evaluate(()=>persist());await f.waitForFunction(()=>!dirty&&!savePromise&&!contentDirty);const saved=await(await fetch(base+'/api/boards/'+id)).json();assert.equal(saved.nodes[0].body,expectedBody);assert.deepEqual(saved.nodes.slice(1),beforeOthers);
   await p.screenshot({path:path.join(O,count+'-continued.png')});await p.reload();await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);const again=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();assert.deepEqual(await again.evaluate(()=>board.nodes),saved.nodes);
   if(count===800){
    await p.locator('#openBoards').click();await p.waitForFunction(()=>!!whiteboardWorkspace.explorer());
    const ex=await(await p.locator('#explorerFrame').elementHandle()).contentFrame();await ex.locator('#toggleOutline').click();await ex.locator('#search').fill(proof.conditions.nativeKeys);
    const match=ex.locator('#items [data-open=writing]');await match.waitFor();assert.equal(await ex.locator('#items [data-open]').count(),1);assert((await match.innerText()).includes(proof.conditions.nativeKeys));await match.click();await again.waitForFunction(()=>selected.size===1&&selected.has('writing'));
    row.explorerNativeClickSelectsExactTarget=true;
    const liveGate=new Promise(resolve=>releaseLive=resolve);await p.route('**/api/boards/'+id,async route=>{if(route.request().method()==='PUT')await liveGate;await route.continue()});
    await again.locator('[data-id=writing]').dblclick();const field=again.locator('#body');await field.waitFor();await field.focus();await p.keyboard.press('Control+End');const suffix=' Live update.';await p.keyboard.type(suffix,{delay:25});
    await ex.locator('#search').fill('Live update.');await match.waitFor();assert.equal(await ex.locator('#items [data-open]').count(),1);assert((await match.innerText()).includes('Live update.'));assert.equal(await field.inputValue(),expectedBody+suffix);
    assert(await again.evaluate(()=>dirty||!!savePromise||savingContent));row.originalVisibleExplorerTracksUnsavedNativeWriting=true;releaseLive();await p.unrouteAll({behavior:'wait'});

    await again.locator('#inlineDone').click();await again.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.equal(await again.evaluate(()=>board.nodes[0].body),expectedBody);await p.keyboard.press('Control+Shift+z');assert.equal(await again.evaluate(()=>board.nodes[0].body),expectedBody+suffix);assert.deepEqual(await again.evaluate(()=>board.nodes.slice(1)),beforeOthers);
    assert(await again.evaluate(()=>persist()));await again.waitForFunction(()=>!dirty&&!savePromise);const updated=await(await fetch(base+'/api/boards/'+id)).json();assert.equal(updated.nodes[0].body,expectedBody+suffix);await p.reload();await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);const fresh=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();assert.deepEqual(await fresh.evaluate(()=>board.nodes),updated.nodes);row.liveUpdateUndoRedoSaveReopenExact=true;
   }
   row.fullWriteUndoRedoSaveReopenExact=true;row.phase='complete';save();
  }finally{if(releaseLive)releaseLive();for(const openPage of context.pages())await openPage.unrouteAll({behavior:'wait'});await context.close()}
 }
 const standalone={mode:'standalone-outline',count:10,phase:'start'};proof.cases.push(standalone);save();
 const context=await browser.newContext({viewport:{width:1360,height:900}});try{
  const p=await context.newPage();p.on('pageerror',error=>{proof.errors.push(error.message);save()});p.setDefaultTimeout(10000);await p.goto(base+'/index.html?board=given-dense-10');await p.waitForFunction(()=>boardId==='given-dense-10'&&!loading);
  assert(await p.evaluate(()=>parent===window&&!document.documentElement.classList.contains('canvas-pane')));
  if(!await p.locator('#workspaceSidebar').isVisible())await p.locator('#sidebarToggle').click();await p.locator('#toggleOutline').click();await p.locator('#search').fill(proof.conditions.nativeKeys);
  const match=p.locator('#items [data-open=writing]');await match.waitFor();assert.equal(await p.locator('#items [data-open]').count(),1);await match.click();await p.locator('#title').waitFor();await p.locator('#title').fill('Given standalone latest title');assert((await match.innerText()).includes('Given standalone latest title'));assert(await p.evaluate(()=>selected.has('writing')));
  const saved=await p.evaluate(async()=>{await persist();return clone(board.nodes)});assert.equal(saved[0].title,'Given standalone latest title');await p.reload();await p.waitForFunction(()=>boardId==='given-dense-10'&&!loading);assert.deepEqual(await p.evaluate(()=>board.nodes),saved);standalone.originalSearchTitleRefreshSelectSaveReopen=true;standalone.phase='complete';save();
 }finally{await context.close()}
 assert.deepEqual(proof.errors,[]);proof.complete=true;save();
}catch(error){proof.failure=error.stack;save();throw error}
finally{if(browser)await browser.close();if(server){if(server.exitCode===null&&server.signalCode===null)server.kill();proof.ownedServerExit=await exit;proof.ownedServicesStopped=true}if(fd!==undefined)fs.closeSync(fd);proof.ownedBrowserStopped=true;save()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
