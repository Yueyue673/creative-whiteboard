const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process');
const assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-interface-'));
 const port=await require('./browser-port.cjs')();
 const base='http://127.0.0.1:'+port;
 const proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{
  env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'},windowsHide:true
 });
 let browser;
 try {
  for(let i=0;i<100;i++){
   try{if((await fetch(base+'/api/health')).ok)break}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
  const ctx=await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write']});
  const p=await ctx.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/index.html');await p.waitForFunction(()=>board&&!loading);
  await p.evaluate(()=>{
   board.name='拍摄观察';board.view={x:0,y:0,z:1};
   board.nodes=[
    {id:'n',type:'note',title:'纸面与光线',body:'侧光下，纸张的折痕会更清楚。\n先比较两个角度，再决定用哪个镜头。',annotation:'保留现场的小变化。',color:'#fff0aa',tags:[],x:420,y:90,w:310,h:280},
    {id:'m',type:'note',title:'声音记录',body:'留意开头的短促声。',color:'#dde6da',tags:[],x:820,y:100,w:300,h:220},
    {id:'t',type:'table',title:'分镜记录',columns:['画面','声音','待确认'],rows:[['手指轻敲桌面','轻敲声','近景的角度'],['纸张慢慢展开','现场环境声','比较两个速度'],['','', '']],color:'#fff',tags:[],x:410,y:440,w:760,h:370}
   ];board.edges=[];selected.clear();editorId=null;render();change();
  });
  await p.evaluate(()=>showWorkspaceTab('manager'));
  assert(await p.locator('#manager .manager-hint').isHidden());
  assert(await p.locator('#workspaceGuide').isHidden());
  // Editing ends on a different card, and selecting it later does not reopen the editor.
  await p.locator('[data-id=n]').dblclick({position:{x:60,y:70}});
  await p.waitForFunction(()=>editorId==='n');
  await p.locator('[data-id=m] .edit-scroll').click({position:{x:70,y:75}});
  assert.equal(await p.evaluate(()=>editorId),null);
  await p.locator('[data-id=n] .edit-scroll').click({position:{x:70,y:75}});
  assert.equal(await p.evaluate(()=>editorId),null);
  await p.locator('[data-id=n]').click({button:'right',position:{x:65,y:60}});
  await p.getByRole('menuitem',{name:'编辑',exact:true}).click();
  await p.waitForFunction(()=>editorId==='n');
  assert(await p.locator('#inlineImages').isHidden());
  assert.equal(await p.locator('#inlineDetails').count(),1);
  await p.locator('#inlineDone').click();
  // Tab navigates scalar cells without changing data or adding rows.
  await p.locator('[data-id=t]').dblclick({position:{x:120,y:95}});
  await p.locator('textarea[data-row="0"][data-col="0"]').focus();
  const rows=await p.evaluate(()=>JSON.stringify(board.nodes.find(n=>n.id==='t').rows));
  await p.keyboard.press('Tab');
  assert(await p.locator('textarea[data-row="0"][data-col="1"]').evaluate(el=>el===document.activeElement));
  await p.keyboard.press('Shift+Tab');
  assert(await p.locator('textarea[data-row="0"][data-col="0"]').evaluate(el=>el===document.activeElement));
  assert.equal(await p.evaluate(()=>JSON.stringify(board.nodes.find(n=>n.id==='t').rows)),rows);
  await p.locator('#inlineDone').click();
  // Build folders and a real playable file in the isolated library.
  const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);
  const response=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':'tap.wav'},body:wav});assert(response.ok);
  const asset=await response.json();
  await p.evaluate(async id=>{
   await loadAssets();const next=clone(assetIndex);next.folders=['观察','观察/声音','待整理'];
   next.assets.find(a=>a.id===id).folder='观察/声音';await saveAssets(next);await showWorkspaceTab('assetPane');enterAssetFolder('');
  },asset.id);
  assert(await p.locator('.library-guide').isHidden());
  assert(await p.locator('#assetReload').isHidden());
  await p.locator('[data-asub="观察"]').click();assert.equal(await p.evaluate(()=>assetFolder),'');
  assert(await p.locator('[data-asub="观察"]').evaluate(el=>el.classList.contains('selected')));
  await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>assetFolder),'观察');
  await p.locator('[data-asub="观察/声音"]').dblclick();assert.equal(await p.evaluate(()=>assetFolder),'观察/声音');
  await p.locator('[data-asset]').click({button:'right',position:{x:90,y:35}});
  assert.equal(await p.getByRole('menuitem',{name:/放到白板/}).count(),0);
  assert.equal(await p.getByRole('menuitem',{name:/添加选中的/}).count(),1);
  await p.keyboard.press('Escape');
  await p.locator('#sidebarClose').click();
  await p.getByRole('menuitem',{name:'显示文件夹树',exact:true}).click();
  assert(await p.locator('#assetTree').isVisible());
  await p.locator('#sidebarClose').click();
  await p.keyboard.press('End');assert(await p.getByRole('menuitem',{name:/收起侧栏/}).evaluate(el=>el===document.activeElement));
  await p.keyboard.press('Escape');
  await p.evaluate(()=>placeAssets(assetIndex.assets.map(a=>a.id),{x:1220,y:110}));
  await p.waitForFunction(()=>document.querySelector('.node audio')?.readyState>=1);
  assert(await p.locator('.node .playback-state').isHidden());
  assert.equal(await p.locator('.node .wf-origin').count(),1);
  assert(await p.locator('.node .wf-origin').isHidden());
  const sourceNote=await p.evaluate(()=>board.nodes.find(n=>n.assetId).id);
  await p.evaluate(id=>openEditor(id),sourceNote);
  await p.locator('#inlineDetails').click();assert(await p.locator('.node .wf-origin').isVisible());
  await p.keyboard.press('Escape');await p.locator('#inlineDone').click();
  await p.evaluate(()=>persist());
  // Sidebar preferences survive reload; normal controls are still reachable.
  await p.reload();await p.waitForFunction(()=>board&&!loading);
  assert(await p.locator('#assetPane').isVisible());
  await p.evaluate(()=>{applyInterfacePrefs({scale:1.25,width:340});fit()});
  await p.setViewportSize({width:960,height:800});
  const geometry=await p.evaluate(()=>{
   const canvasRect=canvas.getBoundingClientRect(),dock=$('creationDock').getBoundingClientRect(),zoom=$('canvasTools').getBoundingClientRect();
   return {overlap:dock.left<zoom.right&&dock.right>zoom.left&&dock.top<zoom.bottom&&dock.bottom>zoom.top,inside:dock.left>=canvasRect.left&&dock.right<=canvasRect.right&&zoom.right<=canvasRect.right};
  });
  assert(!geometry.overlap&&geometry.inside,'Creation and zoom controls must fit without overlap');
  await p.evaluate(()=>{applyInterfacePrefs({scale:1,width:340});localStorage.removeItem('creative-sidebar-state')});
  // Root More closes on outside click, Escape, and interaction in a board pane.
  await p.setViewportSize({width:1600,height:1000});await p.goto(base);
  await p.waitForFunction(()=>pane(current())?.state().boardId);
  await p.locator('#shellMore>summary').click();await p.mouse.click(670,48);
  assert.equal(await p.locator('#shellMore').evaluate(el=>el.open),false);
  await p.locator('#shellMore>summary').click();await p.keyboard.press('Escape');
  assert.equal(await p.locator('#shellMore').evaluate(el=>el.open),false);
  const frame=p.frames().find(f=>f.url().includes('/index.html?'));
  await p.locator('#shellMore>summary').click();await frame.locator('#canvas').click({position:{x:200,y:60}});
  await p.waitForFunction(()=>!document.getElementById('shellMore').open);
  await p.locator('#openBoards').click();await p.waitForFunction(()=>window.whiteboardWorkspace.explorer());const shared=p.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await shared.locator('#manage').click();await frame.evaluate(()=>fit());
  if(process.env.INTERFACE_SCREENSHOT)await p.screenshot({path:process.env.INTERFACE_SCREENSHOT});
  console.log('界面：结束编辑、表格键盘导航、文件夹选择与打开、菜单去重与关闭、来源查看、侧栏恢复、窄屏布局通过');
  assert.deepEqual(errors,[]);
 } finally {
  if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));
  const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
