const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{chromium}=require('playwright');

async function exercise(p,{entry,images,widths=[1360,320],parts=['selection','writing','drag'],proof={groups:[],errors:[]}}={}){
 const base=new URL(entry).origin,shot=async name=>{if(images){fs.mkdirSync(images,{recursive:true});await p.screenshot({path:path.join(images,name+'.png')})}};
 const loaded=()=>p.waitForFunction(()=>current()&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading);
 const frame=async()=>await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();
 for(const width of widths){
  await p.setViewportSize({width,height:820});
  if(parts.includes('selection')){
   await p.goto(base+'/index.html?pane=1');await p.waitForFunction(()=>board&&!loading&&window.whiteboardDocumentPaper);if(await p.locator('#workspaceSidebar').isVisible()){await p.locator('#sidebarToggle').tap();await p.waitForFunction(()=>$('workspaceSidebar').hidden)}
   const original=await p.evaluate(width=>{
    board.nodes=[{id:'given-paper',type:'table',documentMode:true,title:'',body:'',tags:[],color:'#fffefa',x:420,y:457,w:640,h:720,sizeMode:'manual',columns:['正文'],rows:[['']],cellItems:[[[{id:'given-paragraph',type:'note',documentParagraph:true,title:'',body:'',x:0,y:0,w:320,h:160,tags:[]}]]]}];
    board.edges=[];board.view={x:width===320?-380:80,y:-140,z:1};history=[];future=[];selected.clear();editorId=null;render();return clone(board.nodes);
   },width);
   const node=p.locator('#nodes>[data-id=given-paper]'),r=await node.boundingBox(),canvas=await p.locator('#canvas').boundingBox(),x=(Math.max(r.x,canvas.x)+Math.min(r.x+r.width,canvas.x+canvas.width))/2,y=Math.max(r.y,canvas.y)+15;
   await p.touchscreen.tap(x,y);assert.deepEqual(await p.evaluate(()=>[...selected]),['given-paper'],'Touching blank paper selects the document instead of a nearby invisible paragraph grip');assert.equal(await p.locator('.cell-move-menu').count(),0);assert.deepEqual(await p.evaluate(()=>board.nodes),original);await shot(width+'-select-empty-paper');
   proof.groups.push(width+'px: touch the upper middle of an unselected empty paper; selection and all original objects remain exact');
  }
  if(parts.includes('drag')){
   await p.goto(base+'/index.html?pane=1');await p.waitForFunction(()=>board&&!loading&&window.whiteboardDocumentPaper);if(await p.locator('#workspaceSidebar').isVisible()){await p.locator('#sidebarToggle').tap();await p.waitForFunction(()=>$('workspaceSidebar').hidden)}
   const before=await p.evaluate(()=>{board.nodes=[{id:'given-paper',type:'table',documentMode:true,title:'给定段落排序',body:'',tags:[],color:'#fffefa',x:0,y:0,w:640,h:720,sizeMode:'manual',columns:['正文'],rows:[['']],cellItems:[[[{id:'first',type:'note',documentParagraph:true,title:'',body:'给定第一段。',x:0,y:0,w:320,h:160,tags:[],opaque:{keep:[true,'given']}},{id:'second',type:'note',documentParagraph:true,title:'',body:'给定第二段。',x:0,y:0,w:320,h:160,tags:[]}]]]}];board.edges=[];history=[];future=[];selected.clear();editorId=null;render();whiteboardReading.open('given-paper');return clone(board.nodes)});
   const source=p.locator('#immersiveSurface .document-paragraph [data-cell-move]').first(),target=p.locator('#immersiveSurface .document-paragraph').last();await source.waitFor({state:'visible'});await target.waitFor({state:'visible'});const s=await source.boundingBox(),t=await target.boundingBox(),start={x:s.x+s.width/2,y:s.y+s.height/2},end={x:t.x+t.width/2,y:t.y+t.height-4},cdp=await p.context().newCDPSession(p);
   try{
    const contact=(x,y)=>({x,y,id:1,radiusX:4,radiusY:4,force:1});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[contact(start.x,start.y)]});
    for(let i=1;i<=10;i++){await p.waitForTimeout(16);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[contact(start.x+(end.x-start.x)*i/10,start.y+(end.y-start.y)*i/10)]})}
    // Stop at the drop position before lifting: CDP also feeds Chromium's
    // gesture recognizer (touch_emulator_impl.cc). Keep the fast-release
    // reproduction separate; it also fails on the original program and native buttons.
    await p.waitForTimeout(220);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[contact(end.x,end.y)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForFunction(()=>document.activeElement?.closest('[data-cell-item]')?.dataset.cellItem==='1'&&document.activeElement.hasAttribute('data-cell-move'));
    const expected=structuredClone(before);expected[0].cellItems[0][0].reverse();assert.deepEqual(await p.evaluate(()=>board.nodes),expected,'A deliberate touch drag still moves the same paragraph, including all original fields');await shot(width+'-touch-drag');await p.locator('#immersiveReturn').tap();await p.locator('#dialog').waitFor({state:'hidden'});await p.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board.nodes),before);await p.keyboard.press('Control+Shift+z');assert.deepEqual(await p.evaluate(()=>board.nodes),expected);
   }finally{await cdp.detach()}
   proof.groups.push(width+'px: a controlled browser touch drop reorders the original paragraph, then Return and one-step Undo/Redo retain every field');
  }
  if(parts.includes('writing')){
   const name='Given document touch '+width;await p.goto(base+'/?create=1');await p.locator('#newBoardName').fill(name);await p.locator('#createBoard').tap();await p.waitForFunction(name=>current()?.name===name&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading,name);let f=await frame();assert.equal(await f.evaluate(()=>board.nodes.length),0);await f.locator('#emptyDocument').tap();await f.locator('#immersiveSurface [data-document-paper]').waitFor();
   const field=f.locator('#immersiveSurface .document-paragraph [data-cell-note-field=body]').first();await field.tap({position:{x:4,y:12}});assert(await field.evaluate(el=>el===document.activeElement),'Touching the start of a paragraph places the caret');assert.equal(await f.locator('.cell-move-menu').count(),0);
   await p.keyboard.insertText('给定原始记录。');await p.keyboard.insertText('给定新增字');await p.keyboard.press('Control+z');assert.equal(await field.inputValue(),'给定原始记录。');await p.keyboard.press('Control+Shift+z');assert.equal(await field.inputValue(),'给定原始记录。给定新增字');
   const title=f.locator('#title');await title.fill('给定触摸接续');await f.locator('.document-insert button').filter({hasText:'正文'}).tap();await f.locator('#immersiveSurface .document-paragraph [data-cell-note-field=body]').last().fill('给定第二段。');
   const before=await f.evaluate(()=>clone(board.nodes)),handle=f.locator('#immersiveSurface .document-paragraph [data-cell-move]').last(),body=handle.locator('..').locator('[data-cell-note-field=body]');
   const bounds=await handle.evaluate(el=>{const grip=el.getBoundingClientRect(),field=el.parentElement.querySelector('[data-cell-note-field=body]').getBoundingClientRect();return{grip:{x:grip.x,right:grip.right,w:grip.width,h:grip.height},field:{x:field.x,w:field.width}}});assert(bounds.grip.right<=bounds.field.x,'The actual touch grip never covers the start of the text');assert(bounds.grip.w>=44&&bounds.grip.h>=44,'Keep the touch target large enough for deliberate movement');assert(bounds.field.w>=190,'Keep a usable writing column at 320px');
   await body.tap({position:{x:4,y:12}});assert(await body.evaluate(el=>el===document.activeElement));await handle.tap();await f.locator('.cell-move-menu').waitFor();await f.locator('[data-move-order]').selectOption('start');await f.locator('[data-move-confirm]').tap();const moved=await f.evaluate(()=>clone(board.nodes));assert.deepEqual(moved[0].cellItems[0][0],[before[0].cellItems[0][0][1],before[0].cellItems[0][0][0]]);
   await shot(width+'-write-and-reorder');await f.locator('#immersiveReturn').tap();await f.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.deepEqual(await f.evaluate(()=>board.nodes),before);await p.keyboard.press('Control+Shift+z');assert.deepEqual(await f.evaluate(()=>board.nodes),moved);assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!contentDirty&&!savePromise&&!savingContent);
   const saved=await f.evaluate(()=>clone(board.nodes));await p.reload();await loaded();f=await frame();assert.deepEqual(await f.evaluate(()=>board.nodes),saved);await shot(width+'-saved-return');
   proof.groups.push(width+'px: touch the first character, write with native Undo/Redo, deliberately reorder the same paragraphs, undo/redo once and reopen saved objects');
  }
 }
 assert.deepEqual(proof.errors,[]);return proof;
}
module.exports={exercise};
if(require.main===module)(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-document-touch-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,proof={complete:false,syntheticOnly:true,groups:[],errors:[],physicalDeviceAccepted:false,controlledDropHoldMs:220};let browser;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:data,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();
 try{let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const context=await browser.newContext({viewport:{width:1360,height:820},hasTouch:true,reducedMotion:'reduce'});await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===base||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});const p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await exercise(p,{entry:base,images:process.env.DOCUMENT_TOUCH_IMAGES,widths:process.env.DOCUMENT_TOUCH_WIDTHS?.split(',').map(Number),parts:process.env.DOCUMENT_TOUCH_PARTS?.split(','),proof});proof.complete=true;console.log(JSON.stringify({complete:true,groups:proof.groups}));
 }catch(e){proof.failure=e.stack;throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));proof.ownedServiceStopped=true;proof.syntheticData=data;if(process.env.DOCUMENT_TOUCH_PROOF)fs.writeFileSync(process.env.DOCUMENT_TOUCH_PROOF,JSON.stringify(proof,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
