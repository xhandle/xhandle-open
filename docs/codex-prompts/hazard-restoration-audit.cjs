const fs=require('fs'),vm=require('vm'),assert=require('assert'),cp=require('child_process');
const source=fs.readFileSync('src/App.js','utf8');
const extract=s=>{const a=s.indexOf('  useEffect(() => {',s.indexOf('  const hazardLoadRepoId ='));const b=s.indexOf('\n\n  useEffect',a);return s.slice(a,b)};
assert.equal(extract(source),extract(cp.execFileSync('git',['show','HEAD:src/App.js'],{encoding:'utf8',maxBuffer:8000000})));
console.log('PASS loader identical to HEAD before performance changes');
const flush=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
function harness(read,align=x=>x,save=async()=>{}){
 const states=[],events={},warnings=[];let cleanup;
 const context={useEffect:f=>{cleanup=f()},setCodeArchitectureHazardRun:x=>states.push(x),activeCodeArchitectureProjectId:'p',activeCodeArchitectureRepo:{id:'connection'},hazardLoadRepoId:'repo',codeHazardRunsRef:{current:{revision:()=>0,get:()=>null}},hazardContextSavePending:{current:null},hazardContextSaveVersion:{current:0},getLatestCodeArchitectureHazardRun:read,loadCodeArchitectureHazardContexts:()=>[],assignImportedHazardContext:align,saveCodeArchitectureHazardRun:save,window:{addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]},console:{warn:(...x)=>warnings.push(x)}};
 vm.runInNewContext(extract(source),context);
 return {states,events,warnings,context,cleanup};
}
(async()=>{
 const run={id:'saved',generatedSheets:{Summary:[['id'],...Array.from({length:26278},(_,i)=>[i])]}};
 let wait=deferred(),h=harness(()=>wait.promise);assert.equal(h.states.at(-1),null);wait.resolve(run);await flush();assert.equal(h.states.at(-1),run);console.log('PASS delayed 26,278-row result: null until read resolves, then full run');
 let calls=0;h=harness(async()=>{if(++calls===1)throw Error('read failed');return run});await flush();assert.equal(h.states.at(-1),null);assert.equal(calls,1);h.events['xhandle:code-architecture-hazard-analysis:changed']({detail:{projectId:'p',repoId:'repo'}});await flush();assert.equal(h.states.at(-1),run);console.log('PASS transient failure: null and no automatic retry; matching event restores run');
 const first=deferred(),second=deferred();calls=0;h=harness(()=>++calls===1?first.promise:second.promise);h.events['xhandle:code-architecture-hazard-analysis:changed']({detail:{}});second.resolve(run);await flush();first.resolve({id:'older'});await flush();assert.equal(h.states.at(-1),run);console.log('PASS older overlapping response cannot replace latest result');
 wait=deferred();h=harness(()=>wait.promise);h.cleanup();wait.resolve(run);await flush();assert.equal(h.states.length,1);console.log('PASS cleanup prevents publishing departed scope');
 h=harness(async()=>run,x=>({...x,aligned:true}),async()=>{throw Error('context save failed')});await flush();assert.equal(h.states.at(-1),null);console.log('REPRODUCED context alignment save failure hides successfully read run');
 wait=deferred();h=harness(()=>wait.promise);h.context.hazardContextSaveVersion.current++;wait.resolve(run);await flush();assert.equal(h.states.at(-1),null);console.log('REPRODUCED context version change suppresses result with no retry');
 h=harness(async()=>run);await flush();h.context.getLatestCodeArchitectureHazardRun=async()=>{throw Error('refresh failed')};h.events['xhandle:code-architecture-hazard-analysis:changed']({detail:{}});await flush();assert.equal(h.states.at(-1),null);console.log('REPRODUCED failed background refresh clears previously visible saved run');
})().catch(e=>{console.error(e);process.exitCode=1});
(async()=>{
 const opened=deferred(),meta=deferred(),payload=deferred();let settled=false;const calls=[];
 const context={openDB:()=>opened.promise,indexedDB:{},localStorage:{getItem:()=>null},window:{addEventListener:()=>{}},console};
 const store=fs.readFileSync('src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js','utf8').replace('import { openDB } from "idb";','').replace(/export default[\s\S]*$/,'').replace(/export \{[^}]*\};/g,'').replaceAll('export ','');
 vm.runInNewContext(store,context);
 const promise=context.getLatestCodeArchitectureHazardRun({projectId:'p',repoId:'repo'}).then(x=>{settled=true;return x});
 await flush();assert.equal(settled,false);
 opened.resolve({getAllFromIndex:()=>{calls.push('metadata');return meta.promise},get:()=>{calls.push('payload');return payload.promise}});
 await flush();assert.deepEqual(calls,['metadata']);assert.equal(settled,false);
 meta.resolve([{id:'saved',projectId:'p',repoId:'repo'}]);await flush();assert.deepEqual(calls,['metadata','payload']);assert.equal(settled,false);
 payload.resolve({id:'saved',generatedSheets:{Summary:[['id'],['row']]}});assert.equal((await promise).id,'saved');
 console.log('PASS actual store waits for delayed open, metadata and payload without converting pending reads to missing');
})().catch(e=>{console.error(e);process.exitCode=1});
