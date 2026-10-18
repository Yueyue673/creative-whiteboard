const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-new-note-space-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;
 const proof={complete:false,groups:[],errors:[],physicalPhoneAccepted:false,privateUIOpened:false};
 const record=()=>{if(process.env.NEW_NOTE_SPACE_PROOF)fs.writeFileSync(process.env.NEW_NOTE_SPACE_PROOF,JSON.stringify(proof,null,2))};
 const accept=name=>{proof.groups.push(name);record();console.log(name)};
 const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const from=Number(process.env.NEW_NOTE_SPACE_FROM||0);
  for(const width of (from>=2?[]:[390,1360])){
   const ctx=await browser.newContext({viewport:{width,height:820},hasTouch:true,isMobile:width===390}),p=await ctx.newPage();p.on('pageerror',e=>proof.errors.push(e.message));
   await p.goto(base+'/?create=1');await p.locator('#newBoardName').fill('Supplied observations '+width);await p.locator('#createBoard').tap();
   await p.waitForFunction(w=>current()?.name==='Supplied observations '+w&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading,width);
   const key=await p.evaluate(()=>current().boardId),a=p.frames().find(f=>new URL(f.url()).searchParams.get('pane')==='1'&&new URL(f.url()).searchParams.get('board')===key);await a.waitForFunction(()=>board&&!loading&&window.whiteboardNoteEditor);
   const originals=[];
   for(let i=1;i<=3;i++){
    if(i===2){await a.locator('#canvas').focus();await p.keyboard.press('n')}else await a.locator(i===1?'#emptyWrite':'#add').tap();
    await a.locator('#title').fill('Observation '+i);await a.locator('#body').fill('Supplied exact words '+i+'.');await a.locator('#inlineDone').tap();
    await a.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const state=await a.evaluate(()=>({nodes:clone(board.nodes),active:document.activeElement.id}));
    assert.deepEqual(state.nodes.slice(0,-1),originals,'Creating another paper never rearranges earlier originals');
    const n=state.nodes.at(-1);assert.equal(n.textFormat,'markdown');assert.equal(n.sizeMode,'auto');
    for(const old of originals)assert.equal(overlap(old,n),0,'New ordinary papers do not hide earlier observations');originals.push(n);
   }
   const visible=await a.evaluate(()=>board.nodes.map(n=>{const r=document.querySelector('[data-id="'+n.id+'"]').getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:canvas.clientWidth,height:canvas.clientHeight}}));
   assert(visible.every(r=>r.left>=0&&r.right<=r.width&&r.top>=0&&r.bottom<=r.height),'All three originals remain readable at original zoom without uncovering or fitting');
   await a.locator('[data-id="'+originals[0].id+'"]').click({position:{x:3,y:30}});
   const from=await a.locator('[data-id="'+originals[0].id+'"] .port.top').boundingBox(),to=await a.locator('[data-id="'+originals[2].id+'"]').boundingBox();
   await p.mouse.move(from.x+from.width/2,from.y+from.height/2);await p.mouse.down();await p.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await p.mouse.up();assert.equal(await a.evaluate(()=>board.edges.length),1);
   const linked=await a.evaluate(()=>clone(board));await a.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.equal(await a.evaluate(()=>board.edges.length),0);assert.deepEqual(await a.evaluate(()=>board.nodes),originals);
   await p.keyboard.press('Control+Shift+z');assert.deepEqual(await a.evaluate(()=>board.edges),linked.edges);assert(await a.evaluate(()=>persist()));await a.waitForFunction(()=>!dirty&&!savePromise);
   const saved=await(await ctx.request.get(base+'/api/boards/'+key)).json();assert.deepEqual(saved.nodes,originals);assert.deepEqual(saved.edges,linked.edges);
   if(process.env.NEW_NOTE_SPACE_IMAGES){fs.mkdirSync(process.env.NEW_NOTE_SPACE_IMAGES,{recursive:true});await p.screenshot({path:path.join(process.env.NEW_NOTE_SPACE_IMAGES,width+'-three-observations.png')})}
   await p.reload();await p.waitForFunction(k=>pane(current())?.state().boardId===k&&!pane(current()).state().loading,key);const reopened=p.frames().find(f=>new URL(f.url()).searchParams.get('pane')==='1'&&new URL(f.url()).searchParams.get('board')===key);assert.deepEqual(await reopened.evaluate(()=>board.nodes),originals);assert.deepEqual(await reopened.evaluate(()=>board.edges),linked.edges);
   accept(width+'px: three supplied originals, button/keyboard creation, direct connection, Undo/Redo and saved continuation without uncovering');await ctx.close();
  }
  if(from<3){
  const p=await browser.newPage({viewport:{width:1360,height:900}});p.on('pageerror',e=>proof.errors.push(e.message));await p.goto(base+'/index.html');await p.waitForFunction(()=>board&&!loading&&window.whiteboardNoteEditor);
  if(await p.locator('#workspaceSidebar').isVisible())await p.locator('#sidebarToggle').click();
  const reset=()=>p.evaluate(()=>{board.nodes=[];board.edges=[];board.view={x:0,y:0,z:1};selected.clear();editorId=null;$('editor').hidden=true;history=[];future=[];render()});
  await reset();const first=await p.evaluate(()=>{const point=center();addNote();return{point,n:clone(board.nodes[0])}});assert.equal(first.n.x,first.point.x-150);assert.equal(first.n.y,first.point.y-50);
  const literal=await p.evaluate(()=>{const p=center();addNote(p);return{p,n:clone(board.nodes.at(-1))}});assert.equal(literal.n.x,literal.p.x-150);assert.equal(literal.n.y,literal.p.y-50);
  const exact={x:-420,y:137,w:417,h:239,sizeMode:'manual',body:'Never move supplied geometry',opaque:{preserve:['custom']}};await p.evaluate(data=>addNote(undefined,data),exact);const supplied=await p.evaluate(()=>clone(board.nodes.at(-1)));for(const [k,v]of Object.entries(exact))assert.deepEqual(supplied[k],v);
  await reset();const point=await p.evaluate(()=>{const r=canvas.getBoundingClientRect();return{screen:{x:r.left+330,y:r.top+240},world:worldPoint(r.left+330,r.top+240)}});await p.mouse.dblclick(point.screen.x,point.screen.y);const clicked=await p.evaluate(()=>clone(board.nodes.at(-1)));assert.equal(clicked.x,point.world.x-150);assert.equal(clicked.y,point.world.y-50);
  await p.locator('#inlineDone').click();const table=await p.evaluate(()=>{const c=center();addNote(undefined,{type:'table',w:620,h:360,columns:['Column'],rows:[['']]});return{c,n:clone(board.nodes.at(-1))}});assert.equal(table.n.x,table.c.x-150);assert.equal(table.n.y,table.c.y-50);assert.equal(table.n.type,'table');
  await reset();await p.evaluate(()=>{const c=center();board.nodes=[{id:'group',type:'frame',title:'Original group',x:c.x-400,y:c.y-300,w:800,h:700},{id:'authored',type:'note',title:'Already placed',body:'Exact old words',x:c.x-150,y:c.y-50,w:300,h:140,sizeMode:'manual',opaque:{keep:true}}];render();selected=new Set(['authored'])});
  const originalGroup=await p.evaluate(()=>clone(board.nodes));await p.locator('#add').click();assert.deepEqual(await p.evaluate(()=>board.nodes.slice(0,-1)),originalGroup);assert.equal(await p.evaluate(()=>groupOf(board.nodes.at(-1))?.id),'group');assert.equal(overlap(originalGroup[1],await p.evaluate(()=>board.nodes.at(-1))),0);
  await p.locator('#inlineDone').click();await p.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board.nodes),originalGroup);await p.keyboard.press('Control+Shift+z');assert.equal(await p.evaluate(()=>board.nodes.length),3);
  await reset();const crowded=await p.evaluate(()=>{const c=center();board.nodes=[{id:'small-group',type:'frame',x:c.x-150,y:c.y-50,w:300,h:120},{id:'occupant',type:'note',x:c.x-150,y:c.y-50,w:300,h:120,sizeMode:'manual',body:'Keep my original place'}];render();const before=clone(board.nodes);addNote();return{before,nodes:clone(board.nodes),group:groupOf(board.nodes.at(-1))?.id}});assert.deepEqual(crowded.nodes.slice(0,-1),crowded.before);assert.equal(crowded.group,'small-group');assert.equal(crowded.nodes[2].x,crowded.before[1].x);assert.equal(crowded.nodes[2].y,crowded.before[1].y);
  accept('Literal points and supplied geometry stay exact; local creation stays in its original group, has one Undo, and cannot escape a full small group');await p.close();
  }
  // The existing editor is optional. Creation must work before it arrives and after it decorates addNote.
  if(from<4){
  const late=await browser.newPage({viewport:{width:1360,height:900}});late.on('pageerror',e=>proof.errors.push(e.message));let release;const gate=new Promise(r=>release=r);let reached;const requested=new Promise(r=>reached=r);
  await late.route(base+'/note-editor.js',async route=>{reached();await gate;await route.continue()});const navigation=late.goto(base+'/index.html',{waitUntil:'commit'});await navigation;await requested;await late.waitForFunction(()=>window.whiteboardExperience);
  // Data initialization normally waits for DOMContentLoaded. Seed only this synthetic
  // scene before releasing the held decorator, rather than waiting on that same event.
  await late.evaluate(()=>newBoard('Synthetic late editor scene'));
  const beforeLate=await late.evaluate(()=>{board.nodes=[];board.edges=[];board.view={x:0,y:0,z:1};selected.clear();editorId=null;$('editor').hidden=true;history=[];future=[];render();addNote();$('inlineDone').click();const n=clone(board.nodes[0]);addNote();return{n,other:clone(board.nodes[1]),history:history.length}});assert.equal(overlap(beforeLate.n,beforeLate.other),0);assert.equal(beforeLate.history,2);
  await late.evaluate(async()=>{$('inlineDone').click();await persist()});release();await late.waitForLoadState('load');await late.waitForFunction(()=>board&&!loading&&window.whiteboardNoteEditor);const decorated=await late.evaluate(()=>{const old=clone(board.nodes),h=history.length;addNote();return{old,nodes:clone(board.nodes),delta:history.length-h}});assert.deepEqual(decorated.nodes.slice(0,-1),decorated.old);assert.equal(decorated.nodes.at(-1).textFormat,'markdown');assert.equal(decorated.delta,1);for(const old of decorated.old)assert.equal(overlap(old,decorated.nodes.at(-1)),0);
  accept('Optional editor delay leaves creation usable; later Markdown decoration preserves spacing and one creation checkpoint');await late.close();
  }
  const embedded=await browser.newPage({viewport:{width:1360,height:900}});embedded.on('pageerror',e=>proof.errors.push(e.message));
  const entry=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<script src="/note-editor.js"></script>',()=>'<script>'+fs.readFileSync(path.join(root,'note-editor.js'),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
  await embedded.route(base+'/index.html',route=>route.fulfill({contentType:'text/html',body:entry}));await embedded.goto(base+'/index.html');await embedded.waitForFunction(()=>board&&!loading&&window.whiteboardNoteEditor);await embedded.evaluate(()=>{board.nodes=[];board.edges=[];selected.clear();editorId=null;render();addNote();$('inlineDone').click();addNote()});const embeddedNotes=await embedded.evaluate(()=>clone(board.nodes));assert.equal(overlap(...embeddedNotes),0);assert(embeddedNotes.every(n=>n.textFormat==='markdown'));await embedded.close();
  accept('The original embedded editor variant also preserves unspecified placement and Markdown without replacing the entry program');
  assert.deepEqual(proof.errors,[]);proof.complete=true;record();
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
