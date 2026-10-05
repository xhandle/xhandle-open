// Exercises real shared pipeline failure, checkpoint resume and adaptive retries with stubbed APIs.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const files=['a','b'].map(name=>{const path=`${name}.py`,content=`def ${name}target():\n    pass\ndef ${name}caller():\n    ${name}target()\n`;return {path,content,sha:crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')};});
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});try{
 const page=await browser.newPage();let mode='fail',calls=[];
 const table='| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
 await page.route('**/api/**',route=>{
  if(!route.request().url().endsWith('/api/chat'))return route.fulfill({status:401,body:'fixture'});
  const prompt=route.request().postDataJSON().prompt,isB=prompt.includes('def bcaller');calls.push(isB?'b':'a');
  const truncated=mode==='truncate' && calls.length===1;
  return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'http://localhost:3000','Access-Control-Allow-Credentials':'true','Access-Control-Expose-Headers':'X-AI-Provider-Used,X-AI-Model-Used,X-AI-Effort-Used','X-AI-Provider-Used':'openai','X-AI-Model-Used':'gpt-4o-mini','X-AI-Effort-Used':'automatic'},contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:truncated?'length':'stop',message:{content:mode==='fail'&&isB?'| incomplete |':table}}]})});
 });
 await page.route('https://api.github.com/**',route=>{
  const url=route.request().url();let data;
  if(url.includes('/commits/'))data={sha:'a'.repeat(40)};
  else if(url.includes('/git/trees/'))data={tree:files.map(file=>({path:file.path,sha:file.sha,size:Buffer.byteLength(file.content),type:'blob',mode:'100644'}))};
  else if(url.includes('/git/blobs/')||url.includes('/contents/')){const f=files.find(file=>url.includes(file.sha)||url.endsWith(file.path));if(!f)return route.fulfill({status:404,body:'fixture'});data={encoding:'base64',content:Buffer.from(f.content).toString('base64')};}
  else data={default_branch:'main'};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://localhost:3000');await page.evaluate(()=>{
  localStorage.setItem('xhandle.aiProvider.active','openai');localStorage.setItem('xhandle.aiProviderModel.openai','gpt-4o-mini');
  const k=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[k].push([[Date.now()],{},r=>window.fixtureRequire=r]);
 });
 const run=(adapter,scope)=>page.evaluate(async({adapter,scope,files})=>{
  const r=window.fixtureRequire,generator=r('./src/components/generateFunctionalDecompositionFromGitHub.js').generateFunctionalDecompositionFromGitHub;
  const source=adapter==='github'?{owner:'fixture',repo:'fixture',branch:'main'}:r('./src/features/code-architecture-context/localCodeSource.js').registerLocalFolder({files:files.map(({path,content})=>{const file=new File([content],path);Object.defineProperty(file,'webkitRelativePath',{value:`fixture/${path}`});return file;}),sourceId:scope,folderName:'fixture'});
  let published=false;try{const result=await generator(()=>published=true,()=>{},null,{repoConfig:source,storageKey:scope,selectedExtensions:['.py'],analysisContext:{text:'',files:[]}});return {published,count:result.rows.length};}catch(error){return {published,error:error.code};}
 },{adapter,scope,files});
 for(const adapter of ['github','local']){
  mode='fail';calls=[];const scope=`cba:retry-${adapter}`;
  assert.deepEqual(await run(adapter,scope),{published:false,error:'SOURCE_ANALYSIS_INCOMPLETE'});assert.equal(calls.length,10);
  const saved=await page.evaluate(async scope=>{const s=window.fixtureRequire('./src/features/code-architecture-assurance/codeArchitectureStorage.js');return {checkpoint:await s.readLatestArchitectureCheckpoint(scope),rows:await s.readCbaRowsFromIndexedDB(scope)};},scope);
  assert.equal(saved.checkpoint.completed,1);assert.equal(saved.checkpoint.rowCount,1);assert.equal(saved.rows.length,0);
  mode='success';calls=[];assert.deepEqual(await run(adapter,scope),{published:true,count:2});assert.deepEqual(calls,['b']);
  assert.equal(await page.evaluate(scope=>window.fixtureRequire('./src/features/code-architecture-assurance/codeArchitectureStorage.js').readLatestArchitectureCheckpoint(scope),scope),null);
  mode='truncate';calls=[];assert.deepEqual(await run(adapter,`${scope}-adaptive`),{published:true,count:2});assert.equal(calls.length,3);
 }
 console.log(JSON.stringify({bothAdapters:true,firstRunFailureRetainsDraft:true,resumeOnlyFailedFiles:true,successfulRetryPublishes:true,truncatedResponsesRecover:true}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
