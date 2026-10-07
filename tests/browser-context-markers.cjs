const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),{spawn}=require('child_process'),assert=require('assert');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-markers-'));
 const port=await require('./browser-port.cjs')();
 const base='http://127.0.0.1:'+port,proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'},windowsHide:true});let browser,p;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  const wav=Buffer.alloc(44+128000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(128000,40);
  const audio=await(await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':'sound.wav'},body:wav})).json();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});p=await browser.newPage({viewport:{width:1600,height:1050}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/index.html');await p.waitForFunction(()=>board&&!loading&&window.whiteboardContext&&window.whiteboardNavigation);await p.evaluate(()=>loadAssets());
  const image=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=450;const x=c.getContext('2d');x.fillStyle='#4f7474';x.fillRect(0,0,800,450);x.fillStyle='#f3bc67';x.fillRect(250,100,300,250);return c.toDataURL()});
  await p.evaluate(({audio,image})=>{board.nodes=[{id:'frame',type:'frame',title:'一组观察',body:'',x:40,y:40,w:950,h:720},{id:'sound',type:'note',title:'现场声音',body:'',assetId:audio.id,mediaId:audio.id,x:80,y:100,w:390,h:180,tags:[]},{id:'image',type:'image',title:'画面观察',body:'',images:[{data:image}],x:520,y:100,w:420,h:300,tags:[]},{id:'table',type:'table',title:'镜头记录',body:'',columns:['画面','声音'],rows:[['侧光','']],cellImages:[],cellItems:[],x:80,y:450,w:800,h:270,tags:[]},{id:'outside',type:'note',title:'未选择',body:'这段未选中的正文不能泄露',x:1100,y:80,w:260,h:180,tags:[]}];board.edges=[{id:'edge',from:'sound',to:'image',label:'同一段素材'}];board.view={x:20,y:20,z:1};selected.clear();editorId=null;render();change()}, {audio,image});
  const sound=p.locator('#nodes>[data-id=sound]');await sound.locator('audio').evaluate(el=>el.currentTime=2.5);await sound.locator('.media-marker-toggle').click();await p.locator('.media-add-marker').click();await p.locator('.media-marker-title').fill('开头动作');await p.locator('.media-marker-note').fill('这一拍接近景；保留现场声音。');await p.locator('.media-marker-time').fill('0:02.5');await p.locator('.media-marker-time').press('Tab');await p.locator('.media-marker-start').check();
  await sound.locator('audio').evaluate(el=>el.currentTime=3.7);await p.locator('.media-add-marker').click();await p.locator('.media-marker-title').fill('下一段');await p.locator('.media-marker-note').fill('可以作为另一处转场。');
  if(process.env.CONTEXT_SCREENSHOT_DIR){fs.mkdirSync(process.env.CONTEXT_SCREENSHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.CONTEXT_SCREENSHOT_DIR,'time-markers.png')})}
  await p.keyboard.press('Escape');await sound.locator('audio').evaluate(el=>{el.currentTime=5.1;el._captureReading()});await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);await p.waitForFunction(()=>Math.abs(document.querySelector('[data-id=sound] audio').currentTime-2.5)<.15);assert.equal(await p.evaluate(()=>Object.values(board.nodes.find(n=>n.id==='sound').mediaTimeline)[0].markers[0].note),'这一拍接近景；保留现场声音。');
  await sound.locator('.media-marker-toggle').click();await p.locator('.media-marker-row').filter({hasText:'下一段'}).click();assert(Math.abs(await sound.locator('audio').evaluate(el=>el.currentTime)-3.7)<.1);await p.locator('.media-resume').click();await p.keyboard.press('Escape');await sound.locator('audio').evaluate(el=>{el.currentTime=6.2;el._captureReading()});await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);await p.waitForFunction(()=>Math.abs(document.querySelector('[data-id=sound] audio').currentTime-6.2)<.15);
  await p.evaluate(()=>{const t=board.nodes.find(n=>n.id==='table');t.cellItems=[[[{...clone(board.nodes.find(n=>n.id==='sound')),id:'cell-sound',title:'单元格声音',images:clone(board.nodes.find(n=>n.id==='image').images)}],[]]];drawNodes();change()});const cell=p.locator('[data-id=table] [data-cell-item]');await cell.locator('.media-marker-toggle').click();await p.locator('.media-add-marker').click();await p.locator('.media-marker-title').fill('表格里的新标记');await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>Object.values(board.nodes.find(n=>n.id==='sound').mediaTimeline)[0].markers.length),2);assert.equal(await p.evaluate(()=>Object.values(board.nodes.find(n=>n.id==='table').cellItems[0][0][0].mediaTimeline)[0].markers.length),3);
  await p.evaluate(()=>whiteboardReading.open('sound'));await p.locator('#immersiveSurface .media-marker-toggle').click();assert(await p.locator('#dialog #mediaPopover').isVisible(),'Marker editor works inside expanded editing');await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  await p.evaluate(()=>{selected=new Set(['frame','sound','image','table']);refreshSelectionUI();whiteboardAI.compose()});await p.locator('#aiTaskText').fill('查找有关的内容组织体系及原始出处，不修改作品。');const pack=await p.evaluate(()=>whiteboardAI.makePack());assert.equal(pack.data.nodes.length,4);assert(!JSON.stringify(pack).includes('这段未选中的正文不能泄露'));assert(pack.spatial.groups.find(g=>g.id==='frame').members.includes('image'));assert(pack.visuals.images.some(im=>im.kind==='viewport'),JSON.stringify(pack.visuals.coverage));assert(pack.visuals.images.some(im=>im.kind==='overview'));assert(pack.visuals.images.some(im=>im.kind==='image'));assert(pack.visuals.images.some(im=>im.locations?.some(p=>p.ownerId==='cell-sound')),'Shared image retains its table-item location');assert(pack.spatial.tables[0].cells.some(c=>c.itemIds.includes('cell-sound')));assert(pack.data.nodes.find(n=>n.id==='sound').mediaTimeline);assert.equal((await p.evaluate(()=>whiteboardAI.makePack())).requestId,pack.requestId,'Prepared task is reused for copying and download');
  for(const im of pack.visuals.images){const raw=Buffer.from(await(await fetch(im.url)).arrayBuffer());assert.equal(raw.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert(fs.existsSync(im.localPath));if(process.env.CONTEXT_SCREENSHOT_DIR)fs.writeFileSync(path.join(process.env.CONTEXT_SCREENSHOT_DIR,im.name),raw)}
  const bundleResponse=await fetch(base+'/api/ai/tasks/'+pack.requestId+'/bundle');assert(bundleResponse.ok);
  // Consume the download, including under Node 22 where an unread large body
  // can crash Undici's paused parser when the local server closes its socket.
  const bundleBytes=Buffer.from(await bundleResponse.arrayBuffer());
  assert.equal(bundleBytes.subarray(0,4).toString('hex'),'504b0304','The research download has a ZIP header');
  await p.locator('#aiVisuals').uncheck();const noImages=await p.evaluate(()=>whiteboardAI.makePack());assert.equal(noImages.visuals.images.length,0);assert(noImages.spatial.items.length===4);await p.keyboard.press('Escape');
  await p.evaluate(()=>{selected=new Set(['image']);refreshSelectionUI();canvas.focus()});const x=await p.evaluate(()=>board.nodes.find(n=>n.id==='image').x);await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='image').x),x+1);await p.evaluate(()=>whiteboardNavigation.write({snap:true,zoomSpeed:1,nudge:2,bigNudge:25,gap:32}));await p.keyboard.press('Shift+ArrowRight');assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='image').x),x+26);await p.keyboard.press('Shift+2');assert.equal(await p.evaluate(()=>selected.size),1);assert(await p.evaluate(()=>view().z)>1);await p.evaluate(()=>{selected=new Set(['sound','image']);whiteboardNavigation.arrange('y','start')});assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='sound').y),await p.evaluate(()=>board.nodes.find(n=>n.id==='image').y));await p.evaluate(()=>whiteboardNavigation.arrange('x','spacing',40));assert.equal(await p.evaluate(()=>{const a=board.nodes.find(n=>n.id==='sound'),b=board.nodes.find(n=>n.id==='image');return b.x-a.x-a.w}),40);
  await p.evaluate(()=>{selected=new Set(['sound']);fit();canvas.focus()});await p.keyboard.press('h');const controls=await sound.locator('.media-seek').boundingBox(),oldView=await p.evaluate(()=>({...view()}));await p.mouse.move(controls.x+controls.width*.5,controls.y+controls.height*.5);await p.mouse.down();await p.mouse.move(controls.x+controls.width*.5+60,controls.y+controls.height*.5+30,{steps:5});await p.mouse.up();const newView=await p.evaluate(()=>({...view()}));assert(Math.abs(newView.x-oldView.x-60)<2,'Hand tool pans over player controls');await p.keyboard.press('v');
  await p.evaluate(()=>{whiteboardAppearance.open()});await p.locator('#navZoom').fill('150');await p.locator('#navNudge').fill('3');assert.equal(await p.evaluate(()=>whiteboardNavigation.read().zoomSpeed),1.5);assert.equal(await p.evaluate(()=>whiteboardNavigation.read().nudge),3);await p.locator('#appearanceDone').click();await p.reload();await p.waitForFunction(()=>board&&!loading);assert.equal(await p.evaluate(()=>whiteboardNavigation.read().nudge),3);
  const html=await(await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':'navigation.html'},body:'<!doctype html><h1>Reading</h1><button onclick="this.textContent=String(Number(this.textContent)+1)">0</button><p>Document navigation</p>'})).json();await p.evaluate(async id=>{await loadAssets();board.nodes=[{id:'web',type:'note',assetId:id,x:120,y:80,w:640,h:580,title:'网页',body:'',tags:[]}];board.edges=[];board.view={x:0,y:0,z:1};selected.clear();editorId=null;render();canvas.focus()},html.id);await p.waitForFunction(()=>document.querySelector('.web-navigation-cover')?.hidden===true);const frame=await p.locator('.web-frame-host iframe').contentFrame();await frame.locator('h1').waitFor();const start=await p.evaluate(()=>({...view()}));await p.keyboard.press('h');let web=await p.locator('.web-frame-host').boundingBox();await p.mouse.move(web.x+web.width*.6,web.y+web.height*.5);await p.mouse.down();await p.mouse.move(web.x+web.width*.6+50,web.y+web.height*.5+30,{steps:5});await p.mouse.up();assert(Math.abs(await p.evaluate(()=>view().x)-start.x-50)<2);assert(Math.abs(await p.evaluate(()=>view().y)-start.y-30)<2);await p.mouse.dblclick(web.x+web.width*.6+50,web.y+web.height*.5+30);assert.equal(await p.evaluate(()=>editorId),null,'Hand tool does not enter editing');await p.keyboard.press('v');await frame.locator('button').click();assert.equal(await frame.locator('button').textContent(),'1','Returning to selection restores real document interaction');await p.evaluate(()=>canvas.focus());const next=await p.evaluate(()=>({...view()}));await p.keyboard.down('Space');web=await p.locator('.web-frame-host').boundingBox();await p.mouse.move(web.x+web.width*.5,web.y+web.height*.6);await p.mouse.down();await p.mouse.move(web.x+web.width*.5+45,web.y+web.height*.6+25,{steps:5});await p.mouse.up();await p.keyboard.up('Space');assert(Math.abs(await p.evaluate(()=>view().x)-next.x-45)<2);assert(Math.abs(await p.evaluate(()=>view().y)-next.y-25)<2);assert.equal(await p.evaluate(()=>canvas.classList.contains('space-panning')),false);console.log('嵌入网页：手形与空格左键拖动、手形双击不误编辑、返回选择后网页控件可用，通过');
  await p.evaluate(()=>{board.nodes=[];board.edges=[];board.view={x:0,y:0,z:1};render();addNote({x:450,y:180},{title:'观察',body:'一句观察。'})});await p.waitForFunction(()=>board.nodes[0].h<=200);const noteId=await p.evaluate(()=>board.nodes[0].id),small=await p.evaluate(()=>board.nodes[0].h);assert.equal(await p.evaluate(()=>board.nodes[0].sizeMode),'auto');await p.locator('#body').fill('这是一段由作者输入的观察。'.repeat(70));await p.waitForFunction(h=>board.nodes[0].h>h+200,small);const tall=await p.evaluate(()=>board.nodes[0].h);await p.locator('#body').fill('短一些。');await p.waitForFunction(h=>board.nodes[0].h<h-150,tall);await p.evaluate(id=>whiteboardSizing.setMode(id,'manual'),noteId);const fixed=await p.evaluate(()=>board.nodes[0].h);await p.locator('#body').fill('固定尺寸之后，长内容在卡片内滚动。'.repeat(80));await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>board.nodes[0].h),fixed);await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);assert.equal(await p.evaluate(()=>board.nodes[0].h),fixed);assert.equal(await p.evaluate(()=>board.nodes[0].sizeMode),'manual');await p.evaluate(id=>whiteboardSizing.setMode(id,'auto'),noteId);await p.waitForFunction(h=>board.nodes[0].h>h+200,fixed);await p.evaluate(()=>{board.view={x:0,y:0,z:.7};moveView();selected=new Set([board.nodes[0].id]);refreshSelectionUI()});const resize=await p.locator('#nodes [data-resize-direction=se]').boundingBox();assert(resize);await p.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await p.mouse.down();await p.mouse.move(resize.x+80,resize.y+40,{steps:4});await p.mouse.up();assert.equal(await p.evaluate(()=>board.nodes[0].sizeMode),'manual');const manualSize=await p.evaluate(()=>({w:board.nodes[0].w,h:board.nodes[0].h}));await p.locator('#nodes .node').click({position:{x:30,y:30}});await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);assert.deepEqual(await p.evaluate(()=>({w:board.nodes[0].w,h:board.nodes[0].h})),manualSize);console.log('新便签默认增高/缩短、固定尺寸、重新开启自动适应、手动拖拽后固定、保存重开，通过');
  await p.evaluate(()=>{board.nodes=Array.from({length:800},(_,i)=>({id:'auto-'+i,type:'note',sizeMode:'auto',x:(i%25)*330,y:Math.floor(i/25)*170,w:300,h:120,title:'观察 '+i,body:'由作者输入的观察。',tags:[]}));board.edges=[];selected.clear();editorId=null;board.view={x:0,y:0,z:.7};render()});await p.waitForTimeout(150);const timing=await p.evaluate(async()=>{const el=document.querySelector('[data-id=auto-20]'),height=el.offsetHeight,field=el.querySelector('[data-preview-id=body]'),style=field.getAttribute('style'),start=performance.now();selected=new Set(['auto-1']);refreshSelectionUI();drawNodes();await new Promise(r=>requestAnimationFrame(r));return {elapsed:performance.now()-start,preserved:el===document.querySelector('[data-id=auto-20]'),heightSame:height===el.offsetHeight,styleSame:style===field.getAttribute('style')}});assert(timing.preserved&&timing.heightSame&&timing.styleSame,'Selecting a card does not rewrite or resize unchanged text fields');assert(timing.elapsed<2500,'800 adaptive cards keep selection responsive');console.log('800 块自动尺寸便签：选择保留尺寸与原文字段，耗时 '+Math.round(timing.elapsed)+' ms');
  // The actual alignment panel retains each whole command group in a narrow
  // window, and its short captions still name the intended spatial action.
  const arranging=[
   {id:'arrange-first',type:'note',title:'第一段原文',body:'保留自己的观察。',x:60,y:100,w:220,h:150,sizeMode:'manual',color:'#fff0aa',tags:[]},
   {id:'arrange-second',type:'note',title:'另一段原文',body:'对照这段记录。',x:460,y:200,w:260,h:190,sizeMode:'manual',color:'#dcebc7',tags:[]}
  ];
  await p.setViewportSize({width:1400,height:900});
  await p.evaluate(nodes=>{board.nodes=clone(nodes);board.edges=[];board.view={x:0,y:0,z:1};selected=new Set(nodes.map(n=>n.id));editorId=null;history=[];future=[];render()},arranging);
  await p.locator('[data-id=arrange-first]').getByRole('button',{name:'内容操作',exact:true}).click();await p.getByRole('menuitem',{name:'对齐与间距…',exact:true}).click();
  const arrangePanel=p.locator('#dialog');
  for(const preset of ['resolve','paper','slate'])for(const width of [1400,620,360,230]){
   await p.evaluate(preset=>whiteboardAppearance.apply({preset,custom:{},note:'#fff0aa'}),preset);await p.setViewportSize({width,height:760});
   const bounds=await arrangePanel.evaluate(el=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,height:r.height}},body=el.querySelector('#dialogBody');return {dialog:box(el),viewport:innerWidth,groups:[...el.querySelectorAll('.arrange-axis')].map(group=>[...group.querySelectorAll('button')].map(box)),buttons:[...el.querySelectorAll('[data-align]')].map(b=>({...box(b),scroll:b.scrollWidth,client:b.clientWidth})),body:{scroll:body.scrollWidth,client:body.clientWidth}}});
   assert(bounds.dialog.x>=0&&bounds.dialog.right<=bounds.viewport&&bounds.body.scroll<=bounds.body.client+1,'The panel retains margins without horizontal scrolling');
   assert(bounds.groups.every(group=>group.length===3&&group.every(b=>Math.abs(b.y-group[0].y)<1)),'Each axis stays together in a complete row');
   assert(bounds.buttons.every(b=>b.height>=44&&b.x>=bounds.dialog.x&&b.right<=bounds.dialog.right&&b.scroll<=b.client+1),'Captions fit comfortable complete command targets');
   assert.deepEqual(await p.evaluate(()=>board.nodes),arranging,'Window and theme changes cannot rearrange authored notes');
  }
  await p.setViewportSize({width:360,height:320});
  const exit=await arrangePanel.getByRole('button',{name:'返回白板',exact:true}).boundingBox();assert(exit.y>=0&&exit.y+exit.height<=320,'The return action stays visible in a short window');
  const commands=[['左边对齐','x','start'],['水平居中对齐','x','center'],['右边对齐','x','end'],['顶部对齐','y','start'],['垂直居中对齐','y','center'],['底部对齐','y','end'],['排成一行','x','spacing'],['排成一列','y','spacing']];
  for(const [name,axis,mode]of commands){
   await p.evaluate(nodes=>{board.nodes=clone(nodes);selected=new Set(nodes.map(n=>n.id));history=[];future=[];render()},arranging);
   await arrangePanel.getByLabel('间距',{exact:true}).fill('36');await arrangePanel.getByRole('button',{name,exact:true}).click();
   const changed=await p.evaluate(()=>clone(board.nodes)),size=axis==='x'?'w':'h',low=Math.min(...arranging.map(n=>n[axis])),high=Math.max(...arranging.map(n=>n[axis]+n[size]));
   for(const [i,node]of changed.entries()){
    const expected=mode==='start'?low:mode==='end'?high-node[size]:mode==='center'?(low+high-node[size])/2:i?arranging[0][axis]+arranging[0][size]+36:arranging[0][axis];
    assert.equal(node[axis],expected,name+' applies the named direction');assert.deepEqual({...node,[axis]:arranging[i][axis]},arranging[i],'Only the chosen position changes');
   }
   assert(await arrangePanel.evaluate(el=>el.open),'Applying a command keeps the same panel usable');await p.evaluate(()=>undo());assert.deepEqual(await p.evaluate(()=>board.nodes),arranging);
  }
  await arrangePanel.getByRole('button',{name:'返回白板',exact:true}).click();assert.equal(await arrangePanel.evaluate(el=>el.open),false);
  await p.evaluate(()=>askName('白板名称','保留这个名称',()=>{}));assert.equal(await p.locator('#nameInput').inputValue(),'保留这个名称');assert.equal(await p.locator('.arrange-options').count(),0,'The next ordinary dialog does not retain alignment layout');await p.keyboard.press('Escape');
  await p.setViewportSize({width:1400,height:900});
  console.log('编排面板：三主题、窄窗口整组按钮、短窗口退出、八个方向的真实操作、原文保留与撤销，通过');
  // Spacing moves groups one after another. Their original contents must not
  // get reassigned when an intermediate position temporarily overlaps a group.
  await p.evaluate(()=>{
   board.nodes=[
    {id:'first-group',type:'frame',title:'第一组',x:50,y:80,w:600,h:200},
    {id:'second-group',type:'frame',title:'第二组',x:655,y:80,w:900,h:200},
    {id:'third-group',type:'frame',title:'第三组',x:1560,y:80,w:300,h:800},
    {id:'first-content',type:'note',title:'第一条原文',body:'保留第一组的内容。',x:130,y:150,w:200,h:120},
    {id:'second-content',type:'note',title:'第二条原文',body:'保留第二组的内容。',x:735,y:150,w:200,h:120},
    {id:'third-content',type:'note',title:'第三条原文',body:'保留第三组的内容。',x:1570,y:150,w:200,h:120}
   ];board.edges=[{id:'group-link',from:'second-content',to:'third-content',label:'保留原来的联系'}];
   board.view={x:0,y:0,z:.5};selected=new Set(['first-group','second-group','third-group']);editorId=null;render();canvas.focus();
  });
  const groupedBefore=await p.evaluate(()=>clone(board));
  await p.locator('[data-id="first-group"] h3').click({button:'right'});
  await p.getByRole('menuitem',{name:'对齐与间距…',exact:true}).click();
  await p.locator('#arrangeGap').fill('32');await p.getByRole('button',{name:'排成一行',exact:true}).click();
  const groupedAfter=await p.evaluate(()=>clone(board));
  for(const [groupId,contentId] of [['first-group','first-content'],['second-group','second-content'],['third-group','third-content']]){
   const groupBefore=groupedBefore.nodes.find(n=>n.id===groupId),groupAfter=groupedAfter.nodes.find(n=>n.id===groupId);
   const contentBefore=groupedBefore.nodes.find(n=>n.id===contentId),contentAfter=groupedAfter.nodes.find(n=>n.id===contentId);
   assert.equal(contentAfter.x-contentBefore.x,groupAfter.x-groupBefore.x,'Spacing preserves contents of '+groupId+' through intermediate overlaps');
   assert.equal(contentAfter.y-contentBefore.y,groupAfter.y-groupBefore.y);
   assert.equal(contentAfter.body,contentBefore.body);
  }
  assert.deepEqual(groupedAfter.edges,groupedBefore.edges,'Arrangement preserves authored connections');
  await p.keyboard.press('Escape');await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board),groupedBefore,'One undo restores all group contents');
  await p.keyboard.press('Control+Shift+z');assert.deepEqual(await p.evaluate(()=>board),groupedAfter,'Redo keeps the complete group arrangement');
  await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);assert.deepEqual(await p.evaluate(()=>board.nodes),groupedAfter.nodes,'Saved group contents reopen in their arranged positions');
  for(const {axis,mode} of [{axis:'x',mode:'center'},{axis:'y',mode:'spacing'}]){
   await p.evaluate(({initial,axis})=>{
    board=clone(initial);if(axis==='y')for(const n of board.nodes){[n.x,n.y]=[n.y,n.x];[n.w,n.h]=[n.h,n.w]}
    selected=new Set(['first-group','second-group','third-group']);editorId=null;render();canvas.focus();
   },{initial:groupedBefore,axis});
   const before=await p.evaluate(()=>clone(board));
   await p.locator('[data-id="first-group"] h3').click({button:'right'});
   await p.getByRole('menuitem',{name:'对齐与间距…',exact:true}).click();
   await p.locator('#arrangeGap').fill('32');await p.locator('[data-align="'+axis+','+mode+'"]').click();
   const after=await p.evaluate(()=>clone(board));
   for(const [groupId,contentId] of [['first-group','first-content'],['second-group','second-content'],['third-group','third-content']]){
    const groupBefore=before.nodes.find(n=>n.id===groupId),groupAfter=after.nodes.find(n=>n.id===groupId);
    const contentBefore=before.nodes.find(n=>n.id===contentId),contentAfter=after.nodes.find(n=>n.id===contentId);
    assert.equal(contentAfter.x-contentBefore.x,groupAfter.x-groupBefore.x,axis+','+mode+' preserves horizontal position within '+groupId);
    assert.equal(contentAfter.y-contentBefore.y,groupAfter.y-groupBefore.y,axis+','+mode+' preserves vertical position within '+groupId);
    assert.deepEqual({...contentAfter,x:contentBefore.x,y:contentBefore.y},contentBefore,'Arrangement changes only the content position');
   }
   assert.deepEqual(after.edges,before.edges);
   await p.keyboard.press('Escape');await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board),before,'Undo restores '+axis+','+mode);
  }
  console.log('分组排列：中途重叠不漏掉原文，撤销、重做及保存重开，通过');
  // Repeated keydown events come from one held arrow. Hold the original
  // membership until release, even when crossing a smaller unrelated group.
  const keyboardGroup={nodes:[
   {id:'fixed-group',type:'frame',title:'另一组',x:390,y:80,w:110,h:300},
   {id:'moving-group',type:'frame',title:'移动这一组',x:500,y:80,w:600,h:400},
   {id:'moving-note',type:'note',title:'原文',body:'原文跟随这一组。',x:520,y:140,w:200,h:120},
   {id:'separate-note',type:'note',title:'单独一条',body:'这条没有随组移动。',x:80,y:650,w:250,h:120}
  ],edges:[{id:'keyboard-link',from:'moving-note',to:'separate-note',label:'保留这条联系'}]};
  for(const {key,axis,sign} of [{key:'ArrowLeft',axis:'x',sign:-1},{key:'ArrowRight',axis:'x',sign:1},{key:'ArrowUp',axis:'y',sign:-1},{key:'ArrowDown',axis:'y',sign:1}]){
   await p.evaluate(({fixture,axis,sign})=>{
    board.nodes=clone(fixture.nodes);board.edges=clone(fixture.edges);
    if(sign===1)for(const n of board.nodes)n.x=1300-n.x-(n.type==='frame'?n.w:0);
    if(axis==='y')for(const n of board.nodes){[n.x,n.y]=[n.y,n.x];[n.w,n.h]=[n.h,n.w]}
    board.view={x:0,y:0,z:.7};selected=new Set(['moving-group']);editorId=null;render();canvas.focus();
    whiteboardNavigation.write({...whiteboardNavigation.read(),nudge:25});
   },{fixture:keyboardGroup,axis,sign});
   const before=await p.evaluate(()=>clone(board)),historyBefore=await p.evaluate(()=>history.length);
   await p.keyboard.down(key);await p.keyboard.down(key);await p.keyboard.up(key);
   const after=await p.evaluate(()=>clone(board));
   assert.equal(await p.evaluate(()=>history.length),historyBefore+1,'One held arrow records one undo');
   for(const id of ['moving-group','moving-note']){
    const original=before.nodes.find(n=>n.id===id),moved=after.nodes.find(n=>n.id===id);
    assert.equal(moved[axis]-original[axis],sign*50,key+' keeps '+id+' moving on repeat');
    assert.deepEqual({...moved,[axis]:original[axis]},original,'Keyboard movement changes only the position');
   }
   for(const id of ['fixed-group','separate-note'])assert.deepEqual(after.nodes.find(n=>n.id===id),before.nodes.find(n=>n.id===id));
   assert.deepEqual(after.edges,before.edges);
   await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board),before,'One undo restores the complete '+key+' movement');
   await p.keyboard.press('Control+Shift+z');assert.deepEqual(await p.evaluate(()=>board),after,'Redo preserves the complete '+key+' movement');
  }
  const keyboardSaved=await p.evaluate(()=>clone(board));await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);
  assert.deepEqual(await p.evaluate(()=>board.nodes),keyboardSaved.nodes,'Saved keyboard movement reopens with its complete contents');
  assert.deepEqual(await p.evaluate(()=>board.edges),keyboardSaved.edges);
  await p.evaluate(fixture=>{
   board.nodes=clone(fixture.nodes);board.edges=clone(fixture.edges);board.view={x:0,y:0,z:1};selected=new Set(['moving-group']);editorId=null;render();canvas.focus();
   whiteboardNavigation.write({...whiteboardNavigation.read(),bigNudge:50});
  },keyboardGroup);
  const beforeLargerStep=await p.evaluate(()=>clone(board)),largerStepHistory=await p.evaluate(()=>history.length);
  await p.keyboard.down('ArrowLeft');await p.keyboard.down('Shift');await p.keyboard.down('ArrowLeft');await p.keyboard.up('ArrowLeft');await p.keyboard.up('Shift');
  const afterLargerStep=await p.evaluate(()=>clone(board));
  for(const id of ['moving-group','moving-note'])assert.equal(afterLargerStep.nodes.find(n=>n.id===id).x-beforeLargerStep.nodes.find(n=>n.id===id).x,-75,'Shift changes the step without losing the original contents');
  assert.equal(await p.evaluate(()=>history.length),largerStepHistory+1,'Changing the step still belongs to one held-arrow movement');
  await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board),beforeLargerStep,'One undo includes the larger step');
  await p.evaluate(fixture=>{
   board.nodes=clone(fixture.nodes);board.edges=clone(fixture.edges);board.view={x:0,y:0,z:1};selected=new Set(['moving-group']);editorId=null;render();canvas.focus();
  },keyboardGroup);
  await p.keyboard.down('ArrowLeft');const beforeSelectionChange=await p.evaluate(()=>clone(board));
  await p.locator('#nodes>[data-id="separate-note"]').click({position:{x:30,y:25}});assert.deepEqual(await p.evaluate(()=>[...selected]),['separate-note']);
  await p.keyboard.down('ArrowLeft');await p.keyboard.up('ArrowLeft');const afterSelectionChange=await p.evaluate(()=>clone(board));
  for(const id of ['fixed-group','moving-group','moving-note'])assert.deepEqual(afterSelectionChange.nodes.find(n=>n.id===id),beforeSelectionChange.nodes.find(n=>n.id===id),'Changing selection ends the previous movement');
  assert.equal(afterSelectionChange.nodes.find(n=>n.id==='separate-note').x,beforeSelectionChange.nodes.find(n=>n.id==='separate-note').x-25);
  await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board),beforeSelectionChange,'A changed selection starts its own undo');
  console.log('按住方向键：四方向跨过其他分组不掉队，Shift 加大步长，选择变化不带动旧内容，单步撤销/重做及保存重开，通过');
  // A saved marker is still editable while the source is waiting or missing.
  // Its time cannot be validated until metadata supplies a finite duration.
  for(const missing of [false,true]){
   const bytes=Buffer.from(wav);bytes[44]=missing?2:1;
   const source=await(await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':missing?'missing-markers.wav':'pending-markers.wav'},body:bytes})).json();
   let releaseMedia;const mediaGate=new Promise(r=>releaseMedia=r),pattern='**/api/media/'+source.id,inFlight=new Set();
   await p.route(pattern,async route=>{const operation=(async()=>{if(missing)return route.fulfill({status:404,contentType:'text/plain',body:'Unavailable'});await mediaGate;await route.continue()})();inFlight.add(operation);try{await operation}finally{inFlight.delete(operation)}});
   try{
    const mediaRequest=p.waitForRequest(r=>new URL(r.url()).pathname==='/api/media/'+source.id);
    await p.evaluate(async id=>{
     await loadAssets();board.nodes=[{id:'pending-sound',type:'note',title:'声音观察',body:'',assetId:id,mediaId:id,mediaTimeline:{['/api/media/'+id]:{markers:[{id:'kept-marker',time:2,title:'原标记',note:'保留原来的观察。'}],startMarkerId:null}},x:80,y:100,w:400,h:240,tags:[]}];
     board.edges=[];board.view={x:0,y:0,z:1};selected.clear();editorId=null;render();canvas.focus();
    },source.id);await mediaRequest;
    if(missing)await p.waitForFunction(()=>document.querySelector('audio')?.error);
    assert.equal(await p.locator('audio').evaluate(el=>Number.isFinite(el.duration)),false);
    await p.locator('.media-marker-toggle').click();const beforeInvalid=await p.evaluate(()=>history.length);
    await p.locator('.media-marker-time').fill('200');await p.locator('.media-marker-time').press('Tab');
    assert.equal(await p.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0].time),2,'Unknown duration preserves the original marker time');
    assert.equal(await p.evaluate(()=>history.length),beforeInvalid,'Rejected marker time adds no undo');
    assert.equal(await p.locator('.media-marker-time').inputValue(),'200','Keep the entered draft visible with its error');
    assert.equal(await p.locator('.media-marker-time').getAttribute('aria-invalid'),'true');assert(await p.locator('.media-marker-error').isVisible());
    assert((await p.locator('.media-marker-error').textContent()).includes('这次时间修改未保存'));
    await p.locator('.media-marker-title').fill('作者自己调整的名称');await p.locator('.media-marker-note').fill('等声音恢复后，再确认这一段。');
    await p.evaluate(()=>persist());releaseMedia();await Promise.all([...inFlight]);await p.unroute(pattern);
    // Reopening is also a real recovery route for an unavailable source.
    if(missing){await p.reload();await p.waitForFunction(()=>board&&!loading);await p.waitForFunction(()=>document.querySelector('audio')?.duration===8);await p.locator('.media-marker-toggle').click()}
    else await p.waitForFunction(()=>document.querySelector('audio')?.duration===8);
    const recovered=await p.evaluate(()=>clone(Object.values(board.nodes[0].mediaTimeline)[0].markers[0]));
    assert.deepEqual(recovered,{id:'kept-marker',time:2,title:'作者自己调整的名称',note:'等声音恢复后，再确认这一段。'},'Names and remarks remain editable while time is unavailable');
    const beforeRangeError=await p.evaluate(()=>history.length);
    await p.locator('.media-marker-time').fill('201');await p.locator('.media-marker-time').press('Tab');
    assert.equal(await p.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0].time),2);assert.equal(await p.evaluate(()=>history.length),beforeRangeError);
    assert((await p.locator('.media-marker-error').textContent()).includes('媒体时长以内'));
    await p.locator('.media-marker-time').fill('0:03.25');await p.locator('.media-marker-time').press('Tab');
    assert.equal(await p.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0].time),3.25);
    assert.equal(await p.locator('.media-marker-time').getAttribute('aria-invalid'),'false');assert(await p.locator('.media-marker-error').isHidden());
    assert.equal(await p.evaluate(()=>history.length),beforeRangeError+1,'Only the valid time change adds an undo');
    await p.locator('.media-marker-row').click();assert(Math.abs(await p.locator('audio').evaluate(el=>el.currentTime)-3.25)<.1,'Recovered marker jumps to its actual time');
    await p.keyboard.press('Escape');await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);
    assert.deepEqual(await p.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0]),{...recovered,time:3.25},'Only the confirmed valid marker time is saved and reopened');
   }finally{releaseMedia();await Promise.allSettled([...inFlight]);await p.unroute(pattern)}
  }
  console.log('时间标记：加载等待/文件暂不可用时不保存未核对的时间，名称备注可编辑，恢复后时长校验、小数秒跳转与保存重开，通过');
  await verifyPopoverBounds(p,audio.id);
  assert.deepEqual(errors,[]);console.log('时间标记、备注、重播起点与继续播放；表格副本独立；沉浸编辑；有范围的布局/图片/快照材料与下载；导航、对齐、操作偏好，通过');
 }catch(err){if(p&&process.env.CONTEXT_SCREENSHOT_DIR){fs.mkdirSync(process.env.CONTEXT_SCREENSHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.CONTEXT_SCREENSHOT_DIR,'failure.png')})}throw err}
 finally{if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});


