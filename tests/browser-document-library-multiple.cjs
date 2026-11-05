const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.DOCUMENT_LIBRARY_MULTIPLE_PROOF||path.join(R,'artifacts','document-library-multiple'),PY=process.env.PYTHON||'python';
assert(!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),proof={at:new Date().toISOString(),syntheticOnly:true,prototypeOnly:false,complete:false,driverPID:process.pid,cases:[],errors:[],ownedServers:[]},save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));
const paragraph=(id,body)=>({id,type:'note',documentParagraph:true,title:'',body,x:0,y:0,w:320,h:160});
const note={id:'given-a',type:'note',title:'给定原话材料',body:'给定可取用原话 < & >\n给定出处。',userText:'给定补充',annotation:'给定材料A',tags:['给定'],color:'#fff0b4',x:10,y:20,w:320,h:200,sizeMode:'manual',opaque:{given:true}};
const table={id:'given-b',type:'table',title:'给定对照表',columns:['给定项目','给定出处'],rows:[['给定A','给定B']],rowIds:['r1'],columnIds:['c1','c2'],columnWidths:[180,220],cellImages:[[[],[]]],cellItems:[[[],[]]],x:20,y:30,w:400,h:220,sizeMode:'manual',opaque:{given:true}};
const resources=[{id:'resource-a',title:'给定原话资源',path:'',folder:'给定资料',mime:'application/x-creative-bundle',bundle:{nodes:[note],edges:[]},source:{boardId:'given-original-a',nodeIds:[note.id]},updated:1},{id:'resource-b',title:'给定表格资源',path:'',folder:'给定资料',mime:'application/x-creative-bundle',bundle:{nodes:[table],edges:[]},source:{boardId:'given-original-b',nodeIds:[table.id]},updated:1}];
(async()=>{let browser,server,exit,fd,page;
try{
 proof.head=execFileSync(process.env.GIT_EXE||'git',['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();proof.taskSHA256=hash(fs.readFileSync(__filename));proof.runtimeFiles={};for(const name of ['workspace.js','workspace-shell.js','pane.js','refinement.css','workspace-shell.css','explorer-navigation.js','experience.js','document-paper.js','document-paper.css','note-editor.js','note-editor.css','workflow.js','workflow.css','index.html'])proof.runtimeFiles[name]=hash(fs.readFileSync(path.join(R,name)));
 proof.serverSHA256=hash(fs.readFileSync(R+'/server.py'));proof.fixtureSHA256=hash(fs.readFileSync(R+'/tests/local_start_fixture.py'));proof.hostedDockerfileSHA256=hash(fs.readFileSync(R+'/hosted/Dockerfile'));save();
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 for(const[mode,program]of [['source',R]]){
  const out=path.join(O,mode);fs.mkdirSync(out);const data=path.join(out,'given-data');fs.mkdirSync(data);const hooks=path.join(out,'hooks');execFileSync(PY,[R+'/tests/local_start_fixture.py','--write-hooks',hooks],{windowsHide:true});
  const port=await require(R+'/tests/browser-port.cjs')(),base='http://127.0.0.1:'+port,env={...process.env,CREATIVE_BOARD_DATA_DIR:data,CREATIVE_BOARD_PORT:String(port),PYTHONPATH:hooks,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',START_FIXTURE_DATA_DENIED:'0',START_FIXTURE_LIFETIME:'90'};
  delete env.PYTHONHOME;for(const k of Object.keys(env))if(k.startsWith('CREATIVE_BOARD_HOSTED_'))delete env[k];
  fd=fs.openSync(out+'/server.log','w');server=spawn(PY,[program+'/server.py'],{cwd:program,env,windowsHide:true,stdio:['ignore',fd,fd]});exit=new Promise((resolve,reject)=>{server.once('exit',(code,signal)=>resolve({code,signal}));server.once('error',reject)});const owned={pid:server.pid,port,data,mode};proof.ownedServers.push(owned);save();
  try{
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,60))}assert(ready);
   const req=async(url,method='GET',body,tag)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(tag?{'If-Match':tag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(response.ok,url+' '+response.status);return{data:await response.json(),tag:response.headers.get('etag')}};
   proof.servedRuntimeFiles={};for(const[name,digest]of Object.entries(proof.runtimeFiles)){const response=await fetch(base+'/'+name);assert(response.ok);const actual=hash(Buffer.from(await response.arrayBuffer()));assert.equal(actual,digest);proof.servedRuntimeFiles[name]=actual}save();
   const catalog=await req('/api/assets');catalog.data.assets.push(...structuredClone(resources));await req('/api/assets','PUT',catalog.data,catalog.tag);const catalogBefore=(await req('/api/assets')).data;
   for(const [width,single] of [[1360,false],[320,false],[1360,true]]){
    const row={mode,width,intent:single?'single':'two-independent-pieces',phase:'start',actions:[],pickerOpenings:0,manualAnchorChanges:0,manualReturnsToOriginalParagraph:0};proof.cases.push(row);save();
    const step=async(label,fn)=>{row.actions.push(label);save();await fn()};
    const parts=[paragraph('p1','给定前文，保持。'),paragraph('p2','给定正在写的原段落，准备在这里接两块材料。'),paragraph('p3','给定后文，保持。')],doc={id:'document',type:'table',documentMode:true,title:'给定连续取用',body:'',x:30,y:20,w:640,h:720,sizeMode:'manual',columns:['正文'],rows:[['']],rowIds:['flow'],columnIds:['text'],columnWidths:[640],cellItems:[[parts]],cellImages:[[[]]],opaque:{given:true}};
    const given={format:'creative-board',version:1,name:'给定两块接续 '+width,nodes:[doc,{id:'neighbor',type:'note',title:'给定相邻内容',body:'保持原文。',x:950,y:40,w:260,h:190,sizeMode:'manual'}],edges:[{id:'given-relation',from:doc.id,to:'neighbor',label:'给定关联'}],view:{x:16,y:48,z:.35}};
    const id='given-'+mode+'-'+width+'-'+(single?'single':'multiple');await req('/api/boards/'+id,'PUT',given,'new');
    const context=await browser.newContext({viewport:{width,height:940},hasTouch:width===320,reducedMotion:'reduce'});try{
     page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>{proof.errors.push(error.message);save()});await page.goto(base+'/?board='+id);await page.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);
     const f=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame(),model=()=>f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)}));
     const expand=async()=>{await f.locator('#nodes>[data-id=document]').click({button:'right',position:{x:4,y:4}});await f.locator('#fileContext').getByRole('menuitem',{name:'展开编辑',exact:true}).click()};
     await expand();const body=f.locator('#immersiveSurface [data-cell-item="1"] [data-cell-note-field=body]'),capture=e=>({value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection,top:e.scrollTop,left:e.scrollLeft});
     await body.click();await page.keyboard.press('Control+End');for(let i=0;i<4;i++)await page.keyboard.press('Shift+ArrowLeft');const place=await body.evaluate(capture),before=await model(),originalField=await body.elementHandle(),historyBefore=await f.evaluate(()=>history.length);
     const open=async()=>{await step('打开段后添加菜单',()=>f.locator('#immersiveSurface .document-after summary').click());await step('打开内容库查找',()=>f.locator('#immersiveSurface .document-after').getByRole('button',{name:'从内容库取用…',exact:true}).click());row.pickerOpenings++;await f.locator('[data-document-library-search]').waitFor();await f.locator('[data-document-library-search]').waitFor({state:'visible'})};
     const choose=async resource=>{const query=resource.id==='resource-a'?'给定原话':'给定对照';await step('查找 '+query,()=>f.locator('[data-document-library-search]').fill(query));const entry=f.locator('[data-document-library-asset="'+resource.id+'"][data-document-library-piece="'+resource.bundle.nodes[0].id+'"]');await step('选择 '+resource.bundle.nodes[0].title,async()=>{
      const button=entry.locator('[data-document-library-place]');
      if(single){await button.click();return}
      const control=await button.elementHandle();
      await button.click();
      assert(await control.evaluate(el=>el.isConnected&&document.activeElement===el),'Selecting a result retains the focused control');
      await control.dispose();
     })};
     await open();if(!single)await step('选择一次取多块',()=>f.locator('[data-document-library-multiple]').check());await choose(resources[0]);
     if(single){
      await f.locator('.document-library').waitFor({state:'detached'});row.defaultSinglePieceWithoutModeSwitch=true;
     }else{
      await choose(resources[1]);const tray=f.locator('.document-library-chosen');await tray.waitFor();assert.equal(await tray.locator('[data-document-library-chosen]>div').count(),2);
      const titleText=await tray.innerText();assert(titleText.includes('给定原话材料')&&titleText.includes('给定对照表'));assert(titleText.indexOf('给定原话材料')<titleText.indexOf('给定对照表'));row.chosenOrderVisible=true;
      const remove=tray.getByRole('button',{name:'移除第 2 块',exact:true});
      await step('移除第二块后焦点留在上一块',async()=>{if(width===320)await remove.tap();else await remove.press('Enter')});
      const remaining=tray.getByRole('button',{name:'移除第 1 块',exact:true});
      assert.equal(await tray.locator('[data-document-library-chosen]>div').count(),1);
      row.removeFocusAfterSecond=await remaining.evaluate(el=>document.activeElement===el);save();
      assert(row.removeFocusAfterSecond,'Removing the last chosen row focuses the previous row');
      await step('移除仅剩一块后返回查找区域',()=>width===320?remaining.tap():remaining.press('Enter'));
      assert.equal(await tray.locator('[data-document-library-chosen]>div').count(),0);
      assert(await f.locator('[data-document-library-multiple]').evaluate(el=>document.activeElement===el));
      row.removeFocusWithoutVisibleResult=true;
      assert.deepEqual(await model(),before);
      await choose(resources[0]);
      await step('移除当前搜索结果后焦点回到该结果',()=>width===320?remaining.tap():remaining.press('Enter'));
      const resultA=f.locator('[data-document-library-asset="resource-a"] [data-document-library-place]');
      assert(await resultA.evaluate(el=>document.activeElement===el));row.removeFocusWithVisibleResult=true;
      await choose(resources[0]);await choose(resources[1]);
      assert.equal(await tray.locator('[data-document-library-chosen]>div').count(),2);
      row.removableSelectionLeavesDocumentExact=true;
      const overflow=await f.locator('.document-library').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert(overflow.scroll<=overflow.client+1);row.pickerHorizontalOverflowAbsent=true;
      await page.screenshot({path:out+'/'+width+'-chosen.png'});await step('一次接入两块副本',()=>tray.locator('[data-document-library-commit]').click());await f.locator('.document-library').waitFor({state:'detached'});
     }
     const actual=await model(),wanted=single?resources.slice(0,1):resources,copies=actual.nodes[0].cellItems[0][0].slice(2,2+wanted.length);assert.equal(copies.length,wanted.length);
     const expected=structuredClone(before);expected.nodes[0].cellItems[0][0].splice(2,0,...wanted.map((resource,i)=>({...structuredClone(resource.bundle.nodes[0]),id:copies[i].id,libraryOrigin:{id:resource.id,nodeId:resource.bundle.nodes[0].id,name:resource.title,source:structuredClone(resource.source)}})));
     assert.deepEqual(actual,expected);assert.deepEqual((await req('/api/assets')).data,catalogBefore);assert.deepEqual(await body.evaluate(capture),place);row.originalFieldIdentityRetained=await originalField.evaluate(e=>e.isConnected&&document.activeElement===e);assert(await body.evaluate(e=>document.activeElement===e));row.correctOrderContentsOriginsAndSourcesExact=true;row.originalFieldRangeRestored=true;
     const undoSteps=1;assert.equal(await f.evaluate(()=>history.length)-historyBefore,undoSteps);row.insertionUndoSteps=undoSteps;
     await f.locator('#immersiveReturn').click();const cb=await f.locator('#canvas').boundingBox();await page.mouse.click(cb.x+cb.width-20,cb.y+cb.height*.55);
     for(let i=0;i<undoSteps;i++)await page.keyboard.press('Control+z');assert.deepEqual(await model(),before);
     for(let i=0;i<undoSteps;i++)await page.keyboard.press('Control+Shift+z');assert.deepEqual(await model(),expected);row.insertionUndoRedoExact=true;
     await expand();await body.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 给定继续写作。');const continued=await body.inputValue();await page.keyboard.press('Control+z');assert.equal(await body.inputValue(),place.value);await page.keyboard.press('Control+Shift+z');assert.equal(await body.inputValue(),continued);row.nativeTextUndoRedoExact=true;expected.nodes[0].cellItems[0][0][1].body=continued;assert.deepEqual(await model(),expected);assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise);
     const saved=(await req('/api/boards/'+id)).data;assert.deepEqual({nodes:saved.nodes,edges:saved.edges},expected);await page.screenshot({path:out+'/'+width+'-'+(single?'single':'multiple')+'-continued.png'});
     const fresh=await context.newPage();await fresh.goto(base+'/?board='+id);await fresh.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);const ff=await(await fresh.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();assert.deepEqual(await ff.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)})),expected);await fresh.close();row.nativeContinueSaveFreshWorkbenchExact=true;row.phase='complete';save();
    }catch(error){row.failure=error.stack;if(page)await page.screenshot({path:out+'/'+width+'-failure.png'}).catch(()=>{});save();throw error}finally{await context.close();page=null}
   }
  }finally{if(server.exitCode===null&&server.signalCode===null)server.kill();owned.exit=await exit;owned.stopped=true;server=null;fs.closeSync(fd);fd=undefined;save()}
 }
 assert.deepEqual(proof.errors,[]);proof.complete=true;save();
}catch(error){proof.failure=error.stack;save();throw error}
finally{if(browser)await browser.close();proof.ownedBrowserStopped=true;if(server){if(server.exitCode===null&&server.signalCode===null)server.kill();const state=proof.ownedServers.at(-1);state.exit=await exit;state.stopped=true}if(fd!==undefined)fs.closeSync(fd);proof.ownedServicesStopped=proof.ownedServers.every(s=>s.stopped);save()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
