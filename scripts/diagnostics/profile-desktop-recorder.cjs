// Controlled Electron-main collector experiment, excluding application rendering.
// Its input is synthetic numeric evidence and bounded synthetic error stacks.
const {app,crashReporter}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const desktop=process.env.XHANDLE_DESKTOP_ROOT,enabled=process.env.XHANDLE_DIAGNOSTICS_ENABLED!=='0';
if(!desktop)throw Error('Set XHANDLE_DESKTOP_ROOT');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-recorder-profile-'));
app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('js-flags','--expose-gc');
const capture=require(path.join(desktop,'electron/native-crashes.cjs')).startNativeCrashCapture({app,crashReporter,enabled});
const log=require(path.join(desktop,'electron/diagnostics.cjs')).createDiagnostics({file:path.join(output,'log.json'),enabled});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const collect=async()=>{require('node:v8').setFlagsFromString('--expose_gc');require('node:vm').runInNewContext('gc')();await sleep(100);require('node:vm').runInNewContext('gc')();};
async function memory(){
 await collect();
 const native=JSON.parse(require('node:child_process').execFileSync('python3',[path.join(__dirname,'desktop-process-footprint.py'),String(process.pid),path.join(output,'profile/diagnostic-crashes')],{encoding:'utf8'}));
 return {heapMiB:process.memoryUsage().heapUsed/1048576,mainMiB:native.processes.find(p=>p.pid===process.pid).footprintBytes/1048576,crashHandlerMiB:native.processes.filter(p=>p.role==='crash-handler').reduce((n,p)=>n+p.footprintBytes/1048576,0)};
}
app.whenReady().then(async()=>{
 await sleep(1000);const baseline=await memory();
 for(let i=0;i<300;i++)log.operation({operation:'requirements.checkpoint',stage:'complete',counts:{sourceRows:15000,completed:i,resultRows:15000}});
 for(let i=0;i<20;i++)log.record({kind:'operation-error',message:'Synthetic bounded failure '+i,errorChain:[{name:'Error',message:'Synthetic failure',stack:'at syntheticSave (fixture.js:12:3)\n'.repeat(150)}]});
 for(let i=0;i<120;i++)log.sample({at:new Date().toISOString(),processes:Array.from({length:12},(_,pid)=>({pid,type:'Tab',cpu:{percentCPUUsage:20},memory:{workingSetSize:102400}})),system:{memoryKiB:{total:8*1024*1024,free:102400}}});
 await log.persist();await sleep(1000);const filled=await memory();
 const result={enabled,baseline,filled,nativeCaptureEnabled:capture.enabled,stats:log.stats(),entries:log.snapshot().entries.length,samples:log.evidence().history.length};
 if(enabled&&(result.samples!==120||result.stats.writeFailures||result.entries<20))throw Error('Recorder input was not retained');
 await log.close();console.log('RECORDER_PROFILE '+JSON.stringify(result));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>app.quit());
