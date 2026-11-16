// Exercise the installed production request shim and actual App project scope.
// AI replies are controlled; no real provider, credentials or user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.XHANDLE_PLAYWRIGHT_MODULE||'playwright-core');
const {withOrganizationPromptContext,decodeOrganizationContext}=require('../../server/organizationPromptContext');
const {ORGANIZATION_CONTEXT_HEADER,ORGANIZATION_CONTEXT_MAX_BYTES,ORGANIZATION_HEADER_MAX_CHARS}=require('../../src/lib/organizationPromptPolicy');
const arg=name=>process.argv[process.argv.indexOf(name)+1],stage=fs.realpathSync(arg('--stage'));
const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xhandle-platform-profile-'));
const result={root,checks:[],requests:[],errors:[],performance:{}};let app,page;
const check=message=>{result.checks.push(message);console.log('PASS',message);};
const markdown='---\norganization: Platform profile audit\nprofile_version: 1.0\nstatus: approved\n---\n# Organization and Products\nPLATFORM-PROFILE-MARKER: use customer terminology for inspection robots.\n# Engineering Rules\nUse observable acceptance criteria.\n# Safety Philosophy\nPreserve evidence-based harm chains.\n';
async function sidebar(name){
 if(await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).count())await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).click();
 await page.locator('#xhandle-primary-sidebar').hover();
 await page.locator('#xhandle-primary-sidebar').getByRole('button',{name,exact:true}).click();
}
async function probe({path='/api/chat',form='string',bodySize=0}={}){
 const before=result.requests.length;
 await page.evaluate(async({path,form,bodySize})=>{
  const body=JSON.stringify({messages:[{role:'system',content:'Return JSON only.'},{role:'user',content:bodySize?'x'.repeat(bodySize):'Summarize the current engineering work.'}],xhandleWorkflow:'platform-profile-audit'});
  const init={method:'POST',headers:{'Content-Type':'application/json'},body};
  const target=form==='Request'?new Request(new URL(path,location.href),init):form==='URL'?new URL(path,location.href):path;
  const response=await fetch(target,form==='Request'?undefined:init);if(!response.ok)throw Error('Probe request failed');await response.json();
 },{path,form,bodySize});
 assert.equal(result.requests.length,before+1);return result.requests.at(-1);
}
(async()=>{try{
 for(const name of ['profile','session','downloads'])fs.mkdirSync(path.join(root,name));
 fs.writeFileSync(root+'/package.json',JSON.stringify({name:'xhandle-platform-profile-audit',version:'1.0.0',main:'main.cjs'}));
 fs.writeFileSync(root+'/main.cjs',require('./electron-regression-support.cjs').electronFixtureMain(stage,root));
 app=await _electron.launch({executablePath:arg('--electron'),args:[root],env:Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))});
 page=await app.firstWindow();await page.waitForURL('xhandle://app/**',{waitUntil:'domcontentloaded'});page.setDefaultTimeout(25000);
 page.on('pageerror',error=>result.errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(['/api/chat','/api/chatgpt','/api/rt/session'].includes(url.pathname)){
   const body=request.postDataJSON(),header=request.headers()[ORGANIZATION_CONTEXT_HEADER]||'',context=decodeOrganizationContext(header);
   const messages=withOrganizationPromptContext(body.messages||[],header);
   result.requests.push({path:url.pathname,context,contextBytes:Buffer.byteLength(context),headerLength:header.length,profileCount:messages.filter(message=>message.role==='system'&&message.content===context).length,bodySize:request.postData()?.length||0});
   return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],value:'synthetic-session'})});
  }
  return route.fulfill({contentType:'application/json',body:'{"ok":true,"projects":[],"rows":[]}'});
 });
 await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
 await page.evaluate(async markdown=>{
  localStorage.clear();localStorage.setItem('xhandle.projects',JSON.stringify([{id:'profile-functional',name:'Platform Projects fixture'}]));localStorage.setItem('xhandle.activeProjectId','profile-functional');
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'profile-code',name:'Platform Code fixture',activeRepoId:'r',repos:[{id:'r',repoId:'r',repoName:'r'}]}]));
  localStorage.setItem('xhandle.projectData',JSON.stringify({'profile-functional':{responseRows:[{fromFunction:'Operator',controlAction:'Stop command',toFunction:'Controller'}],organizationProfile:{mode:'inherit',overrideMarkdown:'PROJECTS-OVERRIDE: use observed frequency records.'}},'profile-code':{organizationProfile:{mode:'inherit',overrideMarkdown:'CODE-OVERRIDE: preserve external-control evidence.'}}}));
  localStorage.setItem('xhandle.organizationProfile',JSON.stringify({enabled:true,id:'platform-fixture',markdown}));
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('xhandle',4);request.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const transaction=db.transaction('copilot_baseline','readwrite');transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);transaction.objectStore('copilot_baseline').put({key:'cba:profile-code:r',value:[{traceId:'profile-code-1',fromFunction:'Operator',controlAction:'Stop command',toFunction:'Controller',fromArchitecture:{subsystem:'Control'},toArchitecture:{subsystem:'Control'}}]});});db.close();
 },markdown);
 await page.reload();
 await sidebar('Platform Projects fixture');await page.getByText('Functional Diagramming',{exact:true}).click();
 let request=await probe();assert(request.context.includes('PLATFORM-PROFILE-MARKER'));assert(request.context.includes('PROJECTS-OVERRIDE'));assert(!request.context.includes('CODE-OVERRIDE'));check('Projects prompts use global guidance and the correct project override');
 await sidebar('Platform Code fixture');await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
 request=await probe();assert(request.context.includes('CODE-OVERRIDE'));assert(!request.context.includes('PROJECTS-OVERRIDE'));check('Code-Based Architecture prompts use their own project scope');
 for(const name of ['Design Management','Reports','System Test','Safety Case','Collaborator']){
  await sidebar(name);request=await probe();assert(request.context.includes('PLATFORM-PROFILE-MARKER'));assert(!request.context.includes('PROJECTS-OVERRIDE'));assert(!request.context.includes('CODE-OVERRIDE'));check(name+' prompts receive global constructive context without an unrelated project override');
 }
 for(const options of [{path:'/api/chatgpt'},{path:'/api/rt/session'},{form:'Request'},{form:'URL'}]){
  request=await probe(options);assert(request.context.includes('PLATFORM-PROFILE-MARKER'));assert.equal(request.profileCount,1);
 }check('Chat aliases, realtime session setup, Request and URL forms all carry profile context');
 request=await probe({bodySize:2000000});assert(request.bodySize>2000000);assert(request.headerLength<=ORGANIZATION_HEADER_MAX_CHARS);check('A two-million-character prompt remains intact with bounded profile overhead');
 await page.evaluate(()=>{const profile=JSON.parse(localStorage.getItem('xhandle.organizationProfile'));profile.enabled=false;localStorage.setItem('xhandle.organizationProfile',JSON.stringify(profile));});
 request=await probe();assert.equal(request.context,'');assert.equal(request.headerLength,0);check('Disabling a profile immediately removes context from subsequent requests');
 await page.evaluate(()=>{const profile=JSON.parse(localStorage.getItem('xhandle.organizationProfile'));profile.enabled=true;localStorage.setItem('xhandle.organizationProfile',JSON.stringify(profile));const data=JSON.parse(localStorage.getItem('xhandle.projectData'));data['profile-code'].organizationProfile.mode='disabled';localStorage.setItem('xhandle.projectData',JSON.stringify(data));});
 await page.reload();await sidebar('Platform Code fixture');request=await probe();assert.equal(request.context,'');check('Project opt-out suppresses organizational context even with the global profile enabled');
 await sidebar('Design Management');
 const performanceRun=async enabled=>page.evaluate(async({enabled,markdown})=>{
  localStorage.setItem('xhandle.organizationProfile',JSON.stringify({enabled,markdown:markdown+Array.from({length:40},(_,index)=>'\n# Custom policy '+index+'\n'+('Use grounded acceptance criteria and preserve the source evidence. '.repeat(16))).join('')}));
  const samples=[];
  for(let index=0;index<80;index++){
   const before=performance.now(),response=fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"messages":[{"role":"user","content":"Summarize the current work."}]}'});samples.push(performance.now()-before);await(await response).json();
  }
  const warm=samples.slice(1).sort((a,b)=>a-b);return {coldMs:samples[0],p50Ms:warm[Math.floor(warm.length*.5)],p95Ms:warm[Math.floor(warm.length*.95)],maxMs:Math.max(...warm)};
 },{enabled,markdown});
 result.performance.disabled=await performanceRun(false);result.performance.enabled=await performanceRun(true);result.performance.p95AddedMs=result.performance.enabled.p95Ms-result.performance.disabled.p95Ms;
 assert(result.performance.enabled.p95Ms<15,'Cached request preparation stays within the 15 ms UI budget');
 assert(result.requests.every(request=>request.contextBytes<=ORGANIZATION_CONTEXT_MAX_BYTES&&request.headerLength<=ORGANIZATION_HEADER_MAX_CHARS));
 check('Large-profile cached request preparation stays below the measured UI latency budget');
 assert.deepEqual(result.errors,[]);
 }catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;if(page){await page.screenshot({path:root+'/failure.png'}).catch(()=>{});fs.writeFileSync(root+'/body.txt',await page.locator('body').innerText().catch(()=>''));}}
 finally{fs.writeFileSync(root+'/result.json',JSON.stringify(result,null,2));console.log('RESULT',root+'/result.json');if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app?.close();}
})();
