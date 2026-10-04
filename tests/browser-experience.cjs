const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process');
const assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-experience-'));
 const port = await new Promise(resolve => {
  const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});
 });
 const base='http://127.0.0.1:'+port;
 const proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{
  env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'},windowsHide:true
 });
 let browser;
 try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
  const ctx=await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write']});
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/index.html');await p.waitForFunction(()=>board&&!loading&&window.whiteboardExperience);
  const sourceId=await p.evaluate(async()=>{
   board.name='观察与分镜';board.view={x:0,y:0,z:1};board.nodes=[
    {id:'note',type:'note',title:'观察侧光',body:'折痕会随角度改变。',userText:'先保留这个观察。',annotation:'补拍两个角度',tags:[],color:'#fff0aa',x:40,y:80,w:320,h:250},
    {id:'table',type:'table',title:'镜头记录',columns:['画面','声音'],rows:[['',''],['','']],tags:[],color:'#fff',x:430,y:80,w:650,h:390}
   ];board.edges=[];selected=new Set(['note']);editorId=null;render();change();await persist();return boardId;
  });
  // Real native drag, not only a dispatched synthetic payload: read cells accept content directly.
  await p.locator('[data-id=note] .block-transfer').dragTo(p.locator('[data-id=table] [data-cell="0,0"]'),{targetPosition:{x:80,y:25}});
  await p.waitForFunction(()=>board.nodes.find(n=>n.id==='table').cellItems?.[0]?.[0]?.length===1);
  assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='note').body),'折痕会随角度改变。');
  await p.locator('[data-cell="0,0"] [data-cell-note-field=body]').fill('单元格的内容可以独立修改。');
  assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='note').body),'折痕会随角度改变。');
  await p.locator('#inlineDone').click();
  const tableHeight=await p.evaluate(()=>board.nodes.find(n=>n.id==='table').h);
  await p.evaluate(()=>{openEditor('table');addTableFromMatrix([],false)});
  assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='table').h),tableHeight,'Failed import never resizes an existing table');
  await p.locator('#inlineDone').click();
  console.log('直接拖入：选中便签的手柄 → 未编辑的表格 → 独立修改，通过');

  // Store the same content in a folder, then reuse it with source metadata intact.
  await p.evaluate(async()=>{
   await loadAssets();const next=clone(assetIndex);next.folders=['复用'];await saveAssets(next);
   await showWorkspaceTab('assetPane');enterAssetFolder('');selected=new Set(['note']);render();
  });
  await p.locator('[data-id=note] .block-transfer').dragTo(p.locator('[data-asub="复用"]'));
  await p.waitForFunction(()=>assetIndex.assets.some(a=>a.mime===bundleMime));
  const stored=await p.evaluate(()=>clone(assetIndex.assets.find(a=>a.mime===bundleMime)));
  assert.equal(stored.source.boardId,sourceId);assert.deepEqual(stored.source.nodeIds,['note']);
  assert.equal(stored.bundle.nodes[0].annotation,'补拍两个角度');
  const reusedId=await p.evaluate(async id=>(await placeAssets([id],{x:1140,y:80}))[0],stored.id);
  assert.equal(await p.evaluate(id=>board.nodes.find(n=>n.id===id).body,reusedId),'折痕会随角度改变。');
  assert.equal(await p.evaluate(id=>board.nodes.find(n=>n.id===id).libraryOrigin.id,reusedId),stored.id);

  // A local original is referenced, never copied into owned upload storage.
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  const sound=path.join(tmp,'original.wav');fs.writeFileSync(sound,wav);
  const filesBefore=fs.existsSync(path.join(tmp,'素材文件'))?fs.readdirSync(path.join(tmp,'素材文件')):[];
  await p.locator('#import').click();await p.getByRole('menuitem',{name:'引用本地文件…',exact:true}).click();
  await p.locator('#referencePaths').fill('"'+sound+'"');await p.getByRole('button',{name:'添加',exact:true}).click();
  await p.waitForFunction(()=>board.nodes.some(n=>n.mediaId));
  const media=await p.evaluate(()=>clone(board.nodes.find(n=>n.mediaId)));
  assert(media.h<200,'Audio card has a compact default height: '+media.h);
  assert(await p.locator('[data-id="'+media.id+'"] [data-file-link]').isHidden(),'Audio has no repeated file button');
  assert.deepEqual(fs.existsSync(path.join(tmp,'素材文件'))?fs.readdirSync(path.join(tmp,'素材文件')):[],filesBefore);
  await p.evaluate(id=>{const n=board.nodes.find(n=>n.id===id);n.x=40;n.y=400;selected=new Set([id]);editorId=null;render()},media.id);
  await p.locator('[data-id="'+media.id+'"] .block-transfer').dragTo(p.locator('[data-id=table] [data-cell="0,1"]'),{targetPosition:{x:75,y:25}});
  await p.waitForFunction(()=>!!document.querySelector('[data-cell="0,1"] audio'));
  assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='table').cellItems[0][1][0].assetId),media.assetId);
  await p.locator('#inlineDone').click();
  await p.evaluate(id=>{selected=new Set([id]);canvas.focus();refreshSelectionUI()},media.id);
  await p.keyboard.press('F2');await p.locator('#body').fill('这个声音来自现场记录。');await p.locator('#inlineDone').click();
  assert(await p.locator('[data-id="'+media.id+'"] [data-preview-id=body]').isVisible());
  await p.evaluate(id=>{selected=new Set([id]);canvas.focus();refreshSelectionUI()},media.id);
  await p.keyboard.press('Enter');assert(await p.locator('#dialog audio').isVisible());await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>document.activeElement===canvas),true);
  await p.locator('[data-id="'+media.id+'"] [aria-label=内容操作]').click();
  await p.getByRole('menuitem',{name:'重新定位原文件…',exact:true}).click();
  await p.locator('#referencePaths').fill(path.join(tmp,'missing.wav'));
  await p.getByRole('button',{name:'更新位置',exact:true}).click();
  await p.waitForFunction(()=>document.getElementById('referenceError').textContent.includes('找不到文件'));
  const relocated=path.join(tmp,'relocated.wav');fs.writeFileSync(relocated,wav);
  await p.locator('#referencePaths').fill(relocated);await p.getByRole('button',{name:'更新位置',exact:true}).click();
  await p.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.equal(await p.evaluate(id=>assetById(id).path,media.assetId),relocated);
  assert.equal(await p.evaluate(id=>board.nodes.find(n=>n.id===id).body,media.id),'这个声音来自现场记录。');
  assert.equal(await p.evaluate(id=>board.nodes.find(n=>n.id==='table').cellItems[0][1][0].assetId,media.assetId),media.assetId);
  console.log('资料复用：入库与来源、音频紧凑尺寸、拖进表格、直接写说明、原文件重新定位，通过');

  // Copy one scoped task, paste the reply directly and inspect before applying anything.
  await p.evaluate(()=>{selected=new Set(['note']);canvas.focus();refreshSelectionUI()});
  await p.locator('#aiWorkspace').click();await p.locator('#aiTaskText').fill('只为这个观察补充标签。');
  await p.locator('#aiCopyTask').click();await p.waitForFunction(()=>document.getElementById('aiReplyStatus').textContent.includes('任务已复制'));
  const pack=JSON.parse(await p.evaluate(()=>navigator.clipboard.readText()));
  assert.deepEqual(pack.data.nodes.map(n=>n.id),['note']);assert(pack.request.keepWords&&pack.request.keepNotes);
  const proposal={format:'creative-board-proposal',version:1,requestId:pack.requestId,resource:pack.resource,targetId:pack.targetId,baseETag:pack.baseETag,title:'给观察补标签',changes:[{entity:'node',op:'update',targetId:'note',reason:'便于再次找到',before:{tags:[]},after:{tags:['侧光']}}]};
  const reply='整理完成，提案如下。\n```json\n'+JSON.stringify(proposal)+'\n```\n请先检查。';
  await p.locator('#aiReplyText').fill(reply);await p.locator('#aiReviewReply').click();
  await p.waitForFunction(()=>!!document.querySelector('[data-wf-change]'));
  assert.equal(await p.locator('[data-wf-change]:checked').count(),0);
  assert.deepEqual(await p.evaluate(()=>board.nodes.find(n=>n.id==='note').tags),[]);
  await p.keyboard.press('Escape');
  const count=await p.evaluate(()=>board.nodes.length);
  await p.evaluate(text=>navigator.clipboard.writeText(text),reply);await p.locator('#canvas').click({position:{x:15,y:25}});await p.keyboard.press('Control+v');
  await p.waitForFunction(()=>!!document.querySelector('[data-wf-change]'));
  assert.equal(await p.evaluate(()=>board.nodes.length),count,'A pasted proposal is not turned into a note');
  await p.locator('[data-wf-change]').check();await p.getByRole('button',{name:'应用勾选项',exact:true}).click();
  await p.waitForFunction(()=>!document.getElementById('dialog').open);
  assert.deepEqual(await p.evaluate(()=>board.nodes.find(n=>n.id==='note').tags),['侧光']);
  assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='note').body),'折痕会随角度改变。');
  await p.evaluate(()=>{selected=new Set(['note']);refreshSelectionUI()});
  await p.locator('#aiWorkspace').click();assert.equal(await p.locator('#aiTaskText').inputValue(),'只为这个观察补充标签。');
  if(process.env.EXPERIENCE_SCREENSHOT_DIR){fs.mkdirSync(process.env.EXPERIENCE_SCREENSHOT_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.EXPERIENCE_SCREENSHOT_DIR,'ai-review-entry.png')})}
  await p.keyboard.press('Escape');
  console.log('AI：复制所选任务、带代码框回复、直接粘贴审核、原文保留和草稿恢复，通过');

  await p.evaluate(async id=>{const n=board.nodes.find(n=>n.id===id);n.h=230;editorId=null;render();change();await persist()},media.id);
  await p.reload();await p.waitForFunction(()=>board&&!loading);
  assert.equal(await p.evaluate(id=>board.nodes.find(n=>n.id===id).h,media.id),230);
  assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='table').cellItems[0][0][0].body),'单元格的内容可以独立修改。');
  assert.equal(await p.locator('[data-id=table] .read-layout audio').count(),1);

  // Real content drag between two visible iframe panes.
  const targetId=await p.evaluate(async()=>{await newBoard('继续编排');await persist();return boardId});
  await p.goto(base+'/?board='+sourceId);await p.waitForFunction(()=>pane(current())?.state().boardId);
  await p.locator('#splitToggle').click();
  await p.locator('.add-tab[data-side=right]').click();await p.locator('#boardChoices').getByRole('button',{name:/继续编排/}).click();
  await p.waitForFunction(()=>['left','right'].every(side=>pane(current(side))?.state().boardId));
  const left=p.frames().find(f=>new URL(f.url()).pathname==='/index.html'&&new URL(f.url()).searchParams.get('board')===sourceId);
  const right=p.frames().find(f=>new URL(f.url()).pathname==='/index.html'&&new URL(f.url()).searchParams.get('board')===targetId);
  await left.evaluate(()=>{board.view={x:20,y:20,z:.75};selected=new Set(['note']);moveView();refreshSelectionUI()});
  // Locator.dragTo resolves its target in the source frame; use global mouse coordinates across frames.
  const handle=await left.locator('[data-id=note] .block-transfer').boundingBox();
  const targetCanvas=await right.locator('#canvas').boundingBox();
  await p.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await p.mouse.down();
  await p.mouse.move(handle.x+handle.width/2+8,handle.y+handle.height/2+8,{steps:3});
  await p.mouse.move(targetCanvas.x+160,targetCanvas.y+170,{steps:12});
  await p.mouse.move(targetCanvas.x+161,targetCanvas.y+171);await p.mouse.up();
  await right.waitForFunction(()=>board.nodes.length===1);
  assert.equal(await right.evaluate(()=>board.nodes[0].body),'折痕会随角度改变。');
  assert.equal(await left.evaluate(()=>board.nodes.filter(n=>n.id==='note').length),1);
  await right.evaluate(()=>persist());
  if(process.env.EXPERIENCE_SCREENSHOT_DIR)await p.screenshot({path:path.join(process.env.EXPERIENCE_SCREENSHOT_DIR,'split-reuse.png')});
  assert.deepEqual(errors,[]);
  console.log('完整过程：保存后尺寸与附件保留、两栏之间原生拖放并独立保存，通过');
 } finally {
  if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));
  const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
