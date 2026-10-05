const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = process.env.CREATIVE_BOARD_TEST_ROOT || path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-attachment-history-'));
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
  }
  // Undoing an unrelated edit replaces the document object, but not the chosen content.
  await heldAttachment('undo-note.png', 'image/png', png, {nodeId:'note'}, () => {
   addNote({x:800, y:400}, {title:'稍后的记录', body:'随后撤销的内容。'}); undo();
  });
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'note').images?.[0]?.name), 'undo-note.png',
   'An unrelated undo must not lose the original note attachment');
  assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'note').body), '自己的原文。');
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
