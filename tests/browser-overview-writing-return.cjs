const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{createHash}=require('node:crypto'),{chromium}=require('playwright');
(async()=>{
 const root=process.env.OVERVIEW_RETURN_SOURCE||path.resolve(__dirname,'..'),out=process.env.OVERVIEW_RETURN_PROOF;
 if(out){assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true})}
 const proof={syntheticOnly:true,prototypeOnly:false,sourceHead:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeFiles:{},cases:[],errors:[],complete:false};
 for(const file of ['note-editor.js','note-editor.css','navigation.js'])proof.runtimeFiles[file]=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
 const save=()=>{if(out)fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2))},photo=async(name)=>{if(out)await p.screenshot({path:path.join(out,name+'.png')})};
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'creative-overview-writing-')),port=await require(path.join(root,'tests/browser-port.cjs'))(),base='http://127.0.0.1:'+port;
 let browser,server,p,releaseSave;proof.dataDir=data;
 const fieldState=e=>({value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection,top:e.scrollTop,left:e.scrollLeft});
 const near=(a,b)=>{for(const key of ['x','y','z'])assert(Math.abs(a[key]-b[key])<1e-6,'camera '+key+' differs')};
 try{
  server=spawn(process.env.PYTHON||'python',[path.join(root,'server.py')],{windowsHide:true,stdio:'ignore',env:{...process.env,CREATIVE_BOARD_PORT:String(port),CREATIVE_BOARD_DATA_DIR:data,PYTHONIOENCODING:'utf-8'}});
  proof.ownedServer={pid:server.pid,port};save();let live=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){live=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(live);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const width of [1360,320]){
   const key='given-overview-writing-'+width,originalBody=Array.from({length:20},(_,i)=>'给定第'+(i+1)+'行记录。').join('\n'),append=' 给定现在继续写的原文';
   const given={format:'creative-board',version:1,name:'给定混合创作',nodes:[
    {id:'given-writer',type:'note',title:'给定正在写的记录',body:originalBody,userText:'给定补充原文',annotation:'给定出处',x:30,y:60,w:260,h:440,sizeMode:'manual',fontSize:16,opaque:{preserve:[true,1.5]}},
    {id:'given-region',type:'frame',title:'给定另一组材料',x:1000,y:40,w:460,h:650},
    {id:'given-table',type:'table',title:'给定材料',columns:['给定要点','给定出处'],columnWidths:[210,150],rows:[['给定已有材料','给定出处']],cellImages:[[[],[]]],cellItems:[[[],[]]],x:1040,y:110,w:360,h:260,sizeMode:'manual',libraryOrigin:{id:'given-resource',nodeId:'given-original',name:'给定原件'}},
    {id:'given-image',type:'image',title:'给定示意图片',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=',x:1070,y:440,w:300,h:200,sizeMode:'manual'}
   ],edges:[{id:'given-edge',from:'given-writer',to:'given-table',fromPort:'right',toPort:'left',label:'给定依据与要点'}],view:{x:width/2-160,y:60,z:1}};
   const source={...given,name:'给定来源板',nodes:[{id:'given-original',type:'note',title:'给定材料',body:'给定来源原文',x:0,y:0,w:300,h:220}],edges:[]};
   for(const [id,value]of [[key,given],[key+'-source',source]])assert((await fetch(base+'/api/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'new'},body:JSON.stringify(value)})).ok);
   const read=async id=>{const r=await fetch(base+'/api/boards/'+id);assert(r.ok);return r.json()},sourceBefore=await read(key+'-source');
   const ctx=await browser.newContext({viewport:{width,height:920}});ctx.setDefaultTimeout(12000);
   await ctx.addInitScript(()=>localStorage.setItem('creative-sidebar-state',JSON.stringify({open:false})));
   await ctx.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   p=await ctx.newPage();p.on('pageerror',e=>proof.errors.push(e.message));
   const ready=async page=>{await page.waitForFunction(k=>current()?.boardId===k&&pane(current())?.state()?.boardId===k&&!pane(current())?.state()?.loading,key);return(await(await page.evaluateHandle(()=>frames.get(current().id))).asElement().contentFrame())};
   await p.goto(base+'/?board='+key);const f=await ready(p),row={width,phase:'writing-with-save-pending'};proof.cases.push(row);save();
   await f.locator('#nodes>[data-id=given-writer]').click({button:'right',position:{x:3,y:3}});
   await f.locator('#fileContext').getByRole('menuitem',{name:'编辑',exact:true}).click();
   const body=f.locator('#body');await body.focus();await p.keyboard.press('Control+End');
   assert(await f.evaluate(()=>whiteboardPane.flush()));await f.waitForFunction(()=>!dirty&&!savePromise);
   let pending=false,held=false;const gate=new Promise(resolve=>releaseSave=resolve);
   await ctx.route('**/api/boards/'+key,async route=>{if(route.request().method()==='PUT'&&!held){held=true;pending=true;await gate}await route.continue()});
   await p.keyboard.insertText(append);await p.keyboard.down('Shift');for(let i=0;i<6;i++)await p.keyboard.press('ArrowLeft');await p.keyboard.up('Shift');
   const field=await body.elementHandle(),beforeField=await body.evaluate(fieldState);
   const authored=()=>f.evaluate(()=>({nodes:clone(board.nodes),edges:clone(board.edges),history:clone(history),future:clone(future),revision:contentRevision})),before=await authored(),camera=()=>f.evaluate(()=>clone(view())),prior=await camera();
   for(let i=0;i<150&&!pending;i++)await new Promise(r=>setTimeout(r,20));assert(pending,'the actual author PUT is held');
   assert.notDeepEqual((await read(key)).nodes,before.nodes,'the server still holds the earlier author content');
   await photo(width+'-writing-before');
   const back=f.getByRole('button',{name:'返回之前视角',exact:true});
   await f.locator('#fit').click();assert.notDeepEqual(await camera(),prior);
   assert.equal(await f.locator('.canvas-view-return:not([hidden])').count(),1,'the common overview offers the original return bar');
   assert(await field.evaluate(e=>e.isConnected));assert.deepEqual(await body.evaluate(fieldState),beforeField);assert.deepEqual(await authored(),before);
   const bounds=await back.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=920);
   await photo(width+'-common-overview-return');
   await f.locator('#fit').click();await back.click();near(await camera(),prior);
   assert(await field.evaluate(e=>e.isConnected));assert.deepEqual(await body.evaluate(fieldState),beforeField);assert.deepEqual(await authored(),before);
   assert(await f.getByRole('button',{name:'已返回原视角',exact:true}).isDisabled());
   await f.getByRole('button',{name:'收起视角返回',exact:true}).click();await photo(width+'-returned-writing');
   row.toolbar={returnVisible:true,repeatedOverviewRetainsOriginal:true,rangeAndHistoryExact:true,buttonBounds:bounds};save();
   await f.locator('#zoomValue').click();await f.locator('#fileContext').getByRole('menuitem',{name:/^查看全部/}).click();
   assert.notDeepEqual(await camera(),prior);assert(await back.isVisible());await back.click();near(await camera(),prior);
   assert(await field.evaluate(e=>e.isConnected));assert.deepEqual(await body.evaluate(fieldState),beforeField);assert.deepEqual(await authored(),before);
   await f.getByRole('button',{name:'收起视角返回',exact:true}).click();
   await f.locator('#canvas').focus();await p.keyboard.press('Shift+Digit1');assert(await back.isVisible());await back.focus();await p.keyboard.press('Enter');near(await camera(),prior);
   assert(await field.evaluate(e=>e.isConnected));assert.deepEqual(await body.evaluate(fieldState),beforeField);assert.deepEqual(await authored(),before);
   await f.getByRole('button',{name:'收起视角返回',exact:true}).click();
   row.zoomMenuAndKeyboard={sameReturnChain:true,keyboardReturn:true,authoredExact:true};
   await body.focus();await p.keyboard.press('Control+z');assert.equal(await body.inputValue(),originalBody);
   await p.keyboard.press('Control+Shift+z');assert.equal(await body.inputValue(),originalBody+append);
   assert(await field.evaluate(e=>e.isConnected));assert.equal(pending,true);
   releaseSave();releaseSave=null;await f.waitForFunction(()=>!dirty&&!savePromise,null,{timeout:15000});assert(await f.evaluate(()=>whiteboardPane.flush()));
   const final=await f.evaluate(()=>clone(board));assert.deepEqual((await read(key)).nodes,final.nodes);assert.deepEqual((await read(key)).edges,final.edges);assert.deepEqual(await read(key+'-source'),sourceBefore);
   row.nativeLatestInputUndoRedo=true;row.serverContentExact=true;row.sourceExact=true;
   const fresh=await ctx.newPage();await fresh.goto(base+'/?board='+key);const ff=await ready(fresh);
   assert.deepEqual(await ff.evaluate(()=>clone(board.nodes)),final.nodes);assert.deepEqual(await ff.evaluate(()=>clone(board.edges)),final.edges);
   near(await ff.evaluate(()=>clone(view())),final.view);assert.equal(await ff.locator('.canvas-view-return:not([hidden])').count(),0,'return state is not saved into authored content');
   await ff.evaluate(()=>fit());assert.equal(await ff.locator('.canvas-view-return:not([hidden])').count(),0,'programmatic fit does not create navigation state');
   row.newWorkspaceReadbackExact=true;row.programmaticFitUnchanged=true;row.phase='complete';save();await ctx.close();
  }
  assert.deepEqual(proof.errors,[]);proof.complete=true;
 }catch(error){proof.failure=error.stack;if(p)await photo('failure').catch(()=>{});throw error}
 finally{releaseSave?.();if(browser)await browser.close();if(server){server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve))}proof.ownedServicesStopped=true;save();console.log(JSON.stringify(proof))}
})().catch(error=>{console.error(error);process.exitCode=1});
