// Fresh disposable profiles, alternating paired runs, no provider requests.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {summarizeComparison}=require('./comparisonSummary.cjs');
const root=path.resolve(__dirname,'../..'),desktop=process.env.XHANDLE_DESKTOP_ROOT;
if(!desktop||!process.env.XHANDLE_STRESS_BUNDLE)throw Error('Set XHANDLE_DESKTOP_ROOT and XHANDLE_STRESS_BUNDLE from a successful diagram-enabled warmup');
const output=process.env.XHANDLE_COMPARE_OUTPUT||fs.mkdtempSync('/private/tmp/xhandle-diagnostic-comparison-');fs.mkdirSync(output,{recursive:true});
const binary=path.join(desktop,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),results=[];
const pairs=Number(process.env.XHANDLE_COMPARE_PAIRS||5),count=Number(process.env.XHANDLE_STRESS_COUNTS||5000);
if(!Number.isInteger(pairs)||pairs<5||pairs>30||!Number.isInteger(count)||count<1||count>100000)throw Error('Invalid comparison workload');
const sources=[...['diagnostics.cjs','evidence-sampler.cjs','native-crashes.cjs','workspace-diagnostics.cjs','preload.cjs'].map(f=>path.join(desktop,'electron',f)),path.join(root,'src/lib/diagnosticOperations.js'),path.join(root,'scripts/diagnostics/stress-software-requirements-desktop.cjs'),path.join(__dirname,'statistics.cjs'),path.join(__dirname,'comparisonSummary.cjs'),process.env.XHANDLE_STRESS_BUNDLE];
const fingerprints=()=>Object.fromEntries(sources.map(f=>[f,require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const before=fingerprints();
(async()=>{
 for(let pair=0;pair<pairs;pair++)for(const enabled of pair%2?[true,false]:[false,true]){
  const folder=path.join(output,`pair-${pair}-${enabled?'enabled':'disabled'}`);fs.mkdirSync(folder,{recursive:true});const log=fs.openSync(path.join(folder,'run.log'),'w');
  const env={...process.env,XHANDLE_DESKTOP_ROOT:desktop,XHANDLE_STRESS_COUNTS:String(count),XHANDLE_STRESS_DIAGRAM:'1',XHANDLE_DIAGNOSTICS_ENABLED:enabled?'1':'0',XHANDLE_STRESS_OUTPUT:folder};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(binary,[path.join(root,'scripts/diagnostics/stress-software-requirements-desktop.cjs')],{env,stdio:['ignore',log,log]});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Comparison case timed out'));},240000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`Case failed: ${folder}`));});});fs.closeSync(log);
  const r=JSON.parse(fs.readFileSync(path.join(folder,'results.json'))).results[0];results.push({pair,enabled,...r});fs.writeFileSync(path.join(output,'cases.json'),JSON.stringify(results,null,2));console.log('CASE',JSON.stringify({pair,enabled,elapsedMs:r.elapsedMs,cpuSeconds:r.cpuSeconds,frameP95Ms:r.diagram.p95FrameGapMs,retainedHeapMiB:r.rendererRetainedHeapMiB,nativeMiB:r.nativeMemory?.totalFootprintBytes/1048576}));
 }
 const summary=summarizeComparison(results);
 summary.sourceFingerprints=before;summary.sourceUnchanged=JSON.stringify(before)===JSON.stringify(fingerprints());
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log('SUMMARY',JSON.stringify(summary));console.log('ARTIFACTS',output);
})().catch(error=>{console.error(error);process.exitCode=1;});
