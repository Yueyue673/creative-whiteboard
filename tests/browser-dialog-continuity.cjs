const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert'), {spawn} = require('child_process'), {chromium} = require('playwright');

(async () => {
  const root = process.env.CREATIVE_BOARD_TEST_ROOT || path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-preview-continuity-'));
  const port = await new Promise(resolve => {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1', () => {const port = socket.address().port; socket.close(() => resolve(port));});
  });
  const base = 'http://127.0.0.1:' + port;
  const server = spawn(process.env.PYTHON || 'python', [path.join(root, 'server.py')], {
    windowsHide: true,
    env: {...process.env, CREATIVE_BOARD_PORT: String(port), CREATIVE_BOARD_DATA_DIR: temporary, PYTHONIOENCODING: 'utf-8'}
  });
  let browser;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {if ((await fetch(base + '/api/health')).ok) break;} catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    async function upload(name, body) {
      const response = await fetch(base + '/api/assets/upload', {method: 'POST', headers: {'X-File-Name': name}, body});
      assert(response.ok); return response.json();
    }
    const first = await upload('first.html', '<!doctype html><html><body><p id="marker">第一次查阅</p></body></html>');
    const second = await upload('second.html', '<!doctype html><html><body><p id="marker">第二次查阅</p></body></html>');
    const stale = await upload('stale.json', JSON.stringify({记录: '较早读取的内容。'}));
    const fresh = await upload('fresh.json', JSON.stringify({记录: '当前读取的内容。'}));
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || undefined});
    const page = await browser.newPage({viewport: {width: 1450, height: 950}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => board && !loading);
    await page.evaluate(async () => {await loadAssets();});
    const settleClose = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const caseName = process.env.CREATIVE_PREVIEW_CASE;

    if (!caseName || caseName === 'html') {
      await page.evaluate(id => previewAsset(id), first.id);
      await page.locator('#htmlDocument').contentFrame().locator('#marker').waitFor();
      await page.evaluate(async id => {$('dialog').close(); await previewAsset(id);}, second.id);
      await settleClose();
      assert.equal(await page.locator('#htmlDocument').count(), 1, 'Closing an older preview must not remove the new HTML frame');
      assert.equal(await page.locator('#htmlDocument').contentFrame().locator('#marker').textContent(), '第二次查阅');
      assert(await page.locator('#dialog').evaluate(dialog => dialog.open && dialog.classList.contains('document-dialog')),
        'The new document retains its own layout after queued close events');
      await page.evaluate(id => previewAsset(id), first.id);
      assert.equal(await page.locator('#htmlDocument').count(), 1, 'Replacing the contents of an open reader cleans up only its old frame');
      await page.evaluate(async id => {HTMLDialogElement.prototype.close.call($('dialog')); await previewAsset(id);}, second.id);
      await settleClose();
      assert.equal(await page.locator('#htmlDocument').count(), 1, 'Native close followed by reopen cannot remove the newer frame');
      assert.equal(await page.locator('#htmlDocument').contentFrame().locator('#marker').textContent(), '第二次查阅');
      await page.evaluate(() => {$('dialog').close(); showDialog('<h2>普通窗口</h2><textarea id="ordinaryField"></textarea>', [['关闭', () => $('dialog').close()]]);});
      await settleClose();
      assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.classList.contains('document-dialog')), false,
        'A normal form does not inherit the document-reader layout');
      await page.locator('#ordinaryField').fill('自己的输入仍可继续。');
      assert.equal(await page.locator('#ordinaryField').inputValue(), '自己的输入仍可继续。');
      await page.evaluate(() => $('dialog').close()); await settleClose();
      console.log('Preview continuity: rapid HTML close/reopen and transitions into ordinary forms');
    }

    if (!caseName || caseName === 'json') {
      for (const failing of [false, true]) {
        let arrived, release;
        const arrival = new Promise(resolve => arrived = resolve);
        const gate = new Promise(resolve => release = resolve);
        const handler = async route => {
          arrived(); await gate;
          await route.fulfill({status: failing ? 503 : 200, contentType: 'application/json',
            body: failing ? JSON.stringify({error: '模拟旧文件读取失败'}) : JSON.stringify({记录: '较早读取的内容。'})});
        };
        await page.route('**/api/media/' + stale.id, handler);
        await page.evaluate(id => {fullJSONCache.delete(id); window.stalePreview = previewAsset(id);}, stale.id);
        await arrival;
        await page.evaluate(async id => {$('dialog').close(); await previewAsset(id);}, fresh.id);
        await settleClose();
        const status = await page.locator('#documentState').textContent();
        const content = await page.locator('#documentView').textContent();
        assert(content.includes('当前读取的内容。'));
        release(); await page.evaluate(() => stalePreview);
        assert.equal(await page.locator('#documentState').textContent(), status, 'A stale JSON success or failure cannot change the new preview status');
        assert.equal(await page.locator('#documentView').textContent(), content, 'The newer JSON remains intact after the old read finishes');
        await page.unroute('**/api/media/' + stale.id, handler);
        await page.evaluate(() => $('dialog').close()); await settleClose();
      }
      console.log('Preview continuity: older JSON success/failure leaves the current document and status intact');
    }

    if (!caseName || caseName === 'search') {
      await page.evaluate(() => {wfOpenSearch(); $('dialog').close(); wfOpenSearch();
        $('wfSearchQuery').value = 'fresh.json'; $('wfSearchQuery').dispatchEvent(new Event('input'));});
      await settleClose();
      assert(await page.locator('#dialog').evaluate(dialog => dialog.open && dialog.classList.contains('wf-dialog')),
        'The old search close event must leave the new search layout intact');
      await page.locator('#wfSearchResults .wf-result').waitFor();
      assert((await page.locator('#wfSearchResults').textContent()).includes('fresh.json'),
        'The old search cleanup must not cancel the new search timer');
      await page.evaluate(() => $('dialog').close()); await settleClose();
      console.log('Preview continuity: rapid search reopen preserves layout and the pending query');
    }

    if (!caseName || caseName === 'search-read') {
      for (const failing of [false, true]) {
        let arrived, release;
        const arrival = new Promise(resolve => arrived = resolve), gate = new Promise(resolve => release = resolve);
        const handler = async route => {arrived(); await gate;
          await route.fulfill({status: failing ? 503 : 200, contentType: 'application/json',
            body: JSON.stringify(failing ? {error: '模拟旧搜索失败'} : {results: [], total: 0})});};
        await page.route('**/api/search?q=stale-query', handler);
        await page.evaluate(() => {wfOpenSearch(); $('wfSearchQuery').value = 'stale-query'; window.oldSearch = wfRunSearch();});
        await arrival;
        await page.evaluate(async () => {$('dialog').close(); wfOpenSearch(); $('wfSearchQuery').value = 'fresh.json'; await wfRunSearch();});
        await settleClose();
        const status = await page.locator('#wfSearchStatus').textContent(), content = await page.locator('#wfSearchResults').textContent();
        assert(content.includes('fresh.json'));
        release(); await page.evaluate(() => oldSearch);
        assert.equal(await page.locator('#wfSearchStatus').textContent(), status, 'Old search success/failure must not change the current status');
        assert.equal(await page.locator('#wfSearchResults').textContent(), content, 'Old search results must not replace the current query');
        await page.unroute('**/api/search?q=stale-query', handler);
        await page.evaluate(() => $('dialog').close()); await settleClose();
      }
      console.log('Preview continuity: old search requests cannot replace the new query or its status');
    }

    if (!caseName || caseName === 'immersion') {
      await page.evaluate(() => {
        const note = id => ({id, type: 'note', title: id, body: '独立工作区的测试内容。', color: '#fff0aa',
          x: id === 'first-note' ? 70 : 570, y: 80, w: 400, h: 260});
        board.nodes = [note('first-note'), note('second-note')]; board.edges = []; render();
        whiteboardReading.open('first-note'); $('dialog').close(); whiteboardReading.open('second-note');
      });
      await settleClose();
      assert.equal(await page.locator('#immersiveSurface #body').count(), 1,
        'An old close event must not move the new immersive editor back to the canvas');
      assert(await page.evaluate(() => whiteboardReading.isEditing()));
      await page.locator('#immersiveSurface #body').fill('第二个窗口里的手动修改。');
      await page.keyboard.press('Escape'); await settleClose();
      assert.equal(await page.evaluate(() => whiteboardReading.isEditing()), false);
      assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'second-note').body), '第二个窗口里的手动修改。');
      console.log('Preview continuity: rapid immersive editing reopen preserves the new editor and its changes');
    }

    if (!caseName || caseName === 'review') {
      await page.evaluate(() => {
        window.appliedReview = 0;
        window.reviewGate = new Promise(resolve => window.finishReview = resolve);
        wfReview('确认更新测试', '只使用独立工作区的通用内容。', [{field: 'title', before: '原标题', after: '更新后的标题'}],
          async () => {window.appliedReview++; await reviewGate; return true;});
      });
      await page.getByRole('button', {name: '应用勾选的修改', exact: true}).click();
      await page.waitForFunction(() => appliedReview === 1);
      await page.evaluate(() => {$('dialog').close(); showDialog('<h2>接着编辑自己的内容</h2><textarea id="nextReviewField"></textarea>',
        [['关闭', () => $('dialog').close()]]);});
      await page.locator('#nextReviewField').fill('这一段手动输入要保留。');
      await page.evaluate(() => finishReview()); await settleClose();
      assert(await page.locator('#dialog').evaluate(dialog => dialog.open), 'A finished older approval must not close a newer form');
      assert.equal(await page.locator('#nextReviewField').inputValue(), '这一段手动输入要保留。');
      await page.evaluate(() => $('dialog').close()); await settleClose();
      console.log('Preview continuity: completing an old approval preserves a newly opened form and manual input');
    }

    if (!caseName || caseName === 'review-repeat') {
      await page.evaluate(() => {
        window.appliedReview = 0;
        window.reviewGate = new Promise(resolve => window.finishReview = resolve);
        wfReview('确认一次更新', '等待期间的重复点击只执行一次。', [{field: 'title', before: '原标题', after: '更新后的标题'}],
          async () => {window.appliedReview++; await reviewGate; return true;});
        const button = [...$('dialogActions').querySelectorAll('button')].find(b => b.textContent === '应用勾选的修改');
        button.click(); button.click();
      });
      await settleClose();
      assert.equal(await page.evaluate(() => appliedReview), 1, 'Repeated approval cannot start duplicate writes while the first is pending');
      assert(await page.getByRole('button', {name: '应用勾选的修改', exact: true}).isDisabled());
      assert(await page.locator('[data-wf-change="0"]').isDisabled(), 'Submitted choices remain fixed while the update is pending');
      assert(await page.getByRole('button', {name: '关闭', exact: true}).isVisible(), 'The pending update can be dismissed without claiming to cancel an already submitted write');
      await page.evaluate(() => finishReview()); await settleClose();
      assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), false);
      console.log('Preview continuity: repeated approval starts only one update');
    }

    if (!caseName || caseName === 'review-retry') {
      await page.evaluate(() => {
        window.reviewAttempts = 0;
        wfReview('失败后重试', '勾选的项目与自己的判断继续保留。',
          [{field: 'title', before: '原标题', after: '新标题'}, {field: 'body', before: '原文', after: '自己的修改'}],
          async picked => {window.reviewAttempts++; window.lastApprovedFields = picked.map(c => c.field);
            if (reviewAttempts === 1) throw Error('模拟保存失败');
            if (reviewAttempts === 2) return false;
            return true;});
      });
      await page.locator('[data-wf-change="1"]').uncheck();
      const approve = page.getByRole('button', {name: '应用勾选的修改', exact: true});
      for (let attempt = 1; attempt <= 2; attempt++) {
        await approve.click(); await page.waitForFunction(expected => reviewAttempts === expected, attempt);
        await page.waitForFunction(() => ![...$('dialogActions').querySelectorAll('button')].find(b => b.textContent === '应用勾选的修改').disabled);
        assert(await page.locator('#dialog').evaluate(dialog => dialog.open));
        assert.equal(await page.locator('[data-wf-change="1"]').isChecked(), false, 'Retry keeps the author\'s chosen fields');
        assert(await page.locator('[data-wf-change="1"]').isEnabled(), 'Failure permits editing the choices before retry');
        assert.deepEqual(await page.evaluate(() => lastApprovedFields), ['title']);
        assert(await page.getByRole('button', {name: '取消', exact: true}).isVisible());
      }
      await approve.click(); await page.waitForFunction(() => !$('dialog').open);
      assert.equal(await page.evaluate(() => reviewAttempts), 3);
      console.log('Preview continuity: failed or rejected updates preserve field choices and allow retry');
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.kill(); await new Promise(resolve => server.once('exit', resolve));
    const resolved = path.resolve(temporary);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
