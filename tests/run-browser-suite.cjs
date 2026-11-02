// Preserve the original serial browser tasks and report every ordinary failure.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');

async function runSuite({root,tasks,resultPath,signal,stdio='inherit'}){
 root=path.resolve(root);
 if(!Array.isArray(tasks)||!tasks.length||new Set(tasks).size!==tasks.length)throw Error('Browser task list must be nonempty and unique');
 for(const task of tasks){
  if(typeof task!=='string'||!/^tests\/[A-Za-z0-9_-]+\.cjs$/.test(task)||!fs.statSync(path.join(root,task)).isFile())throw Error('Invalid browser task: '+task);
 }
 const report={version:1,startedAt:new Date().toISOString(),complete:false,interrupted:false,
  node:process.version,tasks:tasks.map(task=>({task,status:'not-run'}))};
 fs.mkdirSync(path.dirname(resultPath),{recursive:true});
 fs.writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const save=()=>{const temporary=resultPath+'.tmp';fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n');fs.renameSync(temporary,resultPath)};
 for(const row of report.tasks){
  if(signal?.aborted){report.interrupted=true;break}
  row.status='running';row.startedAt=new Date().toISOString();save();
  console.log('\nBrowser task: '+row.task);
  const started=Date.now();let aborted=false;
  const outcome=await new Promise(resolve=>{
   const child=spawn(process.execPath,[path.join(root,row.task)],{cwd:root,env:process.env,stdio,windowsHide:true});
   let error=null;
   const abort=()=>{aborted=true;child.kill('SIGTERM')};
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
   child.once('error',value=>{error=value.message});
   child.once('close',(code,childSignal)=>{signal?.removeEventListener('abort',abort);resolve({code,signal:childSignal,error})});
  });
  Object.assign(row,outcome,{finishedAt:new Date().toISOString(),durationMs:Date.now()-started});
  if(aborted||['SIGINT','SIGTERM'].includes(outcome.signal)){
   row.status='interrupted';report.interrupted=true;save();break;
  }
  row.status=outcome.code===0&&!outcome.error&&!outcome.signal?'passed':'failed';save();
 }
 report.finishedAt=new Date().toISOString();
 report.counts=Object.fromEntries(['passed','failed','interrupted','not-run'].map(status=>[status,report.tasks.filter(row=>row.status===status).length]));
 report.complete=!report.interrupted&&report.counts['not-run']===0;
 report.exitCode=report.interrupted?130:report.counts.failed?1:0;
 save();console.log('\nBrowser task results: '+JSON.stringify(report.counts));
 return report;
}

async function main(){
 const root=path.resolve(__dirname,'..'),tasks=JSON.parse(fs.readFileSync(path.join(__dirname,'browser-suite-tasks.json'),'utf8'));
 const resultPath=path.resolve(process.env.BROWSER_SUITE_PROOF||path.join(os.tmpdir(),'creative-browser-suite-'+crypto.randomUUID(),'result.json'));
 const controller=new AbortController(),stop=()=>controller.abort();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const report=await runSuite({root,tasks,resultPath,signal:controller.signal});console.log('Browser results saved: '+resultPath);process.exitCode=report.exitCode}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
module.exports={runSuite};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
