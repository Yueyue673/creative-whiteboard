// Native saved-group layout task using only the repository's public example.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.LIBRARY_SPATIAL_PROOF||path.join(fs.mkdtempSync(path.join(os.tmpdir(),'library-spatial-task-')),'proof');
assert(R&&O&&!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});
const proof={at:new Date().toISOString(),prototypeOnly:false,syntheticOnly:true,complete:false,cases:[],errors:[],physicalDeviceTested:false};
const save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));


(async()=>{
 proof.head=execFileSync(process.env.GIT_EXE||'git',['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 proof.taskSHA256=digest(fs.readFileSync(__filename));proof.serverSHA256=digest(fs.readFileSync(R+'/server.py'));proof.hostedDockerfileSHA256=digest(fs.readFileSync(R+'/hosted/Dockerfile'));
 proof.runtimeFiles={};for(const name of ['workspace.js','workspace-shell.js','pane.js','refinement.css','workspace-shell.css','explorer-navigation.js','experience.js','document-paper.js','document-paper.css','index.html','library-spatial.js','library-spatial.css'])proof.runtimeFiles[name]=digest(fs.readFileSync(R+'/'+name));
 const bytes=fs.readFileSync(R+'/examples/getting-started.json'),example=JSON.parse(bytes);proof.publicExampleSHA256=digest(bytes);
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'wb-spatial-comparison-')),port=await require(R+'/tests/browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[R+'/server.py'],{windowsHide:true,stdio:['ignore',fs.openSync(O+'/server.log','a'),fs.openSync(O+'/server.log','a')],env:{...process.env,CREATIVE_BOARD_DATA_DIR:data,CREATIVE_BOARD_PORT:String(port)}});
 proof.ownedServer={pid:server.pid,port,data};let browser,page;save();
 const request=async(url,method='GET',body,etag)=>{const result=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(result.ok,url+' '+result.status);return {value:await result.json(),etag:result.headers.get('etag')}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{const health=await fetch(base+'/api/health');await health.arrayBuffer();if(health.ok){ready=true;break}}catch{}await pause(100)}assert(ready);
  proof.servedRuntimeFiles={};for(const [name,hash] of Object.entries(proof.runtimeFiles)){const response=await fetch(base+'/'+name);assert(response.ok,name+' static response '+response.status);const actual=digest(Buffer.from(await response.arrayBuffer()));assert.equal(actual,hash);proof.servedRuntimeFiles[name]=actual}
  await request('/api/boards/spatial-public-original','PUT',example,'new');
  const initial=await request('/api/assets'),catalog=initial.value;
  catalog.assets.push({id:'public-spatial-group',mime:'application/x-creative-bundle',title:'公开演示：从想法到画面',folder:'',path:'',notes:'',tags:[],updated:1,bundle:{nodes:structuredClone(example.nodes),edges:structuredClone(example.edges)},source:{boardId:'spatial-public-original',nodeIds:example.nodes.map(n=>n.id)}});
  await request('/api/assets','PUT',catalog,initial.etag);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
  for(const width of [1360,320]){
   const key='spatial-comparison-'+width,row={width,mode:'native-flow',phase:'prepare'};proof.cases.push(row);save();
   const blank={...structuredClone(example),name:'给定布局取用工作',nodes:[],edges:[]};await request('/api/boards/'+key,'PUT',blank,'new');
   const context=await browser.newContext({viewport:{width,height:780},reducedMotion:'reduce',hasTouch:width===320});
   await context.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
   page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>{proof.errors.push(error.message);save()});
   await page.goto(base+'/?board='+key);await page.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);
   const author=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();
   await page.locator('#openBoards').click();await page.waitForFunction(()=>whiteboardWorkspace.explorer());const explorer=page.frames().find(f=>f.url().includes('explorer=1'));
   await explorer.locator('#assetsButton').click();
   const open=async()=>{await explorer.locator('[data-asset="public-spatial-group"] [data-asset-preview]').click();await explorer.locator('#pieceList').waitFor()};
   const model=async()=>author.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)}));
   await open();assert.equal(await explorer.locator('#pieceList [data-piece]').count(),4);
   assert.equal(await explorer.locator('.library-spatial').count(),1);assert.equal(await explorer.locator('.library-spatial').getAttribute('open'),null);
   await page.screenshot({path:O+'/'+width+'-original-list.png'});row.originalTextListAndOptionalClosedLayoutAvailable=true;
   const before=await model();row.nativeLayoutNodeCount=await explorer.locator('[data-library-layout-piece]').count();await explorer.locator('.library-spatial>summary').click();
   assert.equal(await explorer.locator('.library-spatial-map button').count(),4);assert.equal(await explorer.locator('.library-spatial-map line').count(),3);
   assert(await explorer.locator('.library-spatial-map').evaluate(el=>{const r=el.getBoundingClientRect();return r.height<=240&&r.width>240&&[...el.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.width>=40&&b.height>=35&&b.x>=r.x-.1&&b.right<=r.right+.1&&button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))})}));
   row.actualBoundedMapAndNativeHits=true;
   await page.screenshot({path:O+'/'+width+'-native-layout.png'});assert.deepEqual(await model(),before);
   await page.setViewportSize({width,height:480});
   await explorer.locator('[data-library-layout-piece="observation"]').scrollIntoViewIfNeeded();
   assert(await explorer.locator('.reuse-place').evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+.1&&r.y>=0&&r.bottom<=innerHeight+.1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));
   assert(await explorer.getByRole('button',{name:'返回内容库',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight+.1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));
   await explorer.locator('[data-library-layout-piece="shots"]').scrollIntoViewIfNeeded();
   assert(await explorer.locator('[data-library-layout-piece="shots"]').evaluate(el=>{const r=el.getBoundingClientRect();const top=Math.max(0,r.y),bottom=Math.min(innerHeight,r.bottom);return bottom>top&&el.contains(document.elementFromPoint(r.x+r.width/2,(top+bottom)/2))}));
   await page.screenshot({path:O+'/'+width+'-native-short-layout.png'});await page.setViewportSize({width,height:780});row.shortWindowOriginalReturnAndPlacementHit=true;

   const observation=explorer.locator('[data-library-layout-piece="observation"]');await observation.click();assert(await explorer.locator('[data-piece="observation"]').isChecked());assert.equal(await observation.getAttribute('aria-pressed'),'true');assert.equal(await explorer.locator('.reuse-place').innerText(),'放入所选 · 1 块');assert.deepEqual(await model(),before);
   await observation.focus();await page.keyboard.press('Space');assert.equal(await observation.getAttribute('aria-pressed'),'false');assert(!(await explorer.locator('[data-piece="observation"]').isChecked()));await page.keyboard.press('Space');assert.equal(await observation.getAttribute('aria-pressed'),'true');assert(await explorer.locator('[data-piece="observation"]').isChecked());row.nativeKeyboardSelectExact=true;
   await explorer.locator('#pieceSearch').fill('具体的观察');await explorer.waitForFunction(()=>document.querySelector('[data-library-layout-piece="question"]').disabled);assert.equal(await observation.getAttribute('aria-pressed'),'true');
   await explorer.locator('#pieceSearch').fill('');await explorer.waitForFunction(()=>!document.querySelector('[data-library-layout-piece="question"]').disabled);assert(await explorer.locator('[data-piece="observation"]').isChecked());
   await explorer.getByRole('button',{name:'返回内容库',exact:true}).click();assert.deepEqual(await model(),before);assert.deepEqual((await request('/api/assets')).value,catalog);row.nativeCancelAndSearchPreserveModelsAndSelection=true;
   await open();await explorer.locator('.library-spatial>summary').click();
   await explorer.evaluate(()=>{const stale=[...document.querySelectorAll('[data-library-layout-piece]')];askName('给定后续窗口','给定后续输入',()=>{});for(const button of stale)button.click()});
   assert.equal(await explorer.locator('#nameInput').inputValue(),'给定后续输入');assert.equal(await explorer.locator('.library-spatial').count(),0);assert.deepEqual(await model(),before);await page.keyboard.press('Escape');row.replacedPreviewCannotAffectLaterDialogOrModel=true;
   await open();await explorer.locator('.library-spatial>summary').click();await explorer.locator('[data-library-layout-piece="observation"]').click();await explorer.locator('.reuse-place').click();
   await author.waitForFunction(()=>board.nodes.length===1&&board.nodes[0].libraryOrigin?.nodeId==='observation');
   const placed=await author.evaluate(()=>clone(board.nodes[0])),original=example.nodes.find(n=>n.id==='observation');
   for(const [field,value] of Object.entries(original))if(!['id','x','y','libraryOrigin'].includes(field))assert.deepEqual(placed[field],value);
   assert.equal(placed.libraryOrigin.id,'public-spatial-group');assert.deepEqual((await request('/api/boards/spatial-public-original')).value,example);assert.deepEqual((await request('/api/assets')).value,catalog);
   await author.locator('#canvas').focus();await page.keyboard.press('Control+z');await author.waitForFunction(()=>board.nodes.length===0);await page.keyboard.press('Control+Shift+z');await author.waitForFunction(()=>board.nodes.length===1);assert.deepEqual(await author.evaluate(()=>clone(board.nodes[0])),placed);
   row.nativeOriginalCheckboxPlacementAndUndo=true;
   await author.evaluate(()=>persist());await author.waitForFunction(()=>!contentDirty&&!savingContent);
   const stored=(await request('/api/boards/'+key)).value;assert.deepEqual(stored.nodes,[placed]);
   const reopened=await context.newPage();await reopened.goto(base+'/?board='+key);await reopened.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);
   const fresh=await(await reopened.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();assert.deepEqual(await fresh.evaluate(()=>clone(board.nodes)),[placed]);assert.deepEqual(await fresh.evaluate(()=>clone(board.edges)),stored.edges);await reopened.close();row.savedFreshWorkbenchReadbackExact=true;row.phase='complete';save();await context.close();page=null;
  }
  const controlled=await request('/api/assets'),compact=structuredClone(catalog.assets[0]),invalid=structuredClone(catalog.assets[0]);
  compact.id='given-compact-layout';compact.title='给定较小和重叠布局';const tiny=compact.bundle.nodes.find(n=>n.id==='question');tiny.w=1;tiny.h=1;const overlapped=compact.bundle.nodes.find(n=>n.id==='observation'),top=compact.bundle.nodes.find(n=>n.id==='next');Object.assign(top,{x:overlapped.x,y:overlapped.y,w:overlapped.w,h:overlapped.h});
  invalid.id='given-invalid-layout';invalid.title='给定无效坐标';invalid.bundle.nodes[0].x='given invalid coordinate';
  controlled.value.assets.push(compact,invalid);await request('/api/assets','PUT',controlled.value,controlled.etag);
  for(const [mode,id] of [['compact-select',compact.id],['invalid-layout',invalid.id]]){
   const row={width:320,mode,phase:'prepare'};proof.cases.push(row);save();const key='given-'+mode;
   await request('/api/boards/'+key,'PUT',{...structuredClone(example),nodes:[],edges:[]},'new');
   const context=await browser.newContext({viewport:{width:320,height:780},reducedMotion:'reduce',hasTouch:true});await context.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
   page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>{proof.errors.push(e.message);save()});await page.goto(base+'/?board='+key);await page.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);
   const author=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();const before=await author.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)}));
   await page.locator('#openBoards').click();await page.waitForFunction(()=>whiteboardWorkspace.explorer());const explorer=page.frames().find(f=>f.url().includes('explorer=1'));await explorer.locator('#assetsButton').click();await explorer.locator('[data-asset="'+id+'"] [data-asset-preview]').click();await explorer.locator('#pieceList').waitFor();
   assert.equal(await explorer.locator('#pieceList input[data-piece]').count(),4);
   if(mode==='compact-select'){
    await explorer.locator('.library-spatial>summary').click();await explorer.waitForFunction(()=>document.querySelector('[data-library-layout-piece="question"]').disabled);assert(await explorer.locator('[data-library-layout-piece="question"]').isDisabled());assert(await explorer.locator('[data-library-layout-piece="observation"]').isDisabled());assert((await explorer.locator('.library-spatial>p').innerText()).includes('较小或重叠'));
    await explorer.locator('input[data-piece="observation"]').check();assert.equal(await explorer.locator('[data-library-layout-piece="observation"]').getAttribute('aria-pressed'),'true');assert.equal(await explorer.locator('.reuse-place').innerText(),'放入所选 · 1 块');row.tinyOrCoveredMapTargetsUseOriginalList=true;
   }else{assert.equal(await explorer.locator('.library-spatial').count(),0);await explorer.locator('input[data-piece="observation"]').check();assert.equal(await explorer.locator('.reuse-place').innerText(),'放入所选 · 1 块');row.invalidLayoutLeavesOriginalTextPreviewAvailable=true}
   await explorer.getByRole('button',{name:'返回内容库',exact:true}).click();assert.deepEqual(await author.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)})),before);assert.deepEqual((await request('/api/assets')).value,controlled.value);assert.deepEqual((await request('/api/boards/spatial-public-original')).value,example);row.cancelOriginalModelsAndCatalogueExact=true;row.phase='complete';save();await context.close();page=null;
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;save();
 }catch(error){proof.failure=error.stack;if(page)await page.screenshot({path:O+'/failure.png'}).catch(()=>{});save();throw error}
 finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));proof.ownedServicesStopped=true;save()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
