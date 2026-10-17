const assert=require('node:assert/strict');
const fixture={format:'creative-board',version:1,name:'Synthetic overlapping papers',nodes:[
 {id:'writer',type:'note',sizeMode:'auto',title:'Supplied writing record',body:Array.from({length:36},(_,i)=>'Supplied synthetic paragraph '+(i+1)+'. Original text stays with this paper.').join('\n\n'),url:'https://example.org/synthetic-source',annotation:'Supplied annotation.',tags:['supplied'],x:40,y:90,w:300,h:1200,color:'#fff0aa'},
 {id:'cover',type:'note',sizeMode:'manual',title:'Supplied neighboring paper',body:'Supplied original neighboring text.',x:40,y:250,w:300,h:145,color:'#e7e2da'},
 {id:'grid',type:'table',title:'Supplied table',body:'',columns:['Supplied column'],columnIds:['supplied-column'],rows:[['Supplied first cell'],['Supplied second cell'],['Supplied third cell']],rowIds:['supplied-row-1','supplied-row-2','supplied-row-3'],cellImages:[[[]],[[]],[[]]],cellItems:[[[]],[[]],[[]]],x:430,y:90,w:420,h:470,tags:[]},
 {id:'grid-cover',type:'note',sizeMode:'manual',title:'Supplied table neighbor',body:'Supplied table neighbor text.',x:470,y:260,w:270,h:145,color:'#e7e2da'}
],edges:[],view:{x:0,y:0,z:1}};

