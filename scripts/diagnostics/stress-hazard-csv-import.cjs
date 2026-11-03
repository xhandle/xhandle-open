// Disposable Electron profile; local CSV and fixture paths are supplied by the
// operator. No provider requests or installed/user profile writes are made.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const base=path.resolve(__dirname,'../..'),webpack=require(path.join(base,'node_modules/webpack'));
const csv=process.env.XHANDLE_CSV_FILE,baseline=process.env.XHANDLE_CSV_BASELINE;
if(!csv||!baseline)throw Error('Set XHANDLE_CSV_FILE and XHANDLE_CSV_BASELINE.');
const output=fs.mkdtempSync('/private/tmp/xhandle-csv-runtime-');app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('js-flags','--max-old-space-size=1536');app.commandLine.appendSwitch('enable-precise-memory-info');
const imp=file=>JSON.stringify(path.join(base,'src',file));
fs.writeFileSync(path.join(output,'entry.js'),`
import createWorker from ${imp('features/code-architecture-hazard-analysis/createHazardCsvImportWorker.js')};
import {hazardCsvTransferRun} from ${imp('features/code-architecture-hazard-analysis/hazardCsvTransfer.js')};
import {summarySheetToHazardSummaryRows} from ${imp('features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js')};
import {getLatestCodeArchitectureHazardRun} from ${imp('features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js')};
import {queryHazardRows} from ${imp('features/code-architecture-hazard-analysis/pagedHazardRows.js')};
window.phase='fixture';window.errors=[];window.addEventListener('error',e=>window.errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.errors.push(String(e.reason?.message||e.reason)));
const assert=(condition,message)=>{if(!condition)throw Error(message);};
function client(){const worker=createWorker(),pending=new Map();let next=0;
 worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;if(data.type==='progress'){window.phase=data.progress.phase;window.progress=data.progress;return;}if(data.type==='committed')return;pending.delete(data.id);data.type==='error'?request.reject(Error(data.message)):request.resolve(data.result);};
 worker.onerror=event=>{pending.forEach(p=>p.reject(Error(event.message)));pending.clear();};
 return {send:(operation,args={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});const transfer={...args};if(args.run)transfer.run=hazardCsvTransferRun(args.run);if(args.currentRun)transfer.currentRun=hazardCsvTransferRun(args.currentRun,true);worker.postMessage({id,operation,args:transfer});}),dispose:()=>worker.terminate()};}
window.verifyCsv=async(expected,blank=false)=>{
 const run=await getLatestCodeArchitectureHazardRun({projectId:'csv-runtime'},{workingSet:true,paged:true});
 assert(run.__xhandlePagedHazard.total===expected.rows,'Saved row count changed');
 for(const sample of expected.samples){const page=await queryHazardRows(run,{raw:true,offset:sample.index,limit:1});
  for(const [header,value]of Object.entries(sample.cells)){const actual=page.rows[0][page.headers.indexOf(header)];assert(actual===(blank&&header!=='Raw Analysis Row ID'?'':value),'Saved cell mismatch: '+header+' at '+sample.index);}
 }
 return {verified:true,rows:run.__xhandlePagedHazard.total};
};
window.runCsv=async()=>{
 const sheet=await(await fetch('/baseline')).json(),expected=await(await fetch('/expected')).json();
 const blob=await(await fetch('/csv')).blob(),file=new File([blob],'completed.csv',{type:'text/csv'});
 const draft={id:'csv-runtime-run',projectId:'csv-runtime',repoId:'repo',hazardMethod:'STPA-Textbook',generatedSheets:{Summary:sheet,Other:[['Keep'],['Evidence']]},architectureRowsSnapshot:['retained synthetic evidence'],narrativeReviewInput:{text:'Retained synthetic narrative'}};
 if(${Boolean(process.env.XHANDLE_CSV_DRAFT_CACHE)})draft.summaryRows=summarySheetToHazardSummaryRows(sheet);
 if(${Number(process.env.XHANDLE_CSV_DEFERRED_BYTES)||0}){draft.architectureRowsSnapshot=[{details:'e'.repeat(${Number(process.env.XHANDLE_CSV_DEFERRED_BYTES)||0})}];draft.narrativeReviewInput={text:'n'.repeat(${Number(process.env.XHANDLE_CSV_DEFERRED_BYTES)||0})};}
 const worker=client(),start=performance.now();let last=start,maxDelay=0,peakHeap=performance.memory.usedJSHeapSize;
 const meter=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last-50);last=now;peakHeap=Math.max(peakHeap,performance.memory.usedJSHeapSize);},50);
 try{
  window.phase='prepare';const plan=await worker.send('prepare',{run:draft,file});const prepared=performance.now();assert(plan.changedRowCount===expected.rows,'Missing imported rows');
  assert(!await getLatestCodeArchitectureHazardRun({projectId:'csv-runtime'},{metadataOnly:true}),'Preview published results before confirmation');
  window.phase='apply';const saved=await worker.send('apply',{currentRun:draft});const applied=performance.now();assert(saved.run.__xhandlePagedHazard,'Import did not return a paged run');
  await window.verifyCsv(expected);window.phase='undo';const undo=await worker.send('prepare',{run:saved.run,undo:true});assert(undo.changedRowCount>0,'Undo found no changes');
  await worker.send('apply',{currentRun:saved.run});await window.verifyCsv(expected,true);
  return {fileBytes:file.size,rows:expected.rows,draftCache:${Boolean(process.env.XHANDLE_CSV_DRAFT_CACHE)},prepareMs:prepared-start,applyMs:applied-prepared,totalIncludingUndoMs:performance.now()-start,maxEventLoopDelayMs:maxDelay,peakRendererHeapMiB:peakHeap/1048576,confirmedBeforePublication:true,reopenVerified:true,undoVerified:true,errors:window.errors,expected};
 }finally{clearInterval(meter);worker.dispose();window.phase='finished';}
};
`);
let win,server,statusTimer,sampleTimer;let peakWorkingSetMiB=0;
const timer=setTimeout(()=>{console.error('CSV runtime timeout',output);app.exit(2);},1200000);timer.unref();
app.whenReady().then(async()=>{
 await new Promise((resolve,reject)=>{const compiler=webpack({mode:'production',devtool:false,entry:path.join(output,'entry.js'),output:{path:output,filename:'main.js'},optimization:{minimize:false},resolve:{extensions:['.js','.jsx','.json'],modules:[path.join(base,'node_modules')]},plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'production',REACT_APP_BACKEND_URL:'http://127.0.0.1:9'})})],module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:{loader:require.resolve(path.join(base,'node_modules/babel-loader')),options:{babelrc:false,configFile:false,presets:[require.resolve(path.join(base,'node_modules/@babel/preset-env')),[require.resolve(path.join(base,'node_modules/@babel/preset-react')),{runtime:'automatic'}]]}}}]}});compiler.run((error,stats)=>{compiler.close(()=>{});error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve();});});
 server=http.createServer((req,res)=>{const files={'/csv':csv,'/baseline':baseline,'/expected':process.env.XHANDLE_CSV_EXPECTED};
  if(files[req.url]){res.setHeader('Content-Type',req.url==='/csv'?'text/csv':'application/json');fs.createReadStream(files[req.url]).pipe(res);}
  else if(/\.js$/.test(req.url)){res.setHeader('Content-Type','text/javascript');const file=path.join(output,path.basename(req.url));fs.createReadStream(file).on('error',()=>res.end()).pipe(res);}
  else{res.setHeader('Content-Type','text/html');res.end('<html><div>Isolated CSV import verification</div><script src="/main.js"></script></html>');}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const failures=[];win.webContents.on('render-process-gone',(_e,details)=>{failures.push(details);console.error('RENDERER_GONE',JSON.stringify(details));app.exit(3);});
 const origin='http://127.0.0.1:'+server.address().port;await win.loadURL(origin);
 statusTimer=setInterval(()=>win.webContents.executeJavaScript('JSON.stringify({phase:window.phase,progress:window.progress,errors:window.errors})').then(value=>console.log('STATUS',value)).catch(()=>{}),10000);
 sampleTimer=setInterval(()=>{peakWorkingSetMiB=Math.max(peakWorkingSetMiB,app.getAppMetrics().reduce((sum,p)=>sum+(p.memory?.workingSetSize||0),0)/1024);},250);
 const result=await win.webContents.executeJavaScript('window.runCsv()');result.peakWorkingSetMiB=peakWorkingSetMiB;result.failures=failures;result.electron=process.versions.electron;
 // Cold reload verifies that undo was durable, without renderer state/caches.
 await win.loadURL(origin);result.coldReopen=await win.webContents.executeJavaScript('window.verifyCsv('+JSON.stringify(result.expected)+',true)');delete result.expected;
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));console.log('ARTIFACTS',output);
 clearInterval(statusTimer);clearInterval(sampleTimer);clearTimeout(timer);win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);console.log('ARTIFACTS',output);clearInterval(statusTimer);clearInterval(sampleTimer);server?.close();app.exit(1);});
