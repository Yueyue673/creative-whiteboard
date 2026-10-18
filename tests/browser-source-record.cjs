const assert=require('node:assert/strict');

// Exercise the original shell and original editor; fixture text is supplied by the test.
async function exerciseSourceRecord(p,url,fixture,options={}){
 const checks=[],accept=text=>{checks.push(text);options.accept?.(text)},act=el=>options.touch?el.tap():el.click();
 await p.goto(url,{waitUntil:'domcontentloaded'});
 const embedded=options.embedded!==false;
 if(embedded)await p.waitForFunction(key=>pane(current())?.state()?.boardId===key&&!pane(current()).state().loading,fixture.key);
 let a=embedded?await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame():p.mainFrame();
 await a.waitForFunction(key=>boardId===key&&!loading&&!!window.whiteboardNoteEditor,fixture.key);
 if(!embedded&&await a.locator('#workspaceSidebar').isVisible())await act(a.locator('#sidebarToggle'));
 const original=await a.evaluate(()=>clone(board));
 // A point near the border selects media as well as text without opening either.
 await a.locator('#nodes>[data-id="'+fixture.sourceId+'"]').click({position:{x:4,y:30}});
 await act(a.locator('#nodes>[data-id="'+fixture.sourceId+'"] .block-write-record'));
 const id=await a.evaluate(()=>editorId);assert(id&&!original.nodes.some(n=>n.id===id));
 assert.equal(await a.locator('#body').inputValue(),'');assert.equal(await a.locator('#title').inputValue(),'');
 let created=await a.evaluate(()=>clone(board));assert.deepEqual(created.nodes.filter(n=>n.id!==id),original.nodes);
 const edge=created.edges.find(e=>e.from===id&&e.to===fixture.sourceId);assert(edge);assert.equal(edge.label,'');assert.equal(created.edges.length,original.edges.length+1);
 await act(a.locator('#inlineDone'));await a.locator('#canvas').focus();await p.keyboard.press('Control+z');
 assert.deepEqual(await a.evaluate(()=>board.nodes),original.nodes);assert.deepEqual(await a.evaluate(()=>board.edges),original.edges);
 await p.keyboard.press('Control+Shift+z');assert.deepEqual(await a.evaluate(()=>board.nodes),created.nodes);assert.deepEqual(await a.evaluate(()=>board.edges),created.edges);
 const multiple=await a.evaluate(ids=>{selected=new Set(ids);refreshSelectionUI();return {nodes:clone(board.nodes),edges:clone(board.edges),history:history.length}},[fixture.sourceId,id]);
 await a.evaluate(id=>document.querySelector('#nodes>[data-id="'+id+'"] .block-write-record').click(),fixture.sourceId);
 assert.deepEqual(await a.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:history.length})),multiple);
 accept('The selected source creates one blank record and one plain relationship; one native Undo/Redo removes/restores both, keeping every supplied source field.');
 await a.locator('#nodes>[data-id="'+id+'"]').dblclick({position:{x:70,y:25}});await a.locator('#body').waitFor({state:'visible'});
 await act(a.locator('#body'));await p.keyboard.insertText(fixture.textA);
 await act(a.locator('#inlineDone'));await act(a.locator('#nodes>[data-id="'+id+'"] .block-read'));
 const body=a.locator('#immersiveSurface #body');await body.waitFor({state:'visible'});await body.focus();await p.keyboard.press('Control+End');await p.keyboard.insertText(' SUPPLIED CHECK');const originalField=await body.elementHandle();
 await p.keyboard.press('Control+End');await p.keyboard.down('Shift');await p.keyboard.press('Home');await p.keyboard.up('Shift');
 const place=await a.evaluate(()=>({view:clone(view()),nodes:clone(board.nodes),range:[$('body').selectionStart,$('body').selectionEnd,$('body').selectionDirection]}));assert.equal(place.range[2],'backward');
 await options.snapshot?.(p,'expanded-source-beside-writing');
 await act(a.locator('#immersiveSurface .note-related-links [data-note-link]'));await a.waitForFunction(id=>whiteboardNoteEditor.sourceContext(document.querySelector('.note-source-card:not([hidden])'))?.node.id===id,fixture.sourceId);
 assert.deepEqual(await a.evaluate(()=>[...selected]),[id]);assert.equal(await a.evaluate(()=>$('dialog').open),true);assert.equal(await originalField.evaluate(el=>el===document.querySelector('#body')&&el.isConnected),true);
 await options.viewSource?.(a,fixture.sourceId,a.locator('.note-source-card:not([hidden])'));
 await act(a.getByRole('button',{name:/^返回记录(?: Esc)?$/}));await body.waitFor({state:'visible'});await a.locator('.note-source-peek').waitFor({state:'detached'});
 assert.deepEqual(await a.evaluate(()=>view()),place.view);assert.deepEqual(await a.evaluate(()=>board.nodes),place.nodes);
 assert.deepEqual(await body.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),place.range);assert.equal(await a.evaluate(()=>document.activeElement.id),'body');
 await p.keyboard.press('Control+z');assert.equal(await body.inputValue(),fixture.textA);assert.equal(await originalField.evaluate(el=>el===document.querySelector('#body')&&el.isConnected),true);
 accept('Expanded writing compares its source and returns to the same live author field, exact camera, backward selection, focus and source geometry; real prior native text Undo remains usable.');
 await p.keyboard.press('Control+End');await act(a.locator('#noteLinks'));
 const linked=a.locator('.note-backlinks .note-link-row').filter({hasText:fixture.sourceTitle});await linked.waitFor();assert.equal(await linked.count(),1);
 assert.equal(await a.locator('.note-link-results .note-link-row').filter({hasText:fixture.sourceTitle}).count(),0);
 await options.snapshot?.(p,'associated-and-other-content');
 await act(a.getByRole('button',{name:'引用：'+fixture.sourceTitle,exact:true}));
 assert.equal(await body.inputValue(),fixture.textA+'[[@'+fixture.key+'/'+fixture.sourceId+'|'+fixture.sourceTitle+']]');
 await act(a.locator('#noteLinks'));await linked.waitFor();assert.equal(await linked.count(),1);await p.keyboard.press('Escape');
 await act(a.locator('#immersiveReturn'));await a.waitForFunction(()=>!$('dialog').open);await a.locator('#canvas').focus();await p.keyboard.press('Control+z');
 assert.equal(await a.evaluate(id=>board.nodes.find(n=>n.id===id).body,id),fixture.textA);assert.deepEqual(await a.evaluate(()=>board.edges),created.edges);
 accept('Graph and text references share one object row. Viewing and explicitly quoting are distinct actions, and citation Undo preserves the original graph relationship.');
 await a.locator('#nodes>[data-id="'+id+'"]').dblclick({position:{x:70,y:25}});await act(a.locator('#body'));await p.keyboard.press('Control+End');await p.keyboard.insertText(fixture.textB);await act(a.locator('#inlineDone'));
 assert(await a.evaluate(()=>persist()));const saved=await a.evaluate(()=>clone(board));assert.deepEqual(saved.nodes.filter(n=>n.id!==id),original.nodes);assert.equal(saved.nodes.find(n=>n.id===id).title,'');assert.equal(saved.nodes.find(n=>n.id===id).body,fixture.textA+fixture.textB);
 await p.reload({waitUntil:'domcontentloaded'});
 if(embedded){await p.waitForFunction(key=>pane(current())?.state()?.boardId===key&&!pane(current()).state().loading,fixture.key);a=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame()}else a=p.mainFrame();
 await a.waitForFunction(key=>boardId===key&&!loading,fixture.key);assert.deepEqual(await a.evaluate(()=>board.nodes),saved.nodes);assert.deepEqual(await a.evaluate(()=>board.edges),saved.edges);
 await options.snapshot?.(p,'saved-fresh-return');
 if(embedded){assert.equal(await a.evaluate(async()=>{whiteboardPane.setVisible(false);try{return await whiteboardPane.canvasReady()}finally{whiteboardPane.setVisible(true)}}),false)}
 await a.locator('#nodes>[data-id="'+id+'"]').dblclick({position:{x:70,y:25}});await act(a.locator('#body'));await p.keyboard.press('Control+End');await p.keyboard.insertText(' Temporary test input.');await act(a.locator('#inlineDone'));
 await a.evaluate(id=>{window.staleWrite=document.querySelector('#nodes>[data-id="'+id+'"] .block-write-record')},id);assert(await a.evaluate(()=>!!staleWrite));
 // Native Undo replaces the live board object; a delayed old control cannot write into it.
 await a.locator('#canvas').focus();await p.keyboard.press('Control+z');const boundary=await a.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:history.length}));
 await a.evaluate(()=>staleWrite?.click());assert.deepEqual(await a.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:history.length})),boundary);
 accept('Save and fresh return retain exact own text, blank title, all sources and edges. Hidden panes and late controls cannot act on a replaced board.');
 return checks;
}
module.exports={exerciseSourceRecord};

