const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const R=path.resolve(process.env.CREATIVE_BOARD_TEST_ROOT||path.join(__dirname,'..')),O=process.env.SOURCE_REFRESH_PROOF||path.join(R,'.test-proof-source-refresh-ownership'),PY=process.env.PYTHON||'python';assert(R&&O&&!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),proof={at:new Date().toISOString(),complete:false,syntheticOnly:true,prototypeOnly:false,sourceIntegrated:true,DOMOverrides:false,moduleOverrides:false,cases:[],errors:[]},save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));let proc,browser,exit,base,fd;const releaseReads=[];
(async()=>{try{
proof.head=execFileSync('git',['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();proof.taskSHA256=hash(fs.readFileSync(__filename));proof.serverSHA256=hash(fs.readFileSync(R+'/server.py'));proof.fixtureSHA256=hash(fs.readFileSync(R+'/tests/local_start_fixture.py'));proof.hostedDockerfileSHA256=hash(fs.readFileSync(R+'/hosted/Dockerfile'));proof.defaultVariablesOmitted=Object.fromEntries(['PYTHON','GIT_EXE','CREATIVE_BOARD_TEST_ROOT'].map(k=>[k,!process.env[k]]));proof.runtimeFiles={};for(const name of ["cells.js", "appearance.js", "document-paper.js", "document-paper.css", "note-editor.js", "note-editor.css", "refinement.js", "refinement.css", "workflow.js", "workflow.css", "pane.js", "workspace.js", "workspace.css", "workspace-shell.js", "workspace-shell.css", "shell.js", "shell.css", "index.html", "navigation.js", "library-copies.js", "canvas-objects.js", "canvas-objects.css", "theme.js", "theme.css", "library-spatial.js", "library-spatial.css", "library-folders.js", "shell.html", "board-lifecycle.js", "media-markers.js", "media-controls.js", "library-editing.js", "experience.js"])proof.runtimeFiles[name]=hash(fs.readFileSync(R+'/'+name));save();const hooks=O+'/hooks',data=O+'/given-data';fs.mkdirSync(data);execFileSync(PY,[R+'/tests/local_start_fixture.py','--write-hooks',hooks],{windowsHide:true});const port=await require(R+'/tests/browser-port.cjs')();base='http://127.0.0.1:'+port;const env={...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:data,PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',START_FIXTURE_DATA_DENIED:'0',START_FIXTURE_LIFETIME:'240'};for(const k of Object.keys(env))if(k.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[k];fd=fs.openSync(O+'/server.log','w');proc=spawn(PY,[R+'/server.py'],{cwd:R,env,windowsHide:true,stdio:['ignore',fd,fd]});exit=new Promise((res,rej)=>{proc.once('exit',(code,signal)=>res({code,signal}));proc.once('error',rej)});proof.ownedServer={pid:proc.pid,port,data};save();let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);for(const[n,h]of Object.entries(proof.runtimeFiles))assert.equal(hash(Buffer.from(await(await fetch(base+(n==='shell.html'?'/':'/'+n))).arrayBuffer())),h);proof.servedRuntimeExact=true;save();




Object.assign(proof,{sourceIntegrated:true,prototypeOnly:false,moduleOverrides:false,DOMOverrides:false,syntheticOnly:true,controlledNetworkConditions:true,controlledHostedScopeInputs:true,controlledCatalogFixtures:true,systemClipboardAccessed:false});
const req=async(route,method='GET',value,tag)=>{
 const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});
 assert(response.ok,route+' '+response.status);return{value:await response.json(),tag:response.headers.get('etag')};
};
const note=(id,body)=>({id,type:'note',title:'给定材料',body,x:30,y:30,w:320,h:240,tags:[],opaque:{keep:true}});
const original=note('given-piece','给定库中的原来版本'),source=note(original.id,'给定来源白板的新版本'),writer=note('given-writer','给定正在写的原稿');
for(const [id,node] of [['given-source',source],['given-writing',writer]])await req('/api/boards/'+id,'PUT',{format:'creative-board',version:1,name:id,nodes:[node],edges:[],view:{x:0,y:0,z:1}},'new');
const initial=(await req('/api/assets')).value,asset={id:'given-resource',title:'给定来源组合',mime:'application/x-creative-bundle',folder:'',path:'',size:0,notes:'',tags:[],source:{boardId:'given-source',nodeIds:[original.id]},bundle:{nodes:[original],edges:[]},updated:1};
const catalog={...initial,assets:[asset,...initial.assets]},restore=async()=>{const current=await req('/api/assets');await req('/api/assets','PUT',catalog,current.tag)};
const scope={account:{id:'given-account'},workspace:'given-workspace',base:'/given/',paused:false,role:'editor'};
browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
for(const width of [1360,320]){
 await restore();const row={width,guards:[]};proof.cases.push(row);const pass=name=>{row.guards.push({name,passed:true});save()};
 const c=await browser.newContext({viewport:{width,height:900}});c.on('page',page=>page.on('pageerror',e=>proof.errors.push(e.message)));
 await c.addInitScript(origin=>{if(location.origin===origin)localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false}))},base);
 await c.route('**/*',route=>new URL(route.request().url()).origin===base?route.fallback():route.abort());let writes=0;
 c.on('request',request=>{if(new URL(request.url()).pathname==='/api/assets'&&request.method()==='PUT')writes++});
 const p=await c.newPage();p.setDefaultTimeout(9000);await p.goto(base+'/?board=given-writing');
 await p.waitForFunction(()=>pane(current())?.state()?.boardId==='given-writing'&&!pane(current()).state().loading);
 await p.locator('#openBoards').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());
 const f=await(await p.locator('#explorerFrame').elementHandle()).contentFrame();await f.locator('#assetsButton').click();
 const resetScope=async()=>{await p.evaluate(scope=>window.whiteboardHosted=structuredClone(scope),scope);await f.evaluate(scope=>window.whiteboardHosted=structuredClone(scope),scope)};await resetScope();
 const preview=async()=>{await f.locator('[data-asset-preview=given-resource]').click();await f.locator('.reuse-original > summary').click();await f.getByRole('button',{name:'从原白板更新',exact:true}).waitFor()};
 const update=()=>f.getByRole('button',{name:'从原白板更新',exact:true}).click();
 const settle=()=>f.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const hold=async()=>{
  let release,received,finished;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>received=resolve),done=new Promise(resolve=>finished=resolve);releaseReads.push(release);
  const handler=async route=>{const response=await route.fetch();received();await gate;await route.fulfill({response});finished()};
  await c.route('**/api/boards/given-source',handler);await preview();await update();
  let timer;try{await Promise.race([started,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('source read did not start')),9000))])}finally{clearTimeout(timer)}
  assert.equal(await f.evaluate(()=>$('dialog').open),false);
  return async()=>{release();await done;await c.unroute('**/api/boards/given-source',handler);await settle()};
 };
 const noReview=async()=>{assert.equal(await f.getByRole('heading',{name:'从来源白板更新组合',exact:true}).count(),0);assert.equal(writes,0)};
 // A second, native creation owns its fields, focus, selection and undo history.
 let finish=await hold();await f.locator('#libraryCreate').click();await f.locator('#library-title').fill('给定后来开始的新记录');
 const body=f.locator('#library-body');await body.focus();await p.keyboard.insertText('给定后来写下的未保存原话');const before=await body.inputValue();await p.keyboard.insertText(' 补充');
 const field=await body.elementHandle(),selection=await body.evaluate(el=>[el.selectionStart,el.selectionEnd]);await finish();await noReview();
 assert(await field.evaluate(el=>el.isConnected&&el===document.activeElement));assert.equal(await body.inputValue(),before+' 补充');assert.deepEqual(await body.evaluate(el=>[el.selectionStart,el.selectionEnd]),selection);
 assert.equal(await f.locator('#library-title').inputValue(),'给定后来开始的新记录');assert.deepEqual((await req('/api/assets')).value,catalog);pass('late source read keeps the later native draft field, title, focus, caret and catalog exact');
 await p.screenshot({path:O+'/'+width+'-draft-kept.png'});await p.keyboard.press('Control+z');assert.equal(await body.inputValue(),before);pass('the same later draft retains one native undo after the source response arrives');
 await f.getByRole('button',{name:'取消',exact:true}).click();
 // Opening and closing another editor still cancels the older panel ownership.
 finish=await hold();await f.locator('#libraryCreate').click();await f.getByRole('button',{name:'取消',exact:true}).click();await finish();await noReview();assert.equal(await f.evaluate(()=>$('dialog').open),false);pass('opening then closing a later editor does not let an old comparison reopen');
 // A shell action outside the explorer must also win over the pending read.
 finish=await hold();await p.locator('#openBoards').click();await finish();await noReview();assert.equal(await f.evaluate(()=>$('dialog').open),false);await p.locator('#openBoards').click();pass('a native shell action during the read prevents a late panel from taking focus');
 // Catalog changes are real fixture transport writes, rather than a replacement callback.
 finish=await hold();let changed=(await req('/api/assets'));changed.value.assets.find(a=>a.id===asset.id).notes='给定后来编辑的说明';await req('/api/assets','PUT',changed.value,changed.tag);await f.evaluate(()=>loadAssets({redraw:false}));await finish();await noReview();assert.equal((await req('/api/assets')).value.assets.find(a=>a.id===asset.id).notes,'给定后来编辑的说明');pass('a newer library resource version is preserved before any comparison opens');await restore();await f.evaluate(()=>loadAssets({redraw:false}));
 finish=await hold();await p.evaluate(()=>whiteboardHosted.workspace='given-other-workspace');await finish();await noReview();await resetScope();pass('a changed observed shell workspace stops the pending comparison');
 finish=await hold();await f.evaluate(()=>whiteboardHosted.paused=true);await finish();await noReview();await resetScope();pass('a paused explorer scope stops the pending comparison');
 // Normal reading opens one owned review, whose choices survive temporary stop conditions.
 await preview();await update();await f.getByRole('heading',{name:'从来源白板更新组合',exact:true}).waitFor();const box=f.locator('[data-wf-change]');assert.equal(await box.count(),1);assert(await box.isChecked());
 assert((await f.locator('.wf-diffs').innerText()).includes(source.body));const sameBox=await box.elementHandle();
 const approve=()=>f.getByRole('button',{name:'应用勾选的修改',exact:true}).click();
 const refused=async(name,setup,reset)=>{await setup();const current=(await req('/api/assets')).value,sent=writes;await approve();await f.locator('.wf-review-status').waitFor();await f.waitForFunction(()=>!$('dialogActions').lastElementChild.disabled);assert.equal(writes,sent);assert.deepEqual((await req('/api/assets')).value,current);assert(await sameBox.evaluate(el=>el.isConnected&&el.checked&&!el.disabled));assert.equal(await f.evaluate(()=>$('dialog').open),true);await reset();pass(name)};
 await refused('blocked save state keeps the reviewed bundle and checked field without sending a write',()=>f.evaluate(()=>blocked=true),()=>f.evaluate(()=>blocked=false));
 await refused('paused parent scope keeps the review and sends no write',()=>p.evaluate(()=>whiteboardHosted.paused=true),()=>p.evaluate(()=>whiteboardHosted.paused=false));
 await refused('view-only explorer scope cannot apply a formerly editable review',()=>f.evaluate(()=>whiteboardHosted.role='viewer'),()=>f.evaluate(()=>whiteboardHosted.role='editor'));
 await refused('changed explorer account cannot apply the prior scope review',()=>f.evaluate(()=>whiteboardHosted.account.id='given-other-account'),()=>f.evaluate(()=>whiteboardHosted.account.id='given-account'));
 await p.screenshot({path:O+'/'+width+'-review-stopped.png'});
 changed=await req('/api/assets');changed.value.assets.find(a=>a.id===asset.id).notes='给定对照之后的编辑';await req('/api/assets','PUT',changed.value,changed.tag);await f.evaluate(()=>loadAssets({redraw:false}));
 await refused('a library edit made after review stays exact when the old update is refused',async()=>{},async()=>{await restore();await f.evaluate(()=>loadAssets({redraw:false}))});
 await approve();await f.waitForFunction(()=>!$('dialog').open);assert.equal(writes,1);const saved=(await req('/api/assets')).value,target=saved.assets.find(a=>a.id===asset.id);assert.deepEqual(target.bundle,{nodes:[source],edges:[]});assert.deepEqual({...target,bundle:asset.bundle,updated:asset.updated},asset);assert.deepEqual((await req('/api/boards/given-writing')).value.nodes,[writer]);pass('after resolving a stop, the same native review updates only the intended library bundle once and preserves the writer');
 // Actual server commit followed by a late acknowledgement must not be described as cancellation.
 if(width===1360){
  await restore();await f.evaluate(()=>loadAssets({redraw:false}));await preview();await update();await f.getByRole('heading',{name:'从来源白板更新组合',exact:true}).waitFor();
  let release,sent;const gate=new Promise(resolve=>release=resolve),committed=new Promise(resolve=>sent=resolve);releaseReads.push(release);let held=false;
  const handler=async route=>{if(route.request().method()!=='PUT'||held)return route.fallback();held=true;const response=await route.fetch();sent();await gate;await route.fulfill({response})};await c.route('**/api/assets',handler);
  await approve();await committed;assert.equal((await req('/api/assets')).value.assets.find(a=>a.id===asset.id).bundle.nodes[0].body,source.body);await p.evaluate(()=>whiteboardHosted.paused=true);release();await f.locator('.wf-review-status').filter({hasText:'原位置的更新请求已完成'}).waitFor();await f.waitForFunction(()=>!$('dialogActions').lastElementChild.disabled);assert.equal(writes,2);await c.unroute('**/api/assets',handler);await resetScope();await f.getByRole('button',{name:'取消',exact:true}).click();pass('one real committed update with a held acknowledgement is reported as completed at the original location after scope pause, without automatic retry');
 }
 await p.screenshot({path:O+'/'+width+'-library-updated.png'});await c.close();
 const fresh=await browser.newContext({viewport:{width,height:900}}),page=await fresh.newPage();page.on('pageerror',e=>proof.errors.push(e.message));await page.goto(base+'/?board=given-writing');await page.waitForFunction(()=>pane(current())?.state()?.boardId==='given-writing'&&!pane(current()).state().loading);await page.locator('#openBoards').click();const ff=await(await page.locator('#explorerFrame').elementHandle()).contentFrame();await ff.locator('#assetsButton').click();await ff.locator('[data-asset-preview=given-resource]').click();await ff.locator('#pieceList').filter({hasText:source.body}).waitFor();assert.equal((await req('/api/assets')).value.assets.find(a=>a.id===asset.id).bundle.nodes[0].body,source.body);await fresh.close();pass('a fresh browser reads back the updated native library preview and persisted bundle');
}
assert.deepEqual(proof.errors,[]);proof.guardCount=proof.cases.reduce((n,row)=>n+row.guards.length,0);proof.complete=true;
}catch(e){proof.failure=e.stack;save();throw e}finally{for(const release of releaseReads)release();if(browser)await browser.close();if(proc&&proc.exitCode===null)proc.kill();if(exit)proof.ownedServerExit=await exit;if(fd!==undefined)fs.closeSync(fd);if(base){let closed=false;for(let i=0;i<60;i++){try{await fetch(base+'/api/health',{signal:AbortSignal.timeout(200)})}catch{closed=true;break}await new Promise(r=>setTimeout(r,100))}proof.ownedPortClosed=closed;assert(closed)}save()}})().catch(e=>{console.error(e);process.exitCode=1});
