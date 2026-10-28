// Disposable synthetic profile only. Does not open the installed xHandle profile.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),webpack=require('webpack');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-hazard-audit-'));
app.setPath('userData',path.join(temp,'profile'));
app.commandLine.appendSwitch('enable-precise-memory-info');
const store=path.resolve(__dirname,'../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js');
fs.writeFileSync(path.join(temp,'entry.js'),`
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,openCodeArchitectureHazardDB} from ${JSON.stringify(store)};
window.runAudit=async()=>{
 const samples=[]; const mark=(stage,extra={})=>samples.push({stage,heapMiB:performance.memory.usedJSHeapSize/1048576,...extra});
 mark('empty');
 for(const n of [500,2000]){
  let run={id:'fixture'+n,projectId:'p'+n,repoId:'r',status:'partial',generatedSheets:{Summary:[['ID','Evidence'],...Array.from({length:n},(_,i)=>['HA-'+i,'e'.repeat(512)+i]) ]}};
  const saveStart=performance.now();await saveCodeArchitectureHazardRun(run,{notify:false});run=null;
  mark('saved '+n,{saveMs:performance.now()-saveStart});
  const start=performance.now();const value=await getLatestCodeArchitectureHazardRun({projectId:'p'+n});
  mark('restored '+n,{restoreMs:performance.now()-start,rows:value.generatedSheets.Summary.length-1});
 }
 for(let i=0;i<3;i++)await saveCodeArchitectureHazardRun({id:'other'+i,projectId:'other'+i,repoId:'r',status:'partial',generatedSheets:{Summary:[['ID'],...Array.from({length:500},(_,j)=>['other-'+j])]}},{notify:false});
 const start=performance.now();const loaded=await Promise.all(Array.from({length:3},()=>getLatestCodeArchitectureHazardRun({projectId:'p2000'})));
 mark('three concurrent restorations with inactive projects',{restoreMs:performance.now()-start,independentCopies:loaded[0]!==loaded[1]&&loaded[1]!==loaded[2],rows:loaded.map(x=>x.generatedSheets.Summary.length-1)});
 const controller=new AbortController();let cancelled=false;
 try {await getLatestCodeArchitectureHazardRun({projectId:'p2000'},{signal:controller.signal,onProgress:()=>controller.abort()});}catch(e){cancelled=e.name==='AbortError';}
 if(!cancelled)throw new Error('Expected hydration cancellation');
 const recovered=await getLatestCodeArchitectureHazardRun({projectId:'p2000'});
 if(recovered.generatedSheets.Summary.length!==2001)throw new Error('Partial results changed');
 mark('cancelled read and restored intact',{cancelled});
 for(const storeName of ['runMetadata','hazardAnalysisRuns']) {
  const db=await openCodeArchitectureHazardDB();
  const writer=db.transaction(storeName,'readwrite');writer.done.catch(()=>{});
  let keepAlive=true;
  const pump=()=>writer.store.get('fixture2000').then(()=>{if(keepAlive)return pump();}).catch(()=>{});
  const pumping=pump();
  const blockedController=new AbortController();
  const abortTimer=setTimeout(()=>blockedController.abort(),50);
  let blockedCancelled=false;
  try {
   await getLatestCodeArchitectureHazardRun({projectId:'p2000'},{signal:blockedController.signal,readTimeoutMs:1000});
  }catch(error){blockedCancelled=error.name==='AbortError';}
  finally {clearTimeout(abortTimer);keepAlive=false;try{writer.abort();}catch{}await writer.done.catch(()=>{});await pumping;db.close();}
  if(!blockedCancelled)throw new Error('Blocked '+storeName+' read did not cancel');
  const after=await getLatestCodeArchitectureHazardRun({projectId:'p2000'});
  if(after.generatedSheets.Summary.length!==2001)throw new Error('Blocked read damaged results');
  mark('blocked '+storeName+' cancelled and reloaded',{cancelled:blockedCancelled});
 }

 loaded.length=0;await new Promise(r=>setTimeout(r,1000));mark('idle after releasing local references');return samples;
};
`);
let server,win,timer;let peakKiB=0;
app.whenReady().then(async()=>{
 await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',entry:path.join(temp,'entry.js'),output:{path:temp,filename:'audit.js'},resolve:{modules:[path.resolve(__dirname,'../../node_modules'),'node_modules']},devtool:false});compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||new Error(stats.toString({all:false,errors:true})));else resolve();});});
 server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/audit.js'?'text/javascript':'text/html');res.end(req.url==='/audit.js'?fs.readFileSync(path.join(temp,'audit.js')):'<!doctype html><script src="/audit.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
 timer=setInterval(()=>{for(const p of app.getAppMetrics())if(p.type==='Tab')peakKiB=Math.max(peakKiB,p.memory.peakWorkingSetSize);},100);
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 const samples=await win.webContents.executeJavaScript('window.runAudit()');
 console.log(JSON.stringify({samples,rendererPeakWorkingSetKiB:peakKiB},null,2));
}).catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{clearInterval(timer);win?.destroy();if(server)await new Promise(r=>server.close(r));app.quit();});
app.on('quit',()=>fs.rmSync(temp,{recursive:true,force:true}));
setTimeout(()=>{console.error('Audit exceeded 60-second budget');process.exitCode=1;app.quit();},60000).unref();
