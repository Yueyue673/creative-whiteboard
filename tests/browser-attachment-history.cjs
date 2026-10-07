const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = process.env.CREATIVE_BOARD_TEST_ROOT || path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-attachment-history-'));
 const port=await require('./browser-port.cjs')();
 const base = 'http://127.0.0.1:' + port;
 const proc = spawn(process.env.PYTHON || 'python', [root + '/server.py'], {windowsHide:true,
  env:{...process.env, CREATIVE_BOARD_PORT:String(port), CREATIVE_BOARD_DATA_DIR:tmp, PYTHONIOENCODING:'utf-8'}});
 let browser;
 try {
  for (let attempt = 0; attempt < 100; attempt++) {
   try {if ((await fetch(base + '/api/health')).ok) break;} catch {}
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert((await fetch(base + '/api/boards/a', {method:'PUT', headers:{'Content-Type':'application/json', 'If-Match':'new'},
   body:JSON.stringify({format:'creative-board', version:1, name:'附件的原位置', folder:'', nodes:[
    {id:'note', type:'note', title:'自己的图片记录', body:'自己的原文。', x:40, y:50, w:310, h:170, tags:[]},
    {id:'table', type:'table', title:'自己的表格', body:'', x:430, y:60, w:620, h:360,
     columns:['画面', '声音'], rows:[['', ''], ['', '']], tags:[]}
   ], edges:[], view:{x:0, y:0, z:1}})})).ok);
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined, headless:true});
  const page = await browser.newPage({viewport:{width:1460, height:930}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/index.html?board=a');
  await page.waitForFunction(() => boardId === 'a' && !loading);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  async function heldAttachment(name, mime, bytes, target, action) {
   let release, reached;
   const gate = new Promise(resolve => release = resolve), arrived = new Promise(resolve => reached = resolve);
   await page.route('**/api/assets/upload', async route => {reached(); await gate; await route.continue();});
   await page.evaluate(({name, mime, bytes, target}) => {
    window.attachment = attachFiles([new File([new Uint8Array(bytes)], name, {type:mime})], target);
   }, {name, mime, bytes:[...bytes], target});
   await arrived;
   await page.evaluate(action);
   release(); await page.evaluate(() => attachment); await page.unroute('**/api/assets/upload');
   const imported=await page.evaluate(name=>({present:assetIndex.assets.some(a=>a.title===name),
     names:assetIndex.assets.map(a=>a.title),toast:document.getElementById('toast').textContent}),name);
   if(!imported.present){
    const response=await fetch(base+'/api/assets'),catalog=await response.json();
    assert.fail(JSON.stringify({name,imported,serverStatus:response.status,serverNames:catalog.assets.map(a=>a.title)}));
   }
  }
  // Undoing an unrelated edit replaces the document object, but not the chosen content.
  await heldAttachment('undo-note.png', 'image/png', png, {nodeId:'note'}, () => {
   addNote({x:800, y:400}, {title:'稍后的记录', body:'随后撤销的内容。'}); undo();
  });
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'note').images?.[0]?.name), 'undo-note.png',
   'An unrelated undo must not lose the original note attachment');
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'note').body), '自己的原文。');
  await verifyFreshCellDrag(browser, base);
  await page.evaluate(() => openEditor('table'));
  await heldAttachment('undo-cell.wav', 'audio/wav', wav, {nodeId:'table', r:0, c:0}, () => {
   addNote({x:800, y:400}, {title:'后来撤销的记录'}); undo();
  });
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'table').cellItems[0][0][0]?.title), 'undo-cell.wav');
  // Identical empty cells must stay distinct through reorder, undo and redo.
  const movingAxes = await page.evaluate(() => {const table = board.nodes.find(n => n.id === 'table'); return {row:table.rowIds[1], column:table.columnIds[1]};});
  await heldAttachment('moving-cell.wav', 'audio/wav', wav, {nodeId:'table', r:1, c:1}, () => {
   moveTable(board.nodes.find(n => n.id === 'table'), 'row', 1, 0);
   moveTable(board.nodes.find(n => n.id === 'table'), 'column', 1, 0);
   undo(); redo();
  });
  const movedCell = await page.evaluate(() => {const table = board.nodes.find(n => n.id === 'table'); return {
   row:table.rowIds[0], column:table.columnIds[0], title:table.cellItems[0][0][0]?.title,
   attachments:table.cellItems.map(row => row.map(items => items.map(item => item.title))),
   imported:assetIndex.assets.some(item => item.title === 'moving-cell.wav'), toast:document.getElementById('toast').textContent
  };});
  assert.equal(movedCell.title, 'moving-cell.wav', JSON.stringify({expectedAxes:movingAxes, actual:movedCell}));
  assert.equal(movedCell.row, movingAxes.row); assert.equal(movedCell.column, movingAxes.column);
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'table').cellItems[1][1][0]?.title), 'undo-cell.wav');
  // A newly added empty row at the same index is a different destination.
  await heldAttachment('removed-row.wav', 'audio/wav', wav, {nodeId:'table', r:1, c:0}, () => {
   openEditor('table');
   document.querySelector('[data-remove-row="1"]').click();
   [...document.querySelectorAll('#dialogActions button')].find(button => button.textContent === '删除').click();
   document.getElementById('tableAddRow').click();
  });
  assert(!await page.evaluate(() => board.nodes.find(n => n.id === 'table').cellItems.flat(2).some(n => n.title === 'removed-row.wav')));
  assert(await page.evaluate(() => assetIndex.assets.some(a => a.title === 'removed-row.wav')));
  assert((await page.locator('#toast').innerText()).includes('文件已保留在内容库'));
  // Undoing a real deletion restores the original cell before upload finishes.
  await heldAttachment('restored-row.wav', 'audio/wav', wav, {nodeId:'table', r:1, c:0}, () => {
   openEditor('table');
   document.querySelector('[data-remove-row="1"]').click();
   [...document.querySelectorAll('#dialogActions button')].find(button => button.textContent === '删除').click();
   undo();
  });
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'table').cellItems[1][0][0]?.title), 'restored-row.wav');
  await heldAttachment('removed-column.wav', 'audio/wav', wav, {nodeId:'table', r:0, c:1}, () => {
   openEditor('table');
   document.querySelector('[data-remove-col="1"]').click();
   [...document.querySelectorAll('#dialogActions button')].find(button => button.textContent === '删除').click();
   document.getElementById('tableAddColumn').click();
  });
  assert(!await page.evaluate(() => board.nodes.find(n => n.id === 'table').cellItems.flat(2).some(n => n.title === 'removed-column.wav')));
  assert(await page.evaluate(() => assetIndex.assets.some(a => a.title === 'removed-column.wav')));
  // Promoting a row to headings removes that row's cell identities.
  await page.evaluate(() => addNote({x:500, y:500}, {id:'headers', type:'table', title:'列名的表格', body:'',
   columns:['第一列', '第二列'], rows:[['画面', '声音'], ['', '']], w:620, h:320}));
  await heldAttachment('header-row.wav', 'audio/wav', wav, {nodeId:'headers', r:0, c:1}, () => {
   openEditor('headers'); document.getElementById('tableFirstHeader').click(); document.getElementById('tableAddRow').click();
  });
  assert(!await page.evaluate(() => board.nodes.find(n => n.id === 'headers').cellItems.flat(2).some(n => n.title === 'header-row.wav')));
  assert.deepEqual(await page.evaluate(() => board.nodes.find(n => n.id === 'headers').columns), ['画面', '声音']);
  // Column geometry travels with the column instead of being left behind.
  await page.evaluate(() => {
   const table = board.nodes.find(n => n.id === 'table');
   undoPoint(); table.columnWidths = [170, 290]; change();
   moveTable(table, 'column', 0, 1);
  });
  assert.deepEqual(await page.evaluate(() => board.nodes.find(n => n.id === 'table').columnWidths), [290, 170]);
  await page.evaluate(() => {openEditor('table'); document.getElementById('tableAddColumn').click();});
  assert.deepEqual(await page.evaluate(() => board.nodes.find(n => n.id === 'table').columnWidths), [290, 170, 160]);
  const axes = await page.evaluate(() => board.nodes.filter(n => n.type === 'table').map(n => ({id:n.id, rows:n.rowIds, columns:n.columnIds})));
  assert(await page.evaluate(() => persist()));
  await page.reload(); await page.waitForFunction(() => boardId === 'a' && !loading);
  assert.deepEqual(await page.evaluate(() => board.nodes.filter(n => n.type === 'table').map(n => ({id:n.id, rows:n.rowIds, columns:n.columnIds}))), axes,
   'Saved row and column identities are stable across reopening');
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'note').body), '自己的原文。');
  assert.deepEqual(errors, []);
  console.log('Attachment history: undo/redo, identical cells, reordered/restored/deleted rows and columns, header promotion, column widths and reopening passed');
 } finally {
  if (browser) await browser.close();
  proc.kill(); await new Promise(resolve => proc.once('exit', resolve));
  const resolved = path.resolve(tmp);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, {recursive:true, force:true});
 }
})().catch(error => {console.error(error); process.exitCode = 1;});

