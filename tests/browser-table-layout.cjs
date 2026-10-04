const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process');
const assert = require('assert');
const {chromium} = require('playwright');
(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-table-layout-'));
 const port = await new Promise(resolve => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {const port = s.address().port; s.close(() => resolve(port))});
 });
 const base = 'http://127.0.0.1:' + port;
 const proc = spawn(process.env.PYTHON || 'python', [root + '/server.py'], {
  env: {...process.env, CREATIVE_BOARD_PORT: String(port), CREATIVE_BOARD_DATA_DIR: tmp, PYTHONIOENCODING: 'utf-8'}, windowsHide: true
 });
 let browser;
 try {
  for (let i = 0; i < 100; i++) {
   try {if ((await fetch(base + '/api/health')).ok) break} catch {}
   await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined, headless: true});
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => board && !loading);
  await page.evaluate(() => {board.nodes = []; board.edges = []; board.view = {x: 0, y: 0, z: 1}; selected.clear(); editorId = null; render()});
  await page.locator('#addTable').click();
  await page.waitForFunction(() => board.nodes.length === 1);
  const id = await page.evaluate(() => board.nodes[0].id);
  const card = page.locator('.node[data-id="' + id + '"]');
  const dimensions = () => page.evaluate(() => {const n = board.nodes[0]; return {x: n.x, y: n.y, w: n.w, h: n.h}});
  const initial = await dimensions();
  assert.equal(initial.h, 360, 'New table keeps its initial height');
  async function unchanged(expected, reason) {
   await page.waitForTimeout(120);
   assert.deepEqual(await dimensions(), expected, reason);
   const metrics = await card.evaluate(e => {
    const box = e.getBoundingClientRect(), grid = e.querySelector('.table-scroll').getBoundingClientRect();
    return {box: {top: box.top, bottom: box.bottom}, grid: {top: grid.top, bottom: grid.bottom}};
   });
   assert(metrics.grid.top >= metrics.box.top && metrics.grid.bottom <= metrics.box.bottom + 1, reason + ': grid stays inside frame');
  }
  await unchanged(initial, 'Created table');
  // Reproduce the reported transition by clicking the actual empty canvas.
  const canvasRect = await page.locator('#canvas').boundingBox();
  await page.mouse.click(canvasRect.x + 20, canvasRect.y + 40);
  await unchanged(initial, 'Clicking away must not collapse the frame');
  const readRowHeights = await card.locator('tbody tr').evaluateAll(rows => rows.map(e => e.getBoundingClientRect().height));
  assert(readRowHeights.every(h => h >= 48), 'Empty rows retain readable height: ' + readRowHeights);
  await card.locator('[data-cell="1,1"]').dblclick({position: {x: 70, y: 20}});
  await page.waitForFunction(() => document.activeElement?.dataset.row === '1' && document.activeElement?.dataset.col === '1');
  await unchanged(initial, 'Entering a particular cell');
  const toolbarBox = await card.locator('.inline-toolbar').boundingBox(), cardBox = await card.boundingBox();
  assert(toolbarBox.y >= cardBox.y && toolbarBox.x >= cardBox.x && toolbarBox.x + toolbarBox.width <= cardBox.x + cardBox.width + 1, 'Editing toolbar stays inside the card');
  assert.equal(await card.locator('.inline-toolbar .table-actions').count(), 1);
  await page.locator('#tableAddRow').click();
  await page.locator('#tableAddColumn').click();
  await unchanged(initial, 'Adding rows and columns');
  assert.equal(await page.evaluate(() => board.nodes[0].rows.length), 4);
  assert.equal(await page.evaluate(() => board.nodes[0].columns.length), 4);
  await page.locator('[data-row="1"][data-col="1"]').fill(Array.from({length: 25}, (_, i) => '第 ' + (i + 1) + ' 行拍摄记录').join('\n'));
  await page.locator('[data-row="1"][data-col="1"]').press('Control+End');
  await unchanged(initial, 'Typing long cell content');
  assert(await card.locator('.table-scroll').evaluate(e => e.scrollHeight > e.clientHeight), 'Long text scrolls within the table');
  await page.locator('[data-row="1"][data-col="1"]').fill('同一段内容在编辑前后保持一致。');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
  const response = await fetch(base + '/api/assets/upload', {method: 'POST', headers: {'X-File-Name': 'sample.png'}, body: image});
  assert(response.ok); const asset = await response.json();
  await page.evaluate(() => loadAssets());
  const dt = await page.evaluateHandle(id => {const d = new DataTransfer(); d.setData('application/x-creative-assets', JSON.stringify([id])); return d}, asset.id);
  await page.locator('[data-cell="0,0"]').dispatchEvent('drop', {dataTransfer: dt});
  await page.waitForFunction(() => !!document.querySelector('[data-cell="0,0"] img')?.complete);
  await unchanged(initial, 'Loading an image');
  await page.locator('#inlineDone').click();
  await unchanged(initial, 'Finishing editing');
  // Test actual pointer resizing on opposite corners rather than only setting data.
  async function resize(direction, dx, dy) {
   const before = await dimensions(), box = await card.locator('[data-resize-direction="' + direction + '"]').boundingBox();
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
   await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {steps: 6}); await page.mouse.up();
   const after = await dimensions();
   assert.equal(after.w, before.w + (direction.includes('w') ? -dx : dx));
   assert.equal(after.h, before.h + (direction.includes('n') ? -dy : dy));
   if (direction.includes('w')) assert.equal(after.x + after.w, before.x + before.w);
   if (direction.includes('n')) assert.equal(after.y + after.h, before.y + before.h);
   await unchanged(after, 'Resizing ' + direction);
   return after;
  }
  await resize('se', 80, 60);
  const resized = await resize('nw', -40, -30);
  await page.evaluate(() => persist());
  await page.reload(); await page.waitForFunction(() => board && !loading);
  await unchanged(resized, 'Saving and reopening');
  assert.equal(await card.locator('[data-cell="1,1"] > textarea').inputValue(), '同一段内容在编辑前后保持一致。');
  await page.evaluate(() => {showWorkspaceTab('manager'); selected = new Set([board.nodes[0].id]); render()});
  if (process.env.TABLE_SCREENSHOT_DIR) {
   fs.mkdirSync(process.env.TABLE_SCREENSHOT_DIR, {recursive: true});
   await page.screenshot({path: path.join(process.env.TABLE_SCREENSHOT_DIR, 'table-read.png')});
  }
  await card.locator('[data-cell="2,0"]').dblclick({position: {x: 70, y: 20}});
  await page.locator('#textSizeTools > summary').click();
  assert(await page.locator('#noteBodySize').isVisible());
  await page.locator('#noteBodySize').fill('17'); await page.locator('#noteBodySize').press('Tab');
  await unchanged(resized, 'Changing font size');
  if (process.env.TABLE_SCREENSHOT_DIR) await page.screenshot({path: path.join(process.env.TABLE_SCREENSHOT_DIR, 'table-edit.png')});
  await page.locator('#textSizeTools > summary').press('Escape');
  assert(await page.locator('#noteBodySize').isHidden());
  await page.locator('.table-options > summary').click();
  assert(await page.locator('#tableCSV').isVisible());
  await page.locator('#inlineDetails').click(); assert(await page.locator('#inlineMeta').isVisible());
  await page.locator('#inlineMetaClose').click(); assert(await page.locator('#inlineMeta').isHidden());
  // Existing tiny frames can be restored explicitly, without a redraw rewriting their size.
  await page.evaluate(() => {const n = board.nodes[0]; n.w = 320; n.h = 260; openEditor(n.id)});
  const narrow = await dimensions(); await unchanged(narrow, 'Narrow card layout');
  const narrowTools = await card.locator('.inline-toolbar').boundingBox(), narrowFrame = await card.boundingBox();
  assert(narrowTools.x + narrowTools.width <= narrowFrame.x + narrowFrame.width + 1, 'Toolbar wraps inside a narrow table');
  await page.evaluate(() => {board.nodes[0].h = 130; openEditor(board.nodes[0].id)});
  await page.locator('.table-options > summary').click();
  await page.locator('#tableFit').click();
  const fitted = await dimensions(); assert(fitted.h >= 240);
  await unchanged(fitted, 'Explicit height adjustment of an old small frame');
  await page.locator('.table-options > summary').click();
  await page.locator('.table-options > summary').press('Escape');
  assert(await page.locator('#tableCSV').isHidden());
  assert(await page.locator('.live-layout').isVisible(), 'Escape closes options before ending editing');
  await page.locator('#inlineDetails').click();
  await page.locator('#tags').press('Escape');
  assert(await page.locator('#inlineMeta').isHidden());
  assert(await page.locator('.live-layout').isVisible(), 'Escape closes metadata before ending editing');
  assert.deepEqual(errors, []);
  console.log('表格布局：新建、点开点外、空行、单元格定位、增行列、长文和图片、角点调整、保存重载、内部工具栏和字号通过');
 } finally {
  if (browser) await browser.close();
  proc.kill(); await new Promise(r => proc.once('exit', r));
  const resolved = path.resolve(tmp); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, {recursive: true, force: true});
 }
})().catch(e => {console.error(e); process.exitCode = 1});
