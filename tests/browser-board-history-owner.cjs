const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const R = path.resolve(process.env.CREATIVE_BOARD_TEST_ROOT || path.join(__dirname, '..'));
const O = process.env.BOARD_HISTORY_OWNER_PROOF || path.join(R, '.test-proof-board-history-owner');
const PY = process.env.PYTHON || 'python';
assert(R && O && PY && !fs.existsSync(O));
fs.mkdirSync(O, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const proof = { at: new Date().toISOString(), complete: false, syntheticOnly: true,
  scope: 'Board historical selection, copy ownership and actual committed late-response handling; no old focus or camera checks.',
  controlledHostMetadataOnly: true, DOMOverrides: false, moduleOverrides: false,
  actualHostedAccountOrPrivateContentClaimed: false, cases: [], errors: [], defaultVariablesOmitted: Object.fromEntries(['PYTHON','CREATIVE_BOARD_TEST_ROOT'].map(k=>[k,!process.env[k]])) };
const releases=[];
const save = () => fs.writeFileSync(O + '/result.json', JSON.stringify(proof, null, 2) + '\n');
let proc, browser, exited, fd, base;
(async () => {
  try {
    proof.head = execFileSync(process.env.GIT_EXE || 'git', ['-C', R, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    proof.taskSHA256 = hash(fs.readFileSync(__filename));
    const names = ['recovery.js','cells.js','appearance.js','document-paper.js','document-paper.css','note-editor.js','note-editor.css','refinement.js','refinement.css','workflow.js','workflow.css','pane.js','workspace.js','workspace.css','workspace-shell.js','workspace-shell.css','shell.js','shell.css','index.html','navigation.js','library-copies.js','canvas-objects.js','canvas-objects.css','theme.js','theme.css','library-spatial.js','library-spatial.css','library-folders.js','shell.html','board-lifecycle.js','media-markers.js','media-controls.js','library-editing.js','experience.js'];
    proof.runtimeFiles = Object.fromEntries(names.map(n => [n, hash(fs.readFileSync(R + '/' + n))]));
    const data = O + '/given-data', hooks = O + '/hooks';
    fs.mkdirSync(data);
    execFileSync(PY, [R + '/tests/local_start_fixture.py', '--write-hooks', hooks], { windowsHide: true });
    const port = await require(R + '/tests/browser-port.cjs')();
    base = 'http://127.0.0.1:' + port;
    const env = { ...process.env, CREATIVE_BOARD_DATA_DIR: data, CREATIVE_BOARD_PORT: String(port),
      PYTHONPATH: hooks, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
      START_FIXTURE_DATA_DENIED: '0', START_FIXTURE_LIFETIME: '240' };
    delete env.PYTHONHOME;
    for (const k of Object.keys(env)) if (k.startsWith('CREATIVE_BOARD_HOSTED_')) delete env[k];
    fd = fs.openSync(O + '/server.log', 'w');
    proc = spawn(PY, [R + '/server.py'], { cwd: R, env, windowsHide: true, stdio: ['ignore', fd, fd] });
    exited = new Promise((resolve, reject) => { proc.once('exit', (code, signal) => resolve({ code, signal })); proc.once('error', reject); });
    proof.ownedServer = { pid: proc.pid, port, data }; save();
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert(ready);
    for (const [n, h] of Object.entries(proof.runtimeFiles)) assert.equal(hash(Buffer.from(await (await fetch(base + (n === 'shell.html' ? '/' : '/' + n))).arrayBuffer())), h);
    proof.servedRuntimeExact = true;
    const req = async (url, method = 'GET', value, etag) => {
      const response = await fetch(base + url, { method, headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(etag ? { 'If-Match': etag } : {}) }, body: value === undefined ? undefined : JSON.stringify(value) });
      assert(response.ok, method + ' ' + url + ' ' + response.status);
      return { value: await response.json(), etag: response.headers.get('ETag') };
    };


    const deadline=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Expected native request did not start')),10000))])}finally{clearTimeout(timer)}};
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
    for(const width of [1360,320]){
      const id='given-board-history-owner-'+width;
      const historical={format:'creative-board',version:1,name:'Given historical board '+width,nodes:[
        {id:'given-note',type:'note',title:'Given saved idea',body:'Given historical board words '+width,x:40,y:40,w:280,h:180},
        {id:'given-neighbor',type:'note',title:'Given neighbor',body:'Given retained neighboring words '+width,x:420,y:80,w:280,h:180}
      ],edges:[{id:'given-edge',from:'given-note',to:'given-neighbor',label:'Given retained relation'}],view:{x:0,y:0,z:1}};
      await req('/api/boards/'+id,'PUT',historical,'new');await req('/api/checkpoints/'+id,'PUT');
      let current=await req('/api/boards/'+id);current.value.nodes[0].body='Given current board words '+width;
      await req('/api/boards/'+id,'PUT',current.value,current.etag);
      const pinned=(await req('/api/history/boards/'+id)).value[0];assert(pinned?.id);
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.fallback():route.abort());
      const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>proof.errors.push(e.message));
      await page.goto(base+'/?board='+id);await page.waitForFunction(id=>current()?.boardId===id&&pane(current())?.state()?.boardId===id&&!pane(current())?.state()?.loading,id);
      const frame=await(await(await page.evaluateHandle(()=>frames.get(current().id))).asElement()).contentFrame();
      let writes=0;
      context.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/boards/')&&request.method()==='PUT')writes++});
      const row={width,checks:[]};proof.cases.push(row);
      const pass=name=>{row.checks.push({name,passed:true});row.checkBlocks=row.checks.length;save()};
      const resetOwner=()=>page.evaluate(()=>{window.whiteboardHosted={account:{id:'given-account-a'},workspace:'given-workspace-a',base:'/given-base-a',role:'editor',paused:false}});
      const changeOwner=mode=>page.evaluate(mode=>{
        if(mode==='viewer')whiteboardHosted.role='viewer';
        else if(mode==='paused')whiteboardHosted.paused=true;
        else if(mode==='replacement')window.whiteboardHosted={...whiteboardHosted,account:{...whiteboardHosted.account}};
        else{whiteboardHosted.account.id='given-account-b';whiteboardHosted.workspace='given-workspace-b';whiteboardHosted.base='/given-base-b'}
      },mode);
      const restoreSameOwner=()=>page.evaluate(()=>{whiteboardHosted.account.id='given-account-a';whiteboardHosted.workspace='given-workspace-a';whiteboardHosted.base='/given-base-a';whiteboardHosted.role='editor';whiteboardHosted.paused=false});
      const close=async()=>{if(await frame.locator('#dialog').isVisible()){await page.keyboard.press('Escape');await frame.locator('#dialog').waitFor({state:'hidden'})}};
      const historyList=async(role='editor')=>{
        await close();await resetOwner();if(role==='viewer')await changeOwner('viewer');
        await page.locator('#shellMore summary').click();await page.locator('#shellMore [data-command=recovery]').click();
        await frame.waitForFunction(()=>document.querySelector('[data-recovery-tab="board"]')?.getAttribute('aria-selected')==='true'&&document.querySelector('#wfRecoveryList')?.getAttribute('aria-busy')==='false');
        const rows=(await req('/api/history/boards/'+id)).value,index=rows.findIndex(r=>r.id===pinned.id);assert(index>=0);
        return frame.locator('[data-revision="'+index+'"]');
      };
      const open=async(role='editor')=>{await(await historyList(role)).click();for(const node of historical.nodes)await frame.locator('[data-recover-node="'+node.id+'"]').check()};
      const selected=async()=>({handles:await frame.locator('[data-recover-node]').elementHandles(),values:await frame.locator('[data-recover-node]').evaluateAll(nodes=>nodes.map(el=>({id:el.dataset.recoverNode,checked:el.checked}))),model:await frame.evaluate(()=>({board:clone(board),undo:history.length,redo:future.length}))});
      const assertKept=async kept=>{
        assert((await Promise.all(kept.handles.map(h=>h.evaluate(el=>el.isConnected&&el.checked)))).every(Boolean));
        assert.deepEqual(await frame.locator('[data-recover-node]').evaluateAll(nodes=>nodes.map(el=>({id:el.dataset.recoverNode,checked:el.checked}))),kept.values);
        assert.deepEqual(await frame.evaluate(()=>({board:clone(board),undo:history.length,redo:future.length})),kept.model);
        assert(await frame.locator('#dialog').isVisible());
      };
      const copy=()=>frame.getByRole('button',{name:'整份记录另存为白板',exact:true}).click();
      const add=()=>frame.getByRole('button',{name:'添加勾选内容',exact:true}).click();
      const stopped=async()=>{await frame.locator('#toast').filter({hasText:'未写入白板'}).waitFor();await frame.waitForFunction(()=>!document.querySelector('#dialog [data-recovery-action]:disabled'))};
      const board=async key=>(await req('/api/boards/'+(key||id))).value;
      const list=async()=>(await req('/api/boards')).value;
      const waitStored=async count=>{for(let i=0;i<100;i++){const value=await board();if(value.nodes.length===count)return value;await new Promise(r=>setTimeout(r,50))}throw Error('Native recovery result did not save')};

      let button=await historyList(),listText=await frame.locator('#wfRecoveryList').innerText(),count=writes;
      await changeOwner('account');await button.click();await frame.locator('#toast').filter({hasText:'查看范围已有变化'}).waitFor();
      assert.equal(await frame.locator('#wfRecoveryList').innerText(),listText);assert.equal(writes,count);
      pass('A visible old board-history list stops its revision action when the controlled owner has changed.');

      button=await historyList();listText=await frame.locator('#wfRecoveryList').innerText();count=writes;
      let releaseRevision,startedRevision;const revisionGate=new Promise(r=>releaseRevision=r),revisionSeen=new Promise(r=>startedRevision=r);releases.push(releaseRevision);
      const revisionURL=base+'/api/history/boards/'+id+'/'+pinned.id;
      const revisionHandler=async route=>{startedRevision();await revisionGate;return route.fallback()};
      await context.route(revisionURL,revisionHandler);await button.click();await deadline(revisionSeen);await changeOwner('account');releaseRevision();
      await frame.locator('#toast').filter({hasText:'查看范围已有变化'}).waitFor();await context.unroute(revisionURL,revisionHandler);
      assert.equal(await frame.locator('#wfRecoveryList').innerText(),listText);assert.equal(await frame.locator('[data-recover-node]').count(),0);assert.equal(writes,count);
      pass('A revision response is retained behind the original list when its controlled owner changes during the read.');

      await open('viewer');let kept=await selected(),before=await board(),boardsBefore=await list();count=writes;
      await add();await stopped();await copy();await stopped();await assertKept(kept);assert.equal(writes,count);assert.deepEqual(await board(),before);assert.deepEqual(await list(),boardsBefore);
      pass('Initially controlled-readonly history can be read and selected but neither inserted nor saved as a new board, even with an unchanged scope key.');

      for(const mode of ['account','replacement','viewer','paused']){
        await open();kept=await selected();before=await board();boardsBefore=await list();count=writes;await changeOwner(mode);
        await add();await stopped();await assertKept(kept);assert.equal(writes,count);assert.deepEqual(await board(),before);
        pass('Adding checked historical nodes stops after controlled '+mode+' change and preserves checked nodes, original model and undo/redo state.');
        await copy();await stopped();await assertKept(kept);assert.equal(writes,count);assert.deepEqual(await list(),boardsBefore);
        pass('Separate historical-board copy also stops after controlled '+mode+' change without creating a board or discarding the selection.');
      }

      // The request has actually committed before its response is held; later scope changes do not make that a failed save.
      await open();before=await board();boardsBefore=await list();count=writes;
      let releaseAck,committed,committedId;const ackGate=new Promise(r=>releaseAck=r),committedSeen=new Promise(r=>committed=r);releases.push(releaseAck);
      const ackHandler=async route=>{
        if(route.request().method()==='PUT'&&route.request().headers()['if-match']==='new'){
          const response=await route.fetch();assert(response.ok());committedId=new URL(route.request().url()).pathname.split('/').pop();committed();await ackGate;return route.fulfill({response});
        }
        return route.fallback();
      };
      await context.route(base+'/api/boards/*',ackHandler);await copy();await deadline(committedSeen);
      assert.deepEqual((await board(committedId)).nodes,historical.nodes);assert.deepEqual((await board(committedId)).edges,historical.edges);
      const tabCount=await page.evaluate(()=>model.tabs.length);await changeOwner('account');releaseAck();await frame.locator('#dialog').waitFor({state:'hidden'});
      await frame.locator('#toast').filter({hasText:'已另存恢复版本'}).waitFor();await context.unroute(base+'/api/boards/*',ackHandler);
      assert.equal(writes,count+1);assert.equal((await list()).length,boardsBefore.length+1);assert.deepEqual(await board(),before);
      assert.equal(await page.evaluate(()=>current().boardId),id);assert.equal(await page.evaluate(()=>model.tabs.length),tabCount);
      assert.equal(await frame.evaluate(()=>boardId),id);
      pass('A genuinely committed late response is reported as saved, closes only its old recovery view and does not open a board in the changed controlled owner.');

      await open();before=await board();count=writes;await add();await frame.locator('#dialog').waitFor({state:'hidden'});
      await frame.waitForFunction(()=>board.nodes.length===4);let after=await waitStored(4);
      for(const node of before.nodes)assert.deepEqual(after.nodes.find(n=>n.id===node.id),node);
      const originals=new Set(before.nodes.map(n=>n.id)),added=after.nodes.filter(n=>!originals.has(n.id));assert.equal(added.length,2);
      assert.deepEqual(added.map(n=>n.body).sort(),historical.nodes.map(n=>n.body).sort());assert.equal(after.edges.length,2);
      const addedIds=new Set(added.map(n=>n.id));assert(after.edges.some(e=>addedIds.has(e.from)&&addedIds.has(e.to)));
      pass('Under the original owner, checked historical nodes and their internal relation are added as independent IDs while current originals and neighboring geometry remain exact.');
      const addedSnapshot=structuredClone(after);
      await frame.locator('#canvas').focus();await page.keyboard.press('Control+z');await frame.waitForFunction(()=>board.nodes.length===2);after=await waitStored(2);
      assert.deepEqual(after.nodes,before.nodes);assert.deepEqual(after.edges,before.edges);
      pass('Native Undo removes only the additive historical recovery and saves the unchanged current original nodes and relation.');
      await page.keyboard.press('Control+Shift+z');await frame.waitForFunction(()=>board.nodes.length===4);after=await waitStored(4);
      assert.deepEqual(after.nodes,addedSnapshot.nodes);assert.deepEqual(after.edges,addedSnapshot.edges);
      pass('Native Redo restores the same recovered IDs and relation, and a fresh server read confirms them.');

      await open();kept=await selected();before=await board();boardsBefore=await list();count=writes;
      const fail=route=>route.request().method()==='PUT'&&route.request().headers()['if-match']==='new'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Given board history copy503'})}):route.fallback();
      await context.route(base+'/api/boards/*',fail);await copy();await frame.locator('#toast').filter({hasText:'Given board history copy503'}).waitFor();
      await frame.waitForFunction(()=>!document.querySelector('#dialog [data-recovery-action]:disabled'));await assertKept(kept);
      assert.equal(writes,count+1);assert.deepEqual(await board(),before);assert.deepEqual(await list(),boardsBefore);
      pass('A real503 response keeps the original historical checkboxes and source model and creates no board.');
      await context.unroute(base+'/api/boards/*',fail);await copy();await frame.locator('#dialog').waitFor({state:'hidden'});
      let made=(await list()).filter(a=>!boardsBefore.some(b=>b.id===a.id));assert.equal(made.length,1);assert.equal(writes,count+2);
      const copyId=made[0].id,saved=await board(copyId);assert.deepEqual(saved.nodes,historical.nodes);assert.deepEqual(saved.edges,historical.edges);assert.deepEqual(saved.view,historical.view);assert.deepEqual(await board(),before);
      await page.waitForFunction(copyId=>current()?.boardId===copyId&&pane(current())?.state()?.boardId===copyId&&!pane(current())?.state()?.loading,copyId);
      pass('One explicit retry creates and opens one separate historical board; current original content and the earlier committed copy remain unchanged.');
      const fresh=await context.newPage();fresh.on('pageerror',e=>proof.errors.push(e.message));await fresh.goto(base+'/?board='+copyId);
      await fresh.waitForFunction(copyId=>current()?.boardId===copyId&&pane(current())?.state()?.boardId===copyId&&!pane(current())?.state()?.loading,copyId);
      const freshFrame=await(await(await fresh.evaluateHandle(()=>frames.get(current().id))).asElement()).contentFrame();
      assert.deepEqual(await freshFrame.evaluate(()=>clone(board.nodes)),historical.nodes);assert.deepEqual(await freshFrame.evaluate(()=>clone(board.edges)),historical.edges);
      await fresh.screenshot({path:O+'/'+width+'-saved-board-history.png'});await fresh.close();
      pass('A new native page reads back the saved historical board, including both original words and their relation.');
      row.actualHostedAccountOrRoleVerified=false;row.alreadyCommittedAckHandledSeparately=true;
      await context.close();
    }
    assert.deepEqual(proof.errors,[]);proof.complete=true;
  } catch (error) { proof.failure = error.stack; process.exitCode = 1; }
  finally {
    for(const release of releases)release();
    if (browser) { await browser.close(); proof.ownedBrowserStopped = true; }
    if (proc && proc.exitCode === null) proc.kill();
    if (exited) proof.ownedServerExit = await exited;
    if (fd !== undefined) fs.closeSync(fd);
    if (base) {
      let closed = false;
      for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/health', { signal: AbortSignal.timeout(200) }); } catch { closed = true; break; } await new Promise(r => setTimeout(r, 100)); }
      proof.ownedPortClosed = closed;
      if (!closed) process.exitCode = 1;
    }
    save();
    console.log(JSON.stringify({ complete: proof.complete, observed: proof.observed, failure: proof.failure, ownedPortClosed: proof.ownedPortClosed }));
  }
})();