if(require.main===module)(async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-source-record-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:temp,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();let browser;
 const proof={completed:false,syntheticOnly:true,physicalPhoneAccepted:false,groups:[],errors:[]},record=()=>{if(process.env.SOURCE_RECORD_PROOF)fs.writeFileSync(process.env.SOURCE_RECORD_PROOF,JSON.stringify(proof,null,2))};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const group of [{width:320,touch:true},{width:390,touch:true},{width:1440,touch:false},{width:1440,touch:false,standalone:true}]){
   const label=group.width+(group.standalone?'-standalone':'-workbench'),key='supplied-source-record-'+label,sourceTitle='Supplied source '+label;
   const source={id:'source',type:'note',title:sourceTitle,body:'Supplied original source.',userText:'Supplied explanation.',annotation:'Supplied annotation.',sizeMode:'manual',x:30,y:80,w:280,h:230,color:'#e7e2da',opaque:{keep:[true,1,1.5]}};
   const r=await fetch(base+'/api/boards/'+key,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:label,nodes:[source],edges:[],view:{x:0,y:0,z:1}})});assert(r.ok);
   const context=await browser.newContext({viewport:{width:group.width,height:group.touch?844:950},hasTouch:group.touch,isMobile:group.touch,reducedMotion:'reduce'});await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>{proof.errors.push(e.message);record()});
   await exerciseSourceRecord(p,base+(group.standalone?'/index.html':'/')+'?board='+key,{key,sourceId:'source',sourceTitle,textA:'Supplied own record A.',textB:'\nSupplied continuation B.'},{embedded:!group.standalone,touch:group.touch,accept:check=>{proof.groups.push({group:label,check});record();console.log(label+': '+check)},snapshot:process.env.SOURCE_RECORD_IMAGES?async(page,name)=>{fs.mkdirSync(process.env.SOURCE_RECORD_IMAGES,{recursive:true});await page.screenshot({path:path.join(process.env.SOURCE_RECORD_IMAGES,label+'-'+name+'.png')})}:null});await context.close();
  }
  assert.deepEqual(proof.errors,[]);proof.completed=true;
 }catch(e){proof.failure=e.stack;throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});proof.ownedSyntheticServicesStopped=true;record()}
})().catch(e=>{console.error(e);process.exitCode=1});
