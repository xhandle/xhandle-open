// Read-only real-source regression. All AI/GitHub responses are intercepted in an
// isolated browser context. No customer browser profile or paid service is used.
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const root = process.argv[2];
if (!root) throw new Error('Pass the local Alpamayo checkout path.');
let paths = [
 'src/alpamayo_r1/geometry/coordinates.py',
 'src/alpamayo_r1/geometry/rotation.py',
 'src/alpamayo_r1/action_space/unicycle_accel_curvature.py',
 'tests/test_diffusion_expert_cuda_graph.py',
];
if (process.argv.includes('--all')) {
 const collect=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?collect(path.join(directory,entry.name)):entry.name.endsWith('.py')?[path.relative(root,path.join(directory,entry.name))]:[]);
 paths=[...collect(path.join(root,'src')),...collect(path.join(root,'tests'))].sort();
}
const files = paths.map(file => {const content=fs.readFileSync(path.join(root,file),'utf8');return {path:file,content,sha:crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')};});
const table='| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
  const page=await browser.newPage();let mode='omitted', requests=0;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='api.github.com') {
    let result;
    if(url.pathname.includes('/commits/')) result={sha:'a'.repeat(40)};
    else if(url.pathname.includes('/git/trees/')) result={tree:files.map(file=>({path:file.path,type:'blob',mode:'100644',sha:file.sha,size:Buffer.byteLength(file.content)}))};
    else if(url.pathname.includes('/git/blobs/')) {const file=files.find(file=>url.pathname.endsWith(file.sha));result={encoding:'base64',content:Buffer.from(file.content).toString('base64')};}
    else if(url.pathname.includes('/contents/')) {const file=files.find(file=>url.pathname.endsWith(file.path));result={encoding:'base64',content:Buffer.from(file.content).toString('base64')};}
    else result={default_branch:'main'};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
   }
   if(url.pathname.startsWith('/api/')) {
    if(!url.pathname.endsWith('/chat')) return route.fulfill({status:401,body:'fixture'});
    requests++;const headers=route.request().headers();
    const body=route.request().postData() || '';
    const proposals=mode==='enriched' && body.includes('rotation.py') ? '\n| rotation_matrix | src/alpamayo_r1/geometry/rotation.py | Caller | Invoke cosine | Different model wording | np.cos | src/alpamayo_r1/geometry/rotation.py | Imported operation |' : '';
    return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'http://localhost:3000','Access-Control-Allow-Credentials':'true','Access-Control-Expose-Headers':'X-AI-Provider-Used,X-AI-Model-Used,X-AI-Effort-Used','X-AI-Provider-Used':headers['x-ai-provider']||'openai','X-AI-Model-Used':headers['x-ai-model']||'gpt-4o-mini','X-AI-Effort-Used':headers['x-ai-effort']||'automatic'},contentType:'application/json',body:JSON.stringify({answer:table+proposals})});
   }
   if(['localhost','127.0.0.1'].includes(url.hostname)) return route.continue();
   return route.abort();
  });
  await page.goto('http://localhost:3000');
  await page.evaluate(()=>{const key=Object.keys(window).find(key=>key.startsWith('webpackChunk'));window[key].push([[Date.now()],{},r=>window.fixtureRequire=r]);});
  const run=async(adapter,storageKey)=>page.evaluate(async({adapter,storageKey,files})=>{
   const req=window.fixtureRequire;
   const local=req('./src/features/code-architecture-context/localCodeSource.js');
   const browserFiles=files.map(entry=>{const file=new File([entry.content],entry.path.split('/').pop());Object.defineProperty(file,'webkitRelativePath',{value:`alpamayo-main/${entry.path}`});return file;});
   const repoConfig=adapter==='local'?local.registerLocalFolder({files:browserFiles,sourceId:storageKey,folderName:'alpamayo-main'}):{owner:'fixture',repo:'alpamayo',branch:'main'};
   return req('./src/components/generateFunctionalDecompositionFromGitHub.js').generateFunctionalDecompositionFromGitHub(()=>{},()=>{},null,{repoConfig,storageKey,selectedExtensions:['.py'],resumeFromCheckpoint:false,analysisContext:{text:'',files:[]}});
  },{adapter,storageKey,files});
  const git=await run('github','cba:convergence:github');mode='enriched';
  const local=await run('local','cba:convergence:local');
  const facts=result=>result.rows.filter(row=>row.canonicalRelationshipId && row.lineage.status==='current').map(row=>[row.canonicalRelationshipId,row.from,row.action,row.to,row.architecture.subsystem,row.architecture.csci,row.architecture.csc,row.architecture.csu,row.hazardAnalysisEligibility]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(facts(local),facts(git));
  assert.equal(local.metadata.sourceAnalysis.comparisonFingerprint,git.metadata.sourceAnalysis.comparisonFingerprint);
  const second=await run('github','cba:convergence:github');
  const ids=r=>r.rows.filter(row=>row.lineage.status==='current').map(row=>[row.canonicalRelationshipId,row.traceId]).sort();
  assert.deepEqual(ids(second),ids(git));
  const records=await page.evaluate(async()=>{
   const req=window.fixtureRequire,storage=req('./src/features/code-architecture-assurance/codeArchitectureStorage.js');
   const rows=await storage.readCbaRowsFromIndexedDB('cba:convergence:local');
   const records=await storage.readArchitectureRunRecords('cba:convergence:local',rows);
   const sheets=req('./src/features/code-architecture-assurance/codeArchitectureCoverageWorkbook.js').architectureCoverageSheets(records);
   return {ledger:records[0].relationshipLedger,sheets};
  });
  assert.equal(records.sheets.files.length,files.length);
  assert(records.sheets.files.every(file=>file['Text SHA-256'] && file.Disposition==='analyzed'));
  assert(records.sheets.files.every(file=>file['Parse Error Lines']===''));
  const unicycle=git.rows.filter(row=>row.fromFile.endsWith('unicycle_accel_curvature.py'));
  for (const name of ['__init__','action_to_traj','traj_to_action','estimate_t0_states']) assert(unicycle.some(row=>row.relationshipEvidence.kind==='structural_member' && row.to.endsWith(`.${name}`)),`Missing ${name}`);
  assert(git.rows.some(row=>row.fromFile.endsWith('coordinates.py')&&row.to==='torch.tensor'));
  assert(git.rows.some(row=>row.fromFile.endsWith('rotation.py')&&row.to==='numpy.cos'));
  assert(!git.rows.some(row=>row.to==='numpy.pi'&&row.canonicalRelationshipId));
  const counts=Object.fromEntries(paths.map(path=>[path,git.rows.filter(row=>row.fromFile===path&&row.canonicalRelationshipId).length]));
  const output={passed:true,crossAdapterCanonicalParity:true,modelOmissionAndEnrichment:true,sameScopeTraceRetention:true,portableCoverage:true,requests,counts,coverage:records.sheets};
  fs.writeFileSync('/tmp/xhandle-convergence-v2-results.json',JSON.stringify(output,null,2));console.log(JSON.stringify({...output,coverage:undefined},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
