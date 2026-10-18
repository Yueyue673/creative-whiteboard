const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');

// Exercise the original workbench, its real picker and the unchanged library.
async function exercise(p,{entry,source,example,images,existingScope=null,parts=['library','boundaries'],proof={groups:[],errors:[]}}){
 const base=new URL(entry).origin,sourceNotes=source.bundle.nodes.filter(n=>n.type==='note').slice(0,2),question=example.nodes.find(n=>n.id==='question');
 const capture=async name=>{if(!images)return;fs.mkdirSync(images,{recursive:true});const file=path.join(images,name+'.png');await p.screenshot({path:file});(proof.images??=[]).push(file)};
 const settle=f=>f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const frame=async id=>{await p.waitForFunction(k=>{const t=model.tabs.find(t=>t.boardId===k);return pane(t)?.state().boardId===k&&!pane(t).state().loading},id);return(await p.evaluateHandle(k=>frames.get(model.tabs.find(t=>t.boardId===k).id),id)).asElement().contentFrame()};
 const open=async name=>{if(!await p.locator('#boardPicker').isVisible())await p.locator('.add-tab[data-side=left]').click();await p.locator('#newBoardName').fill(name);await p.locator('#createBoard').click();await p.waitForFunction(n=>current()?.name===n,name);const id=await p.evaluate(()=>current().boardId);return{id,f:await frame(id)}};
 const starts=['emptyWrite','emptyTable','emptyImport','emptyLibrary'];
 const reachable=async f=>{const canvas=await f.locator('#canvas').boundingBox();for(const id of starts){const b=await f.locator('#'+id).boundingBox();assert(b&&b.width>=44&&b.height>=44,id+' has a usable target');assert(b.x>=canvas.x-1&&b.y>=canvas.y-1&&b.x+b.width<=canvas.x+canvas.width+1&&b.y+b.height<=canvas.y+canvas.height+1,id+' stays inside the original canvas');await f.locator('#'+id).click({trial:true,timeout:1800})}};
 const catalogBefore=await p.request.get(base+'/api/assets').then(r=>r.json());
 if(parts.includes('library')){
 await p.setViewportSize({width:320,height:820});await p.goto(base+'/?create=1');
 const reused=await open('Start from existing content'),a=reused.f;
 assert(await a.locator('#creationDock').isHidden(),'An untouched empty board has one creation area');await reachable(a);await capture('320-start');
 await a.locator('#emptyLibrary').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());
 const ex=p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await ex.waitForFunction(()=>workspaceTab==='assetPane');
 await ex.locator('[data-asset="'+source.id+'"] [data-asset-preview]').click();for(const n of sourceNotes)await ex.locator('[data-piece="'+n.id+'"]').check();await ex.locator('.reuse-place').click();
 await a.waitForFunction(n=>board.nodes.length===n,sourceNotes.length);await ex.locator('#dialog').waitFor({state:'hidden'});await p.waitForFunction(()=>document.getElementById('globalExplorer').hidden);
 const inserted=await a.evaluate(()=>clone(board));for(const n of sourceNotes){const copy=inserted.nodes.find(c=>c.libraryOrigin?.nodeId===n.id);assert(copy);for(const k of Object.keys(n).filter(k=>!['id','x','y'].includes(k)))assert.deepEqual(copy[k],n[k])}
 const first=inserted.nodes[0];await a.locator('[data-id="'+first.id+'"] .block-read').click();await a.locator('#body').fill(first.body+'\n\n'+question.body);await a.locator('#immersiveReturn').click();assert(await a.evaluate(()=>whiteboardPane.flush()));
 const saved=await p.request.get(base+'/api/boards/'+reused.id).then(r=>r.json());assert.equal(saved.nodes[0].body,first.body+'\n\n'+question.body);assert.deepEqual(saved.edges,inserted.edges);await capture('320-reused-written');
 await p.goto(base+'/?board='+reused.id);const returned=await frame(reused.id);assert.deepEqual(await returned.evaluate(()=>clone(board)),saved);
 assert.deepEqual(await p.request.get(base+'/api/assets').then(r=>r.json()),catalogBefore);proof.groups.push('320px: one named start opens the content library directly; native preview/selection/place, literal writing, Save and a fresh page retain the source fields, manual sizes, relations and catalog');
 }
 if(!parts.includes('boundaries'))return proof;

 await p.setViewportSize({width:1360,height:900});if(existingScope)await p.goto(base+'/?board='+existingScope);else if(!parts.includes('library'))await p.goto(base+'/?create=1');const scope=existingScope?{id:existingScope,f:await frame(existingScope)}:await open('Start ownership'),s=scope.f;if(await p.locator('#globalExplorer').isVisible())await p.locator('#openBoards').click();await s.evaluate(()=>window.retainedStartLibrary=$('emptyLibrary').onclick);
 await p.locator('.add-tab[data-side=left]').click();await p.locator('#newBoardName').fill('Keep picker input');await s.evaluate(()=>retainedStartLibrary());await settle(s);
 assert(await p.locator('#boardPicker').isVisible());assert.equal(await p.locator('#newBoardName').inputValue(),'Keep picker input');assert(await p.locator('#globalExplorer').isHidden());await p.locator('#boardPicker .dialog-close').click();
 const other=await open('Other empty board');await s.evaluate(()=>retainedStartLibrary());await settle(other.f);assert.equal(await p.evaluate(()=>current().boardId),other.id);assert(await p.locator('#globalExplorer').isHidden());
 proof.startReadability=await other.f.evaluate(()=>{
  const saved=whiteboardAppearance.read(),results=[],lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]};
  try{for(const prefs of [{preset:'resolve'},{preset:'paper'},{preset:'resolve',custom:{canvas:'#ffffff',panel:'#202126'}},{preset:'paper',custom:{canvas:'#000000',panel:'#fafafa'}}]){whiteboardAppearance.apply(prefs);for(const selector of ['#empty h1','.empty-purpose','#emptyLibrary']){const style=getComputedStyle(document.querySelector(selector)),bg=style.backgroundColor==='rgba(0, 0, 0, 0)'?getComputedStyle(canvas).backgroundColor:style.backgroundColor,a=lum(style.color),b=lum(bg);results.push({prefs,selector,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})}}}finally{whiteboardAppearance.apply(saved)}return results;
 });assert(proof.startReadability.every(row=>row.contrast>=4.5),'Start instructions and the library action remain readable on the actual light/dark/custom canvas or button surface');
 for(const [width,height]of [[1360,900],[320,820],[640,320],[320,220],[230,220]]){await p.setViewportSize({width,height});await settle(other.f);await reachable(other.f);assert.equal(await other.f.evaluate(()=>board.nodes.length),0);await capture(width+'x'+height+'-fresh-start')}
 proof.groups.push('Four start choices remain native hit targets from wide and portrait to short 230px windows; retained callbacks cannot replace the parent picker or redirect a hidden tab');

 await p.setViewportSize({width:1360,height:900});await p.locator('[data-tab] .tab-open').filter({hasText:'Start ownership'}).click();await s.locator('#emptyTable').click();await s.waitForFunction(()=>board.nodes.length===1&&board.nodes[0].type==='table');
 assert.equal(await s.evaluate(()=>board.nodes[0].rows.length),3);assert.equal(await s.evaluate(()=>board.nodes[0].columns.length),3);await s.locator('[data-row="0"][data-col="0"]').fill(question.body);await s.locator('#inlineDone').click();assert(await s.evaluate(()=>whiteboardPane.flush()));
 const table=await s.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)}));assert.equal(table.nodes[0].rows[0][0],question.body);await s.evaluate(()=>retainedStartLibrary());await settle(s);assert(await p.locator('#globalExplorer').isHidden());
 await s.locator('#canvas').focus();await p.keyboard.press('Control+a');await p.keyboard.press('Delete');await s.waitForFunction(()=>$('empty').hidden===false&&board.nodes.length===0);await s.locator('#undo').waitFor({state:'visible'});
 for(const [width,height]of [[640,320],[320,220],[230,220]]){await p.setViewportSize({width,height});await settle(s);await reachable(s);await s.locator('#undo').click({trial:true,timeout:1800});await capture(width+'x'+height+'-start-with-recovery')}
 await s.locator('#undo').click();await s.waitForFunction(()=>board.nodes.length===1);assert.deepEqual(await s.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)})),table);
 await s.locator('#creationMore').click();await s.getByRole('menuitem',{name:/^重做/}).click();await s.waitForFunction(()=>board.nodes.length===0);await s.locator('#undo').click();assert(await s.evaluate(()=>whiteboardPane.flush()));
 await p.goto(base+'/?board='+scope.id);const tableReturn=await frame(scope.id);assert.deepEqual(await tableReturn.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)})),table);
 proof.groups.push('The table start uses the original 3×3 editor and saves supplied text; deleting the last table keeps native Undo discoverable, short-window Undo/More→Redo/Undo retain exact cells, dimensions and fresh-page content; a no-longer-empty callback does nothing');

 await p.setViewportSize({width:1360,height:900});await p.goto(base+'/index.html?board='+other.id);await p.waitForFunction(id=>boardId===id&&board&&!loading,other.id);await p.locator('#emptyLibrary').click();await p.waitForFunction(()=>workspaceTab==='assetPane'&&!document.getElementById('workspaceSidebar').hidden);
 assert.equal(await p.locator('[data-asset="'+source.id+'"] [data-asset-preview]').count(),1);assert.equal(await p.evaluate(()=>board.nodes.length),0);assert.deepEqual(await p.request.get(base+'/api/assets').then(r=>r.json()),catalogBefore);
 proof.groups.push('The same start uses the original standalone content-library panel without creating content or modifying its source');assert.deepEqual(proof.errors,[]);return proof;
}
module.exports={exercise};

