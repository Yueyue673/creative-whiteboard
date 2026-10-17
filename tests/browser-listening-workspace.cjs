const assert=require('node:assert/strict');

async function exercise(p,appURL,fixture,options={}){
 const checks=[],accept=text=>{checks.push(text);options.accept?.(text)},settle=f=>f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const snapshot=async name=>options.snapshot?.(p,name);
 await p.goto(appURL+'?board='+encodeURIComponent(fixture.key),{waitUntil:'domcontentloaded'});
 await p.waitForFunction(key=>pane(current())?.state()?.boardId===key&&!pane(current()).state().loading,fixture.key);
 const boardFrame=key=>p.frames().find(f=>f.parentFrame()&&f.url().startsWith(appURL)&&new URL(f.url()).searchParams.get('board')===key);
 const b=boardFrame(fixture.key);assert(b);
 await b.locator('#nodes>[data-id=supplied-note]').click();
 const original=await b.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges)}));
 const openPreview=async()=>{
  await p.locator('#openBoards').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());
  const f=p.frames().find(f=>f.parentFrame()&&f.url().startsWith(appURL)&&new URL(f.url()).searchParams.get('explorer')==='1');
  if(!await f.locator('#assetPane').isVisible())await f.locator('#assetsButton').click();
  await f.locator('[data-asset-preview="'+fixture.assetId+'"]').click();
  await f.waitForFunction(()=>document.querySelector('#dialog audio')?._readingRestored&&document.querySelector('#dialog audio').readyState>=1);
  return f;
 };
 const f=await openPreview(),media=f.locator('#dialog audio'),player=await media.elementHandle();
 const play=async()=>{const r=await media.boundingBox();await media.click({position:{x:26,y:Math.min(27,r.height/2)}});await f.waitForFunction(()=>!document.querySelector('#dialog audio').paused)};
 await play();await media.focus();for(let i=0;i<6;i++)await media.press('ArrowRight');
 await settle(b);const before=await b.evaluate(()=>clone(view()));
 const started=await player.evaluate(el=>el.currentTime);
 await f.locator('#listenWhileWriting').click();await p.waitForFunction(()=>document.querySelector('#workspace').classList.contains('listening-active'));
 await settle(b);
 if(options.narrow)assert.deepEqual(await b.evaluate(()=>clone(view())),before,'Stable narrow canvas does not move when listening starts');
 assert.equal(await p.locator('#openBoards').getAttribute('aria-label'),'展开试听资料');
 assert.equal(await p.locator('#frameDeck').evaluate(el=>el.inert),false);
 assert.equal(await player.evaluate(el=>el===document.querySelector('#dialog audio')&&!el.paused),true);
 assert(await player.evaluate(el=>el.currentTime)>=started);
 await b.locator('#nodes>[data-id=supplied-note] .block-read').click();
 const body=b.locator('#dialog #body');let expected=original.nodes[0].body;
 if(!options.from){
 await body.click();await body.press('Control+End');await p.keyboard.insertText('【supplied A】');
 const valueA=await body.inputValue();
 for(let i=0;i<5;i++)await body.press('Shift+ArrowLeft');
 const selection=await body.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection}));
 const control=await media.boundingBox();await media.click({position:{x:26,y:Math.min(27,control.height/2)}});await f.waitForFunction(()=>document.querySelector('#dialog audio').paused);
 const seekBefore=await player.evaluate(el=>el.currentTime);await media.focus();await media.press('ArrowRight');
 // A paused player cannot advance merely because the test took time. Native
 // controls choose their own seek step; the canvas range's five-second step
 // does not specify the browser's built-in audio control.
 const seekAfter=await player.evaluate(el=>el.currentTime);assert(seekAfter>seekBefore&&seekAfter<await player.evaluate(el=>el.duration),'Native paused seek advances: '+JSON.stringify({seekBefore,seekAfter}));await play();
 await f.locator('#listeningResume').click();
 assert.deepEqual(await body.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection})),selection);
 assert(await body.evaluate(el=>document.activeElement===el));
 await p.keyboard.insertText('【supplied B】');
 expected=valueA.slice(0,selection.start)+'【supplied B】'+valueA.slice(selection.end);assert.equal(await body.inputValue(),expected);
 await body.press('Control+z');assert.equal(await body.inputValue(),valueA);await body.press('Control+Shift+z');assert.equal(await body.inputValue(),expected);
 const camera=await b.evaluate(()=>clone(view()));
 await f.locator('#listeningExpand').click();await p.waitForFunction(()=>!document.querySelector('#workspace').classList.contains('listening-active'));
 assert.equal(await player.evaluate(el=>el===document.querySelector('#dialog audio')&&!el.paused),true);
 await f.locator('#listenWhileWriting').click();await f.locator('#listeningResume').click();
 assert.equal(await body.inputValue(),expected);assert.deepEqual(await b.evaluate(()=>clone(view())),camera);
 assert(await f.locator('#dialogActions button:visible').evaluateAll(es=>es.length===3&&es.every(el=>el.getBoundingClientRect().height>=44)),'Listening actions have usable touch targets');
 await snapshot('writing');
 for(const size of options.narrow?[{width:320,height:480},{width:390,height:844}]:[]){
  await p.setViewportSize(size);await settle(b);await f.locator('#listeningResume').click();await body.press('Control+End');
  const paper=await b.locator('#dialog').boundingBox(),controls=await f.locator('#dialog').boundingBox();
  assert(paper.y+paper.height<=controls.y,'Last-line writing surface and player do not overlap');
  assert(await body.evaluate(el=>el.clientWidth)>=190);await snapshot('writing-'+size.width);
 }
 const now=await b.evaluate(()=>clone(board.nodes[0]));assert.deepEqual({...now,body:original.nodes[0].body},original.nodes[0]);
 accept('Original audio stays in its document while writing, seeking, expanding and returning; reverse selection, native undo/redo and manual paper fields remain exact.');
 if(options.writingOnly)return checks;
 }

 await b.locator('#immersiveReturn').click();
 await p.locator('.add-tab[data-side=left]').click();await p.locator('[data-board-choice="'+fixture.otherKey+'"]').click();
 await p.waitForFunction(key=>pane(current())?.state()?.boardId===key&&!pane(current()).state().loading,fixture.otherKey);
 assert.equal(await player.evaluate(el=>el.paused),true,'The root board picker pauses playback while controls are covered');await play();
 await p.getByRole('tab',{name:fixture.name,exact:true}).click();await b.locator('#nodes>[data-id=supplied-note] .block-read').click();
 assert.equal(await player.evaluate(el=>el.paused),false,'Existing-tab navigation keeps the visible session playing');
 assert.equal(await body.inputValue(),expected);await b.locator('#immersiveReturn').click();
 await p.locator('#shellMore summary').click();await p.locator('[data-command=settings]').click();
 await p.waitForFunction(()=>document.querySelector('dialog[open]'));await f.waitForFunction(()=>document.querySelector('#dialog audio').paused);
 const paused=await player.evaluate(el=>el.currentTime);await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('dialog[open]'));
 assert.equal(await player.evaluate(el=>el.paused),true);assert.equal(await player.evaluate(el=>el.currentTime),paused);
 await play();
 await p.locator('#shellMore summary').click();await p.locator('[data-command=help]').click();
 await f.waitForFunction(()=>document.querySelector('#dialog audio').paused&&!document.querySelector('#dialog').open);
 await p.waitForFunction(()=>!document.querySelector('#workspace').classList.contains('listening-active'));
 assert(await b.locator('#dialog').evaluate(el=>el.open));await p.keyboard.press('Escape');
 accept('Explicit tab changes keep the visible player; root settings pause it, and leaving writing for another dialog ends only this listening session.');

 await openPreview();await play();await f.locator('#listenWhileWriting').click();
 // Exercise the original replacement entry without allowing a stale source
 // session to hide the newly opened preview or steal its focus.
 const old=await media.elementHandle();await f.evaluate(id=>previewAsset(id),fixture.assetId);
 await f.waitForFunction(()=>document.querySelector('#dialog audio')?._readingRestored);
 await p.waitForFunction(()=>!document.querySelector('#globalExplorer').hidden&&!document.querySelector('#workspace').classList.contains('listening-active'));
 assert(await old.evaluate(el=>el.paused));assert.equal(await media.evaluate(el=>el.paused),true);
 await f.locator('#listenWhileWriting').click();await play();await p.keyboard.press('Escape');
 await f.waitForFunction(()=>!document.querySelector('#dialog').open&&document.querySelector('#dialog audio').paused);
 await p.waitForFunction(()=>document.querySelector('#globalExplorer').hidden&&!document.querySelector('#workspace').classList.contains('listening-active'));
 await b.evaluate(()=>persist());
 const saved=await(await p.request.get((options.apiURL||appURL+'api/')+'boards/'+fixture.key)).json();assert.equal(saved.nodes[0].body,expected);assert.deepEqual({...saved.nodes[0],body:original.nodes[0].body},original.nodes[0]);assert.deepEqual(saved.edges,original.edges);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(key=>pane(current())?.state()?.boardId===key&&!pane(current()).state().loading,fixture.key);
 assert.equal(await boardFrame(fixture.key).evaluate(()=>board.nodes[0].body),expected);
 accept('Replacement, Escape and fresh return have a single playback owner, keep original media paused after exit, and preserve exact saved writing.');
 return checks;
}
module.exports={exercise};

