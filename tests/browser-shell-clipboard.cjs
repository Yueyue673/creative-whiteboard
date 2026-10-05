const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert'), {spawn} = require('child_process'), {chromium} = require('playwright');

(async () => {
  const root = process.env.CREATIVE_BOARD_TEST_ROOT || path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-shell-clipboard-'));
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
    for (const [id, name] of [['a', '起点'], ['b', '终点']]) {
      const value = {format: 'creative-board', version: 1, name, folder: '',
        nodes: id === 'a' ? [{id: 'newer', type: 'note', title: '后来复制的记录', body: '这段原文来自白板。',
          x: 80, y: 120, w: 320, h: 180, sizeMode: 'auto'}] : [], edges: [], view: {x: 0, y: 0, z: 1}};
      assert((await fetch(base + '/api/boards/' + id, {method: 'PUT', headers: {'Content-Type': 'application/json', 'If-Match': 'new'}, body: JSON.stringify(value)})).ok);
    }
    const response = await fetch(base + '/api/assets'), catalog = await response.json();
    catalog.folders = ['来源']; catalog.folderIds = {'来源': 'source-folder'};
    catalog.assets = [{id: 'source', title: '较早的记录', folder: '来源', path: '', mime: 'application/x-creative-bundle',
      size: 0, tags: [], notes: '', bundle: {nodes: [{id: 'source-note', type: 'note', title: '较早的记录',
        body: '这段原文来自内容库。', x: 0, y: 0, w: 300, h: 160, sizeMode: 'auto'}], edges: []}}];
    assert((await fetch(base + '/api/assets', {method: 'PUT', headers: {'Content-Type': 'application/json',
      'If-Match': response.headers.get('ETag')}, body: JSON.stringify(catalog)})).ok);
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || undefined});
    const context = await browser.newContext({viewport: {width: 1500, height: 950}, permissions: ['clipboard-read', 'clipboard-write']});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => model.tabs.length === 1 && frames.values().next().value?.contentWindow.whiteboardPane?.state().boardId);
    async function open(name) {
      await page.locator('.add-tab[data-side=left]').click();
      await page.locator('#boardChoices').getByRole('button', {name: new RegExp(name)}).click();
      await page.waitForFunction(name => {const tab = model.tabs.find(tab => tab.name === name); return tab && frames.get(tab.id)?.contentWindow.whiteboardPane?.state().boardId === tab.boardId;}, name);
    }
    await open('起点'); await open('终点');
    const a = page.frames().find(frame => new URL(frame.url()).searchParams.get('board') === 'a');
    const b = page.frames().find(frame => new URL(frame.url()).searchParams.get('board') === 'b');
    await page.locator('#openBoards').click();
    await page.waitForFunction(() => !!whiteboardWorkspace.explorer());
    const explorer = page.frames().find(frame => new URL(frame.url()).searchParams.get('explorer') === '1');
    await explorer.locator('#assetsButton').click();
    await explorer.evaluate(async () => {await loadAssets(); enterAssetFolder('来源');});

    // Delay the actual OS write in both possible owners. This exercises real
    // explorer/canvas frames rather than several regions in one core document.
    await page.evaluate(() => {
      window.actualClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      window.holdWrite = text => {
        if (window.finishClipboardWrite) return actualClipboardWrite(text);
        return new Promise(resolve => window.finishClipboardWrite = async () => {await actualClipboardWrite(text); resolve();});
      };
      navigator.clipboard.writeText = holdWrite;
    });
    await explorer.evaluate(() => {window.actualClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = text => parent.holdWrite(text);});
    await explorer.locator('[data-asset=source]').click({button: 'right'});
    await explorer.locator('#fileContext button').filter({hasText: /^复制/}).click();
    await page.waitForFunction(() => !!window.finishClipboardWrite);
    await page.locator('#openBoards').click();
    await page.waitForFunction(() => document.getElementById('globalExplorer').hidden);
    await page.getByRole('tab', {name: '起点', exact: true}).click();
    await a.locator('[data-id=newer]').click({position: {x: 70, y: 60}});
    await page.keyboard.press('Control+c');
    await page.getByRole('tab', {name: '终点', exact: true}).click();
    await page.keyboard.press('Control+v');
    await page.evaluate(() => finishClipboardWrite());
    await b.waitForFunction(() => board.nodes.length === 1);
    await b.evaluate(() => whiteboardLibraryClipboard.ready());
    assert.equal(await b.evaluate(() => board.nodes[0].body), '这段原文来自白板。', 'Immediate cross-frame paste uses the newest native board copy');
    const finalText = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(JSON.parse(finalText).nodes[0].body, '这段原文来自白板。', 'An earlier explorer menu write must not overwrite a newer canvas copy');
    console.log('Shell clipboard: shared explorer and separate canvas frames preserve the latest copy');

    async function holdLibraryCopy() {
      await page.evaluate(() => {window.finishClipboardWrite = null;});
      if (await page.locator('#globalExplorer').isHidden()) await page.locator('#openBoards').click();
      await explorer.evaluate(async () => {await showWorkspaceTab('assetPane'); await loadAssets(); enterAssetFolder('来源');});
      await explorer.locator('[data-asset=source]').click({button: 'right'});
      await explorer.locator('#fileContext button').filter({hasText: /^复制/}).click();
      await page.waitForFunction(() => !!window.finishClipboardWrite);
      await page.locator('#openBoards').click();
      await page.waitForFunction(() => document.getElementById('globalExplorer').hidden);
      await page.getByRole('tab', {name: '终点', exact: true}).click();
    }
    async function finishPaste(expectedBody, beforeCount) {
      await page.evaluate(() => finishClipboardWrite());
      await b.waitForFunction(count => board.nodes.length === count + 1, beforeCount);
      assert.equal(await b.evaluate(() => board.nodes.at(-1).body.replace(/\r\n/g, '\n')), expectedBody);
      await b.evaluate(() => whiteboardLibraryClipboard.ready());
    }
    await page.evaluate(() => actualClipboardWrite('之前的文字。'));
    await holdLibraryCopy();
    const beforeLibraryPaste = await b.evaluate(() => board.nodes.length);
    await page.keyboard.press('Control+v');
    await finishPaste('这段原文来自内容库。', beforeLibraryPaste);
    assert.equal(await b.evaluate(() => board.nodes.at(-1).libraryOrigin.id), 'source', 'A pending shared-explorer copy is awaited by a canvas paste');

    for (const cutting of [false, true]) {
      await holdLibraryCopy();
      const text = cutting ? '剪切的原文。' : '后来复制的输入框原文。';
      await b.evaluate(text => {
        showDialog('<h2>临时输入</h2><textarea id="nativeTextField"></textarea>', [['关闭', () => $('dialog').close()]]);
        const field = $('nativeTextField'); field.value = '开头。' + text + '结尾。'; field.focus(); field.setSelectionRange(3, 3 + text.length);
      }, text);
      await page.keyboard.press(cutting ? 'Control+x' : 'Control+c');
      assert.equal(await b.locator('#nativeTextField').inputValue(), cutting ? '开头。结尾。' : '开头。' + text + '结尾。');
      await b.evaluate(() => {$('dialog').close(); canvas.focus();});
      const beforeFieldPaste = await b.evaluate(() => board.nodes.length);
      await page.keyboard.press('Control+v');
      await finishPaste(text, beforeFieldPaste);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text, 'Native field copy/cut supersedes an older write in another frame');
    }
    console.log('Shell clipboard: immediate menu paste and cross-frame native field copy/cut');

    for (const [cutting, editable] of [[false, true], [true, true], [false, false]]) {
      await holdLibraryCopy();
      if (cutting) await page.evaluate(() => {
        window.actualPermissionQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = descriptor => descriptor.name === 'clipboard-read' ? Promise.resolve({state: 'prompt'}) : actualPermissionQuery(descriptor);
      });
      await b.evaluate(editable => {
        showDialog('<h2>临时文档</h2><div id="nativeRichField" ' + (editable ? 'contenteditable="true"' : 'tabindex="0"') + '><p><strong>加粗记录</strong>与普通文字。</p></div>', [['关闭', () => $('dialog').close()]]);
        const field = $('nativeRichField'); field.focus();
        const range = document.createRange(); range.selectNodeContents(field);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }, editable);
      await page.keyboard.press(cutting ? 'Control+x' : 'Control+c');
      assert.equal(await b.locator('#nativeRichField').textContent(), cutting ? '' : '加粗记录与普通文字。', 'Native document cut edits only its selected content');
      await b.evaluate(() => {$('dialog').close(); getSelection().removeAllRanges(); canvas.focus();});
      const beforeRichPaste = await b.evaluate(() => board.nodes.length);
      await page.keyboard.press('Control+v');
      await finishPaste('加粗记录与普通文字。', beforeRichPaste);
      const rich = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find(item => item.types.includes('text/html'));
        return item ? (await item.getType('text/html')).text() : '';
      });
      assert(rich.includes('加粗记录') && /<(?:b|strong)\b|font-weight:\s*(?:bold|700)/i.test(rich), 'Repairing a newer native document copy preserves its HTML formatting');
      if (cutting) await page.evaluate(() => {navigator.permissions.query = actualPermissionQuery;});
    }
    console.log('Shell clipboard: document copy/cut, read-only selections and rich formatting; no extra read permission required');

    // Clipboard work belongs to the shell even if its source tab goes away.
    await page.evaluate(() => {window.finishClipboardWrite = null;});
    await page.getByRole('tab', {name: '起点', exact: true}).click();
    await a.locator('[data-id=newer]').click({button: 'right'});
    await a.locator('#fileContext button').filter({hasText: /^复制内容/}).click();
    await page.waitForFunction(() => !!window.finishClipboardWrite);
    await page.getByRole('button', {name: '关闭标签：起点', exact: true}).click();
    await page.waitForFunction(() => !model.tabs.some(tab => tab.boardId === 'a'));
    await page.getByRole('tab', {name: '终点', exact: true}).click();
    const beforeClosedSource = await b.evaluate(() => board.nodes.length);
    await page.keyboard.press('Control+v');
    await finishPaste('这段原文来自白板。', beforeClosedSource);
    assert.equal(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).nodes[0].body, '这段原文来自白板。');
    assert((await fetch(base + '/api/boards/a')).ok, 'Closing a source tab preserves its saved board');
    console.log('Shell clipboard: closing the source tab does not abandon pending copy/paste');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.kill(); await new Promise(resolve => server.once('exit', resolve));
    const resolved = path.resolve(temporary);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
