const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const R = path.resolve(process.env.CREATIVE_BOARD_TEST_ROOT || path.join(__dirname, '..'));
const O = process.env.HISTORY_COPY_RETRY_PROOF || path.join(R, '.test-proof-history-copy-retry');
const PY = process.env.PYTHON || 'python';
assert(R && O && PY && !fs.existsSync(O));
fs.mkdirSync(O, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const proof = { at: new Date().toISOString(), complete: false, syntheticOnly: true,
  scope: 'Same-view historical-board copy retries with actual saved/lost responses, existing-result verification and safe same-ID creation.',
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



    const deadline=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Expected native read did not start')),10000))])}finally{clearTimeout(timer)}};
    const reordered=value=>Array.isArray(value)?value.map(reordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reordered(value[key])])):value;
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
    for(const width of [1360,320]){
      const row={width,checks:[],scenarios:[]};proof.cases.push(row);
      const pass=name=>{row.checks.push({name,passed:true});row.checkBlocks=row.checks.length;save()};
      for(const scenario of ['lost-response','read-error','changed-copy','trashed-copy','copy503','scope-change','closed-view','missing-destination','trash-read-error']){
        const id='given-history-retry-'+width+'-'+scenario,folderId=scenario==='missing-destination'?id+'-folder':'';
        if(folderId){const folders=await req('/api/folders');folders.value.folders.push({id:folderId,name:'Given historical destination',parent:''});await req('/api/folders','PUT',folders.value,folders.etag)}
        const historical={format:'creative-board',version:1,name:'Given historical retry '+scenario,folder:folderId,
          nodes:[{id:'given-note',type:'note',title:'Given historical text',body:'Given historical words '+width,x:40,y:40,w:280,h:180,opaque:{zero:0,kept:true}},
                 {id:'given-neighbor',type:'note',title:'Given neighbor',body:'Given neighboring words',x:430,y:70,w:280,h:180}],
          edges:[{id:'given-edge',from:'given-note',to:'given-neighbor',label:'Given historical relation'}],
          view:{x:0,y:0,z:1},opaque:{label:'Given unknown field',items:[0,false,null,{kept:true}]}};
        await req('/api/boards/'+id,'PUT',historical,'new');await req('/api/checkpoints/'+id,'PUT');
        let latest=await req('/api/boards/'+id);latest.value.nodes[0].body='Given current original '+width;latest.value.folder='';await req('/api/boards/'+id,'PUT',latest.value,latest.etag);
        const pinned=(await req('/api/history/boards/'+id)).value[0];assert(pinned?.id);
        const context=await browser.newContext({viewport:{width,height:900}});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.fallback():route.abort());
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>proof.errors.push(e.message));
        await page.goto(base+'/?board='+id);await page.waitForFunction(id=>current()?.boardId===id&&pane(current())?.state()?.boardId===id&&!pane(current())?.state()?.loading,id);
        const frame=await(await(await page.evaluateHandle(()=>frames.get(current().id))).asElement()).contentFrame();
        if(folderId)await frame.waitForFunction(folderId=>folderData.folders.some(folder=>folder.id===folderId),folderId);
        await page.evaluate(()=>{window.whiteboardHosted={account:{id:'given-account-a'},workspace:'given-workspace-a',base:'/given-base-a',role:'editor',paused:false}});
        await page.locator('#shellMore summary').click();await page.locator('#shellMore [data-command=recovery]').click();
        await frame.waitForFunction(()=>document.querySelector('#wfRecoveryList')?.getAttribute('aria-busy')==='false');
        const revisions=(await req('/api/history/boards/'+id)).value,index=revisions.findIndex(revision=>revision.id===pinned.id);assert(index>=0);
        await frame.locator('[data-revision="'+index+'"]').click();for(const node of historical.nodes)await frame.locator('[data-recover-node="'+node.id+'"]').check();
        const handles=await frame.locator('[data-recover-node]').elementHandles();
        const before=(await req('/api/boards/'+id)).value,beforeRows=(await req('/api/boards')).value;
        const sourceModel=await frame.evaluate(()=>({board:clone(board),undo:history.length,redo:future.length}));
        const puts=[],payloads=[];const noCommit=['copy503','missing-destination','trash-read-error'].includes(scenario);
        const putHandler=async route=>{
          if(route.request().method()==='PUT'&&route.request().headers()['if-match']==='new'){
            puts.push(new URL(route.request().url()).pathname.split('/').pop());payloads.push(route.request().postDataJSON());
            if(puts.length===1){
              if(noCommit)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Given historical-copy503'})});
              const response=await route.fetch();assert(response.ok());return route.abort('failed');
            }
          }
          return route.fallback();
        };
        await context.route(base+'/api/boards/*',putHandler);
        const copy=()=>frame.getByRole('button',{name:'整份记录另存为白板',exact:true}).click();
        const state=()=>frame.locator('[data-history-copy-state]');
        const ready=()=>frame.waitForFunction(()=>!document.querySelector('#dialog [data-recovery-action]:disabled'));
        const kept=async()=>{
          assert((await Promise.all(handles.map(handle=>handle.evaluate(el=>el.isConnected&&el.checked)))).every(Boolean));
          assert.deepEqual(await frame.evaluate(()=>({board:clone(board),undo:history.length,redo:future.length})),sourceModel);
          assert.deepEqual((await req('/api/boards/'+id)).value,before);assert(await frame.locator('#dialog').isVisible());
        };
        const created=async()=>(await req('/api/boards')).value.filter(record=>!beforeRows.some(old=>old.id===record.id));
        const copiedValue=async()=>(await req('/api/boards/'+puts[0])).value;
        const confirm=async()=>{
          await copy();await frame.locator('#dialog').waitFor({state:'hidden'});
          await page.waitForFunction(id=>current()?.boardId===id&&pane(current())?.state()?.boardId===id&&!pane(current())?.state()?.loading,puts[0]);
          const copies=await created();assert.equal(copies.length,1);assert.equal(copies[0].id,puts[0]);
          assert.deepEqual(await copiedValue(),payloads[0]);assert.deepEqual((await req('/api/boards/'+id)).value,before);
        };

        await copy();await state().filter({hasText:'尚未确认'}).waitFor();await ready();await kept();assert.equal(puts.length,1);
        assert.deepEqual(payloads[0].nodes,historical.nodes);assert.deepEqual(payloads[0].edges,historical.edges);assert.deepEqual(payloads[0].opaque,historical.opaque);
        if(noCommit)assert.equal((await created()).length,0);else{assert.equal((await created()).length,1);assert.deepEqual(await copiedValue(),payloads[0])}
        pass(scenario+': '+(noCommit?'actual503 leaves no created board':'server really commits before its response is lost')+'; original model, undo state and checked historical nodes remain.');

        if(scenario==='lost-response'){
          let changedOrdering=false;
          const orderHandler=async route=>{
            if(!changedOrdering&&route.request().method()==='GET'){changedOrdering=true;const response=await route.fetch(),value=await response.json();return route.fulfill({status:response.status(),contentType:'application/json',body:JSON.stringify(reordered(value))})}
            return route.fallback();
          };
          await context.route(base+'/api/boards/'+puts[0],orderHandler);await confirm();assert(changedOrdering);assert.equal(puts.length,1);await context.unroute(base+'/api/boards/'+puts[0],orderHandler);
          pass('Canonical readback of the same saved ID confirms reordered object keys without a second PUT or duplicate, preserving all unknown fields.');
          const fresh=await context.newPage();fresh.on('pageerror',e=>proof.errors.push(e.message));await fresh.goto(base+'/?board='+puts[0]);
          await fresh.waitForFunction(id=>current()?.boardId===id&&pane(current())?.state()?.boardId===id&&!pane(current())?.state()?.loading,puts[0]);
          const freshFrame=await(await(await fresh.evaluateHandle(()=>frames.get(current().id))).asElement()).contentFrame();
          assert.deepEqual(await freshFrame.evaluate(()=>clone(board)),payloads[0]);await fresh.screenshot({path:O+'/'+width+'-confirmed-history-copy.png'});await fresh.close();
          pass('A fresh native page reads the exact once-saved historical board, its relation and unknown fields.');
        }else if(scenario==='read-error'){
          const failRead=route=>route.request().method()==='GET'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Given result-read503'})}):route.fallback();
          await context.route(base+'/api/boards/'+puts[0],failRead);await copy();await frame.locator('#toast').filter({hasText:'Given result-read503'}).waitFor();await ready();await kept();assert.equal(puts.length,1);assert.equal((await created()).length,1);
          pass('A failed result read preserves the same pending copy and selection without submitting another write.');
          await context.unroute(base+'/api/boards/'+puts[0],failRead);await confirm();assert.equal(puts.length,1);
          pass('Explicitly reading again after the503 confirms the already saved copy and opens it without creating another board.');
        }else if(scenario==='changed-copy'){
          const saved=await req('/api/boards/'+puts[0]);saved.value.nodes[0].body='Given independently edited copy';saved.value.opaque.later='Given independently added field';await req('/api/boards/'+puts[0],'PUT',saved.value,saved.etag);
          await copy();await state().filter({hasText:'已有变化'}).waitFor();await ready();await kept();assert.equal(puts.length,1);assert.deepEqual(await copiedValue(),saved.value);
          pass('A later-edited saved copy is left exact, and the original historical selection remains available.');
          await copy();await state().filter({hasText:'已有变化'}).waitFor();await ready();assert.equal(puts.length,1);assert.equal((await created()).length,1);assert.deepEqual(await copiedValue(),saved.value);
          pass('Repeated checking of the changed copy neither overwrites it nor creates a fresh ID.');
        }else if(scenario==='trashed-copy'){
          const saved=await req('/api/boards/'+puts[0]);await req('/api/boards/'+puts[0],'DELETE',undefined,saved.etag);
          await copy();await state().filter({hasText:'已移入回收站'}).waitFor();await ready();await kept();assert.equal(puts.length,1);assert.equal((await created()).length,0);
          assert((await req('/api/trash')).value.some(ticket=>ticket.ids.includes(puts[0])));
          pass('A genuinely trashed pending copy is recognized and is not recreated by the confirmation action.');
          await copy();await state().filter({hasText:'已移入回收站'}).waitFor();await ready();assert.equal(puts.length,1);assert.equal((await fetch(base+'/api/boards/'+puts[0])).status,404);
          pass('Another explicit check keeps the copy in its original trash record and leaves the source exact.');
        }else if(scenario==='copy503'){
          await confirm();assert.equal(puts.length,2);assert.equal(puts[0],puts[1]);assert.deepEqual(payloads[1],payloads[0]);
          pass('After a real non-committing503, missing-result and trash checks allow one explicit same-ID CAS retry, yielding one board.');
        }else if(scenario==='scope-change'||scenario==='closed-view'){
          let release,started,delivered;const gate=new Promise(r=>release=r),seen=new Promise(r=>started=r),done=new Promise(r=>delivered=r);releases.push(release);
          const hold=async route=>{if(route.request().method()==='GET'){const response=await route.fetch();started();await gate;try{return await route.fulfill({response})}finally{delivered()}}return route.fallback()};
          await context.route(base+'/api/boards/'+puts[0],hold);await copy();await deadline(seen);
          if(scenario==='scope-change'){
            await page.evaluate(()=>{whiteboardHosted.account.id='given-account-b';whiteboardHosted.workspace='given-workspace-b';whiteboardHosted.base='/given-base-b'});release();await deadline(done);
            await frame.locator('#toast').filter({hasText:'查看范围已有变化'}).waitFor();await ready();await kept();assert.equal(puts.length,1);assert.equal(await page.evaluate(()=>current().boardId),id);
            pass('An owner change during result verification stops confirmation without falsely reporting the older committed request as an unperformed write.');
            await context.unroute(base+'/api/boards/'+puts[0],hold);
            await page.evaluate(()=>{whiteboardHosted.account.id='given-account-a';whiteboardHosted.workspace='given-workspace-a';whiteboardHosted.base='/given-base-a'});await confirm();assert.equal(puts.length,1);
            pass('Returning to the original owner confirms the same copy with no new write.');
          }else{
            await page.keyboard.press('Escape');await frame.locator('#dialog').waitFor({state:'hidden'});
            await page.locator('#shellMore summary').click();await page.locator('#shellMore [data-command=help]').click();await frame.locator('#dialog[open]').waitFor();
            const newer=await frame.locator('#dialogBody').innerText();assert(newer.length);release();await deadline(done);
            await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert(await frame.locator('#dialog').isVisible());assert.equal(await frame.locator('#dialogBody').innerText(),newer);assert.equal(await frame.locator('[data-history-copy-state]').count(),0);assert.equal(puts.length,1);assert.equal(await page.evaluate(()=>current().boardId),id);
            await context.unroute(base+'/api/boards/'+puts[0],hold);
            pass('A late verification result leaves the later native help dialog and source tab intact after the old history view was closed.');
          }
        }else if(scenario==='missing-destination'){
          assert.equal(payloads[0].folder,folderId);const folders=await req('/api/folders');await req('/api/folders/'+folderId,'DELETE',undefined,folders.etag);
          await copy();await state().filter({hasText:'存放位置已有变化'}).waitFor();await ready();await kept();assert.equal(puts.length,1);assert.equal((await created()).length,0);
          pass('A genuinely removed historical destination stops a missing-copy retry and preserves the original root board and selection.');
        }else if(scenario==='trash-read-error'){
          const failTrash=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Given trash-read503'})});
          await context.route(base+'/api/trash',failTrash);await copy();await frame.locator('#toast').filter({hasText:'Given trash-read503'}).waitFor();await ready();await kept();assert.equal(puts.length,1);assert.equal((await created()).length,0);
          pass('Unavailable trash metadata stops same-ID recreation rather than treating an incomplete check as absence.');
          await context.unroute(base+'/api/trash',failTrash);await confirm();assert.equal(puts.length,2);assert.equal(puts[0],puts[1]);
          pass('An explicit retry after trash metadata recovers creates exactly the original prepared ID once.');
        }
        row.scenarios.push({name:scenario,complete:true,firstAttemptActuallyCommitted:!noCommit,putTargets:puts,sourceUnchanged:true});
        await context.close();save();
      }
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
