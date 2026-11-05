// Actual optimized App, synthetic storage and deterministic local provider only.
// node context-on-demand.cjs chrome|electron [absolute build directory]
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const mode=process.argv[2],root=path.resolve(__dirname,'../../..'),build=path.resolve(process.argv[3]||path.join(root,'build'));
const provider=process.env.XHANDLE_ACCEPTANCE_PROVIDER||'openai',model=process.env.XHANDLE_ACCEPTANCE_MODEL||'gpt-5',effort=process.env.XHANDLE_ACCEPTANCE_EFFORT||'high';
if(!['chrome','electron'].includes(mode))throw Error('Specify chrome or electron');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-collaborator-acceptance-'));
const profile=path.join(out,'profile');fs.mkdirSync(profile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result={mode,out,checks:[],requests:[],errors:[],timings:[]};let processHandle,ws,browserWs,server,cdp,origin;
let activeAnswers=0;let technicalCase='';
const hash=(...parts)=>{const raw=parts.join(':');let n=0;for(const c of raw)n=((n<<5)-n+c.charCodeAt(0))|0;return 'artifact:'+encodeURIComponent(raw).replace(/%/g,'').slice(0,150)+':'+Math.abs(n).toString(36);};
const reportArtifact=hash('generated-report','acceptance','saved-report');
function connect(url,onEvent=()=>{}){return new Promise((resolve,reject)=>{const socket=new WebSocket(url),pending=new Map();let id=0;socket.onopen=()=>resolve({socket,call:(method,params={})=>new Promise((done,fail)=>{pending.set(++id,{done,fail});socket.send(JSON.stringify({id,method,params}));})});socket.onerror=reject;socket.onmessage=event=>{const value=JSON.parse(event.data);if(!value.id){onEvent(value);return;}const job=pending.get(value.id);pending.delete(value.id);value.error?job?.fail(Error(JSON.stringify(value.error))):job?.done(value.result);};});}
async function evaluate(expression){const data=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(data.exceptionDetails)throw Error(data.exceptionDetails.exception?.description||data.exceptionDetails.text);return data.result.value;}
async function wait(expression,label,timeout=45000){const start=Date.now();while(Date.now()-start<timeout){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message))throw error;}await sleep(80);}throw Error('Timed out: '+label+'; '+(await evaluate('document.body.innerText')).slice(-1800));}
const clickText=text=>wait(`(()=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true;})()`,'click '+text);
async function ask(question){technicalCase='';await evaluate(`(()=>{const input=[...document.querySelectorAll('textarea')].find(el=>el.placeholder==='Ask Collaborator');if(!input)throw Error('Missing composer');input.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(question)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
async function askPasted(question){technicalCase='';await evaluate(`(()=>{const input=document.querySelector('textarea[placeholder="Ask Collaborator"]');input.focus();const clipboardData=new DataTransfer();clipboardData.setData('text/plain',${JSON.stringify(question)});input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));})()`);await wait(`!!document.querySelector('button[aria-label="Send message"]:not(:disabled)')`,'pasted prompt ready');await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`);}
async function main(){
 server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS'){res.end();return;}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/seed.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic storage setup</title>');return;}
  if(url.pathname==='/api/chat'){
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);const workflow=body.xhandleWorkflow||'unspecified';
   const user=[...(body.messages||[])].reverse().find(row=>row.role==='user')?.content||'';
   result.requests.push({workflow,stream:body.stream===true,provider:req.headers['x-ai-provider'],model:req.headers['x-ai-model'],effort:req.headers['x-ai-effort'],activeAnswers,containsWorkspaceSentinel:raw.includes('ROUTING_REVIEW_SENTINEL'),inputTextChars:raw.length,architectureEvidenceCopies:raw.split('SIGNED_COMMAND_ONLY').length-1,hasArchitectureEvidence:raw.includes('SIGNED_COMMAND_ONLY'),hasForeignEvidence:raw.includes('FOREIGN_PROJECT_SECRET'),hasReadEvidence:raw.includes('Targeted workspace read evidence'),hasCompleteCount:raw.includes('count\\":2')&&raw.includes('complete\\":true')});
   if(workflow==='collaborator.context-repair'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({kind:'workspace_read',areas:['projects','functional','cba'],reference:'VulnerableApp'})}}]}));return;}
   if(workflow==='collaborator.read-plan'&&technicalCase){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({calls:[{operation:'query',types:['code_architecture_edge'],limit:4}]})}}]}));return;}
   if(workflow==='collaborator.read-plan'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({calls:[{operation:'query',types:['generated_report'],limit:4}]})}}]}));return;}
   if(!body.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:(workflow==='unspecified'||workflow==='collaborator.request')?JSON.stringify({intent:'clarify',clarification:'ROUTING_REVIEW_ACTION_CLARIFICATION',actions:[]}):'Acceptance Chat'}}]}));return;}
   activeAnswers++;res.writeHead(200,{'Content-Type':'text/event-stream','x-ai-request-id':'acceptance-'+result.requests.length,'x-ai-provider-used':provider==='anthropic'?'claude':provider,'x-ai-model-used':model,'x-ai-effort-used':effort});res.write(': connected\n\n');
   let answer=String(user).trim()==='hey'?'GREETING_COMPLETE: Hello!':String(user).includes('What is a software requirement')?'DEFINITION_COMPLETE: A software requirement describes required software behavior.':String(user).includes('Show all reports')?'REPORT_LIST_COMPLETE: Saved acceptance report.':String(user).includes('SLOW_ACCEPTANCE')?'SLOW_ACCEPTANCE response':String(user).includes('SECOND_ACCEPTANCE')?'SECOND_ACCEPTANCE response':`ACCEPTANCE_COMPLETE: Two requirements. [Source: Saved acceptance report — generated report](#xhandle-artifact=${encodeURIComponent(reportArtifact)})`;
   if(workflow==='collaborator.context-turn') {
    const requestText=typeof user==='string'?user:(user||[]).filter(p=>p.type==='text').map(p=>p.text).join(' ');
    technicalCase=/summarize the vulnerableapp|ValidateCommand/.test(requestText)?requestText:'';
    answer=JSON.stringify(/summarize the vulnerableapp|ValidateCommand/.test(requestText)?{kind:'workspace_read',areas:['projects','functional','cba'],reference:'VulnerableApp'}:/How many requirements/.test(requestText)?{kind:'workspace_read',areas:['requirements']}:/WeatherEstimator/.test(requestText)?{kind:'workspace_read',areas:['functional','source']}:
     /Compare the attached/.test(requestText)?{kind:'workspace_read',areas:['requirements','reports']}:
     /INVALID_CONTEXT_REQUEST/.test(requestText)?{kind:'workspace_read',areas:['everything'],projectId:'other'}:
     {kind:'answer',text:'DIRECT_COMPLETE: '+(/weather/i.test(requestText)?'Live weather is not available here.':/looking at/i.test(requestText)?'This is the visible workspace screen.':'A synthetic direct answer.')});
   }
   if(workflow==='collaborator.context-turn'&&technicalCase.startsWith('summarize'))answer='I need to retrieve the project information first.';
   if(workflow==='collaborator.answer'&&(technicalCase||raw.includes('SIGNED_COMMAND_ONLY'))){if(!raw.includes('SIGNED_COMMAND_ONLY'))fs.writeFileSync(path.join(out,'missing-evidence.json'),JSON.stringify(body,null,2));answer='TECHNICAL_COMPLETE: ValidateCommand accepts only signed commands, then passes them to ExecuteCommand. This describes the retrieved architecture rows.';}
   const first=setTimeout(()=>res.write('data: '+JSON.stringify(answer.slice(0,24))+'\n\n'),80);
   const finish=setTimeout(()=>{res.write('data: '+JSON.stringify(answer.slice(24))+'\n\nevent: metadata\ndata: {"finish_reason":"stop"}\n\nevent: done\ndata: [DONE]\n\n');res.end();},String(user).includes('SLOW_ACCEPTANCE')?5000:350);
   res.on('close',()=>{activeAnswers--;clearTimeout(first);clearTimeout(finish);});return;
  }
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.includes('models')?{models:[{id:model,value:model,label:'Synthetic selected model'}]}:{}));return;}
  const file=path.resolve(build,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(build+path.sep)&&file!==build){res.writeHead(403);res.end();return;}
  const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(build,'index.html');res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(target));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port+'/';
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 if(mode==='electron'){
  const file=path.join(out,'main.cjs');fs.writeFileSync(file,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.commandLine.appendSwitch('remote-debugging-port','0');app.commandLine.appendSwitch('enable-precise-memory-info');app.whenReady().then(()=>new BrowserWindow({show:true,width:1440,height:920,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}}).loadURL('about:blank'));`);
  processHandle=spawn('/Users/Nick/xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',[file],{env,stdio:['ignore','ignore','pipe']});
 }else processHandle=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--enable-precise-memory-info','--user-data-dir='+profile,'about:blank'],{env,stdio:['ignore','ignore','pipe']});
 let stderr='';processHandle.stderr.on('data',part=>{stderr+=part;});let port;
 for(let i=0;i<150;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{const match=stderr.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)/);if(match){port=Number(match[1]);break;}}await sleep(100);}if(!port)throw Error('No debugging port');
 let target;for(let i=0;i<100;i++){const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=targets.find(row=>row.type==='page');if(target)break;await sleep(50);}if(!target)throw Error('No application page target');
 const connected=await connect(target.webSocketDebuggerUrl,event=>{if(event.method==='Runtime.exceptionThrown')result.errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);if(event.method==='Page.javascriptDialogOpening')void cdp('Page.handleJavaScriptDialog',{accept:true});if(event.method==='Fetch.requestPaused'){const p=event.params;void cdp(p.request.url.startsWith(origin)||p.request.url.startsWith('data:')||p.request.url.startsWith('blob:')?'Fetch.continueRequest':'Fetch.failRequest',{requestId:p.requestId,...(p.request.url.startsWith(origin)||p.request.url.startsWith('data:')||p.request.url.startsWith('blob:')?{}:{errorReason:'BlockedByClient'})});}});ws=connected.socket;cdp=connected.call;
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:920,deviceScaleFactor:1,mobile:false});await cdp('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__indexPasses=[];const nativePost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){if(message?.options&&Array.isArray(message.values))window.__indexPasses.push({at:performance.now(),steps:message.options.steps||null,projectIds:message.options.projectIds||null});return nativePost.call(this,message,...rest);};`});
 await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__BACKEND_URL=${JSON.stringify(origin.slice(0,-1))};window.__acceptance={peakHeap:0,longTasks:[]};setInterval(()=>{window.__acceptance.peakHeap=Math.max(window.__acceptance.peakHeap,performance.memory?.usedJSHeapSize||0);},100);new PerformanceObserver(l=>{window.__acceptance.longTasks.push(...l.getEntries().map(v=>v.duration));}).observe({type:'longtask',buffered:true});`});
 await cdp('Page.navigate',{url:origin+'seed.html'});await wait('document.readyState==="complete"','initial load');
 await evaluate(`(async()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'acceptance',name:'Acceptance Project'},{id:'other',name:'Other Project'}]));
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'vulnerable',name:'VulnerableApp',activeRepoId:'repo',repos:${process.env.XHANDLE_NAVIGATION_ONLY==='1'?JSON.stringify([{id:'repo',repoId:'synthetic/example',repoName:'example',owner:'synthetic',repo:'example',branch:'main'}]):'[]'}},{id:'foreign-cba',name:'Foreign CBA',repos:[]}]));
 const architecture=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle',4);r.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])r.result.createObjectStore(name,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=architecture.transaction('copilot_baseline','readwrite');tx.objectStore('copilot_baseline').put({key:'cba:vulnerable:repo',value:[{from:'ValidateCommand',to:'ExecuteCommand',description:'SIGNED_COMMAND_ONLY'}]});tx.objectStore('copilot_baseline').put({key:'cba:foreign-cba:repo',value:[{from:'Foreign',to:'Secret',description:'FOREIGN_PROJECT_SECRET'}]});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});architecture.close();
 localStorage.setItem('xhandle.sidebarProjectsOpen','true');localStorage.setItem('xhandle.sidebarLocked','true');
 localStorage.setItem('xhandle.projectData',JSON.stringify({acceptance:{responseRows:[{fromFunction:'Observe',toFunction:'Validate',controlAction:'State'}],riskRegister:[],requirements:[],analysisResult:{Summary:[['Hazard'],['Synthetic hazard']]}},other:{responseRows:[],requirements:[],riskRegister:[]}}));
 localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'A-1',projectId:'acceptance',title:'ROUTING_REVIEW_SENTINEL: Reject stale commands'},{id:'A-2',projectId:'acceptance',title:'Validate state'}]));
 localStorage.setItem('xhandle.aiProvider.active',${JSON.stringify(provider)});localStorage.setItem('xhandle.aiProvider.keys',JSON.stringify({[${JSON.stringify(provider)}]:{apiKey:'synthetic-local-key'}}));localStorage.setItem('xhandle.aiProviderModel.'+${JSON.stringify(provider)},${JSON.stringify(model)});localStorage.setItem('xhandle.aiProviderEffort.'+${JSON.stringify(provider)},${JSON.stringify(effort)});
 localStorage.setItem('xhc.threads',JSON.stringify([{id:'thread-a',title:'New topic',messages:[],updatedAt:1},{id:'thread-b',title:'Acceptance B',messages:[],updatedAt:0}]));
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-generated-reports',1);r.onupgradeneeded=()=>{for(const name of ['metadata','reports'])r.result.createObjectStore(name,{keyPath:'id'}).createIndex('projectId','projectId');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction(['metadata','reports'],'readwrite');const value={id:'saved-report',projectId:'acceptance',title:'Saved acceptance report',reportType:'Subsystem Design Document',status:'complete',createdAt:'2026-11-04T12:00:00Z'};tx.objectStore('metadata').put(value);tx.objectStore('reports').put({...value,report:'# SAVED_REPORT_BODY\\n\\nAcceptance evidence.'});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
 })()`);
 await cdp('Page.navigate',{url:origin});await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Acceptance Project')`,'project');
 if(process.env.XHANDLE_NAVIGATION_ONLY==='1'){
  result.navigation=[];
  const sample=async label=>{await sleep(3500);result.navigation.push({label,indexPasses:await evaluate('window.__indexPasses.slice()')});};
  await sample('startup');
  await clickText('Acceptance Project');await wait(`document.body.innerText.includes('Functional Diagramming')`,'project workspace');await sample('ordinary project');
  await wait(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Code-Based Architecture'));if(!button)return false;button.click();return true;})()`,'architecture dashboard');
  await clickText('VulnerableApp');await wait(`document.body.innerText.includes('Architecture Diagram')`,'architecture workspace');await sample('code architecture project');
  await clickText('Acceptance Project');await sample('return to ordinary project');
  await evaluate(`window.dispatchEvent(new CustomEvent('xhandle:data-changed',{detail:{db:'xhandle',stores:['copilot_baseline']}}))`);await sample('source changed while browsing');
  result.sourceChangesTracked=await evaluate(`!!localStorage.getItem('xhandle.workspaceGraph.dirty.codeArchitecture')`);
  result.memory=await evaluate('window.__acceptance');
  assert.ok(result.navigation.every(item=>item.indexPasses.length===0),'browsing must not start Collaborator index passes');
  assert.equal(result.sourceChangesTracked,true,'source changes before a question must still invalidate stale index checkpoints');
  assert.equal(result.requests.length,0,'browsing must not contact AI');assert.deepEqual(result.errors,[]);result.ok=true;return;
 }
 await clickText('Acceptance Project');await clickText('Collaborator');await wait(`!!document.querySelector('textarea[placeholder="Ask Collaborator"]')`,'composer');


 if(process.env.XHANDLE_ROUTING_VIEW==='dashboard'){
  await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Code-Based Architecture'));if(!button)throw Error('Missing architecture navigation');button.click();})()`);
  await wait(`document.body.innerText.includes('Code architecture dashboard')`,'visible architecture dashboard');
 }
 if(process.env.XHANDLE_ROUTING_VIEW==='full-page'){
  await wait(`(()=>{const button=document.querySelector('button[title="Undock"]');if(!button)return false;button.click();return true;})()`,'full-page Collaborator');
 }
 result.reviewView=process.env.XHANDLE_ROUTING_VIEW||'project-dock';
 result.routingReview=[];
 const cases=[
  {id:'greeting',question:'hey',expected:'conversation'},
  {id:'arithmetic',question:'whats5+5?',expected:'general question with no workspace reads'},
  {id:'weather',question:'Whats the weather today?',expected:'external-information or honest capability limitation'},
  {id:'visible-screen',question:'what are we looking at?',expected:'lightweight visible view metadata'},
  {id:'general-non-engineering',question:'Explain recursion in simple terms.',expected:'general knowledge'},
  {id:'general-engineering',question:'What is a software requirement?',expected:'general knowledge'},
  {id:'thread-transform',question:'Translate your previous answer into Spanish.',expected:'conversation history only'},
  {id:'thread-shortening',question:'Make it shorter.',expected:'conversation history only'},
  {id:'named-function',question:'What does WeatherEstimator do in this project?',expected:'targeted saved-data read'},
  {id:'invalid-context',question:'INVALID_CONTEXT_REQUEST',expected:'invalid request without retrieval'},
  {id:'project-summary',question:'summarize the vulnerableapp project',expected:'single final answer request with named-project architecture evidence'},
  {id:'interpreted-project-summary',question:'summarize the vulnerableapp in detail',expected:'semantic routing and format recovery for a request outside the overview shortcut'},
  {id:'pasted-project-summary',question:'**Attached file (1):**\n\nName: pasted-content.txt\nType: text/plain\nSize: 27 B\n\nsummarize the vulnerableapp',expected:'bounded saved architecture sample for a pasted overview'},
  {id:'technical-function',question:'What does ValidateCommand do in VulnerableApp?',expected:'technical answer grounded in saved architecture'},
  {id:'saved-count',question:'How many requirements are there for Acceptance Project?',expected:'targeted saved-data read'},
 ];
 for(const item of cases){
  await evaluate(`(()=>{window.__reviewLock='queued';navigator.locks.request('xhandle-workspace-graph-mutation',()=>new Promise(resolve=>{window.__reviewLock='held';window.__releaseReviewLock=()=>{window.__reviewLock='released';resolve();};setTimeout(window.__releaseReviewLock,12000);}));})()`);
  await wait(`window.__reviewLock==='held'`,'controlled storage lock');
  await evaluate(`localStorage.setItem('xhandle:requirements',localStorage.getItem('xhandle:requirements')+' ');localStorage.setItem('xhandle.codeArchitectureProjects',localStorage.getItem('xhandle.codeArchitectureProjects')+' ')`);
  const begin=result.requests.length,started=Date.now();if(item.id==='pasted-project-summary')await askPasted('summarize the vulnerableapp');else await ask(item.question);await sleep(1100);
  const blockedSample=await evaluate(`({lock:window.__reviewLock,retrieval:(/Reading saved|Waiting for access to saved|Preparing saved|Finding relevant saved|Retrieving the most relevant/.test(document.body.innerText)),busy:!!document.querySelector('button[aria-label="Stop generating"]'),elapsed:/[0-9]+s elapsed/.test(document.body.innerText),waitingForStorage:document.body.innerText.includes('Waiting for access to saved project information')})`);
  const startedBeforeRelease=result.requests.slice(begin).some(row=>['collaborator.answer','collaborator.context-turn'].includes(row.workflow));
  await evaluate('window.__releaseReviewLock()');
  await wait(`!document.querySelector('button[aria-label="Stop generating"]')`,'completion after controlled lock release');
  const requests=result.requests.slice(begin).filter(row=>row.workflow!=='collaborator.title');
  result.routingReview.push({...item,startedBeforeRelease,blockedSample,completeMs:Date.now()-started,requests});
  if(!['saved-count','named-function','project-summary','interpreted-project-summary','pasted-project-summary','technical-function'].includes(item.id)) {
    assert.equal(startedBeforeRelease,true,item.id+' must contact the selected model before storage unlock');
    assert.equal(blockedSample.busy,false,item.id+' must finish while storage remains blocked');
    assert.equal(blockedSample.retrieval,false,item.id+' must not display retrieval');
    assert.equal(requests.some(r=>r.containsWorkspaceSentinel),false,item.id+' must not include fresh saved records');
    assert.equal(requests.some(r=>r.workflow==='collaborator.read-plan'),false,item.id+' must not plan saved reads');
    assert.equal(requests.filter(r=>r.workflow==='collaborator.context-turn').length,1);
    const latest=await evaluate(`JSON.parse(localStorage.getItem('xhc.threads')).find(t=>t.id==='thread-a').messages.at(-1)?.content || ''`);
    if(item.id!=='invalid-context')assert.ok(latest.includes('DIRECT_COMPLETE'),item.id+' must persist its own completed answer');
    else assert.ok(/Unsupported context request|supported workspace area/.test(latest), 'invalid request must report a clear error');
  } else {assert.equal(blockedSample.busy,true,item.id+' must wait for required saved data');assert.equal(blockedSample.elapsed,true,item.id+' must show elapsed time');assert.equal(blockedSample.waitingForStorage,true,item.id+' must truthfully identify the storage wait');}
  if(['project-summary','interpreted-project-summary','pasted-project-summary','technical-function'].includes(item.id)){const answerRequest=requests.find(r=>r.workflow==='collaborator.answer');assert.ok(answerRequest?.hasArchitectureEvidence&&answerRequest.hasReadEvidence);assert.equal(answerRequest.hasForeignEvidence,false);assert.equal(requests.filter(r=>r.workflow==='collaborator.context-repair').length,item.id==='interpreted-project-summary'?1:0);const latest=await evaluate(`JSON.parse(localStorage.getItem('xhc.threads')).find(t=>t.id==='thread-a').messages.at(-1)?.content || ''`);assert.ok(latest.includes('TECHNICAL_COMPLETE'));}
  if(['project-summary','pasted-project-summary'].includes(item.id)){
   assert.deepEqual(requests.map(r=>r.workflow),['collaborator.answer'],'overview must make only the grounded answer request');
   assert.equal(startedBeforeRelease,false,'overview must retrieve evidence before contacting AI');
   assert.equal(requests[0].architectureEvidenceCopies,1,'overview sample must occur once in the final prompt');
  }
  if(item.id==='saved-count'){assert.ok(requests.some(r=>r.hasCompleteCount),'saved count must use complete evidence');const latest=await evaluate(`JSON.parse(localStorage.getItem('xhc.threads')).find(t=>t.id==='thread-a').messages.at(-1)?.content || ''`);assert.ok(latest.includes('ACCEPTANCE_COMPLETE: Two requirements'));}
  const expectedEffort=provider==='anthropic'&&model.startsWith('claude-haiku-4-5')?undefined:effort;
  assert.ok(requests.every(r=>r.model===model&&r.effort===expectedEffort),'selected provider settings preserved (effort omitted for models without support)');

 }
 result.checks.push('direct/invalid requests complete with blocked storage and no fresh record bodies; scoped reads still wait for evidence; selected model settings preserved');
 result.memory=await evaluate('window.__acceptance');assert.deepEqual(result.errors,[]);result.ok=true;
}
let deadline;Promise.race([main(),new Promise((_resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Acceptance journey timed out')),180000);})]).catch(error=>{result.ok=false;result.failure=error.stack;process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));ws?.close();browserWs?.close();processHandle?.kill();server?.closeAllConnections();server?.close();});
