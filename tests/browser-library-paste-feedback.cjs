const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),{spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-library-paste-feedback-'));
 const port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;const releases=[];
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const original={format:'creative-board',version:1,name:'Paste feedback',nodes:[],edges:[],view:{x:19,y:31,z:1.1}};
  assert((await fetch(base+'/api/boards/paste-feedback',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(original)})).ok);
  const cat=await fetch(base+'/api/assets'),catalog=await cat.json();catalog.folders=['Incoming','Other'];catalog.folderIds={Incoming:'paste-folder',Other:'other-folder'};assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':cat.headers.get('ETag')},body:JSON.stringify(catalog)})).ok);
  const boardBytes=fs.readFileSync(path.join(tmp,'内容','paste-feedback.json'));browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const p=await browser.newPage({viewport:{width:390,height:650},reducedMotion:'reduce'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/?board=paste-feedback');await p.waitForFunction(()=>pane(current())?.state().boardId==='paste-feedback');if(await p.locator('#globalExplorer').evaluate(el=>el.hidden))await p.locator('#openBoards').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());const l=p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await l.waitForFunction(()=>board&&!loading);await l.locator('#assetsButton').click();await l.evaluate(async()=>{await loadAssets();enterAssetFolder('Incoming')});
  const rows=l.locator('.library-import-row:visible');
  async function menu(){await l.locator('#assetList').click({button:'right'});await l.locator('#fileContext button').filter({hasText:/^粘贴/}).click()}
  async function finish(){await l.waitForFunction(()=>!whiteboardImports.pending())}
  async function evidence(name){if(process.env.LIBRARY_PASTE_EVIDENCE_DIR){fs.mkdirSync(process.env.LIBRARY_PASTE_EVIDENCE_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.LIBRARY_PASTE_EVIDENCE_DIR,name+'.png')})}}
  const from=process.env.LIBRARY_PASTE_FROM;
  if(!from){
   await l.evaluate(()=>{window.reads=0;navigator.clipboard.readText=()=>{reads++;return new Promise(resolve=>window.releaseRead=()=>resolve('A supplied synthetic line.\nSecond line.'))}});
   let releaseCatalog,arrived;const catalogGate=new Promise(r=>releaseCatalog=r),arrival=new Promise(r=>arrived=r);releases.push(releaseCatalog);
   const handler=async route=>{if(route.request().method()!=='GET'||route.request().frame()!==l)return route.fallback();arrived();await catalogGate;await route.continue()};
   await menu();await l.waitForFunction(()=>!!window.releaseRead);await rows.waitFor();assert.equal(await rows.locator('b').innerText(),'剪贴板');assert.equal(await rows.locator('small').innerText(),'读取中');assert(await l.locator('#importFeedback').isHidden());assert.equal(await l.locator('#assetList .explorer-empty').isVisible(),false);
   const r=await rows.boundingBox(),list=await l.locator('#assetList').boundingBox();assert(r.x>=list.x-1&&r.x+r.width<=list.x+list.width+1);await evidence('clipboard-narrow');
   await menu();assert.equal(await l.evaluate(()=>reads),1,'Repeated menu paste reserves one operation before reading the clipboard');assert.equal(await rows.count(),1);
   await l.evaluate(()=>{window.readRow=document.querySelector('.library-import-row');renderAssets();enterAssetFolder('Other')});assert.equal(await rows.count(),0);assert(await l.locator('#importFeedback').isVisible());
   await l.evaluate(async()=>{await moveAssetFolder('Incoming','','Renamed');enterAssetFolder('Renamed')});assert(await l.evaluate(()=>readRow===document.querySelector('.library-import-row')));
   await p.route('**/api/assets',handler);await l.evaluate(()=>releaseRead());await arrival;assert.equal(await rows.locator('small').innerText(),'读取中');assert.equal(await l.evaluate(()=>assetIndex.assets.length),0);await evidence('catalog-narrow');
   releaseCatalog();await finish();await p.unroute('**/api/assets',handler);assert.equal(await rows.count(),0);assert.equal(await l.evaluate(()=>assetIndex.assets.length),1);assert.equal(await l.evaluate(()=>assetIndex.assets[0].folder),'Renamed');assert.equal(await l.evaluate(()=>assetIndex.assets[0].bundle.nodes[0].body),'A supplied synthetic line.\nSecond line.');
   console.log('Library paste: immediate read/catalog feedback, quiet repeat, narrow fit and original renamed destination passed');
  }
  if(from!=='failure'&&from!=='queue'&&from!=='policy'){
   await l.evaluate(()=>{enterAssetFolder('Other');navigator.clipboard.readText=async()=>'';navigator.clipboard.read=async()=>[{types:['image/png'],getType:()=>new Promise(resolve=>window.releaseType=()=>resolve(new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'})))}]});
   let release,arrived;const gate=new Promise(r=>release=r),arrival=new Promise(r=>arrived=r);releases.push(release);
   const handler=async route=>{arrived();await gate;await route.continue()};await p.route('**/api/assets/upload',handler);await menu();await l.waitForFunction(()=>!!window.releaseType);await rows.waitFor();assert.equal(await rows.locator('small').innerText(),'读取中');
   await l.evaluate(()=>{window.imageReadRow=document.querySelector('.library-import-row');releaseType()});await arrival;assert.equal(await rows.count(),1);assert(await l.evaluate(()=>imageReadRow===document.querySelector('.library-import-row')),'Uploading replaces the same clipboard row');assert.equal(await rows.locator('small').innerText(),'上传中');assert.equal(await rows.locator('b').innerText(),'粘贴图片.png');await p.setViewportSize({width:1400,height:850});await evidence('image-handoff-wide');release();await finish();await p.unroute('**/api/assets/upload',handler);assert.equal(await rows.count(),0);assert(await l.evaluate(()=>assetIndex.assets.some(a=>a.title==='粘贴图片.png'&&a.folder==='Other')));
   console.log('Library image paste: getType wait and upload reuse one original row; successful file keeps captured destination');
  }
  if(from!=='queue'&&from!=='policy'){
  await l.evaluate(()=>{enterAssetFolder('Other');window.savedLoadForPaste=loadAssets;loadAssets=()=>new Promise((resolve,reject)=>window.failCatalog=()=>reject(Error('Synthetic catalog unavailable')));window.failedPaste=whiteboardLibraryClipboard.paste('Synthetic failure source').catch(e=>e.message)});await l.waitForFunction(()=>!!window.failCatalog);await rows.waitFor();await l.evaluate(async()=>{failCatalog();if(await failedPaste!=='Synthetic catalog unavailable')throw Error('Original rejection contract changed');loadAssets=savedLoadForPaste});await finish();assert(await rows.evaluate(el=>el.classList.contains('is-failed')));assert((await rows.innerText()).includes('Synthetic catalog unavailable'));assert(await l.locator('#toast').evaluate(el=>el.hidden||el.textContent!=='Synthetic catalog unavailable'));await rows.getByRole('button',{name:'关闭粘贴提示'}).click();assert.equal(await rows.count(),0);
  await l.evaluate(()=>{navigator.clipboard.readText=async()=>'';navigator.clipboard.read=async()=>[]});await menu();await finish();assert.equal(await rows.count(),0,'Empty clipboard leaves no phantom pending row');
  await l.evaluate(()=>{navigator.clipboard.readText=async()=>{throw Error('Synthetic permission denied')}});await menu();await finish();assert.equal(await rows.count(),0);assert((await l.locator('#toast').innerText()).includes('Ctrl+V'));
  }
  if(from!=='policy'){
  // The shared coordinator's native writer belongs to the application window.
  await p.evaluate(()=>{navigator.clipboard.writeText=()=>new Promise(resolve=>window.releaseWrite=resolve)});
  await l.evaluate(()=>{navigator.clipboard.readText=async()=>'';navigator.clipboard.read=async()=>[];whiteboardClipboardCoordinator.write(null,'Synthetic queued copy')});await p.waitForFunction(()=>!!window.releaseWrite);await menu();await rows.waitFor();assert.equal(await rows.locator('small').innerText(),'读取中');await p.evaluate(()=>releaseWrite());await finish();assert.equal(await rows.count(),0);
  }
  await l.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain',JSON.stringify({format:'creative-board-proposal',changes:[{after:'Synthetic rejected proposal'}]}));document.querySelector('#assetPane').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}))});await l.waitForFunction(()=>document.querySelector('#toast').textContent.includes('不能修改'));await finish();assert.equal(await rows.count(),0);assert(await l.locator('#importFeedback').isHidden(),'Forwarding references and blocked proposals retains the original presentation');
  assert.deepEqual(fs.readFileSync(path.join(tmp,'内容','paste-feedback.json')),boardBytes);assert.deepEqual(errors,[]);const final=await(await fetch(base+'/api/assets')).json();assert(!JSON.stringify(final).includes('library-import'));assert(!JSON.stringify(final).includes('Synthetic failure source'));
  console.log('Library paste: contextual catalog failure, dismiss, empty/denied clipboard and queued-copy cleanup passed; board bytes exact');
 }finally{releases.forEach(r=>r());if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
