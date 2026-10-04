const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-edit-history-'));
  const port = await new Promise(resolve => {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
  const base = 'http://127.0.0.1:' + port;
  const proc = spawn(process.env.PYTHON || 'python', [root + '/server.py'], {
    env: {...process.env, CREATIVE_BOARD_PORT: String(port), CREATIVE_BOARD_DATA_DIR: tmp, PYTHONIOENCODING: 'utf-8'},
    windowsHide: true
  });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const wav = Buffer.alloc(44 + 32000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    const sound = await (await fetch(base + '/api/assets/upload', {
      method: 'POST', headers: {'X-File-Name': 'sound.wav'}, body: wav
    })).json();
    browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined, headless: true});
    const page = await browser.newPage({viewport: {width: 1550, height: 1050}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => board && !loading && window.whiteboardReading);
    await page.evaluate(() => loadAssets());
    await page.evaluate(sound => {
      board.nodes = [
        {id: 'note', type: 'note', sizeMode: 'manual', title: '作者的观察', body: '作者原文。', annotation: '原来的备注。', tags: ['观察'], x: 30, y: 40, w: 340, h: 300},
        {id: 'table', type: 'table', title: '作者的表格', body: '', columns: ['画面', '声音'], rows: [['第一格原文。', '']], cellImages: [[[], []]], cellItems: [[[{id: 'cell-note', type: 'note', title: '格内标题', body: '格内原文。'}], []]], tags: [], x: 440, y: 40, w: 740, h: 360},
        {id: 'sound', type: 'note', title: '作者的声音观察', body: '', mediaId: sound.id, mediaTimeline: {['/api/media/' + sound.id]: {markers: [{id: 'mark', time: .5, title: '原标记', note: '原标记的备注。'}], startMarkerId: null}}, tags: [], x: 30, y: 470, w: 360, h: 160}
      ];
      board.edges = []; board.view = {x: 0, y: 0, z: 1};
      selected = new Set(['note']); editorId = null; render();
      history = []; future = [];
      duplicate(); undo();
    }, sound);
    const state = () => page.evaluate(() => ({history: history.length, future: future.length, revision: contentRevision}));
    const baseline = await state();
    assert.equal(baseline.future, 1);

    await page.evaluate(() => openEditor('note'));
    for (const id of ['title', 'body', 'annotation']) {
      await page.locator('#' + id).focus();
      await page.locator('#' + id).fill(await page.locator('#' + id).inputValue());
    }
    await page.locator('#inlineDetails').click();
    await page.locator('#tags').focus();
    await page.locator('#tags').fill('观察');
    await page.locator('#url').focus();
    await page.locator('#inlineMetaClose').click();
    await page.locator('#inlineDone').click();
    assert.deepEqual(await state(), baseline, 'Focusing or re-entering unchanged note fields preserves undo and redo');

    await page.evaluate(() => openEditor('table'));
    for (const selector of ['[data-column="0"]', '[data-row="0"][data-col="0"]', '[data-cell-note-field=title]', '[data-cell-note-field=body]']) {
      const field = page.locator(selector);
      await field.focus(); await field.fill(await field.inputValue());
    }
    await page.locator('#inlineDone').click();
    assert.deepEqual(await state(), baseline, 'Visiting table and nested content fields preserves previous history');

    await page.locator('[data-id=sound] .media-marker-toggle').click();
    await page.locator('.media-marker-title').focus();
    await page.locator('.media-marker-note').focus();
    await page.locator('.media-marker-note').fill('原标记的备注。');
    await page.keyboard.press('Escape');
    assert.deepEqual(await state(), baseline, 'Marker inspection without editing preserves redo');
    console.log('只查看或切换便签、表格、格内内容、时间标记字段：不增加撤销，不清除重做，不触发保存，通过');

    await page.evaluate(() => {canvas.focus();});
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => board.nodes.length), 4, 'Redo still works after visiting every editor');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => board.nodes.length), 3);

    await page.evaluate(() => openEditor('note'));
    await page.locator('#title').fill('作者后来修改的标题');
    await page.locator('#title').press('End');
    await page.keyboard.insertText('，继续补充');
    await page.locator('#body').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'note').title), '作者的观察', 'One undo restores a continuous field edit despite visiting an unchanged field afterwards');

    await page.evaluate(() => openEditor('table'));
    await page.locator('[data-row="0"][data-col="0"]').fill('作者修改的第一格。');
    await page.locator('[data-row="0"][data-col="1"]').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'table').rows[0][0]), '第一格原文。');
    await page.evaluate(() => openEditor('table'));
    await page.locator('[data-cell-note-field=body]').fill('作者修改格内原文。');
    await page.locator('[data-column="1"]').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => board.nodes.find(n => n.id === 'table').cellItems[0][0][0].body), '格内原文。');

    await page.locator('[data-id=sound] .media-marker-toggle').click();
    await page.locator('.media-marker-note').fill('作者修改标记的备注。');
    await page.locator('.media-marker-title').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => Object.values(board.nodes.find(n => n.id === 'sound').mediaTimeline)[0].markers[0].note), '原标记的备注。');
    console.log('实际编辑后再查看其他字段：便签、表格、格内内容、时间标记均可一次撤销实际修改，通过');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    proc.kill(); await new Promise(resolve => proc.once('exit', resolve));
    const resolved = path.resolve(tmp);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
