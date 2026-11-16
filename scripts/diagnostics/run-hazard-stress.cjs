const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {stageFixtureWorkers,fingerprint,cleanEnvironment,command,electronFixtureMain,killTree}=require('./electron-regression-support.cjs');
const {respond}=require('./hazard-stress-provider.cjs');
if(process.argv.includes('--help')){
 console.log('Usage: node scripts/diagnostics/run-hazard-stress.cjs --desktop ../xhandle-desktop --playwright /path/to/playwright-core [--electron /path/to/Electron] [--out /tmp/fresh-directory] [--stage /verified/desktop] [--sizes 32,256,1500] [--areas projects,code] [--methods STPA,HARA] [--faults true] [--resume true] [--case-timeout-ms 600000] [--max-gui-gap-ms 2000] [--continue-on-failure true] [--profile true]');process.exit(0);
}
const args=Object.fromEntries(process.argv.slice(2).reduce((all,value,index,values)=>index%2?all:[...all,[value.slice(2),values[index+1]]],[]));
const root=path.resolve(__dirname,'../..'),node=process.execPath;
const output=path.resolve(args.out||fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-hazard-stress-')));
if(args.out&&fs.existsSync(output))throw Error('Choose a fresh --out directory; previous evidence is never overwritten.');
fs.mkdirSync(output,{recursive:true});
let interrupted=false,currentApp;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;if(currentApp){const child=currentApp.process();killTree(child,'SIGTERM');setTimeout(()=>killTree(child,'SIGKILL'),2000).unref();}});
const sizes=args.sizes==='none'?[]:(args.sizes||'32,256,1500').split(',').map(Number);assert(sizes.every(n=>Number.isInteger(n)&&n>0&&n<=5000));
const areas=(args.areas||'projects,code').split(','),methods=(args.methods||'STPA,HARA').split(',');
assert(areas.every(area=>['projects','code'].includes(area)));assert(methods.every(method=>['STPA','HARA'].includes(method)));
const desktop=path.resolve(args.desktop||'/Users/Nick/xhandle-desktop');
const electron=path.resolve(args.electron||require(path.join(desktop,'node_modules/electron')));
const playwrightPath=args.playwright||require.resolve('playwright-core');
const playwright=require(playwrightPath);
const report={status:'running',startedAt:new Date().toISOString(),source:fingerprint(root),platform:process.platform,arch:process.arch,cases:[],errors:[],coverage:'Production Projects and Code hazard dispatchers, full repair stages, actual fetch transport with controlled AI, real Electron/IndexedDB/recovery, saved completion, exact counts/identities, ASIL, bounded retries, responsiveness. Synthetic evidence, not live model quality or cross-platform certification.'};
const save=()=>{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'report.md'),[
 '# Hazard analysis stress report','',`Status: **${report.status}**`,'',report.coverage,'','| Area | Method | Interfaces | Assessments | Faults | Result | Time | Requests | Max GUI gap | Fallback rows |','| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |',
 ...report.cases.map(c=>`| ${c.area} | ${c.method} | ${c.interfaces} | ${c.rows??c.expected} | ${c.faults} | ${c.status} | ${((c.elapsedMs||0)/1000).toFixed(1)} s | ${c.requests?.total??0} | ${Math.round(c.maxEventLoopGapMs||0)} ms | ${c.assumptionFallbackRows??'—'} |`),'',...report.cases.filter(c=>c.failure).flatMap(c=>[`## ${c.id}`,'',c.failure,'']),...report.errors,''].join('\n'));};
