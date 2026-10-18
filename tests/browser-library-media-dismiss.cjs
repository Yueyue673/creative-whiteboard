const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{chromium}=require('playwright');

(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-library-media-dismiss-'));
 const port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:temp,PYTHONIOENCODING:'utf-8'}});
 let browser;
 try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
  assert(ready);
  const wav=Buffer.alloc(44+8000*2*30);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const video=fs.readFileSync(path.join(__dirname,'fixtures/media-preview.webm'));
  async function upload(name,bytes){const r=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':name},body:bytes});assert(r.ok);return r.json()}
  const audioAsset=await upload('supplied-audio.wav',wav),videoAsset=await upload('supplied-video.webm',video);
  const catalog=await(await fetch(base+'/api/assets')).json();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const group of ['wide','narrow','standalone']){
   if(process.env.MEDIA_DISMISS_ONLY&&!process.env.MEDIA_DISMISS_ONLY.split(',').includes(group))continue;
   const context=await browser.newContext({viewport:{width:group==='narrow'?390:1440,height:900},hasTouch:group==='narrow',isMobile:group==='narrow'});
   const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto(base+(group==='standalone'?'/index.html':'/'),{waitUntil:'domcontentloaded'});
   let f;
   if(group==='standalone'){f=p;await f.waitForFunction(()=>board&&!loading);await f.evaluate(()=>showWorkspaceTab('assetPane'))}
   else{await p.waitForFunction(()=>layoutLoaded);await p.locator('#openBoards').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());f=p.frames().find(frame=>new URL(frame.url()).searchParams.get('explorer')==='1');await f.locator('#assetsButton').click()}
   await f.waitForFunction(()=>assetIndex.assets.length===2);
   let authoredBefore,canvasPlayer;
   if(group==='standalone'){
    await f.evaluate(id=>{board.nodes=[{id:'supplied-note',type:'note',title:'Supplied title',body:'Supplied text stays exact.',x:60,y:90,w:300,h:180,sizeMode:'manual',color:'#fff0aa'},{id:'playing-peer',type:'note',title:'Supplied canvas audio',body:'',assetId:id,mediaId:id,x:430,y:90,w:400,h:180,sizeMode:'manual',color:'#ffffff'}];board.edges=[];selected.clear();editorId=null;render()},audioAsset.id);
    await f.waitForFunction(()=>document.querySelector('[data-id=playing-peer] audio')?.readyState>=1);
    canvasPlayer=await f.locator('[data-id=playing-peer] audio').elementHandle();
    await f.locator('[data-id=playing-peer] .media-play').click();
    assert.equal(await canvasPlayer.evaluate(el=>el.paused),false);
    authoredBefore=await f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)}));
   }
   async function preview(asset){await f.locator('[data-asset="'+asset.id+'"]').dblclick();await f.waitForFunction(()=>{const el=document.querySelector('#dialog audio,#dialog video');return el?._readingRestored&&el.readyState>=1&&el.duration>0});return f.locator('#dialog audio,#dialog video')}
   async function play(media){const handle=await media.elementHandle();await handle.evaluate(el=>{el.muted=true;el.currentTime=Math.min(el.duration/3,4)});if(await handle.evaluate(el=>el.tagName==='AUDIO')){const box=await media.boundingBox();await p.mouse.click(box.x+26,box.y+27)}else await handle.evaluate(el=>el.play());await f.waitForFunction(el=>!el.paused,handle);assert.equal(await handle.evaluate(el=>el.paused),false);return handle}
   for(const asset of [audioAsset,videoAsset])for(const action of ['button','escape','description']){
    const media=await preview(asset),player=await play(media),position=await player.evaluate(el=>el.currentTime);
    if(action==='button')await f.locator('#dialogActions').getByRole('button',{name:'关闭',exact:true}).click();
    else if(action==='escape')await p.keyboard.press('Escape');
    else await f.locator('#dialogActions').getByRole('button',{name:'修改说明',exact:true}).click();
    await f.waitForFunction(()=>!document.querySelector('#dialog audio,#dialog video')||!document.querySelector('#dialog').open);
    // Escape closes natively, then queues the dialog's close event. Check the
    // completed dismissal within a bound, rather than racing that native task.
    await f.waitForFunction(el=>el.paused,player,{timeout:1000});
    assert.equal(await player.evaluate(el=>el.paused),true,group+' '+asset.mime+' '+action+' stops dismissed playback');
    const stopped=await player.evaluate(el=>el.currentTime);assert(stopped>=position&&stopped-position<1);
    await f.evaluate(()=>{if(document.getElementById('dialog').open)document.getElementById('dialog').close()});
    const reopened=await preview(asset);
    assert.equal(await reopened.evaluate(el=>el.paused),true,'Returning never autoplays');
    assert(Math.abs(await reopened.evaluate(el=>el.currentTime)-stopped)<.2,'Return to the captured timestamp');
    await f.locator('#dialogActions').getByRole('button',{name:'关闭',exact:true}).click();
   }
   // Reusing the original dialog finishes the old preview synchronously. A later
   // queued native close must not stop a newer player in that same dialog.
   const first=await preview(audioAsset),old=await play(first);
   await f.evaluate(id=>previewAsset(id),videoAsset.id);
   await f.waitForFunction(()=>document.querySelector('#dialog video')?._readingRestored);
   assert.equal(await old.evaluate(el=>el.paused),true);
   const next=await play(f.locator('#dialog video'));
   await f.evaluate(()=>document.getElementById('dialog').close());
   await f.evaluate(id=>previewAsset(id),audioAsset.id);
   await f.waitForFunction(()=>document.querySelector('#dialog audio')?._readingRestored);
   const latest=await play(f.locator('#dialog audio'));
   await f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal(await next.evaluate(el=>el.paused),true);
   assert.equal(await latest.evaluate(el=>el.paused),false,'Stale close does not stop the current player');
   await f.locator('#dialogActions').getByRole('button',{name:'关闭',exact:true}).click();
   assert.equal(await latest.evaluate(el=>el.paused),true);
   if(canvasPlayer){assert.equal(await canvasPlayer.evaluate(el=>el.paused),false,'Dismiss only the preview, leaving canvas playback alone');await canvasPlayer.evaluate(el=>el.pause());assert.deepEqual(await f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future)})),authoredBefore)}
   assert.deepEqual(errors,[]);await context.close();console.log('Library media dismissal '+group+' passed');
  }
  assert.deepEqual(await(await fetch(base+'/api/assets')).json(),catalog,'Preview never edits source metadata');
  for(const [asset,bytes]of [[audioAsset,wav],[videoAsset,video]])assert(Buffer.from(await(await fetch(base+'/api/media/'+asset.id)).arrayBuffer()).equals(bytes),'Original media bytes remain exact');
 }finally{
  if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));
  assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
