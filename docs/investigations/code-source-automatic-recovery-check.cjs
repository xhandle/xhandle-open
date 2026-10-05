// Real shared pipeline; all AI/GitHub responses intercepted in an isolated browser.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const makeFile=(path,content)=>({path,content,sha:crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')});
const small=()=>['a','b'].map(n=>makeFile(`${n}.py`,`def ${n}target():\n    pass\ndef ${n}caller():\n    ${n}target()\n`));
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});try{
 const page=await browser.newPage();let files=small(),mode='transient',calls=[];
 const table='| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
 await page.route('**/api/**',route=>{
  if(!route.request().url().endsWith('/api/chat'))return route.fulfill({status:401,body:'fixture'});
  const body=route.request().postDataJSON(),prompt=body.prompt;
  const file=prompt.match(/\/\/ File: ([^\n]+)/)?.[1]||'other';
  const part=Number(prompt.match(/\/\/ Part (\d+)/)?.[1]);
  const primary=prompt.match(/Primary section \[\d+, \d+\):\n([\s\S]*?)\nContext after:/)?.[1] ?? prompt.split(/\/\/ Part \d+ of \d+\n\n/).at(-1);
  calls.push({file,part,tokens:body.max_tokens});
  const count=calls.filter(call=>call.file===file&&call.part===part).length;
  const failed=(mode==='transient'&&file==='b.py'&&count<=3)||(mode==='chunks'&&part===2&&count<=3);
  const permanent=mode==='permanent'&&file==='b.py';
  if(failed||permanent)return route.fulfill({status:permanent?401:503,headers:{'Retry-After':'0'},body:'fixture provider unavailable'});
  const truncated=mode==='nested'&&primary.length>512;
  return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'http://localhost:3000','Access-Control-Allow-Credentials':'true','Access-Control-Expose-Headers':'X-AI-Provider-Used,X-AI-Model-Used,X-AI-Effort-Used','X-AI-Provider-Used':'openai','X-AI-Model-Used':'gpt-4o-mini','X-AI-Effort-Used':'automatic'},contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:truncated?'length':'stop',message:{content:table}}]})});
 });
 await page.route('https://api.github.com/**',route=>{
  const url=route.request().url();let data;
  if(url.includes('/commits/'))data={sha:'a'.repeat(40)};
  else if(url.includes('/git/trees/'))data={tree:files.map(f=>({path:f.path,sha:f.sha,size:Buffer.byteLength(f.content),type:'blob',mode:'100644'}))};
  else if(url.includes('/git/blobs/')||url.includes('/contents/')){const f=files.find(f=>url.includes(f.sha)||url.includes(`/contents/${f.path}`));if(!f)return route.fulfill({status:404,body:'fixture'});data={encoding:'base64',content:Buffer.from(f.content).toString('base64')};}
  else data={default_branch:'main'};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://localhost:3000');await page.evaluate(()=>{
  localStorage.setItem('xhandle.aiProvider.active','openai');localStorage.setItem('xhandle.aiProviderModel.openai','gpt-4o-mini');
  const k=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[k].push([[Date.now()],{},r=>window.fixtureRequire=r]);
 });
 const run=(adapter,scope,options={})=>page.evaluate(async({adapter,scope,files,options})=>{
  const r=window.fixtureRequire,generator=r('./src/components/generateFunctionalDecompositionFromGitHub.js').generateFunctionalDecompositionFromGitHub;
  const source=adapter==='github'?{owner:'fixture',repo:'fixture',branch:'main'}:r('./src/features/code-architecture-context/localCodeSource.js').registerLocalFolder({files:files.map(({path,content})=>{const file=new File([content],path);Object.defineProperty(file,'webkitRelativePath',{value:`fixture/${path}`});return file;}),sourceId:scope,folderName:'fixture'});
  let published=false,progress=[];
  try{const result=await generator(()=>published=true,()=>{},null,{repoConfig:source,storageKey:scope,selectedExtensions:['.py'],analysisContext:{text:'',files:[]},onProgress:p=>progress.push(p),...options});return {published,count:result.rows.length,coverage:result.metadata.coverage,progress};}
  catch(error){return {published,error:error.code,message:error.message,progress};}
 },{adapter,scope,files,options});
 for(const adapter of ['github','local']){
  files=small();mode='transient';calls=[];const scope=`cba:auto-${adapter}`;
  const result=await run(adapter,scope);
  assert.equal(result.published,true);assert.equal(result.count,2);
  assert.equal(calls.filter(c=>c.file==='a.py').length,1);assert.equal(calls.filter(c=>c.file==='b.py').length,4);
  assert.ok(result.progress.some(p=>p.phase==='recovery'));
  assert.deepEqual([result.coverage.selected,result.coverage.analyzed,result.coverage.failed,result.coverage.skippedByLimits],[2,2,0,0]);
  mode='permanent';calls=[];const failure=await run(adapter,scope,{resumeFromCheckpoint:false});
  assert.equal(failure.published,false);assert.equal(failure.error,'SOURCE_ANALYSIS_INCOMPLETE');assert.equal(calls.filter(c=>c.file==='b.py').length,1);
  assert.equal(await page.evaluate(scope=>window.fixtureRequire('./src/features/code-architecture-assurance/codeArchitectureStorage.js').readCbaRowsFromIndexedDB(scope).then(rows=>rows.length),scope),2);
  files=[makeFile('nested.py',small()[0].content+'# context\n'.repeat(200))];mode='nested';calls=[];
  const nested=await run(adapter,`${scope}-nested`);assert.equal(nested.published,true);assert.equal(nested.count,1);assert.ok(calls.length>3);assert.ok(calls.some(c=>c.tokens===8192));
  files=[makeFile('large.py',('# '+'context '.repeat(10)+'\n').repeat(1300)+small()[0].content)];mode='chunks';calls=[];
  const chunks=await run(adapter,`${scope}-large`);assert.equal(chunks.published,true);assert.equal(chunks.count,1);
  assert.ok(Math.max(...calls.map(c=>c.part))>8);assert.equal(calls.filter(c=>c.part===1).length,1);assert.equal(calls.filter(c=>c.part===2).length,4);
  assert.ok(chunks.progress.some(p=>p.phase==='recovery'));
  const indexedLength=await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('xhandle',4);req.onsuccess=()=>{const db=req.result,tx=db.transaction('code_index','readonly'),read=tx.objectStore('code_index').getAll();read.onsuccess=()=>resolve(Math.max(...read.result.filter(row=>row.value?.path==='large.py').map(row=>row.value.content.length)));read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();};}));
  assert.equal(indexedLength,files[0].content.length);

  calls=[];const limited=await run(adapter,`${scope}-limited`,{maxChunksToAnalyze:1});assert.equal(limited.published,false);assert.match(limited.message,/No partial analysis was started/);assert.equal(calls.length,0);
 }
 console.log(JSON.stringify({bothAdapters:true,automaticRecoveryWithoutUserRetry:true,nestedTruncationRecovered:true,largeFileAllChunksAnalyzed:true,completedChunksReused:true,terminalFailurePreservesResults:true,configuredLimitsFailBeforeAI:true}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
