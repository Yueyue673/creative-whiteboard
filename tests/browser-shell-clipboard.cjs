const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const assert = require('assert'), {spawn} = require('child_process'), {chromium} = require('playwright');

(async () => {
  const root = process.env.CREATIVE_BOARD_TEST_ROOT || path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-shell-clipboard-'));
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

    // Preparing a research task can take time. A later native copy still owns
    // the clipboard, even if the earlier task has not been ready to write yet.
    await b.evaluate(() => {selected.clear(); whiteboardAI.compose();
      const handler = $('aiCopyTask').onclick;
      $('aiCopyTask').onclick = event => window.researchCopyDone = handler(event);
    });
    await b.locator('#aiVisuals').uncheck();
    const newerQuestion = '查找已有的正式研究来源。';
    await b.locator('#aiTaskText').fill(newerQuestion);
    let releaseResearchSave, researchSaveArrived, researchSaveFinished;
    const researchGate = new Promise(resolve => releaseResearchSave = resolve);
    const researchStarted = new Promise(resolve => researchSaveArrived = resolve);
    const researchFinished = new Promise(resolve => researchSaveFinished = resolve);
    const holdResearchSave = async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      researchSaveArrived();
      try {await researchGate; await route.continue();} finally {researchSaveFinished();}
    };
    await page.route('**/api/ai/tasks/*', holdResearchSave);
    try {
      await b.locator('#aiCopyTask').click();
      await researchStarted;
      await b.locator('#aiTaskText').selectText();
      await page.keyboard.press('Control+c');
      await b.waitForFunction(() => whiteboardClipboardCoordinator.pending === null, null, {timeout:3000});
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), newerQuestion,
        'A later native copy need not wait for the older task to finish preparing');
      releaseResearchSave();
      await b.evaluate(() => researchCopyDone);
      await b.waitForFunction(() => $('aiReplyStatus').textContent.startsWith('已准备'));
      await b.evaluate(() => whiteboardClipboardCoordinator.ready());
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), newerQuestion,
        'Research preparation must not overwrite text copied afterwards');
      assert(!((await b.locator('#aiReplyStatus').innerText()).includes('已复制研究任务')),
        'An obsolete copy must not report that it replaced the clipboard');
    } finally {
      releaseResearchSave(); await researchFinished;
      await page.unroute('**/api/ai/tasks/*', holdResearchSave);
    }
    const researchTasks = await fetch(base + '/api/ai/tasks').then(response => response.json());
    assert(researchTasks.length > 0, 'Preparing a superseded copy still preserves its local research material');
    await b.evaluate(() => $('dialog').close());
    console.log('Shell clipboard: later native text supersedes an earlier research preparation');

    // Conversely, a newer research copy must finish after an older menu write.
    await holdLibraryCopy();
    await b.evaluate(() => {selected.clear(); whiteboardAI.compose();
      const handler = $('aiCopyTask').onclick;
      $('aiCopyTask').onclick = event => window.researchCopyDone = handler(event);
    });
    await b.locator('#aiVisuals').uncheck();
    await b.locator('#aiTaskText').fill('查找已有视觉体系的原作者资料。');
    await b.locator('#aiCopyTask').click();
    await b.waitForFunction(() => $('aiReplyStatus').textContent.startsWith('已准备'));
    await page.evaluate(() => finishClipboardWrite());
    await b.evaluate(() => researchCopyDone);
    const researchCopy = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(researchCopy.request.task, '查找已有视觉体系的原作者资料。');
    assert.equal(researchCopy.aiPolicy.readOnly, true);
    assert.equal(researchCopy.request.allowAdd, false);
    assert(!Object.hasOwn(researchCopy, 'proposalRules'));
    assert((await b.locator('#aiReplyStatus').innerText()).includes('已复制研究任务'));
    console.log('Shell clipboard: a newer research copy follows an older held menu write');

    // Unavailable clipboard falls back to a valid local file; failed material
    // preparation does not download an incomplete task or report copy success.
    await page.evaluate(() => {navigator.clipboard.writeText = () => Promise.reject(Error('Clipboard unavailable'));});
    const downloadArrived = page.waitForEvent('download');
    await b.locator('#aiCopyTask').click();
    const download = await downloadArrived;
    await b.evaluate(() => researchCopyDone);
    assert.equal(download.suggestedFilename(), '研究任务.json');
    assert.equal(JSON.parse(fs.readFileSync(await download.path(), 'utf8')).requestId, researchCopy.requestId);
    assert((await b.locator('#aiReplyStatus').innerText()).includes('已下载研究任务'));
    await page.evaluate(() => {navigator.clipboard.writeText = holdWrite;});
    let unexpectedDownloads = 0;
    page.on('download', () => unexpectedDownloads++);
    await b.locator('#aiTaskText').fill('材料保存失败之后再查找正式资料。');
    const failResearchSave = route => route.request().method() === 'PUT'
      ? route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:'材料暂时无法保存'})})
      : route.continue();
    await page.route('**/api/ai/tasks/*', failResearchSave);
    await b.locator('#aiCopyTask').click();
    await b.evaluate(() => researchCopyDone);
    assert((await b.locator('#aiReplyStatus').innerText()).includes('材料暂时无法保存'));
    assert.equal(unexpectedDownloads, 0, 'Preparation failure cannot download an incomplete research task');
    assert.equal(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).requestId, researchCopy.requestId);
    await page.unroute('**/api/ai/tasks/*', failResearchSave);
    await b.locator('#aiCopyTask').click();
    await b.evaluate(() => researchCopyDone);
    assert.equal(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).request.task,
      '材料保存失败之后再查找正式资料。', 'A failed preparation leaves copying usable for retry');
    await b.evaluate(() => $('dialog').close());
    console.log('Shell clipboard: research download fallback, preparation failure and retry');

    // Replacing a library cut with a successful research copy must remove the
    // cut highlight. A failed clipboard write and file fallback keep it intact.
    if(await page.locator('#globalExplorer').isHidden())await page.locator('#openBoards').click();
    await explorer.evaluate(async()=>{await showWorkspaceTab('assetPane');await loadAssets();enterAssetFolder('来源');});
    await explorer.locator('[data-asset=source]').click({button:'right'});
    await explorer.locator('#fileContext button').filter({hasText:/^剪切/}).click();
    await explorer.waitForFunction(()=>!!localStorage.getItem('creative-library-cut-v1'));
    await explorer.waitForFunction(()=>document.querySelector('[data-asset=source]').classList.contains('cut-pending'));
    const cutBeforeResearch=await explorer.evaluate(()=>localStorage.getItem('creative-library-cut-v1'));
    const cutClipboard=await page.evaluate(()=>navigator.clipboard.readText());
    const catalogBeforeResearch=await fetch(base+'/api/assets').then(response=>response.json());
    await page.locator('#openBoards').click();
    await page.getByRole('tab',{name:'终点',exact:true}).click();
    await b.evaluate(()=>{selected.clear();whiteboardAI.compose();
      const handler=$('aiCopyTask').onclick;
      $('aiCopyTask').onclick=event=>window.researchCopyDone=handler(event);
    });
    await b.locator('#aiVisuals').uncheck();
    await b.locator('#aiTaskText').fill('查找已有审美体系的正式来源。');
    await page.evaluate(()=>{navigator.clipboard.writeText=()=>Promise.reject(Error('Clipboard unavailable'));});
    const cutFallback=page.waitForEvent('download');
    await b.locator('#aiCopyTask').click();await cutFallback;
    await b.evaluate(()=>researchCopyDone);
    assert.equal(await b.evaluate(()=>localStorage.getItem('creative-library-cut-v1')),cutBeforeResearch,
      'File fallback does not cancel an existing cut that remains in the clipboard');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),cutClipboard);
    await page.evaluate(()=>{navigator.clipboard.writeText=holdWrite;});
    await b.locator('#aiCopyTask').click();await b.evaluate(()=>researchCopyDone);
    assert.equal(JSON.parse(await page.evaluate(()=>navigator.clipboard.readText())).request.task,
      '查找已有审美体系的正式来源。');
    assert.equal(await b.evaluate(()=>localStorage.getItem('creative-library-cut-v1')),null,
      'Successful research copying cancels the superseded library cut');
    await explorer.waitForFunction(()=>!document.querySelector('[data-asset=source]').classList.contains('cut-pending'));
    const canceledMove=await b.evaluate(text=>whiteboardLibraryClipboard.paste(text,[],'').then(()=>'',error=>error.message),cutClipboard);
    assert(canceledMove.includes('剪切已完成或取消'),'An obsolete cut payload cannot move originals after it is superseded');
    assert.deepEqual(await fetch(base+'/api/assets').then(response=>response.json()),catalogBeforeResearch,
      'Canceling a superseded cut changes no catalog content or file placement');
    assert((await b.locator('#aiReplyStatus').innerText()).includes('已复制研究任务'));
    await b.evaluate(()=>$('dialog').close());
    console.log('Shell clipboard: research copying clears superseded cut highlights across frames; failed writes preserve cuts and originals');

    // An older shell may stay open while a newly opened tab loads the updated
    // research module. It must not copy empty text through the older API.
    const beforeLegacyCopy=await page.evaluate(()=>navigator.clipboard.readText());
    await page.evaluate(()=>{whiteboardClipboardCoordinator.preparesText=false;});
    try{
      await b.evaluate(()=>{selected.clear();whiteboardAI.compose();
        const handler=$('aiCopyTask').onclick;
        $('aiCopyTask').onclick=event=>window.researchCopyDone=handler(event);
      });
      await b.locator('#aiTaskText').fill('查找正式来源。');
      await b.locator('#aiCopyTask').click();await b.evaluate(()=>researchCopyDone);
      assert((await b.locator('#aiReplyStatus').innerText()).includes('重新打开应用'));
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),beforeLegacyCopy);
    }finally{
      await page.evaluate(()=>{whiteboardClipboardCoordinator.preparesText=true;});
      await b.evaluate(()=>$('dialog').close());
    }
    console.log('Shell clipboard: an older open shell retains its clipboard and explains how to enable the updated copy tool');

    // Independent app windows share the OS clipboard. Returning to a window
    // with an older unfinished preparation must not replace a newer copy.
    for(const copyKind of ['text','canvas','library','cut','menu']){
      await b.evaluate(()=>{selected.clear();whiteboardAI.compose();
        const handler=$('aiCopyTask').onclick;
        $('aiCopyTask').onclick=event=>window.researchCopyDone=handler(event);
        window.independentCaptureWaiting=false;
        window.finishIndependentCapture=null;
        const capture=whiteboardContext.capture;
        whiteboardContext.capture=async(...args)=>{
          window.independentCaptureWaiting=true;
          await new Promise(resolve=>window.finishIndependentCapture=resolve);
          return capture(...args);
        };
        window.restoreIndependentCapture=()=>{whiteboardContext.capture=capture;};
      });
      await b.locator('#aiVisuals').uncheck();
      await b.locator('#aiTaskText').fill('查找原作者的正式说明。'+copyKind);
      await b.locator('#aiCopyTask').click();
      await b.waitForFunction(()=>!!window.independentCaptureWaiting);
      const separate=await context.newPage();
      try{
        await separate.goto(base+'/?board=b');
        await separate.waitForFunction(()=>pane(current())?.state().boardId==='b');
        const separatePane=separate.frames().find(frame=>frame.parentFrame()&&new URL(frame.url()).searchParams.get('board')==='b'&&new URL(frame.url()).searchParams.get('explorer')!=='1');
        if(copyKind==='text'){
          await separatePane.evaluate(()=>{
            showDialog('<h2>自己的输入</h2><textarea id="independentCopy">在另一个窗口复制的文字。</textarea>',[['关闭',()=>$('dialog').close()]]);
            $('independentCopy').focus();$('independentCopy').select();
          });
          await separate.keyboard.press('Control+c');
        }else if(copyKind==='canvas'){
          await separatePane.evaluate(()=>{selected=new Set([board.nodes[0].id]);refreshSelectionUI();canvas.focus();});
          await separate.keyboard.press('Control+c');
        }else{
          if(await separate.locator('#globalExplorer').isHidden())await separate.locator('#openBoards').click();
          await separate.waitForFunction(()=>!!whiteboardWorkspace.explorer());
          const otherExplorer=separate.frames().find(frame=>new URL(frame.url()).searchParams.get('explorer')==='1');
          await otherExplorer.evaluate(async()=>{await showWorkspaceTab('assetPane');await loadAssets();enterAssetFolder('来源');});
          await otherExplorer.locator('[data-asset=source]').click({button:copyKind==='menu'?'right':'left'});
          if(copyKind==='menu'){
            await otherExplorer.locator('#fileContext button').filter({hasText:/^复制/}).click();
            await otherExplorer.evaluate(()=>whiteboardClipboardCoordinator.ready());
          }else await separate.keyboard.press(copyKind==='cut'?'Control+x':'Control+c');
        }
        const newestClipboard=await separate.evaluate(()=>navigator.clipboard.readText());
        if(copyKind==='text')assert.equal(newestClipboard,'在另一个窗口复制的文字。');
        else{
          const copied=JSON.parse(newestClipboard);
          assert.equal(copied.nodes[0].body,copyKind==='canvas'?'这段原文来自白板。':'这段原文来自内容库。');
          if(copyKind!=='canvas'){
            assert.equal(copied.library.entries[0].id,'source');
            assert.equal(copied.library.operation,copyKind==='cut'?'cut':'copy');
          }
        }
        assert.match(await separate.evaluate(()=>localStorage.getItem('creative-clipboard-order-v1')),/^[a-f0-9-]{36}$/,
          'Window coordination stores a random order marker, not clipboard contents');
        await page.bringToFront();
        await b.evaluate(()=>finishIndependentCapture());
        await b.waitForFunction(()=>$('aiReplyStatus').textContent.startsWith('已准备')||$('aiReplyStatus').textContent.startsWith('已复制'));
        await b.evaluate(()=>researchCopyDone);
        assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),newestClipboard,
          'An older research preparation cannot replace a newer '+copyKind+' copy from another app window');
        assert(!((await b.locator('#aiReplyStatus').innerText()).includes('已复制研究任务')));
        if(copyKind==='cut')assert(await separate.evaluate(()=>!!localStorage.getItem('creative-library-cut-v1')),
          'An obsolete research completion must not cancel the newer cut');
        console.log('Shell clipboard: independent-window '+copyKind+' copy preserved');
      }finally{
        await b.evaluate(()=>{finishIndependentCapture();restoreIndependentCapture();$('dialog').close();});
        await separate.close();await page.bringToFront();
      }
    }
    console.log('Shell clipboard: independent text, canvas, library copy/cut and menu copies supersede older research preparation; no clipboard data in order markers');

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

    // An unfinished preparation belongs to its source tab. Closing that tab
    // cannot leave later copies waiting for a promise in a removed document.
    await open('起点');
    const reopened = page.frames().find(frame => new URL(frame.url()).searchParams.get('board') === 'a');
    await reopened.evaluate(() => {
      selected.clear(); whiteboardAI.compose();
      whiteboardContext.capture = async () => {
        window.captureWaiting = true;
        await new Promise(resolve => window.releaseAbandonedCapture = resolve);
      };
    });
    await reopened.locator('#aiVisuals').uncheck();
    await reopened.locator('#aiTaskText').fill('查找已有的内容组织体系来源。');
    await reopened.locator('#aiCopyTask').click();
    await reopened.waitForFunction(() => !!window.captureWaiting);
    await page.getByRole('button', {name:'关闭标签：起点', exact:true}).click();
    await page.waitForFunction(() => !model.tabs.some(tab => tab.boardId === 'a'));
    await page.getByRole('tab', {name:'终点', exact:true}).click();
    await b.evaluate(() => {
      showDialog('<h2>自己的输入</h2><textarea id="afterClosedResearch">关闭任务后复制的文字。</textarea>',
        [['关闭', () => $('dialog').close()]]);
      $('afterClosedResearch').focus(); $('afterClosedResearch').select();
    });
    await page.keyboard.press('Control+c');
    await b.waitForFunction(() => whiteboardClipboardCoordinator.pending === null, null, {timeout:3000});
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '关闭任务后复制的文字。');
    await b.evaluate(() => {$('dialog').close(); canvas.focus();});
    const afterAbandonedPreparation = await b.evaluate(() => board.nodes.length);
    await page.keyboard.press('Control+v');
    await b.waitForFunction(count => board.nodes.length === count + 1, afterAbandonedPreparation);
    assert.equal(await b.evaluate(() => board.nodes.at(-1).body), '关闭任务后复制的文字。');
    console.log('Shell clipboard: closing an unfinished research tab does not block later native copy and paste');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.kill(); await new Promise(resolve => server.once('exit', resolve));
    const resolved = path.resolve(temporary);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
