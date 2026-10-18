const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn,execFileSync}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-palette-references-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const board={format:'creative-board',version:1,name:'Palette reference fixture',nodes:[{id:'kept',type:'note',title:'Supplied original title',body:'Supplied original text\nSecond retained line.',x:50,y:70,w:360,h:240,sizeMode:'manual',color:'#fff0aa',tags:[]}],edges:[],view:{x:0,y:0,z:1}};
  assert((await fetch(base+'/api/boards/palette-reference',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(board)})).ok);
  const before=await(await fetch(base+'/api/boards/palette-reference')).text();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const context=await browser.newContext({viewport:{width:1360,height:900}}),p=await context.newPage(),errors=[],external=[];p.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(!r.url().startsWith(base)&&/^https?:/.test(r.url()))external.push(r.url())});
  if(process.env.PALETTES_CAPTURE_BASELINE)for(const name of ['appearance.js','refinement.css'])await p.route(base+'/'+name,r=>r.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:execFileSync('git',['show','11f0fe6:'+name],{cwd:root})}));
  await p.goto(base+'/index.html?board=palette-reference');await p.waitForFunction(()=>boardId==='palette-reference'&&!loading&&whiteboardAppearance);
  const photo=async name=>{if(process.env.PALETTES_IMAGES){fs.mkdirSync(process.env.PALETTES_IMAGES,{recursive:true});await p.screenshot({path:path.join(process.env.PALETTES_IMAGES,name+'.png')})}};
  await p.evaluate(()=>{openEditor('kept');$('body').focus();$('body').setSelectionRange(2,12,'backward');whiteboardAppearance.open()});
  if(process.env.PALETTES_CAPTURE_BASELINE){await photo('00-original-six');return}
  const ids=['flexoki-light','flexoki-dark','catppuccin-latte','catppuccin-frappe','catppuccin-macchiato','catppuccin-mocha','rose-pine','rose-pine-moon','rose-pine-dawn','nord-dark','nord-light'];
  assert.equal(await p.locator('[data-preset]').count(),17);assert.deepEqual(await p.evaluate(()=>Object.keys(whiteboardAppearance.paletteSources)),ids);
  const authored=await p.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future),view:clone(view())}));
  const luminance=hex=>hex.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0),ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  if(process.env.PALETTES_FROM!=='continuity'){
  for(const id of ids){
   await p.locator('[data-preset="'+id+'"]').click();
   const value=await p.evaluate(id=>{const source=whiteboardAppearance.paletteSources[id],raw=whiteboardAppearance.palettes[id],style=document.documentElement.style;return{source,raw,pref:whiteboardAppearance.read(),canvas:style.getPropertyValue('--ui-canvas'),tone:document.documentElement.dataset.uiTone,tokens:Object.fromEntries(['bg','panel','raised','field','hover','selected','text','muted','focus','link'].map(k=>[k,style.getPropertyValue('--ui-'+k)]))}},id);
   assert.equal(value.pref.preset,id);assert.equal(value.canvas,value.raw.canvas);assert.equal(value.tone,value.source.tone);
   assert.equal(await p.locator('.appearance-source a').getAttribute('href'),value.source.url);assert.equal(await p.locator('.appearance-source a').getAttribute('rel'),'noopener noreferrer');assert.equal(await p.locator('[data-preset="'+id+'"]').getAttribute('aria-pressed'),'true');
   for(const bg of ['bg','panel','raised','field','hover','selected']){for(const fg of ['text','muted','link'])assert(ratio(value.tokens[fg],value.tokens[bg])>=4.5,id+' '+fg+'/'+bg);assert(ratio(value.tokens.focus,value.tokens[bg])>=3,id+' focus/'+bg)}
  }
  assert.deepEqual(await p.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future),view:clone(view())})),authored);
  // Published source anchors, independent of the application's role conversion.
  assert.deepEqual(await p.evaluate(()=>['flexoki-light','catppuccin-latte','rose-pine-dawn','nord-dark'].map(id=>whiteboardAppearance.palettes[id].canvas)),['#f2f0e5','#eff1f5','#faf4ed','#2e3440']);
  assert.equal(await p.evaluate(()=>whiteboardAppearance.read().note),'#fff0aa');assert.deepEqual(external,[],'Choosing a palette does not fetch fonts, images or remote palette code');
  console.log('Eleven attributed public palettes: exact source anchors, real applied canvas/tone, text/link/focus contrast and unchanged original content/history/view passed');
  }
  await p.locator('[data-preset="rose-pine-dawn"]').click();await photo('01-dawn-wide');await p.locator('#appearanceName').fill('My sourced dawn');await p.locator('#appearanceSave').click();await p.locator('[data-preset="nord-dark"]').click();await p.locator('#appearanceRevert').click();assert.equal(await p.evaluate(()=>whiteboardAppearance.read().preset),'resolve');
  await p.getByRole('button',{name:'应用预设：My sourced dawn',exact:true}).click();await p.locator('#appearanceDone').click();await p.locator('#appearanceDialog').waitFor({state:'detached'});assert.deepEqual(await p.locator('#body').evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),[2,12,'backward']);
  await p.reload();await p.waitForFunction(()=>board&&!loading&&whiteboardAppearance.read().preset==='rose-pine-dawn');await p.evaluate(()=>whiteboardAppearance.open());assert.equal(await p.locator('.appearance-source a').getAttribute('href'),'https://rosepinetheme.com/palette/');
  await p.setViewportSize({width:390,height:700});for(const id of ['flexoki-light','catppuccin-mocha','rose-pine-dawn','nord-light']){
   const button=p.locator('[data-preset="'+id+'"]');await button.click();assert(await button.evaluate(el=>{const r=el.getBoundingClientRect(),d=document.querySelector('#appearanceDialog').getBoundingClientRect();return r.left>=d.left&&r.right<=d.right&&r.height>=44&&el.scrollWidth<=el.clientWidth}));
  }
  await p.locator('[data-preset="catppuccin-mocha"]').click();await photo('02-mocha-narrow');
  await p.setViewportSize({width:320,height:220});await p.locator('[data-preset="flexoki-dark"]').click();await p.locator('#appearanceDone').scrollIntoViewIfNeeded();assert(await p.locator('#appearanceDone').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}));await p.locator('#appearanceDone').click();
  assert.equal(await(await fetch(base+'/api/boards/palette-reference')).text(),before);assert.deepEqual(errors,[]);
  console.log('Named sourced preferences, revert, reload, original reverse selection and390px/320x220 choices/exits passed; stored original board exact');
  const shell=await context.newPage();await shell.setViewportSize({width:1200,height:820});await shell.goto(base+'/?board=palette-reference');await shell.waitForFunction(()=>pane(current())?.state().boardId==='palette-reference');const frame=shell.frames().find(f=>new URL(f.url()).searchParams.get('board')==='palette-reference'&&new URL(f.url()).searchParams.get('pane')==='1');await frame.waitForFunction(()=>board&&!loading);await shell.evaluate(()=>whiteboardAppearance.open());await shell.locator('[data-preset="nord-light"]').click();await frame.waitForFunction(()=>document.documentElement.dataset.appearance==='nord-light');assert.equal(await frame.evaluate(()=>getComputedStyle(canvas).backgroundColor),'rgb(229, 233, 240)');await shell.locator('#appearanceDone').click();await shell.close();assert.equal(await(await fetch(base+'/api/boards/palette-reference')).text(),before);
  console.log('The original shell broadcasts a new sourced preset to its real mounted editor; no content migration or document save');
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
