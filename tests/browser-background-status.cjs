const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-background-status-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;
 const proof={completed:false,checks:[],errors:[],syntheticTemporaryDataOnly:true},originals={};
 const original=id=>({format:'creative-board',version:1,name:'Generic '+id,folder:'',nodes:[{id:'note',type:'note',x:20,y:30,w:320,h:240,sizeMode:'manual',title:'Generic source',body:'Original '+id}],edges:[],view:{x:0,y:0,z:1}});
 const snapshot=()=>{const result={};const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(item.isFile())result[path.relative(tmp,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');else throw Error('Unexpected linked test input');}};walk(tmp);return result;};
 async function check(name,fn){await fn();proof.checks.push(name);console.log('PASS '+name);}
 async function opened(p,id){await p.goto(base+'/?board='+id);await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);return boardFrame(p,id);}
 function boardFrame(p,id){return p.frames().find(frame=>frame.parentFrame()===p.mainFrame()&&new URL(frame.url()).searchParams.get('board')===id);}
 async function add(p,id){await p.locator('.add-tab[data-side=left]').click();await p.locator('[data-board-choice='+id+']').click();}
 async function currentIs(p,id){await p.waitForFunction(id=>current()?.boardId===id&&pane(current())?.state().boardId===id&&!pane(current()).state().loading,id);}
 async function edit(frame,body){await frame.waitForFunction(()=>window.whiteboardNoteEditor);await frame.locator('#nodes > [data-id=note]').dblclick({position:{x:90,y:25}});await frame.locator('#body').fill(body);await frame.locator('#body').evaluate(field=>field.setSelectionRange(2,8,'backward'));}
 const fieldState=frame=>frame.locator('#body').evaluate(field=>({value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,connected:field.isConnected}));
 const state=frame=>frame.evaluate(()=>({board:clone(board),history:clone(history),future:clone(future),view:clone(view()),selected:[...selected],editorId}));
 async function page(){const context=await browser.newContext({viewport:{width:1280,height:800}}),p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));return{context,p};}
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const id of ['A','B','C','D','E']){originals[id]=original(id);assert((await fetch(base+'/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(originals[id])})).ok);}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  await check('A real background conflict is visible from a clean board; keyboard return preserves the original live field, history, camera and stored originals.',async()=>{
   const{context,p}=await page();try{
    const b=await opened(p,'B'),r=await fetch(base+'/api/boards/B'),peer=await r.json();peer.nodes[0].body='Peer accepted exact';assert((await fetch(base+'/api/boards/B',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':r.headers.get('etag')},body:JSON.stringify(peer)})).ok);
    await edit(b,'  Own rejected exact <&> 😀  ');await b.waitForFunction(()=>blocked&&!savePromise);const field=await b.locator('#body').elementHandle(),before=await state(b),place=await fieldState(b);
    await add(p,'A');await currentIs(p,'A');const button=p.locator('#shellStatus .other-board-issue');await button.waitFor();assert.equal(await button.textContent(),'另有 1 张待处理');assert.equal(await p.title(),'另有 1 张待处理 · Generic A · 创作白板');
    const files=snapshot();await button.focus();await p.keyboard.press('Enter');await currentIs(p,'B');proof.returnDiagnostic=await field.evaluate(el=>({connected:el.isConnected,active:document.activeElement.id,live:!!el.closest('.live-layout'),readonly:el.readOnly,parents:[el.parentElement?.className,el.parentElement?.parentElement?.className]}));assert(await field.evaluate(el=>el.isConnected&&document.activeElement===el));assert.deepEqual(await fieldState(b),place);assert.deepEqual(await state(b),before);assert.equal(await p.locator('#shellStatus').textContent(),'有冲突 · 修改已保留');assert.deepEqual(snapshot(),files);
    assert.deepEqual(await(await fetch(base+'/api/boards/A')).json(),originals.A);assert.deepEqual(await(await fetch(base+'/api/boards/B')).json(),peer);
   }finally{await context.close();}
  });
  await check('A failed connection stays actionable from another board; returning does not retry the failed write or replace the exact input.',async()=>{
   const{context,p}=await page();try{
    const d=await opened(p,'D');let attempts=0;await p.route(base+'/api/boards/D',async route=>{if(route.request().method()==='PUT'){attempts++;await route.abort();}else await route.continue();});
    await edit(d,'  Original unsent exact 😀  ');await d.waitForFunction(()=>saveError&&!savePromise);await add(p,'A');await currentIs(p,'A');await p.locator('#shellStatus .other-board-issue').waitFor();await d.waitForFunction(()=>!savePromise);
    const count=attempts,before=await state(d),place=await fieldState(d),files=snapshot();await p.locator('#shellStatus .other-board-issue').click();await currentIs(p,'D');assert.deepEqual(await state(d),before);assert.deepEqual(await fieldState(d),place);assert.equal(attempts,count);assert.deepEqual(snapshot(),files);assert.deepEqual(await(await fetch(base+'/api/boards/D')).json(),originals.D);
   }finally{await context.close();}
  });
  await check('Multiple actual failed opens are counted in the existing narrow header slot; return and closing clear only the correct issue, and detached controls are inert.',async()=>{
   const{context,p}=await page();try{
    await opened(p,'A');for(const id of ['C','E']){await p.route(base+'/api/boards/'+id,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Generic fixture unavailable'})}));await add(p,id);await p.waitForFunction(()=>pane(current())?.state().loadError&&!pane(current()).state().loading);}
    await p.getByRole('tab',{name:'Generic A',exact:true}).click();await currentIs(p,'A');await p.setViewportSize({width:590,height:650});const button=p.locator('#shellStatus .other-board-issue');await button.waitFor();assert.equal(await button.textContent(),'另有 2 张待处理');const box=await button.boundingBox();assert(box.width>=44&&box.height>=44&&box.x>=0&&box.x+box.width<=590);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.BACKGROUND_STATUS_SCREENSHOT)await p.screenshot({path:process.env.BACKGROUND_STATUS_SCREENSHOT});
    const files=snapshot(),old=await button.elementHandle();await button.click();await p.waitForFunction(()=>current()?.boardId==='C');assert.equal(await p.locator('#shellStatus').textContent(),'无法打开 · 可重试');await old.evaluate(el=>el.click());assert.equal(await p.evaluate(()=>current().boardId),'C');
    await p.getByRole('button',{name:'关闭标签：Generic C',exact:true}).click();await p.getByRole('tab',{name:'Generic A',exact:true}).click();await currentIs(p,'A');assert.equal(await p.locator('#shellStatus .other-board-issue').textContent(),'另有 1 张待处理');
    await p.getByRole('button',{name:'关闭标签：Generic E',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('#shellStatus .other-board-issue'));assert.equal(await p.title(),'Generic A · 创作白板');assert.equal(await p.locator('#shellStatus').textContent(),'自动保存');await old.evaluate(el=>el.click());assert.equal(await p.evaluate(()=>current().boardId),'A');assert.deepEqual(snapshot(),files);
   }finally{await context.close();}
  });
  assert.deepEqual(proof.errors,[]);proof.completed=true;
 }finally{
  if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));if(process.env.BACKGROUND_STATUS_PROOF)fs.writeFileSync(process.env.BACKGROUND_STATUS_PROOF,JSON.stringify(proof,null,2));
  const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
