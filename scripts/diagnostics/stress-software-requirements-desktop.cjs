// Run with Electron, with ELECTRON_RUN_AS_NODE unset. Synthetic data only.
// Exercises the production derivation, checkpoint, panel, persistence and table
// modules; this is a diagnostic harness, not a packaged-app/provider benchmark.
const {app,BrowserWindow,protocol,net,crashReporter}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const {median}=require('./statistics.cjs');
const base=path.resolve(__dirname,'../..'),webpack=require(path.join(base,'node_modules/webpack'));
const output=process.env.XHANDLE_STRESS_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-sw-stress-'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
const desktopRoot=process.env.XHANDLE_DESKTOP_ROOT,diagnosticsEnabled=process.env.XHANDLE_DIAGNOSTICS_ENABLED!=='0';
let diagnosticStore,resourceSampler,nativeCapture;
if(desktopRoot){
 app.commandLine.appendSwitch('js-flags','--expose-gc'); // Diagnostic measurement only; never a production setting.
 protocol.registerSchemesAsPrivileged([{scheme:'xhandle',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
 const native=p=>require(path.join(desktopRoot,'electron',p));
 nativeCapture=native('native-crashes.cjs').startNativeCrashCapture({app,crashReporter,enabled:diagnosticsEnabled});
 diagnosticStore=native('diagnostics.cjs').createDiagnostics({file:path.join(output,'diagnostics.json'),enabled:diagnosticsEnabled});
 native('workspace-diagnostics.cjs').installDiagnosticIPC({ipcMain:require('electron').ipcMain,getWindow:()=>win,diagnostics:diagnosticStore});
}
app.on('window-all-closed',()=>{}); // Keep the harness alive between cases.
app.commandLine.appendSwitch('enable-precise-memory-info');
const counts=(process.env.XHANDLE_STRESS_COUNTS||'5000,7500,15000').split(',').map(Number);
if(counts.some(n=>!Number.isInteger(n)||n<1||n>100000))throw Error('Invalid stress counts');
const diagramCount=Number(process.env.XHANDLE_STRESS_DIAGRAM_ROWS||500);
if(!Number.isInteger(diagramCount)||diagramCount<1||diagramCount>10000)throw Error('Invalid diagram count');
const nativeSampleCount=Number(process.env.XHANDLE_STRESS_NATIVE_SAMPLES||1);
if(!Number.isInteger(nativeSampleCount)||nativeSampleCount<1||nativeSampleCount>20)throw Error('Invalid native sample count');
const hazardCount=Number(process.env.XHANDLE_STRESS_HAZARD_ROWS||0);
if(!Number.isInteger(hazardCount)||hazardCount<0||hazardCount>100000)throw Error('Invalid hazard count');
const imp=p=>JSON.stringify(path.join(base,'src',p));
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import Panel from ${imp('features/code-architecture-assurance/EngineeringArtifactPanel.js')};
import {ActivityProvider} from ${imp('components/activity/ActivityCenter.jsx')};
import {ResultsReviewProvider} from ${imp('features/results-review/ResultsReviewProvider.js')};
import {deriveSoftwareRequirements} from ${imp('features/code-architecture-assurance/artifactAI.js')};
import {createRequirementCheckpoint} from ${imp('features/code-architecture-transfer/requirementCheckpoint.js')};
import {loadArtifactRowsAsync} from ${imp('features/code-architecture-assurance/artifactUtils.js')};
import {saveCodeArchitectureHazardRun} from ${imp('features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js')};
import Diagram from ${imp('components/LiteSummaryDiagramReactFlowGitHub.js')};
import {installDiagnosticErrorCapture} from ${imp('lib/diagnosticOperations.js')};
installDiagnosticErrorCapture();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,limit=600000)=>{const start=performance.now();while(!fn()){if(performance.now()-start>limit)throw Error('Timed out: '+document.body.innerText.slice(-1200));await sleep(30);}};
let requests=0;window.failures=[];window.phase='idle';window.progress=0;
window.addEventListener('error',e=>window.failures.push(e.message));
window.addEventListener('unhandledrejection',e=>window.failures.push(String(e.reason?.stack||e.reason)));
window.fetch=async(url,opts={})=>{
 if(!String(url).endsWith('/api/chat'))throw Error('Unexpected network request: '+url);
 const payload=JSON.parse(JSON.parse(opts.body).messages[1].content);requests++;
 if(payload.task!=='derive_software_requirements_from_functional_decomposition_batch')throw Error('Unexpected AI phase '+payload.task);
 const requirements=payload.functionalDecomposition.map((row,i)=>({
 id:'SWR-'+(payload.rowStart+i),sourceTraceId:row.traceId,
 requirementText:'The software shall reject invalid observations and publish a validated operational state within the configured processing interval.',
 rationale:'Validate operational inputs before publishing state. '.repeat(8),requirementType:'Functional',priority:'High'
 }));
 await sleep(1);return {ok:true,json:async()=>({answer:JSON.stringify({requirements})})};
};
window.reopenStress=async(count)=>{
 const started=performance.now();
 const rows=await loadArtifactRowsAsync('software-requirements','stress-'+count,'repo');
 if(rows.length!==count+${hazardCount}||new Set(rows.filter(r=>r.source==='functional-derived').map(r=>r.sourceTraceId)).size!==count)throw Error('Cold saved-data verification failed');
 const root=createRoot(document.getElementById('app'));
 root.render(React.createElement(ActivityProvider,null,React.createElement(ResultsReviewProvider,{mode:'collaborator'},React.createElement(Panel,{kind:'software-requirements',project:{id:'stress-'+count},repo:{id:'repo'},cbaRows:[]}))));
 await wait(()=>document.body.innerText.includes('The software shall'));
 if(requests!==0)throw Error('Cold open unexpectedly called AI');
 return {count,elapsedMs:performance.now()-started,requests,failures:window.failures};
};
window.runStress=async(count,resume)=>{
 const project={id:'stress-'+count,name:'Synthetic stress '+count},repo={id:'repo',repoId:'repo',repoName:'synthetic'};
 const cbaRows=Array.from({length:count},(_,i)=>({rowRef:String(i+1),traceId:'FD-'+(i+1),
 from:'Observe state '+i,to:'Validate state '+i,action:'Publish observation '+i,
 fromFile:'perception/component_'+Math.floor(i/10)+'.cpp',toFile:'perception/consumer_'+Math.floor(i/10)+'.cpp',
 fromDetails:'Synthetic source evidence. '.repeat(35),toDetails:'Synthetic target evidence. '.repeat(35),
 functionalModel:{internal:false},architecture:{subsystem:'Perception',csci:'Sensor Processing',csc:'Component '+Math.floor(i/100),csu:'Unit '+Math.floor(i/10)}}));
 if(${hazardCount})await saveCodeArchitectureHazardRun({id:'hazards-'+count,projectId:project.id,repoId:repo.id,runState:'complete',hazardMethod:'STPA-Textbook',updatedAt:'2026-11-03T00:00:00Z',
 architectureRowsSnapshot:cbaRows,narrativeReviewInput:{text:'Synthetic narrative evidence. '.repeat(200000)},
 generatedSheets:{Summary:[['Hazard','Software Safety Requirement','Safety Significant'],...Array.from({length:${hazardCount}},(_,i)=>['Hazard '+i,'enforce safe operating limit '+i,'Yes'])]}});
 const samples=[],longTasks=[];let phase='mount',last=performance.now(),maxGap=0,peakHeap=0;
 const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({phase,durationMs:e.duration});});observer.observe({entryTypes:['longtask']});
 const meter=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last-50);last=now;peakHeap=Math.max(peakHeap,performance.memory.usedJSHeapSize);},50);
 const mark=label=>{phase=label;window.phase=label;console.log('STRESS_PHASE',label);peakHeap=Math.max(peakHeap,performance.memory.usedJSHeapSize);samples.push({phase:label,atMs:performance.now(),heapMiB:performance.memory.usedJSHeapSize/1048576});};
 let root=createRoot(document.getElementById('app'));
 const render=()=>root.render(React.createElement(ActivityProvider,null,React.createElement(ResultsReviewProvider,{mode:'collaborator'},React.createElement(Panel,{kind:'software-requirements',project,repo,cbaRows}))));
 const started=performance.now(),initialRequests=requests;
 try{
 render();await wait(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Derive from Functional')&&!b.disabled));
 mark('derive');Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Derive from Functional')).click();
 await wait(()=>document.body.innerText.includes('derived for review'));
 mark('saved');const rows=await loadArtifactRowsAsync('software-requirements',project.id,repo.id);
 if(rows.length!==count+${hazardCount}||rows.some(r=>!['functional-derived','hazard-derived'].includes(r.source)))throw Error('Wrong result count or fallback rows: '+rows.length);
 if(new Set(rows.filter(r=>r.source==='functional-derived').map(r=>r.sourceTraceId)).size!==count)throw Error('Lost source coverage');
 if(rows.filter(r=>r.source==='hazard-derived').length!==${hazardCount})throw Error('Lost hazard safety coverage');
 await wait(()=>document.querySelectorAll('tbody td').length>0&&document.body.innerText.includes('The software shall'));
 mark('scroll');let scrollCount=0,maxMountedRows=0;
 for(let i=0;i<120;i++){
 const scrollers=Array.from(document.querySelectorAll('#app *')).filter(e=>e.clientHeight>100&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY));
 if(!scrollers.length)throw Error('No table scroll container');
 const el=scrollers.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];el.scrollTop=(el.scrollHeight-el.clientHeight)*(i%40)/39;
 el.dispatchEvent(new Event('scroll'));scrollCount++;maxMountedRows=Math.max(maxMountedRows,document.querySelectorAll('tbody tr').length);await sleep(16);
 }
 let reachedLastRow=false;
 for(let attempt=0;attempt<5&&!reachedLastRow;attempt++){
 const el=Array.from(document.querySelectorAll('#app *')).filter(e=>e.clientHeight>100&&e.scrollHeight>e.clientHeight+100&&/auto|scroll/.test(getComputedStyle(e).overflowY)).sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];
 el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));await sleep(100);
 reachedLastRow=Array.from(document.querySelectorAll('tbody td')).some(e=>${hazardCount} ? e.textContent.includes('enforce safe operating limit '+(${hazardCount}-1)) : e.textContent.trim()==='FD-'+count);
 }
 if(!reachedLastRow)throw Error('Did not reach the final saved requirement through scrolling');
 mark('reopen');root.unmount();await sleep(100);root=createRoot(document.getElementById('app'));render();
 await wait(()=>document.querySelectorAll('tbody td').length>0&&document.body.innerText.includes('The software shall'));
 if(!document.body.innerText.includes('The software shall'))throw Error('Saved table failed to reopen');
 const afterDerive=requests;let resumedRequests=null;
 if(afterDerive-initialRequests!==Math.ceil(count/5))throw Error('Expected a fresh synthetic profile and exactly one AI request per five source rows');
 if(resume){
 mark('checkpoint-reuse');const progress=()=>{};progress.requestCheckpoint=createRequirementCheckpoint(project.id,repo.id,'software-requirements');
 const restored=await deriveSoftwareRequirements({cbaRows,projectName:project.name,repoName:repo.repoName,onProgress:progress});
 resumedRequests=requests-afterDerive;
 if(restored.length!==count||resumedRequests!==0)throw Error('Checkpoint reuse failed: '+resumedRequests+' extra model requests');
 }
 let diagram=null;
 if(${Boolean(process.env.XHANDLE_STRESS_DIAGRAM)}){
 mark('diagram');const diagramStart=performance.now();root.unmount();root=createRoot(document.getElementById('app'));
 const architecture={subsystem:'Perception',csci:'Software',csc:'Control',csu:'Processing'};
 const diagramRows=Array.from({length:${diagramCount}},(_,i)=>({traceId:'diagram-'+i,fromNodeId:'node-'+i,toNodeId:'node-'+(i+1),edgeId:'edge-'+i,fromFunction:'Observe '+i,toFunction:'Observe '+(i+1),controlAction:'Validated state',fromFile:'input.cpp',toFile:'output.cpp',fromArchitecture:architecture,toArchitecture:architecture}));
 root.render(React.createElement(ActivityProvider,null,React.createElement(ResultsReviewProvider,{mode:'collaborator'},React.createElement(Diagram,{rows:diagramRows,storageKey:'bench-diagram',architectureMode:true,architectureAbstraction:'detailed',functionalPresentation:true,height:740}))));
 await wait(()=>document.querySelectorAll('.react-flow__node').length>0,30000);await sleep(1000);
 const pane=document.querySelector('.react-flow__pane'),viewport=document.querySelector('.react-flow__viewport');const before=viewport.style.transform;
 const gaps=[];let previous=performance.now();
 const wheelEvents=${Number(process.env.XHANDLE_STRESS_WHEEL_EVENTS)||360};
 for(let i=0;i<wheelEvents;i++){pane.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:500,clientY:350,ctrlKey:i<wheelEvents/2,deltaX:i<wheelEvents/2?0:10,deltaY:i<wheelEvents/2?-8:4}));await sleep(16);const now=performance.now();gaps.push(now-previous);previous=now;}
 await sleep(500);const after=viewport.style.transform;if(before===after)throw Error('Diagram navigation did not change the real viewport');
 diagram={rows:diagramRows.length,nodes:document.querySelectorAll('.react-flow__node').length,wheelEvents,elapsedMs:performance.now()-diagramStart,p95FrameGapMs:gaps.sort((a,b)=>a-b)[Math.floor(gaps.length*.95)],measurement:'Synthetic WheelEvent dispatch interval, not compositor frame time',viewportChanged:before!==after};
 }
 mark('finished');if(window.failures.length)throw Error(window.failures.join('; '));
 return {count,hazardRows:${hazardCount},resultRows:rows.length,elapsedMs:performance.now()-started,sourceMiB:JSON.stringify(cbaRows).length/1048576,resultMiB:JSON.stringify(rows).length/1048576,requests:afterDerive-initialRequests,resumedRequests,scrollCount,reachedLastRow,maxMountedRows,peakHeapMiB:peakHeap/1048576,maxEventLoopDelayMs:maxGap,longTasks,samples,diagram,failures:window.failures};
 }finally{clearInterval(meter);observer.disconnect();if(!${Boolean(process.env.XHANDLE_STRESS_KEEP_MOUNTED)})root.unmount();}
};
`;
fs.writeFileSync(path.join(output,'entry.jsx'),entry);
let win,server,meter,statusTimer;const metrics=[],results=[];let failure=null;
async function nativeSamples(number=1){
 const samples=[];
 for(let i=0;i<number;i++){
  if(i)await new Promise(r=>setTimeout(r,500));
  const roles=new Map(app.getAppMetrics().map(p=>[p.pid,p.type]));
  const sample=JSON.parse(require('node:child_process').execFileSync('python3',[path.join(base,'scripts/diagnostics/desktop-process-footprint.py'),String(process.pid),path.join(output,'profile/diagnostic-crashes')],{encoding:'utf8',timeout:5000}));
  for(const p of sample.processes)p.role=roles.get(p.pid)||p.role;
  samples.push(sample);
 }
 const roles=[...new Set(samples.flatMap(s=>s.processes.map(p=>p.role)))];
 return {availability:'available',samples,totalFootprintBytes:median(samples.map(s=>s.totalFootprintBytes)),byRole:Object.fromEntries(roles.map(role=>[role,median(samples.map(s=>s.processes.filter(p=>p.role===role).reduce((n,p)=>n+p.footprintBytes,0)))]))};
}
const deadline=setTimeout(()=>{failure='Overall 20-minute diagnostic timeout';fs.writeFileSync(path.join(output,'failure.txt'),failure);app.exit(2)},1200000);deadline.unref();
app.whenReady().then(async()=>{
 if(process.env.XHANDLE_STRESS_BUNDLE)fs.copyFileSync(process.env.XHANDLE_STRESS_BUNDLE,path.join(output,'stress.js'));
 else await new Promise((resolve,reject)=>{const compiler=webpack({mode:'production',devtool:false,entry:path.join(output,'entry.jsx'),output:{path:output,filename:'stress.js'},optimization:{minimize:false},
 resolve:{extensions:['.js','.jsx','.json'],modules:[path.join(base,'node_modules')]},
 plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'production',REACT_APP_BACKEND_URL:'http://127.0.0.1:9'})})],
 module:{rules:[{test:/\.css$/,use:[require.resolve(path.join(base,'node_modules/style-loader')),require.resolve(path.join(base,'node_modules/css-loader'))]},{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve(path.join(base,'node_modules/babel-loader')),options:{babelrc:false,configFile:false,presets:[require.resolve(path.join(base,'node_modules/@babel/preset-env')),[require.resolve(path.join(base,'node_modules/@babel/preset-react')),{runtime:'automatic'}]]}}}]}});
 compiler.run((e,s)=>{compiler.close(()=>{});e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()});});
 const cssDir=path.join(base,'build/static/css');const css=fs.existsSync(cssDir)?fs.readdirSync(cssDir).find(f=>/^main.*\.css$/.test(f)):null;
 server=http.createServer((req,res)=>{
 if(req.url==='/stress.js'){res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(output,'stress.js')).pipe(res);}
 else if(req.url==='/style.css'&&css){res.setHeader('Content-Type','text/css');fs.createReadStream(path.join(cssDir,css)).pipe(res);}
 else{res.setHeader('Content-Type','text/html');res.end('<html><link rel="stylesheet" href="/style.css"><style>html,body,#app{height:100%;margin:0}body{font-family:sans-serif}#app{padding:12px;box-sizing:border-box}</style><div id="app"></div><script src="/stress.js"></script></html>');}
 });
 const savedPort=process.env.XHANDLE_STRESS_COLD_ONLY?JSON.parse(fs.readFileSync(path.join(output,'origin.json'),'utf8')).port:0;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(savedPort,'127.0.0.1',resolve);});
 fs.writeFileSync(path.join(output,'origin.json'),JSON.stringify({port:server.address().port}));
 const origin=desktopRoot?'xhandle://app':'http://127.0.0.1:'+server.address().port;
 if(desktopRoot){protocol.handle('xhandle',request=>net.fetch('http://127.0.0.1:'+server.address().port+new URL(request.url).pathname));resourceSampler=require(path.join(desktopRoot,'electron/evidence-sampler.cjs')).createEvidenceSampler({app,diagnostics:diagnosticStore,enabled:diagnosticsEnabled});}
 for(const count of counts){
 console.log('START',count);
 win=new BrowserWindow({show:!desktopRoot,title:'xHandle isolated software-requirements stress test',width:1440,height:900,webPreferences:{...(desktopRoot?{preload:path.join(desktopRoot,'electron/preload.cjs'),additionalArguments:diagnosticsEnabled?[]:['--xhandle-diagnostics-disabled']}:{}),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 if(desktopRoot){if(diagnosticsEnabled)require(path.join(desktopRoot,'electron/workspace-diagnostics.cjs')).installWorkspaceDiagnostics({win,diagnostics:diagnosticStore});}
 else win.webContents.on('console-message',event=>{if(event.level==='error'||event.message?.startsWith('STRESS_PHASE'))console.log('RENDERER',event.message);});
 win.webContents.on('render-process-gone',(_e,d)=>{failure={event:'render-process-gone',count,...d};fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(failure,null,2));});
 win.on('unresponsive',()=>console.log('UNRESPONSIVE',count));
 meter=setInterval(()=>{const m={at:Date.now(),count,processes:app.getAppMetrics()};metrics.push(m);fs.appendFileSync(path.join(output,'metrics.jsonl'),JSON.stringify(m)+'\n');},1000);
 await win.loadURL(origin);
 let nativeBaseline;
 if(process.env.XHANDLE_STRESS_NATIVE_SAMPLES&&process.platform==='darwin'){
  await new Promise(r=>setTimeout(r,2000));
  nativeBaseline=await nativeSamples(nativeSampleCount);
 }
 const cpuStart=app.getAppMetrics().reduce((sum,p)=>sum+p.cpu.cumulativeCPUUsage,0);
 statusTimer=setInterval(()=>{win?.webContents.executeJavaScript('JSON.stringify({phase:window.phase,body:document.body.innerText.slice(-1000),errors:window.failures})').then(s=>console.log('STATUS',s)).catch(()=>{});},10000);
 let result={count};
 if(!process.env.XHANDLE_STRESS_COLD_ONLY){
 result=await win.webContents.executeJavaScript('window.runStress('+count+','+(count===7500)+')');
 result.cpuSeconds=app.getAppMetrics().reduce((sum,p)=>sum+p.cpu.cumulativeCPUUsage,0)-cpuStart;
 result.rendererSteadyHeapMiB=await win.webContents.executeJavaScript('performance.memory.usedJSHeapSize/1048576');
 if(desktopRoot){
  if(diagnosticStore)await diagnosticStore.persist();
  await new Promise(r=>setTimeout(r,2000));
  result.rendererRetainedHeapMiB=await win.webContents.executeJavaScript('(async()=>{if(typeof gc==="function")gc();await new Promise(r=>setTimeout(r,100));if(typeof gc==="function")gc();return performance.memory.usedJSHeapSize/1048576;})()');
  if(diagnosticStore)await diagnosticStore.persist();
  try{require('node:v8').setFlagsFromString('--expose_gc');require('node:vm').runInNewContext('gc')();}catch{}
  if(process.platform==='darwin')try{result.nativeMemory=await nativeSamples(nativeSampleCount);result.nativeBaseline=nativeBaseline;result.measuredMountedNodes=await win.webContents.executeJavaScript('document.querySelectorAll(".react-flow__node").length');}catch{result.nativeMemory={availability:'unavailable'};}
 }
 if(diagnosticStore){await diagnosticStore.persist();result.diagnosticsEnabled=diagnosticsEnabled;result.diagnosticStats=diagnosticStore.stats();result.recordedOperations=diagnosticStore.snapshot().entries.filter(e=>e.operation).length;result.nativeCaptureEnabled=nativeCapture.enabled;if(diagnosticsEnabled&&!result.recordedOperations)throw Error('Benchmark did not exercise native diagnostic IPC');}
 await win.loadURL(origin);
 }
 result.coldOpen=await win.webContents.executeJavaScript('window.reopenStress('+count+')');
 results.push(result);fs.writeFileSync(path.join(output,process.env.XHANDLE_STRESS_COLD_ONLY?'cold-results.json':'results.json'),JSON.stringify({electron:process.versions.electron,chrome:process.versions.chrome,counts,results},null,2));
 console.log('RESULT',JSON.stringify({...result,longTasks:result.longTasks?.length||0}));
 clearInterval(meter);clearInterval(statusTimer);win.destroy();win=null;if(failure)throw Error(JSON.stringify(failure));
 }
}).catch(e=>{failure=String(e.stack||e);console.error(failure);fs.writeFileSync(path.join(output,'failure.txt'),failure);process.exitCode=1;}).finally(async()=>{
 clearInterval(meter);clearInterval(statusTimer);clearTimeout(deadline);resourceSampler?.dispose();await diagnosticStore?.close();win?.destroy();if(server)await new Promise(r=>server.close(r));console.log('ARTIFACTS',output);app.quit();
});
