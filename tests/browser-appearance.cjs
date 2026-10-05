const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert'), {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-appearance-'));
  const port = await new Promise(resolve => {const socket = net.createServer();
    socket.listen(0, '127.0.0.1', () => {const value = socket.address().port; socket.close(() => resolve(value));});});
  const base = 'http://127.0.0.1:' + port;
  const server = spawn(process.env.PYTHON || 'python', [path.join(root, 'server.py')], {windowsHide: true,
    env: {...process.env, CREATIVE_BOARD_PORT: String(port), CREATIVE_BOARD_DATA_DIR: temporary, PYTHONIOENCODING: 'utf-8'}});
  let browser;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {if ((await fetch(base + '/api/health')).ok) break;} catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || undefined});
    const page = await browser.newPage({viewport: {width: 1400, height: 940}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/index.html'); await page.waitForFunction(() => board && !loading && window.whiteboardAppearance);
    await page.evaluate(async () => {
      board.nodes = [{id: 'own-note', type: 'note', title: '自己的观察', body: '这段内容由使用者保留。',
        x: 50, y: 90, w: 380, h: 240, color: '#fff0aa'}]; render();
      await showWorkspaceTab('assetPane');
    });
    async function contrast(selector, backgroundSelector, foregroundProperty = 'color') {
      return page.locator(selector).first().evaluate((element, {backgroundSelector, foregroundProperty}) => {
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = value => rgb(value).map(c => {c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;})
          .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        let background = backgroundSelector ? document.querySelector(backgroundSelector) : element;
        while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
        const color = getComputedStyle(element)[foregroundProperty], fill = getComputedStyle(background).backgroundColor;
        const a = luminance(color), b = luminance(fill);
        return {ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), color, fill};
      }, {backgroundSelector, foregroundProperty});
    }
    const panels = ['#ffffff', '#090b0e', '#777777', '#aeb7b4', '#d4c4aa', '#315b70', '#537f62'];
    for (const panel of panels) {
      for (const preset of ['resolve', 'paper', 'slate']) {
        await page.evaluate(({preset, panel}) => whiteboardAppearance.apply({preset, custom: {panel, canvas: '#ffffff', accent: panel}, note: '#fff0aa'}), {preset, panel});
        for (const [selector, background] of [['#assetCount', '#workspaceSidebar'], ['.explorer-empty', '#workspaceSidebar'], ['#assetSearch'],
          ['.workspace-tabs button.current'], ['#creationDock button', '#creationDock']]) {
          const result = await contrast(selector, background);
          assert(result.ratio >= 4.5, `${preset} / ${panel} / ${selector}: ${JSON.stringify(result)}`);
        }
        const hint = await contrast('#hint', '#canvas');
        assert(hint.ratio >= 4.5, 'Canvas hints stay legible when the canvas and interface use different tones');
        await page.locator('#assetSearch').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        const focus = await contrast('#assetSearch', '#workspaceSidebar', 'outlineColor');
        assert(focus.ratio >= 3, 'The keyboard focus remains visible even when the accent matches the panel');
        assert.equal(await page.locator('#assetSearch').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
        assert.equal(await page.locator('[data-id="own-note"]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 240, 170)',
          'Interface customisation must not recolour authored notes');
      }
    }
    await page.evaluate(() => {whiteboardAppearance.apply({preset: 'paper', custom: {panel: '#0b0e13', canvas: '#ffffff'}, note: '#fff0aa'}, true);
      showDialog('<h2>资料阅读</h2><div id="themeJSON"></div>', [['关闭', () => $('dialog').close()]]);
      renderJSONReader($('themeJSON'), {value: {说明: '保持资料可读'}, raw: '{"说明":"保持资料可读"}'});});
    const chosen = await contrast('#themeJSON .chosen'); assert(chosen.ratio >= 4.5);
    assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'dark');
    await page.evaluate(() => $('dialog').close());
    await page.reload(); await page.waitForFunction(() => board && !loading && window.whiteboardAppearance);
    assert.equal(await page.evaluate(() => whiteboardAppearance.read().custom.panel), '#0b0e13');
    assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'dark');
    const saved = await contrast('#assetSearch'); assert(saved.ratio >= 4.5);
    if (process.env.APPEARANCE_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.APPEARANCE_SCREENSHOT_DIR, {recursive: true});
      await page.evaluate(async () => {board.nodes = [{id: 'own-note', type: 'note', title: '自己的观察', body: '界面改变后，这张便签仍保持原来的颜色。',
        x: 70, y: 90, w: 380, h: 240, color: '#fff0aa'}]; render(); await showWorkspaceTab('assetPane');});
      await page.screenshot({path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, 'custom-dark.png')});
      await page.evaluate(() => whiteboardAppearance.apply({preset: 'resolve', custom: {panel: '#e7e6e2'}, note: '#fff0aa'}));
      await page.screenshot({path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, 'custom-light.png')});
    }
    assert.deepEqual(errors, []);
    console.log('Appearance: readable custom light/dark/neutral/coloured panels, independent canvas, selection, JSON, saved preferences and unchanged note colours passed');
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null && server.signalCode === null) {server.kill(); await new Promise(resolve => server.once('exit', resolve));}
    const resolved = path.resolve(temporary); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
