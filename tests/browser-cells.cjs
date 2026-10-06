const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),{spawn}=require('child_process'),assert=require('assert');
const {chromium}=require('playwright');
(async()=>{const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-cells-'));const port=await require('./browser-port.cjs')();const base='http://127.0.0.1:'+port,proc=spawn(process.env.PYTHON||'python',[root+'/server.py'],{env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'},windowsHide:true});let browser;try{
for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});const ctx=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/index.html');await p.waitForFunction(()=>board&&!loading&&typeof cellItemGrid==='function');
await p.evaluate(()=>{board.nodes=[{id:'n',type:'note',color:'#cde8fb',fontSize:17,titleFontSize:24,title:'声音记录',body:'留意开头的短促声。',x:40,y:100,w:300,h:220,tags:[]},{id:'t',type:'table',title:'镜头表',columns:['画面','声音'],rows:[['',''],['下一镜','']],x:450,y:100,w:780,h:500,tags:[]}];board.edges=[];board.view={x:0,y:0,z:1};selected=new Set(['n']);render();canvas.focus();change()});
await p.keyboard.press('Control+c');await p.evaluate(()=>openEditor('t'));await p.locator('[data-row="0"][data-col="0"]').click();await p.keyboard.press('Control+v');await p.waitForFunction(()=>board.nodes.find(n=>n.id==='t').cellItems?.[0]?.[0]?.length===1);assert.equal(await p.locator('[data-cell="0,0"] [data-cell-note-field="body"]').inputValue(),'留意开头的短促声。');assert.equal(await p.locator('[data-cell="0,0"] .cell-content').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(205, 232, 251)','Pasted notes keep their authored paper colour');await checkCopyFonts(p,'[data-cell="0,0"] .cell-content',24,17);await p.locator('[data-cell="0,0"] [data-cell-note-field="body"]').fill('这里改的是单元格里的副本。');assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='n').body),'留意开头的短促声。');
// Upload a tiny valid PCM WAV and drag it from the same library payload used by the UI.
const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);const response=await fetch(base+'/api/assets/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':'tap.wav'},body:wav});assert(response.ok);const audio=await response.json();await p.evaluate(()=>loadAssets());const dt=await p.evaluateHandle(id=>{const d=new DataTransfer();d.setData('application/x-creative-assets',JSON.stringify([id]));return d},audio.id);await p.locator('[data-cell="0,1"]').dispatchEvent('drop',{dataTransfer:dt});await p.waitForFunction(()=>!!document.querySelector('[data-cell="0,1"] audio'));await p.locator('[data-cell="0,1"] audio').evaluate(async el=>{await el.play();el.pause()});
await p.evaluate(()=>{const n=board.nodes.find(n=>n.id==='t');moveTable(n,'row',0,1);moveTable(n,'column',0,1)});assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='t').cellItems[1][1][0].body),'这里改的是单元格里的副本。');assert.equal(await p.locator('[data-cell="1,0"] audio').count(),1);await p.evaluate(()=>persist());await p.reload();await p.waitForFunction(()=>board&&!loading);assert.equal(await p.locator('.read-layout [data-cell="1,0"] audio').count(),1);assert.equal(await p.locator('[data-cell="1,1"] .cell-content').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(205, 232, 251)','Paper colour survives row/column movement and reload');await checkCopyFonts(p,'[data-cell="1,1"] .cell-content',24,17);await p.waitForTimeout(150);assert(await p.locator('.read-layout [data-cell="1,0"] > textarea').isHidden());assert(await p.locator('.read-layout [data-cell="1,0"] [data-cell-note-field="body"]').isHidden());const mediaHeight=await p.locator('.read-layout [data-cell="1,0"] .cell-content').evaluate(e=>e.getBoundingClientRect().height);assert(mediaHeight<145,'Audio should not reserve empty body space: '+mediaHeight);await p.evaluate(()=>showWorkspaceTab('manager'));if(process.env.CELLS_SCREENSHOT)await p.screenshot({path:process.env.CELLS_SCREENSHOT});await p.evaluate(()=>openEditor('t'));await p.locator('[data-cell="1,1"] .cell-content').hover();await p.locator('[data-cell="1,1"] [data-cell-extract]').click();assert.equal(await p.evaluate(()=>board.nodes.length),3);assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id!=='n'&&n.id!=='t').color),'#cde8fb','Taking out a copy retains its authored colour');assert.deepEqual(await p.evaluate(()=>{const n=board.nodes.find(n=>n.id!=='n'&&n.id!=='t');return [n.titleFontSize,n.fontSize]}),[24,17],'Taking out a copy retains both authored font sizes');await p.evaluate(()=>openEditor('t'));await p.locator('[data-cell="1,1"] .cell-content').hover();await p.locator('[data-cell="1,1"] [data-cell-remove]').click();assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='t').cellItems[1][1].length),0);await p.evaluate(()=>undo());assert.equal(await p.evaluate(()=>board.nodes.find(n=>n.id==='t').cellItems[1][1].length),1);
console.log('单元格：便签复制粘贴、独立编辑、音频拖入播放、行列移动、保存重载、取出和撤销通过');
await p.evaluate(()=>{selected=new Set(['n']);openEditor('n')});await p.locator('#body').click();await p.keyboard.press('Control+End');for(let i=0;i<35;i++){await p.keyboard.insertText('这一行继续记录拍摄时观察到的细节。');await p.keyboard.press('Enter')}await p.waitForTimeout(100);assert(await p.locator('.live-layout .edit-scroll').evaluate(e=>e.scrollTop)>400);await p.keyboard.press('Control+Home');await p.waitForTimeout(100);assert(await p.locator('.live-layout .edit-scroll').evaluate(e=>e.scrollTop)<130);
await p.evaluate(()=>openEditor('t'));await p.locator('[data-row="1"][data-col="1"]').click();for(let i=0;i<40;i++){await p.keyboard.insertText('继续写分镜说明');await p.keyboard.press('Enter')}await p.waitForTimeout(100);assert(await p.locator('.live-layout .table-scroll').evaluate(e=>e.scrollTop)>400);await p.keyboard.press('Control+Home');await p.waitForTimeout(100);console.log('长文编辑：便签与表格跟随输入光标、返回开头通过');await verifyCopyTypography(p);await verifyPaperSurfaces(p,audio.id);assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});


