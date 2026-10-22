const assert=require('node:assert/strict');

async function exercise(p,url,key,{from=0,to=2,accept=()=>{},snapshot=null}={}){
 const groups=[],record=async(name,label)=>{groups.push(label);if(snapshot)await snapshot(p,name);accept(label)};
 await p.setViewportSize({width:390,height:844});await p.goto(url+(url.includes('?')?'&':'?')+'board='+encodeURIComponent(key),{waitUntil:'domcontentloaded'});
 await p.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);
 const a=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await a.waitForFunction(()=>board&&!loading&&window.whiteboardReading);
 const state=()=>a.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future),view:clone(view()),selected:[...selected]})),settle=()=>a.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const clearLine=()=>a.evaluate(()=>{
  const path=document.querySelector('#edgePaths .connector-line'),length=path.getTotalLength(),matrix=path.getScreenCTM(),bar=document.querySelector('.node.active>.block-actions'),r=bar.getBoundingClientRect(),peers=[...document.querySelectorAll('#nodes>.node:not(.active):not(.frame)')].map(e=>e.getBoundingClientRect());
  const points=[.25,.5,.75].map(t=>{const q=path.getPointAtLength(length*t),point=new DOMPoint(q.x,q.y).matrixTransform(matrix),hit=document.elementFromPoint(point.x,point.y);return {x:point.x,y:point.y,covered:!!hit?.closest('.block-actions'),edge:!!hit?.closest('[data-edge]')}});
  return {points,bar:{x:r.x,y:r.y,w:r.width,h:r.height},inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overlapsPeer:peers.some(p=>r.left<p.right&&r.right>p.left&&r.top<p.bottom&&r.bottom>p.top)};
 });
 if(from<=0&&to>0){
  await a.locator('#nodes>.node[data-id=second-note]').tap();const before=await state(),source=await a.locator('#nodes>.node[data-id=second-note] [data-port=top]').boundingBox(),target=await a.locator('#nodes>.node[data-id=first-note]').boundingBox(),start={x:source.x+source.width/2,y:source.y+source.height/2},end={x:target.x+target.width/2,y:target.y+target.height-20},cdp=await p.context().newCDPSession(p);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(point=>({id:1,...point,radiusX:6,radiusY:6,force:1}))});await touch('touchStart',[start]);for(let i=1;i<=8;i++)await touch('touchMove',[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8}]);
  // Place the finger deliberately. A rapid synthetic fling also consumes the
  // next tap on an independent button-only page, outside the product handlers.
  await p.waitForTimeout(200);await touch('touchEnd',[]);await cdp.detach();await settle();
  const after=await state();assert.deepEqual(after.nodes,before.nodes);assert.deepEqual(after.view,before.view);assert.deepEqual(after.selected,before.selected);assert.equal(after.history.length,before.history.length+1);assert.equal(after.edges.length,1);assert.equal(after.edges[0].from,'second-note');assert.equal(after.edges[0].to,'first-note');
  const visible=await clearLine();assert(visible.points.every(p=>!p.covered&&p.edge),'The completed connection remains visible and reachable while its source stays selected: '+JSON.stringify(visible));assert(visible.inside&&!visible.overlapsPeer,'Actions remain inside the viewport and outside the connected paper: '+JSON.stringify(visible));
  await a.locator('#nodes>.node[data-id=second-note] .block-read').tap();await a.locator('#body').waitFor();assert(await a.evaluate(()=>whiteboardReading.isEditing()));await a.locator('#immersiveReturn').tap();await settle();assert.deepEqual(await state(),after);
  assert(await a.evaluate(()=>persist()));await record('phone-visible-connection','A native single-finger link stays visible and can be reached immediately without deselecting its source; the relocated edit action still opens and returns with authored content, manual sizes, selection, view and Undo exact.');
 }
 if(from<=1&&to>1){
  await a.locator('#nodes>.node[data-id=second-note]').tap();assert.equal(await a.evaluate(()=>board.edges.length),1);
  const author=await state();
  for(const viewport of [{width:320,height:568},{width:1440,height:950}]){
   await p.setViewportSize(viewport);await settle();const before=await state();assert.deepEqual(before.nodes,author.nodes);assert.deepEqual(before.edges,author.edges);assert.deepEqual(before.history,author.history);assert.deepEqual(before.future,author.future);
   const visible=await clearLine();assert(visible.inside&&!visible.overlapsPeer);assert(visible.points.every(p=>!p.covered),'The toolbar must not hide its own visible link after resizing: '+JSON.stringify({viewport,visible}));
   await a.locator('#nodes>.node[data-id=second-note] .block-read').tap();await a.locator('#body').waitFor();await a.locator('#immersiveReturn').tap();await settle();assert.deepEqual(await state(),before);
  }
  const before=await state(),s=before.nodes.find(n=>n.id==='second-note'),f=before.nodes.find(n=>n.id==='first-note');
  // The author deliberately moves this same card; the existing connection follows it.
  const title=await a.locator('#nodes>.node[data-id=second-note] [data-preview-id=title]').boundingBox(),start={x:title.x+25,y:title.y+title.height/2},cdp=await p.context().newCDPSession(p),delta=220;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,...start}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:2,x:start.x+delta,y:start.y+70}]});await p.waitForTimeout(200);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await settle();
  const moved=await state();assert(moved.nodes.find(n=>n.id==='second-note').x>s.x);assert.deepEqual(moved.nodes.find(n=>n.id==='first-note'),f);assert.deepEqual(moved.edges,before.edges);const visible=await clearLine();assert(visible.inside&&!visible.overlapsPeer);assert(visible.points.every(p=>!p.covered),'Diagonal connections remain clear of their card actions');
  await a.locator('#canvas').focus();await p.keyboard.press('Control+z');await settle();assert.deepEqual((await state()).nodes,before.nodes);assert.deepEqual((await state()).edges,before.edges);await record('narrow-wide-diagonal','The same original graph and edit action remain usable at320px and wide. An intentional native diagonal move keeps the link and the other paper intact, and Undo restores its exact authored geometry.');
 }
 return {groups};
}
module.exports={exercise};
if(require.main===module){const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-connection-actions-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,proof={groups:[],errors:[],complete:false,syntheticOnly:true,physicalPhoneAccepted:false};const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;const save=()=>{if(process.env.CONNECTION_ACTION_RESULT)fs.writeFileSync(process.env.CONNECTION_ACTION_RESULT,JSON.stringify(proof,null,2))};
 try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');await r.arrayBuffer();if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const fixture={format:'creative-board',version:1,name:'Synthetic linked papers',nodes:[{id:'first-note',type:'note',title:'Supplied first paper',body:'Supplied original first text.',userText:'Supplied supplement.',annotation:'Supplied note.',tags:['supplied'],x:45,y:90,w:300,h:145,sizeMode:'manual',color:'#fff0aa'},{id:'second-note',type:'note',title:'Supplied second paper',body:'Supplied original second text.',x:45,y:267,w:300,h:121,sizeMode:'manual',color:'#fff0aa'}],edges:[],view:{x:0,y:0,z:1}};
  const start=Number(process.env.CONNECTION_ACTION_FROM||0);if(start===1)fixture.edges=[{id:'supplied-link',from:'second-note',to:'first-note',fromSide:'top',toSide:'bottom',portsExplicit:true,label:''}];
  const result=await fetch(base+'/api/boards/connection-actions',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(fixture)});assert.equal(result.status,200);await result.arrayBuffer();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>{proof.errors.push(e.message);save()});await context.route('https://**/*',r=>r.abort());const images=process.env.CONNECTION_ACTION_IMAGES;if(images)fs.mkdirSync(images,{recursive:true});
  await exercise(p,base+'/','connection-actions',{from:start,accept:label=>{proof.groups.push(label);save();console.log(label)},snapshot:images?async(page,name)=>page.screenshot({path:path.join(images,name+'.png')}):null});assert.deepEqual(proof.errors,[]);proof.complete=true;
 }catch(e){proof.failure=e.stack;throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true});proof.ownedSyntheticServicesStopped=true;save()}
})().catch(e=>{console.error(e);process.exitCode=1})}
