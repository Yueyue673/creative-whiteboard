const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');

const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.LIBRARY_RECENT_ORDER_PROOF||path.join(R,'artifacts','library-recent-order'),PY=process.env.PYTHON||'python';
assert(!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),proof={at:new Date().toISOString(),syntheticOnly:true,prototypeOnly:false,defaultVariablesOmitted:{PYTHON:!Object.hasOwn(process.env,'PYTHON'),GIT_EXE:!Object.hasOwn(process.env,'GIT_EXE'),CREATIVE_BOARD_TEST_ROOT:!Object.hasOwn(process.env,'CREATIVE_BOARD_TEST_ROOT')},complete:false,cases:[],errors:[]},save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));

(async()=>{let proc,exited,fd,browser;

try{

 proof.head=execFileSync((process.env.GIT_EXE||'git'),['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();proof.taskSHA256=hash(fs.readFileSync(__filename));proof.runtimeFiles={};for(const n of ['workspace.js','workspace.css','workflow.js','workflow.css','pane.js','shell.js','workspace-shell.js','workspace-shell.css','refinement.css','index.html'])proof.runtimeFiles[n]=hash(fs.readFileSync(R+'/'+n));proof.serverSHA256=hash(fs.readFileSync(R+'/server.py'));proof.fixtureSHA256=hash(fs.readFileSync(R+'/tests/local_start_fixture.py'));proof.hostedDockerfileSHA256=hash(fs.readFileSync(R+'/hosted/Dockerfile'));save();

 const data=O+'/given-data',hooks=O+'/hooks';fs.mkdirSync(data);execFileSync(PY,[R+'/tests/local_start_fixture.py','--write-hooks',hooks],{windowsHide:true});const port=await require(R+'/tests/browser-port.cjs')(),base='http://127.0.0.1:'+port,env={...process.env,CREATIVE_BOARD_DATA_DIR:data,CREATIVE_BOARD_PORT:String(port),PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',START_FIXTURE_DATA_DENIED:'0',START_FIXTURE_LIFETIME:'180'};delete env.PYTHONHOME;for(const k of Object.keys(env))if(k.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[k];fd=fs.openSync(O+'/server.log','w');proc=spawn(PY,[R+'/server.py'],{cwd:R,env,windowsHide:true,stdio:['ignore',fd,fd]});exited=new Promise((resolve,reject)=>{proc.once('exit',(code,signal)=>resolve({code,signal}));proc.once('error',reject)});proof.ownedServer={pid:proc.pid,port,data};save();let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,60))}assert(ready);

 proof.servedRuntimeFiles={};for(const[name,digest]of Object.entries(proof.runtimeFiles)){const response=await fetch(base+'/'+name);assert(response.ok);const actual=hash(Buffer.from(await response.arrayBuffer()));assert.equal(actual,digest);proof.servedRuntimeFiles[name]=actual}save();
 const req=async(url,method='GET',body,tag)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(response.ok,url+' '+response.status);return {value:await response.json(),tag:response.headers.get('etag')}};

 const note=(id,text)=>({id,type:'note',title:'给定同名材料',body:text,tags:[],x:0,y:0,w:300,h:200,sizeMode:'manual',color:'#fff0b4'});

 const entries=Array.from({length:320},(_,i)=>({id:'resource-'+i,title:'给定同名材料',mime:'application/x-creative-bundle',path:'',folder:'给定积累',size:0,tags:[],notes:i>=318?'给定最近整理的材料':'给定较早材料',updated:1700000000000+i*1000,bundle:{nodes:[i===319?{id:'table-source',type:'table',title:'给定混合格',columns:['原话','来源'],rows:[['给定整理','给定位置']],cellItems:[[[note('nested-source','给定格内补充')],[]]],cellImages:[[[],[]]],x:0,y:0,w:420,h:250,sizeMode:'manual'}:note('given-source-'+i,'给定原文 '+i)],edges:[]}}));

 delete entries[0].updated;entries[1].updated=null;entries[2].updated='given-unknown-time';
 entries.push({...structuredClone(entries[318]),id:'outside-newer',folder:'给定其他',updated:1900000000000},{...structuredClone(entries[319]),id:'archived-newer',archived:true,updated:1900000000001});
 let catalog=await req('/api/assets');catalog.value.assets=entries;catalog.value.folders=['给定积累','给定其他'];await req('/api/assets','PUT',catalog.value,catalog.tag);const catalogBefore=(await req('/api/assets')).value;

 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});

 for(const width of [1360,320]){const mode='source';

  const boardId='writer-'+width+'-'+mode,writer={...note('writer','给定写作原文'),title:'给定正在写',x:30,y:30};await req('/api/boards/'+boardId,'PUT',{format:'creative-board',version:1,name:'给定写作',nodes:[writer],edges:[],view:{x:20,y:20,z:1}},'new');

 const row={width,mode,phase:'open-original-library',inFolderCount:320,showMoreActions:0,orderActions:0};proof.cases.push(row);save();

 const context=await browser.newContext({viewport:{width,height:940}});context.setDefaultTimeout(12000);await context.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());

 let p;
 try{
 p=await context.newPage();p.on('pageerror',e=>{proof.errors.push(e.message);save()});await p.goto(base+'/?board='+boardId);await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,boardId);const f=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();

 await p.locator('#openBoards').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());const ex=p.frames().find(x=>x.parentFrame()&&new URL(x.url()).searchParams.get('explorer')==='1');await ex.locator('#assetsButton').click();await ex.locator('[data-asub="给定积累"]').dblclick();await ex.locator('[data-asset="resource-0"]').waitFor();

 const originalOrder=await ex.evaluate(()=>libraryMatches().map(a=>a.id));assert.deepEqual(originalOrder,entries.filter(a=>a.folder==='给定积累'&&!a.archived).map(a=>a.id));

 assert.equal(await ex.getByLabel('内容顺序',{exact:true}).inputValue(),'original');
 if(width===1360){await ex.locator('[data-asset="resource-0"] input[type=checkbox]').check()}
 await ex.getByLabel('内容顺序',{exact:true}).selectOption('recent');row.orderActions++;
 assert.deepEqual(await ex.locator('[data-asset]').evaluateAll(rows=>rows.slice(0,2).map(x=>x.dataset.asset)),['resource-319','resource-318']);
 row.defaultOrderPreservedBeforeChoice=true;row.orderControlBounds=await ex.getByLabel('内容顺序',{exact:true}).evaluate(el=>{const box=el.getBoundingClientRect();return{x:box.x,right:box.right,viewport:innerWidth}});assert(row.orderControlBounds.x>=0&&row.orderControlBounds.right<=row.orderControlBounds.viewport);
 if(width===1360){
  assert.deepEqual(await ex.evaluate(()=>[...assetSelected]),['resource-0']);row.existingSelectionPreservedAcrossOrder=true;
  await ex.locator('#assetSearch').fill('给定原文 318');assert.deepEqual(await ex.evaluate(()=>libraryMatches().map(a=>a.id)),['resource-318']);assert.equal(await ex.evaluate(()=>assetFolder),'给定积累');await ex.locator('#assetSearch').fill('');row.searchScopeRetained=true;
  await ex.locator('[data-acrumb=""]').click();await ex.locator('[data-asub="给定其他"]').dblclick();assert.deepEqual(await ex.evaluate(()=>libraryMatches().map(a=>a.id)),['outside-newer']);assert.equal(await ex.getByLabel('内容顺序',{exact:true}).inputValue(),'recent');
  await ex.locator('[data-acrumb=""]').click();await ex.locator('[data-asub="给定积累"]').dblclick();row.folderScopeRetained=true;
 }
 row.phase='preview-and-reuse';save();await p.screenshot({path:O+'/'+width+'-'+mode+'-ordered.png'});await ex.locator('[data-asset-preview="resource-318"]').click();await ex.locator('#pieceList').waitFor();assert((await ex.locator('#dialogBody').innerText()).includes('给定原文 318'));await ex.getByRole('button',{name:'返回内容库',exact:true}).click();if(width===1360){await ex.locator('[data-asset="resource-319"]').click();await ex.locator('[data-asset="resource-318"]').click({modifiers:['Shift']});assert.deepEqual(new Set(await ex.evaluate(()=>[...assetSelected])),new Set(['resource-319','resource-318']));row.visibleSortedRangeSelectionExact=true}else{await ex.locator('[data-asset="resource-318"] input[type=checkbox]').check();await ex.locator('[data-asset="resource-319"] input[type=checkbox]').check();row.realCheckboxSelection=true}await ex.locator('[data-asset="resource-319"]').focus();await p.keyboard.press('Control+Enter');await f.waitForFunction(()=>board.nodes.length===3);

 assert.deepEqual(new Set(await f.evaluate(()=>board.nodes.filter(n=>n.libraryOrigin).map(n=>n.libraryOrigin.id))),new Set(['resource-318','resource-319']));const modelBefore=await f.evaluate(()=>clone(board.nodes));assert.equal(modelBefore.find(n=>n.libraryOrigin?.id==='resource-318').body,'给定原文 318');assert.equal(modelBefore.find(n=>n.libraryOrigin?.id==='resource-319').cellItems[0][0][0].body,'给定格内补充');

 if(await p.evaluate(()=>!document.getElementById('globalExplorer').hidden)){await p.locator('#openBoards').click()}await p.waitForFunction(()=>document.getElementById('globalExplorer').hidden);await f.locator('#canvas').click({position:{x:8,y:8}});await p.keyboard.press('Control+z');await f.waitForFunction(()=>board.nodes.length===1);await p.keyboard.press('Control+Shift+z');await f.waitForFunction(()=>board.nodes.length===3);row.oneNativeStructuralUndoRedo=true;

 await f.locator('#fit').click();await f.locator('[data-id=writer]').dblclick();await f.locator('#body').fill('给定写作原文');await p.keyboard.press('Control+End');await p.keyboard.insertText('，取用后继续写');const continued=await f.locator('#body').inputValue();assert.equal(continued,'给定写作原文，取用后继续写');await p.keyboard.press('Control+z');assert.equal(await f.locator('#body').inputValue(),'给定写作原文');await p.keyboard.press('Control+y');assert.equal(await f.locator('#body').inputValue(),continued);assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise);

 assert.deepEqual((await req('/api/assets')).value.assets,catalogBefore.assets);const saved=(await req('/api/boards/'+boardId)).value;assert.equal(saved.nodes.find(n=>n.id==='writer').body,continued);await p.screenshot({path:O+'/'+width+'-'+mode+'-continued.png'});await p.reload();await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,boardId);const again=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();assert.deepEqual(await again.evaluate(()=>board.nodes),saved.nodes);

 row.phase='complete';row.nativeBatchPlacement=true;row.mixedNestedContentExact=true;row.originalCatalogBytesPreserved=true;row.nativeContinuedWritingUndoRedo=true;row.savedFreshWorkbenchExact=true;save();

 }catch(error){try{await p.screenshot({path:O+'/'+width+'-'+mode+'-failure.png'});row.failureFrames=await Promise.all(p.frames().filter(x=>x.parentFrame()).map(async x=>({url:x.url(),state:await x.evaluate(()=>({assetFolder:typeof assetFolder==='undefined'?null:assetFolder,readState:typeof assetReadState==='undefined'?null:assetReadState,dialog:document.getElementById('dialog')?.open,body:document.body.innerText.slice(-1800)}))})));save()}catch{}throw error}finally{await context.unrouteAll({behavior:'wait'});await context.close()}

 }

 assert.deepEqual(proof.errors,[]);proof.complete=true;save();

}catch(error){proof.failure=error.stack;save();throw error}

finally{if(browser)await browser.close();proof.ownedBrowserStopped=true;if(proc){if(proc.exitCode===null&&proc.signalCode===null)proc.kill();proof.ownedServer.exit=await exited;proof.ownedServiceStopped=true}if(fd!==undefined)fs.closeSync(fd);save()}

})().catch(error=>{console.error(error.stack);process.exitCode=1});
