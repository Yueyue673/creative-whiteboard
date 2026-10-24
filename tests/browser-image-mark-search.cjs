// Applied image labels are searchable without rewriting or opening an edit draft.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=process.env.IMAGE_MARK_SEARCH_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-image-mark-search-proof-'));
 fs.mkdirSync(out,{recursive:true});
 const proof={syntheticOnly:true,physicalDeviceTested:false,cases:[],errors:[],complete:false},record=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const width of process.env.IMAGE_MARK_SEARCH_WIDTH?[Number(process.env.IMAGE_MARK_SEARCH_WIDTH)]:[1360,320]){
   const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-image-mark-search-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
   const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});
   server.stdout.resume();server.stderr.resume();let c,p,release=()=>{};
   try{
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
    c=await browser.newContext({viewport:{width,height:900},hasTouch:width===320});
    await c.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
    p=await c.newPage();p.on('pageerror',e=>proof.errors.push(e.message));
    const ready=async()=>{await p.waitForFunction(()=>board&&!loading&&window.whiteboardCanvasObjects);if(await p.locator('#workspaceSidebar').isVisible())await p.locator('#sidebarToggle').click()};
    await p.goto(base+'/index.html');await ready();
    const dt=await p.evaluateHandle(async()=>{const cv=document.createElement('canvas');cv.width=800;cv.height=500;const g=cv.getContext('2d');g.fillStyle='#d6e8e1';g.fillRect(0,0,800,500);g.fillStyle='#596e79';g.fillRect(100,100,180,180);const d=new DataTransfer();d.items.add(new File([await new Promise(r=>cv.toBlob(r))],'given-reference.png',{type:'image/png'}));return d});
    const cr=await p.locator('#canvas').boundingBox();await p.locator('#canvas').dispatchEvent('drop',{dataTransfer:dt,clientX:cr.x+cr.width*.45,clientY:cr.y+cr.height*.4});
    await p.waitForFunction(()=>board.nodes.some(n=>n.canvasObject?.kind==='image'));
    const id=await p.evaluate(()=>board.nodes.find(n=>n.canvasObject?.kind==='image').id);
    await p.evaluate(id=>{const n=board.nodes.find(n=>n.id===id);Object.assign(n,{x:25,y:140,w:300,h:187.5,title:'给定参照图'});board.view={x:0,y:0,z:.8};drawNodes();change()},id);
    const card=()=>p.locator('#nodes>.node[data-id="'+id+'"]'),node=()=>p.evaluate(id=>clone(board.nodes.find(n=>n.id===id)),id),snap=()=>p.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)}));
    async function edit(){await card().dblclick({position:{x:35,y:30}});await p.locator('#imageEditOriginal').evaluate(im=>im.complete?true:new Promise(r=>im.onload=r));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
    const oldText='给定青杏标签 <词>',newText='给定银杏清单 <词>',cancelled='给定取消草稿',nested='给定嵌套海盐';
    await edit();await p.locator('[data-image-tool=text]').click();await p.locator('#imageMarkText').fill(oldText);
    let frame=await p.locator('#imageEditPaper').boundingBox();await p.locator('#imageEditPaper').click({position:{x:frame.width*.2,y:frame.height*.55}});
    await p.locator('#imageEditApply').click();await p.evaluate(()=>persist());
    const original=await node(),originalBoardId=await p.evaluate(()=>boardId),assetId=original.images[0].assetId;
    const mediaHash=async()=>crypto.createHash('sha256').update(await(await p.request.get(base+'/api/media/'+assetId)).body()).digest('hex'),originalHash=await mediaHash();
    await p.locator('#canvas').focus();await p.keyboard.press('Control+Shift+l');await p.locator('#collectName').fill('给定标注资源');await p.getByRole('button',{name:'收进内容库',exact:true}).click();await p.locator('#collectName').waitFor({state:'hidden'});
    const catalog=await(await p.request.get(base+'/api/assets')).json(),row={width,originalBoardId,originalHash,queries:[]};proof.cases.push(row);record();
    async function search(q){await p.locator('#canvas').focus();await p.keyboard.press('Control+k');await p.locator('#wfSearchQuery').fill(q);await p.waitForFunction(()=>document.querySelector('#wfSearchStatus')?.textContent.startsWith('显示'));return p.locator('.wf-result').filter({has:p.locator('small',{hasText:'当前工作内容'})})}
    const before=await snap(),hit=await search(oldText),api=await(await p.request.get(base+'/api/search?q='+encodeURIComponent(oldText))).json();
    row.queries.push({q:oldText,currentHits:await hit.count(),serverBoardHits:api.results.filter(r=>r.kind==='board'&&r.boardId===originalBoardId).length,serverLibraryHits:api.results.filter(r=>r.kind==='library').length});record();
    assert.equal(await hit.count(),1,'Applied image text appears in current-work results');
    assert.equal(await hit.locator('mark').textContent(),oldText,'Result preserves literal authored characters and escapes markup');
    assert(api.results.some(r=>r.kind==='board'&&r.id===id));assert(api.results.some(r=>r.kind==='library'));
    await p.screenshot({path:path.join(out,width+'-applied-label-search.png')});await hit.click();
    assert.deepEqual(await p.evaluate(()=>[...selected]),[id]);assert.deepEqual(await snap(),before,'Search/select does not write content or edit history');assert.equal(await p.locator('#imageEditPaper').count(),0);
    // Cancel a real editor draft; it never enters current or saved search.
    await edit();let textBox=await p.locator('#imageEditMarks text').boundingBox();await p.mouse.click(textBox.x+textBox.width*.2,textBox.y+textBox.height*.5);
    await p.locator('#imageMarkText').fill(cancelled);await p.locator('#imageEditCancel').click();assert.deepEqual(await snap(),before);
    assert.equal(await(await search(cancelled)).count(),0);await p.keyboard.press('Escape');assert.equal((await(await p.request.get(base+'/api/search?q='+encodeURIComponent(cancelled))).json()).results.length,0);
    // Applied input is discoverable while a real save acknowledgement is held.
    let hold=true,arrivals=0;const gate=new Promise(r=>release=r);
    await p.route('**/api/boards/*',async route=>{if(hold&&route.request().method()==='PUT'){arrivals++;await gate}await route.continue()});
    await edit();textBox=await p.locator('#imageEditMarks text').boundingBox();await p.mouse.click(textBox.x+textBox.width*.2,textBox.y+textBox.height*.5);await p.locator('#imageMarkText').fill(newText);await p.locator('#imageEditApply').click();
    const changed=await node(),pending=await snap();assert.equal(changed.canvasObject.marks[0].text,newText);
    const current=await search(newText);assert.equal(await current.count(),1);assert.deepEqual(await snap(),pending);await p.keyboard.press('Escape');
    assert.equal(await(await search(oldText)).count(),0,'Stale saved image text is excluded for the current board');
    const stale=await(await p.request.get(base+'/api/search?q='+encodeURIComponent(oldText))).json();assert(stale.results.some(r=>r.kind==='board'&&r.boardId===originalBoardId));await p.keyboard.press('Escape');
    await p.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.deepEqual(await node(),original);assert.equal(await(await search(oldText)).count(),1);await p.keyboard.press('Escape');await p.locator('#canvas').focus();await p.keyboard.press('Control+Shift+z');assert.deepEqual(await node(),changed);
    hold=false;release();await p.evaluate(()=>persist());await p.waitForFunction(()=>!dirty&&!savePromise&&!savingContent&&!contentDirty);row.cancelledDraftExcluded=true;row.appliedPendingInputAndUndoRedo=true;row.delayedPuts=arrivals;
    // The same mark extractor is used through existing table attachments.
    await p.evaluate(({id,nested})=>{const image=clone(board.nodes.find(n=>n.id===id));image.id='given-nested-image';image.canvasObject.marks[0].text=nested;image.x=0;image.y=0;board.nodes.push({id:'given-table',type:'table',title:'给定资料表',x:390,y:140,w:380,h:250,columns:['资料'],rows:[['']],cellItems:[[[image]]]});board.edges.push({id:'given-edge',from:id,to:'given-table',label:'给定关联'});drawNodes();change()},{id,nested});await p.evaluate(()=>persist());
    const nestedBefore=await snap(),nestedHit=await search(nested);assert.equal(await nestedHit.count(),1);await nestedHit.click();assert.deepEqual(await p.evaluate(()=>[...selected]),['given-table']);assert.deepEqual(await snap(),nestedBefore);
    if(!await p.locator('#assetsButton').isVisible())await p.locator('#sidebarToggle').click();await p.locator('#assetsButton').click();await p.locator('#assetSearch').fill(oldText);assert.equal(await p.locator('#assetList [data-asset]').count(),1);await p.locator('#assetSearch').fill(newText);assert.equal(await p.locator('#assetList [data-asset]').count(),0,'Changing a board copy never rewrites the library original');await p.locator('#sidebarToggle').click();
    assert.deepEqual(await(await p.request.get(base+'/api/assets')).json(),catalog);assert.equal(await mediaHash(),originalHash);row.libraryOriginalAndNestedImage=true;
    const final=await snap();await p.close();p=await c.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await p.goto(base+'/index.html?board='+encodeURIComponent(originalBoardId));await ready();assert.deepEqual(await p.evaluate(()=>board.nodes),final.nodes);assert.deepEqual(await p.evaluate(()=>board.edges),final.edges);
    for(const q of [newText,nested]){assert.equal(await(await search(q)).count(),1);await p.keyboard.press('Escape')}
    const savedAPI=await(await p.request.get(base+'/api/search?q='+encodeURIComponent(newText))).json();assert(savedAPI.results.some(r=>r.kind==='board'&&r.id===id));
    assert.equal(await mediaHash(),originalHash);assert.deepEqual(await(await p.request.get(base+'/api/assets')).json(),catalog);row.newWindowSearchAndOriginalBytes=true;record();
   }catch(e){if(p)await p.screenshot({path:path.join(out,width+'-failure.png')}).catch(()=>{});throw e}
   finally{release();if(c)await c.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))}
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;record();console.log('Applied image text: exact search, pending saves, cancellation, Undo/Redo, nested images, library originals and new-window readback accepted: '+out);
 }catch(e){proof.failure=String(e.stack);record();throw e}finally{if(browser)await browser.close();proof.stopped=true;record()}
})().catch(e=>{console.error(e);process.exitCode=1});