if(require.main===module)(async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-listening-workspace-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port+'/';
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();let browser;
 const proof={complete:false,from:Number(process.env.LISTENING_FROM||0),writingOnly:!!process.env.LISTENING_WRITING_ONLY,syntheticOnly:true,physicalPhoneAccepted:false,groups:[],errors:[]},record=()=>{if(process.env.LISTENING_PROOF)fs.writeFileSync(process.env.LISTENING_PROOF,JSON.stringify(proof,null,2))};
 try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'api/health');await r.arrayBuffer();if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const wav=Buffer.alloc(44+8000*2*300);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const upload=await fetch(base+'api/assets/upload',{method:'POST',headers:{'X-File-Name':'supplied-listening.wav'},body:wav});assert(upload.ok);const asset=await upload.json(),catalog=await(await fetch(base+'api/assets')).json();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const group of ['narrow','wide']){
   if(process.env.LISTENING_ONLY&&process.env.LISTENING_ONLY!==group)continue;
   const key='supplied-listening-'+group,otherKey=key+'-other',name='Supplied writing '+group,node={id:'supplied-note',type:'note',title:'Supplied title',body:Array.from({length:32},(_,i)=>'Supplied original line '+(i+1)+'.').join('\n'),userText:'Supplied source',annotation:'Supplied annotation',tags:['supplied'],x:30,y:70,w:300,h:280,sizeMode:'manual',color:'#fff0aa'};
   for(const [id,title]of [[key,name],[otherKey,'Supplied other '+group]]){const r=await fetch(base+'api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:title,folder:'',nodes:[node],edges:[],view:{x:0,y:0,z:1}})});assert(r.ok);await r.arrayBuffer()}
   const context=await browser.newContext({viewport:{width:group==='narrow'?390:1440,height:group==='narrow'?844:950},hasTouch:group==='narrow',isMobile:group==='narrow',reducedMotion:'reduce'});await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
   const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>{proof.errors.push(e.stack);record()});
   await exercise(p,base,{key,otherKey,name,assetId:asset.id},{from:proof.from,writingOnly:proof.writingOnly,narrow:group==='narrow',accept:check=>{proof.groups.push({group,check});record();console.log(group+': '+check)},snapshot:process.env.LISTENING_IMAGES?async(page,name)=>{fs.mkdirSync(process.env.LISTENING_IMAGES,{recursive:true});await page.screenshot({path:path.join(process.env.LISTENING_IMAGES,group+'-'+name+'.png')})}:null});
   await context.close();
  }
  assert.deepEqual(proof.errors,[]);assert.deepEqual(await(await fetch(base+'api/assets')).json(),catalog);assert(Buffer.from(await(await fetch(base+'api/media/'+asset.id)).arrayBuffer()).equals(wav));proof.complete=true;record();
 }catch(e){proof.failure=e.stack;record();throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true});proof.ownedSyntheticServicesStopped=true;record()}
})().catch(e=>{console.error(e);process.exitCode=1});
