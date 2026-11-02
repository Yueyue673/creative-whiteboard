// Real child-process checks only; this does not run any product/browser task.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{runSuite}=require('./run-browser-suite.cjs');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'creative-browser-runner-control-'));fs.mkdirSync(path.join(root,'tests'));
 const fixture=(name,body)=>{const task='tests/'+name+'.cjs';fs.writeFileSync(path.join(root,task),body);return task};
 const marker=path.join(root,'execution.txt'),append=value=>'require("node:fs").appendFileSync('+JSON.stringify(marker)+','+JSON.stringify(value)+');';
 const first=fixture('first-failure',append('first\n')+'process.exit(7);'),later=fixture('later-success',append('later\n')),last=fixture('last-success',append('last\n'));
 const failure=await runSuite({root,tasks:[first,later,last],resultPath:path.join(root,'ordinary-failure.json'),stdio:'ignore'});
 assert.deepEqual(failure.tasks.map(row=>row.status),['failed','passed','passed']);assert.equal(failure.tasks[0].code,7);assert.equal(failure.exitCode,1);assert(failure.complete);
 assert.equal(fs.readFileSync(marker,'utf8'),'first\nlater\nlast\n');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'ordinary-failure.json'),'utf8')),failure);
 const success=await runSuite({root,tasks:[later,last],resultPath:path.join(root,'success.json'),stdio:'ignore'});
 assert.equal(success.exitCode,0);assert(success.complete);assert.equal(success.counts.passed,2);
 const waiting=fixture('waiting','setTimeout(()=>{},30000);'),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),100);
 let interrupted;try{interrupted=await runSuite({root,tasks:[waiting,later],resultPath:path.join(root,'interrupted.json'),signal:controller.signal,stdio:'ignore'})}finally{clearTimeout(timer)}
 assert.equal(interrupted.exitCode,130);assert.equal(interrupted.complete,false);assert.deepEqual(interrupted.tasks.map(row=>row.status),['interrupted','not-run']);assert.equal(interrupted.counts.passed,0);
 await assert.rejects(runSuite({root,tasks:[later,later],resultPath:path.join(root,'invalid.json')}),/unique/);
 assert(!fs.existsSync(path.join(root,'invalid.json')));
 // Exercise the actual CLI exit code too, using only the same synthetic files.
 const cliRoot=path.join(root,'cli'),cliTests=path.join(cliRoot,'tests');fs.mkdirSync(cliTests,{recursive:true});
 fs.copyFileSync(__dirname+'/run-browser-suite.cjs',cliTests+'/run-browser-suite.cjs');
 for(const task of[first,later,last])fs.copyFileSync(path.join(root,task),path.join(cliRoot,task));
 const manifest=path.join(cliTests,'browser-suite-tasks.json');fs.writeFileSync(manifest,JSON.stringify([first,later,last]));
 const cliFailurePath=path.join(root,'cli-failure.json'),cliFailure=spawnSync(process.execPath,[path.join(cliTests,'run-browser-suite.cjs')],{cwd:cliRoot,encoding:'utf8',env:{...process.env,BROWSER_SUITE_PROOF:cliFailurePath}});
 assert.equal(cliFailure.status,1);assert.equal(cliFailure.signal,null);
 assert.deepEqual(JSON.parse(fs.readFileSync(cliFailurePath,'utf8')).tasks.map(row=>row.status),['failed','passed','passed']);
 fs.writeFileSync(manifest,JSON.stringify([later,last]));
 const cliSuccessPath=path.join(root,'cli-success.json'),cliSuccess=spawnSync(process.execPath,[path.join(cliTests,'run-browser-suite.cjs')],{cwd:cliRoot,encoding:'utf8',env:{...process.env,BROWSER_SUITE_PROOF:cliSuccessPath}});
 assert.equal(cliSuccess.status,0);assert.equal(cliSuccess.signal,null);
 assert.equal(JSON.parse(fs.readFileSync(cliSuccessPath,'utf8')).counts.passed,2);
 const currentRoot=path.resolve(__dirname,'..'),tasks=JSON.parse(fs.readFileSync(path.join(__dirname,'browser-suite-tasks.json'),'utf8'));
 assert.equal(tasks.length,new Set(tasks).size);for(const task of tasks)assert(fs.statSync(path.join(currentRoot,task)).isFile());
 const review={complete:true,syntheticChildProcessesOnly:true,productBrowserTasksExecuted:0,
  originalManifestTasks:tasks.length,groups:['ordinary failure continues and persists a nonzero aggregate','all passing tasks return zero','interruption stops and leaves later tasks unexecuted','invalid duplicate list starts no tasks','real CLI returns nonzero after a failure followed by passing tasks','real CLI returns zero only for an all-passing suite'],
  fixtureRoot:root,node:process.version,platform:process.platform};
 fs.writeFileSync(path.join(root,'control-review.json'),JSON.stringify(review,null,2)+'\n');
 if(process.env.BROWSER_SUITE_CONTROL_PROOF){
  const target=path.resolve(process.env.BROWSER_SUITE_CONTROL_PROOF),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify({...review,runnerSHA256:hash(__dirname+'/run-browser-suite.cjs'),taskSHA256:hash(__filename),
   reports:{ordinaryFailure:failure,allPassing:success,interrupted,cliFailure:JSON.parse(fs.readFileSync(cliFailurePath,'utf8')),cliSuccess:JSON.parse(fs.readFileSync(cliSuccessPath,'utf8'))},
   ownedChildProcessesClosed:true},null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify(review));
})().catch(error=>{console.error(error);process.exitCode=1});