if(require.main===module)(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-content-start-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,example=JSON.parse(fs.readFileSync(path.join(root,'examples/getting-started.json'))),proof={groups:[],errors:[],syntheticOnly:true,physicalDeviceAccepted:false,complete:false};
 const source={id:'supplied-start-content',title:example.name,folder:'',path:'',mime:'application/x-creative-bundle',size:0,notes:'',tags:[],bundle:{nodes:example.nodes.filter(n=>n.type==='note').slice(0,2),edges:[]}};
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser,p;
 try{let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const r=await fetch(base+'/api/assets');assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':r.headers.get('etag')},body:JSON.stringify({version:1,folders:[],folderIds:{},assets:[source]})})).ok);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const context=await browser.newContext({viewport:{width:320,height:820},reducedMotion:'reduce'});p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await exercise(p,{entry:base,source,example,images:process.env.CONTENT_START_IMAGES,proof});proof.complete=true;console.log(JSON.stringify({complete:true,groups:proof.groups}));
 }catch(e){proof.failure=e.stack;if(p&&process.env.CONTENT_START_IMAGES){fs.mkdirSync(process.env.CONTENT_START_IMAGES,{recursive:true});await p.screenshot({path:path.join(process.env.CONTENT_START_IMAGES,'failure.png')}).catch(()=>{})}throw e}
 finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));proof.servicesStopped=true;if(proof.complete){assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}else proof.retainedSyntheticData=tmp;if(process.env.CONTENT_START_PROOF)fs.writeFileSync(process.env.CONTENT_START_PROOF,JSON.stringify(proof,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
