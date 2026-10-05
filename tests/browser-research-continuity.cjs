const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
 const root = path.resolve(__dirname, '..');
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-research-continuity-'));
 const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {const value = server.address().port; server.close(() => resolve(value));});
 });
 const base = 'http://127.0.0.1:' + port;
 const proc = spawn(process.env.PYTHON || 'python', [path.join(root, 'server.py')], {windowsHide:true,
  env:{...process.env, CREATIVE_BOARD_PORT:String(port), CREATIVE_BOARD_DATA_DIR:tmp, PYTHONIOENCODING:'utf-8'}});
 let browser;
 try {
  for (let attempt = 0; attempt < 100; attempt++) {
   try {if ((await fetch(base + '/api/health')).ok) break;} catch {}
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const id of ['a', 'b']) assert((await fetch(base + '/api/boards/' + id, {method:'PUT',
   headers:{'Content-Type':'application/json', 'If-Match':'new'},
   body:JSON.stringify({format:'creative-board', version:1, name:'观察 ' + id, folder:'',
    nodes:[{id:'note', type:'note', title:'作者自己的观察', body:'属于 ' + id + ' 的原文。', x:60, y:80, w:300, h:200, tags:[]}],
    edges:[], view:{x:0, y:0, z:1}})})).ok);
  browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || undefined});
  const context = await browser.newContext({viewport:{width:1400, height:900}});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/index.html?board=a');
  await page.waitForFunction(() => boardId === 'a' && !loading);
  await page.evaluate(() => {
   selected.clear(); whiteboardAI.compose();
   const originalCapture = whiteboardContext.capture;
   whiteboardContext.capture = async pack => {
    if (window.holdResearchCapture) {
     window.holdResearchCapture = false;
     window.heldResearchPack = pack;
     await new Promise(resolve => window.releaseResearchCapture = resolve);
    }
    return originalCapture(pack);
   };
  });
  await page.locator('#aiVisuals').uncheck();
  await page.locator('#aiTaskText').fill('查找第一组正式来源。');
  await page.evaluate(() => {
   window.holdResearchCapture = true;
   window.firstResearch = whiteboardAI.makePack().then(pack => ({pack}), error => ({error:error.message}));
  });
  await page.waitForFunction(() => !!window.releaseResearchCapture);
  await page.locator('#aiTaskText').fill('查找第二组正式来源。');
  await page.evaluate(() => {
   window.secondResearch = whiteboardAI.makePack().then(pack => ({pack}), error => ({error:error.message}));
  });
  await page.evaluate(() => releaseResearchCapture());
  const [first, second] = await page.evaluate(() => Promise.all([firstResearch, secondResearch]));
  assert.equal(second.pack?.request.task, '查找第二组正式来源。', 'Changing the question cannot reuse the preceding in-flight task');
  assert(first.error?.includes('重新准备'), 'An obsolete preparation stops instead of handing off mismatched material');
  assert.equal((await fetch(base + '/api/ai/tasks').then(r => r.json())).length, 1);
  assert.equal(second.pack.targetId, 'a');
  assert.equal(second.pack.aiPolicy.readOnly, true);
  assert(!Object.hasOwn(second.pack, 'proposalRules'));
  assert.equal((await page.evaluate(() => whiteboardAI.makePack())).requestId, second.pack.requestId);
  await page.locator('#aiTaskText').fill('问题已经更新，先检查预览。');
  assert((await page.locator('#aiContextPreview').textContent()).includes('重新准备'));
  // Changing authored content while an image snapshot is pending cannot produce a mixed task.
  await page.evaluate(() => {
   window.releaseResearchCapture = null; window.holdResearchCapture = true;
   window.editedResearch = whiteboardAI.makePack().then(pack => ({pack}), error => ({error:error.message}));
  });
  await page.waitForFunction(() => !!window.releaseResearchCapture);
  await page.evaluate(() => {board.nodes[0].body = '作者后来补充的原文。'; change(); releaseResearchCapture();});
  const edited = await page.evaluate(() => editedResearch);
  assert(edited.error?.includes('重新准备'));
  assert.equal((await fetch(base + '/api/ai/tasks').then(r => r.json())).length, 1);
  const fresh = await page.evaluate(() => whiteboardAI.makePack());
  assert.equal(fresh.data.nodes[0].body, '作者后来补充的原文。');
  // Closing and reopening the form prevents the old task from updating the new form.
  await page.locator('#aiTaskText').fill('关闭前的问题。');
  await page.evaluate(() => {
   window.releaseResearchCapture = null; window.holdResearchCapture = true;
   window.closedResearch = whiteboardAI.makePack().then(pack => ({pack}), error => ({error:error.message}));
  });
  await page.waitForFunction(() => !!window.releaseResearchCapture);
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.evaluate(() => whiteboardAI.compose());
  await page.locator('#aiVisuals').uncheck();
  await page.locator('#aiTaskText').fill('重新打开后要查的正式来源。');
  await page.evaluate(() => {
   window.reopenedResearch = whiteboardAI.makePack().then(pack => ({pack}), error => ({error:error.message}));
   releaseResearchCapture();
  });
  const [closed, reopened] = await page.evaluate(() => Promise.all([closedResearch, reopenedResearch]));
  assert(closed.error?.includes('重新准备'));
  assert.equal(reopened.pack.request.task, '重新打开后要查的正式来源。');
  assert((await page.locator('#aiReplyStatus').innerText()).includes('已准备'));
  // A failed local task save can be retried; it never changes authored content.
  await page.locator('#aiTaskText').fill('本地保存失败后重试的问题。');
  await page.route('**/api/ai/tasks/*', route => route.request().method() === 'PUT'
   ? route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:'模拟材料保存失败'})}) : route.continue());
  const failed = await page.evaluate(() => whiteboardAI.makePack().then(pack => ({pack}), error => ({error:error.message})));
  assert(failed.error?.includes('模拟材料保存失败'));
  await page.unroute('**/api/ai/tasks/*');
  const retried = await page.evaluate(() => whiteboardAI.makePack());
  assert.equal(retried.request.task, '本地保存失败后重试的问题。');
  assert.equal(await page.evaluate(() => board.nodes[0].body), '作者后来补充的原文。');
  // Legacy entry points open the same research-only interface.
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.evaluate(() => whiteboardExperience.composeAI());
  assert.equal(await page.locator('#dialogBody h2').innerText(), '查资料与参考');
  assert.equal(await page.locator('#aiAllowAdd').isChecked(), false);
  assert(!((await page.locator('#dialogBody').innerText()).includes('查看修改')));
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  // The selected library pieces remain the explicit source throughout preparation.
  const catalogResponse = await fetch(base + '/api/assets');
  const catalog = await catalogResponse.json();
  for (const id of ['piece-a', 'piece-b']) catalog.assets.push({id, title:id, path:'', folder:'观察/' + id,
   mime:'application/x-creative-bundle', bundle:{nodes:[{id:'inner-' + id, type:'note', title:id,
    body:'作者的 ' + id + ' 原文。', x:0, y:0, w:300, h:160, tags:[]}], edges:[]}});
  assert((await fetch(base + '/api/assets', {method:'PUT', headers:{'Content-Type':'application/json',
   'If-Match':catalogResponse.headers.get('ETag')}, body:JSON.stringify(catalog)})).ok);
  await page.evaluate(async () => {await loadAssets(); selected.clear(); assetSelected=new Set(['piece-a']);whiteboardAI.compose();});
  await page.locator('#aiVisuals').uncheck();
  await page.locator('#aiTaskText').fill('查找所选资料相关的正式来源。');
  await page.evaluate(() => {
   window.releaseResearchCapture=null;window.holdResearchCapture=true;
   window.firstLibraryResearch=whiteboardAI.makePack().then(pack=>({pack}),error=>({error:error.message}));
  });
  await page.waitForFunction(() => !!window.releaseResearchCapture);
  await page.evaluate(() => {
   assetSelected=new Set(['piece-b']);
   window.secondLibraryResearch=whiteboardAI.makePack().then(pack=>({pack}),error=>({error:error.message}));
   releaseResearchCapture();
  });
  const [libraryOld, libraryNew]=await page.evaluate(()=>Promise.all([firstLibraryResearch,secondLibraryResearch]));
  assert(libraryOld.error?.includes('重新准备'));
  assert.deepEqual(libraryNew.pack.data.assets.map(asset=>asset.id),['piece-b']);
  assert(!JSON.stringify(libraryNew.pack).includes('作者的 piece-a 原文。'));
  assert.deepEqual(libraryNew.pack.data.folders,['观察','观察/piece-b']);
  // Switching scope cannot keep the old set of authored background.
  await page.getByRole('button', {name:'关闭', exact:true}).click();
  await page.evaluate(async()=>{
   addNote({x:450,y:240},{title:'未选中的记录',body:'这块没有被选择，不应出现在选中范围的任务里。'});
   await persist();selected=new Set(['note']);assetSelected.clear();whiteboardAI.compose();
  });
  await page.locator('#aiVisuals').uncheck();await page.locator('#aiTaskScope').selectOption('board');
  await page.locator('#aiTaskText').fill('按明确范围查找原始资料。');
  await page.evaluate(()=>{
   window.releaseResearchCapture=null;window.holdResearchCapture=true;
   window.boardScopeResearch=whiteboardAI.makePack().then(pack=>({pack}),error=>({error:error.message}));
  });
  await page.waitForFunction(()=>!!window.releaseResearchCapture);
  await page.locator('#aiTaskScope').selectOption('selected');
  await page.evaluate(()=>{
   window.selectedScopeResearch=whiteboardAI.makePack().then(pack=>({pack}),error=>({error:error.message}));
   releaseResearchCapture();
  });
  const [scopeOld,scopeNew]=await page.evaluate(()=>Promise.all([boardScopeResearch,selectedScopeResearch]));
  assert(scopeOld.error?.includes('重新准备'));
  assert.deepEqual(scopeNew.pack.data.nodes.map(node=>node.id),['note']);
  assert(!JSON.stringify(scopeNew.pack).includes('这块没有被选择'));
  assert.deepEqual(errors, []);
  console.log('Research continuity: changed questions, content, library pieces and scope; stale previews, form reopening, caching, retry and research-only legacy entry points passed');
 } finally {
  if (browser) await browser.close();
  proc.kill(); await new Promise(resolve => proc.once('exit', resolve));
  const resolved = path.resolve(tmp);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, {recursive:true, force:true});
 }
})().catch(error => {console.error(error); process.exitCode = 1;});
