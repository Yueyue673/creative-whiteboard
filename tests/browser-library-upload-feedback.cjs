const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const {spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-library-upload-feedback-'));
 const port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});
 let browser;const releases=[];
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const original={format:'creative-board',version:1,name:'Library upload',nodes:[],edges:[],view:{x:0,y:0,z:1}};
  assert((await fetch(base+'/api/boards/library-upload',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(original)})).ok);
  const cat=await fetch(base+'/api/assets'),catalog=await cat.json();catalog.folders=['Incoming','Other','Replace'];catalog.folderIds={Incoming:'incoming-folder',Other:'other-folder',Replace:'replace-folder'};
  const from=process.env.LIBRARY_UPLOAD_FROM,resumed=['parallel','failure'].includes(from);
  if(resumed){catalog.folders=['Renamed','Other','Replace'];catalog.folderIds={Renamed:'incoming-folder',Other:'other-folder',Replace:'replace-folder'};}
  assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':cat.headers.get('ETag')},body:JSON.stringify(catalog)})).ok);
  if(resumed)for(const name of from==='failure'?['photomode_fixture.png']:['photomode_fixture.png','retry_fixture.png'])assert((await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':name,'X-Folder':'Renamed','X-Folder-Id':'incoming-folder'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')})).ok);
  const boardBytes=fs.readFileSync(path.join(tmp,'内容','library-upload.json'));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const page=await browser.newPage({viewport:{width:1400,height:850},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?board=library-upload');await page.waitForFunction(()=>pane(current())?.state().boardId==='library-upload');
  if(await page.locator('#globalExplorer').evaluate(el=>el.hidden))await page.locator('#openBoards').click();await page.waitForFunction(()=>whiteboardWorkspace.explorer());
  const library=page.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await library.waitForFunction(()=>board&&!loading);
  await library.locator('#assetsButton').click();await library.evaluate(async folder=>{await loadAssets();enterAssetFolder(folder)},resumed?'Renamed':'Incoming');
  const bytes=[...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')];
  async function hold(name,{folder,fail=false}={}){
   let release,arrived;const gate=new Promise(resolve=>release=resolve),arrival=new Promise(resolve=>arrived=resolve);releases.push(release);
   const handler=async route=>{const h=route.request().headers();if(decodeURIComponent(h['x-file-name'])!==name||(folder!==undefined&&decodeURIComponent(h['x-folder']||'')!==folder))return route.fallback();arrived();await gate;if(fail)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic destination upload unavailable'})});else await route.continue()};
   await page.route('**/api/assets/upload',handler);
   return {arrival,finish:async()=>{release();await library.waitForFunction(()=>!whiteboardImports.pending());await page.unroute('**/api/assets/upload',handler)},release,handler};
  }
  async function drop(name){const transfer=await library.evaluateHandle(({bytes,name})=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],name,{type:'image/png',lastModified:31}));return d},{bytes,name});await library.dispatchEvent('#assetList','drop',{dataTransfer:transfer});await transfer.dispose()}
  const row=library.locator('.library-import-row'),failed=library.locator('.library-import-row.is-failed');
  if(!resumed){
  const first=await hold('photomode_fixture.png');await drop('photomode_fixture.png');await first.arrival;
  await row.waitFor();assert((await row.innerText()).includes('photomode_fixture.png'));assert((await row.innerText()).includes('上传中'));
  assert(await library.locator('#importFeedback').isHidden());assert.equal(await library.locator('#assetList .explorer-empty').isVisible(),false);
  assert.equal(await library.evaluate(()=>assetIndex.assets.length),0);assert.equal(await library.evaluate(()=>assetSelected.size),0);
  await row.click();assert.equal(await library.evaluate(()=>assetSelected.size),0,'Pending rows are not selectable saved assets');
  await drop('photomode_fixture.png');assert.equal(await row.count(),1,'Matching pending selection keeps one upload row');
  await library.evaluate(()=>{window.pendingLibraryRow=document.querySelector('.library-import-row');renderAssets()});assert(await library.evaluate(()=>pendingLibraryRow===document.querySelector('.library-import-row')),'Catalog rendering retains the actual pending row');
  if(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR){fs.mkdirSync(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR,'pending-wide.png')})}
  await page.setViewportSize({width:390,height:650});
  await row.waitFor();const r=await row.boundingBox(),list=await library.locator('#assetList').boundingBox();assert(r.x>=list.x-1&&r.x+r.width<=list.x+list.width+1,'Pending upload fits the original narrow library');
  assert.equal(await row.locator('small').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
  if(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR,'pending-narrow.png')});
  await library.evaluate(()=>{const spacer=document.createElement('div');spacer.id='syntheticScrollSpace';spacer.style.height='900px';document.querySelector('#assetList').append(spacer);document.querySelector('#assetList').scrollTop=300});await library.locator('#importFeedback').waitFor();
  await library.evaluate(()=>{document.querySelector('#assetList').scrollTop=0;document.querySelector('#syntheticScrollSpace').remove()});await library.locator('#importFeedback').waitFor({state:'hidden'});
  await library.evaluate(()=>enterAssetFolder('Other'));assert.equal(await row.count(),0);assert(await library.locator('#importFeedback').isVisible());
  await library.evaluate(async()=>{await moveAssetFolder('Incoming','','Renamed');enterAssetFolder('Renamed')});await row.waitFor();assert.equal(await library.evaluate(()=>assetFolder),'Renamed');
  await first.finish();assert.equal(await row.count(),0);assert.equal(await library.locator('[data-asset]').count(),1);assert.equal(await library.evaluate(()=>assetIndex.assets[0].folder),'Renamed');assert(await library.locator('#importFeedback').isHidden());
  console.log('Library upload context: immediate narrow/wide row, quiet repeat, render identity, navigation and original-folder rename passed');
  if(from==='context'){assert.deepEqual(fs.readFileSync(path.join(tmp,'内容','library-upload.json')),boardBytes);assert.deepEqual(errors,[]);console.log('Focused pending-row scroll fallback delta passed; original board exact');return;}
  }

  if(from!=='parallel'){
  if(from==='failure')await page.setViewportSize({width:390,height:650});
  const failure=await hold('retry_fixture.png',{fail:true});await drop('retry_fixture.png');await failure.arrival;await failure.finish();
  await failed.waitFor();assert((await failed.innerText()).includes('Synthetic destination upload unavailable'));assert(await library.locator('#importFeedback').isHidden());
  assert(await library.locator('#toast').evaluate(el=>el.hidden||el.textContent!=='Synthetic destination upload unavailable'),'A contextual upload failure does not also open an identical toast');
  const close=failed.getByRole('button',{name:'关闭上传提示'}),closeBox=await close.boundingBox(),failedBox=await failed.boundingBox();assert(closeBox.x+closeBox.width<=failedBox.x+failedBox.width+1);
  if(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.LIBRARY_UPLOAD_EVIDENCE_DIR,'failure-narrow.png')});
  await library.evaluate(()=>{window.originalUploadDocument=boardId;boardId='another-library-document'});const retry=await hold('retry_fixture.png');await drop('retry_fixture.png');await retry.arrival;await library.evaluate(()=>boardId=originalUploadDocument);assert.equal(await library.locator('.library-import-row').count(),1,'Folder upload retry is independent of the hidden explorer document identity');assert.equal(await failed.count(),0,'Retry removes only the corresponding obsolete failure');
  await library.locator('#assetSearch').fill('not-the-upload');assert.equal(await row.count(),0);assert(await library.locator('#importFeedback').isVisible());await library.locator('#assetSearch').fill('');await row.waitFor();await retry.finish();assert.equal(await library.locator('[data-asset]').count(),2);
  console.log('Library upload failure: reason and close fit narrow layout; retry and search retain correct scope');
  const clipboard=await hold('clipboard_failure.png',{fail:true});await library.evaluate(bytes=>{window.clipboardUpload=whiteboardLibraryClipboard.paste('',[new File([new Uint8Array(bytes)],'clipboard_failure.png',{type:'image/png',lastModified:44})])},bytes);await clipboard.arrival;await clipboard.finish();await library.evaluate(()=>clipboardUpload);await failed.waitFor();assert((await failed.innerText()).includes('Synthetic destination upload unavailable'));await failed.getByRole('button',{name:'关闭上传提示'}).click();assert(await library.locator('#importFeedback').isHidden());
  if(from==='failure'){assert.deepEqual(fs.readFileSync(path.join(tmp,'内容','library-upload.json')),boardBytes);assert.deepEqual(errors,[]);console.log('Focused drop/clipboard contextual-error delta passed; original board exact');return;}
  }

  const left=await hold('parallel_fixture.png',{folder:'Renamed',fail:true}),right=await hold('parallel_fixture.png',{folder:'Other'});
  await library.evaluate(({bytes})=>{const file=()=>new File([new Uint8Array(bytes)],'parallel_fixture.png',{type:'image/png',lastModified:31});window.leftUpload=uploadFiles([file()],'Renamed').catch(e=>e.message);window.rightUpload=uploadFiles([file()],'Other')},{bytes});
  await Promise.all([left.arrival,right.arrival]);left.release();await library.evaluate(()=>leftUpload);await library.evaluate(()=>enterAssetFolder('Other'));const visibleRow=library.locator('.library-import-row:visible');await visibleRow.waitFor();assert.equal(await visibleRow.locator('small').innerText(),'上传中','A failure at another folder does not mark this upload failed');assert(!await visibleRow.evaluate(el=>el.classList.contains('is-failed')));
  right.release();await library.evaluate(()=>rightUpload);await library.waitForFunction(()=>!whiteboardImports.pending());await page.unroute('**/api/assets/upload',left.handler);await page.unroute('**/api/assets/upload',right.handler);
  await library.evaluate(()=>enterAssetFolder('Renamed'));await failed.waitFor();await failed.getByRole('button',{name:'关闭上传提示'}).click();assert.equal(await row.count(),0);assert(await library.locator('#importFeedback').isHidden());
  console.log('Parallel upload destinations keep separate progress and failure; dismissal clears only temporary UI');

  await library.evaluate(()=>enterAssetFolder('Replace'));const replaced=await hold('replaced_fixture.png');await drop('replaced_fixture.png');await replaced.arrival;
  const response=await fetch(base+'/api/assets'),changed=await response.json();changed.folderIds.Replace='new-replacement-folder';assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':response.headers.get('ETag')},body:JSON.stringify(changed)})).ok);
  await library.evaluate(()=>loadAssets());assert.equal(await row.count(),0,'New folder at the same path does not inherit the pending preview');assert(await library.locator('#importFeedback').isVisible());
  await replaced.finish();assert.equal(await library.evaluate(()=>assetIndex.assets.find(a=>a.title==='replaced_fixture.png').folder),'');assert.equal(await row.count(),0);
  const finalCatalog=await(await fetch(base+'/api/assets')).json();assert.equal(finalCatalog.assets.length,4);assert(!JSON.stringify(finalCatalog).includes('library-import'));
  assert.deepEqual(fs.readFileSync(path.join(tmp,'内容','library-upload.json')),boardBytes);assert.deepEqual(errors,[]);
  console.log('Folder identity replacement and final exact board/catalog audit passed; only four expected uploaded originals');
 }finally{releases.forEach(release=>release());if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
