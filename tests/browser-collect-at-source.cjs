const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');

async function exercise(p,{entry,width,supplied,layoutOnly=false,capture=async()=>{},accept=()=>{}}){
 const act=el=>width===320?el.tap():el.click(),api=async route=>(await p.request.get(new URL(route,entry).href)).json();
 let a;
 const currentFrame=async()=>{await p.waitForFunction(()=>current()&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading);a=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();return a};
 const snap=()=>a.evaluate(()=>({board:clone(board),id:boardId,selected:[...selected],history:clone(history),future:clone(future)}));
 const settled=()=>a.waitForFunction(()=>!dirty&&!savePromise&&!contentDirty&&!savingContent);
 // Inverse canvas transforms can represent a 25px control as 24.999992px.
 const hit=loc=>loc.evaluate(el=>{const r=el.getBoundingClientRect(),over=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>=25-.001&&r.height>=24-.001&&r.x>=0&&r.right<=innerWidth+.1&&r.y>=0&&r.bottom<=innerHeight+.1&&(over===el||el.contains(over))});
 await p.goto(entry);await currentFrame();const first=await snap();assert.equal(first.board.nodes.length,0);assert.equal((await api('/api/assets')).assets.length,0);
 assert((await a.locator('#empty').innerText()).includes('下次也能接着用'));await capture('first-entry');
 await act(a.locator('#emptyWrite'));await a.locator('#title').fill(supplied[0].title);await a.locator('#body').fill(supplied[0].body);await act(a.getByRole('button',{name:'完成',exact:true}));await settled();
 const layout=async(catalog,title)=>{
  const preserved=await snap();
  for(const [w,h]of [[320,320],[320,220],[230,220],[82,300],[320,780]]){
   await p.setViewportSize({width:w,height:h});await a.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   if(await a.locator('#fit').isVisible())await act(a.locator('#fit'));
   else{await act(a.locator('#zoomValue'));await act(a.getByRole('menuitem',{name:/^查看全部/}));}
   await a.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   for(const button of await a.locator('.node.active .block-actions>button').all())if(await button.isVisible()){
    if(!await hit(button))assert.fail('Visible object action must receive its own hit at '+w+'x'+h+': '+JSON.stringify(await button.evaluate(el=>{const r=el.getBoundingClientRect(),over=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {class:el.className,rect:r.toJSON(),viewport:[innerWidth,innerHeight],hit:over?.outerHTML?.slice(0,350),contains:el.contains(over)}})));
   }
   const collect=a.locator('.node.active .block-collect');
   if(await collect.isVisible())await act(collect);
   else{
    await act(a.locator('#creationMore'));const beforeDouble=await snap();
    const point=await a.locator('#creationMore').evaluate(el=>{const r=el.getBoundingClientRect();return {clientX:r.x+r.width/2,clientY:r.y+r.height/2}});
    await a.locator('#creationMore').dispatchEvent('dblclick',{bubbles:true,...point});
    assert.deepEqual(await snap(),beforeDouble,'A delayed double-click on the original tool cannot create a blank note beneath its newly opened menu');
    await act(a.getByRole('menuitem',{name:/保存到库/}));
   }
   await a.locator('#collectName').waitFor();assert.equal(await a.locator('#collectName').inputValue(),title);await act(a.getByRole('button',{name:'取消',exact:true}));await capture('layout-'+w+'x'+h);
   const after=await snap();assert.deepEqual(after.board.nodes,preserved.board.nodes);assert.deepEqual(after.board.edges,preserved.board.edges);assert.deepEqual(after.history,preserved.history);assert.deepEqual(after.future,preserved.future);assert.deepEqual(await api('/api/assets'),catalog);
  }
  accept('320px touch context: original resource/return actions remain usable in short and narrow windows; cancel changes no content, geometry, history or resource.');
 };
 if(layoutOnly){await layout(await api('/api/assets'),supplied[0].title);return {layoutOnly:true};}
 const written=await snap(),local=a.locator('.node.active .block-collect');assert.equal(written.board.nodes[0].sizeMode,'auto');assert.equal(written.board.nodes[0].body,supplied[0].body);
 assert(await local.isVisible());assert(await hit(local));assert(await a.locator('#collectToLibrary').isHidden());await capture('selected-save');
 await act(local);await a.locator('#collectName').waitFor();assert.equal(await a.locator('#collectName').inputValue(),supplied[0].title);await act(a.getByRole('button',{name:'收进内容库',exact:true}));await a.locator('#collectName').waitFor({state:'hidden'});
 await act(a.getByRole('button',{name:'查看刚保存到内容库的资源',exact:true}));await p.waitForFunction(()=>whiteboardWorkspace.explorer());let ex=p.frames().find(f=>f.url().includes('explorer=1'));await ex.locator('[data-asset]').first().waitFor();
 const catalog=await api('/api/assets');assert.equal(catalog.assets.length,1);const resource=catalog.assets[0];assert.deepEqual(resource.bundle.nodes,written.board.nodes);assert.deepEqual((await snap()).board.nodes,written.board.nodes);await capture('saved-resource');
 accept(width+'px: a literal first note becomes a reusable resource in two native actions beside the note; one visible collection action, source fields untouched.');
 if(width===320)await act(p.getByRole('button',{name:'返回白板',exact:true}));
 await act(p.getByRole('button',{name:'关闭标签：'+first.board.name,exact:true}));await p.waitForFunction(()=>!current());await act(p.locator('.add-tab[data-side=left]'));await p.locator('#newBoardName').fill('Reuse acceptance '+width);await act(p.locator('#createBoard'));await currentFrame();const target=(await snap()).id;
 await act(a.locator('#emptyLibrary'));await act(ex.locator('[data-asset="'+resource.id+'"] [data-asset-preview]'));await ex.locator('.reuse-place').waitFor();await act(ex.locator('.reuse-place'));await a.waitForFunction(()=>board.nodes.length===1&&!contentDirty&&!savingContent);const placed=await snap();
 assert.equal(placed.board.nodes[0].body,supplied[0].body);assert.equal(placed.board.nodes[0].libraryOrigin.id,resource.id);assert.equal(placed.board.nodes[0].sizeMode,'auto');assert.deepEqual(await api('/api/assets'),catalog);
 await a.locator('#canvas').focus();await p.keyboard.press('Control+z');await a.waitForFunction(()=>!board.nodes.length);await p.keyboard.press('Control+Shift+z');await a.waitForFunction(()=>board.nodes.length===1);assert.deepEqual((await snap()).board.nodes,placed.board.nodes);
 await a.locator('#nodes>.node').click({position:{x:4,y:30}});await act(a.getByRole('button',{name:'展开编辑',exact:true}));await a.locator('#body').fill(supplied[1].body);await act(a.locator('#immersiveReturn'));await settled();const edited=await snap();
 assert.equal(edited.board.nodes[0].body,supplied[1].body);assert.deepEqual((await api('/api/boards/'+first.id)).nodes,written.board.nodes);assert.deepEqual(await api('/api/assets'),catalog);
 await act(p.getByRole('button',{name:'关闭标签：Reuse acceptance '+width,exact:true}));await p.reload();await p.waitForFunction(()=>layoutLoaded);await act(p.locator('.choose-board[data-side=left]'));await p.locator('#boardQuery').fill('Reuse acceptance '+width);await act(p.locator('[data-board-choice="'+target+'"]'));await currentFrame();assert.deepEqual((await snap()).board.nodes,edited.board.nodes);assert.deepEqual((await snap()).board.edges,edited.board.edges);await capture('reused-independent-return');
 accept(width+'px: close, new board, reuse, Undo/Redo, independent writing and fresh-page return preserve both saved resource and source board.');
 // Delayed callbacks must keep their original object and selection; no current-target lookup.
 await a.locator('#nodes>.node').click({position:{x:4,y:30}});await a.locator('.node.active .block-collect').evaluate(el=>window.delayedCollect=el.onclick);
 await a.locator('#canvas').focus();await p.keyboard.press('n');await a.locator('#title').fill(supplied[1].title);await a.locator('#body').fill(supplied[1].body);await act(a.locator('#inlineDone'));await settled();const other=await snap();assert.equal(other.board.nodes.length,2);
 assert(await a.locator('.node.active .block-collect').isEnabled());
 for(const inactive of await a.locator('.node:not(.active) .block-collect').all())assert(await inactive.isDisabled(),'Keyboard focus on a different paper must not offer an enabled action for the existing selection');
 await a.evaluate(()=>delayedCollect({stopPropagation(){}}));assert.equal(await a.locator('#dialog').evaluate(el=>el.open),false);assert.deepEqual(await api('/api/assets'),catalog);assert.deepEqual((await snap()).board.nodes,other.board.nodes);
 accept(width+'px: a delayed collection callback cannot collect a newly selected object or change either original.');
 if(width===320)await layout(catalog,supplied[1].title);
 return {first:first.id,target,resource:resource.id};
}
module.exports={exercise};
if(require.main===module)(async()=>{
 const root=path.resolve(__dirname,'..'),supplied=JSON.parse(fs.readFileSync(path.join(root,'examples/getting-started.json'),'utf8')).nodes;
 const proof={complete:false,syntheticOnly:true,physicalDeviceAccepted:false,checks:[],errors:[],cases:[]};let browser;
 const record=()=>{if(process.env.COLLECT_SOURCE_PROOF)fs.writeFileSync(process.env.COLLECT_SOURCE_PROOF,JSON.stringify(proof,null,2))};
 try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const width of process.env.COLLECT_SOURCE_LAYOUT_ONLY?[320]:[1440,320]){
   const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-collect-source-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();let context,p;
   try{let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
    context=await browser.newContext({viewport:{width,height:width===320?780:900},hasTouch:width===320,reducedMotion:'reduce'});p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));
    const result=await exercise(p,{entry:base+'/',width,supplied,layoutOnly:!!process.env.COLLECT_SOURCE_LAYOUT_ONLY,accept:check=>{proof.checks.push(check);record();console.log(check)},capture:async label=>{if(!process.env.COLLECT_SOURCE_IMAGES)return;fs.mkdirSync(process.env.COLLECT_SOURCE_IMAGES,{recursive:true});await p.screenshot({path:path.join(process.env.COLLECT_SOURCE_IMAGES,width+'-'+label+'.png')})}});proof.cases.push({width,...result});
   }catch(error){if(p&&process.env.COLLECT_SOURCE_IMAGES)await p.screenshot({path:path.join(process.env.COLLECT_SOURCE_IMAGES,width+'-failure.png')}).catch(()=>{});throw error}
   finally{if(context)await context.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true});record()}
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;
 }catch(error){proof.failure=error.stack;throw error}finally{if(browser)await browser.close();record()}
})().catch(error=>{console.error(error);process.exitCode=1});
