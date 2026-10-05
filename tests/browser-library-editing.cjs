const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert');
const {spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-library-editing-'));
 const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port))})});
 const base='http://127.0.0.1:'+port,proc=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});
 let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  const bytes=Buffer.from('original shared reference'),uploaded=await (await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':'observation.txt'},body:bytes})).json();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const context=await browser.newContext({viewport:{width:1450,height:980}}),page=await context.newPage(),other=await context.newPage(),errors=[];
  for(const p of [page,other])p.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/index.html');await page.waitForFunction(()=>board&&!loading&&assetIndex.assets.length===1);
  await page.evaluate(async uploaded=>{
   const next=clone(assetIndex);next.folders=['观察','片段'];next.folderIds={'观察':'observations','片段':'fragments'};
   Object.assign(next.assets.find(a=>a.id===uploaded.id),{title:'文件记录',notes:'原始备注。',folder:'观察'});
   next.assets.push({id:'authored',title:'作者的原文',path:'',folder:'观察',mime:bundleMime,size:0,notes:'',tags:[],bundle:{nodes:[
    {id:'first',type:'note',title:'第一块',body:'原始内容。',annotation:'原始补充。',x:80,y:90,w:360,h:180,sizeMode:'manual',tags:[],mediaId:uploaded.id},
    {id:'table',type:'table',title:'表格记录',body:'原始说明。',x:600,y:90,w:550,h:240,columns:['记录'],columnIds:['column'],rows:[['原始格子。']],rowIds:['row'],cellImages:[],cellItems:[],tags:[]}
   ],edges:[{id:'link',from:'first',to:'table',label:'原本的联系'}]}});
   await saveAssets(next);await showWorkspaceTab('assetPane');enterAssetFolder('观察');
  },uploaded);
  await other.goto(base+'/index.html');await other.waitForFunction(()=>board&&!loading&&assetById('authored'));
  const current=()=>fetch(base+'/api/assets').then(r=>r.json());
  async function remote(edit){const r=await fetch(base+'/api/assets'),next=await r.json();edit(next);const saved=await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':r.headers.get('ETag')},body:JSON.stringify(next)});assert(saved.ok)}
  async function save(name='保存到内容库',settle=true){await page.getByRole('button',{name,exact:true}).click();if(settle)await page.waitForFunction(name=>!document.getElementById('dialog').open||[...document.getElementById('dialogActions').querySelectorAll('button')].some(button=>button.textContent===name&&!button.disabled),name)}
  // Refreshing the catalog must not give an old editor permission to overwrite new words.
  await page.evaluate(id=>editAsset(id),uploaded.id);await page.locator('#assetNotes').fill('我在这里写的备注。');
  await remote(next=>{const a=next.assets.find(a=>a.id===uploaded.id);a.notes='另一窗口的新备注。';a.title='另一窗口的新名称';a.tags=['后来补充的标签']});
  await page.evaluate(()=>loadAssets());const before=fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8');await save('保存');
  assert.equal((await current()).assets.find(a=>a.id===uploaded.id).notes,'另一窗口的新备注。','A refreshed catalog must not silently authorize a stale editor');
  assert.equal(await page.locator('#assetNotes').inputValue(),'我在这里写的备注。');assert(await page.locator('.library-edit-conflicts').isVisible());
  assert.equal(fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8'),before);
  if(process.env.LIBRARY_EDITING_SCREENSHOT_DIR){
   const shots=process.env.LIBRARY_EDITING_SCREENSHOT_DIR;fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,'library-editing-dark.png')});
   await page.setViewportSize({width:620,height:900});await page.screenshot({path:path.join(shots,'library-editing-narrow.png')});await page.setViewportSize({width:1450,height:980});
   await page.evaluate(()=>whiteboardAppearance.apply({preset:'paper',custom:{},note:'#fff0aa'}));await page.screenshot({path:path.join(shots,'library-editing-paper.png')});
   await page.evaluate(()=>whiteboardAppearance.apply({preset:'resolve',custom:{},note:'#fff0aa'}));
  }
  await page.locator('[data-library-choice="notes"][value="current"]').check();await save('保存');await page.waitForFunction(()=>!document.getElementById('dialog').open);
  const kept=(await current()).assets.find(a=>a.id===uploaded.id);assert.equal(kept.title,'另一窗口的新名称');assert.deepEqual(kept.tags,['后来补充的标签']);assert.equal(kept.notes,'另一窗口的新备注。');
  // Editing one field retains independent table, geometry, annotations and links from elsewhere.
  await page.evaluate(()=>writeLibraryContent('authored'));await page.locator('#library-body').fill('作者修改过的内容。');
  await remote(next=>{const nodes=next.assets.find(a=>a.id==='authored').bundle.nodes;nodes[0].annotation='另一窗口修改的补充。';nodes[0].w=410;nodes[1].rows[0][0]='另一窗口修改的格子。'});
  await save();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  let original=(await current()).assets.find(a=>a.id==='authored');assert.equal(original.bundle.nodes[0].body,'作者修改过的内容。');assert.equal(original.bundle.nodes[0].annotation,'另一窗口修改的补充。');assert.equal(original.bundle.nodes[0].w,410);assert.equal(original.bundle.nodes[1].rows[0][0],'另一窗口修改的格子。');assert.equal(original.bundle.edges[0].label,'原本的联系');
  // Choices apply only to the versions actually displayed, not to another later update.
  await page.evaluate(()=>writeLibraryContent('authored'));await page.locator('#library-body').fill('我保留的这段原文。');
  await remote(next=>next.assets.find(a=>a.id==='authored').bundle.nodes[0].body='同时修改的第一版。');await save();
  await page.locator('[data-library-choice="node:first:body"][value="mine"]').check();
  await remote(next=>next.assets.find(a=>a.id==='authored').bundle.nodes[0].body='同时修改的第二版。');await save();
  assert.equal((await current()).assets.find(a=>a.id==='authored').bundle.nodes[0].body,'同时修改的第二版。');
  assert(!(await page.locator('[data-library-choice="node:first:body"][value="mine"]').isChecked()));
  assert((await page.locator('.library-edit-conflicts').innerText()).includes('同时修改的第二版。'));
  await page.locator('[data-library-choice="node:first:body"][value="mine"]').check();await save();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.equal((await current()).assets.find(a=>a.id==='authored').bundle.nodes[0].body,'我保留的这段原文。');
  // A moved folder keeps its identity while an editor stays open.
  await page.evaluate(()=>writeLibraryContent('authored'));await page.locator('#library-annotation').fill('移动期间写的补充。');
  await other.evaluate(async()=>{await loadAssets();await moveAssetFolder('观察','','素材记录')});await save();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  original=(await current()).assets.find(a=>a.id==='authored');assert.equal(original.folder,'素材记录');assert(!(await current()).folders.includes('观察'));
  // A removed atom is not resurrected implicitly; the complete draft can be kept separately.
  await page.evaluate(()=>writeLibraryContent('authored'));await page.locator('#library-body').fill('被删除之前还在写的原文。');
  await remote(next=>{const a=next.assets.find(a=>a.id==='authored');a.bundle.nodes=a.bundle.nodes.filter(n=>n.id!=='first');a.bundle.edges=[]});await save();
  assert.equal((await current()).assets.find(a=>a.id==='authored').bundle.nodes.length,1);
  await page.getByRole('button',{name:'另存我的编辑',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  const copy=(await current()).assets.find(a=>a.id!=='authored'&&a.mime==='application/x-creative-bundle');assert(copy);assert.equal(copy.bundle.nodes[0].body,'被删除之前还在写的原文。');assert.equal(copy.bundle.nodes[0].mediaId,uploaded.id);
  // Copying file metadata makes a new reference, not a second media file.
  const fileCount=fs.readdirSync(path.join(tmp,'素材文件')).length;
  await page.evaluate(id=>editAsset(id),uploaded.id);await page.locator('#assetNotes').fill('移除前的未保存备注。');
  await remote(next=>next.assets.find(a=>a.id===uploaded.id).archived=true);await save('保存');await page.getByRole('button',{name:'另存我的编辑',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  const fileCopy=(await current()).assets.find(a=>a.id!==uploaded.id&&a.path===uploaded.path);assert(fileCopy&&!fileCopy.archived);assert.equal(fileCopy.notes,'移除前的未保存备注。');assert.equal(fs.readdirSync(path.join(tmp,'素材文件')).length,fileCount);assert(Buffer.from(await (await fetch(base+'/api/media/'+fileCopy.id)).arrayBuffer()).equals(bytes));
  // A failed fresh read leaves the draft intact, and a retry is usable.
  await page.evaluate(id=>editAsset(id),fileCopy.id);await page.locator('#assetNotes').fill('失败后继续保留的备注。');
  const failRead=route=>route.request().method()==='GET'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'暂时不能读取最新版本'})}):route.continue();
  await page.route('**/api/assets',failRead);await save('保存');assert.equal(await page.locator('#assetNotes').inputValue(),'失败后继续保留的备注。');assert((await page.locator('.library-edit-message').innerText()).includes('暂时不能读取'));
  await page.unroute('**/api/assets',failRead);await save('保存');await page.waitForFunction(()=>!document.getElementById('dialog').open);assert.equal((await current()).assets.find(a=>a.id===fileCopy.id).notes,'失败后继续保留的备注。');
  // Removed optional metadata is a real version choice, without a serialization error.
  await page.evaluate(id=>editAsset(id),fileCopy.id);await page.locator('#assetTags').fill('我补充的标签');
  await remote(next=>delete next.assets.find(a=>a.id===fileCopy.id).tags);await save('保存');
  await page.locator('[data-library-choice="tags"][value="mine"]').check();await save('保存');await page.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.deepEqual((await current()).assets.find(a=>a.id===fileCopy.id).tags,['我补充的标签']);
  // A write conflict re-enables the form and a later retry still preserves its author text.
  await page.evaluate(id=>editAsset(id),fileCopy.id);await page.locator('#assetNotes').fill('写入失败也要保留的备注。');
  const failWrite=route=>route.request().method()==='PUT'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'模拟稍后的保存冲突'})}):route.continue();
  await page.route('**/api/assets',failWrite);await save('保存');assert(await page.locator('#assetNotes').isEnabled());assert.equal(await page.locator('#assetNotes').inputValue(),'写入失败也要保留的备注。');
  await page.unroute('**/api/assets',failWrite);await save('保存');await page.waitForFunction(()=>!document.getElementById('dialog').open);
  // Words typed while waiting for the fresh read join the saved snapshot.
  let releaseTyping,arriveTyping,finishTyping;const typingArrived=new Promise(resolve=>arriveTyping=resolve),typingFulfilled=new Promise(resolve=>finishTyping=resolve);
  const typingHold=async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();await new Promise(resolve=>{releaseTyping=resolve;arriveTyping()});try{await route.fulfill({response})}finally{finishTyping()}};
  await page.evaluate(id=>editAsset(id),fileCopy.id);await page.locator('#assetNotes').fill('开始核对时的文字。');await page.route('**/api/assets',typingHold);await save('保存',false);await typingArrived;
  await page.locator('#assetNotes').fill('核对期间继续写下的完整文字。');releaseTyping();await typingFulfilled;await page.unroute('**/api/assets',typingHold);await page.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.equal((await current()).assets.find(a=>a.id===fileCopy.id).notes,'核对期间继续写下的完整文字。');
  // Closing during preparation cannot cause a later, invisible write.
  let release,arrive,finish;const arrived=new Promise(resolve=>arrive=resolve),fulfilled=new Promise(resolve=>finish=resolve);
  const hold=async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();await new Promise(resolve=>{release=resolve;arrive()});try{await route.fulfill({response})}finally{finish()}};
  await page.evaluate(id=>editAsset(id),fileCopy.id);await page.locator('#assetNotes').fill('取消后不该写入的内容。');await page.route('**/api/assets',hold);
  await save('保存',false);await arrived;await page.keyboard.press('Escape');release();await fulfilled;await page.unroute('**/api/assets',hold);await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  assert.equal((await current()).assets.find(a=>a.id===fileCopy.id).notes,'核对期间继续写下的完整文字。');
  // New content follows a renamed destination, but not a deleted-and-recreated one.
  await page.evaluate(()=>{enterAssetFolder('片段');writeLibraryContent()});await page.locator('#libraryName').fill('刚写的内容');await page.locator('#library-body').fill('这是我自己写的。');
  await other.evaluate(async()=>{await loadAssets();await moveAssetFolder('片段','','新的片段')});await save();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.equal((await current()).assets.find(a=>a.title==='刚写的内容').folder,'新的片段');
  await page.evaluate(()=>{enterAssetFolder('新的片段');writeLibraryContent()});await page.locator('#libraryName').fill('同名目录仍要区分');await page.locator('#library-body').fill('不能凭同名目录改变存放对象。');
  await remote(next=>{next.assets.filter(a=>a.folder==='新的片段').forEach(a=>a.folder='');next.folderIds['新的片段']='replacement-folder'});await save();
  assert(!(await current()).assets.some(a=>a.title==='同名目录仍要区分'));
  assert((await page.locator('.library-edit-message').innerText()).includes('已删除'));
  await page.locator('.destination-toggle').click();await page.locator('.destination-crumbs button').first().click();await page.locator('.destination-done').click();await save();await page.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.equal((await current()).assets.find(a=>a.title==='同名目录仍要区分').folder,'');
  assert.deepEqual(errors,[]);
  console.log('Library editing: fresh comparisons, explicit field choices, independent edits, changing approvals, folder moves, deleted atoms, reference-only copies, read failure and cancelled preparation passed');
 }finally{if(browser)await browser.close();proc.kill();await new Promise(resolve=>proc.once('exit',resolve));const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
