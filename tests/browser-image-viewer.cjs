const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert'),{spawn}=require('child_process');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-image-viewer-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'},windowsHide:true});let browser;
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,'Synthetic service ready');
  const value={format:'creative-board',version:1,name:'Image preview fixture',folder:'',nodes:[],edges:[],view:{x:19,y:31,z:.9}};
  assert((await fetch(base+'/api/boards/viewer',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)})).ok);
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#c9d8c3"/><circle cx="600" cy="400" r="230" fill="#405345"/></svg>');
  const asset=await(await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':'synthetic-image.svg'},body:svg})).json();assert(asset.id);
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});const p=await browser.newPage({viewport:{width:390,height:760}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/?board=viewer');await p.waitForFunction(()=>pane(current())?.state().boardId==='viewer');await p.locator('#openBoards').click();await p.waitForFunction(()=>whiteboardWorkspace.explorer());
  const library=p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await library.waitForFunction(()=>board&&!loading&&typeof openImageView==='function');await library.evaluate(()=>loadAssets());await library.locator('#assetsButton').click();
  const before=await(await fetch(base+'/api/boards/viewer')).text();let writes=0;p.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes++});
  await library.locator('[data-asset-preview="'+asset.id+'"]').click();await library.waitForFunction(()=>document.querySelector('#viewerImage').naturalWidth===1200);
  const measurement=()=>library.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth}};return {width:innerWidth,height:innerHeight,bar:rect(document.querySelector('.viewer-bar')),stage:rect(document.querySelector('#viewerStage')),controls:[...document.querySelectorAll('.viewer-bar button,.viewer-bar>span,.viewer-zoom')].map(e=>({id:e.id||e.className,text:e.textContent,...rect(e)}))}});
  if(process.env.IMAGE_VIEWER_BASELINE){const m=await measurement();if(process.env.IMAGE_VIEWER_SCREENSHOTS){fs.mkdirSync(process.env.IMAGE_VIEWER_SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.IMAGE_VIEWER_SCREENSHOTS,'before-sidebar.png')})}console.log(JSON.stringify({baseline:m}));return}
  for(const size of [[390,760],[800,700],[1400,900],[390,320]]){
   await p.setViewportSize({width:size[0],height:size[1]});await library.waitForFunction(()=>innerWidth===document.documentElement.clientWidth);const m=await measurement();
   for(const c of m.controls){assert(c.x>=0&&c.right<=m.width+.5&&c.y>=0&&c.bottom<=m.bar.bottom+.5,'Viewer controls stay inside the sidebar: '+JSON.stringify({size,m}));if(c.id!=='viewerName')assert(c.scroll<=c.client+1,'Button text fits')}
   assert(m.bar.scroll<=m.bar.client+1&&m.stage.h>60,'Controls do not overflow or consume the image');
   for(const c of m.controls.filter(c=>c.id.startsWith('viewer')&&!['viewerName','viewerScale'].includes(c.id)))assert(c.w>=28&&c.h>=28,'Controls remain usable');
  }
  await p.setViewportSize({width:390,height:760});await library.locator('#viewerFit').click();const fit=await library.evaluate(()=>({...imageView}));assert(fit.z>0&&fit.z<1);await library.locator('#viewerActual').click();assert.equal(await library.evaluate(()=>imageView.z),1);await library.locator('#viewerIn').click();assert(await library.evaluate(()=>imageView.z>1));await library.locator('#viewerOut').click();assert.equal(await library.evaluate(()=>imageView.z),1);
  const stage=await library.locator('#viewerStage').boundingBox(),start=await library.evaluate(()=>({...imageView}));await p.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);await p.mouse.down();await p.mouse.move(stage.x+stage.width/2+20,stage.y+stage.height/2+15);await p.mouse.up();assert.equal(await library.evaluate(()=>imageView.x),start.x+20);assert.equal(await library.evaluate(()=>imageView.y),start.y+15);
  if(process.env.IMAGE_VIEWER_SCREENSHOTS){fs.mkdirSync(process.env.IMAGE_VIEWER_SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.IMAGE_VIEWER_SCREENSHOTS,'after-sidebar.png')})}
  await library.locator('#viewerClose').click();assert(await library.locator('#imageViewer').isHidden());await library.evaluate(id=>previewAsset(id),asset.id);await library.locator('#viewerFit').focus();await p.keyboard.press('Escape');assert(await library.locator('#imageViewer').isHidden());
  // The same viewer is used from an ordinary full-width canvas.
  const canvas=p.frames().find(f=>f.url().includes('/index.html?')&&new URL(f.url()).searchParams.get('board')==='viewer'&&!new URL(f.url()).searchParams.has('explorer'));
  await p.setViewportSize({width:1400,height:900});await canvas.evaluate(src=>openImageView(src,'Synthetic image'),base+'/api/media/'+asset.id);await canvas.waitForFunction(()=>document.querySelector('#viewerImage').naturalWidth===1200);
  const wide=await canvas.locator('.viewer-bar').evaluate(e=>({height:e.getBoundingClientRect().height,buttons:[...e.querySelectorAll('button')].map(b=>b.getBoundingClientRect().y)}));assert(wide.height<=56&&Math.max(...wide.buttons)-Math.min(...wide.buttons)<1,'Wide canvas retains a single compact toolbar');await canvas.locator('#viewerClose').click();
  assert.equal(await(await fetch(base+'/api/boards/viewer')).text(),before,'Preview never changes authored data');assert.equal(writes,0,'Preview, zoom, dragging and exits never save');assert.deepEqual(errors,[]);console.log('Image preview: narrow/wide/short sidebar controls, fit/actual/zoom/pan, click/Esc exit and full-width toolbar; no authored writes, passed');
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
