const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process');
const assert = require('assert');
const {chromium} = require('playwright');
(async()=>{
 const root=process.env.CREATIVE_BOARD_TEST_ROOT||path.resolve(__dirname,'..'), tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-pan-'));
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});
 const base='http://127.0.0.1:'+port;
 const proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'},windowsHide:true});
 let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/index.html');await page.waitForFunction(()=>board&&!loading);
  const wav=Buffer.alloc(44+44100*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const upload=async(name,body)=>(await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':encodeURIComponent(name)},body})).json();
  const audio=await upload('playback.wav',wav);
  const videoBytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const stream=c.captureStream(10),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(r=>recorder.onstop=r);recorder.start();c.getContext('2d').fillRect(0,0,160,90);await new Promise(r=>setTimeout(r,250));recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))});
  const video=await upload('playback.webm',Buffer.from(videoBytes));
  const json=await upload('sample.json',JSON.stringify([{title:'试验记录',description:'检查阅读区域的右键拖动。'}]));
  await page.evaluate(async()=>{await loadAssets()});
  async function setup(kind){await page.evaluate(({kind,audio,video,json})=>{
   const item={id:'card',type:'note',title:'播放器',body:'记录内容',tags:[],x:180,y:120,w:650,h:550};
   if(kind==='audio'||kind==='video'){item.mediaId=(kind==='audio'?audio:video).id;item.assetId=item.mediaId}
   if(kind==='table'){item.type='table';item.columns=['声音'];item.rows=[['']];item.cellItems=[[[{...item,id:'in-cell',title:'声音',body:'',mediaId:audio.id,assetId:audio.id}]]]}
   if(kind==='json'){item.assetId=json.id;item.body=''}
   board.nodes=[item];board.edges=[];board.view={x:0,y:0,z:1};editorId=null;selected.clear();render();
  },{kind,audio,video,json});await page.waitForTimeout(100)}
  async function pan(selector,label,button='right',earlyMenu=false){
   const target=page.locator(selector).first();await target.waitFor({state:'visible'});
   const box=await target.boundingBox(), x=box.x+box.width*.6,y=box.y+box.height*.5;
   const before=await page.evaluate(()=>({view:{...view()},nodes:board.nodes.map(n=>({id:n.id,x:n.x,y:n.y})),selected:[...selected]}));
   await page.mouse.move(x,y);await page.mouse.down({button});
   if(earlyMenu)await page.evaluate(({x,y})=>canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,buttons:2,clientX:x,clientY:y})),{x,y});
   await page.mouse.move(x+65,y+37,{steps:8});await page.mouse.up({button});
   const after=await page.evaluate(()=>({view:{...view()},nodes:board.nodes.map(n=>({id:n.id,x:n.x,y:n.y})),selected:[...selected],gesture:gesture?.type,contextHidden:document.getElementById('fileContext').hidden}));
   assert(Math.abs(after.view.x-before.view.x-65)<2,label+' horizontal');assert(Math.abs(after.view.y-before.view.y-37)<2,label+' vertical');assert.deepEqual(after.nodes,before.nodes,label+' card positions');assert.deepEqual(after.selected,before.selected,label+' selection');assert(!after.gesture,label+' ended');assert(after.contextHidden,label+' no popup');
  }
  await setup('audio');await page.locator('audio').evaluate(el=>el.pause());
  await pan('.media-seek','音频控件');await pan('.media-seek','音频中键','middle');
  await pan('.media-seek','右键菜单先于拖动发出','right',true);
  // Custom controls preserve playback and seeking with the left button.
  await page.locator('.media-play').click();await page.waitForFunction(()=>!document.querySelector('audio').paused);await page.locator('audio').evaluate(el=>el.pause());
  let box=await page.locator('.media-seek').boundingBox();await page.mouse.click(box.x+box.width*.55,box.y+box.height/2);assert(await page.locator('audio').evaluate(el=>el.currentTime)>0,'Left-button seek still works');
  await setup('video');await pan('video','视频控件');
  await setup('table');await pan('.media-seek','表格音频');await page.evaluate(()=>openEditor('card'));await pan('.media-seek','编辑中表格音频');
  await setup('json');await page.locator('.json-reader').waitFor();await pan('.json-tools button','JSON按钮');await pan('.inline-json-body','JSON正文');
  await setup('note');
  const plain=await page.locator('.node .inner').boundingBox(),point={x:plain.x+20,y:plain.y+20};
  await page.mouse.move(point.x,point.y);await page.mouse.down({button:'right'});
  await page.evaluate(({x,y})=>canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,buttons:2,clientX:x,clientY:y})),point);
  assert(await page.locator('#fileContext').isHidden(),'An early context menu waits until a stationary right click is released');
  await page.mouse.up({button:'right'});await page.locator('#fileContext').waitFor({state:'visible'});
  assert((await page.locator('#fileContext').innerText()).includes('展开编辑'),'A stationary early right click retains the original content menu');
  await page.keyboard.press('Escape');
  await page.mouse.move(point.x,point.y);await page.mouse.down({button:'right'});
  await page.evaluate(({x,y})=>canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,buttons:2,clientX:x,clientY:y})),point);
  await page.keyboard.press('Escape');await page.mouse.up({button:'right'});
  assert(await page.locator('#fileContext').isHidden(),'Cancelling the gesture never opens a delayed menu on release');
  await page.evaluate(()=>{selected=new Set(['card']);openEditor('card')});await pan('#body','编辑正文');assert.equal(await page.locator('#body').inputValue(),'记录内容');
  assert.deepEqual(errors,[]);console.log('右键/中键：音频、视频、表格播放器、JSON与编辑正文拖动画布；左键播放和拖动进度通过');
 }finally{if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
