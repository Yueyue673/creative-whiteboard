const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const proof={complete:false,syntheticOnly:true,physicalDeviceAccepted:false,checks:[],errors:[]},record=()=>{if(process.env.BOARD_LINK_RETURN_PROOF)fs.writeFileSync(process.env.BOARD_LINK_RETURN_PROOF,JSON.stringify(proof,null,2))};
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-board-link-return-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,stdio:'ignore',env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:data}});let browser;
 const example=JSON.parse(fs.readFileSync(root+'/examples/getting-started.json','utf8'));
 const photo=async(p,name)=>{if(process.env.BOARD_LINK_RETURN_IMAGES){fs.mkdirSync(process.env.BOARD_LINK_RETURN_IMAGES,{recursive:true});await p.screenshot({path:path.join(process.env.BOARD_LINK_RETURN_IMAGES,name+'.png')})}};
 const ready=p=>p.waitForFunction(()=>typeof layoutLoaded!=='undefined'&&layoutLoaded&&current()&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading);
 const frame=async(p,key)=>{await p.waitForFunction(key=>model.tabs.some(t=>t.boardId===key&&pane(t)?.state().boardId===key&&!pane(t).state().loading),key);return(await p.evaluateHandle(key=>frames.get(model.tabs.find(t=>t.boardId===key).id),key)).asElement().contentFrame()};
 const layout=p=>p.evaluate(()=>({tabs:model.tabs.map(t=>({id:t.id,boardId:t.boardId,side:t.side})),active:{...model.active},side:model.side,split:model.split,ratio:model.ratio}));
 const open=async(p,key,side='left')=>{await p.locator('.add-tab[data-side='+side+']').click();await p.locator('[data-board-choice="'+key+'"]').click();return frame(p,key)};
 const flush=async f=>{assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise&&!contentDirty&&!savingContent)};
 try{
  let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){healthy=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(healthy);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const width of [1440,320]){
   const keys=['writer','source','background'].map(k=>k+'-'+width),names=['复用验收','公开示例来源','其他公开示例'];
   for(const [i,key]of keys.entries()){const value={...structuredClone(example),name:names[i]};const r=await fetch(base+'/api/boards/'+key,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)});assert.equal(r.status,200);await r.arrayBuffer()}
   const context=await browser.newContext({viewport:{width,height:width===320?820:940},hasTouch:width===320,reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));
   try{
    await p.goto(base+'/?board='+keys[0]);await ready(p);const writer=await frame(p,keys[0]);await writer.locator('[data-id=question]').click({position:{x:45,y:55}});await writer.locator('[data-id=question] .block-read').click();await writer.locator('#body').fill(example.nodes[1].body);await writer.locator('#immersiveReturn').click();await flush(writer);const saved=await writer.evaluate(()=>clone(board.nodes));
    await p.locator('#splitToggle').click();const source=await open(p,keys[1],'right');await flush(source);await open(p,keys[2]);await p.getByRole('tab',{name:names[0],exact:true}).click();await p.getByRole('tab',{name:names[1],exact:true}).click();
    if(width===1440){await p.locator('#splitter').focus();await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight')}
    const before=await layout(p);assert.equal(before.tabs.length,3);assert(before.split);assert.equal(new URL(p.url()).searchParams.get('board'),keys[1]);await photo(p,width+'-before-reload');
    await p.reload();await ready(p);const after=await layout(p);await photo(p,width+'-after-reload');assert.deepEqual(after,before,'Reloading this board-specific address must keep this window\'s saved tabs, active sides and ratio');assert.equal(await p.locator('.board-frame').count(),width===320?1:2,'Restore only the visible sides, preserving lazy background tabs');await p.getByRole('tab',{name:names[0],exact:true}).click();const returned=await frame(p,keys[0]);assert.deepEqual(await returned.evaluate(()=>clone(board.nodes)),saved);
    await p.getByRole('tab',{name:names[2],exact:true}).click();await frame(p,keys[2]);assert.equal(await p.locator('.board-frame').count(),3);assert.deepEqual((await(await fetch(base+'/api/boards/'+keys[1])).json()).nodes,example.nodes);
    const ownContext=await layout(p);
    // A new explicit link must keep its original single-board intent, even with a last layout.
    const explicit=await context.newPage();await explicit.goto(base+'/?board='+keys[0]);await ready(explicit);assert.deepEqual((await layout(explicit)).tabs.map(t=>t.boardId),[keys[0]]);assert.equal((await layout(explicit)).split,false);await explicit.close();
    // The original separate-window command may clone opener sessionStorage. It still starts alone.
    const popupReady=context.waitForEvent('page');await p.locator('#shellMore summary').click();await p.locator('#externalWindow').click();const popup=await popupReady;await ready(popup);assert.deepEqual((await layout(popup)).tabs.map(t=>t.boardId),[keys[2]]);assert.equal((await layout(popup)).split,false);await popup.close();
    await p.reload();await ready(p);assert.deepEqual(await layout(p),ownContext,'Another window\'s latest local preference must not replace this window\'s session layout');
    assert.deepEqual((await(await fetch(base+'/api/boards/'+keys[0])).json()).nodes,saved);proof.checks.push(width+'px: board-link reload retains this window, explicit new link and original separate-window command remain isolated, saved supplied writing/source data retained');record();
   }finally{await context.close()}
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;record();
 }catch(error){proof.failure=error.stack;record();throw error}
 finally{if(browser)await browser.close();server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));proof.servicesStopped=true;record();assert(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(data,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
