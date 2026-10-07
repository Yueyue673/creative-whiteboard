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
    const context=await browser.newContext({viewport: {width: 1400, height: 940}}),page=await context.newPage(),errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/index.html'); await page.waitForFunction(() => board && !loading && window.whiteboardAppearance);
    await page.evaluate(async () => {
      board.nodes = [{id: 'own-note', type: 'note', title: '自己的观察', body: '这段内容由使用者保留。',
        x: 50, y: 90, w: 380, h: 240, color: '#fff0aa'}]; render();
      await showWorkspaceTab('assetPane');
    });
    // A named style must round-trip all its preferences without editing the board,
    // and changes in another window must not be overwritten by a stale dialog.
    const originalNotes=await page.evaluate(()=>JSON.stringify(board.nodes));
    await page.evaluate(()=>whiteboardAppearance.open());
    assert.equal(await page.locator('.appearance-presets [data-preset]').count(),6);
    for(const preset of ['sand','forest','iris']){
      await page.locator('[data-preset="'+preset+'"]').click();
      assert.equal(await page.evaluate(()=>whiteboardAppearance.read().preset),preset);
    }
    await page.locator('[data-hex="canvas"]').fill('#253147');await page.locator('[data-hex="canvas"]').press('Enter');
    await page.locator('[data-hex="panel"]').fill('#172336');await page.locator('[data-hex="panel"]').press('Enter');
    await page.locator('[data-hex="note"]').fill('#ead8b9');await page.locator('[data-hex="note"]').press('Enter');
    await page.locator('[data-pattern="grid"]').click();
    await page.locator('#appearanceGrid').fill('40');await page.locator('#appearanceGrid').dispatchEvent('input');
    await page.locator('#appearanceScale').fill('110');await page.locator('#appearanceScale').dispatchEvent('input');
    await page.locator('#appearanceWidth').fill('410');await page.locator('#appearanceWidth').dispatchEvent('input');
    await page.locator('#appearanceName').fill('自己的夜间工作台');await page.locator('#appearanceName').press('Enter');
    const savedStyle=await page.evaluate(()=>({appearance:whiteboardAppearance.read(),ui:JSON.parse(localStorage.getItem('creative-interface'))}));
    assert.equal(await page.locator('[data-saved-preset]').count(),1);
    await page.locator('#appearanceName').fill('自己的夜间工作台');await page.locator('#appearanceSave').click();
    assert((await page.locator('.appearance-message').innerText()).includes('名称已存在'));
    assert.equal(await page.locator('[data-saved-preset]').count(),1,'An accidental duplicate cannot replace a saved choice');
    await page.locator('[data-preset="paper"]').click();await page.locator('#appearanceReset').click();
    assert.equal(await page.locator('[data-saved-preset]').count(),1,'Resetting appearance keeps the user preset collection');
    await page.locator('[data-saved-preset]').click();
    assert.deepEqual(await page.evaluate(()=>({appearance:whiteboardAppearance.read(),ui:JSON.parse(localStorage.getItem('creative-interface'))})),savedStyle);
    await page.locator('#appearanceDone').click();
    const another=await page.context().newPage();await another.goto(base+'/index.html');await another.waitForFunction(()=>board&&!loading&&window.whiteboardAppearance);
    assert.deepEqual(await another.evaluate(()=>({appearance:whiteboardAppearance.read(),ui:JSON.parse(localStorage.getItem('creative-interface'))})),savedStyle,'A reopened page retains the whole saved style');
    await page.evaluate(()=>whiteboardAppearance.open());
    await another.evaluate(()=>whiteboardAppearance.open());await another.locator('[data-preset="forest"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-preset="forest"]').getAttribute('aria-pressed')==='true');
    await page.locator('[data-pattern="dots"]').click();
    assert.equal(await page.evaluate(()=>whiteboardAppearance.read().preset),'forest','A later setting keeps the current palette received from another window');
    await page.locator('[data-hex="canvas"]').fill('#xyz');await page.locator('[data-hex="canvas"]').press('Enter');
    await page.locator('#appearanceName').fill('未完成颜色');await page.locator('#appearanceSave').click();
    assert.equal(await page.locator('[data-saved-preset]').count(),1,'Invalid colour drafts cannot become named styles');
    assert.equal(await page.evaluate(()=>whiteboardAppearance.read().custom.canvas),undefined);
    await page.locator('[data-preset="sand"]').click();await page.locator('#appearanceRevert').click();
    assert.deepEqual(await page.evaluate(()=>({appearance:whiteboardAppearance.read(),ui:JSON.parse(localStorage.getItem('creative-interface'))})),savedStyle,'The experiment can return to the appearance at opening');
    await page.locator('[aria-label="移除预设：自己的夜间工作台"]').click();
    assert.equal(await page.locator('[data-saved-preset]').count(),0);await page.getByRole('button',{name:'撤销移除',exact:true}).click();
    assert.equal(await page.locator('[data-saved-preset]').count(),1);
    await another.locator('#appearanceName').fill('<img src=x onerror=alert(1)>');await another.locator('#appearanceSave').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-saved-preset]').length===2);
    assert.equal(await page.locator('.appearance-saved-list img').count(),0,'Author-entered preset names are text, never HTML');
    await page.locator('#appearanceDone').click();await another.close();
    const shell=await context.newPage();await shell.goto(base+'/');await shell.waitForFunction(()=>window.whiteboardAppearance&&document.querySelector('.board-frame'));
    await shell.evaluate(()=>whiteboardAppearance.open());await shell.locator('[data-preset="paper"]').click();await shell.locator('[data-saved-preset]').first().click();
    const pane=shell.frames().find(f=>f.url().includes('/index.html?pane=1&board='));assert(pane);
    await pane.waitForFunction(()=>document.documentElement.dataset.appearance==='iris'&&document.documentElement.dataset.canvasPattern==='grid');
    assert.deepEqual(await pane.evaluate(()=>({appearance:whiteboardAppearance.read(),ui:JSON.parse(localStorage.getItem('creative-interface'))})),savedStyle,'A shell style choice reaches its actual board pane with size preferences intact');
    await shell.close();
    await page.evaluate(()=>{board.view={x:37,y:-29,z:.5};moveView()});
    assert.deepEqual(await page.locator('#canvas').evaluate(el=>({size:getComputedStyle(el).backgroundSize,position:getComputedStyle(el).backgroundPosition})),{size:'20px 20px, 20px 20px',position:'37px -29px, 37px -29px'},'The grid moves and scales in world coordinates');
    await page.evaluate(()=>{board.view.z=.15;moveView()});
    assert.equal(await page.locator('#canvas').evaluate(el=>parseFloat(getComputedStyle(el).backgroundSize)),12,'Low zoom thins the marks to avoid a dense pattern');
    assert.equal(await page.evaluate(()=>JSON.stringify(board.nodes)),originalNotes,'Presets and canvas marks never recolour, resize or edit authored notes');
    await page.evaluate(()=>{whiteboardAppearance.apply({preset:'resolve',custom:{},note:'#fff0aa'},true);board.view={x:0,y:0,z:1};moveView();localStorage.removeItem('creative-interface')});
    console.log('Appearance presets: named styles, safe custom colours, reopen, multi-window edits, reset, revert, removal undo and anchored canvas patterns passed.');
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
    for (const preset of ['resolve', 'paper', 'slate','sand','forest','iris']) {
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
      for(const part of ['summary','.json-leaf b','.json-leaf span']){
        assert((await contrast(selector+' '+part)).ratio>=4.5,'JSON structure remains readable in this theme and surface: '+part);
      }
      const disclosure=page.locator(selector+' summary').first();
      assert.equal(await disclosure.evaluate(el=>getComputedStyle(el).listStyleType),'none','JSON uses one disclosure indication in the card and expanded reader');
      await disclosure.focus();await page.keyboard.press('Space');
      assert.equal(await disclosure.evaluate(el=>el.parentElement.open),false,'Native disclosure keyboard toggling stays available');
      await page.keyboard.press('Space');assert.equal(await disclosure.evaluate(el=>el.parentElement.open),true);

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
    // Long file names stay available as text and a native full-name hint;
    // the reading area and download/close controls fit compact windows.
    const prefix='observations_2026_10_06_sequence_'.repeat(4);
    const documents=[];
    for(const [extension,body] of [['json',JSON.stringify({records:[{name:'原始观察',notes:'保留资料。'}]})],
      ['html','<!doctype html><html><body><p>保留原始网页。</p></body></html>']]){
      const title=prefix+'original.'+extension;
      const response=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':title},body});assert(response.ok);
      documents.push({...(await response.json()),title,original:body});
    }
    const authoredBeforeDocuments=await page.evaluate(()=>clone(board));
    for(const document of documents){
      await page.evaluate(async id=>{await loadAssets();await previewAsset(id)},document.id);
      const heading=page.locator('.document-dialog h2');assert.equal(await heading.textContent(),document.title);
      assert.equal(await heading.getAttribute('title'),document.title,'The complete name is available without adding another control');
      for(const selector of ['#documentState','.document-bar>a'])assert((await contrast(selector,'#dialog')).ratio>=4.5,'Document state and source action remain readable');
      for(const width of [1400,620,360,230]){
        await page.setViewportSize({width,height:760});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        const layout=await page.locator('.document-dialog').evaluate(el=>{
          const heading=el.querySelector('h2'),h=heading.getBoundingClientRect(),d=el.getBoundingClientRect(),view=document.getElementById('documentView').getBoundingClientRect();
          const download=el.querySelector('.document-bar>a'),r=download.getBoundingClientRect(),lineHeight=parseFloat(getComputedStyle(download).lineHeight);
          return {heading:{width:h.width,height:h.height,client:heading.clientWidth,scroll:heading.scrollWidth,line:parseFloat(getComputedStyle(heading).lineHeight)},
            dialog:{left:d.left,right:d.right},viewHeight:view.height,download:{left:r.left,right:r.right,height:r.height,lineHeight},
            close:[...el.querySelectorAll('#dialogActions button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom}}),windowHeight:innerHeight};
        });
        assert(layout.heading.scroll<=layout.heading.client+1,'File name does not create horizontal overflow: '+width);
        assert(layout.heading.height<=layout.heading.line*2+1,'File heading retains at most two lines');
        assert(layout.viewHeight>150,'The actual document retains usable reading space: '+width);
        assert(layout.download.height<=layout.download.lineHeight+1,'Download label stays on one line');
        assert(layout.download.left>=layout.dialog.left&&layout.download.right<=layout.dialog.right,'Download remains within the dialog');
        assert(layout.close.every(r=>r.left>=layout.dialog.left&&r.right<=layout.dialog.right&&r.bottom<=layout.windowHeight),'Close remains reachable');
      }
      await page.getByRole('button',{name:'关闭 Esc',exact:true}).click();assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
      assert.equal(await (await fetch(base+'/api/media/'+document.id)).text(),document.original,'Reading preserves original file bytes');
    }
    await page.setViewportSize({width:1400,height:940});
    assert.deepEqual(await page.evaluate(()=>board),authoredBeforeDocuments,'Preview layout cannot alter the original board');
    console.log('Document reading: full long names, two-line headings, compact download/close controls and unchanged source files passed');
    // Media names must not impose a 640px minimum on a smaller pane. Use
    // playable temporary files so the native controls and continuity are real.
    const wav=Buffer.alloc(44+128000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);
    wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(128000,40);
    // Generated one-second solid-color VP8 clip; no encoder is needed to run the check.
    const videoBytes=fs.readFileSync(path.join(__dirname,'fixtures','media-preview.webm'));
    const previews=[];
    for(const [extension,original] of [['wav',wav],['webm',videoBytes]]){
      const title=prefix+'original.'+extension;
      const response=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':title},body:original});assert(response.ok);
      previews.push({...(await response.json()),title,original,kind:extension==='wav'?'audio':'video'});
    }
    for(const preview of previews){
      await page.evaluate(async id=>{await loadAssets();await previewAsset(id)},preview.id);
      await page.waitForFunction(kind=>document.querySelector('.media-preview '+kind)?.readyState>=2,preview.kind);
      assert.equal(await page.locator('.media-preview h2').textContent(),preview.title);
      assert.equal(await page.locator('.media-preview h2').getAttribute('title'),preview.title);
      assert.equal(await page.locator('.media-preview .source-path').textContent(),preview.path,'The full storage path remains available');
      for(const preset of ['resolve','paper','slate']){
        await page.evaluate(preset=>whiteboardAppearance.apply({preset,custom:{},note:'#fff0aa'}),preset);
        for(const selector of ['.media-preview h2','.media-preview .source-path','.media-preview>a'])
          assert((await contrast(selector,'#dialog')).ratio>=4.5,'Media file context remains readable');
        for(const [width,height] of [[1400,760],[620,760],[360,760],[230,760],[360,320]]){
          await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const layout=await page.locator('#dialog').evaluate(el=>{
            const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
            const heading=el.querySelector('h2'),body=el.querySelector('#dialogBody'),player=el.querySelector('audio,video');
            return {dialog:rect(el),heading:{...rect(heading),scroll:heading.scrollWidth,client:heading.clientWidth,line:parseFloat(getComputedStyle(heading).lineHeight)},
              body:{scroll:body.scrollWidth,client:body.clientWidth},player:rect(player),actions:[...el.querySelectorAll('#dialogActions button')].map(rect)};
          });
          assert(layout.dialog.left>=0&&layout.dialog.right<=width&&layout.dialog.bottom<=height,'Media preview fits its window');
          assert(layout.heading.scroll<=layout.heading.client+1&&layout.heading.height<=layout.heading.line*2+1,'Long media name stays within two lines');
          assert(layout.body.scroll<=layout.body.client+1,'Media information does not cause horizontal overflow');
          assert(layout.player.width>100&&layout.player.left>=layout.dialog.left&&layout.player.right<=layout.dialog.right,'Native media fits usable preview width');
          if(preview.kind==='audio')assert(layout.player.width>=layout.body.client-1,'Audio uses the available width for seeking');
          assert(layout.actions.every(r=>r.left>=layout.dialog.left&&r.right<=layout.dialog.right&&r.bottom<=height),'Both media actions remain reachable');
        }
      }
      await page.setViewportSize({width:360,height:760});
      if(preview.kind==='audio'){
        const player=page.locator('.media-preview audio'),box=await player.boundingBox();
        await page.mouse.click(box.x+27,box.y+box.height/2);
        await page.waitForFunction(()=>{const p=document.querySelector('.media-preview audio');return !p.paused&&p.currentTime>.1});
        await page.mouse.click(box.x+27,box.y+box.height/2);assert(await player.evaluate(el=>el.paused),'Native play and pause remain usable');
        await page.setViewportSize({width:620,height:760});
        const seekBox=await player.boundingBox();
        await page.mouse.click(seekBox.x+seekBox.width*.62,seekBox.y+seekBox.height/2);
        await page.waitForFunction(()=>document.querySelector('.media-preview audio').currentTime>4);
        const position=await player.evaluate(el=>el.currentTime);
        await page.getByRole('button',{name:'关闭',exact:true}).click();
        await page.evaluate(id=>previewAsset(id),preview.id);await page.waitForFunction(()=>document.querySelector('.media-preview audio')?._readingRestored);
        assert(Math.abs(await page.locator('.media-preview audio').evaluate(el=>el.currentTime)-position)<.1,'Reopening retains the same source playback position');
      }
      await page.getByRole('button',{name:'修改说明',exact:true}).click();
      assert.equal(await page.locator('.media-preview').count(),0,'Preview sizing does not leak into the next editor');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
      assert.deepEqual(Buffer.from(await(await fetch(base+'/api/media/'+preview.id)).arrayBuffer()),preview.original,'Preview preserves source bytes');
    }
    await page.setViewportSize({width:1400,height:940});
    assert.deepEqual(await page.evaluate(()=>board),authoredBeforeDocuments,'Media layout and playback preserve authored content');
    console.log('Media previews: playable audio/video, three themes, bounded full names, responsive controls/actions, native playback/seek/reopen and unchanged originals passed');
    // Text files keep their exact source formatting while their reader uses
    // the available space. Long names cannot push its exit outside the pane.
    const textFiles=[];
    const rawText='原始记录\r\n甲\t乙\r\n<script>window.unwantedTextExecution=true</script>\r\n'+
      Array.from({length:80},(_,i)=>'观察 '+i+'：保留原始说明。').join('\n');
    for(const [extension,original] of [['txt',rawText],['md','# 原始记录\n\n'+rawText],['csv','序号,原文\n'+rawText.repeat(30)]]){
      const title=prefix+'part"original.'+extension;
      const response=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'X-File-Name':title},body:original});assert(response.ok);
      textFiles.push({...(await response.json()),title,original});
    }
    await page.evaluate(async id=>{
      await loadAssets();board.nodes.push({id:'text-source',type:'note',title:'资料观察',body:'',assetId:id,
        x:720,y:100,w:400,h:350,sizeMode:'manual',color:'#ffffff',tags:[]});render();
    },textFiles[0].id);
    await page.locator('[data-id=text-source] .file-text-preview pre').waitFor();
    const authoredBeforeText=await page.evaluate(()=>clone(board));
    for(const file of textFiles){
      await page.evaluate(id=>previewAsset(id),file.id);const pre=page.locator('.text-file-preview pre');await pre.waitFor();
      assert.equal(await page.locator('.text-file-preview h2').textContent(),file.title);
      assert.equal(await page.locator('.text-file-preview h2').getAttribute('title'),file.title);
      assert.equal(await pre.textContent(),file.original.slice(0,24000),'Line breaks, tabs and markup remain original source text');
      assert.equal(await pre.locator('script').count(),0);assert.equal(await page.evaluate(()=>window.unwantedTextExecution),undefined);
      const partial=file.original.length>24000;
      assert.equal((await page.locator('.text-file-preview small').textContent()).includes('仅显示前段'),partial,'Bounded previews still clearly disclose partial content');
      for(const preset of ['resolve','paper','slate']){
        await page.evaluate(preset=>whiteboardAppearance.apply({preset,custom:{},note:'#fff0aa'}),preset);
        for(const selector of ['.text-file-preview h2','.text-file-preview small','.text-file-preview pre','.text-file-preview>a',
          '[data-id=text-source] .file-text-preview small'])assert((await contrast(selector)).ratio>=4.5,'Text reader and inline file context stay readable');
        assert(await page.locator('[data-id=text-source] .file-text-preview small').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=12));
        for(const [width,height] of [[1400,760],[620,760],[360,760],[230,760],[360,320]]){
          await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const layout=await page.locator('#dialog').evaluate(el=>{
            const rect=t=>{const r=t.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,height:r.height}};
            const heading=el.querySelector('h2'),pre=el.querySelector('pre');
            return {dialog:rect(el),heading:{...rect(heading),scroll:heading.scrollWidth,client:heading.clientWidth,line:parseFloat(getComputedStyle(heading).lineHeight)},
              reading:{...rect(pre),font:parseFloat(getComputedStyle(pre).fontSize)},download:rect(el.querySelector('a')),
              actions:[...el.querySelectorAll('#dialogActions button')].map(rect)};
          });
          assert(layout.dialog.left>=0&&layout.dialog.right<=width&&layout.dialog.bottom<=height,'Text reading fits its own window');
          assert(layout.heading.scroll<=layout.heading.client+1&&layout.heading.height<=layout.heading.line*2+1,'The full-name hint accompanies a bounded heading');
          assert(layout.reading.font>=13&&layout.reading.height>(height>500?150:20),'Original text retains usable reading space');
          assert(layout.download.left>=layout.dialog.left&&layout.download.right<=layout.dialog.right,'Source download remains in view');
          assert(layout.actions.every(r=>r.left>=layout.dialog.left&&r.right<=layout.dialog.right&&r.bottom<=height),'Text preview exit stays reachable');
          if(width===1400)assert(layout.reading.height>330,'The expanded reader uses more than the old 260px reading area');
        }
      }
      await page.setViewportSize({width:620,height:760});await pre.focus();await page.keyboard.press('PageDown');
      await page.waitForFunction(()=>document.querySelector('.text-file-preview pre').scrollTop>0,null,{timeout:3000}).catch(async error=>{
        console.error('Text reading focus:',await pre.evaluate(el=>({active:document.activeElement?.outerHTML.slice(0,160),tabIndex:el.tabIndex,scroll:el.scrollTop,client:el.clientHeight,height:el.scrollHeight,overflow:getComputedStyle(el).overflowY})));throw error;
      });
      assert(await pre.evaluate(el=>el.scrollTop>0),'Native keyboard reading scrolls the source without moving the board');
      await page.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.locator('#dialog').evaluate(el=>el.open),false);
      assert.equal(await(await fetch(base+'/api/media/'+file.id)).text(),file.original,'Reader styling cannot rewrite the file');
    }
    assert.deepEqual(await page.evaluate(()=>board),authoredBeforeText,'Reading retains inline file geometry and all authored content');
    await page.evaluate(()=>{board.nodes=board.nodes.filter(n=>n.id!=='text-source');render()});
    assert.deepEqual(await page.evaluate(()=>board),authoredBeforeDocuments);
    await page.setViewportSize({width:1400,height:940});
    console.log('Text reading: TXT/Markdown/CSV source, inline/expanded captions, long full names, usable compact/short reader, keyboard scrolling and unchanged originals passed');
    // Connection descriptions are source text. Longer labels must fit near
    // their line instead of disappearing beneath the connected notes.
    const label = '对照资料与自己的观察，说明这两段记录之间的具体联系，以及还有哪些细节需要进一步确认。';
    await page.evaluate(label => {
      board.nodes = [
        {id:'label-start',type:'note',title:'一段观察',body:'保留这段原文。',x:40,y:150,w:220,h:180,sizeMode:'manual',color:'#fff0aa'},
        {id:'label-end',type:'note',title:'另一段观察',body:'自己的记录。',x:700,y:150,w:220,h:180,sizeMode:'manual',color:'#dcebc7'}
      ];board.edges=[{id:'reading-link',from:'label-start',to:'label-end',fromSide:'right',toSide:'left',portsExplicit:true,label}];
      board.view={x:0,y:0,z:1};selected.clear();editorId=null;edgeId=null;history=[];future=[];render();
    }, label);
    const linkedNodes = await page.evaluate(() => clone(board.nodes)), originalEdge = await page.evaluate(() => clone(board.edges));
    const connector = page.locator('[data-edge=reading-link]'), description = connector.locator('text');
    for (const preset of ['resolve','paper','slate']) for (const zoom of [.65,1,2]) {
      await page.evaluate(({preset,zoom})=>{whiteboardAppearance.apply({preset,custom:{},note:'#fff0aa'});board.view.z=zoom;moveView();drawEdges()}, {preset,zoom});
      const bounds=await description.evaluate(el=>({width:el.getBBox().width,height:el.getBBox().height,lines:[...el.children].map(span=>span.textContent)}));
      assert(bounds.width<=242&&bounds.height<=48.1&&bounds.lines.length>1&&bounds.lines.length<=3,'Long connection stays in a bounded multiline description');
      assert.equal(bounds.lines.join(''),label,'This ordinary description stays completely readable, without losing its end');
      assert(bounds.lines.every(line=>line.length>=6),'Avoid a two-character orphan in this three-line description');
      assert.equal(await connector.locator('title').textContent(),label);assert.equal(await description.getAttribute('aria-label'),label);
      assert((await contrast('[data-edge=reading-link] text','#canvas','fill')).ratio>=4.5);
      assert.deepEqual(await page.evaluate(()=>board.nodes),linkedNodes);assert.deepEqual(await page.evaluate(()=>board.edges),originalEdge);
    }
    await page.evaluate(()=>{board.view.z=1;moveView();window.keptLabel=document.querySelector('[data-edge=reading-link] text');window.keptSpans=[...keptLabel.children];window.keptPath=document.querySelector('[data-edge=reading-link] .connector-line').getAttribute('d');edgeId='reading-link';drawEdges()});
    assert(await connector.evaluate(el=>el.classList.contains('selected')));
    assert(await page.evaluate(()=>document.querySelector('[data-edge=reading-link] text')===keptLabel&&keptSpans.every((span,i)=>span===keptLabel.children[i])&&document.querySelector('[data-edge=reading-link] .connector-line').getAttribute('d')===keptPath),'Selection retains label elements and the original line');
    await description.dblclick();assert.equal(await page.locator('#nameInput').inputValue(),label,'Editing opens the complete source');
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await page.evaluate(()=>board.edges),originalEdge);
    const startCard=await page.locator('[data-id=label-start]').boundingBox(),labelBeforeMove=await description.boundingBox();
    await page.keyboard.down('Control');await page.mouse.move(startCard.x+20,startCard.y+20);await page.mouse.down();await page.mouse.move(startCard.x+50,startCard.y+40,{steps:4});await page.mouse.up();await page.keyboard.up('Control');
    const labelAfterMove=await description.boundingBox();assert(Math.abs(labelAfterMove.x-labelBeforeMove.x-15)<1&&Math.abs(labelAfterMove.y-labelBeforeMove.y-10)<1,'Dragging carries the description with the connection midpoint');
    assert(await page.evaluate(()=>document.querySelector('[data-edge=reading-link] text')===keptLabel&&keptSpans.every((span,i)=>span===keptLabel.children[i])),'Movement reuses the already measured label');
    await page.evaluate(()=>undo());assert.deepEqual(await page.evaluate(()=>board.nodes),linkedNodes);assert.deepEqual(await page.evaluate(()=>board.edges),originalEdge);
    const longLabel='自己的联系 👨‍👩‍👧‍👦 与资料 <b>原文</b> & ABC123 '.repeat(14).trim();
    await description.dblclick();await page.locator('#nameInput').fill(longLabel);await page.getByRole('button',{name:'确定',exact:true}).click();
    assert.equal(await connector.locator('title').textContent(),longLabel);assert.equal(await description.getAttribute('aria-label'),longLabel);
    assert.equal(await connector.locator('b').count(),0,'Markup in a label remains literal text');
    assert(await description.evaluate(el=>el.lastElementChild.textContent.endsWith('…')&&el.children.length===3&&el.getBBox().width<=242),'Very long labels have a bounded excerpt with their whole source still available');
    assert(await description.evaluate(el=>[...el.children].every(span=>!span.textContent.includes('👨')||span.textContent.includes('👨‍👩‍👧‍👦'))),'Wrapping preserves an emoji grapheme');
    await description.dblclick();assert.equal(await page.locator('#nameInput').inputValue(),longLabel);await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.evaluate(()=>undo());assert.deepEqual(await page.evaluate(()=>board.edges),originalEdge);await page.evaluate(()=>redo());
    assert.equal(await connector.locator('title').textContent(),longLabel);assert(await page.evaluate(()=>persist()));
    const savedLinkedBoard=await page.evaluate(()=>clone(board));await page.reload();await page.waitForFunction(()=>board&&!loading&&window.whiteboardAppearance);
    assert.deepEqual(await page.evaluate(()=>board),savedLinkedBoard,'Saving and reopening retain the full label and manual note geometry');
    const reopened=page.locator('[data-edge=reading-link]');assert.equal(await reopened.locator('title').textContent(),longLabel);
    await page.evaluate(()=>{board.edges[0].label='联系 ABC 123';render()});assert.equal(await reopened.locator('text tspan').count(),1,'Short descriptions remain a single line');
    await page.evaluate(()=>{board.edges[0].label='';render()});assert.equal(await reopened.locator('text,title').count(),0,'Removing a label also removes its old source hint');
    console.log('Connection reading: bounded balanced labels, full original hints/editing, graphemes, themes/zoom, stable selection, undo/redo and saved reopening passed');
    assert.deepEqual(errors, []);
    console.log('Appearance: readable custom panels and canvas, selection over authored content, JSON, saved preferences and unchanged note colours/geometry passed');
  } finally {
    if (browser) await browser.close();
    if (server.exitCode === null && server.signalCode === null) {server.kill(); await new Promise(resolve => server.once('exit', resolve));}
    const resolved = path.resolve(temporary); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
