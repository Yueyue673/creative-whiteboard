// Original workbench/controller regression with injected history transport.
// This checks protocol boundaries; it does not certify server authorization or TLS.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'whiteboard-writing-continuation-')),port=await require('./browser-port.cjs')(),base='http://127.0.0.1:'+port;
 const server=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:temporary,PYTHONIOENCODING:'utf-8'}});server.stdout.resume();server.stderr.resume();let browser;
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
  const seed=JSON.parse(fs.readFileSync(path.join(root,'examples/getting-started.json')));seed.nodes=seed.nodes.filter(n=>['observation','question','shots'].includes(n.id));seed.edges=[];seed.view={x:60,y:40,z:1};seed.nodes.forEach((n,i)=>{n.x=1800+i*800;n.y=100;if(n.type==='table'){n.rowIds=n.rows.map((_,i)=>'row-'+i);n.columnIds=n.columns.map((_,i)=>'column-'+i);}});
  assert.equal((await fetch(base+'/api/boards/continuation',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(seed)})).status,200);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const mode of ['unique','mixed','stale','budget','invalid-json','late']){
   const c=await browser.newContext({viewport:{width:320,height:780},hasTouch:true,reducedMotion:'reduce'}),errors=[],writes=[],requests=[];let current,release,arrived;
   const modelReady=new Promise(r=>release=r),historyArrived=new Promise(r=>arrived=r);
   await c.addInitScript(()=>{let paused=false;window.whiteboardHosted=Object.freeze({base:'/fixture/',account:Object.freeze({id:'synthetic-original'}),workspace:'synthetic-workspace',get paused(){return paused},pause(){paused=true}});});
   await c.route('**/*',async route=>{const r=route.request();if(!r.url().startsWith(base+'/'))return route.abort();if(!['GET','HEAD'].includes(r.method())){writes.push(r.postDataJSON());return route.abort();}return route.continue();});
   await c.route(base+'/fixture/native/history/boards/continuation**',async route=>{
    const r=route.request();requests.push({path:new URL(r.url()).pathname,account:r.headers()['x-creative-account'],method:r.method()});arrived();await modelReady;
    try{
     if(r.url().endsWith('/continuation'))return await route.fulfill({json:[{id:'current',savedAt:2},{id:'previous',savedAt:1}]});
     if(mode==='invalid-json')return await route.fulfill({contentType:'application/json',body:'{"private-fixture-marker": supplied invalid JSON'});
     const value=structuredClone(current);
     if(mode==='budget')value.opaque='x'.repeat(600*1024);
     else if(mode==='stale'&&r.url().endsWith('/current'))value.opaque={newer:true};
     else if(r.url().endsWith('/previous')){value.nodes.find(n=>n.id==='observation').body=seed.nodes.find(n=>n.id==='question').body;if(mode==='mixed')value.nodes.find(n=>n.type==='table').rows[0][0]=seed.nodes.find(n=>n.id==='question').body;}
     await route.fulfill({json:{id:r.url().split('/').at(-1),savedAt:1,value,deleted:false}});
    }catch(e){if(!/closed|aborted|cancelled/i.test(String(e)))throw e;}
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/?board=continuation');await p.waitForFunction(()=>pane(current())?.state()?.boardId==='continuation'&&!pane(current()).state().loading);
   const f=await(await p.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame();await f.waitForFunction(()=>window.whiteboardWritingContinuation);current=await f.evaluate(()=>clone(board));const initial=await f.evaluate(()=>({board:clone(board),selected:[...selected],history:clone(history),future:clone(future)}));
   if(mode==='late'){await historyArrived;await f.getByRole('button',{name:'全览',exact:true}).click();current=await f.evaluate(()=>clone(board));release();await f.waitForFunction(()=>whiteboardWritingContinuation.status().phase==='cancelled');assert(await f.locator('.writing-resume').isHidden());assert.deepEqual(await f.evaluate(()=>clone(board)),current);}
   else{
    release();const expected={unique:'matched',mixed:'multiple-objects',stale:'current-history-mismatch',budget:'byte-budget','invalid-json':'history-json'}[mode];await f.waitForFunction(expected=>whiteboardWritingContinuation.status().phase===expected,expected);
    assert.deepEqual(await f.evaluate(()=>({board:clone(board),selected:[...selected],history:clone(history),future:clone(future)})),initial);
    if(mode==='unique'){const button=f.getByRole('button',{name:'接着写：'+current.nodes.find(n=>n.id==='observation').title,exact:true});assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await f.evaluate(()=>{window.oldContinuation=document.querySelector('.writing-resume>button');window.oldContinuationCallback=oldContinuation.onclick;});await f.getByRole('button',{name:'暂不接着写',exact:true}).click();await f.evaluate(()=>{oldContinuation.click();oldContinuationCallback();});assert(await f.locator('#dialog').evaluate(d=>!d.open));assert.deepEqual(await f.evaluate(()=>clone(board)),initial.board);}
    else assert(await f.locator('.writing-resume').isHidden());
    if(mode==='budget')assert.equal(await f.evaluate(()=>whiteboardWritingContinuation.status().revisions),0);
    if(mode==='invalid-json')assert(!JSON.stringify(await f.evaluate(()=>whiteboardWritingContinuation.status())).includes('private-fixture-marker'));
    assert.deepEqual(writes,[]);
   }
   assert(requests.length>0&&requests.every(r=>r.account==='synthetic-original'&&r.method==='GET'));assert.deepEqual(errors,[]);await c.close();console.log('Writing continuation protocol: '+mode);
  }
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}
})().catch(e=>{console.error(e);process.exitCode=1});
