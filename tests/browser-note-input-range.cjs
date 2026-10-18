const assert=require('node:assert/strict');

async function exerciseInputRange(p,url,fixture,options={}){
 const checks=[],accept=text=>{checks.push(text);options.accept?.(text)};
 await p.goto(url,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(key=>boardId===key&&!loading&&!!window.whiteboardNoteEditor,fixture.key);
 if(await p.locator('#workspaceSidebar').isVisible())await p.locator('#sidebarToggle').click();
 const original=await p.evaluate(()=>clone(board)),note=p.locator('#nodes>[data-id="'+fixture.sourceId+'"]');
 const open=async()=>{
  await note.dblclick({position:{x:80,y:25}});await p.locator('#body').waitFor({state:'visible'});
  if(options.expanded){await p.locator('#inlineDone').click();await note.locator('.block-read').click();await p.locator('#immersiveSurface #body').waitFor({state:'visible'})}
 };
 for(const name of ['body','userText','annotation']){
  await open();const field=p.locator('#'+name);
  if(!await field.isVisible())await p.locator(options.expanded?'#immersiveDetails':'#inlineDetails').click();
  await field.click();await field.press('Control+End');const before=await field.inputValue();
  // This is a browser input operation with no keyup, not a physical IME claim.
  await p.keyboard.insertText('【仅输入追加】');const fresh=before+'【仅输入追加】';assert.equal(await field.inputValue(),fresh);
  assert.deepEqual(await field.evaluate(el=>[el.selectionStart,el.selectionEnd]),[fresh.length,fresh.length]);
  if(name==='body'){
   await p.locator('#noteLinks').click();await p.getByRole('button',{name:'引用：'+fixture.targetTitle,exact:true}).click();
   assert.equal(await field.inputValue(),fresh+'[[@'+fixture.key+'/'+fixture.targetId+'|'+fixture.targetTitle+']]');
  }else{
   await p.locator('#noteFormat').click();await p.getByRole('button',{name:'粗体',exact:true}).click();
   assert.equal(await field.inputValue(),fresh+'****');await p.keyboard.press('Escape');
  }
  const actual=await p.evaluate(id=>clone(board.nodes.find(n=>n.id===id)),fixture.sourceId),source=original.nodes.find(n=>n.id===fixture.sourceId);
  assert.deepEqual({...actual,[name]:source[name]},source);assert.deepEqual(await p.evaluate(id=>board.nodes.find(n=>n.id===id),fixture.targetId),original.nodes.find(n=>n.id===fixture.targetId));
  if(name==='body')await options.snapshot?.(p,'input-only-reference');
  await p.locator(options.expanded?'#immersiveReturn':'#inlineDone').click();await p.waitForFunction(()=>editorId===null&&!document.querySelector('#dialog').open);
  await p.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.equal(await p.evaluate(({id,name})=>board.nodes.find(n=>n.id===id)[name],{id:fixture.sourceId,name}),fresh);
  await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board.nodes),original.nodes);assert.deepEqual(await p.evaluate(()=>board.edges),original.edges);
  accept(name+': input-only text keeps the actual caret for reference/formatting, preserves other authored fields and manual dimensions, and retains separate Undo for the action and input.');
 }
 assert(await p.evaluate(()=>persist()));const saved=await(await p.request.get((options.apiURL||new URL('/api/',url).href)+'boards/'+fixture.key)).json();assert.deepEqual(saved.nodes,original.nodes);assert.deepEqual(saved.edges,original.edges);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(key=>boardId===key&&!loading,fixture.key);assert.deepEqual(await p.evaluate(()=>board.nodes),original.nodes);
 accept('Exact supplied writing, target, manual geometry and edges survive save and fresh return.');return checks;
}
module.exports={exerciseInputRange};

if(require.main===module)(async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-input-range-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:temp,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();let browser;
 const proof={completed:false,syntheticOnly:true,physicalIMEAccepted:false,groups:[],errors:[]},record=()=>{if(process.env.INPUT_RANGE_PROOF)fs.writeFileSync(process.env.INPUT_RANGE_PROOF,JSON.stringify(proof,null,2))};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const narrow of [false,true])for(const expanded of [false,true]){
   const group=(narrow?'narrow':'wide')+'-'+(expanded?'expanded':'inline'),key='supplied-input-range-'+group,targetTitle='Supplied reference '+group;
   const fixture={key,sourceId:'range-author',targetId:'range-reference',targetTitle};
   const nodes=[{id:fixture.sourceId,type:'note',title:'Supplied own title',body:'Supplied original body',userText:'Supplied source explanation',annotation:'Supplied annotation',tags:['supplied'],x:20,y:80,w:300,h:330,sizeMode:'manual',color:'#fff0aa',textFormat:'markdown',opaque:{keep:true}},{id:fixture.targetId,type:'note',title:targetTitle,body:'Supplied target stays exact',x:440,y:80,w:300,h:200,color:'#ffffff'}];
   const response=await fetch(base+'/api/boards/'+key,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:'Supplied '+group,nodes,edges:[],view:{x:0,y:0,z:1}})});assert(response.ok);
   const context=await browser.newContext({viewport:{width:narrow?390:1440,height:narrow?844:950},hasTouch:narrow,isMobile:narrow,reducedMotion:'reduce'});await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
   const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>{proof.errors.push(e.message);record()});
   await exerciseInputRange(p,base+'/index.html?board='+key,fixture,{expanded,accept:check=>{proof.groups.push({group,check});record();console.log(group+': '+check)},snapshot:process.env.INPUT_RANGE_IMAGES?async(page,name)=>{fs.mkdirSync(process.env.INPUT_RANGE_IMAGES,{recursive:true});await page.screenshot({path:path.join(process.env.INPUT_RANGE_IMAGES,group+'-'+name+'.png')})}:null});await context.close();
  }
  assert.deepEqual(proof.errors,[]);proof.completed=true;
 }catch(e){proof.failure=e.stack;throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});proof.ownedSyntheticServicesStopped=true;record()}
})().catch(e=>{console.error(e);process.exitCode=1});
