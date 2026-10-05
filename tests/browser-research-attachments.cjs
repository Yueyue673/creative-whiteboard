const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-research-attachments-'));
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
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined, headless:true});
  const page = await browser.newPage({viewport:{width:1400, height:900}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = await page.evaluate(() => {
   const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 18;
   const ctx = canvas.getContext('2d'); ctx.fillStyle = '#587c91'; ctx.fillRect(0, 0, 24, 18);
   return canvas.toDataURL('image/png').split(',')[1];
  });
  const png = Buffer.from(data, 'base64');
  const asset = await fetch(base + '/api/assets/upload', {method:'POST',
   headers:{'Content-Type':'application/octet-stream', 'X-File-Name':'reference-image.png'}, body:png}).then(r => r.json());
  assert((await fetch(base + '/api/boards/research', {method:'PUT', headers:{'Content-Type':'application/json', 'If-Match':'new'},
   body:JSON.stringify({format:'creative-board', version:1, name:'研究附件', nodes:[
    {id:'chosen', type:'note', sizeMode:'manual', title:'自己记录的图片', body:'作者自己的原文。', x:40, y:60, w:340, h:290,
     images:[{assetId:asset.id, name:asset.title}], tags:[]},
    {id:'other', type:'note', sizeMode:'manual', title:'未选择', body:'这段没有提供给研究。', x:500, y:50, w:300, h:170, tags:[]}
   ], edges:[], view:{x:0, y:0, z:1}})})).ok);
  await page.goto(base + '/index.html?board=research');
  await page.waitForFunction(() => boardId === 'research' && !loading);
  await page.evaluate(() => {selected = new Set(['chosen']); refreshSelectionUI(); whiteboardAI.compose();});
  await page.locator('#aiTaskText').fill('查找已有图像资料的来源与使用说明。');
  await page.locator('.ai-context-details summary').click();
  const prepare = () => page.evaluate(() => whiteboardAI.makePack());
  const first = await prepare();
  assert(first.visuals.images.length >= 3);
  assert(!JSON.stringify(first).includes('这段没有提供给研究。'));
  await page.waitForFunction(() => [...document.querySelectorAll('#aiContextPreview img')].every(img => img.complete && img.naturalWidth));
  assert((await page.locator('#aiContextPreview figcaption').allTextContents()).includes('图片 · 自己记录的图片'),
   'Visual captions use the original content title instead of an internal identifier');
  const sourceBoard = await fetch(base + '/api/boards/research').then(r => r.text());
  const sourceLibrary = await fetch(base + '/api/assets').then(r => r.text());
  function safeFile(file) {
   const resolved = path.resolve(file), relative = path.relative(path.resolve(tmp), resolved);
   assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
   return resolved;
  }
  async function removeFile(file) {
   const resolved = safeFile(file);
   for (let attempt = 0; ; attempt++) {
    try {fs.unlinkSync(resolved); return;} catch (error) {
     if (attempt >= 20 || !['EBUSY', 'EPERM'].includes(error.code)) throw error;
     await new Promise(resolve => setTimeout(resolve, 40));
    }
   }
  }
  // Missing cached task files are detected before the task is copied or downloaded.
  const firstImage = first.visuals.images.find(image => image.kind === 'image');
  await removeFile(firstImage.localPath);
  const missing = await fetch(base + '/api/ai/tasks/' + first.requestId).then(r => r.json());
  assert.equal(missing.visuals.unavailableImages.length, 1);
  assert(!missing.visuals.images.some(image => image.name === firstImage.name));
  const second = await prepare();
  assert.notEqual(second.requestId, first.requestId, 'Missing cached images cause preparation from the current source');
  assert.equal(second.visuals.images.length, first.visuals.images.length);
  assert(!second.visuals.unavailableImages?.length);
  assert.equal((await prepare()).requestId, second.requestId, 'Healthy attachments retain the same task');
  // A replacement with the same byte length must also be detected.
  const secondImage = second.visuals.images.find(image => image.kind === 'image');
  const modified = fs.readFileSync(safeFile(secondImage.localPath)); modified[40] ^= 1;
  fs.writeFileSync(safeFile(secondImage.localPath), modified);
  const third = await prepare();
  assert.notEqual(third.requestId, second.requestId);
  assert.equal(third.visuals.images.length, first.visuals.images.length);
  // A removed task record can be prepared again without changing the question.
  await removeFile(path.join(tmp, 'AI任务', third.requestId + '.json'));
  const fourth = await prepare();
  assert.notEqual(fourth.requestId, third.requestId);
  assert.equal(await page.locator('#aiTaskText').inputValue(), '查找已有图像资料的来源与使用说明。');
  // Temporary read failure is visible; cached material is not silently handed off.
  await page.route('**/api/ai/tasks/' + fourth.requestId, route => route.fulfill({status:503,
   contentType:'application/json', body:JSON.stringify({error:'模拟任务读取失败'})}));
  assert((await page.evaluate(async () => {try {await whiteboardAI.makePack(); return '';} catch (error) {return error.message;}})).includes('模拟任务读取失败'));
  await page.unroute('**/api/ai/tasks/' + fourth.requestId);
  assert.equal((await prepare()).requestId, fourth.requestId);
  // Preview loading failure is explicit and invalidates its cached preparation.
  const failedURL = fourth.visuals.images.find(image => image.kind === 'image').url;
  await page.route(failedURL, route => route.abort());
  await page.evaluate(pack => whiteboardContext.show(pack), fourth);
  await page.waitForFunction(() => document.getElementById('aiContextPreview').textContent.includes('图片未能加载'));
  if (process.env.RESEARCH_SCREENSHOT_DIR) {
   fs.mkdirSync(process.env.RESEARCH_SCREENSHOT_DIR, {recursive:true});
   await page.locator('#aiContextPreview figure').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(process.env.RESEARCH_SCREENSHOT_DIR, 'research-missing-preview.png')});
  }
  await page.unroute(failedURL);
  const fifth = await prepare();
  assert.notEqual(fifth.requestId, fourth.requestId);
  await page.waitForFunction(() => [...document.querySelectorAll('#aiContextPreview img')].every(img => img.complete && img.naturalWidth));
  if (process.env.RESEARCH_SCREENSHOT_DIR) {
   await page.locator('#aiContextPreview figure').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(process.env.RESEARCH_SCREENSHOT_DIR, 'research-ready-preview.png')});
  }
  // A download failure remains in the form instead of saving an error page as a ZIP.
  await page.route('**/api/ai/tasks/' + fifth.requestId + '/bundle', route => route.fulfill({status:503,
   contentType:'application/json', body:JSON.stringify({error:'模拟材料包下载失败'})}));
  await page.locator('#dialogActions button').filter({hasText:'下载材料'}).click();
  await page.waitForFunction(() => document.getElementById('aiReplyStatus').textContent.includes('模拟材料包下载失败'));
  await page.unroute('**/api/ai/tasks/' + fifth.requestId + '/bundle');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#dialogActions button').filter({hasText:'下载材料'}).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), '研究材料_' + fifth.requestId + '.zip');
  assert.equal(await download.failure(), null);
  assert.equal(await fetch(base + '/api/boards/research').then(r => r.text()), sourceBoard);
  assert.equal(await fetch(base + '/api/assets').then(r => r.text()), sourceLibrary);
  assert.deepEqual(errors, []);
  console.log('Research attachments: missing and modified images, record removal, cache reuse, visible preview/read/download failures, retry and unchanged authored work passed');
 } finally {
  if (browser) await browser.close();
  proc.kill(); await new Promise(resolve => proc.once('exit', resolve));
  const resolved = path.resolve(tmp);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, {recursive:true, force:true});
 }
})().catch(error => {console.error(error); process.exitCode = 1;});