// The same content stays recognisable on the board and inside a table, in both UI tones.
async function verifyPaperSurfaces(page,audioId){
 await page.evaluate(audioId=>{
  whiteboardAppearance.apply({preset:'resolve',custom:{},note:'#fff0aa'},true);
  const notes=[
   {id:'blue',color:'#cde8fb'},
   {id:'yellow',color:'#fff0aa'},
   {id:'dark',color:'#353940'},
   {id:'neutral',color:'#ffffff'},
   {id:'default'},
   {id:'audio',color:'#f8d2c9',mediaId:audioId},
   {id:'missing',color:'#dbecc7',assetId:'unavailable-reference'}
  ].map((n,i)=>({type:'note',title:'记录 '+i,body:'保留自己的观察。',annotation:'之后再确认。',tags:[],sizeMode:'manual',x:40,y:100+i*200,w:280,h:170,...n}));
  const table={id:'papers',type:'table',title:'内容归档',columns:['内容'],rows:notes.map(()=>['']),x:400,y:100,w:700,h:550,tags:[]};
  cellItemGrid(table);notes.forEach((n,i)=>table.cellItems[i][0]=[{...clone(n),id:'copy-'+n.id}]);
  table.rows.push([''],['']);cellItemGrid(table);
  table.cellItems[notes.length][0]=[{id:'nested',type:'table',title:'内含表格',color:'#cde8fb',columns:['内容'],rows:[['观察']]}];
  table.cellItems[notes.length+1][0]=[{id:'invalid',type:'note',color:'#ffffff;--unexpected:1',body:'原有内容。'}];
  editorId=null;selected.clear();board.nodes=[...notes,table];board.edges=[];board.view={x:0,y:0,z:1};render();
 },audioId);
 const content=await page.evaluate(()=>JSON.stringify(board));
 for(const options of [{preset:'resolve',custom:{}},{preset:'paper',custom:{}},{preset:'slate',custom:{}},
  {preset:'resolve',custom:{panel:'#ffffff'}},{preset:'resolve',custom:{panel:'#090b0e'}}]){
  await page.evaluate(options=>whiteboardAppearance.apply({...options,note:'#fff0aa'},true),options);
  const surfaces=await page.evaluate(()=>{
   const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
   const light=value=>rgb(value).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
   return board.nodes.filter(n=>n.id!=='papers').map((n,i)=>{
    const card=document.querySelector('[data-id="'+n.id+'"]'),cell=document.querySelector('[data-id="papers"] [data-cell="'+i+',0"] .cell-content'),style=getComputedStyle(cell),ink=getComputedStyle(cell.querySelector('[data-cell-note-field=body]')).color;
    const a=light(ink),b=light(style.backgroundColor);
    return {id:n.id,card:getComputedStyle(card).backgroundColor,cell:style.backgroundColor,ink,scheme:style.colorScheme,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
   });
  });
  for(const surface of surfaces){
   const neutral=['neutral','audio','missing'].includes(surface.id);
   if(!neutral)assert.equal(surface.cell,surface.card,'Authored/default paper colour matches: '+JSON.stringify({options,surface}));
   else assert.equal(surface.cell,await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ui-panel').trim()).then(hex=>'rgb('+hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')+')'));
   assert(surface.ratio>=4.5,'Readable cell text: '+JSON.stringify({options,surface}));
   assert.equal(surface.scheme,neutral?await page.evaluate(()=>document.documentElement.dataset.uiTone):surface.id==='dark'?'dark':'light');
  }
  const extras=await page.evaluate(()=>{
   const cells=document.querySelectorAll('[data-id="papers"] .cell-content');
   return {nested:getComputedStyle(cells[7]).backgroundColor,panel:getComputedStyle(document.documentElement).getPropertyValue('--ui-panel').trim(),invalid:getComputedStyle(cells[8]).backgroundColor,unexpected:cells[8].style.getPropertyValue('--unexpected')};
  });
  assert.equal(extras.nested,'rgb('+extras.panel.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')+')','Nested table uses the neutral interface surface');
  assert.equal(extras.invalid,'rgb(255, 240, 170)','Invalid stored colour falls back to default paper');
  assert.equal(extras.unexpected,'','Stored colour cannot introduce arbitrary style properties');
  assert.equal(await page.evaluate(()=>JSON.stringify(board)),content,'Appearance never changes authored content, copies or layout');
 }
 await page.evaluate(()=>whiteboardAppearance.apply({preset:'resolve',custom:{},note:'#fff0aa'},true));
 console.log('纸色：原色、深色文字、默认便签、媒体、失效文件与内嵌表格在深浅主题中保持清晰，原文和尺寸不变');
}


