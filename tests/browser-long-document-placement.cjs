const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),{spawn}=require('node:child_process'),{chromium}=require('playwright');

function imageBytes(){
 const w=640,h=400,pixels=Buffer.alloc(h*(w*3+1));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const colour=x>90&&x<280&&y>80&&y<320?[109,141,160]:x>340&&x<560&&y>130&&y<270?[204,157,97]:[226,232,226];
  for(let c=0;c<3;c++)pixels[y*(w*3+1)+1+x*3+c]=colour[c];
 }
 const crc=bytes=>{let c=-1;for(const n of bytes){c^=n;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1}return(c^-1)>>>0};
 const chunk=(type,data)=>{const t=Buffer.from(type),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return b};
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));

async function exercise(p,{entry,images,widths=[1360,320],parts=['task','boundaries','empty'],proof={groups:[],errors:[]}}={}){
 const base=new URL(entry).origin,bytes=imageBytes();
 const loaded=()=>p.waitForFunction(()=>current()&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading);
 const frame=async()=>await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();
 const save=f=>f.waitForFunction(()=>!dirty&&!contentDirty&&!savePromise&&!savingContent);
 const shot=async name=>{if(images){fs.mkdirSync(images,{recursive:true});await p.screenshot({path:path.join(images,name+'.png')})}};
 const titleBounds=field=>field.evaluate(el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el),ctx=document.createElement('canvas').getContext('2d');
  ctx.font=[s.fontStyle,s.fontVariant,s.fontWeight,s.fontSize,s.fontFamily].join(' ');
  return{x:r.x+parseFloat(s.paddingLeft),y:r.y,width:ctx.measureText(el.value||el.textContent).width,height:r.height};
 });
 const select=async(f,id)=>{
  const node=f.locator('#nodes>.node[data-id="'+id+'"]'),r=await node.boundingBox(),c=await f.locator('#canvas').boundingBox();
  const x=(Math.max(r.x,c.x)+Math.min(r.x+r.width,c.x+c.width))/2,y=Math.max(r.y,c.y)+Math.min(30,Math.min(r.y+r.height,c.y+c.height)-Math.max(r.y,c.y))/2;
  await p.touchscreen.tap(x,y);return node;
 };
 const createDocument=async f=>{
  if(await f.locator('#addDocument').isVisible())await f.locator('#addDocument').tap();
  else{await f.locator('#creationMore').tap();await f.getByRole('menuitem',{name:'写长文',exact:true}).tap()}
  await f.locator('#immersiveSurface [data-document-paper]').waitFor();
 };
 for(const width of parts.includes('task')?widths:[]){
  await p.setViewportSize({width,height:820});await p.goto(base+'/?create=1');await p.locator('#newBoardName').fill('Supplied document task '+width);await p.locator('#createBoard').tap();await p.waitForFunction(w=>current()?.name==='Supplied document task '+w&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading,width);let f=await frame();
  const chooser=p.waitForEvent('filechooser');await f.getByRole('button',{name:'添加文件',exact:true}).tap();await(await chooser).setFiles({name:'supplied-reference.png',mimeType:'image/png',buffer:bytes});
  await f.waitForFunction(()=>board.nodes.length===1&&!whiteboardImports.pending()&&!dirty&&!savePromise);const before=await f.evaluate(()=>({nodes:clone(board.nodes),view:clone(view()),history:history.length}));
  const source=before.nodes[0],catalog=await(await p.request.get(base+'/api/assets')).json();await createDocument(f);await f.locator('#title').fill('给定观察记录');
  await f.locator('.document-paragraph [data-cell-note-field=body]').first().fill('给定原始段落一。\n\n给定原始段落二。');
  await f.locator('.document-insert button').filter({hasText:'便签'}).tap();await f.locator('.document-note [data-cell-note-field=title]').last().fill('给定重点');await f.locator('.document-note [data-cell-note-field=body]').last().fill('给定重点原文。');
  await f.locator('.document-insert button').filter({hasText:'表格'}).tap();await f.locator('.document-embedded-table [data-doc-column="0"]').fill('给定项目');await f.locator('.document-embedded-table [data-doc-row="0"][data-doc-col="1"]').fill('[[给定重点]]');
  await f.locator('.document-insert button').filter({hasText:'正文'}).tap();const prose=Array.from({length:24},(_,i)=>'给定接续段落 '+(i+1)+'：保留原始内容。').join('\n');await f.locator('.document-paragraph [data-cell-note-field=body]').last().fill(prose);
  await f.locator('#immersiveReturn').tap();await save(f);const board=await f.evaluate(()=>clone(board)),doc=board.nodes.find(n=>n.documentMode);
  assert.equal(overlap(doc,source),0,'The new document leaves the supplied reference uncovered');assert.deepEqual(board.nodes.filter(n=>n.id!==doc.id),before.nodes);assert.deepEqual(board.view,before.view,'Creation never moves the existing view to hide the reference elsewhere');assert.equal(doc.w,640);assert.equal(doc.h,720);assert.equal(doc.sizeMode,'manual');
  const title=f.locator('#nodes>.node[data-id="'+doc.id+'"]').getByText('给定观察记录',{exact:true}),r=await titleBounds(title),c=await f.locator('#canvas').boundingBox();
  (proof.titleVisibility??=[]).push({width,text:r,canvas:c});await shot(width+'-reference-and-document');
  assert(r.width>0&&r.x>=c.x&&r.x+r.width<=c.x+c.width&&r.y>=c.y&&r.y+r.height<=c.y+c.height,'The reading edge and complete title are visible without uncovering or fitting');
  const id=await f.evaluate(()=>boardId);await p.getByRole('button',{name:'关闭标签：'+board.name,exact:true}).tap();await p.locator('.add-tab[data-side=left]').tap();await p.locator('#boardQuery').fill(board.name);await p.locator('[data-board-choice="'+id+'"]').tap();await loaded();f=await frame();assert.deepEqual(await f.evaluate(()=>board.nodes),board.nodes);
  const node=await select(f,doc.id);await node.locator('.block-read').tap();await f.locator('.document-embedded-table [data-doc-row="1"][data-doc-col="0"]').fill('给定接续记录');await f.locator('#immersiveReturn').tap();await save(f);const final=await f.evaluate(()=>clone(board));await p.reload();await loaded();f=await frame();assert.deepEqual(await f.evaluate(()=>board.nodes),final.nodes);assert.deepEqual(await(await p.request.get(base+'/api/assets')).json(),catalog);assert.deepEqual(Buffer.from(await(await p.request.get(base+'/api/media/'+source.assetId)).body()),bytes);
  proof.groups.push(width+'px: choose a reference, write a mixed long document, find both originals, close/return, continue its table and reopen exact saved content');
 }
 // These fixtures challenge grouping and creation history, rather than the planner's arithmetic.
 if(parts.includes('boundaries')){
 await p.setViewportSize({width:1360,height:900});await p.goto(base+'/index.html');await p.waitForFunction(()=>board&&!loading&&window.whiteboardDocumentPaper);
 const initial=await p.evaluate(()=>{const p=center();board.nodes=[{id:'given-group',type:'frame',x:p.x-400,y:p.y-300,w:1500,h:1800},{id:'given-paper',type:'note',x:p.x-320,y:p.y-200,w:640,h:720,title:'Keep the original',body:'Supplied text',sizeMode:'manual',opaque:{keep:true}}];board.edges=[];history=[];future=[];selected=new Set(['given-paper']);editorId=null;render();return{nodes:clone(board.nodes),view:clone(view())}});
 await createDocument(p);await p.locator('#immersiveReturn').tap();let value=await p.evaluate(()=>({nodes:clone(board.nodes),group:groupOf(board.nodes.at(-1))?.id,history:history.length,view:clone(view())}));assert.deepEqual(value.nodes.slice(0,-1),initial.nodes);assert.equal(value.group,'given-group');assert.equal(overlap(value.nodes[1],value.nodes[2]),0);assert.equal(value.history,1);assert.deepEqual(value.view,initial.view);
 await p.locator('#canvas').focus();await p.keyboard.press('Control+z');assert.deepEqual(await p.evaluate(()=>board.nodes),initial.nodes);await p.keyboard.press('Control+Shift+z');assert.deepEqual(await p.evaluate(()=>board.nodes),value.nodes);
 await p.evaluate(()=>{const p=center();board.nodes=[{id:'full-group',type:'frame',x:p.x-320,y:p.y-200,w:640,h:720},{id:'occupant',type:'note',x:p.x-320,y:p.y-200,w:640,h:720,title:'Keep this placement',body:'Supplied original',sizeMode:'manual'}];selected.clear();editorId=null;history=[];future=[];render()});const full=await p.evaluate(()=>clone(board.nodes));await createDocument(p);await p.locator('#immersiveReturn').tap();value=await p.evaluate(()=>({nodes:clone(board.nodes),group:groupOf(board.nodes.at(-1))?.id}));assert.deepEqual(value.nodes.slice(0,-1),full);assert.equal(value.group,'full-group');assert.equal(value.nodes[2].x,full[1].x);assert.equal(value.nodes[2].y,full[1].y,'A full group keeps literal placement instead of escaping to a distant position');
 proof.groups.push('Original group ownership, manual originals, one creation Undo/Redo and a full group fallback stay exact');
 }
 if(parts.includes('empty')){
 await p.setViewportSize({width:320,height:820});await p.goto(base+'/?create=1');await p.locator('#newBoardName').fill('Empty narrow document');await p.locator('#createBoard').tap();await p.waitForFunction(()=>current()?.name==='Empty narrow document'&&pane(current())?.state().boardId===current().boardId&&!pane(current()).state().loading);const f=await frame();await f.locator('#emptyDocument').tap();await f.locator('#title').fill('给定空白长文');await f.locator('#immersiveReturn').tap();const r=await titleBounds(f.locator('#nodes>.document-paper').getByText('给定空白长文',{exact:true})),c=await f.locator('#canvas').boundingBox();assert(r.width>0&&r.x>=c.x&&r.x+r.width<=c.x+c.width);await shot('320-empty-document');proof.groups.push('An empty narrow document keeps its reading edge visible without reducing its authored width');
 }
 assert.deepEqual(proof.errors,[]);return proof;
}
module.exports={exercise};
if(require.main===module)(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-long-document-placement-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,proof={complete:false,syntheticOnly:true,groups:[],errors:[],physicalDeviceAccepted:false};let browser;
 const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();
 try{let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const context=await browser.newContext({viewport:{width:1360,height:820},hasTouch:true,reducedMotion:'reduce'});await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===base||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});const p=await context.newPage();p.on('pageerror',e=>proof.errors.push(e.message));await exercise(p,{entry:base,images:process.env.LONG_DOCUMENT_PLACEMENT_IMAGES,widths:process.env.LONG_DOCUMENT_PLACEMENT_WIDTHS?.split(',').map(Number),parts:process.env.LONG_DOCUMENT_PLACEMENT_PARTS?.split(','),proof});proof.complete=true;console.log(JSON.stringify({complete:true,groups:proof.groups}));}
 catch(e){proof.failure=e.stack;throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));proof.ownedServiceStopped=true;proof.syntheticDataRetained=tmp;if(process.env.LONG_DOCUMENT_PLACEMENT_PROOF)fs.writeFileSync(process.env.LONG_DOCUMENT_PLACEMENT_PROOF,JSON.stringify(proof,null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
