// Compare image edits visually while retaining the existing explicit update and undo.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=process.env.IMAGE_ORIGIN_COMPARE_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-image-origin-compare-proof-'));
 fs.mkdirSync(out,{recursive:true});const proof={syntheticOnly:true,physicalDeviceTested:false,cases:[],errors:[],complete:false},record=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const width of process.env.IMAGE_ORIGIN_COMPARE_WIDTH?[Number(process.env.IMAGE_ORIGIN_COMPARE_WIDTH)]:[1360,320]){
   const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-image-origin-compare-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
   const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});
   server.stdout.resume();server.stderr.resume();let c,p;
   try{
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
    c=await browser.newContext({viewport:{width,height:900},hasTouch:width===320});
    await c.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
    p=await c.newPage();p.on('pageerror',e=>proof.errors.push(e.message));
    const ready=async()=>{await p.waitForFunction(()=>board&&!loading&&window.whiteboardCanvasObjects);if(await p.locator('#workspaceSidebar').isVisible())await p.locator('#sidebarToggle').click()};
    await p.goto(base+'/index.html');await ready();
    const dt=await p.evaluateHandle(async()=>{const cv=document.createElement('canvas');cv.width=800;cv.height=500;const g=cv.getContext('2d');g.fillStyle='#d6e8e1';g.fillRect(0,0,800,500);g.fillStyle='#596e79';g.fillRect(100,100,180,180);g.fillStyle='#bb8c61';g.fillRect(500,250,200,120);const d=new DataTransfer();d.items.add(new File([await new Promise(r=>cv.toBlob(r))],'given-reference.png',{type:'image/png'}));return d});
    const cr=await p.locator('#canvas').boundingBox();await p.locator('#canvas').dispatchEvent('drop',{dataTransfer:dt,clientX:cr.x+cr.width*.45,clientY:cr.y+cr.height*.4});
    await p.waitForFunction(()=>board.nodes.some(n=>n.canvasObject?.kind==='image'));
    const sourceId=await p.evaluate(()=>board.nodes.find(n=>n.canvasObject?.kind==='image').id);
    await p.evaluate(id=>{Object.assign(board.nodes.find(n=>n.id===id),{x:25,y:140,w:300,h:187.5,title:'给定原图',body:'给定原件说明'});board.view={x:0,y:0,z:.8};drawNodes();change()},sourceId);
    async function edit(id){await p.locator('#nodes>.node[data-id="'+id+'"]').dblclick({position:{x:35,y:30}});await p.locator('#imageEditOriginal').evaluate(im=>im.complete?true:new Promise(r=>im.onload=r));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
    await edit(sourceId);await p.locator('[data-image-tool=text]').click();await p.locator('#imageMarkText').fill('给定原件标注');
    let frame=await p.locator('#imageEditPaper').boundingBox();await p.locator('#imageEditPaper').click({position:{x:frame.width*.3,y:frame.height*.55}});await p.locator('#imageEditApply').click();await p.evaluate(()=>persist());
    await p.locator('#canvas').focus();await p.keyboard.press('Control+Shift+l');await p.locator('#collectName').fill('给定图片资源');await p.getByRole('button',{name:'收进内容库',exact:true}).click();await p.locator('#collectName').waitFor({state:'hidden'});
    const catalog=async()=>await(await p.request.get(base+'/api/assets')).json(),libraryBefore=await catalog(),asset=libraryBefore.assets.find(a=>a.bundle),original=asset.bundle.nodes[0],boardKey=await p.evaluate(()=>boardId);
    await p.evaluate(async({assetId,sourceId})=>{await placeAssets([assetId],{x:25,y:140});const copy=board.nodes.find(n=>n.libraryOrigin?.id===assetId);Object.assign(copy,{x:25,y:140,w:240,h:160,title:'给定副本标题',body:'给定副本说明'});board.nodes.find(n=>n.id===sourceId).x=420;board.edges.push({id:'given-relation',from:sourceId,to:copy.id,label:'给定关联'});board.view={x:0,y:0,z:.8};drawNodes();change()},{assetId:asset.id,sourceId});
    const copyId=await p.evaluate(a=>board.nodes.find(n=>n.libraryOrigin?.id===a).id,asset.id),node=()=>p.evaluate(id=>clone(board.nodes.find(n=>n.id===id)),copyId),snap=()=>p.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)}));
    const mediaId=original.images[0].assetId,hash=async()=>crypto.createHash('sha256').update(await(await p.request.get(base+'/api/media/'+mediaId)).body()).digest('hex'),originalHash=await hash();
    async function changeLabel(text,crop=false){
     await edit(copyId);const box=await p.locator('#imageEditMarks text').boundingBox();await p.mouse.click(box.x+box.width*.2,box.y+box.height*.5);await p.locator('#imageMarkText').fill(text);
     if(crop){await p.locator('[data-image-tool=crop]').click();const paper=p.locator('#imageEditPaper'),r=await paper.boundingBox();await p.mouse.move(r.x+r.width*.1,r.y+r.height*.1);await p.mouse.down();await p.mouse.move(r.x+r.width*.85,r.y+r.height*.85,{steps:6});await p.mouse.up()}
     await p.locator('#imageEditApply').click();
    }
    await changeLabel('给定副本标注 <字>',true);await p.evaluate(()=>persist());
    const edited=await node(),beforePush=await snap(),row={width,copyId,originalHash};proof.cases.push(row);record();assert.deepEqual(await catalog(),libraryBefore);
    async function compare(direction){
     const card=p.locator('#nodes>.node[data-id="'+copyId+'"]');await card.click({button:'right',position:{x:35,y:30}});await p.getByText('来源与版本…',{exact:true}).click();await p.getByRole('button',{name:direction==='push'?'用这块内容更新原件':'查看库中更新',exact:true}).click();
     return p.locator('.wf-diff').filter({has:p.locator('label',{hasText:'图形与图片编辑'})});
    }
    async function inspect(diff,target,afterObject,direction){
     assert.equal(await diff.locator('.wf-image-diff').count(),2,'Both target states are visible images, not coordinate dumps');
     assert.equal(await diff.locator('pre').count(),0);
     assert.deepEqual(await diff.locator('.wf-diff-pair>div>small').allTextContents(),[direction==='push'?'库中原件（当前）':'白板副本（当前）','本项应用后']);
     const images=await diff.locator('img').evaluateAll(async imgs=>Promise.all(imgs.map(im=>im.complete?im.naturalWidth>0:new Promise(resolve=>{im.onload=()=>resolve(im.naturalWidth>0);im.onerror=()=>resolve(false)}))));assert(images.every(Boolean),'Both previews load the real original image');
     const states=await diff.locator('.wf-image-diff-frame').evaluateAll(frames=>frames.map(frame=>{const art=frame.querySelector('.image-art'),r=frame.getBoundingClientRect();return{ratio:Number(frame.style.getPropertyValue('--wf-image-ratio')),crop:Object.fromEntries(['x','y','w','h'].map(k=>[k,Number(art.style.getPropertyValue('--crop-'+k))])),text:frame.querySelector('svg text')?.textContent,src:frame.querySelector('img').getAttribute('src'),width:r.width,height:r.height}}));
     assert(states.every(s=>Math.abs(s.ratio-target.w/target.h)<1e-8&&s.width>0&&s.height>0),'The preview uses the target manual frame, not the source frame');
     assert.deepEqual(states[0].crop,target.canvasObject.crop);assert.deepEqual(states[1].crop,afterObject.crop);
     assert.equal(states[0].text,target.canvasObject.marks[0].text);assert.equal(states[1].text,afterObject.marks[0].text);
     const summaries=diff.locator('.wf-image-diff-text summary');assert.equal(await summaries.count(),2);
     for(let i=0;i<2;i++){await summaries.nth(i).click();const text=diff.locator('.wf-image-diff-text').nth(i).locator('p');assert(await text.isVisible());assert.equal(await text.textContent(),i===0?target.canvasObject.marks[0].text:afterObject.marks[0].text);await summaries.nth(i).click()}
     assert.equal(states[0].src,states[1].src,'This field retains the target original reference');
     const fits=await p.locator('#dialog').evaluate(dialog=>{const r=dialog.getBoundingClientRect(),body=document.querySelector('#dialogBody');return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&body.scrollWidth<=body.clientWidth+1});assert(fits,'The comparison remains readable in a narrow dialog');
     return states;
    }
    let diff=await compare('push');row.pushPreview=await inspect(diff,original,edited.canvasObject,'push');assert.deepEqual(await snap(),beforePush);assert.deepEqual(await catalog(),libraryBefore);await p.screenshot({path:path.join(out,width+'-push-comparison.png')});await p.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await snap(),beforePush);assert.deepEqual(await catalog(),libraryBefore);
    diff=await compare('push');for(const box of await p.locator('[data-wf-change]').all())await box.uncheck();await diff.locator('[data-wf-change]').check();await p.getByRole('button',{name:'应用勾选的修改',exact:true}).click();await p.locator('.wf-diffs').waitFor({state:'hidden'});
    const libraryAfter=await catalog(),updated=libraryAfter.assets.find(a=>a.id===asset.id);assert.deepEqual(updated.bundle.nodes[0],{...original,canvasObject:edited.canvasObject},'Only the checked image field updates the library target');
    const expected=structuredClone(libraryBefore),expectedAsset=expected.assets.find(a=>a.id===asset.id);expectedAsset.bundle.nodes[0].canvasObject=structuredClone(edited.canvasObject);expectedAsset.updated=updated.updated;assert.deepEqual(libraryAfter,expected);assert.deepEqual(await snap(),beforePush,'Pushing a reviewed field never edits the board or its history');
    await p.evaluate(()=>wfUndoLibrary());assert.deepEqual(await catalog(),libraryBefore);assert.deepEqual(await snap(),beforePush);await p.evaluate(()=>wfRedoLibrary());assert.deepEqual(await catalog(),libraryAfter);assert.deepEqual(await snap(),beforePush);row.pushCancelSelectiveUpdateAndLibraryUndoRedo=true;
    await changeLabel('给定尚未采用的副本标注');const beforePullNode=await node(),beforePull=await snap();diff=await compare('pull');row.pullPreview=await inspect(diff,beforePullNode,edited.canvasObject,'pull');assert.deepEqual(await snap(),beforePull);assert.deepEqual(await catalog(),libraryAfter);await p.screenshot({path:path.join(out,width+'-pull-comparison.png')});await p.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await snap(),beforePull);
    diff=await compare('pull');for(const box of await p.locator('[data-wf-change]').all())await box.uncheck();await diff.locator('[data-wf-change]').check();await p.getByRole('button',{name:'应用勾选的修改',exact:true}).click();await p.locator('.wf-diffs').waitFor({state:'hidden'});
    const adopted=await node();assert.deepEqual(adopted,{...beforePullNode,canvasObject:edited.canvasObject});assert.deepEqual(await catalog(),libraryAfter);const afterPull=await snap();assert.deepEqual(afterPull.nodes.filter(n=>n.id!==copyId),beforePull.nodes.filter(n=>n.id!==copyId));assert.deepEqual(afterPull.edges,beforePull.edges);
    await p.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.deepEqual(await node(),beforePullNode);await p.keyboard.press('Control+Shift+z');assert.deepEqual(await node(),adopted);row.pullCancelSelectiveUpdateAndBoardUndoRedo=true;
    await p.evaluate(()=>persist());await p.waitForFunction(()=>!dirty&&!savePromise&&!savingContent&&!contentDirty);const saved=await p.evaluate(()=>clone(board));assert.equal(await hash(),originalHash);await p.close();p=await c.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await p.goto(base+'/index.html?board='+encodeURIComponent(boardKey));await ready();assert.deepEqual(await p.evaluate(()=>board.nodes),saved.nodes);assert.deepEqual(await p.evaluate(()=>board.edges),saved.edges);assert.deepEqual(await catalog(),libraryAfter);assert.equal(await hash(),originalHash);row.savedNewWindowOriginalBytesAndRelationsExact=true;record();
   }catch(e){if(p)await p.screenshot({path:path.join(out,width+'-failure.png')}).catch(()=>{});throw e}
   finally{if(c)await c.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))}
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;record();console.log('Image origin comparison: actual target previews, selective push/pull, cancel, both histories, original bytes and new-window readback accepted: '+out);
 }catch(e){proof.failure=String(e.stack);record();throw e}finally{if(browser)await browser.close();proof.stopped=true;record()}
})().catch(e=>{console.error(e);process.exitCode=1});
