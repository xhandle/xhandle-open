// Synthetic data only, isolated profiles, external HTTP(S) requests blocked.
// node scripts/diagnostics/collaborator-stage2/run.cjs chrome
// node scripts/diagnostics/collaborator-stage2/run.cjs electron /path/to/Electron
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const mode=process.argv[2];
if(!['chrome','electron'].includes(mode)||mode==='electron'&&!process.argv[3])throw Error('Specify chrome, or electron followed by the executable path.');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-collaborator-stage2-'));
const env={...process.env,XHANDLE_AUDIT_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;
function run(executable,args){const child=spawnSync(executable,args,{env,encoding:'utf8',timeout:240000});fs.appendFileSync(path.join(output,'run.log'),(child.stdout||'')+(child.stderr||''));if(child.status!==0)throw Error('Audit failed; inspect '+path.join(output,'run.log'));}
run(process.execPath,[path.join(__dirname,'build.cjs')]);
run(mode==='chrome'?process.execPath:process.argv[3],[path.join(output,mode==='chrome'?'chrome.cjs':'main.cjs')]);
const results=JSON.parse(fs.readFileSync(path.join(output,mode==='chrome'?'chrome-results.json':'results.json'),'utf8'));
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
console.log(JSON.stringify({output,runtime:results.runtime,workerStarts:results.workerStarts,checks:results.checks,heap:results.heap,targetedReads:results.targetedReads,warm:results.warm.map(({n,samples})=>({records:n,samples:samples.length,p50Ms:percentile(samples.map(s=>s.elapsedMs),.5),p95Ms:percentile(samples.map(s=>s.elapsedMs),.95),fullBodyReads:samples.reduce((sum,s)=>sum+s.artifactStoreReads,0)}))},null,2));