async function settleWithin(operation, ms) {
 let timer;
 try { return await Promise.race([Promise.resolve(operation).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]); }
 finally { clearTimeout(timer); }
}
async function build(){
 let stage=args.stage;
 if(!stage){
  const target=path.join(output,'production');
  const result=await command(node,[path.join(__dirname,'run-electron-regression.cjs'),'--desktop',desktop,'--playwright',playwrightPath,'--out',target,'--only','build'],{cwd:root,log:path.join(output,'production.log'),timeoutMs:600000});
  assert.equal(result.exitCode,0,result.tail.slice(-3000));stage=path.join(target,'desktop');
 }
 stage=fs.realpathSync(stage);const metadata=JSON.parse(fs.readFileSync(path.join(stage,'build-metadata.json')));
 assert.equal(metadata.regressionSource.sha256,report.source.sha256,'The staged renderer must match the stress-tested source');report.stage=stage;
 const result=await command(node,[path.join(__dirname,'build-hazard-stress-fixture.cjs'),path.join(output,'fixtures')],{cwd:root,env:cleanEnvironment({NODE_ENV:'production'}),log:path.join(output,'fixtures.log'),timeoutMs:120000});
 assert.equal(result.exitCode,0,result.tail);stageFixtureWorkers(path.join(output,'fixtures'),stage);return stage;
}
async function runCase(stage,area,method,interfaces,faults='none'){
 assert(!interrupted,'Stress run interrupted');
 const id=`${area}-${method}-${interfaces}-${faults}`,directory=path.join(output,id);fs.mkdirSync(directory,{recursive:true});
 const result={id,area,method,interfaces,expected:interfaces*21,faults,status:'running',requests:{total:0,byWorkflow:{},injected:[],peakConcurrent:0,maxPromptChars:0,maxOutputTokens:0}};report.cases.push(result);save();console.log('START '+id+' '+result.expected+' rows');
 for(const name of ['profile','session'])fs.mkdirSync(path.join(directory,name));
 fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'xhandle-hazard-stress',version:'1.0.0',main:'main.cjs'}));fs.writeFileSync(path.join(directory,'main.cjs'),electronFixtureMain(stage,directory));
 let app,page,server,active=0,errors=[],cancelled=false,hardTimer,hardKillTimer,committedAssessmentIds,repeatedCommittedIds=new Set(),stopProfiler;
 try{
  app=await playwright._electron.launch({executablePath:electron,args:[directory],env:cleanEnvironment()});
  currentApp=app;
  hardTimer=setTimeout(()=>{result.hardTimeout=true;killTree(app.process(),'SIGTERM');hardKillTimer=setTimeout(()=>killTree(app.process(),'SIGKILL'),2000);},Number(args['case-timeout-ms']||600000)+30000);
  const nativeLog=fs.createWriteStream(path.join(directory,'electron.log'));app.process().stderr?.on('data',chunk=>nativeLog.write(chunk));app.process().once('exit',()=>nativeLog.end());
  page=await app.firstWindow();await page.waitForURL('xhandle://app/**',{waitUntil:'domcontentloaded'});page.setDefaultTimeout(5000);
  if(args.profile==='true')stopProfiler=await require('./hazard-stress-profiler.cjs').startHazardProfiler(page,directory);
  page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>errors.push('Renderer crashed'));
  page.on('console',message=>{if(message.type()==='error')fs.appendFileSync(path.join(directory,'console.log'),message.text()+'\n');});
  page.on('requestfailed',request=>fs.appendFileSync(path.join(directory,'network.log'),request.url()+' '+JSON.stringify(request.failure())+'\n'));
  const seen=new Map();
  server=http.createServer(async(req,res)=>{
   res.setHeader('access-control-allow-origin','xhandle://app');res.setHeader('access-control-allow-credentials','true');res.setHeader('access-control-allow-methods','POST, OPTIONS');res.setHeader('access-control-allow-headers',req.headers['access-control-request-headers']||'*');res.setHeader('content-type','application/json');
   if(req.method==='OPTIONS'){res.end();return;}
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw),prompt=body.messages?.find(message=>message.role==='user')?.content||'';
   const stats=result.requests;stats.total++;assert(stats.total<result.expected*12+100,'Request count is bounded');
   const workflow=body.xhandleWorkflow||'chat';stats.byWorkflow[workflow]=(stats.byWorkflow[workflow]||0)+1;stats.maxPromptChars=Math.max(stats.maxPromptChars,prompt.length);stats.maxOutputTokens=Math.max(stats.maxOutputTokens,body.max_tokens||0);
   active++;stats.peakConcurrent=Math.max(stats.peakConcurrent,active);
   try{
    const key=crypto.createHash('sha256').update(workflow+':'+prompt).digest('hex'),attempt=seen.get(key)||0;seen.set(key,attempt+1);
    let content=respond(prompt),finish='stop';
    if(faults==='cancel-resume'&&workflow==='hazard-row-generation'){
     const ids=(Array.isArray(content)?content:content.assessments||[]).map(row=>row.id).filter(id=>id!=='transport-probe');
     if(result.interruption&&committedAssessmentIds)for(const id of ids)if(committedAssessmentIds.has(id))repeatedCommittedIds.add(id);
    }
    if(faults==='cancel-resume'&&!cancelled&&workflow==='hazard-row-generation'&&stats.byWorkflow[workflow]>=6){
     const saved=await page.evaluate(()=>window.hazardStressCommittedAssessmentIds());
     if(saved.length){cancelled=true;await page.evaluate(()=>window.cancelHazardStress());}
    }
    if(faults==='mixed'&&attempt===0&&stats.injected.length<4&&stats.total>stats.injected.length*8+2){
     const kind=['truncated','malformed','missing-row','rate-limit'][stats.injected.length];stats.injected.push({kind,workflow,request:stats.total});
     if(kind==='truncated')finish='length';
     if(kind==='malformed')content='[{"id":';
     if(kind==='missing-row'){if(Array.isArray(content))content=content.slice(1);else if(content.assessments)content.assessments=content.assessments.slice(1);}
     if(kind==='rate-limit'){res.writeHead(429,{'retry-after':'0'});res.end('{"error":"Temporary synthetic rate limit"}');return;}
    }
    res.end(JSON.stringify({choices:[{finish_reason:finish,message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}));
   }catch(error){errors.push(error.message);res.writeHead(500);res.end(JSON.stringify({error:error.message}));}finally{active--;}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const installTransport=()=>page.evaluate(port=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>typeof input==='string'&&new URL(input,location.href).pathname==='/api/chat'?original('http://127.0.0.1:'+port+'/api/chat',init):original(input,init);},server.address().port);
  await installTransport();
  await page.getByRole('button',{name:'Design Management',exact:true}).waitFor({timeout:30000});await page.addScriptTag({path:path.join(output,'fixtures/hazard-stress.seed.js')});
  const transport=await page.evaluate(async()=>{try{const response=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Rows: [{"id":"transport-probe"}]'}]})});return {ok:response.ok,status:response.status};}catch(error){return {error:error.stack};}});
  assert(transport.ok,JSON.stringify(transport));
  const engineTransport=await page.evaluate(async()=>{try{return {response:await window.hazardTransportProbe()};}catch(error){return {error:error.stack};}});assert(!engineTransport.error,JSON.stringify(engineTransport));
  await page.evaluate(config=>{window.runHazardStress(config);},{area,method,interfaces,id});
  const deadline=Date.now()+Number(args['case-timeout-ms']||600000);let lastLog=0;
  for(;;){
   const state=await page.evaluate(()=>window.hazardStress);
   if(state.state!=='running'){
    if(faults==='cancel-resume'&&!result.interruption){
     assert.equal(state.state,'cancelled','The requested cancellation must stop analysis');assert(state.checkpointCount>0,'Completed work must survive interruption');
     result.interruption={...state,requests:result.requests.total};
     committedAssessmentIds=new Set(state.committedAssessmentIds);assert(committedAssessmentIds.size>0,'Cancellation must retain committed assessments, not only screening decisions');
     await page.reload();await page.getByRole('button',{name:'Design Management',exact:true}).waitFor({timeout:30000});await installTransport();await page.addScriptTag({path:path.join(output,'fixtures/hazard-stress.seed.js')});
     await page.evaluate(config=>{window.runHazardStress(config);},{area,method,interfaces,id,previousRunId:state.recovery?.runId});continue;
    }
    Object.assign(result,state);break;
   }
   if(Date.now()-lastLog>10000){console.log('RUNNING '+id+' '+JSON.stringify({progress:state.progress,phase:state.phase,maxGap:state.maxEventLoopGapMs,requests:result.requests.total,seconds:Math.round((Date.now()-(deadline-Number(args['case-timeout-ms']||600000)))/1000)}));lastLog=Date.now();save();}
   assert(Date.now()<deadline,'Stress scenario exceeded its completion deadline');
   const start=Date.now();
   try{await page.getByRole('button',{name:'Hazard stress responsiveness probe',exact:true}).click();}
   catch(error){result.probeFailures=(result.probeFailures||0)+1;result.lastProbeFailure=error.message.split('\n')[0];}
   result.maxProbeLatencyMs=Math.max(result.maxProbeLatencyMs||0,Date.now()-start);
   await page.waitForTimeout(500);
  }
  assert.equal(result.state,'complete',JSON.stringify(result.error));assert.equal(result.rows,result.expected);assert.equal(result.assumptionFallbackRows,0,'Recovery silently substituted bounding assumptions');assert.equal(errors.length,0,errors.join('\n'));result.completionPassed=true;
  assert(result.maxEventLoopGapMs<Number(args['max-gui-gap-ms']||2000),'Renderer was unresponsive during analysis');
  assert(!result.probeFailures,'GUI input timed out during analysis');
  assert(result.requests.total>2,'The analysis must exercise the provider transport');
  if(faults==='cancel-resume'){result.repeatedCommittedAssessmentIds=[...repeatedCommittedIds];assert.equal(repeatedCommittedIds.size,0,'Resume repeated committed assessment generation');result.reusedCommittedAssessments=committedAssessmentIds.size;}
  result.status='passed';await page.screenshot({path:path.join(directory,'completed.png')});
 }catch(error){result.status='failed';result.failure=error.stack;if(page)await page.screenshot({path:path.join(directory,'failure.png'),timeout:3000}).catch(()=>{});}
 finally{clearTimeout(hardTimer);clearTimeout(hardKillTimer);await settleWithin(stopProfiler?.().catch(()=>{}),3000);if(app){const closed=await settleWithin((async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app.close().catch(()=>{});})(),4000);if(!closed){killTree(app.process(),'SIGKILL');await settleWithin(app.close().catch(()=>{}),2000);}}currentApp=null;server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));result.rendererErrors=errors;save();console.log(result.status.toUpperCase()+' '+id+' '+JSON.stringify({seconds:(result.elapsedMs||0)/1000,requests:result.requests.total,maxGap:result.maxEventLoopGapMs,failure:result.failure?.split('\n')[0]}));}
 return result;
}
(async()=>{
 console.log('REPORT '+path.join(output,'report.json'));save();const stage=await build();
 for(const interfaces of sizes)for(const area of areas)for(const method of methods){const result=await runCase(stage,area,method,interfaces);if(result.status==='failed'&&args['continue-on-failure']!=='true')throw Error('Stress scenario failed: '+result.id);}
 if(args.faults==='true')for(const area of areas)for(const method of methods)await runCase(stage,area,method,32,'mixed');
 if(args.resume==='true')for(const area of areas)for(const method of methods)await runCase(stage,area,method,32,'cancel-resume');
 report.sourceAfter=fingerprint(root);report.sourceChanged=report.sourceAfter.sha256!==report.source.sha256;assert(!report.sourceChanged,'Source changed during the test run');
 report.status=report.cases.every(result=>result.status==='passed')?'passed':'failed';
})().catch(error=>{report.errors.push(error.stack);report.status='failed';}).finally(()=>{report.finishedAt=new Date().toISOString();save();console.log('RESULT '+path.join(output,'report.json')+' '+report.status);if(report.status!=='passed')process.exitCode=1;});