async function verifyPopoverBounds(page,audioId){
 // The browser may acknowledge viewport dimensions before dispatching resize.
 // Let the actual resize handlers finish before opening a fresh playback panel.
 async function resizeViewport(size){
  const same=await page.evaluate(({width,height})=>innerWidth===width&&innerHeight===height,size);
  if(same){await page.setViewportSize(size);return}
  await page.evaluate(({width,height})=>{
   window.mediaResizeSettled=false;
   const resized=()=>{
    if(innerWidth!==width||innerHeight!==height)return;
    window.removeEventListener('resize',resized);
    requestAnimationFrame(()=>window.mediaResizeSettled=true);
   };
   window.addEventListener('resize',resized);
  },size);
  await page.setViewportSize(size);
  await page.waitForFunction(()=>window.mediaResizeSettled===true);
  await page.evaluate(()=>delete window.mediaResizeSettled);
 }
 await resizeViewport({width:1600,height:900});
 await page.evaluate(id=>{
  const sound={id:'bounded-sound',type:'note',title:'现场声音',body:'',assetId:id,mediaId:id,x:720,y:580,w:300,h:180,color:'#ffffff',tags:[]};
  const table={id:'bounded-table',type:'table',title:'声音对照',columns:['内容'],rows:[['']],columnWidths:[250],x:60,y:320,w:380,h:280,tags:[]};
  cellItemGrid(table);table.cellItems[0][0]=[{...clone(sound),id:'cell-bounded-sound',title:'格内声音'}];
  board.nodes=[sound,table];board.edges=[];board.view={x:0,y:0,z:1};editorId=null;selected.clear();render();change();
 },audioId);
 await page.waitForFunction(()=>document.querySelector('[data-id="bounded-sound"] audio')?.readyState>=1);
 const geometry=await page.evaluate(()=>board.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h]));
 async function bounded(){
  await page.waitForFunction(()=>{const r=document.querySelector('#mediaPopover')?.getBoundingClientRect();return r&&r.top>=11.5&&r.left>=11.5&&r.bottom<=innerHeight-11.5&&r.right<=innerWidth-11.5});
 }
 const sound=page.locator('[data-id="bounded-sound"]');
 await sound.locator('audio').evaluate(el=>el.currentTime=2.5);
 await sound.locator('.media-time').click();await page.waitForFunction(()=>document.querySelector('.media-add-marker'));await bounded();
 await page.locator('.media-add-marker').click();await bounded();
 assert(await page.locator('.media-marker-start').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight-12),'Replay controls remain on screen after the marker editor appears');
 await page.locator('.media-marker-title').fill('第一段声音');await page.locator('.media-marker-note').fill('保留自己的声音观察。');
 assert.equal(await page.locator('.media-marker-title').inputValue(),'第一段声音');
 const originalTime=await page.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0].time);
 await page.locator('.media-marker-time').fill('999');await page.locator('.media-marker-time').press('Tab');await bounded();
 assert(await page.locator('.media-marker-error').isVisible());
 assert.equal(await page.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0].time),originalTime,'Fitting a validation message never saves an invalid marker time');
 await page.locator('.media-marker-time').fill('2.5');await page.locator('.media-marker-time').press('Tab');await bounded();
 await page.locator('.media-marker-start').check();await bounded();
 const position=await page.locator('#mediaPopover').evaluate(el=>el.getBoundingClientRect().top);
 await page.locator('.media-marker-title').fill('第一段声音的记录');
 assert.equal(await page.locator('#mediaPopover').evaluate(el=>el.getBoundingClientRect().top),position,'Ordinary text edits do not move the panel');
 const shortTitleHeight=await page.locator('.media-marker-title').evaluate(el=>el.clientHeight);
 const longTitle='走廊另一端的脚步声，先保留这段现场录音，再比较远处背景声与近处动作的变化。';
 await page.locator('.media-marker-title').fill(longTitle);await bounded();
 const longTitleSize=await page.locator('.media-marker-title').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth}));
 assert(longTitleSize.height>shortTitleHeight+15,'A long marker name grows instead of hiding its ending in a single line');
 assert(longTitleSize.scroll<=longTitleSize.height+1&&longTitleSize.scrollWidth<=longTitleSize.width+1,'The complete ordinary long name is visible without horizontal scrolling');
 assert(await page.locator('.media-marker-row>span:nth-child(2)').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),'The list wraps the full marker name');
 await page.locator('.media-marker-title').fill('第一段声音的记录');await bounded();
 assert.equal(await page.locator('.media-marker-title').evaluate(el=>el.clientHeight),shortTitleHeight,'Shortening the name restores its compact field');
 // Long uninterrupted names and the maximum accepted title still wrap within
 // the panel. Longer editing stays bounded and can scroll vertically.
 await page.locator('.media-marker-title').fill('录音'.repeat(100));await bounded();
 assert.equal(await page.locator('.media-marker-title').inputValue(),'录音'.repeat(100));
 const maximumTitle=await page.locator('.media-marker-title').evaluate(el=>({height:el.getBoundingClientRect().height,scroll:el.scrollHeight,client:el.clientHeight,width:el.clientWidth,scrollWidth:el.scrollWidth}));
 assert(maximumTitle.height<=115&&maximumTitle.scroll>maximumTitle.client,'The maximum name remains editable in a bounded scrolling field');
 assert(maximumTitle.scrollWidth<=maximumTitle.width+1);
 await page.locator('.media-marker-title').fill(longTitle);await bounded();
 assert.equal(await page.evaluate(()=>Object.values(board.nodes[0].mediaTimeline)[0].markers[0].time),originalTime,'Resizing the name does not alter the time');
 assert.equal(await page.locator('.media-marker-note').inputValue(),'保留自己的声音观察。');
 await page.locator('#mediaPopover .media-play').click();await page.waitForFunction(()=>!document.querySelector('[data-id="bounded-sound"] audio').paused);
 await page.locator('.media-add-marker').click();await bounded();
 assert(await sound.locator('audio').evaluate(el=>!el.paused&&el.currentTime>=2.5),'Adding and fitting a marker keeps playback running at its current position');
 await page.keyboard.press('Escape');assert(await sound.locator('audio').evaluate(el=>!el.paused));
 assert(await sound.locator('.media-time').evaluate(el=>document.activeElement===el),'Closing returns focus to the originating playback control');
 await sound.locator('audio').evaluate(el=>el.pause());
 const ownMarkers=await page.evaluate(()=>JSON.stringify(board.nodes[0].mediaTimeline));
 await page.locator('[data-id="bounded-table"] .media-time').click();await page.locator('.media-add-marker').click();await bounded();
 await page.locator('.media-marker-title').fill('格内记录');await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>JSON.stringify(board.nodes[0].mediaTimeline)),ownMarkers,'The table player keeps independent marker ownership');
 await resizeViewport({width:460,height:430});
 await page.evaluate(()=>{$('workspaceSidebar').hidden=true;view().x=0;view().y=0;view().z=.5;moveView();whiteboardMedia.open(document.querySelector('[data-id="bounded-sound"] audio'))});
 await bounded();
 const scroll=await page.locator('#mediaPopover').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
 assert(scroll.scroll>scroll.height,'A short viewport provides internal scrolling rather than offscreen controls');
 await page.locator('.media-marker-start').uncheck();await bounded();
 assert(await page.locator('#mediaPopover').evaluate(el=>el.scrollTop)>0,'The replay setting is reachable by scrolling the bounded panel');
 assert.equal(await page.locator('.media-marker-note').inputValue(),'保留自己的声音观察。');
 assert.equal(await page.locator('.media-marker-title').inputValue(),longTitle);
 assert(await page.locator('.media-marker-title').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'The long name also fits the compact viewport');
 await page.keyboard.press('Escape');
 await resizeViewport({width:1600,height:900});
 await page.evaluate(()=>whiteboardReading.open('bounded-sound'));
 await page.locator('#immersiveSurface .media-time').click();await bounded();
 assert.equal(await page.locator('#dialog #mediaPopover').count(),1);
 assert.equal(await page.locator('.media-marker-title').inputValue(),longTitle,'Expanded editing retains the complete name');
 await page.locator('.media-marker-time').fill('999');await page.locator('.media-marker-time').press('Tab');await bounded();
 assert(await page.locator('.media-marker-error').isVisible());
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 assert.deepEqual(await page.evaluate(()=>board.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h])),geometry,'Popup fitting never resizes or moves the authored cards');
 assert.equal(await page.evaluate(async()=>{change();return persist()}),true);
 await page.reload();await page.waitForFunction(()=>board&&!loading);
 assert.equal(await page.evaluate(()=>Object.values(board.nodes.find(n=>n.id==='bounded-sound').mediaTimeline)[0].markers[0].note),'保留自己的声音观察。','Marker notes survive fitting and reopening');
 assert.equal(await page.evaluate(()=>Object.values(board.nodes.find(n=>n.id==='bounded-sound').mediaTimeline)[0].markers[0].title),longTitle,'The full marker name survives reopening without automatic rewriting');
 assert.deepEqual(await page.evaluate(()=>board.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h])),geometry);
 console.log('播放面板：底部新增标记、错误提示与重播设置保持可见，短窗口内滚动，普通编辑位置稳定，播放和格内副本独立，沉浸返回与重开通过');
}
