const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const R = path.resolve(process.env.CREATIVE_BOARD_TEST_ROOT || path.join(__dirname, '..'));
const O = process.env.RECOVERY_LIBRARY_OWNER_PROOF || path.join(R, '.test-proof-recovery-library-owner');
const PY = process.env.PYTHON || 'python';
assert(R && O && PY && !fs.existsSync(O));
fs.mkdirSync(O, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const proof = { at: new Date().toISOString(), complete: false, syntheticOnly: true,
  scope: 'Library-history view ownership through native copy, compare, confirmation, delayed reads and explicit retries.',
  controlledHostMetadataOnly: true, DOMOverrides: false, moduleOverrides: false,
  actualHostedAccountOrPrivateContentClaimed: false, cases: [], errors: [] };
const releases = [];
const save = () => fs.writeFileSync(O + '/result.json', JSON.stringify(proof, null, 2) + '\n');
let proc, browser, exited, fd, base;
(async () => {
  try {
    proof.head = execFileSync(process.env.GIT_EXE || 'git', ['-C', R, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    proof.taskSHA256 = hash(fs.readFileSync(__filename));
    const names = ['recovery.js','cells.js','appearance.js','document-paper.js','document-paper.css','note-editor.js','note-editor.css','refinement.js','refinement.css','workflow.js','workflow.css','pane.js','workspace.js','workspace.css','workspace-shell.js','workspace-shell.css','shell.js','shell.css','index.html','navigation.js','library-copies.js','canvas-objects.js','canvas-objects.css','theme.js','theme.css','library-spatial.js','library-spatial.css','library-folders.js','shell.html','board-lifecycle.js','media-markers.js','media-controls.js','library-editing.js','experience.js'];
    proof.runtimeFiles = Object.fromEntries(names.map(n => [n, hash(fs.readFileSync(R + '/' + n))]));
    const data = O + '/given-data', hooks = O + '/hooks';
    fs.mkdirSync(data);
    execFileSync(PY, [R + '/tests/local_start_fixture.py', '--write-hooks', hooks], { windowsHide: true });
    const port = await require(R + '/tests/browser-port.cjs')();
    base = 'http://127.0.0.1:' + port;
    const env = { ...process.env, CREATIVE_BOARD_DATA_DIR: data, CREATIVE_BOARD_PORT: String(port),
      PYTHONPATH: hooks, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
      START_FIXTURE_DATA_DENIED: '0', START_FIXTURE_LIFETIME: '240' };
    delete env.PYTHONHOME;
    for (const k of Object.keys(env)) if (k.startsWith('CREATIVE_BOARD_HOSTED_')) delete env[k];
    fd = fs.openSync(O + '/server.log', 'w');
    proc = spawn(PY, [R + '/server.py'], { cwd: R, env, windowsHide: true, stdio: ['ignore', fd, fd] });
    exited = new Promise((resolve, reject) => { proc.once('exit', (code, signal) => resolve({ code, signal })); proc.once('error', reject); });
    proof.ownedServer = { pid: proc.pid, port, data }; save();
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert(ready);
    for (const [n, h] of Object.entries(proof.runtimeFiles)) assert.equal(hash(Buffer.from(await (await fetch(base + (n === 'shell.html' ? '/' : '/' + n))).arrayBuffer())), h);
    proof.servedRuntimeExact = true;
    const req = async (url, method = 'GET', value, etag) => {
      const response = await fetch(base + url, { method, headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(etag ? { 'If-Match': etag } : {}) }, body: value === undefined ? undefined : JSON.stringify(value) });
      assert(response.ok, method + ' ' + url + ' ' + response.status);
      return { value: await response.json(), etag: response.headers.get('ETag') };
    };

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    for (const width of [1360, 320]) {
      const id = 'given-recovery-owner-board-' + width, resource = 'given-recovery-owner-resource-' + width;
      const old = { id: resource, title: 'Given saved material ' + width, path: '', folder: 'Given folder', size: 0,
        mime: 'application/x-creative-bundle', notes: 'Given retained metadata', tags: ['given'],
        bundle: { nodes: [{ id: 'given-note', type: 'note', title: 'Given original', body: 'Given historical original words ' + width, x: 0, y: 0, w: 280, h: 160 }], edges: [] } };
      let catalog = await req('/api/assets');
      catalog.value.assets.push(structuredClone(old));
      if (!catalog.value.folders.includes(old.folder)) catalog.value.folders.push(old.folder);
      await req('/api/assets', 'PUT', catalog.value, catalog.etag);
      await req('/api/checkpoints/library/catalog', 'PUT');
      catalog = await req('/api/assets');
      catalog.value.assets.find(a => a.id === resource).bundle.nodes[0].body = 'Given current original words ' + width;
      await req('/api/assets', 'PUT', catalog.value, catalog.etag);
      const pinned = (await req('/api/history/library/catalog')).value[0]; assert(pinned?.id);
      await req('/api/boards/' + id, 'PUT', { format: 'creative-board', version: 1, name: 'Given recovery ownership ' + width, nodes: [], edges: [], view: { x: 0, y: 0, z: 1 } }, 'new');
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', e => proof.errors.push(e.message));
      await page.goto(base + '/?board=' + id);
      await page.waitForFunction(id => current()?.boardId === id && !pane(current())?.state().loading, id);
      const frame = await (await (await page.evaluateHandle(() => frames.get(current().id))).asElement()).contentFrame();
      let writes = 0;
      context.on('request', request => { if (new URL(request.url()).pathname === '/api/assets' && request.method() === 'PUT') writes++; });
      const row = { width, checks: [] }; proof.cases.push(row);
      const pass = name => { row.checks.push({ name, passed: true }); row.checkBlocks = row.checks.length; save(); };
      const resetOwner = () => page.evaluate(() => { window.whiteboardHosted = { account: { id: 'given-account-a' }, workspace: 'given-workspace-a', base: '/given-base-a', role: 'editor', paused: false }; });
      const changeOwner = mode => page.evaluate(mode => {
        if (mode === 'viewer') whiteboardHosted.role = 'viewer';
        else if (mode === 'paused') whiteboardHosted.paused = true;
        else if (mode === 'replacement') window.whiteboardHosted = { ...whiteboardHosted, account: { ...whiteboardHosted.account } };
        else { whiteboardHosted.account.id = 'given-account-b'; whiteboardHosted.workspace = 'given-workspace-b'; whiteboardHosted.base = '/given-base-b'; }
      }, mode);
      const restoreSameOwner = () => page.evaluate(() => { whiteboardHosted.account.id = 'given-account-a'; whiteboardHosted.workspace = 'given-workspace-a'; whiteboardHosted.base = '/given-base-a'; whiteboardHosted.role = 'editor'; whiteboardHosted.paused = false; });
      const close = async () => { if (await frame.locator('#dialog').isVisible()) { await page.keyboard.press('Escape'); await frame.locator('#dialog').waitFor({ state: 'hidden' }); } };
      const historyList = async (role = 'editor') => {
        await close(); await resetOwner();
        if (role === 'viewer') await changeOwner('viewer');
        await page.locator('#shellMore summary').click(); await page.locator('#shellMore [data-command=recovery]').click();
        await frame.locator('[data-recovery-tab="library"]').click();
        await frame.waitForFunction(() => document.querySelector('[data-recovery-tab="library"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('#wfRecoveryList')?.getAttribute('aria-busy') === 'false');
        const revisions = (await req('/api/history/library/catalog')).value;
        const index = revisions.findIndex(r => r.id === pinned.id); assert(index >= 0);
        return frame.locator('[data-revision="' + index + '"]');
      };
      const open = async (role = 'editor') => { await (await historyList(role)).click(); await frame.locator('#wfRevisionItems input[value="' + resource + '"]').check(); };
      const query = () => frame.locator('#wfRevisionSearch');
      const capture = async () => {
        await query().fill('Given'); await query().press('Home'); await query().press('Shift+ArrowRight'); await query().press('Shift+ArrowRight');
        return { field: await query().elementHandle(), selection: await query().evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd })), checked: await frame.locator('#wfRevisionItems input:checked').count() };
      };
      const assertKept = async before => {
        assert(await before.field.evaluate(el => el.isConnected && el === document.querySelector('#wfRevisionSearch')));
        assert.deepEqual(await before.field.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd })), before.selection);
        assert.equal(await frame.locator('#wfRevisionItems input:checked').count(), before.checked);
        assert(await frame.locator('#dialog').isVisible());
      };
      const stored = async () => (await req('/api/assets')).value;
      const copy = () => frame.getByRole('button', { name: '另存勾选内容', exact: true }).click();
      const compare = async () => { await frame.getByRole('button', { name: '比较并恢复', exact: true }).click(); await frame.locator('.wf-diffs').waitFor(); };
      const apply = () => frame.getByRole('button', { name: '应用勾选的修改', exact: true }).click();
      const stopped = async () => { await frame.locator('#toast').filter({ hasText: '未写入内容库' }).waitFor(); await frame.waitForFunction(() => !document.querySelector('#dialog [data-recovery-action]:disabled') && !document.querySelector('#dialog [aria-busy="true"]')); };
      const heldCatalog = async action => {
        let release, started; const gate = new Promise(r => release = r), seen = new Promise(r => started = r); releases.push(release);
        let held = false;
        const handler = async route => { if (!held && route.request().method() === 'GET') { held = true; started(); await gate; } return route.fallback(); };
        await context.route(base + '/api/assets', handler); await action();
        await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error('Expected catalog read did not start')), 10000))]);
        return { release, finish: () => context.unroute(base + '/api/assets', handler) };
      };

      // An old history list itself cannot fetch a new-account revision under its old identity.
      const button = await historyList(), listBefore = await frame.locator('#wfRecoveryList').innerText();
      await changeOwner('account'); await button.click();
      await frame.locator('#toast').filter({ hasText: '查看范围已有变化' }).waitFor();
      assert.equal(await frame.locator('#wfRecoveryList').innerText(), listBefore); assert.equal(writes, 0);
      pass('An already visible history-list action stops after the controlled account/workspace changes, preserving the original list.');

      const pendingRevisionButton = await historyList(), retainedList = await frame.locator('#wfRecoveryList').innerText();
      let releaseRevision, revisionStarted;
      const revisionGate = new Promise(resolve => releaseRevision = resolve), revisionSeen = new Promise(resolve => revisionStarted = resolve); releases.push(releaseRevision);
      const revisionURL = base + '/api/history/library/catalog/' + pinned.id;
      const revisionHandler = async route => { revisionStarted(); await revisionGate; return route.fallback(); };
      await context.route(revisionURL, revisionHandler); await pendingRevisionButton.click(); await revisionSeen;
      await changeOwner('account'); releaseRevision();
      await frame.locator('#toast').filter({ hasText: '查看范围已有变化' }).waitFor();
      await context.unroute(revisionURL, revisionHandler);
      assert.equal(await frame.locator('#wfRecoveryList').innerText(), retainedList); assert.equal(await frame.locator('#wfRevisionItems').count(), 0); assert.equal(writes, 0);
      pass('A revision response requested in the original owner is not displayed after the controlled owner changes during its read.');

      await open('viewer'); let viewerKept = await capture(), viewerBefore = await stored(), viewerWrites = writes;
      await copy(); await stopped(); assert.equal(writes, viewerWrites); assert.deepEqual(await stored(), viewerBefore); await assertKept(viewerKept);
      pass('A scope that was already controlled-readonly can inspect its historical selection but cannot copy it, even with an unchanged scope key.');

      for (const mode of ['account', 'replacement', 'viewer', 'paused']) {
        await open(); const kept = await capture(), before = await stored(), count = writes;
        await changeOwner(mode); await copy(); await stopped();
        assert.equal(writes, count); assert.deepEqual(await stored(), before); await assertKept(kept);
        pass('Copy stops before a write after controlled ' + mode + ' change; original query/range and checked history items stay mounted.');
      }
      await open(); let kept = await capture(), before = await stored(), count = writes;
      let held = await heldCatalog(copy); await changeOwner('account'); held.release(); await stopped(); await held.finish();
      assert.equal(writes, count); assert.deepEqual(await stored(), before); await assertKept(kept);
      pass('Copy also stops when the owner changes during its catalog refresh; no old historical text is copied.');

      // Explicit retry is possible after returning to the exact original owner and retained selection.
      await restoreSameOwner(); await copy(); await frame.locator('#dialog').waitFor({ state: 'hidden' });
      let after = await stored(), made = after.assets.filter(a => !before.assets.some(b => b.id === a.id));
      assert.equal(writes, count + 1); assert.equal(made.length, 1); assert.deepEqual(made[0].bundle, old.bundle);
      assert.deepEqual(after.assets.find(a => a.id === resource), before.assets.find(a => a.id === resource));
      pass('Returning to the same owner and explicitly retrying creates one separate historical copy; the current original stays exact on fresh server read.');

      await open(); kept = await capture(); before = await stored(); count = writes;
      await changeOwner('account'); await frame.getByRole('button', { name: '比较并恢复', exact: true }).click(); await stopped();
      assert.equal(await frame.locator('.wf-diffs').count(), 0); assert.equal(writes, count); assert.deepEqual(await stored(), before); await assertKept(kept);
      pass('An old historical selection cannot start a comparison after the owner has already changed; the original selection remains available.');

      await open(); kept = await capture(); before = await stored(); count = writes;
      held = await heldCatalog(() => frame.getByRole('button', { name: '比较并恢复', exact: true }).click());
      await changeOwner('account'); held.release(); await stopped(); await held.finish();
      assert.equal(await frame.locator('.wf-diffs').count(), 0); assert.equal(writes, count); assert.deepEqual(await stored(), before); await assertKept(kept);
      pass('Preparing a comparison stops after an owner change during its read, preserving the old selection without replacing the form.');

      for (const delayed of [false, true]) {
        await open(); await compare();
        const fields = await frame.locator('[data-wf-change]').elementHandles(); assert(fields.length);
        const checks = await Promise.all(fields.map(el => el.evaluate(e => ({ checked: e.checked, value: e.value }))));
        before = await stored(); count = writes;
        if (delayed) { held = await heldCatalog(apply); await changeOwner('account'); held.release(); }
        else { await changeOwner('viewer'); await apply(); }
        await stopped(); if (delayed) await held.finish();
        assert.equal(writes, count); assert.deepEqual(await stored(), before);
        assert.deepEqual(await Promise.all(fields.map(el => el.evaluate(e => ({ checked: e.checked, value: e.value })))), checks);
        assert((await Promise.all(fields.map(el => el.evaluate(e => e.isConnected && !e.disabled)))).every(Boolean));
        assert(await frame.locator('#dialog').isVisible());
        pass(delayed ? 'Confirmed comparison stops after an owner change during its final read, preserving checked differences.' : 'Confirmed comparison stops before its read when editing becomes readonly, preserving checked differences.');
      }

      // Existing conflict handling and one explicit successful retry remain usable under the original owner.
      await restoreSameOwner(); before = await stored(); count = writes;
      const conflict = route => route.request().method() === 'PUT' ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Given controlled recovery conflict' }) }) : route.fallback();
      await context.route(base + '/api/assets', conflict); await apply();
      await frame.locator('#toast').filter({ hasText: 'Given controlled recovery conflict' }).waitFor();
      assert.deepEqual(await stored(), before); assert(await frame.locator('#dialog').isVisible());
      assert.equal(await frame.locator('[data-wf-change]:checked').count(), await frame.locator('[data-wf-change]').count());
      await context.unroute(base + '/api/assets', conflict); await apply(); await frame.locator('#dialog').waitFor({ state: 'hidden' });
      after = await stored(); assert.equal(writes, count + 2); assert.deepEqual(after.assets.find(a => a.id === resource).bundle, old.bundle);
      assert.deepEqual(after.assets.filter(a => a.id !== resource), before.assets.filter(a => a.id !== resource));
      pass('A real409 retains the checked comparison and current catalog; one explicit retry restores only the selected original, leaving copies and other resources exact.');
      await page.screenshot({ path: O + '/' + width + '-saved-recovery-owner.png' });
      row.actualHostedAccountOrRoleVerified = false;
      row.originalBoardUnchanged = (await req('/api/boards/' + id)).value.nodes.length === 0;
      assert(row.originalBoardUnchanged);
      await context.close();
    }
    assert.deepEqual(proof.errors, []);
    proof.complete = true;
  } catch (error) { proof.failure = error.stack; process.exitCode = 1; }
  finally {
    for (const release of releases) release();
    if (browser) { await browser.close(); proof.ownedBrowserStopped = true; }
    if (proc && proc.exitCode === null) proc.kill();
    if (exited) proof.ownedServerExit = await exited;
    if (fd !== undefined) fs.closeSync(fd);
    if (base) {
      let closed = false;
      for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/health', { signal: AbortSignal.timeout(200) }); } catch { closed = true; break; } await new Promise(r => setTimeout(r, 100)); }
      proof.ownedPortClosed = closed;
      if (!closed) process.exitCode = 1;
    }
    save();
    console.log(JSON.stringify({ complete: proof.complete, observed: proof.observed, failure: proof.failure, ownedPortClosed: proof.ownedPortClosed }));
  }
})();