async function verifyFreshCellDrag(browser,base){
 const table={id:'fresh-cell',type:'table',title:'资料对照',body:'原来的说明。',columns:['资料','备注'],rows:[['同样的原文。',''],['同样的原文。','']],rowIds:['original-row','other-row'],columnIds:['original-column','other-column'],x:30,y:40,w:570,h:470,tags:[],color:'#fff0aa'};
 assert((await fetch(base+'/api/boards/cell-import',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify({format:'creative-board',version:1,name:'文件放入单元格',nodes:[table],edges:[],view:{x:0,y:70,z:1}})})).ok);
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
 await page.goto(base+'/?board=cell-import');await page.waitForFunction(()=>pane(current())?.state().boardId==='cell-import'&&!pane(current()).state().loading);const target=page.frames().find(f=>f.parentFrame()&&new URL(f.url()).searchParams.get('board')==='cell-import');
 await page.locator('#openBoards').click();await page.waitForFunction(()=>whiteboardWorkspace.explorer());const library=page.frames().find(f=>new URL(f.url()).searchParams.get('explorer')==='1');await library.evaluate(()=>showWorkspaceTab('assetPane'));
 await target.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await target.evaluate(()=>{board.view={x:400,y:70,z:1};canvas.scrollLeft=canvas.scrollTop=0;moveView()});await target.locator('#nodes > [data-id=fresh-cell]').dblclick({position:{x:100,y:25}});
 const upload=async name=>{const chooserReady=page.waitForEvent('filechooser');await library.locator('#assetUpload').click();await(await chooserReady).setFiles({name,mimeType:'text/plain',buffer:Buffer.from('原始记录。\n保留作者的观察。')});await library.waitForFunction(name=>assetIndex.assets.some(a=>a.title===name),name);return library.evaluate(name=>clone(assetIndex.assets.find(a=>a.title===name)),name)};
 const drag=async(asset,r=0,c=0,select=true)=>{
  const row=library.locator('[data-asset="'+asset.id+'"]');if(select)await row.click();const td=target.locator('.live-layout [data-cell="'+r+','+c+'"]');await td.scrollIntoViewIfNeeded();
  const a=await row.boundingBox(),cell=await td.boundingBox(),scroll=await target.locator('.live-layout .table-scroll').boundingBox(),top=Math.max(cell.y,scroll.y),bottom=Math.min(cell.y+cell.height,scroll.y+scroll.height);assert(bottom-top>8,'The native drop point is inside the visible part of the cell');
  await page.mouse.move(a.x+a.width*.55,a.y+a.height*.35);await page.mouse.down();await page.mouse.move(a.x+a.width*.55+12,a.y+a.height*.35+4,{steps:4});await page.mouse.move(cell.x+cell.width*.65,top+(bottom-top)*.55,{steps:12});await page.mouse.up();
 };
 const snapshot=()=>target.evaluate(()=>clone(board.nodes.find(n=>n.id==='fresh-cell'))),undo=async()=>{await target.locator('#canvas').click({position:{x:20,y:650}});await page.keyboard.press('Control+z');await target.locator('#nodes > [data-id=fresh-cell]').dblclick({position:{x:100,y:25}})};
 const first=await upload('新导入的单元格原文.txt');assert(!await target.evaluate(id=>assetById(id),first.id));await drag(first);await target.waitForFunction(id=>board.nodes.find(n=>n.id==='fresh-cell').cellItems?.[0]?.[0]?.[0]?.assetId===id,first.id);const inserted=await snapshot();assert.deepEqual(inserted.rows,table.rows);
 await undo();assert(!(await snapshot()).cellItems?.[0]?.[0]?.length);await target.locator('#canvas').click({position:{x:20,y:650}});await page.keyboard.press('Control+Shift+z');await target.waitForFunction(id=>board.nodes.find(n=>n.id==='fresh-cell').cellItems?.[0]?.[0]?.[0]?.assetId===id,first.id);assert.deepEqual(await snapshot(),inserted);await target.locator('#nodes > [data-id=fresh-cell]').dblclick({position:{x:100,y:25}});
 const next=await upload('稍后重试的单元格原文.txt'),before=await snapshot();const fail=route=>route.request().method()==='GET'&&route.request().frame()===target?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'目录暂时不可读'})}):route.continue();
 await page.route('**/api/assets',fail);await drag(next);await target.waitForFunction(()=>document.getElementById('toast').textContent.includes('目录暂时不可读'));assert.deepEqual(await snapshot(),before);assert.deepEqual(await library.evaluate(()=>[...assetSelected]),[next.id]);await page.unroute('**/api/assets',fail);await drag(next);await target.waitForFunction(id=>board.nodes.find(n=>n.id==='fresh-cell').cellItems[0][0].some(n=>n.assetId===id),next.id);await undo();assert.deepEqual(await snapshot(),before);
 // Reading a newer shared catalog keeps the originally chosen row/column identities.
 const moving=await upload('行列移动期间的新文件.txt');let release,arrive;const gate=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);const hold=async route=>{if(route.request().method()==='GET'&&route.request().frame()===target){arrive();await gate}await route.continue()};await page.route('**/api/assets',hold);await drag(moving);await arrived;assert(await target.evaluate(()=>whiteboardImports.pendingCanvas()));
 await target.evaluate(()=>{const n=board.nodes.find(n=>n.id==='fresh-cell');moveTable(n,'row',0,1);moveTable(n,'column',0,1);window.cellFlushFinished=false;window.cellFlush=whiteboardPane.flush().then(result=>{cellFlushFinished=true;return result})});assert(!await target.evaluate(()=>cellFlushFinished));release();await target.evaluate(()=>cellFlush);await page.unroute('**/api/assets',hold);await target.waitForFunction(id=>board.nodes.find(n=>n.id==='fresh-cell').cellItems[1][1].some(n=>n.assetId===id),moving.id);assert.deepEqual((await snapshot()).rowIds,['other-row','original-row']);assert.deepEqual((await snapshot()).columnIds,['other-column','original-column']);
 const removed=await upload('目标删除期间的新文件.txt');let finishDelete,reachedDelete;const deleteGate=new Promise(r=>finishDelete=r),deleteReached=new Promise(r=>reachedDelete=r);const holdDelete=async route=>{if(route.request().method()==='GET'&&route.request().frame()===target){reachedDelete();await deleteGate}await route.continue()};await page.route('**/api/assets',holdDelete);await drag(removed,0,0);await deleteReached;await target.locator('.live-layout [data-remove-row="0"]').click();await target.getByRole('button',{name:'删除',exact:true}).click();await target.locator('#tableAddRow').click();finishDelete();await target.waitForFunction(()=>document.getElementById('toast').textContent.includes('原来的内容或单元格已改变'));await page.unroute('**/api/assets',holdDelete);assert(!(await snapshot()).cellItems.flat(2).some(n=>n.assetId===removed.id));assert.deepEqual(await library.evaluate(()=>[...assetSelected]),[removed.id]);
 await drag(removed,1,0);await target.waitForFunction(id=>board.nodes.find(n=>n.id==='fresh-cell').cellItems[1][0].some(n=>n.assetId===id),removed.id);
 const absent=await upload('另一个窗口移除的单元格文件.txt'),catalogResponse=await fetch(base+'/api/assets'),catalog=await catalogResponse.json();assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':catalogResponse.headers.get('ETag')},body:JSON.stringify({...catalog,assets:catalog.assets.filter(a=>a.id!==absent.id)})})).ok);
 const beforeBatch=await snapshot();await library.locator('[data-asset="'+first.id+'"]').click();await library.locator('[data-asset="'+absent.id+'"]').click({modifiers:['Control']});await drag(absent,1,0,false);await target.waitForFunction(()=>document.getElementById('toast').textContent.includes('有内容已移除，整批尚未放入'));assert.deepEqual(await snapshot(),beforeBatch);assert.deepEqual(await library.evaluate(()=>[...assetSelected]),[first.id,absent.id]);
 const restored=await fetch(base+'/api/assets');assert((await fetch(base+'/api/assets',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':restored.headers.get('ETag')},body:JSON.stringify(catalog)})).ok);await drag(absent,1,0,false);await target.waitForFunction(ids=>ids.every(id=>board.nodes.find(n=>n.id==='fresh-cell').cellItems[1][0].some(n=>n.assetId===id)),[first.id,absent.id]);await undo();assert.deepEqual(await snapshot(),beforeBatch);
 await target.evaluate(()=>persist());await page.reload();await page.waitForFunction(()=>pane(current())?.state().boardId==='cell-import'&&!pane(current()).state().loading);const reopened=page.frames().find(f=>f.parentFrame()&&new URL(f.url()).searchParams.get('board')==='cell-import');assert.deepEqual(await reopened.evaluate(()=>board.nodes.find(n=>n.id==='fresh-cell')),beforeBatch);
 for(const a of [first,next,moving,removed,absent])assert.equal(await(await fetch(base+'/api/media/'+a.id)).text(),'原始记录。\n保留作者的观察。');assert.deepEqual(errors,[]);await page.close();
 console.log('新文件真实拖入单元格：失败保留并重试、行列移动与删除、保存等待、完整批次、撤销重做及原文重开，通过');
}
