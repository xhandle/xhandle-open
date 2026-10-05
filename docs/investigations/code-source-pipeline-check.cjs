// Runs the real shared pipeline in a fresh browser context with synthetic source and intercepted AI/GitHub.
const assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const code='def validate_command():\n    pass\ndef control_motion():\n    validate_command()\n';
const sha=crypto.createHash('sha1').update(`blob ${Buffer.byteLength(code)}\0`).update(code).digest('hex');
const commit='a'.repeat(40);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
  const page=await browser.newPage();let mode='omitted',calls=0;
  page.on('console',message=>{if(['error','warning'].includes(message.type()))console.error(message.text());});
  await page.route('**/api/**',async route=>{
    if(!route.request().url().endsWith('/api/chat'))return route.fulfill({status:401,body:'fixture'});
    calls++;
    const table='| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
    const row='\n| control_motion | control.py | Source caller | Check motion | Validate request | validate_command | control.py | Source validator |';
    const h=route.request().headers();
    return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'http://localhost:3000','Access-Control-Allow-Credentials':'true','Access-Control-Expose-Headers':'X-AI-Provider-Used,X-AI-Model-Used,X-AI-Effort-Used','X-AI-Provider-Used':h['x-ai-provider']||'openai','X-AI-Model-Used':h['x-ai-model']||'gpt-4o-mini','X-AI-Effort-Used':h['x-ai-effort']||'automatic'},contentType:'application/json',body:JSON.stringify(mode==='truncated'?{choices:[{finish_reason:'length',message:{content:table+row}}]}:{answer:table+(mode==='omitted'?'':mode==='malformed'?'\n| incomplete |':row+row)})});
  });
  await page.route('https://api.github.com/**',route=>{
    const url=route.request().url();let data;
    if(url.includes('/commits/'))data={sha:commit};else if(url.includes('/git/trees/'))data={tree:[{path:'control.py',type:'blob',mode:'100644',size:Buffer.byteLength(code),sha}]};else if(url.includes('/git/blobs/')||url.includes('/contents/'))data={encoding:'base64',content:Buffer.from(code).toString('base64')};else data={default_branch:'main'};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://localhost:3000');
  await page.evaluate(()=>{const key=Object.keys(window).find(key=>key.startsWith('webpackChunk'));window[key].push([[Date.now()],{},r=>window.fixtureRequire=r]);});
  const run=async(adapter,key)=>page.evaluate(async({adapter,key,code})=>{
    const req=window.fixtureRequire;
    const generator=req('./src/components/generateFunctionalDecompositionFromGitHub.js').generateFunctionalDecompositionFromGitHub;
    const file=new File([code],'control.py');Object.defineProperty(file,'webkitRelativePath',{value:'fixture/control.py'});
    const source=adapter==='github'?{owner:'fixture',repo:'fixture',branch:'main'}:req('./src/features/code-architecture-context/localCodeSource.js').registerLocalFolder({files:[file],sourceId:key,folderName:'fixture'});
    let published,loading;
    const result=await generator(rows=>published=rows,value=>loading=value,null,{repoConfig:source,storageKey:key,selectedExtensions:['.py'],resumeFromCheckpoint:false,analysisContext:{text:'',files:[]}});
    if(loading!==false || !published)throw new Error('Publication/loading incomplete');
    return result;
  },{adapter,key,code});
  const a=await run('github','cba:g1');mode='duplicate';const b=await run('github','cba:g2');
  mode='omitted';const c=await run('local','cba:l1');mode='duplicate';const d=await run('local','cba:l2');
  const facts=r=>r.rows.filter(row=>row.canonicalRelationshipId).map(row=>[row.canonicalRelationshipId,row.hazardAnalysisEligibility]);
  for(const result of [a,b,c,d]){assert.equal(result.rows.length,1);assert.equal(result.metadata.sourceAnalysis.supportedRelationships,1);assert.deepEqual(facts(result),facts(a));assert.equal(result.metadata.sourceAnalysis.comparisonFingerprint,a.metadata.sourceAnalysis.comparisonFingerprint);}
  const repeat=await run('github','cba:g1');assert.equal(repeat.rows[0].traceId,a.rows[0].traceId);
  for(const failureMode of ['truncated','malformed']) {
    mode=failureMode;
    await assert.rejects(run('github','cba:g1'), /incomplete/);
    const retained=await page.evaluate(async()=>window.fixtureRequire('./src/features/code-architecture-assurance/codeArchitectureStorage.js').readCbaRowsFromIndexedDB('cba:g1'));
    assert.equal(retained[0].traceId,a.rows[0].traceId);
  }
  const portability=await page.evaluate(async()=>{
    const storage=window.fixtureRequire('./src/features/code-architecture-assurance/codeArchitectureStorage.js');
    const rows=await storage.readCbaRowsFromIndexedDB('cba:g1');
    const records=await storage.readArchitectureRunRecords('cba:g1',rows);
    await storage.writeImportedArchitectureRunRecords('cba:imported',records,rows);
    const restored=await storage.readCbaRowsFromIndexedDB('cba:imported');
    const original=IDBObjectStore.prototype.put;let rejected=false;
    IDBObjectStore.prototype.put=function(record){if(record.key==='cba:imported')throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.call(this,record);};
    try{await storage.writeImportedArchitectureRunRecords('cba:imported',records.map(record=>({...record,invalidPartial:true})),[{traceId:'wrong'}]);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=original;}
    const after=await storage.readCbaRowsFromIndexedDB('cba:imported');
    const manifests=await storage.readArchitectureRunRecords('cba:imported',after);
    return {rejected,restored:restored[0].traceId===rows[0].traceId,preserved:after[0].traceId===rows[0].traceId,records:manifests.length,atomic:manifests.every(record=>!record.invalidPartial)};
  });
  assert.deepEqual(portability,{rejected:true,restored:true,preserved:true,records:1,atomic:true});
  console.log(JSON.stringify({freshGitHubRepeat:true,freshLocalRepeat:true,crossAdapter:true,controlledOmissionAndDuplication:true,stableSavedTrace:true,malformedAndTruncatedPreserveResults:true,portability,calls,classification:a.rows[0].hazardAnalysisEligibility}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