async function exercise(p,url,key,{from=0,to=3,accept=()=>{},snapshot=null}={}){
 const groups=[],record=async(name,label)=>{groups.push(label);if(snapshot)await snapshot(p,name);accept(label)};
 await p.setViewportSize({width:390,height:844});await p.goto(url+(url.includes('?')?'&':'?')+'board='+encodeURIComponent(key),{waitUntil:'domcontentloaded'});await p.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);
 const a=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await a.waitForFunction(()=>board&&!loading&&window.whiteboardReading);
 const node=id=>a.locator('#nodes>.node[data-id="'+id+'"]'),state=()=>a.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),view:clone(view()),history:clone(history),future:clone(future)})),settle=()=>a.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 async function pointInField(field,cover){
  const f=await field.boundingBox(),c=await node(cover).boundingBox(),left=Math.max(f.x,c.x),right=Math.min(f.x+f.width,c.x+c.width),top=Math.max(f.y,c.y),bottom=Math.min(f.y+f.height,c.y+c.height);assert(right-left>10&&bottom-top>10,'The author field and neighboring paper really overlap: '+JSON.stringify({field:f,cover:c}));return{x:(left+right)/2,y:(top+bottom)/2};
 }
 async function hit(point){const origin=await(await a.frameElement()).boundingBox();return a.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);return{id:e?.id,owner:e?.closest('#nodes>.node')?.dataset.id,row:e?.dataset.row,col:e?.dataset.col}}, {x:point.x-origin.x,y:point.y-origin.y})}
 if(from<=0&&to>0){
  await node('writer').locator('[data-preview-id=title]').tap();await node('writer').locator('[data-preview-id=title]').tap();const body=node('writer').locator('#body');await body.waitFor();await settle();
  const before=await state(),el=await body.elementHandle(),point=await pointInField(body,'cover'),target=await hit(point);assert.equal(target.owner,'writer','The overlapping neighbor must not cover the currently edited original paper: '+JSON.stringify(target));assert.equal(target.id,'body');
  await p.touchscreen.tap(point.x,point.y);assert.equal(await a.evaluate(()=>document.activeElement.id),'body');await p.keyboard.insertText(' [synthetic input] ');assert(await body.inputValue().then(t=>t.includes(' [synthetic input] ')));assert(await el.evaluate(e=>e.isConnected));const typed=await state();assert.deepEqual(typed.nodes.slice(1),before.nodes.slice(1));assert.deepEqual(typed.edges,before.edges);await p.keyboard.press('Control+z');assert.deepEqual((await state()).nodes,before.nodes);
  await a.locator('#inlineDetails').tap();const source=await a.locator('#url').boundingBox();assert.equal((await hit({x:source.x+source.width/2,y:source.y+source.height/2})).id,'url');await a.locator('#inlineMetaClose').tap();await a.locator('#inlineDone').tap();assert.equal((await hit(point)).owner,'cover','Finishing restores the original paper stack');assert.deepEqual((await state()).nodes,before.nodes);assert(await a.evaluate(()=>persist()));
  await record('phone-direct-overlap-edit','At390px a real double tap keeps the original writing paper visible above its overlap; a native tap places input in that paper, Undo restores all content, source controls remain reachable, and Done restores the original stack without moving or reordering papers.');
 }
 if(from<=1&&to>1){
  for(const width of [320,1440]){
   await p.setViewportSize({width,height:950});await settle();await node('writer').locator('[data-preview-id=title]').dblclick();const before=await state(),body=node('writer').locator('#body'),point=await pointInField(body,'cover');assert.equal((await hit(point)).id,'body');await p.mouse.click(point.x,point.y);assert.equal(await a.evaluate(()=>document.activeElement.id),'body');await a.locator('#inlineDone').click();assert.deepEqual((await state()).nodes,before.nodes);assert.equal((await hit(point)).owner,'cover');
  }
  await record('narrow-wide-paper-edit','At320px and wide, clicking the previously covered original paper input remains direct; Done restores the original neighboring paper without changing authored content or manual dimensions.');
 }
 if(from<=2&&to>2){
  await p.setViewportSize({width:1440,height:950});await settle();
  await node('grid').locator('[data-preview-id=title]').dblclick();const cell=node('grid').locator('textarea[data-row="1"][data-col="0"]');await cell.waitFor();const before=await state(),point=await pointInField(cell,'grid-cover'),target=await hit(point);assert.equal(target.owner,'grid');assert.equal(target.row,'1');await p.mouse.click(point.x,point.y);assert.equal(await a.evaluate(()=>document.activeElement.dataset.row),'1');await p.keyboard.insertText(' [synthetic cell] ');assert((await cell.inputValue()).includes('[synthetic cell]'));assert.deepEqual((await state()).nodes.filter(n=>n.id!=='grid'),before.nodes.filter(n=>n.id!=='grid'));await p.keyboard.press('Control+z');assert.deepEqual((await state()).nodes,before.nodes);await a.locator('#inlineDone').click();assert.equal((await hit(point)).owner,'grid-cover');
  await node('grid').locator('.block-read').click();await a.locator('#immersiveReturn').waitFor();await a.locator('#immersiveReturn').click();assert.deepEqual((await state()).nodes,before.nodes);assert.deepEqual((await state()).edges,before.edges);assert(await a.evaluate(()=>persist()));const saved=(await state()).nodes;
  await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(key=>pane(current())?.state().boardId===key&&!pane(current()).state().loading,key);const reopened=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await reopened.waitForFunction(()=>board&&!loading);assert.deepEqual(await reopened.evaluate(()=>clone(board.nodes)),saved);
  await record('wide-table-saved-reopen','The same temporary layer protects a covered table cell; native input and Undo affect only that table, expanded editing returns, and saved reopen preserves every original field, manual dimension and paper order.');
 }
 return{groups};
}
module.exports={exercise,fixture};
if(require.main===module){const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');(async()=>{
 const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-editing-layer-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port,proof={groups:[],errors:[],complete:false,syntheticOnly:true,physicalPhoneAccepted:false};const server=spawn(process.env.PYTHON||'python',[root+'/server.py'],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:tmp,PYTHONIOENCODING:'utf-8'}});let browser;const save=()=>{if(process.env.EDITING_LAYER_RESULT)fs.writeFileSync(process.env.EDITING_LAYER_RESULT,JSON.stringify(proof,null,2))};
 try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');await r.arrayBuffer();if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
  const result=await fetch(base+'/api/boards/editing-layer',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(fixture)});assert.equal(result.status,200);await result.arrayBuffer();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),p=await context.newPage();p.setDefaultTimeout(6000);p.on('pageerror',e=>{proof.errors.push(e.message);save()});await context.route('https://**/*',r=>r.abort());const images=process.env.EDITING_LAYER_IMAGES;if(images)fs.mkdirSync(images,{recursive:true});
  await exercise(p,base+'/','editing-layer',{from:Number(process.env.EDITING_LAYER_FROM||0),accept:label=>{proof.groups.push(label);save();console.log(label)},snapshot:images?async(page,name)=>page.screenshot({path:path.join(images,name+'.png')}):null});assert.deepEqual(proof.errors,[]);proof.complete=true;
 }catch(e){proof.failure=e.stack;throw e}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true});proof.ownedSyntheticServicesStopped=true;save()}
})().catch(e=>{console.error(e);process.exitCode=1})}
