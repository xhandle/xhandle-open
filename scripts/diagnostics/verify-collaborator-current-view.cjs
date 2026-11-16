// Real renderer + controlled provider responses in a disposable workspace.
// Build fixtures with build-collaborator-current-view-fixture.cjs and
// build-desktop-performance-fixture.cjs (PERF_RELATIONSHIP_COUNT=20).
// --stage <desktop staging> --fixtures <directory> [--browser --chrome <path>]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {_electron,chromium}=require(process.env.XHANDLE_PLAYWRIGHT_MODULE||'playwright-core');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--stage')||!process.argv.includes('--fixtures'))throw Error('Provide --stage and --fixtures.');
const stage=fs.realpathSync(arg('--stage')),fixtures=fs.realpathSync(arg('--fixtures'));
const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xhandle-current-view-live-')),mode=process.argv.includes('--browser')?'chrome':'electron';
const result={root,stage,mode,checks:[],errors:[],requests:[]},queue=[];let app,browser,page,server;
const text=value=>typeof value==='string'?value:(value||[]).map(part=>part.text||'').join('\n');
function currentEvidence(payload){for(const m of [...payload.messages].reverse()){
 for(const body of Array.isArray(m.content)?m.content.filter(part=>part.type==='text').map(part=>part.text):[text(m.content)]){
 if(body.startsWith('Current open workspace content'))return JSON.parse(body.slice(body.indexOf('\n')+1));
 if(body.startsWith('Application-provided current view and evidence'))return JSON.parse(body.slice(body.indexOf('\n')+1)).currentViewEvidence;
 }
}throw Error('No current view evidence supplied');}
const check=name=>{result.checks.push(name);console.log('PASS',name);};
(async()=>{try{
 if(mode==='electron'){
  for(const name of ['profile','session'])fs.mkdirSync(root+'/'+name);
  fs.writeFileSync(root+'/package.json',JSON.stringify({name:'xhandle-current-view-check',version:'0.2.16',main:'main.cjs'}));
  fs.writeFileSync(root+'/main.cjs',require('./electron-regression-support.cjs').electronFixtureMain(stage, root));
  app=await _electron.launch({executablePath:arg('--electron'),args:[root],env:Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))});
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),root+'/profile');page=await app.firstWindow();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1600,height:1000}));
 }else{
  server=http.createServer((request,response)=>{let file=path.resolve(stage+'/stage/renderer','.'+new URL(request.url,'http://127.0.0.1').pathname);if(!file.startsWith(stage+'/stage/renderer/'))file=stage+'/stage/renderer/index.html';if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=stage+'/stage/renderer/index.html';response.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');fs.createReadStream(file).pipe(response);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({executablePath:arg('--chrome'),headless:true});page=await browser.newPage({viewport:{width:1600,height:1000}});await page.addInitScript(()=>window.__BACKEND_URL=location.origin);
  await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:'{"ok":true,"projects":[],"rows":[]}'}));await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
 }
 page.setDefaultTimeout(25000);page.on('pageerror',error=>result.errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
 await page.addScriptTag({path:fixtures+'/cba/seed.js'});await page.evaluate(()=>window.seedCbaPerformance(1,10,8));
 await page.addScriptTag({path:fixtures+'/current-view.seed.js'});await page.evaluate(()=>window.seedCollaboratorCurrentView());
 await page.exposeFunction('__currentViewReply',async payload=>{
  if(payload.xhandleWorkflow==='collaborator.title')return 'Current view explanation';
  assert(['collaborator.context-turn','collaborator.context-repair','collaborator.design-management'].includes(payload.xhandleWorkflow),'Unexpected AI workflow '+payload.xhandleWorkflow);
  const evidence=currentEvidence(payload);result.requests.push({workflow:payload.xhandleWorkflow,section:evidence.section,chars:JSON.stringify(payload.messages).length});
  assert(JSON.stringify(evidence).length<30000,'Current view evidence exceeds its bounded budget');const next=queue.shift();assert(next,'Unexpected provider request');return next(evidence,payload);
 });
 await page.addInitScript(()=>{const native=window.fetch.bind(window);window.fetch=async(input,options={})=>{
  const url=typeof input==='string'?input:input.url;
  if(String(url).endsWith('/api/chat')){const reply=await window.__currentViewReply(JSON.parse(options.body));if(options.signal?.aborted)throw new DOMException('Stopped','AbortError');return new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}
  return native(input,options);
 };});
 await page.reload();
 const dock=()=>page.locator('.xhandle-collaborator-dock');
 const send=async(prompt,verify)=>{
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhc.threads')||'[]').reduce((n,t)=>n+(t.messages||[]).filter(m=>m.role==='assistant').length,0));
  queue.push(verify);await dock().locator('textarea[placeholder="Ask Collaborator"]').fill(prompt);await dock().getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForFunction(count=>JSON.parse(localStorage.getItem('xhc.threads')||'[]').reduce((n,t)=>n+(t.messages||[]).filter(m=>m.role==='assistant').length,0)>count,before);
  await dock().getByRole('button',{name:'Send message',exact:true}).waitFor();assert.equal(queue.length,0);
 };
 const answer=body=>JSON.stringify({kind:'answer',text:body});
 await page.getByRole('button',{name:/^Projects(?:\s+\d+)?$/}).click();await page.getByRole('button',{name:'AV Stack fixture',exact:true}).click();await page.getByRole('tab',{name:'Functional Diagramming',exact:true}).waitFor();
 await page.locator('[aria-label="Functional architecture diagram"] .react-flow__node').first().waitFor();
 const canonical=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData'))['view-project'].responseRows);
 for(const prompt of ['describe this diagram','Explain what I am looking at.','Walk me through the diagram.']){
  await send(prompt,(evidence,payload)=>{assert.equal(evidence.section,'projects');assert.equal(evidence.projectId,'view-project');const relationship=evidence.structured.relationships.find(row=>row.controlAction==='Inertial Data');assert.equal(relationship.fromFunction,'Acquire Inertial Measurement');assert.equal(relationship.toFunction,'3D Scene Understanding');assert(text(payload.messages[0].content).includes('Current view evidence takes precedence'));return answer(`${relationship.fromFunction} sends ${relationship.controlAction} to ${relationship.toFunction}. The diagram also connects scene-state fusion and motion planning.`);});
  assert((await dock().innerText()).includes('Acquire Inertial Measurement sends Inertial Data to 3D Scene Understanding.'));
 }check('Unselected open Projects diagram and question variations receive current directed relationships despite older unrelated chat');
 queue.push(()=>JSON.stringify({kind:'clarify',text:'Which diagram would you like me to describe—one to attach or a saved diagram?'}));
 await send('describe this diagram',(evidence,payload)=>{assert.equal(payload.xhandleWorkflow,'collaborator.context-repair');assert.equal(evidence.structured.relationships[0].controlAction,'Inertial Data');return answer('The currently open AV Stack diagram links inertial sensing, scene understanding, state fusion and motion control.');});
 assert(!(await dock().locator('fieldset:not([disabled])').count()));check('Redundant upload/target question is repaired before it becomes a selectable follow-up');
 await page.getByRole('button',{name:'Code-Based Architecture',exact:true}).click();await page.getByRole('button',{name:'CBA performance fixture',exact:true}).click();await page.locator('[data-collaborator-workspace="code-architecture"] .react-flow__node').first().waitFor();
 await send('Explain this architecture.',evidence=>{assert.equal(evidence.section,'code-architecture');assert.equal(evidence.projectId,'perf-cba');assert(evidence.structured.relationships.length);assert(evidence.structured.relationships.some(row=>row.from&&row.to));return answer('The open code architecture connects source-derived control functions through directed command interfaces.');});check('Code architecture uses its live source-derived relationships rather than the previous Projects diagram');
 await page.getByRole('button',{name:'Design Management',exact:true}).click();await page.locator('.design-library-pane').getByRole('button',{name:'Control operations',exact:true}).click();await page.locator('[title="Table view"]').click();
 await send('Summarize this table.',evidence=>{assert.equal(evidence.section,'requirements');assert(evidence.rendered.text.includes('The controller shall reject expired commands.'));assert(!evidence.rendered.text.includes('unrelated battery'));return answer('This table contains the controller requirement to reject expired commands under Command operation.');});check('Design Management current table is grounded without a selected row');
 await page.locator('[title="Document view"]').click();await send('Explain this document.',evidence=>{assert.equal(evidence.section,'requirements');assert(evidence.rendered.text.includes('Command operation'));return answer('Control operations describes command handling and requires the controller to reject expired commands.');});check('Document presentation uses current content and retains the existing scoped design reader');
 await page.getByRole('button',{name:'System Test',exact:true}).click();await page.getByText('Reject stale command',{exact:true}).first().waitFor();await send('What am I looking at?',evidence=>{assert.equal(evidence.section,'vnv');assert(evidence.rendered.text.includes('Reject stale command'));return answer('The current System Test view contains the draft stale-command rejection test. Draft does not establish a passing result.');});check('System Test descriptions use displayed test content and statuses');
 await page.getByRole('button',{name:'Safety Case',exact:true}).click();await page.getByText('Expired commands cannot cause motion',{exact:true}).first().waitFor();await send('Describe this diagram.',evidence=>{assert.equal(evidence.section,'safety-case');assert.equal(evidence.structured.kind,'safety-case');assert.equal(evidence.structured.edges[0].source,'view-evidence');assert.equal(evidence.structured.edges[0].target,'view-claim');assert(evidence.structured.nodes.some(node=>node.status==='needs-review'));return answer('Command expiration test supports the claim that expired commands cannot cause motion. The claim needs review and the evidence is draft.');});check('Safety Case carries claim/evidence identities, directed support and review status');
 await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByText('Control Evidence Report',{exact:true}).first().waitFor();await send('Summarize the current report.',evidence=>{assert.equal(evidence.section,'reports');assert(evidence.rendered.text.includes('Verification is pending.'));return answer('The Control Evidence Report records rejection of expired commands and states that verification is pending.');});check('Reports explanations use the open report rather than previous diagrams or tests');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData'))['view-project'].responseRows),canonical);
 check('Explanations preserve the canonical functional decomposition');
 await page.screenshot({path:root+'/current-view-explanation.png'});assert.deepEqual(result.errors,[]);result.ok=true;
 }catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;if(page)await page.screenshot({path:root+'/failure.png'}).catch(()=>{});}
 finally{fs.writeFileSync(root+'/result.json',JSON.stringify(result,null,2));await app?.close();await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));console.log('RESULT',root+'/result.json',JSON.stringify({ok:result.ok,checks:result.checks.length,errors:result.errors.length}));}
})();
