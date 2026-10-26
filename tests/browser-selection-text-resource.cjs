const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{createHash}=require('node:crypto'),{chromium}=require('playwright');
(async()=>{
 const root=process.env.SELECTION_TEXT_SOURCE||path.resolve(__dirname,'..'),out=process.env.SELECTION_TEXT_PROOF;
 if(out){assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true})}
 const proof={syntheticOnly:true,sourceHead:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeFiles:{},cases:[],errors:[],complete:false};
 for(const file of ['note-editor.js','note-editor.css','workspace.js'])proof.runtimeFiles[file]=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
 const save=()=>{if(out)fs.writeFileSync(out+'/result.json',JSON.stringify(proof,null,2))};let server,browser,p,releaseAuthor,releaseRead;
 const photo=async name=>{if(out)await p.screenshot({path:out+'/'+name+'.png'})},fieldState=e=>({value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection,top:e.scrollTop,left:e.scrollLeft});
 try{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'creative-selection-text-')),port=await require(root+'/tests/browser-port.cjs')(),base='http://127.0.0.1:'+port;
 server=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,stdio:'ignore',env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:data,PYTHONIOENCODING:'utf-8'}});proof.ownedServer={pid:server.pid,port,data};save();let live=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){live=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(live);
 const get=async url=>{const r=await fetch(base+url);assert(r.ok);return r.json()};
 const seedResponse=await fetch(base+'/api/assets');const etag=seedResponse.headers.get('ETag'),empty=await seedResponse.json();const legacy={id:'given-old-resource',title:'给定已有资源',path:'',mime:'application/x-creative-board+json',size:0,tags:[],notes:'给定原备注',folder:'',bundle:{nodes:[{id:'given-old-node',type:'note',title:'给定已有资源',body:'给定原有原文',x:0,y:0,w:300,h:220}],edges:[]},updated:1};
 assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify({...empty,folders:['给定资料'],assets:[legacy]})})).ok);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 for(const [width,expanded]of [[1360,false],[320,false],[1360,true],[320,true]]){
  const mode=expanded?'expanded':'inline',key='given-excerpt-'+width+'-'+mode,target=key+'-target',prefix='给定前文。\n\n',shown='给定原话 <em>保持字面文字</em>\n[[给定关联]] 的材料。',selectedRaw='给定原话 <em>保持字面文字</em>\n[[@'+key+'/ref-two|给定关联]] 的材料。',suffix='\n\n给定后文。',append=' 给定当前续写',rawBody=prefix+selectedRaw+suffix;
  const given={format:'creative-board',version:1,name:'给定写作',nodes:[{id:'writer',type:'note',title:'给定材料记录',body:rawBody,userText:'给定补充',annotation:'给定备注',textFormat:'markdown',x:30,y:60,w:260,h:440,sizeMode:'manual',fontSize:16},{id:'ref-one',type:'note',title:'给定关联',body:'给定第一份原文',x:1000,y:50,w:300,h:200,sizeMode:'manual'},{id:'ref-two',type:'note',title:'给定关联',body:'给定第二份正确原文',x:1400,y:50,w:300,h:200,sizeMode:'manual'}],edges:[{id:'given-edge',from:'ref-one',to:'ref-two',label:'给定原关系'}],view:{x:width/2-160,y:60,z:1}};
  const targetSeed={...given,name:'给定取用作品',nodes:[{id:'given-target',type:'note',title:'给定原记录',body:'给定目标原文',x:20,y:30,w:300,h:200,sizeMode:'manual'}],edges:[]};
  for(const [id,value]of [[key,given],[target,targetSeed]])assert((await fetch(base+'/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)})).ok);
  const context=await browser.newContext({viewport:{width,height:920}});context.setDefaultTimeout(12000);await context.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await p.goto(base+'/?board='+key);
  const ready=async(page,id)=>{await page.waitForFunction(k=>current()?.boardId===k&&pane(current())?.state()?.boardId===k&&!pane(current())?.state()?.loading,id);return(await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame())};
  const f=await ready(p,key),row={width,mode,phase:'initial-writing'};proof.cases.push(row);save();
  await f.locator('#nodes>[data-id=writer]').click({button:'right',position:{x:3,y:3}});await f.locator('#fileContext').getByRole('menuitem',{name:expanded?'展开编辑':'编辑',exact:true}).click();if(expanded)await f.locator('#immersiveSurface').waitFor();
  const body=f.locator('#body'),field=await body.elementHandle();await body.focus();const originalShown=await body.inputValue();assert.equal(originalShown,prefix+shown+suffix);assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise);
  let authorHeld=false,heldOnce=false;const authorGate=new Promise(resolve=>releaseAuthor=resolve);
  await context.route('**/api/boards/'+key,async route=>{if(route.request().method()==='PUT'&&!heldOnce){heldOnce=true;authorHeld=true;await authorGate}await route.continue()});
  await p.keyboard.press('Control+End');await p.keyboard.insertText(append);
  const select=async(start,length)=>{await body.focus();await p.keyboard.press('Control+Home');for(let i=0;i<start+length;i++)await p.keyboard.press('ArrowRight');await p.keyboard.down('Shift');for(let i=0;i<length;i++)await p.keyboard.press('ArrowLeft');await p.keyboard.up('Shift')};
  await select(prefix.length,shown.length);const beforeField=await body.evaluate(fieldState),authored=()=>f.evaluate(()=>({board:clone(board),history:clone(history),future:clone(future),editorId,selected:[...selected]})),before=await authored();
  for(let i=0;i<150&&!authorHeld;i++)await new Promise(r=>setTimeout(r,20));assert(authorHeld);
  await p.evaluate(()=>{window.excerptActualWriteText=navigator.clipboard.writeText;window.excerptClipboardGate=new Promise(resolve=>window.excerptReleaseClipboard=resolve);navigator.clipboard.writeText=()=>excerptClipboardGate;window.excerptClipboardWork=whiteboardClipboardCoordinator.write(null,'给定另一份待复制内容')});
  assert(await p.evaluate(()=>!!whiteboardClipboardCoordinator.pending));
  const draft=f.locator('.note-selection-resource');
  const open=async()=>{await f.locator('#noteFormat').click();await f.getByRole('button',{name:'所选文字存到库',exact:true}).click();await draft.waitFor();await f.getByRole('button',{name:'保存到内容库',exact:true}).waitFor();await f.waitForFunction(()=>{const box=document.querySelector('.note-selection-resource');return box&&!box.querySelector('select').disabled});};
  const exactAuthor=async()=>{assert(await field.evaluate(e=>e.isConnected));assert.deepEqual(await body.evaluate(fieldState),beforeField);assert.deepEqual(await authored(),before);assert.equal(await f.locator('#immersiveSurface').isVisible(),expanded)};
  const catalogBefore=await get('/api/assets');let assetPuts=0;const listener=request=>{if(request.url()===base+'/api/assets'&&request.method()==='PUT')assetPuts++};p.on('request',listener);
  await open();assert.equal(await draft.locator('.note-selection-preview').innerText(),shown);assert.equal(await draft.locator('em').count(),0);await f.getByRole('button',{name:'取消',exact:true}).click();await exactAuthor();assert.equal(assetPuts,0);assert.deepEqual(await get('/api/assets'),catalogBefore);row.cancelExact=true;save();
  await open();await f.getByRole('textbox',{name:'资源名称',exact:true}).fill('给定所选原文 '+width+' '+mode);await f.getByRole('combobox',{name:'存放位置',exact:true}).selectOption('给定资料');
  if(width===1360&&expanded){
   let held=false,once=false;const gate=new Promise(resolve=>releaseRead=resolve);
   const hold=async route=>{if(route.request().method()==='GET'&&!once){once=true;held=true;await gate}await route.continue()};
   await context.route('**/api/assets',hold);await f.getByRole('button',{name:'保存到内容库',exact:true}).click();for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,20));assert(held);
   await f.getByRole('button',{name:'取消',exact:true}).click();await exactAuthor();await f.locator('#noteFormat').click();releaseRead();releaseRead=null;await f.waitForFunction(()=>!assetReadPending||assetReadState==='ready');
   assert.equal(await draft.count(),0);assert(await f.locator('.note-format-grid').isVisible());assert.equal(assetPuts,0);await context.unroute('**/api/assets',hold);await f.getByRole('button',{name:'关闭文字格式',exact:true}).click();
   await open();await f.getByRole('textbox',{name:'资源名称',exact:true}).fill('给定所选原文 '+width+' '+mode);await f.getByRole('combobox',{name:'存放位置',exact:true}).selectOption('给定资料');row.cancelledLateReadDidNotWriteOrReplaceNewPanel=true;
  }
  let failureOnce=false;const controlled=async route=>{
   if(route.request().method()==='PUT'&&!failureOnce&&!expanded){
    failureOnce=true;if(width===320){const response=await route.fetch();assert(response.ok());await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'给定回执暂未读到'})})}
    else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'给定保存暂不可用'})});return;
   }await route.continue();
  };
  if(!expanded)await context.route('**/api/assets',controlled);
  if(width===320&&expanded){
   let held=false,once=false;const gate=new Promise(resolve=>releaseRead=resolve);const hold=async route=>{if(route.request().method()==='GET'&&!once){once=true;held=true;await gate}await route.continue()};
   await context.route('**/api/assets',hold);await f.getByRole('button',{name:'保存到内容库',exact:true}).click();for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,20));assert(held);
   const response=await fetch(base+'/api/assets'),c=await response.json(),folderId=c.folderIds['给定资料'];assert(folderId);c.folders=c.folders.map(v=>v==='给定资料'?'给定资料改名':v);delete c.folderIds['给定资料'];c.folderIds['给定资料改名']=folderId;for(const item of c.assets)if(item.folder==='给定资料')item.folder='给定资料改名';
   assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':response.headers.get('ETag')},body:JSON.stringify(c)})).ok);releaseRead();releaseRead=null;await context.unroute('**/api/assets',hold);row.originalFolderIdentityFollowedRename=true;
  }else await f.getByRole('button',{name:'保存到内容库',exact:true}).click();
  if(!expanded){
   await f.waitForFunction(()=>document.querySelector('.note-selection-status')?.textContent.includes('没有保存成功'));assert.equal(await f.getByRole('textbox',{name:'资源名称',exact:true}).inputValue(),'给定所选原文 '+width+' '+mode);assert(await field.evaluate(e=>e.isConnected));
   const during=await get('/api/assets');assert.equal(during.assets.length,catalogBefore.assets.length+(width===320?1:0));await f.getByRole('button',{name:'保存到内容库',exact:true}).click();row.controlledFailure={kind:width===320?'server-committed-response-failed':'before-server-commit',retryKeepsDraft:true};
  }
  await f.getByRole('button',{name:'继续写作',exact:true}).waitFor();assert(await p.evaluate(()=>!!whiteboardClipboardCoordinator.pending));assert.equal(assetPuts,expanded?1:width===320?1:2);await photo(width+'-'+mode+'-saved');
  await f.getByRole('button',{name:'继续写作',exact:true}).click();await exactAuthor();
  const catalog=await get('/api/assets'),created=catalog.assets.filter(a=>!catalogBefore.assets.some(b=>b.id===a.id));assert.equal(created.length,1);const resource=created[0];assert.equal(resource.bundle.nodes[0].body,selectedRaw);assert.equal(resource.bundle.nodes[0].title,'给定所选原文 '+width+' '+mode);assert.equal(resource.folder,width===320&&expanded?'给定资料改名':'给定资料');assert.deepEqual(catalog.assets.find(a=>a.id===legacy.id),legacy);
  assert.equal(await p.evaluate(()=>whiteboardClipboardCoordinator.pending.text),'给定另一份待复制内容');row.actualResourceRawTextAndCompleteReferenceExact=true;row.noClipboardPayloadReadOrWrite=true;
  if(width===320&&expanded){
   const partialStart=prefix.length+shown.indexOf('给定关联')+2;await select(partialStart,2);await open();await f.getByRole('button',{name:'保存到内容库',exact:true}).click();await f.getByRole('button',{name:'继续写作',exact:true}).click();
   const afterPartial=await get('/api/assets'),added=afterPartial.assets.find(a=>!catalog.assets.some(b=>b.id===a.id));assert(added);assert.equal(added.bundle.nodes[0].body,'关联');assert.equal(added.bundle.nodes[0].title,'');row.partialReferenceSelectionStaysLiteral=true;await select(prefix.length,shown.length);
  }
  await body.focus();await p.keyboard.press('Control+z');assert.equal(await body.inputValue(),originalShown);await p.keyboard.press('Control+Shift+z');assert.equal(await body.inputValue(),originalShown+append);row.originalNativeLatestInputUndoRedo=true;
  releaseAuthor();releaseAuthor=null;await f.waitForFunction(()=>!dirty&&!savePromise,null,{timeout:15000});assert(await f.evaluate(()=>whiteboardPane.flush()));
  const final=await f.evaluate(()=>clone(board));assert.deepEqual((await get('/api/boards/'+key)).nodes,final.nodes);assert.deepEqual((await get('/api/boards/'+key)).edges,final.edges);
  const use=await context.newPage();await use.goto(base+'/?board='+target);const uf=await ready(use,target),targetBefore=await uf.evaluate(()=>clone(board.nodes));await use.locator('#openBoards').click();await use.waitForFunction(()=>whiteboardWorkspace.explorer());
  const explorer=use.frames().find(frame=>frame.parentFrame()&&new URL(frame.url()).searchParams.get('explorer')==='1');assert(explorer);await explorer.locator('#assetsButton').click();await explorer.waitForFunction(()=>assetReadState==='ready');await explorer.locator('#assetSearch').fill(resource.title);await explorer.locator('[data-asset="'+resource.id+'"] [data-asset-preview]').click();await explorer.getByRole('button',{name:'放到白板',exact:true}).click();
  await uf.waitForFunction(()=>board.nodes.length===2&&!whiteboardImports.pending());const used=await uf.evaluate(()=>clone(board.nodes)),copy=used.find(n=>n.id!=='given-target');assert.equal(copy.body,selectedRaw);assert.equal(copy.libraryOrigin.id,resource.id);assert.deepEqual(used.find(n=>n.id==='given-target'),targetBefore[0]);assert(await uf.evaluate(()=>whiteboardPane.flush()));await uf.waitForFunction(()=>!dirty&&!savePromise);
  const fresh=await context.newPage();await fresh.goto(base+'/?board='+target);const ff=await ready(fresh,target);assert.deepEqual(await ff.evaluate(()=>clone(board.nodes)),used);assert.deepEqual((await get('/api/assets')).assets.find(a=>a.id===resource.id),resource);
  assert(await field.evaluate(e=>e.isConnected));assert.deepEqual(await f.evaluate(()=>clone(board.nodes)),final.nodes);row.nativeReuseAndNewWorkspaceReadbackExact=true;
  await p.evaluate(async()=>{excerptReleaseClipboard();await excerptClipboardWork;navigator.clipboard.writeText=excerptActualWriteText});row.phase='complete';save();await context.close();
 }
 assert.deepEqual(proof.errors,[]);proof.complete=true;
 }catch(error){proof.failure=error.stack;if(p)await photo('failure').catch(()=>{});throw error}
 finally{releaseAuthor?.();releaseRead?.();if(browser)await browser.close();if(server){server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve))}proof.ownedServicesStopped=true;save();console.log(JSON.stringify(proof))}
})().catch(error=>{console.error(error);process.exitCode=1});
