const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-import-continuity-'));
 const port = await new Promise(resolve => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => {const value = socket.address().port; socket.close(() => resolve(value));});
 });
 const base = 'http://127.0.0.1:' + port;
 const proc = spawn(process.env.PYTHON || 'python', [root + '/server.py'], {windowsHide:true,
  env:{...process.env, CREATIVE_BOARD_PORT:String(port), CREATIVE_BOARD_DATA_DIR:tmp, PYTHONIOENCODING:'utf-8'}});
 let browser;
 try {
  for (let attempt = 0; attempt < 100; attempt++) {
   try {if ((await fetch(base + '/api/health')).ok) break;} catch {}
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const id of ['a', 'b']) {
   assert((await fetch(base + '/api/boards/' + id, {method:'PUT', headers:{'Content-Type':'application/json', 'If-Match':'new'},
    body:JSON.stringify({format:'creative-board', version:1, name:'白板 ' + id, folder:'',
     nodes:[{id:'note', type:'note', title:'自己的记录', body:'属于 ' + id + ' 的原文。', x:50, y:60, w:310, h:170, tags:[]}],
     edges:[], view:{x:0, y:0, z:1}})})).ok);
  }
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined, headless:true});
  const context = await browser.newContext({viewport:{width:1460, height:930}});
  const page = await context.newPage(), errors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/index.html?board=a');
  await page.waitForFunction(() => boardId === 'a' && !loading);
  await page.evaluate(() => {
   const file = new File(['等待读取的原文。'], '稍后的观察.txt', {type:'text/plain'});
   const gate = new Promise(resolve => window.finishTextRead = resolve);
   file.text = () => gate;
   window.textImport = importFiles([file], {x:200, y:180});
   window.nextBoard = switchBoard('b');
  });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => boardId), 'a', 'A single-document switch waits for the original import');
  await page.evaluate(() => finishTextRead('等待读取的原文。'));
  await page.evaluate(() => Promise.all([textImport, nextBoard]));
  assert.equal(await page.evaluate(() => boardId), 'b');
  const a = await fetch(base + '/api/boards/a').then(r => r.json());
  const b = await fetch(base + '/api/boards/b').then(r => r.json());
  assert(a.nodes.some(n => n.body === '等待读取的原文。'));
  assert(!b.nodes.some(n => n.body === '等待读取的原文。'));
  // Switching tabs remains immediate; closing the original tab waits for upload and save.
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  const windowPage = await context.newPage();
  await windowPage.goto(base + '/?board=a');
  await windowPage.waitForFunction(() => pane(current())?.state().boardId === 'a' && !pane(current()).state().loading);
  const original = windowPage.frames().find(frame => frame.parentFrame() && new URL(frame.url()).searchParams.get('board') === 'a');
  let releaseUpload;
  const uploadGate = new Promise(resolve => releaseUpload = resolve);
  await windowPage.route('**/api/assets/upload', async route => {await uploadGate; await route.continue();});
  await original.locator('#files').setInputFiles({name:'稍后的声音.wav', mimeType:'audio/wav', buffer:wav});
  await original.waitForFunction(() => whiteboardImports.pendingCanvas());
  await windowPage.evaluate(() => openBoard('b'));
  await windowPage.waitForFunction(() => pane(current())?.state().boardId === 'b' && !pane(current()).state().loading);
  await windowPage.evaluate(() => {
   const id = model.tabs.find(tab => tab.boardId === 'a').id;
   window.firstClose = closeTab(id); window.secondClose = closeTab(id);
  });
  await windowPage.waitForTimeout(150);
  assert(await windowPage.evaluate(() => model.tabs.some(tab => tab.boardId === 'a')));
  releaseUpload(); await windowPage.evaluate(() => Promise.all([firstClose, secondClose]));
  await windowPage.unroute('**/api/assets/upload');
  assert.equal(await windowPage.evaluate(() => model.tabs.length), 1, 'Repeated close never removes the neighbouring tab');
  assert.equal(await windowPage.evaluate(() => current().boardId), 'b');
  assert((await fetch(base + '/api/boards/a').then(r => r.json())).nodes.some(node => node.title === '稍后的声音.wav'));
  assert(!(await fetch(base + '/api/boards/b').then(r => r.json())).nodes.some(node => node.title === '稍后的声音.wav'));
  // The cell chosen before upload follows row and column moves.
  await page.evaluate(() => switchBoard('a'));
  await page.evaluate(() => {
   addNote({x:500, y:100}, {id:'table', type:'table', title:'自己的表格', body:'',
    columns:['画面', '声音'], rows:[['第一行', ''], ['第二行', '']], w:620, h:360});
   window.tableId = board.nodes.find(node => node.type === 'table').id;
  });
  let releaseCell;
  const cellGate = new Promise(resolve => releaseCell = resolve);
  await page.route('**/api/assets/upload', async route => {await cellGate; await route.continue();});
  await page.evaluate(bytes => {
   const file = new File([new Uint8Array(bytes)], '单元格的声音.wav', {type:'audio/wav'});
   window.cellImport = attachFiles([file], {nodeId:tableId, r:0, c:0});
   const table = board.nodes.find(node => node.id === tableId);
   moveTable(table, 'row', 0, 1); moveTable(table, 'column', 0, 1);
  }, [...wav]);
  releaseCell(); await page.evaluate(() => cellImport); await page.unroute('**/api/assets/upload');
  assert.equal(await page.evaluate(() => board.nodes.find(node => node.id === tableId).cellItems[1][1][0].title), '单元格的声音.wav');
  assert.equal(await page.evaluate(() => board.nodes.find(node => node.id === tableId).cellItems[0][0].length), 0);
  // Removing the destination preserves the uploaded file in the library without attaching it elsewhere.
  let releaseRemoved;
  const removedGate = new Promise(resolve => releaseRemoved = resolve);
  await page.route('**/api/assets/upload', async route => {await removedGate; await route.continue();});
  await page.evaluate(bytes => {
   const file = new File([new Uint8Array(bytes)], '目标移除后的声音.wav', {type:'audio/wav'});
   window.removedImport = attachFiles([file], {nodeId:tableId, r:0, c:0});
   selected = new Set([tableId]); removeSelected();
  }, [...wav]);
  releaseRemoved(); await page.evaluate(() => removedImport); await page.unroute('**/api/assets/upload');
  assert(await page.evaluate(() => assetIndex.assets.some(asset => asset.title === '目标移除后的声音.wav')));
  assert(!await page.evaluate(() => board.nodes.some(node => node.title === '目标移除后的声音.wav')));
  assert((await page.locator('#toast').innerText()).includes('文件已保留在内容库'));
  // Decoding an image in the shared library cannot change its originally chosen board.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  const uploaded = await fetch(base + '/api/assets/upload', {method:'POST',
   headers:{'Content-Type':'application/octet-stream', 'X-File-Name':'delayed-image.png'}, body:png}).then(r => r.json());
  await windowPage.evaluate(() => openBoard('a'));
  await windowPage.waitForFunction(() => pane(current())?.state().boardId === 'a' && !pane(current()).state().loading);
  await windowPage.locator('#openBoards').click();
  await windowPage.waitForFunction(() => whiteboardWorkspace.explorer());
  const library = windowPage.frames().find(frame => new URL(frame.url()).searchParams.get('explorer') === '1');
  await library.evaluate(async () => {await showWorkspaceTab('assetPane'); await loadAssets();});
  let releaseImage;
  const imageGate = new Promise(resolve => releaseImage = resolve);
  await windowPage.route('**/api/media/' + uploaded.id, async route => {await imageGate; await route.continue();});
  await library.evaluate(id => {window.imageInsert = placeAssets([id]);}, uploaded.id);
  await windowPage.evaluate(() => openBoard('b'));
  assert.equal(await library.evaluate(id => placeAssets([id]), uploaded.id), false, 'A repeated click during image preparation is not duplicated');
  releaseImage(); assert.equal((await library.evaluate(() => imageInsert)).length, 1);
  await windowPage.unroute('**/api/media/' + uploaded.id);
  const target = windowPage.frames().find(frame => frame.parentFrame() && new URL(frame.url()).searchParams.get('board') === 'a');
  const neighbour = windowPage.frames().find(frame => frame.parentFrame() && new URL(frame.url()).searchParams.get('board') === 'b');
  assert(await target.evaluate(id => board.nodes.some(node => node.assetId === id), uploaded.id));
  assert(!await neighbour.evaluate(id => board.nodes.some(node => node.assetId === id), uploaded.id));
  assert.equal(await windowPage.evaluate(() => current().boardId), 'b');
  // Clearing the native file input immediately must not drop the rest of its FileList.
  let releaseMany;
  const manyGate = new Promise(resolve => releaseMany = resolve);
  await windowPage.route('**/api/assets/upload', async route => {await manyGate; await route.continue();});
  await library.locator('#assetFiles').setInputFiles([
   {name:'upload-one.png', mimeType:'image/png', buffer:png},
   {name:'upload-two.png', mimeType:'image/png', buffer:png}
  ]);
  await library.waitForFunction(() => whiteboardImports.pending());
  assert(await windowPage.evaluate(() => {const event = new Event('beforeunload', {cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented;}));
  await windowPage.waitForFunction(() => document.getElementById('shellStatus').textContent.includes('正在添加素材'));
  releaseMany(); await library.waitForFunction(() => !whiteboardImports.pending());
  await windowPage.unroute('**/api/assets/upload');
  const catalog = await fetch(base + '/api/assets').then(r => r.json());
  assert(catalog.assets.some(asset => asset.title === 'upload-one.png'));
  assert(catalog.assets.some(asset => asset.title === 'upload-two.png'));
  assert.deepEqual(errors, []);
  console.log('Import continuity: original document, background tabs, repeated close, moving/deleted cell targets, image preparation, multiple native files and unload protection passed');
 } finally {
  if (browser) await browser.close();
  proc.kill(); await new Promise(resolve => proc.once('exit', resolve));
  const resolved = path.resolve(tmp);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, {recursive:true, force:true});
 }
})().catch(error => {console.error(error); process.exitCode = 1;});
