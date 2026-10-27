// Native search navigation and compare-original return tasks using synthetic fixture content.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const R=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),O=process.env.SEARCH_RETURN_GUARDS_PROOF||path.join(R,'artifacts','search-writing-return-guards');assert(R&&O&&!fs.existsSync(O));fs.mkdirSync(O,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),proof={at:new Date().toISOString(),prototypeOnly:false,syntheticOnly:true,workingSourceAcceptance:true,complete:false,cases:[],errors:[],physicalDeviceTested:false};
const save=()=>fs.writeFileSync(O+'/result.json',JSON.stringify(proof,null,2));

(async()=>{
 proof.head=execFileSync(process.env.GIT_EXE||'git',['-C',R,'rev-parse','HEAD'],{encoding:'utf8'}).trim();proof.taskSHA256=hash(fs.readFileSync(__filename));proof.serverSHA256=hash(fs.readFileSync(R+'/server.py'));proof.hostedDockerfileSHA256=hash(fs.readFileSync(R+'/hosted/Dockerfile'));proof.runtimeFiles={};for(const name of ['workspace.js','workflow.js','workflow.css','note-editor.js','note-editor.css','pane.js','workspace-shell.js','refinement.css','document-paper.js','document-paper.css','index.html','library-spatial.js','library-spatial.css'])proof.runtimeFiles[name]=hash(fs.readFileSync(R+'/'+name));
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'wb-search-writing-guards-')),port=await require(R+'/tests/browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[R+'/server.py'],{windowsHide:true,stdio:['ignore',fs.openSync(O+'/server.log','a'),fs.openSync(O+'/server.log','a')],env:{...process.env,CREATIVE_BOARD_DATA_DIR:data,CREATIVE_BOARD_PORT:String(port)}});let browser,page;proof.ownedServer={pid:server.pid,port,data};save();
 const req=async(url,method='GET',body,etag)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(etag?{'If-Match':etag}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(response.ok,url+' '+response.status);return{value:await response.json(),etag:response.headers.get('etag')}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{const response=await fetch(base+'/api/health');await response.arrayBuffer();if(response.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  proof.servedRuntimeFiles={};for(const [name,digest]of Object.entries(proof.runtimeFiles)){const response=await fetch(base+'/'+name);assert(response.ok);const actual=hash(Buffer.from(await response.arrayBuffer()));assert.equal(actual,digest);proof.servedRuntimeFiles[name]=actual}
  const catalogue=(await req('/api/assets')).value;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});

  for(const [caseIndex,mode]of ['foreign','cancel-input','query-change','later-dialog','retry','missing','ambiguous','nonwriting'].entries()){
   const width=caseIndex%2===0?320:1360,key='guard-author-'+caseIndex,foreign='guard-source-'+caseIndex,name='给定外部资料 '+caseIndex,row={width,mode,phase:'prepare'};proof.cases.push(row);save();
   const make=(id,body,x=20)=>({id,type:'note',title:'给定同名资料',body,x,y:100,w:340,h:350,sizeMode:'manual',color:'#c9ddcb'});
   const authorNode={...make('given-author',Array.from({length:24},(_,i)=>'给定第'+i+'行由本人继续写。').join('\n')),title:'给定自己的记录',color:'#fff0aa'},wrong=make('same-source-id','给定跨板针：本页同ID错误资料。',800),target=make('same-source-id','给定跨板针：外部准确原文 '+caseIndex,1000);
   const value={format:'creative-board',version:1,name:'给定作者 '+caseIndex,folder:'',nodes:[authorNode,wrong],edges:[],view:{x:0,y:0,z:1}},source={...structuredClone(value),name,nodes:[target],view:{x:0,y:0,z:1}};
   await req('/api/boards/'+key,'PUT',value,'new');await req('/api/boards/'+foreign,'PUT',source,'new');
   const context=await browser.newContext({viewport:{width,height:780},reducedMotion:'reduce',hasTouch:width===320});await context.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
   page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>{proof.errors.push(error.message);save()});await page.goto(base+'/?board='+key);await page.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);
   const author=await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();
   if(mode!=='nonwriting'){await author.evaluate(()=>whiteboardPane.focusNode('given-author'));await author.locator('[data-id="given-author"]').dblclick({position:{x:70,y:25}});const live=author.locator('.live-layout textarea#body');await live.waitFor();await live.evaluate(el=>{el.focus();el.setSelectionRange(10,25,'backward');el.scrollTop=30;window.originalSearchWritingField=el})}
   const field=author.locator('.live-layout textarea#body'),snap=()=>author.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future),view:clone(view()),selected:[...selected],editorId})),before=await snap();
   const position=mode==='nonwriting'?null:await field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,scroll:el.scrollTop}));
   const open=async()=>{await page.keyboard.press('Control+k');await author.locator('#wfSearchQuery').fill('给定跨板针');const result=author.locator('.wf-result').filter({hasText:name}).filter({hasText:target.body});await result.waitFor();assert.equal(await result.count(),1);return author.locator('.wf-search-result-row').filter({has:result}).locator('[data-compare-result]')};
   const choice=await open();
   if(mode==='nonwriting'){assert.equal(await author.locator('[data-compare-result]').count(),0);await page.keyboard.press('Escape');await context.close();row.noCompareOutsideWriting=true;row.phase='complete';save();continue}
   await author.evaluate(()=>{const original=whiteboardNoteEditor.compareSearchResult;window.givenCompareSettled=0;whiteboardNoteEditor.compareSearchResult=async function(...args){try{return await original(...args)}finally{window.givenCompareSettled++}}});
   let reads=0,held=null,first=true;
   await page.route(base+'/api/boards/'+foreign,async route=>{
    if(route.request().method()!=='GET')return route.continue();reads++;
    if(['cancel-input','query-change','later-dialog','foreign'].includes(mode)&&first){first=false;held=route;return}
    if(mode==='retry'&&first){first=false;return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'给定资料暂时不可读'})})}
    if(mode==='missing')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...source,nodes:[]})});
    if(mode==='ambiguous')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...source,nodes:[target,{...target,body:'给定另一份同ID'}]})});
    return route.continue();
   });
   await choice.click();
   if(['cancel-input','query-change','later-dialog','foreign'].includes(mode)){
    for(let i=0;i<80&&!held;i++)await new Promise(r=>setTimeout(r,10));assert(held);assert.equal(reads,1);
    if(mode==='foreign'){
     assert(await choice.isDisabled());await choice.evaluate(el=>{el.click();el.click()});assert.equal(reads,1);
     await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify(source)});
    }else{
     if(mode==='query-change')await author.locator('#wfSearchQuery').fill('新的给定查找');
     else{await page.keyboard.press('Escape');await author.waitForFunction(()=>!document.getElementById('dialog').open)}
     if(mode==='cancel-input'){await field.focus();await page.keyboard.insertText('给定后写');}
     if(mode==='later-dialog')await author.evaluate(()=>showDialog('<h2>给定后开的窗口</h2><input id="givenLaterInput">',[['关闭',()=>document.getElementById('dialog').close()]]));
     const after=await snap(),active=await author.evaluate(()=>({id:document.activeElement.id,value:document.activeElement.value||''}));
     await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify(source)});await author.waitForFunction(()=>window.givenCompareSettled===1);
     assert.equal(await author.locator('.note-source-peek').count(),0);assert.deepEqual(await snap(),after);assert.deepEqual(await author.evaluate(()=>({id:document.activeElement.id,value:document.activeElement.value||''})),active);assert(await author.evaluate(()=>window.originalSearchWritingField.isConnected));
     row.lateReadCannotOpenMoveFocusOrOverwrite=true;if(mode==='cancel-input')assert((await field.inputValue()).includes('给定后写'));
    }
   }
   if(['retry','missing','ambiguous'].includes(mode)){
    await author.waitForFunction(()=>window.givenCompareSettled===1);await author.waitForFunction(()=>{const el=document.getElementById('wfSearchStatus');return el&&el.textContent!=='正在打开原文…'});assert(await author.locator('#dialog').evaluate(el=>el.open));assert.equal(await author.locator('.note-source-peek').count(),0);assert.deepEqual(await snap(),before);assert.equal(await field.inputValue(),position.value);
    row.failurePreservesSearchAuthorAndSelection=true;
    if(mode==='retry'){assert.equal(reads,1);assert(await choice.isEnabled());await choice.click();assert.equal(reads,2)}
   }
   if(['foreign','retry'].includes(mode)){
    await author.waitForFunction(foreign=>whiteboardNoteEditor.sourceContext(document.querySelector('.note-source-card:not([hidden])'))?.board===foreign,foreign);
    const actual=await author.evaluate(()=>whiteboardNoteEditor.sourceContext(document.querySelector('.note-source-card:not([hidden])')));assert.equal(actual.node.id,target.id);assert.equal(actual.node.body,target.body);assert.equal(await author.evaluate(()=>boardId),key);assert.deepEqual(await snap(),before);
    await author.waitForFunction(body=>[...document.querySelectorAll('.note-source-card:not([hidden]) textarea')].some(el=>el.value===body&&el.readOnly&&el.getClientRects().length),target.body);
    await page.screenshot({path:O+'/'+mode+'-'+width+'.png'});await author.locator('.source-peek-return').click();await author.waitForFunction(()=>!document.querySelector('.note-source-peek'));assert.deepEqual(await field.evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,scroll:el.scrollTop})),position);assert(await author.evaluate(()=>document.activeElement===window.originalSearchWritingField));row.exactForeignIdentityAndOriginalWriterReturn=true;
   }
   assert.deepEqual((await req('/api/boards/'+foreign)).value,source);assert.deepEqual((await req('/api/assets')).value,catalogue);row.readCount=reads;row.phase='complete';save();await context.close();page=null;
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;save();
 }catch(error){proof.failure=error.stack;if(page)await page.screenshot({path:O+'/failure.png'}).catch(()=>{});save();throw error}
 finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));proof.ownedServicesStopped=true;save()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
