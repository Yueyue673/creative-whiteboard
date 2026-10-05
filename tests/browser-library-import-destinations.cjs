const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert');
const {spawn}=require('child_process'),{chromium}=require('playwright');

(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-library-destinations-'));
 const port=await require('./browser-port.cjs')();
 const base='http://127.0.0.1:'+port;
 const proc=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,
  env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});
 let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  const response=await fetch(base+'/api/assets'),catalog=await response.json();
  const folders=['草稿','归档','待删','恢复','复制源'];
  catalog.folders=folders;catalog.folderIds=Object.fromEntries(folders.map((folder,i)=>[folder,'folder-'+i]));
  assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':response.headers.get('ETag')},body:JSON.stringify(catalog)})).ok);
  assert((await fetch(base+'/api/boards/work',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:'整理文件',nodes:[],edges:[],view:{x:0,y:0,z:1}})})).ok);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const context=await browser.newContext({viewport:{width:1400,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/index.html?board=work');
  await page.waitForFunction(()=>boardId==='work'&&!loading&&assetIndex.folders.includes('草稿'));
  await page.evaluate(()=>showWorkspaceTab('assetPane'));
  const current=()=>fetch(base+'/api/assets').then(r=>r.json());
  async function pending(names,folder,hold=names.at(-1),paste=false){
   let release,arrived;const arrival=new Promise(resolve=>arrived=resolve);
   const handler=async route=>{
    if(decodeURIComponent(route.request().headers()['x-file-name']||'')===hold){
     await new Promise(resolve=>{release=resolve;arrived()});
    }
    await route.continue();
   };
   await page.route('**/api/assets/upload',handler);
   await page.evaluate(({names,folder,paste})=>{
    const files=names.map(name=>new File(['isolated fixture '+name],name,{type:'audio/wav'}));
    window.destinationImport=(paste?whiteboardLibraryClipboard.paste('',files,folder):uploadFiles(files,folder))
     .then(value=>({ok:true,value:value??null}),error=>({ok:false,error:error.message}));
   },{names,folder,paste});
   await Promise.race([arrival,page.evaluate(()=>destinationImport).then(result=>{throw Error(result.error||'Upload completed before reaching its expected pause')})]);
   return async()=>{release();const result=await page.evaluate(()=>destinationImport);await page.unroute('**/api/assets/upload',handler);assert(result.ok,result.error);return result.value};
  }
  // An initially empty folder still has identity; rename does not recreate its old path.
  await page.evaluate(()=>enterAssetFolder('草稿'));
  const finishFirst=await pending(['first.wav'],'草稿');
  await page.evaluate(()=>moveAssetFolder('草稿','','片段'));
  const first=await finishFirst();
  assert.equal(first[0].folder,'片段','A pending upload follows the original folder after rename');
  assert(!(await current()).folders.includes('草稿'));
  assert.equal((await current()).folderIds['片段'],'folder-0');
  const mediaPath=first[0].path;
  // Later imported files move with the folder when its rename is undone and redone.
  await page.evaluate(()=>wfUndoLibrary());
  assert.equal((await current()).assets.find(a=>a.id===first[0].id).folder,'草稿');
  assert.equal(await page.evaluate(()=>assetFolder),'草稿','The current folder view follows undo instead of falling back to an empty root');
  assert.equal((await current()).folderIds['草稿'],'folder-0');
  await page.evaluate(()=>wfRedoLibrary());
  assert.equal((await current()).assets.find(a=>a.id===first[0].id).folder,'片段');
  assert.equal(await page.evaluate(()=>assetFolder),'片段');
  assert.equal((await current()).assets.find(a=>a.id===first[0].id).path,mediaPath);
  // A second window moves the folder between files of one upload batch.
  const finishBatch=await pending(['batch-a.wav','batch-b.wav'],'片段');
  const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));
  await other.goto(base+'/index.html?board=work');await other.waitForFunction(()=>boardId==='work'&&!loading&&assetIndex.folders.includes('片段'));
  await other.evaluate(async()=>{await loadAssets();await moveAssetFolder('片段','归档')});
  const batch=await finishBatch();
  assert(batch.every(a=>a.folder==='归档/片段'));
  assert.equal((await current()).folderIds['归档/片段'],'folder-0');
  assert.equal(await page.evaluate(()=>assetFolder),'归档/片段','Refreshing an import retains the original folder view after a remote move');
  assert(!(await current()).folders.includes('片段'));
  // Navigating elsewhere during a clipboard import does not force the user back.
  await page.evaluate(()=>enterAssetFolder('复制源'));
  const finishPaste=await pending(['browse.wav'],'复制源','browse.wav',true);
  await page.evaluate(()=>enterAssetFolder('归档'));await finishPaste();
  assert.equal(await page.evaluate(()=>assetFolder),'归档');
  assert.equal((await current()).assets.find(a=>a.title==='browse.wav').folder,'复制源');
  // A deleted folder and a new folder with the same name are different destinations.
  const finishDeleted=await pending(['deleted.wav'],'待删');
  await page.evaluate(async()=>{
   assetFolderPick='待删';assetSelected.clear();await deleteExplorer('asset');
   const next=clone(assetIndex);next.folders.push('待删');await saveAssets(next);
  });
  assert.notEqual((await current()).folderIds['待删'],'folder-2');
  const deleted=await finishDeleted();
  assert.equal(deleted[0].folder,'');assert.equal(deleted[0].destinationMissing,true);
  assert.equal((await current()).assets.filter(a=>!a.archived&&a.folder==='待删').length,0);
  // Restoring the same folder before completion keeps its original identity.
  const finishRestored=await pending(['restored.wav'],'恢复');
  await page.evaluate(async()=>{assetFolderPick='恢复';assetSelected.clear();await deleteExplorer('asset');await wfUndoLibrary()});
  const restored=await finishRestored();assert.equal(restored[0].folder,'恢复');
  assert.equal((await current()).folderIds['恢复'],'folder-3');
  // A clipboard folder move preserves identity; its copy receives fresh identities.
  const finishCut=await pending(['cut.wav'],'复制源');
  const cut=await page.evaluate(()=>{
   assetFolderPick='复制源';let text='';whiteboardLibraryClipboard.writeEvent({preventDefault(){},stopImmediatePropagation(){},clipboardData:{setData(type,value){text=value}}},true);return text;
  });
  await other.evaluate(text=>whiteboardLibraryClipboard.paste(text,[],'归档'),cut);
  const moved=await finishCut();assert.equal(moved[0].folder,'归档/复制源');
  assert.equal((await current()).folderIds['归档/复制源'],'folder-4');
  const copy=await other.evaluate(()=>{
   assetFolderPick='归档/复制源';let text='';whiteboardLibraryClipboard.writeEvent({preventDefault(){},stopImmediatePropagation(){},clipboardData:{setData(type,value){text=value}}},false);return text;
  });
  await other.evaluate(text=>whiteboardLibraryClipboard.paste(text,[],''),copy);
  assert.notEqual((await current()).folderIds['复制源'],'folder-4');
  assert.equal((await current()).folderIds['归档/复制源'],'folder-4');
  // Undo never removes a newly created folder while unrelated later imports occupy it.
  await page.evaluate(async()=>{await loadAssets();const next=clone(assetIndex);next.folders.push('新内容');await saveAssets(next);await uploadFiles([new File(['new fixture'],'new.wav',{type:'audio/wav'})],'新内容');await wfUndoLibrary()});
  assert((await current()).folders.includes('新内容'));
  assert.equal((await current()).assets.find(a=>a.title==='new.wav').folder,'新内容');
  const before=fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8'),identities=(await current()).folderIds;
  await page.reload();await page.waitForFunction(()=>boardId==='work'&&!loading&&assetIndex.folderIds?.['归档/片段']);
  assert.deepEqual(await page.evaluate(()=>assetIndex.folderIds),identities);
  assert.equal(fs.readFileSync(path.join(tmp,'素材目录.json'),'utf8'),before,'Reading and reopening do not migrate or rewrite the catalog');
  assert.deepEqual(errors,[]);
  console.log('Library import destinations: empty-folder rename, undo/redo with later files, cross-window batch move, navigation, deletion and same-name replacement, restoration, clipboard move/copy and read-only reopening passed');
 }finally{
  if(browser)await browser.close();proc.kill();await new Promise(resolve=>proc.once('exit',resolve));
  const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
