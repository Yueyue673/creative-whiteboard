const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-responsive-workspace-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const node=(id,title)=>({id,type:'note',title,body:'Original supplied text\nSecond line remains exact.',x:20,y:70,w:300,h:180,sizeMode:'manual',color:'#fff0aa'});
  const catalogResponse=await fetch(base+'/api/assets'),catalog=await catalogResponse.json();catalog.assets=[{id:'source',title:'Original library item',folder:'',path:'',mime:'application/x-creative-bundle',size:0,tags:[],notes:'',bundle:{nodes:[node('source-node','Original source')],edges:[]}}];assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':catalogResponse.headers.get('ETag')},body:JSON.stringify(catalog)})).ok);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  async function fixture(key,{width=1360,emptyRight=false,bothEmpty=false}={}){
   const entries=[{id:key+'-a',name:'Writing '+key,side:'left'},{id:key+'-b',name:'Reference '+key,side:'right'}];
   for(const b of entries){const nodes=bothEmpty||b.side==='right'?[]:[node(key+'-note',b.name)];assert((await fetch(base+'/api/boards/'+b.id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:b.name,folder:'',nodes,edges:[],view:{x:0,y:0,z:1}})})).ok)}
   const context=await browser.newContext({viewport:{width,height:850}});await context.addInitScript(({entries,emptyRight})=>{if(location.pathname!=='/'||sessionStorage.getItem('creative-board-tabs'))return;const tabs=entries.filter(b=>!emptyRight||b.side==='left').map(b=>({id:b.id,boardId:b.id,name:b.name,side:b.side}));sessionStorage.setItem('creative-board-tabs',JSON.stringify({tabs,active:{left:entries[0].id,right:emptyRight?null:entries[1].id},side:'left',split:true,ratio:63}));localStorage.setItem('creative-sidebar-state',JSON.stringify({open:true,tab:'assetPane'}))},{entries,emptyRight});
   const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForFunction(id=>pane(current())?.state().boardId===id&&!pane(current()).state().loading,entries[0].id);
   const a=p.frames().find(f=>new URL(f.url()).searchParams.get('board')===entries[0].id);await a.waitForFunction(()=>board&&!loading);
   return{p,a,entries,context,errors,ex:async()=>{await p.waitForFunction(()=>!!whiteboardWorkspace.explorer());return p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1')}};
  }
  const photograph=async(p,name)=>{if(process.env.RESPONSIVE_IMAGES){fs.mkdirSync(process.env.RESPONSIVE_IMAGES,{recursive:true});await p.screenshot({path:path.join(process.env.RESPONSIVE_IMAGES,name+'.png')})}};
  const group=async(name,action)=>{if(process.env.RESPONSIVE_ONLY&&!process.env.RESPONSIVE_ONLY.split(',').includes(name))return;await action();console.log('Responsive workspace '+name+' passed')};
  await group('writing',async()=>{
   const {p,a,context,errors}=await fixture('writing');
   await a.locator('[data-id="writing-note"]').dblclick();await a.locator('#body').focus();await a.locator('#body').evaluate(el=>el.setSelectionRange(2,13,'backward'));
   const before=await a.evaluate(()=>({value:$('body').value,nodes:clone(board.nodes),history:clone(history),future:clone(future)}));
   for(const size of [{width:820,height:650},{width:390,height:700}]){
    await p.setViewportSize(size);await p.waitForFunction(()=>document.querySelector('#workspace').classList.contains('workspace-focus'));
    assert.equal(await p.locator('#frameDeck iframe:visible').count(),1);assert(await a.locator('#canvas').evaluate(el=>el.clientWidth>=380));
    assert.deepEqual(await a.locator('#body').evaluate(el=>[el.value,el.selectionStart,el.selectionEnd,el.selectionDirection,el===document.activeElement]),[before.value,2,13,'backward',true]);
    if(size.width===390){assert(await p.locator('#globalExplorer').isHidden());assert.equal(await p.locator('#frameDeck').evaluate(el=>el.inert),false)}
   }
   await photograph(p,'01-narrow-writing');await p.setViewportSize({width:1360,height:900});await p.waitForFunction(()=>!document.querySelector('#workspace').classList.contains('workspace-focus'));
   assert.equal(await p.locator('#frameDeck iframe:visible').count(),2);assert(await p.locator('#globalExplorer').isVisible());assert.equal(await p.evaluate(()=>model.ratio),63);
   assert.deepEqual(await a.evaluate(()=>({value:$('body').value,nodes:clone(board.nodes),history:clone(history),future:clone(future)})),before);assert.deepEqual(errors,[]);await context.close();
  });
  await group('library',async()=>{
   const {p,a,context,errors}=await fixture('library',{width:390});await a.locator('[data-id="library-note"]').dblclick();await a.locator('#body').focus();await a.locator('#body').evaluate(el=>el.setSelectionRange(1,8,'backward'));const before=await a.locator('#body').inputValue();
   await p.locator('#openBoards').click();const ex=await (async()=>{await p.waitForFunction(()=>!!whiteboardWorkspace.explorer());return p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1')})();await ex.locator('#assetSearch').waitFor();await ex.locator('#assetSearch').focus();await ex.locator('#assetSearch').fill('Original');await ex.locator('#assetSearch').evaluate(el=>el.setSelectionRange(0,5,'backward'));
   assert.equal(await p.locator('#openBoards').getAttribute('aria-label'),'返回白板');assert.equal(await p.locator('#frameDeck').evaluate(el=>el.inert),true);assert(await ex.locator('#assetSearch').evaluate(el=>el.clientWidth>300));
   await photograph(p,'02-narrow-library');await p.setViewportSize({width:1360,height:900});await p.setViewportSize({width:390,height:700});
   assert.deepEqual(await ex.locator('#assetSearch').evaluate(el=>[el.value,el.selectionStart,el.selectionEnd,el.selectionDirection,el===document.activeElement]),['Original',0,5,'backward',true]);
   await p.locator('#openBoards').click();assert(await p.locator('#globalExplorer').isHidden());assert.deepEqual(await a.locator('#body').evaluate(el=>[el.value,el.selectionStart,el.selectionEnd,el.selectionDirection,el===document.activeElement]),[before,1,8,'backward',true]);
   assert.deepEqual(errors,[]);await context.close();
  });
  await group('activation',async()=>{
   const {p,context,errors}=await fixture('activation',{width:390});await p.getByRole('tab',{name:'Reference activation',exact:true}).click();await p.waitForFunction(()=>model.side==='right'&&pane(current())?.state().boardId==='activation-b'&&!pane(current()).state().loading);assert.equal(await p.locator('#frameDeck iframe:visible').count(),1);assert.equal(await p.evaluate(()=>current().boardId),'activation-b');assert.equal(await p.evaluate(()=>model.ratio),63);assert.deepEqual(errors,[]);await context.close();
  });
  await group('preference',async()=>{
   const {p,a,context,errors}=await fixture('preference',{width:390});const original=await a.evaluate(()=>clone(board.nodes));await p.locator('#shellMore>summary').click();await p.getByRole('button',{name:'小窗口始终并排',exact:true}).click();await p.waitForFunction(()=>model.narrowView==='split'&&model.tabs.every(t=>pane(t)?.state().boardId===t.boardId&&!pane(t).state().loading));
   assert.equal(await p.locator('#frameDeck iframe:visible').count(),2);assert(await p.locator('#globalExplorer').isVisible());assert.equal(await p.evaluate(()=>model.ratio),63);assert.deepEqual(await a.evaluate(()=>board.nodes),original);
   await p.reload();await p.waitForFunction(()=>model.narrowView==='split'&&model.tabs.every(t=>pane(t)?.state().boardId===t.boardId&&!pane(t).state().loading));assert.equal(await p.locator('#frameDeck iframe:visible').count(),2);
   await p.locator('#shellMore>summary').click();await p.getByRole('button',{name:'小窗口聚焦当前白板',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace').classList.contains('workspace-focus'));assert.equal(await p.locator('#frameDeck iframe:visible').count(),1);assert.equal(await p.evaluate(()=>model.ratio),63);assert.deepEqual(await p.frames().find(f=>new URL(f.url()).searchParams.get('board')==='preference-a').evaluate(()=>board.nodes),original);assert.deepEqual(errors,[]);await context.close();
  });
  await group('placement',async()=>{
   const {p,a,context,errors}=await fixture('placement',{width:390,bothEmpty:true});await p.locator('#openBoards').click();await p.waitForFunction(()=>!!whiteboardWorkspace.explorer());const ex=p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await ex.locator('[data-asset=source]').click({button:'right'});await ex.locator('#fileContext button').filter({hasText:/^添加选中的 1 项/}).click();await a.waitForFunction(()=>board.nodes.length===1&&!whiteboardImports.pending());await p.locator('#openBoards').click();
   const added=await a.evaluate(()=>{const n=board.nodes[0],c=canvas.getBoundingClientRect(),r=document.querySelector('[data-id="'+n.id+'"]').getBoundingClientRect();return{x:n.x,w:n.w,h:n.h,body:n.body,left:r.left-c.left,right:r.right-c.left,canvasWidth:c.width}});
   assert.equal(added.w,300);assert.equal(added.h,180);assert(added.left>=0&&added.right<=added.canvasWidth);assert.equal(added.body,'Original supplied text\nSecond line remains exact.');await photograph(p,'03-centered-original');
   const expected={x:731,y:622};await a.evaluate(async p=>{await loadAssets();await placeAssets(['source'],p)},expected);const second=await a.evaluate(()=>({x:board.nodes[1].x,y:board.nodes[1].y}));assert.deepEqual(second,expected);await a.locator('#canvas').focus();await p.keyboard.press('Control+z');await a.waitForFunction(()=>board.nodes.length===1);assert.equal(await a.evaluate(()=>board.nodes[0].body),added.body);
   assert.deepEqual(errors,[]);await context.close();
  });
  await group('empty-side',async()=>{
   const {p,a,context,errors}=await fixture('empty',{width:390,emptyRight:true});await p.locator('.add-tab[data-side=right]').click();await p.locator('#newBoardName').fill('New narrow reference');await p.locator('#createBoard').click();await p.waitForFunction(()=>current()?.name==='New narrow reference'&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading);assert.equal(await p.evaluate(()=>model.side),'right');assert.equal(await p.locator('#frameDeck iframe:visible').count(),1);assert.equal(await p.evaluate(()=>model.ratio),63);
   await p.setViewportSize({width:1360,height:900});await p.waitForFunction(()=>!document.querySelector('#workspace').classList.contains('workspace-focus'));assert.equal(await p.locator('#frameDeck iframe:visible').count(),2);await p.locator('#splitToggle').click();assert.equal(await p.evaluate(()=>model.split),false);await p.reload();await p.waitForFunction(()=>pane(current())?.state().boardId&&!pane(current()).state().loading);assert.equal(await p.evaluate(()=>model.split),false);assert.equal(await p.evaluate(()=>current().name),'New narrow reference');assert.deepEqual(errors,[]);await context.close();
  });
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
