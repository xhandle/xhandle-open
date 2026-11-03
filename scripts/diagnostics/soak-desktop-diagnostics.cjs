// Bounded collector retention experiment. Synthetic evidence only; no app data,
// no renderer and no native crash reporter. Run Node with --expose-gc.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const desktop=process.env.XHANDLE_DESKTOP_ROOT;
if(!desktop||typeof global.gc!=='function')throw Error('Set XHANDLE_DESKTOP_ROOT and use --expose-gc');
const output=process.env.XHANDLE_SOAK_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-collector-soak-'));
fs.mkdirSync(output,{recursive:true});
const {createDiagnostics}=require(path.join(desktop,'electron/diagnostics.cjs'));
const log=createDiagnostics({file:path.join(output,'log.json'),debounceMs:1000});
const rows=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function measure(round){
 await log.persist();await sleep(100);global.gc();await sleep(100);global.gc();
 const native=JSON.parse(require('node:child_process').execFileSync('python3',[path.join(__dirname,'desktop-process-footprint.py'),String(process.pid)],{encoding:'utf8'}));
 const files=['log.json','log-flight.json'].map(name=>{try{return fs.statSync(path.join(output,name)).size;}catch{return 0;}});
 const evidence=log.evidence();
 const row={round,heapMiB:process.memoryUsage().heapUsed/1048576,mainNativeMiB:native.processes.find(p=>p.pid===process.pid).footprintBytes/1048576,journalBytes:files[0],flightBytes:files[1],entries:log.snapshot().entries.length,samples:evidence.history.length,breadcrumbs:evidence.breadcrumbs.length,stats:log.stats()};
 assert.ok(row.journalBytes<=2*1024*1024);assert.ok(row.entries<=300&&row.samples<=120&&row.breadcrumbs<=100);assert.equal(row.stats.writeFailures,0);assert.ok(row.stats.maxPendingWrites<=1);
 rows.push(row);console.log(JSON.stringify(row));
}
(async()=>{
 await measure(0);
 for(let round=1;round<=8;round++){
  for(let i=0;i<600;i++){
   log.operation({operation:'requirements.checkpoint',stage:'error',counts:{sourceRows:75000,completed:i},error:Array.from({length:4},(_,j)=>({name:'Error',message:'Synthetic bounded failure '+round+' '+i+' '+j,stack:('at syntheticBoundary'+i+' (fixture.js:12:3)\n').repeat(200)}))});
   log.sample({at:new Date().toISOString(),processes:Array.from({length:8},(_,pid)=>({pid,type:'Tab',cpu:{percentCPUUsage:20},memory:{workingSetSize:102400}})),system:{memoryKiB:{total:8*1024*1024,free:102400}}});
   log.heartbeat({heapUsedBytes:500*1048576,eventLoopDelayMs:5});
  }
  await measure(round);
 }
 await log.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({rows,limits:'Adversarial bounded collector evidence; excludes Electron renderer/GPU/crash-handler allocations.'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
