const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-research-boundary-'));
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
  const authored = {format:'creative-board', version:1, name:'自己的观察', nodes:[
   {id:'own', type:'note', sizeMode:'manual', title:'作者原有标题', body:'每一句都由作者自己写。',
    x:40, y:70, w:360, h:180, tags:[]}
  ], edges:[], view:{x:0, y:0, z:1}};
  const response = await fetch(base + '/api/boards/own', {method:'PUT',
   headers:{'Content-Type':'application/json', 'If-Match':'new'}, body:JSON.stringify(authored)});
  assert(response.ok);
  const proposal = {format:'creative-board-proposal', version:1, resource:'board', targetId:'own',
   baseETag:response.headers.get('ETag'), title:'旧修改提案', changes:[
    {op:'update', entity:'node', targetId:'own', before:{body:authored.nodes[0].body}, after:{body:'AI 改写的正文'}}
   ]};
  const legacyFile = path.join(tmp, 'AI待审核', 'legacy.json');
  fs.mkdirSync(path.dirname(legacyFile), {recursive:true});
  fs.writeFileSync(legacyFile, JSON.stringify(proposal));
  const originalLegacy = fs.readFileSync(legacyFile, 'utf8');
  const originalBoard = await fetch(base + '/api/boards/own').then(r => r.text());
  const originalLibrary = await fetch(base + '/api/assets').then(r => r.text());
  browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || undefined});
  const context = await browser.newContext({viewport:{width:1400, height:900}});
  const page = await context.newPage(), errors = [], writes = [], downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
   if (request.method() === 'PUT' && /\/api\/(boards|assets|proposals)\b/.test(request.url())) writes.push(request.url());
  });
  page.on('download', download => downloads.push(download.suggestedFilename()));
  // A missing research module must not restore the old AI write-back workflow.
  await page.route('**/ai-workflow.js', route => route.abort());
  await page.goto(base + '/index.html?board=own');
  await page.waitForFunction(() => boardId === 'own' && !loading);
  const boundary = await page.evaluate(async proposal => {
   const before = JSON.stringify(board); let applyError = '', importError = '';
   try {wfApplyProposal(board, proposal, proposal.changes);} catch (error) {applyError = error.message;}
   try {await wfImportProposal(proposal);} catch (error) {importError = error.message;}
   return {applyError, importError, unchanged:before === JSON.stringify(board)};
  }, proposal);
  assert(boundary.applyError.includes('不能修改'), 'The foundational workflow must reject AI edits even if its final module does not load');
  assert(boundary.importError.includes('不能修改'));
  assert(boundary.unchanged);
  await page.evaluate(() => wfReviewProposal('legacy'));
  assert.equal(await page.locator('#dialogBody h2').innerText(), '旧提案记录');
  assert.equal(await page.locator('#dialogActions button').count(), 1);
  assert.equal(await page.locator('#dialogActions button').innerText(), '关闭');
  assert.equal(await page.locator('[data-wf-change]').count(), 0);
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.evaluate(() => wfAIInbox());
  assert.equal(await page.locator('#dialogBody h2').innerText(), '旧提案记录');
  assert.equal(await page.locator('#wfImportProposal').count(), 0);
  await page.locator('[data-proposal=legacy]').click();
  await page.waitForFunction(body => document.getElementById('dialogBody').innerText.includes(body), proposal.changes[0].after.body);
  assert((await page.locator('#dialogBody').innerText()).includes(proposal.changes[0].after.body));
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.locator('#aiWorkspace').click();
  await page.waitForFunction(() => document.getElementById('dialog').open);
  assert((await page.locator('#dialogBody').innerText()).includes('重新加载'));
  assert.equal(await page.locator('#aiAllowAdd').count(), 0);
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.evaluate(() => wfExportAI('board'));
  assert((await page.locator('#dialogBody').innerText()).includes('重新加载'));
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  const blockedPaste = await page.evaluate(async proposal => {
   try {await pastePayload(JSON.stringify(proposal), [], {x:600,y:100}); return false;}
   catch (error) {return error.message.includes('不能修改');}
  }, proposal);
  assert(blockedPaste);
  const blockedImport = await page.evaluate(async proposal => {
   try {await importFiles([new File([JSON.stringify(proposal)], 'old-proposal.json', {type:'application/json'})], {x:600,y:100});return false;}
   catch (error) {return error.message.includes('不能修改');}
  }, proposal);
  assert(blockedImport);
  assert.deepEqual(writes, []);
  assert.deepEqual(downloads, []);
  assert.equal(await fetch(base + '/api/boards/own').then(r => r.text()), originalBoard);
  assert.equal(await fetch(base + '/api/assets').then(r => r.text()), originalLibrary);
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), originalLegacy);
  // The degraded research interface cannot prevent the author from editing and saving.
  await page.locator('[data-id=own]').dblclick({position:{x:70,y:90}});
  await page.locator('#body').fill('作者本人补充了这一句。');
  await page.locator('#inlineDone').click();
  assert(await page.evaluate(() => persist()));
  assert.equal((await fetch(base + '/api/boards/own').then(r => r.json())).nodes[0].body, '作者本人补充了这一句。');
  // After a normal reload, legacy records remain read-only and research works again.
  await page.unroute('**/ai-workflow.js'); await page.reload();
  await page.waitForFunction(() => boardId === 'own' && !loading && whiteboardAI.references);
  await page.evaluate(() => wfReviewProposal('legacy'));
  assert.equal(await page.locator('#dialogActions button').count(), 1);
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.locator('#aiWorkspace').click(); await page.locator('#aiVisuals').uncheck();
  await page.locator('#aiTaskText').fill('查找可核对的正式来源。');
  const pack = await page.evaluate(() => whiteboardAI.makePack());
  assert.equal(pack.aiPolicy.readOnly, true);
  assert(!Object.hasOwn(pack, 'proposalRules'));
  assert.equal(pack.data.nodes[0].body, '作者本人补充了这一句。');
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), originalLegacy);
  assert.deepEqual(errors, []);
  console.log('Research boundary: missing module, legacy records, blocked apply/import/paste/export, unchanged sources, author editing and research recovery passed');
 } finally {
  if (browser) await browser.close();
  proc.kill(); await new Promise(resolve => proc.once('exit', resolve));
  const resolved = path.resolve(tmp);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, {recursive:true, force:true});
 }
})().catch(error => {console.error(error); process.exitCode = 1;});
