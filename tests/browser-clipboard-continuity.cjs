const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert'), {spawn} = require('child_process'), {chromium} = require('playwright');

(async () => {
  const root = process.env.CREATIVE_BOARD_TEST_ROOT || path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-clipboard-continuity-'));
  const port=await require('./browser-port.cjs')();
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
    const response = await fetch(base + '/api/assets'), catalog = await response.json();
    catalog.folders = ['来源', '目标', '其他', '待删', '菜单目标'];
    catalog.folderIds = Object.fromEntries(catalog.folders.map((name, index) => [name, 'folder-' + index]));
    catalog.assets = [{id: 'source', title: '原始记录', folder: '来源', path: '', mime: 'application/x-creative-bundle',
      size: 0, tags: [], notes: '', bundle: {nodes: [{id: 'source-note', type: 'note', title: '原始记录',
        body: '保留作者提供的这句话。', x: 0, y: 0, w: 300, h: 160, sizeMode: 'auto'}], edges: []}}];
    assert((await fetch(base + '/api/assets', {method: 'PUT', headers: {'Content-Type': 'application/json',
      'If-Match': response.headers.get('ETag')}, body: JSON.stringify(catalog)})).ok);
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || undefined});
    const context = await browser.newContext({viewport: {width: 1400, height: 950}, permissions: ['clipboard-read', 'clipboard-write']});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => board && !loading);
    await page.evaluate(async () => {await showWorkspaceTab('assetPane'); await loadAssets(); window.actualClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);});
    const libraryFocus = () => page.locator('#assetPane').focus();
    const currentCatalog = () => fetch(base + '/api/assets').then(response => response.json());
    const caseName = process.env.CREATIVE_CLIPBOARD_CASE;

    async function holdMenuCopy() {
      await page.evaluate(() => {
        let held = false;
        window.finishClipboardWrite = null;
        navigator.clipboard.writeText = text => {
          if (held) return actualClipboardWrite(text);
          held = true;
          return new Promise(resolve => window.finishClipboardWrite = async () => {await actualClipboardWrite(text); resolve();});
        };
        showWorkspaceTab('assetPane'); enterAssetFolder('来源');
      });
      await page.locator('[data-asset=source]').click({button: 'right'});
      await page.locator('#fileContext button').filter({hasText: /^复制/}).click();
      await page.waitForFunction(() => !!window.finishClipboardWrite);
    }

    if (!caseName || caseName === 'fields') {
      for (const [cutting, tag] of [[false, 'textarea'], [true, 'textarea'], [false, 'input']]) {
        const selectedText = tag === 'textarea' ? '我选中的原文。\n下一行也要保留。' : '我选中的输入框原文。';
        await holdMenuCopy();
        await page.evaluate(({text, tag}) => {
          showDialog('<h2>临时输入</h2><' + tag + ' id="nativeCopyField"></' + tag + '>', [['关闭', () => $('dialog').close()]]);
          const field = $('nativeCopyField'); field.value = '开头。' + text + '结尾。';
          field.focus(); field.setSelectionRange(3, 3 + text.length);
        }, {text: selectedText, tag});
        await page.keyboard.press(cutting ? 'Control+x' : 'Control+c');
        assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), selectedText,
          'The browser first writes the actual selected field text');
        assert.equal(await page.locator('#nativeCopyField').inputValue(), cutting ? '开头。结尾。' : '开头。' + selectedText + '结尾。',
          'Copy leaves the field intact; cut performs ordinary native editing');
        await page.evaluate(() => {$('dialog').close(); enterAssetFolder('目标');});
        await libraryFocus();
        await page.evaluate(() => {
          window.actualLibraryPaste = whiteboardLibraryClipboard.paste;
          whiteboardLibraryClipboard.paste = (...args) => {
            window.fieldPaste = actualLibraryPaste(...args).then(() => ({ok: true}), error => ({ok: false, error: error.message}));
            return fieldPaste;
          };
        });
        await page.keyboard.press('Control+v');
        await page.waitForFunction(() => !!window.fieldPaste);
        await page.evaluate(() => finishClipboardWrite());
        const result = await page.evaluate(() => fieldPaste); assert(result.ok, result.error);
        assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), selectedText,
          'The older delayed menu copy must not overwrite newer field text');
        const newest = (await currentCatalog()).assets.at(-1);
        assert.equal(newest.bundle.nodes[0].body.replace(/\r\n/g, '\n'), selectedText,
          'An immediate library paste stores the selected text, not the older library atom');
        await page.evaluate(() => {navigator.clipboard.writeText = actualClipboardWrite; whiteboardLibraryClipboard.paste = actualLibraryPaste; window.fieldPaste = null;});
      }
      console.log('Native field clipboard: delayed menu writes preserve newer copy/cut text and ordinary editing');
    }

    if (!caseName || caseName === 'folders') {
      const other = await context.newPage(); other.on('pageerror', error => errors.push(error.message));
      await other.goto(base + '/index.html'); await other.waitForFunction(() => board && !loading);
      async function copySource(destination) {
        await page.evaluate(async () => {await showWorkspaceTab('assetPane'); await loadAssets(); enterAssetFolder('来源');});
        await page.locator('[data-asset=source]').click(); await page.keyboard.press('Control+c');
        await page.evaluate(destination => enterAssetFolder(destination), destination); await libraryFocus();
      }
      async function delayedPaste(destination) {
        await copySource(destination);
        let arrived, release;
        const arrival = new Promise(resolve => arrived = resolve);
        const handler = async route => {
          if (route.request().method() === 'GET' && !release) await new Promise(resolve => {release = resolve; arrived();});
          await route.continue();
        };
        await page.route('**/api/assets', handler);
        await page.evaluate(() => {
          window.actualLibraryPaste = whiteboardLibraryClipboard.paste;
          whiteboardLibraryClipboard.paste = (...args) => {
            window.destinationPaste = actualLibraryPaste(...args).then(() => ({ok: true}), error => ({ok: false, error: error.message}));
            return destinationPaste;
          };
        });
        await page.keyboard.press('Control+v');
        await Promise.race([arrival, page.evaluate(() => destinationPaste).then(result => {throw Error(result.error || 'Paste finished before the expected catalog read');})]);
        return async () => {
          release(); const result = await page.evaluate(() => destinationPaste);
          await page.unroute('**/api/assets', handler);
          await page.evaluate(() => {whiteboardLibraryClipboard.paste = actualLibraryPaste;});
          return result;
        };
      }
      const finishRename = await delayedPaste('目标');
      await other.evaluate(async () => {
        await loadAssets(); await moveAssetFolder('目标', '', '改名后的目标');
        const next = clone(assetIndex); next.folders.push('目标'); await saveAssets(next);
      });
      await page.evaluate(() => enterAssetFolder('其他'));
      const renamedResult = await finishRename(); assert(renamedResult.ok, renamedResult.error);
      const renamed = (await currentCatalog()).assets.at(-1);
      assert.equal(renamed.folder, '改名后的目标', 'A paste follows its original folder identity, not a replacement with the old name');
      assert.equal(await page.evaluate(() => assetFolder), '其他', 'Finishing paste must not interrupt later navigation');
      assert.equal((await currentCatalog()).folderIds['改名后的目标'], 'folder-1');
      assert.notEqual((await currentCatalog()).folderIds['目标'], 'folder-1');

      const countBeforeDeletion = (await currentCatalog()).assets.length;
      const finishDeleted = await delayedPaste('待删');
      await other.evaluate(async () => {
        await loadAssets(); assetFolderPick = '待删'; assetSelected.clear(); await deleteExplorer('asset');
        const next = clone(assetIndex); next.folders.push('待删'); await saveAssets(next);
      });
      const deletedResult = await finishDeleted(); assert.equal(deletedResult.ok, false,
        'A recreated folder cannot receive a paste addressed to its deleted predecessor');
      assert.equal((await currentCatalog()).assets.length, countBeforeDeletion);
      assert.equal((await currentCatalog()).assets.find(asset => asset.id === 'source').folder, '来源');
      assert.notEqual((await currentCatalog()).folderIds['待删'], 'folder-3');

      await copySource('菜单目标');
      const menuText = await page.evaluate(() => navigator.clipboard.readText());
      await page.evaluate(() => {window.actualClipboardRead = navigator.clipboard.readText.bind(navigator.clipboard); window.finishClipboardRead = null;
        navigator.clipboard.readText = () => new Promise(resolve => window.finishClipboardRead = resolve);});
      await page.locator('#assetList').click({button: 'right'});
      await page.locator('#fileContext button').filter({hasText: /^粘贴/}).click();
      await page.waitForFunction(() => !!window.finishClipboardRead);
      await other.evaluate(async () => {
        await loadAssets(); await moveAssetFolder('菜单目标', '', '菜单目标已改名');
        const next = clone(assetIndex); next.folders.push('菜单目标'); await saveAssets(next);
      });
      await page.evaluate(() => enterAssetFolder('其他'));
      await page.evaluate(text => finishClipboardRead(text), menuText);
      await page.waitForFunction(() => assetIndex.assets.some(asset => asset.folder === '菜单目标已改名'));
      assert.equal((await currentCatalog()).assets.at(-1).folder, '菜单目标已改名',
        'A menu paste captures the destination before reading the system clipboard');
      assert.equal(await page.evaluate(() => assetFolder), '其他');
      await page.evaluate(() => {navigator.clipboard.readText = actualClipboardRead;});
      await other.close();
      console.log('Clipboard destinations: delayed reads, remote rename, same-name replacement, deletion and later navigation');
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
