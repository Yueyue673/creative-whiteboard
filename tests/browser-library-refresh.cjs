const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert');
const {spawn}=require('child_process'),{chromium}=require('playwright');

(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-library-refresh-'));
 const port=await require('./browser-port.cjs')();
 const base='http://127.0.0.1:'+port,proc=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{
  windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});
 let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  let response=await fetch(base+'/api/assets'),catalog=await response.json();
  catalog.folders=['草稿','参考'];catalog.folderIds={'草稿':'draft-folder','参考':'reference-folder'};
  catalog.assets=[{id:'observation',title:'作者的观察',notes:'作者自己写下的内容。',path:'',folder:'草稿',mime:'text/plain',size:0,tags:[]}];
  assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':response.headers.get('ETag')},body:JSON.stringify(catalog)})).ok);
  assert((await fetch(base+'/api/boards/work',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:'连续整理',nodes:[],edges:[],view:{x:0,y:0,z:1}})})).ok);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/index.html?board=work');
  await page.waitForFunction(()=>boardId==='work'&&!loading&&assetIndex.folderIds?.['草稿']);
  await page.evaluate(()=>showWorkspaceTab('assetPane'));
  async function serverEdit(edit){
   const r=await fetch(base+'/api/assets'),next=await r.json();edit(next);
   const saved=await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':r.headers.get('ETag')},body:JSON.stringify(next)});
   assert(saved.ok);return saved.headers.get('ETag');
  }
  async function holdRead(fail=false){
   let release,arrive,used=false;const arrived=new Promise(resolve=>arrive=resolve);
   const handler=async route=>{
    if(route.request().method()!=='GET'||used)return route.continue();used=true;
    const result=await route.fetch();await new Promise(resolve=>{release=resolve;arrive()});
    if(fail)await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'较早的读取失败'})});
    else await route.fulfill({response:result});
   };
   await page.route('**/api/assets',handler);
   await page.evaluate(()=>{window.delayedRead=loadAssets().then(()=>({ok:true}),error=>({ok:false,error:error.message}))});
   await Promise.race([arrived,page.evaluate(()=>delayedRead).then(result=>{throw Error(result.error||'Expected a held catalog response')})]);
   return async()=>{release();const result=await page.evaluate(()=>delayedRead);await page.unroute('**/api/assets',handler);return result};
  }
  // A slow response contains the old path and ETag, even though the author has saved a rename.
  const finishOld=await holdRead();
  await page.evaluate(async()=>{enterAssetFolder('草稿');await moveAssetFolder('草稿','','片段');assetSelected=new Set(['observation']);renderAssets()});
  const savedTag=await page.evaluate(()=>assetETag);assert((await finishOld()).ok);
  assert.equal(await page.evaluate(()=>assetFolder),'片段','A stale read must not return the current folder to its old name');
  assert.equal(await page.evaluate(()=>assetById('observation').folder),'片段');
  assert.equal(await page.evaluate(()=>assetETag),savedTag,'A stale read must not restore an obsolete save revision');
  assert.deepEqual(await page.evaluate(()=>[...assetSelected]),['observation']);
  await page.evaluate(()=>wfUndoLibrary());assert.equal(await page.evaluate(()=>assetById('observation').folder),'草稿');
  await page.evaluate(()=>wfRedoLibrary());assert.equal(await page.evaluate(()=>assetById('observation').folder),'片段');

  // Two refreshes finish in reverse order. Every caller waits for the newer state.
  const finishFirst=await holdRead();
  const latestTag=await serverEdit(next=>next.assets[0].notes='作者后来补充的观察。');
  await page.evaluate(()=>loadAssets());assert((await finishFirst()).ok);
  assert.equal(await page.evaluate(()=>assetById('observation').notes),'作者后来补充的观察。');
  assert.equal(await page.evaluate(()=>assetETag),latestTag);
  // The failure of a superseded read is irrelevant after a successful newer read.
  const finishFailed=await holdRead(true);
  await serverEdit(next=>next.assets[0].notes='另一条由作者补充的观察。');
  await page.evaluate(()=>loadAssets());assert((await finishFailed()).ok,'An obsolete request failure must not replace a current successful refresh');

  // A genuinely current failure remains visible and keeps the last usable catalog.
  const retained=await page.evaluate(()=>({catalog:clone(assetIndex),etag:assetETag,folder:assetFolder}));
  const finishCurrentFailure=await holdRead(true);
  assert.deepEqual(await finishCurrentFailure(),{ok:false,error:'较早的读取失败'});
  assert.deepEqual(await page.evaluate(()=>({catalog:clone(assetIndex),etag:assetETag,folder:assetFolder})),retained);

  // An older caller cannot continue with old data while a newer refresh is still waiting.
  let releaseEarlier,releaseLatest,arriveEarlier,arriveLatest,reads=0;
  const earlierArrived=new Promise(resolve=>arriveEarlier=resolve),latestArrived=new Promise(resolve=>arriveLatest=resolve);
  const orderedHandler=async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const number=++reads,response=await route.fetch();
   await new Promise(resolve=>{if(number===1){releaseEarlier=resolve;arriveEarlier()}else {releaseLatest=resolve;arriveLatest()}});
   await route.fulfill({response});
  };
  await page.route('**/api/assets',orderedHandler);
  await page.evaluate(()=>{window.earlierSettled=false;window.earlierLoad=loadAssets().then(()=>{earlierSettled=true;return assetById('observation').notes})});
  await earlierArrived;await serverEdit(next=>next.assets[0].notes='等待新读取后才能继续使用。');
  await page.evaluate(()=>{window.latestLoad=loadAssets()});await latestArrived;releaseEarlier();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,80)));
  assert.equal(await page.evaluate(()=>earlierSettled),false);
  releaseLatest();assert.equal(await page.evaluate(()=>earlierLoad),'等待新读取后才能继续使用。');
  await page.evaluate(()=>latestLoad);await page.unroute('**/api/assets',orderedHandler);

  // Refreshing during a save waits for the save, rather than fetching its predecessor.
  let releaseWrite,arriveWrite,held=false,readCount=0;
  const writeArrived=new Promise(resolve=>arriveWrite=resolve);
  const writeHandler=async route=>{
   if(route.request().method()==='GET')readCount++;
   if(route.request().method()==='PUT'&&!held){held=true;await new Promise(resolve=>{releaseWrite=resolve;arriveWrite()})}
   await route.continue();
  };
  await page.route('**/api/assets',writeHandler);
  await page.evaluate(()=>{const next=clone(assetIndex);next.assets[0].notes='保存期间继续整理。';window.delayedSave=saveAssets(next)});
  await writeArrived;
  await page.evaluate(()=>{window.readDuringSave=loadAssets()});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,80)));
  assert.equal(readCount,0,'A refresh must wait for an in-flight save');
  releaseWrite();assert(await page.evaluate(()=>delayedSave));await page.evaluate(()=>readDuringSave);
  assert.equal(await page.evaluate(()=>assetById('observation').notes),'保存期间继续整理。');
  await page.unroute('**/api/assets',writeHandler);

  // Two drafts based on one revision cannot silently overwrite each other.
  let releaseFirstSave,arriveFirstSave,firstHeld=false;
  const firstSaveArrived=new Promise(resolve=>arriveFirstSave=resolve);
  const concurrentHandler=async route=>{
   if(route.request().method()==='PUT'&&!firstHeld){firstHeld=true;await new Promise(resolve=>{releaseFirstSave=resolve;arriveFirstSave()})}
   await route.continue();
  };
  await page.route('**/api/assets',concurrentHandler);
  await page.evaluate(()=>{const first=clone(assetIndex);first.assets[0].notes='先发出的草稿。';window.firstSave=saveAssets(first)});
  await firstSaveArrived;
  assert(await page.evaluate(()=>{const second=clone(assetIndex);second.assets[0].notes='已成功保存的另一份草稿。';return saveAssets(second)}));
  await page.evaluate(()=>{window.readAfterBoth=loadAssets()});releaseFirstSave();
  assert.equal(await page.evaluate(()=>firstSave),false,'A stale draft must keep its original revision precondition');
  await page.evaluate(()=>readAfterBoth);
  assert.equal(await page.evaluate(()=>assetById('observation').notes),'已成功保存的另一份草稿。');
  assert.equal((await (await fetch(base+'/api/assets')).json()).assets[0].notes,'已成功保存的另一份草稿。');
  await page.unroute('**/api/assets',concurrentHandler);

  // A genuine cross-window conflict remains a conflict; the author draft stays in its dialog.
  const untouched=fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8');
  await page.evaluate(()=>editAsset('observation'));await page.locator('#assetNotes').fill('尚未保存的作者文字。');
  await serverEdit(next=>next.assets[0].notes='其他窗口保存的文字。');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('dialog').open&&document.getElementById('toast').textContent);
  assert.equal(await page.locator('#assetNotes').inputValue(),'尚未保存的作者文字。');
  assert.equal((await (await fetch(base+'/api/assets')).json()).assets[0].notes,'其他窗口保存的文字。');
  assert.notEqual(fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8'),untouched);
  await page.evaluate(()=>loadAssets());assert.equal(await page.locator('#assetNotes').inputValue(),'尚未保存的作者文字。');
  await page.keyboard.press('Escape');
  const final=fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8');
  await page.reload();await page.waitForFunction(()=>boardId==='work'&&!loading&&assetById('observation')?.notes==='其他窗口保存的文字。');
  assert.equal(fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8'),final,'Refreshing and reopening never rewrite the author catalog');
  assert.deepEqual(errors,[]);
  console.log('Library refresh continuity: saved renames, undo/redo, reverse response order, current and obsolete failures, waiting callers, reads during saves, concurrent drafts, conflict dialogs and read-only reopening passed');
 }finally{
  if(browser)await browser.close();proc.kill();await new Promise(resolve=>proc.once('exit',resolve));
  const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
