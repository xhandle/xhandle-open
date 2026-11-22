// Real production renderer, isolated workspace, controlled provider responses.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require(process.env.XHANDLE_PLAYWRIGHT_MODULE||'playwright-core');
const {electronFixtureMain,cleanEnvironment}=require('./electron-regression-support.cjs');
const {auditTheme}=require('./theme-contrast-audit.cjs');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const stage=fs.realpathSync(arg('--stage')),fixtures=fs.realpathSync(arg('--fixtures'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-cookbook-live-'));
const result={root,checks:[],errors:[],requests:[],themeAudits:[],bubbleChecks:[]},replies=[];
let app,page,releasePending;
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
const check=name=>{result.checks.push(name);save();console.log('PASS '+name);};
const recipeReply=prompt=>JSON.stringify({kind:'suggestion',recipeId:'run-an-additive-completeness-audit',prompt,explanation:'Finds missing interfaces while preserving existing rows.'});
async function settleAppearance(){
 await page.evaluate(async()=>{
  const transitions=()=>document.getAnimations().filter(animation=>animation.constructor.name==='CSSTransition'&&animation.playState==='running');
  for(let attempt=0;attempt<5;attempt++){
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   await Promise.all(transitions().map(animation=>animation.finished.catch(()=>{})));
   if(!transitions().length)return;
  }
 });
}
async function appearance(name){
 await settleAppearance();const audit=await page.evaluate(auditTheme);result.themeAudits.push({name,...audit});save();
 await page.screenshot({path:path.join(root,name+'.png')});assert.equal(audit.brightAccents.length,0,JSON.stringify(audit.brightAccents.slice(0,4)));assert.equal(audit.failures.length,0,JSON.stringify(audit.failures.slice(0,5)));assert.equal(audit.brightSurfaces.length,0,JSON.stringify(audit.brightSurfaces.slice(0,4)));
 const dialog=await page.getByRole('dialog',{name:'Prompt Cookbook',exact:true}).boundingBox();assert(dialog&&dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=1601&&dialog.y+dialog.height<=1051,'Cookbook fits the window');
}
async function bubbleAppearance(name,dark){
 await settleAppearance();const bubble=page.locator('.collaborator-user-bubble').first();await bubble.waitFor();
 const color=await bubble.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
 assert.equal(color.background,dark?'rgb(52, 53, 79)':'rgb(79, 70, 229)',name+' prompt surface');
 assert.equal(color.color,dark?'rgb(237, 242, 248)':'rgb(255, 255, 255)',name+' prompt text');
 const audit=await page.evaluate(auditTheme);assert.equal(audit.brightAccents.length,0,JSON.stringify(audit.brightAccents));assert.equal(audit.failures.length,0,JSON.stringify(audit.failures.slice(0,5)));
 result.bubbleChecks.push({name,...color,accentSamples:audit.accentSamples});save();await page.screenshot({path:path.join(root,name+'.png')});
}
async function open(){await page.getByRole('button',{name:'Open Collaborator options',exact:true}).click();await page.getByRole('button',{name:/^Prompt Cookbook/}).click();await page.getByRole('dialog',{name:'Prompt Cookbook',exact:true}).waitFor();}
const draft=()=>page.getByPlaceholder('Ask Collaborator',{exact:true});
(async()=>{try{
 for(const name of ['profile','session'])fs.mkdirSync(path.join(root,name));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'xhandle-cookbook-check',version:'1.0.0',main:'main.cjs'}));fs.writeFileSync(path.join(root,'main.cjs'),electronFixtureMain(stage,root));
 app=await _electron.launch({executablePath:arg('--electron'),args:[root],env:cleanEnvironment()});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>{result.errors.push(error.stack||error.message);save();});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1600,height:1050}));
 await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
 await page.addScriptTag({path:path.join(fixtures,'current-view.seed.js')});await page.evaluate(async()=>{await window.seedCollaboratorCurrentView();localStorage.setItem('xhandle.sidebarLocked','true');});
 await page.exposeFunction('__cookbookResponse',async payload=>{
  assert.equal(payload.max_tokens,2400);assert.equal(payload.xhandleWorkflow,'collaborator.prompt-cookbook','Only the explicit cookbook helper may call a model');
  const user=JSON.parse(payload.messages.at(-1).content);assert(!JSON.stringify(user).includes('PRIVATE ATTACHMENT CONTENT'),'No attachment body enters prompt drafting');assert(JSON.stringify(user).length<6000);
  result.requests.push({workflow:payload.xhandleWorkflow,context:user.currentWorkspace,goal:user.goal});save();const next=replies.shift();assert(next,'Unplanned provider request');return typeof next==='function'?await next():next;
 });
 await page.addInitScript(()=>{const native=window.fetch.bind(window);window.fetch=async(input,options={})=>{
  const url=typeof input==='string'?input:input.url;if(!String(url).endsWith('/api/chat'))return native(input,options);
  const reply=await window.__cookbookResponse(JSON.parse(options.body));if(options.signal?.aborted)throw new DOMException('Stopped','AbortError');
  if(reply.error)return new Response(JSON.stringify({error:reply.error}),{status:503,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({choices:[{message:{content:reply.text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
 };});
 await page.reload();await page.getByRole('button',{name:'AV Stack fixture',exact:true}).click();await page.locator('.xhandle-collaborator-dock').waitFor();await page.locator('[aria-label="Functional architecture diagram"] .react-flow__node').first().waitFor();
 const savedBefore=await page.evaluate(()=>({threads:JSON.parse(localStorage.getItem('xhc.threads')),project:Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('xhandle.projectData'))).map(([id,data])=>[id,{responseRows:data.responseRows,analysisResult:data.analysisResult,riskRegister:data.riskRegister,requirements:data.requirements}]))}));
 await bubbleAppearance('docked-light-prompts',false);await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await bubbleAppearance('docked-dark-prompts',true);await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
 check('Docked prompt bubbles retain original light colors and use muted readable dark fills');
 await draft().fill('Keep this original conversation draft');
 await page.getByRole('button',{name:'Open Collaborator options',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Add files or images',exact:true}).click();await (await chooser).setFiles({name:'cookbook-notes.txt',mimeType:'text/plain',buffer:Buffer.from('PRIVATE ATTACHMENT CONTENT')});
 await page.getByRole('button',{name:'Preview attachment cookbook-notes.txt',exact:true}).waitFor();
 await open();await page.getByRole('searchbox',{name:'Search prompts',exact:true}).fill('orphan');await page.getByText('2 matching prompts',{exact:true}).waitFor();await page.getByRole('button',{name:/^Check graph connectivity/}).click();
 await page.getByRole('textbox',{name:'Prompt preview',exact:true}).fill('Review existing graph connections. Preserve every existing row.');await page.getByRole('button',{name:'Use prompt',exact:true}).click();
 assert.equal(await draft().inputValue(),'Keep this original conversation draft\n\nReview existing graph connections. Preserve every existing row.');await page.getByRole('button',{name:'Preview attachment cookbook-notes.txt',exact:true}).waitFor();assert.equal(result.requests.length,0);
 check('Docked + menu browses the shared cookbook and appends an editable prompt without sending, AI calls or lost attachments');
 await draft().fill('Existing draft');await open();await page.getByRole('tab',{name:'Help me write a prompt',exact:true}).click();await page.getByRole('textbox',{name:'Your goal',exact:true}).fill('Find missing interfaces without changing existing rows');
 replies.push({text:recipeReply('Audit the AV Stack fixture for missing interfaces. Preserve every existing row and propose additions only.')});await page.getByRole('button',{name:'Suggest prompt',exact:true}).click();await page.getByRole('textbox',{name:'Prompt preview',exact:true}).waitFor();assert.equal(result.requests.at(-1).context.project,'AV Stack fixture');
 await appearance('docked-light-cookbook');await page.getByRole('button',{name:'Use prompt',exact:true}).click();assert((await draft().inputValue()).startsWith('Existing draft\n\nAudit the AV Stack fixture'));
 check('Guided prompt drafting uses the current project metadata and creates only an editable conversation draft');
 await open();await page.getByRole('tab',{name:'Help me write a prompt',exact:true}).click();await page.getByRole('textbox',{name:'Your goal',exact:true}).fill('Review interfaces again');replies.push({error:'Synthetic provider quota exceeded'});await page.getByRole('button',{name:'Suggest prompt',exact:true}).click();await page.getByRole('alert').filter({hasText:'Could not prepare a suggestion'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Your goal',exact:true}).inputValue(),'Review interfaces again');await page.getByRole('button',{name:'Close Prompt Cookbook',exact:true}).click();
 check('Provider failure retains the goal, original draft and normal cookbook availability');
 await open();await page.getByRole('tab',{name:'Help me write a prompt',exact:true}).click();await page.getByRole('textbox',{name:'Your goal',exact:true}).fill('Review one subsystem');replies.push({text:'{"kind":"clarification","question":"Which subsystem?"}'});await page.getByRole('button',{name:'Suggest prompt',exact:true}).click();await page.getByRole('textbox',{name:'Additional detail',exact:true}).fill('Perception');replies.push({text:recipeReply('Review interfaces owned by Perception without changing existing records.')});await page.getByRole('button',{name:'Suggest prompt',exact:true}).click();await page.getByRole('textbox',{name:'Prompt preview',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Your goal',exact:true}).fill('Review a different subsystem');assert(await page.getByRole('button',{name:'Use prompt',exact:true}).isDisabled());await page.getByRole('button',{name:'Close Prompt Cookbook',exact:true}).click();check('Clarifications produce editable drafts, and editing the goal invalidates earlier suggestions');
 await open();await page.getByRole('tab',{name:'Help me write a prompt',exact:true}).click();replies.push(()=>new Promise(resolve=>{releasePending=resolve;}));await page.getByRole('button',{name:'Suggest prompt',exact:true}).click();await page.getByRole('button',{name:'Cancel suggestion',exact:true}).waitFor();
 const deadline=Date.now()+10000;while(!releasePending&&Date.now()<deadline)await page.waitForTimeout(20);assert(releasePending);await page.keyboard.press('Escape');releasePending({text:recipeReply('STALE RESPONSE SHOULD NOT BE INSERTED')});await page.waitForTimeout(300);assert(!(await draft().inputValue()).includes('STALE RESPONSE'));
 check('Closing the cookbook cancels a pending provider request and discards late responses');
 await page.getByTitle('Undock',{exact:true}).click();await page.getByTitle('Dock Collaborator to right sidebar (⌘/Ctrl+Shift+C)',{exact:true}).waitFor();await draft().fill('Full screen draft');await draft().focus();await page.keyboard.press(process.platform==='darwin'?'Meta+Alt+p':'Control+Alt+p');await page.getByRole('dialog',{name:'Prompt Cookbook',exact:true}).waitFor();assert(!(await page.locator('[aria-label="Prompt workspace context"]').innerText()).includes('Functional Diagramming'));await page.getByRole('tab',{name:'Browse prompts',exact:true}).click();await page.getByRole('button',{name:/^Check graph connectivity/}).click();await page.getByRole('button',{name:'Use prompt',exact:true}).click();assert((await draft().inputValue()).startsWith('Full screen draft\n\nCheck the current functional decomposition'));
 check('Full-screen Collaborator shares the + menu and composer-scoped shortcut and preserves its draft');
 await bubbleAppearance('full-screen-light-prompts',false);await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await bubbleAppearance('full-screen-dark-prompts',true);check('Full-screen prompt bubbles and action buttons share the muted dark palette');await open();await page.getByRole('tab',{name:'Browse prompts',exact:true}).click();await page.getByRole('button',{name:/^Check graph connectivity/}).click();await appearance('full-screen-dark-cookbook');await page.keyboard.press('Escape');
 await open();await page.getByRole('tab',{name:'Help me write a prompt',exact:true}).click();await page.getByRole('textbox',{name:'Your goal',exact:true}).fill('Run the full hazard analysis');replies.push({text:'{"kind":"unsupported","explanation":"Use Run hazard analysis in the project Hazard Analysis view."}'});await page.getByRole('button',{name:'Suggest prompt',exact:true}).click();await page.getByRole('status').filter({hasText:'Use Run hazard analysis'}).waitFor();assert(await page.getByRole('button',{name:'Use prompt',exact:true}).isDisabled());await appearance('unsupported-workflow-dark');await page.getByRole('button',{name:'Close Prompt Cookbook',exact:true}).click();
 check('Unsupported chat tasks redirect to existing controls, and light/dark cookbook screens have readable text and no unexpected bright panels');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1024,height:720}));await open();const small=await page.getByRole('dialog',{name:'Prompt Cookbook',exact:true}).boundingBox(),use=await page.getByRole('button',{name:'Use prompt',exact:true}).boundingBox();assert(small.y>=0&&small.y+small.height<=721&&use.y+use.height<=721);await page.keyboard.press('Escape');
 check('The cookbook remains bounded with visible footer controls in the minimum Electron window');
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(320,400);win.setBounds({width:390,height:760});});await open();await page.getByRole('tab',{name:'Browse prompts',exact:true}).click();
 const mobile=await page.getByRole('dialog',{name:'Prompt Cookbook',exact:true}).boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert(mobile.x>=0&&mobile.y>=0&&mobile.x+mobile.width<=viewport.width+1&&mobile.y+mobile.height<=viewport.height+1);assert(await page.getByRole('searchbox',{name:'Search prompts',exact:true}).isVisible());await page.screenshot({path:path.join(root,'narrow-cookbook.png')});await page.keyboard.press('Escape');check('The portalled cookbook supports a narrow browser-sized viewport');
 const savedAfter=await page.evaluate(()=>({threads:JSON.parse(localStorage.getItem('xhc.threads')),project:Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('xhandle.projectData'))).map(([id,data])=>[id,{responseRows:data.responseRows,analysisResult:data.analysisResult,riskRegister:data.riskRegister,requirements:data.requirements}]))}));assert.deepEqual(savedAfter,savedBefore,'Prompt preparation must not send messages or mutate saved engineering records');assert.equal(replies.length,0);assert.deepEqual(result.errors,[]);result.ok=true;check('Browsing and assisted prompt preparation leave saved conversations and project records unchanged');
}catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;if(page){await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(root,'body.txt'),await page.locator('body').innerText());}}
finally{save();await app?.close();console.log('RESULT '+path.join(root,'result.json')+' '+JSON.stringify({ok:result.ok,checks:result.checks.length,errors:result.errors.length}));}})();