async function checkCopyFonts(page,selector,title,body){
 const sizes=await page.locator(selector).evaluate(el=>Object.fromEntries([...el.querySelectorAll('[data-cell-note-field]')].map(field=>[field.dataset.cellNoteField,getComputedStyle(field).fontSize])));
 assert.equal(sizes.title,title+'px','A copy keeps its title size');
 for(const key of ['body','userText','annotation'])if(key in sizes)assert.equal(sizes[key],body+'px','A copy keeps its '+key+' size');
}

async function verifyCopyTypography(page){
 await page.evaluate(()=>{
  const notes=[{id:'large',fontSize:20,titleFontSize:32},{id:'small',fontSize:16,titleFontSize:24},{id:'default'},{id:'title-only',titleFontSize:28}]
   .map((n,i)=>({type:'note',title:'观察 '+i,body:'第一段观察。\n第二段观察。',userText:'自己的补充。',annotation:'之后确认。',color:'#cde8fb',sizeMode:'manual',x:40,y:80+i*220,w:280,h:200,tags:[],...n}));
  const table={id:'font-table',type:'table',title:'内容归档',fontSize:21,titleFontSize:26,columns:['内容','补充'],rows:[['原有文字',''],['','']],columnWidths:[340,340],tags:[],x:380,y:80,w:800,h:650};
  cellItemGrid(table);table.cellItems[0][0]=notes.slice(0,2).map(n=>({...clone(n),id:'copy-'+n.id}));
  table.cellItems[0][1]=[{...clone(notes[2]),id:'copy-default'}];table.cellItems[1][1]=[{...clone(notes[3]),id:'copy-title-only'}];
  editorId=null;selected=new Set([table.id]);board.nodes=[...notes,table];board.edges=[];board.view={x:0,y:0,z:1};render();
 });
 const root='[data-id="font-table"]',copies=await page.evaluate(()=>JSON.stringify(board.nodes.find(n=>n.id==='font-table').cellItems));
 const originals=await page.evaluate(()=>JSON.stringify(board.nodes.filter(n=>n.id!=='font-table')));
 const frame=await page.evaluate(()=>{const n=board.nodes.find(n=>n.id==='font-table');return [n.x,n.y,n.w,n.h]});
 async function defaultLayout(scope=root){
  return page.locator(scope+' [data-cell="0,1"] .cell-content').evaluate(el=>{
   const title=el.querySelector('[data-cell-note-field=title]'),body=el.querySelector('[data-cell-note-field=body]'),annotation=el.querySelector('[data-cell-note-field=annotation]'),supplement=el.querySelector('[data-cell-note-field=userText]');
   const t=getComputedStyle(title),b=getComputedStyle(body),a=getComputedStyle(annotation);
   return {title:parseFloat(t.fontSize),body:parseFloat(b.fontSize),titleLine:t.lineHeight,bodyLine:b.lineHeight,annotationLine:a.lineHeight,
    titleGap:parseFloat(t.marginBottom),annotationBorder:a.borderTopStyle,annotationGap:parseFloat(a.marginTop),annotationPadding:parseFloat(a.paddingTop),
    separated:annotation.getBoundingClientRect().top>supplement.getBoundingClientRect().bottom};
  });
 }
 const readingLayout=await defaultLayout();
 assert(readingLayout.title>readingLayout.body,'Default title and body have distinct reading hierarchy');
 assert(readingLayout.titleGap>0&&readingLayout.annotationGap>0&&readingLayout.annotationPadding>0&&readingLayout.separated,'Title and annotation are separated from main text');
 assert.equal(readingLayout.annotationBorder,'solid');
 for(const z of [.65,1,1.35]){
  await page.evaluate(z=>{view().z=z;moveView()},z);
  assert.deepEqual(await defaultLayout(),readingLayout,'Reading hierarchy stays consistent across board zooms');
 }
 await page.evaluate(()=>{view().z=1;moveView()});
 async function unchangedFonts(scope=root){
  await checkCopyFonts(page,scope+' [data-cell="0,0"] [data-cell-item="0"]',32,20);
  await checkCopyFonts(page,scope+' [data-cell="0,0"] [data-cell-item="1"]',24,16);
  await checkCopyFonts(page,scope+' [data-cell="0,1"] .cell-content',16,14);
  await checkCopyFonts(page,scope+' [data-cell="1,1"] .cell-content',28,14);
  assert.equal(await page.evaluate(()=>JSON.stringify(board.nodes.find(n=>n.id==='font-table').cellItems)),copies,'Table controls do not rewrite independent copies');
  assert.equal(await page.evaluate(()=>JSON.stringify(board.nodes.filter(n=>n.id!=='font-table'))),originals,'Originals retain their typography and text');
  assert.deepEqual(await page.evaluate(()=>{const n=board.nodes.find(n=>n.id==='font-table');return [n.x,n.y,n.w,n.h]}),frame,'Typography does not resize the manually sized table');
 }
 await unchangedFonts();
 await page.evaluate(()=>openEditor('font-table'));await unchangedFonts();
 assert.deepEqual(await defaultLayout(),readingLayout,'Entering edit mode keeps line spacing and hierarchy');
 await page.locator('#textSizeTools > summary').click();
 await page.locator('#noteBodySize').fill('29');await page.locator('#noteBodySize').press('Tab');
 await page.locator('#noteTitleSize').fill('36');await page.locator('#noteTitleSize').press('Tab');
 assert.equal(await page.locator(root+' [data-row="0"][data-col="0"]').evaluate(el=>getComputedStyle(el).fontSize),'29px','Plain cell text follows the table size');
 assert.equal(await page.locator(root+' #title').evaluate(el=>getComputedStyle(el).fontSize),'36px','The table title follows its own size');
 await unchangedFonts();
 await page.locator('#resetNoteSize').click();await unchangedFonts();
 await page.evaluate(()=>{canvas.focus();undo()});await unchangedFonts();
 assert.equal(await page.evaluate(()=>board.nodes.find(n=>n.id==='font-table').fontSize),29);
 await page.evaluate(()=>redo());await unchangedFonts();
 assert.equal(await page.evaluate(()=>board.nodes.find(n=>n.id==='font-table').fontSize),undefined);
 await page.evaluate(()=>whiteboardReading.open('font-table'));
 await unchangedFonts('#immersiveSurface');
 assert.deepEqual(await defaultLayout('#immersiveSurface'),readingLayout,'Immersive editing keeps the cell reading hierarchy');
 const fields=await page.locator('#immersiveSurface .cell-content textarea').evaluateAll(fields=>fields.filter(e=>e.value.trim()).map(e=>({scroll:e.scrollHeight,height:e.clientHeight})));
 assert(fields.every(e=>e.scroll<=e.height+2),'Larger copied text gets enough reading/editing height: '+JSON.stringify(fields));
 await page.keyboard.press('Escape');await unchangedFonts();
 assert.equal(await page.evaluate(async()=>{change();return persist()}),true);
 await page.reload();await page.waitForFunction(()=>board&&!loading);
 await unchangedFonts();
 assert.deepEqual(await defaultLayout(),readingLayout,'Reopening keeps the same hierarchy');
 await page.evaluate(()=>openEditor('font-table'));
 await page.locator(root+' [data-cell="0,1"] [data-cell-note-field=annotation]').fill('');
 await page.locator('#inlineDone').click();
 assert.equal(await page.locator(root+' [data-cell="0,1"] [data-cell-note-field=annotation]').count(),0,'An empty annotation leaves no separator or blank space');
 assert.equal(await page.evaluate(()=>JSON.stringify(board.nodes.filter(n=>n.id!=='font-table'))),originals);
 await page.evaluate(()=>{canvas.focus();undo()});await unchangedFonts();
 assert.deepEqual(await defaultLayout(),readingLayout,'Undo restores the annotation and its separation');
 console.log('阅读层级：默认标题正文、备注间隔、常用缩放、编辑与沉浸切换、重开及清空备注后撤销通过');
 console.log('格内字号：同格多张便签各自保留标题、正文、补充和备注字号；表格调整/重置、撤销重做、沉浸编辑及保存重开通过');
}
