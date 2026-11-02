const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.MISSING_ATTACHMENT_REFERENCE_PROOF||path.join(os.tmpdir(),'whiteboard-missing-attachment-'+crypto.randomUUID()),PY=process.env.PYTHON||'python';
assert(!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),proof={at:new Date().toISOString(),complete:false,syntheticOnly:true,moduleOverrides:false,DOMOverrides:false,physicalDeviceTested:false,defaultVariablesOmitted:Object.fromEntries(['PYTHON','GIT_EXE','CREATIVE_BOARD_TEST_ROOT'].map(k=>[k,!process.env[k]])),cases:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(O,'result.json'),JSON.stringify(proof,null,2));
let server,serverExit,browser,fd,port;
const timeout=setTimeout(()=>{server?.kill();browser?.close().catch(()=>{})},180000);
function wav(){const b=Buffer.alloc(44+16000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b}
(async()=>{try{
 proof.taskSHA256=hash(fs.readFileSync(__filename));proof.runtimeFiles={};
 for(const name of ['recovery.js','cells.js','appearance.js','document-paper.js','document-paper.css','note-editor.js','note-editor.css','refinement.js','refinement.css','workflow.js','workflow.css','pane.js','workspace.js','workspace.css','workspace-shell.js','workspace-shell.css','shell.js','shell.css','index.html','navigation.js','library-copies.js','canvas-objects.js','canvas-objects.css','theme.js','theme.css','library-spatial.js','library-spatial.css','library-folders.js','shell.html','board-lifecycle.js','media-markers.js','media-controls.js','library-editing.js','experience.js'])proof.runtimeFiles[name]=hash(fs.readFileSync(path.join(R,name)));
 const data=path.join(O,'given-data'),hooks=path.join(O,'hooks');fs.mkdirSync(data);
 execFileSync(PY,[path.join(R,'tests/local_start_fixture.py'),'--write-hooks',hooks],{windowsHide:true});
 port=await require(path.join(R,'tests/browser-port.cjs'))();const base='http://127.0.0.1:'+port;
 const env={...process.env,CREATIVE_BOARD_DATA_DIR:data,CREATIVE_BOARD_PORT:String(port),PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',START_FIXTURE_DATA_DENIED:'0',START_FIXTURE_LIFETIME:'240'};
 delete env.PYTHONHOME;for(const k of Object.keys(env))if(k.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[k];
 fd=fs.openSync(path.join(O,'server.log'),'w');server=spawn(PY,[path.join(R,'server.py')],{cwd:R,env,windowsHide:true,stdio:['ignore',fd,fd]});serverExit=new Promise((resolve,reject)=>{server.once('exit',(code,signal)=>resolve({code,signal}));server.once('error',reject)});proof.ownedServer={pid:server.pid,port,data};save();
 let ready=false;proof.startupObservations=[];for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break}if(proof.startupObservations.length<5)proof.startupObservations.push({status:r.status})}catch(e){if(proof.startupObservations.length<5)proof.startupObservations.push({error:e.message,cause:e.cause?.message,code:e.cause?.code})}await new Promise(r=>setTimeout(r,70))}assert(ready,'Owned synthetic service ready: '+JSON.stringify(proof.startupObservations));
 for(const[name,h]of Object.entries(proof.runtimeFiles)){const r=await fetch(base+(name==='shell.html'?'/':'/'+name));assert(r.ok);assert.equal(hash(Buffer.from(await r.arrayBuffer())),h)}proof.servedRuntimeExact=true;save();
 const req=async(route,method='GET',value,tag)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});assert(r.ok,route+' '+r.status);return{value:await r.json(),tag:r.headers.get('etag')}};
 const upload=async(name,bytes)=>{const r=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':name},body:bytes});assert(r.ok);return r.json()};
 const txt=await upload('given-readable.txt',Buffer.from('Given original file text.')),audio=await upload('given-readable.wav',wav());
 const catalog=(await req('/api/assets')).value;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 for(const width of [1360,320]){
  const id='given-attachment-'+width,source='Z:\\Given source\\<img src=x onerror="window.givenUnexpected=true"> & sound.wav';
  const item=(id,title,extra={})=>({id,type:'note',title,body:'Given original description '+id,userText:'Given author addition',annotation:'Given separate annotation',tags:['given'],x:0,y:0,w:300,h:420,sizeMode:'manual',givenOpaque:{keep:true},...extra});
  const nodes=[item('given-audio','Given original audio',{assetId:'given-missing-audio',mediaId:'given-missing-audio',url:source}),
   item('given-file','Given original file',{x:350,assetId:'given-missing-file',url:'Z:\\Given source\\given-original.pdf'}),
   item('given-web','Given web source',{x:700,assetId:'given-missing-web',url:'https://example.invalid/given-original'}),
   item('given-valid','Given readable file',{y:480,assetId:txt.id,url:txt.path}),item('given-plain','Given plain note',{x:350,y:480}),
   item('given-image','Given image reference',{x:700,y:480,assetId:'given-missing-image',images:[{assetId:'given-missing-image',name:'Given original image'}]})];
  const edges=[{id:'given-relation',from:'given-audio',to:'given-file',label:'Given internal relation'}];
  await req('/api/boards/'+id,'PUT',{format:'creative-board',version:1,name:'Given attachments '+width,nodes,edges,view:{x:0,y:0,z:1}},'new');
  const stored=await req('/api/boards/'+id),context=await browser.newContext({viewport:{width,height:900}});context.setDefaultTimeout(12000);
  await context.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  let catalogUnavailable=true;await context.route('**/api/assets',route=>route.request().method()==='GET'&&catalogUnavailable?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Given catalog unavailable'})}):route.fallback());
  const catalogWrites=[];context.on('request',r=>{if(new URL(r.url()).pathname==='/api/assets'&&!['GET','HEAD'].includes(r.method()))catalogWrites.push(r.method())});
  const row={width,phase:'unknown-catalog',checks:[]};proof.cases.push(row);const pass=name=>{row.checks.push({name,passed:true});save()};
  const page=await context.newPage();page.on('pageerror',e=>{proof.errors.push(e.message);save()});
  let frame;
  const open=async()=>{await page.goto(base+'/?board='+id);await page.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);frame=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame()};
  const sameAuthor=async()=>{const disk=(await req('/api/boards/'+id)).value;assert.deepEqual(disk.nodes,stored.value.nodes);assert.deepEqual(disk.edges,stored.value.edges);assert.deepEqual(await frame.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)})),{nodes:stored.value.nodes,edges:stored.value.edges});assert.deepEqual(catalogWrites,[])};
  try{
   await open();await frame.waitForFunction(()=>assetReadState==='failed');assert.equal(await frame.locator('.attachment-unavailable').count(),0);await sameAuthor();pass('Unavailable catalog remains a read failure; no false missing-file state or authored changes');
   catalogUnavailable=false;await page.reload();await page.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);frame=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await frame.waitForFunction(()=>assetCatalogReady&&assetReadState==='ready');
   row.phase='missing-reference-feedback';await page.screenshot({path:path.join(O,'missing-'+width+'.png')});save();
   assert.equal(await frame.locator('.attachment-unavailable').count(),3);
   const missing=frame.locator('.node[data-id="given-audio"] .attachment-unavailable');assert((await missing.textContent()).includes(source));assert.equal(await missing.locator('img,script,a,button').count(),0);assert.equal(await missing.evaluate(el=>getComputedStyle(el).userSelect),'text');assert.equal(await frame.evaluate(()=>typeof window.givenUnexpected),'undefined');pass('Absent audio/non-image references stay visible and the original source is literal selectable text');
   assert.equal(await frame.locator('.node[data-id="given-web"] [data-file-link]').getAttribute('href'),'https://example.invalid/given-original');assert.equal(await frame.locator('.node[data-id="given-valid"] .attachment-unavailable,.node[data-id="given-plain"] .attachment-unavailable,.node[data-id="given-image"] .attachment-unavailable').count(),0);assert(await frame.locator('.node[data-id="given-valid"] [data-file-link]').count());pass('Existing web source, readable file, plain note and image handling keep their original paths');
   await sameAuthor();assert.deepEqual((await req('/api/assets')).value,catalog);pass('Missing-reference rendering makes no catalog write and preserves authored data and internal relation');
   const current=await req('/api/assets');await req('/api/assets','PUT',{...current.value,assets:[...current.value.assets,{...audio,id:'given-missing-audio'},{...txt,id:'given-missing-file'},{...txt,id:'given-missing-web'}]},current.tag);
   row.phase='catalog-available-again';await page.reload();await page.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);frame=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await frame.waitForFunction(()=>assetCatalogReady&&assetReadState==='ready');assert.equal(await frame.locator('.attachment-unavailable').count(),0);await frame.waitForFunction(()=>document.querySelector('.node[data-id="given-audio"] audio')?.readyState>=1);await sameAuthor();pass('A fresh native load resumes the original audio/file when its referenced catalog record becomes available; no IDs are rebound');
   await page.screenshot({path:path.join(O,'resolved-'+width+'.png')});row.phase='complete';save();
  }catch(error){row.failure=String(error);proof.errors.push('width'+width+': '+error+'\n'+error.stack);save()}
  finally{await context.close();const current=await req('/api/assets');await req('/api/assets','PUT',catalog,current.tag)}
 }
 assert.deepEqual(proof.errors,[]);proof.complete=true;
}catch(error){proof.errors.push(String(error)+'\n'+error.stack);process.exitCode=1}
finally{
 clearTimeout(timeout);if(browser){await browser.close();proof.ownedBrowserStopped=true}
 if(server){server.kill();proof.ownedServer.exit=await serverExit;fs.closeSync(fd);proof.ownedServer.portClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('error',()=>resolve(true));socket.once('connect',()=>{socket.destroy();resolve(false)})});proof.ownedServicesStopped=proof.ownedServer.portClosed}
 proof.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({complete:proof.complete,cases:proof.cases.map(x=>({width:x.width,phase:x.phase,checks:x.checks.length})),errors:proof.errors,ownedServicesStopped:proof.ownedServicesStopped}));
}})();
