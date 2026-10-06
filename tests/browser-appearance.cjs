const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process'), assert = require('assert'), {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-appearance-'));
  const port=await require('./browser-port.cjs')();
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
    async function contrast(selector, backgroundSelector, foregroundProperty = 'color', pseudo = null) {
      return page.locator(selector).first().evaluate((element, {backgroundSelector, foregroundProperty, pseudo}) => {
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = value => rgb(value).map(c => {c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;})
          .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        let background = backgroundSelector ? document.querySelector(backgroundSelector) : element;
        while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
        const color = getComputedStyle(element, pseudo)[foregroundProperty], fill = getComputedStyle(background).backgroundColor;
        const a = luminance(color), b = luminance(fill);
        return {ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), color, fill};
      }, {backgroundSelector, foregroundProperty, pseudo});
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
    // The content outline sits outside the note, against the canvas. An accent
    // identical to that surface must still show which content is selected.
    await page.evaluate(() => {
      board.nodes.push({id: 'linked-note', type: 'note', title: '另一张记录', body: '保留这段原文。',
        x: 540, y: 90, w: 250, h: 180, color: '#dcebc7'});
      board.edges = [{id: 'visible-link', from: 'own-note', to: 'linked-note', label: '自己的联系'}]; render();
    });
    const authoredBeforeSelection = await page.evaluate(() => JSON.stringify(board));
    for (const canvas of ['#ffffff', '#26272c', '#777777', '#d4c4aa', '#315b70']) {
      await page.evaluate(canvas => {
        whiteboardAppearance.apply({preset: 'resolve', custom: {canvas, accent: canvas}, note: '#fff0aa'});
        edgeId = null; selected = new Set(['own-note']); refreshSelectionUI(); drawEdges();
      }, canvas);
      if (process.env.APPEARANCE_SCREENSHOT_DIR && canvas === '#ffffff') {
        fs.mkdirSync(process.env.APPEARANCE_SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, 'canvas-selection.png')});
      }
      const selectedOutline = await contrast('[data-id="own-note"]', '#canvas', 'outlineColor');
      assert(selectedOutline.ratio >= 3, 'Selected content remains visible when accent matches canvas: ' + JSON.stringify(selectedOutline));
      const linkLabel = await contrast('.connector text', '#canvas', 'fill');
      assert(linkLabel.ratio >= 4.5, 'Connection descriptions remain readable on a custom canvas: ' + JSON.stringify(linkLabel));
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-accent')), canvas,
        'Keep the chosen accent; derive a legible canvas indication separately');
      assert.equal(await page.locator('[data-id="own-note"]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 240, 170)');
      assert((await contrast('#selection', '#canvas', 'borderColor')).ratio >= 3, 'The box-selection boundary is visible too');
      await page.evaluate(() => {edgeId = 'visible-link'; drawEdges();});
      assert((await contrast('.connector.selected .connector-line', '#canvas', 'stroke')).ratio >= 3,
        'The selected connection also stays visible against the canvas');
      await page.evaluate(() => document.querySelector('[data-id="own-note"] .port').classList.add('connector-snap'));
      assert((await contrast('.connector-snap', '#canvas', 'borderColor')).ratio >= 3, 'The active connection endpoint stays visible');
      await page.evaluate(() => document.querySelector('.connector-snap').classList.remove('connector-snap'));
    }
    for (const preset of ['resolve', 'paper', 'slate']) {
      await page.evaluate(preset => whiteboardAppearance.apply({preset, custom: {}, note: '#fff0aa'}), preset);
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-canvas-focus')),
        await page.evaluate(preset => whiteboardAppearance.palettes[preset].accent, preset), 'Existing preset selection colours remain unchanged');
    }
    assert.equal(await page.evaluate(() => JSON.stringify(board)), authoredBeforeSelection, 'Changing appearance and selection cannot alter authored content or geometry');
    // A selected note can also sit in front of authored content, rather than
    // the plain canvas. Preserve the accent without losing its boundary there.
    for (const behind of ['#ed5945', '#ffffff', '#000000', '#777777']) {
      await page.evaluate(behind => {
        whiteboardAppearance.apply({preset:'resolve', custom:{accent:behind}, note:'#fff0aa'});
        board.nodes = [
          {id:'behind-note', type:'note', title:'背景记录', body:'保留原来的颜色。', x:40,y:80,w:660,h:380,color:behind},
          {id:'front-note', type:'note', title:'正在选择', body:'保留这张内容。', x:180,y:150,w:300,h:200,color:'#fff0aa'}
        ]; board.edges=[]; board.view={x:0,y:0,z:1}; selected=new Set(['front-note']); editorId=null;
        $('nodes').replaceChildren(); render();
      }, behind);
      const overlappingContent = await page.evaluate(() => JSON.stringify(board));
      const edgeStyle=await page.locator('[data-id="front-note"]').evaluate(el=>{
        const style=getComputedStyle(el,'::before');return {content:style.content,border:style.borderTopStyle,width:parseFloat(style.borderTopWidth),events:style.pointerEvents};
      });
      assert.equal(edgeStyle.content, '""', 'A contrasting edge accompanies the selection, without changing the accent');
      assert.equal(edgeStyle.border, 'solid'); assert(edgeStyle.width>=1); assert.equal(edgeStyle.events,'none',
        'The selection edge cannot catch drags or block connection and resize handles');
      const halo = await contrast('[data-id="front-note"]', '[data-id="behind-note"]', 'borderTopColor', '::before');
      const outline = await contrast('[data-id="front-note"]', '[data-id="behind-note"]', 'outlineColor');
      assert(Math.max(halo.ratio, outline.ratio) >= 3, 'The selection boundary remains visible over authored content: ' + JSON.stringify({behind,halo,outline}));
      const selectedSize=await page.locator('[data-id="front-note"]').boundingBox();
      for (const zoom of [.5,2]) {
        await page.evaluate(zoom=>{board.view.z=zoom;moveView()},zoom);
        const zoomed=await page.locator('[data-id="front-note"]').boundingBox();
        assert(Math.abs(zoomed.width-selectedSize.width*zoom)<1&&Math.abs(zoomed.height-selectedSize.height*zoom)<1,
          'The selection indication does not change content size or its scaling');
      }
      await page.evaluate(()=>{board.view.z=1;moveView();selected.clear();refreshSelectionUI()});
      assert.equal(await page.locator('[data-id="front-note"]').evaluate(el=>getComputedStyle(el,'::before').content), 'none',
        'Unselected authored content has no added selection decoration');
      assert.equal(await page.evaluate(()=>JSON.stringify(board)), overlappingContent, 'Selection and zoom return preserve authored content and geometry');
      assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--ui-accent')), behind);
    }
    // Ordinary and zoom buttons belong to the same document toolbar surface;
    // a dark toolbar must not contain unrelated browser-default white controls.
    const jsonAsset = await (await fetch(base + '/api/assets/upload', {method:'POST',
      headers:{'X-File-Name':'toolbar.json'}, body:JSON.stringify({title:'资料记录',notes:'原始说明'})})).json();
    await page.evaluate(async id => {
      await loadAssets(); board.nodes.push({id:'json-controls',type:'note',title:'toolbar.json',body:'',assetId:id,
        x:720,y:420,w:380,h:330,color:'#ffffff'}); render();
    },jsonAsset.id);
    await page.locator('[data-id="json-controls"] .json-reader').waitFor();
    const originalGeometry = await page.evaluate(() => board.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h,n.color,n.body]));
    async function checkJSONToolbar(selector){
      const bar=page.locator(selector+' .json-tools');await bar.locator('[data-json-mode="内容"]').waitFor({state:'visible'});assert.equal(await bar.locator('button').count(),6);
      const style=await bar.evaluate(el=>({background:getComputedStyle(el).backgroundColor,
        ordinary:[...el.querySelectorAll('button:not(.chosen)')].map(b=>getComputedStyle(b).backgroundColor),
        selected:getComputedStyle(el.querySelector('.chosen')).backgroundColor}));
      assert(style.ordinary.every(color=>color===style.background),'Ordinary mode and zoom controls follow their toolbar surface: '+JSON.stringify(style));
      assert.notEqual(style.selected,style.background,'The chosen reading mode stays distinguishable');
      for(const mode of ['内容','结构','原文'])
        assert((await contrast(selector+' .json-tools [data-json-mode="'+mode+'"]')).ratio>=4.5);
      for(const title of ['缩小 JSON 内容','恢复 JSON 至100%','放大 JSON 内容'])
        assert((await contrast(selector+' .json-tools button[title="'+title+'"]')).ratio>=4.5);
      await bar.locator('[data-json-mode="内容"]').focus();await page.keyboard.press('Tab');
      const focus=await contrast(selector+' [data-json-mode="结构"]',selector+' .json-tools','outlineColor');
      assert(focus.ratio>=3,'Keyboard focus stays visible on the document toolbar');
      await page.keyboard.press('Enter');assert(await bar.locator('[data-json-mode="结构"]').evaluate(el=>el.classList.contains('chosen')));
      await bar.locator('[title="放大 JSON 内容"]').click();assert.equal(await bar.locator('[title="恢复 JSON 至100%"]').innerText(),'115%');
      await bar.locator('[title="恢复 JSON 至100%"]').click();await bar.locator('[data-json-mode="原文"]').click();
      assert((await page.locator(selector+' pre').innerText()).includes('原始说明'));
    }
    for(const appearance of [{preset:'resolve',custom:{}},{preset:'paper',custom:{}},{preset:'slate',custom:{}},
      {preset:'resolve',custom:{panel:'#ffffff'}},{preset:'paper',custom:{panel:'#0b0e13'}},{preset:'resolve',custom:{panel:'#315b70'}}]){
      await page.evaluate(appearance=>whiteboardAppearance.apply({...appearance,note:'#fff0aa'}),appearance);
      await checkJSONToolbar('[data-id="json-controls"] .json-reader');
    }
    await page.evaluate(id=>previewAsset(id),jsonAsset.id);await page.locator('#documentView.json-reader').waitFor();
    await checkJSONToolbar('#documentView');await page.keyboard.press('Escape');
    await page.evaluate(()=>whiteboardReading.open('json-controls'));
    await checkJSONToolbar('#immersiveSurface .json-reader');await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>board.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h,n.color,n.body])),originalGeometry,
      'Toolbar appearance, modes, zoom reset and expanded reading preserve authored content and geometry');
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
    // A chosen paper color needs readable ink in every place that holds the
    // content. In particular, the old brightness cutoff failed on mid-gray.
    const papers=['#fff0aa','#777777','#7d7d7d','#c28a62','#315b70','#303136',
      '#000000','#767676','#808080','#949494','#aeb7b4','#dcebc7','#f8f8f8'];
    await page.evaluate(papers=>{
      editorId=null;selected.clear();board.view={x:0,y:0,z:1};
      const notes=papers.map((color,i)=>({id:'paper-test-'+i,type:'note',color,title:'自己的观察 '+i,
        body:'保留原来的内容。',userText:'补充一条自己的记录。',annotation:'对照原始资料。',
        x:30+(i%6)*220,y:70+Math.floor(i/6)*230,w:210,h:220,sizeMode:'manual',tags:[]}));
      board.nodes=[...notes,{id:'paper-table',type:'table',title:'自己的编排',color:'#ffffff',
        x:30,y:800,w:900,h:360,sizeMode:'manual',columns:['甲','乙','丙'],rows:Array.from({length:5},()=>['','','']),
        cellItems:Array.from({length:5},(_,r)=>Array.from({length:3},(_,c)=>notes[r*3+c]?[{...clone(notes[r*3+c]),id:'copy-'+(r*3+c)}]:[])),cellImages:[],tags:[]}];
      board.edges=[];$('nodes').replaceChildren();render();
    },papers);
    const paperOriginals=await page.evaluate(()=>clone(board.nodes));
    async function checkPaperInk(immersive=false){
      const results=await page.evaluate(immersive=>{
        const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
        const lum=value=>value.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
        const selector=immersive?'#immersiveSurface .edit-scroll>textarea,#immersiveSurface .visible-annotation textarea,#immersiveSurface .visible-annotation label':
          '[data-id^="paper-test-"] .edit-scroll>textarea,[data-id^="paper-test-"] .visible-annotation textarea,[data-id^="paper-test-"] .visible-annotation label,[data-id="paper-table"] [data-cell-note-field]';
        return [...document.querySelectorAll(selector)].filter(el=>getComputedStyle(el).display!=='none').map(el=>{
          const owner=el.closest('.cell-content')||el.closest('.node'),bg=rgb(getComputedStyle(owner).backgroundColor),fg=rgb(getComputedStyle(el).color);
          let opacity=1;for(let current=el;current&&current!==owner.parentElement;current=current.parentElement)opacity*=Number(getComputedStyle(current).opacity);
          const painted=fg.map((c,i)=>c*opacity+bg[i]*(1-opacity)),a=lum(painted),b=lum(bg);
          return {id:owner.dataset.id||'copy-'+owner.dataset.cellC,field:el.dataset.cellNoteField||el.dataset.previewId||el.id||el.tagName,
            ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font:parseFloat(getComputedStyle(el).fontSize),caption:el.tagName==='LABEL'};
        });
      },immersive);
      assert(results.length>0);
      for(const result of results){assert(result.ratio>=4.5,'Chosen paper keeps readable text: '+JSON.stringify(result));
        if(result.caption)assert(result.font>=12,'A remark caption is not tiny faded text');}
    }
    for(const preset of ['resolve','paper','slate']){
      await page.evaluate(preset=>whiteboardAppearance.apply({preset,custom:{},note:'#fff0aa'}),preset);
      await checkPaperInk();
      assert.equal(await page.locator('[data-id="paper-test-0"]').evaluate(el=>getComputedStyle(el).color),'rgb(36, 37, 41)',
        'The already readable default yellow paper keeps its original ink');
      for(const [i,color] of papers.entries()){
        const backgrounds=await page.evaluate(i=>[document.querySelector('[data-id="paper-test-'+i+'"]'),
          document.querySelector('[data-id="paper-table"] [data-cell-r="'+Math.floor(i/3)+'"][data-cell-c="'+i%3+'"]')].filter(Boolean).map(el=>getComputedStyle(el).backgroundColor),i);
        const expected=await page.evaluate(color=>{const el=document.createElement('span');el.style.backgroundColor=color;return el.style.backgroundColor},color);
        assert.equal(backgrounds.length,2);assert(backgrounds.every(bg=>bg===expected),'Changing ink preserves chosen paper color in the canvas and table');
      }
      const box=await page.locator('[data-id="paper-test-1"]').boundingBox();
      await page.mouse.dblclick(box.x+24,box.y+28);await page.locator('[data-id="paper-test-1"] .live-layout').waitFor();
      await checkPaperInk();await page.locator('#inlineDone').click();
      await page.evaluate(()=>whiteboardReading.open('paper-test-2'));await page.locator('#immersiveSurface #body').waitFor();
      await checkPaperInk(true);await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!whiteboardReading.isEditing());
    }
    assert.deepEqual(await page.evaluate(()=>board.nodes),paperOriginals,'Paper ink and theme changes preserve words, colors, copies and manual geometry');
    assert.equal(await page.evaluate(async()=>{change();return persist()}),true);await page.reload();await page.waitForFunction(()=>board&&!loading);
    await checkPaperInk();assert.deepEqual(await page.evaluate(()=>board.nodes),paperOriginals,'Reopening keeps chosen paper colors and all original content');
    console.log('Paper reading: custom gray and colored notes, table copies, three themes, pointer editing, immersive editing and reopening passed');
    assert.deepEqual(errors, []);
    console.log('Appearance: readable custom panels and canvas, selection over authored content, JSON, saved preferences and unchanged note colours/geometry passed');
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null && server.signalCode === null) {server.kill(); await new Promise(resolve => server.once('exit', resolve));}
    const resolved = path.resolve(temporary); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
