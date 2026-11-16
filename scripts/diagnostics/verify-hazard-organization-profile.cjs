// Real Electron UI and persistence; only remote provider responses are controlled.
// --stage <staged desktop> --electron <Electron executable>
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require(process.env.XHANDLE_PLAYWRIGHT_MODULE||'playwright-core');
const {respond,inputsFromPrompt}=require('./hazard-stress-provider.cjs');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const stage=fs.realpathSync(arg('--stage')),root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xhandle-profile-live-'));
const result={root,checks:[],requests:[],errors:[],dialogs:[]};
let app,page,expectedProfile=false;
const check=message=>{result.checks.push(message);console.log('PASS',message);};
async function waitUntil(predicate,message,timeout=120000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await predicate())return;await page.waitForTimeout(100);}
  throw Error(message);
}
async function profile(enabled,{projectDisabled=false,override='PROJECT-PROFILE-MARKER: crossing frequency records govern.'}={}){
  expectedProfile=enabled&&!projectDisabled;
  await page.evaluate(({enabled,projectDisabled,override})=>{
    localStorage.setItem('xhandle.organizationProfile',JSON.stringify({id:'profile-fixture',enabled,updatedAt:'2026-11-16T12:00:00Z',markdown:'---\norganization: Synthetic Profile Audit\nprofile_version: 1.0\nstatus: approved\n---\n# Safety Philosophy\nUse the recorded harm chain.\n# Custom Hazard Policy\nORG-PROFILE-MARKER: apply customer operational-frequency evidence.\n'}));
    const projects=JSON.parse(localStorage.getItem('xhandle.projectData')||'{}');
    for(const id of Object.keys(projects))projects[id].organizationProfile={mode:projectDisabled?'disabled':'inherit',overrideMarkdown:override};
    localStorage.setItem('xhandle.projectData',JSON.stringify(projects));
  },{enabled,projectDisabled,override});
  await page.reload();
}
async function nav(name,tab){
  if(await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).count())await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).click();
  await page.locator('#xhandle-primary-sidebar').hover();
  await page.locator('#xhandle-primary-sidebar').getByRole('button',{name,exact:true}).click();
  await page.getByText(tab,{exact:true}).click();
}
async function projectHead(){
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-project-hazard-analysis',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const value=await new Promise((resolve,reject)=>{const r=db.transaction('analyses').objectStore('analyses').get('profile-project');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return value;
  });
}
async function projectRun(method,{single=false}={}){
  await nav('Profile Projects fixture','Hazard Analysis');
  const selector=page.getByLabel('Hazard analysis method',{exact:true});await selector.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Hazard analysis method"]').disabled);
  if(await selector.inputValue()!==method)await selector.selectOption(method);
  const before=result.requests.length;
  await page.getByRole('button',{name:single?'Generate':/^(Develop|Regenerate) risk profile$/,exact:true}).first().click();
  await waitUntil(()=>result.requests.length>before,'Projects generation never requested a provider response.');
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Hazard analysis method"]').disabled&&!Array.from(document.querySelectorAll('button')).some(button=>/Generating|Developing risk profile|Stop analysis/.test(button.textContent)),null,{timeout:120000});
  await waitUntil(async()=>{const head=await projectHead();const rows=Object.values(head?.draftHazardRowsByIndex||{}).filter(row=>row.generated);return rows.length===(single?1:7)&&rows.every(row=>row.organizationProfileProvenance?.effectiveEnabled===expectedProfile);},'Projects generation did not publish the expected calibrated rows.');
  assert(result.requests.length>before,'Analysis uses fresh requests after effective profile changes');
  const head=await projectHead();if(!single)assert(head?.analysisResult?.Summary?.length>1,'Generated analysis saved');
  const rows=Object.values(head.draftHazardRowsByIndex||{}).filter(row=>row.generated);
  assert(rows.length>0,'Generated rows are persisted');
  assert(rows.every(row=>row.organizationProfileProvenance?.effectiveEnabled===expectedProfile),'Every generated row records the correct effective profile');
  assert(rows.every(row=>row.organizationProfileProvenance?.effectiveContextIdentity),'Every generated row has a calibration identity');
  const meta=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData'))['profile-project'].organizationProfileProvenance);
  assert.equal(meta.effectiveEnabled,expectedProfile,'Project metadata clears disabled provenance');
  check(`Projects ${method}: ${expectedProfile?'enabled':'disabled'} profile reaches generation and persisted row provenance`);
  return head;
}
async function codeRun(method){
  await nav('Profile Code fixture','Hazard & Remediation');
  const selector=page.locator('select:has(option[value="HARA"])').first();await selector.waitFor();
  if(await selector.inputValue()!==method)await selector.selectOption(method);
  const before=result.requests.length;
  // A new analysis or explicit regeneration uses the real App handler and its
  // project-scope resolution, rather than invoking a runner test seam.
  const regenerate=page.getByRole('button',{name:'Regenerate hazard analysis',exact:true});
  if(await regenerate.count())await regenerate.click();
  else await page.getByRole('button',{name:/^(Run|Continue) hazard analysis$/}).click();
  await waitUntil(()=>result.requests.length>before,'Code generation never requested a provider response.');
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(button=>/Stop analysis|Stop hazard analysis/.test(button.textContent)),null,{timeout:120000});
  await page.getByRole('table',{name:'Code architecture hazard analysis',exact:true}).waitFor();
  assert(result.requests.length>before,'Code analysis makes fresh requests');
  const metadata=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-code-architecture-hazard-analysis');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const values=await new Promise((resolve,reject)=>{const r=db.transaction('hazardAnalysisRuns').objectStore('hazardAnalysisRuns').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return values.map(value=>value.payload?.rowIndex?.metadata||value).filter(value=>value.projectId==='profile-code');
  });
  assert(metadata.length,'Code analysis is saved');
  const latest=metadata.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)))[0];
  assert.equal(latest.organizationProfileProvenance?.effectiveEnabled,expectedProfile,'Code provenance matches effective profile');
  assert.equal(latest.runState,'complete','Code run completes');
  check(`Code ${method}: ${expectedProfile?'enabled':'disabled'} profile reaches the real generation workflow`);
}
(async()=>{
 try{
  for(const name of ['profile','session','downloads'])fs.mkdirSync(path.join(root,name));
  fs.writeFileSync(root+'/package.json',JSON.stringify({name:'xhandle-profile-live',version:'1.0.0',main:'main.cjs'}));
  fs.writeFileSync(root+'/main.cjs',require('./electron-regression-support.cjs').electronFixtureMain(stage,root));
  app=await _electron.launch({executablePath:arg('--electron'),args:[root],env:Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))});
  page=await app.firstWindow();await page.waitForURL('xhandle://app/**',{waitUntil:'domcontentloaded'});page.setDefaultTimeout(25000);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1500,height:1000}));
  page.on('pageerror',error=>result.errors.push(error.message));
  page.on('dialog',async dialog=>{result.dialogs.push(dialog.message());await dialog.accept();});
  await page.route('**/api/**',async route=>{
   try{
    if(!route.request().url().endsWith('/api/chat'))return route.fulfill({contentType:'application/json',body:'{"ok":true,"projects":[],"rows":[]}'});
    const body=route.request().postDataJSON(),prompt=body.messages?.find(message=>message.role==='user')?.content||'';
    const entry={workflow:body.xhandleWorkflow,length:prompt.length,enabled:expectedProfile,org:prompt.includes('ORG-PROFILE-MARKER'),override:prompt.includes('PROJECT-PROFILE-MARKER')};result.requests.push(entry);
    fs.writeFileSync(root+'/prompt-'+result.requests.length+'.txt',prompt);
    assert.equal(entry.org,expectedProfile,'Enabled custom profile section is included; disabled profile is absent');
    assert.equal(entry.override,expectedProfile,'Project override is included only in enabled profile context');
    assert(result.requests.length<200,'Requests stay bounded');
    let content;
    if(prompt.startsWith('You are consolidating hazard-analysis rows into a concise set of Consolidated Safety Issues.')){
      const evidence=prompt.split('Safety hazard evidence, grouped only to reduce transport size (the grouping does not decide issue boundaries):\n')[1];
      const families=JSON.parse(evidence.split('\n')[0]);
      content={issues:[{title:'Loss of braking before an occupied crossing',description:'Missing braking permits crossing entry and pedestrian injury. The linked command variants share a stopping safeguard.',likelihood:4,severity:5,tags:'braking',sourceFamilyIds:families.map(family=>family.familyId)}]};
    }else if(prompt.startsWith('Map each applicable'))content=inputsFromPrompt(prompt).map(input=>({id:input.id,canonicalLossIds:['L1'],canonicalHazardId:'H1'}));
    else content=respond(prompt);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(content)}}]})});
   }catch(error){result.errors.push(error.message);await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:error.message})});}
  });
  await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
  await page.evaluate(async()=>{
    localStorage.clear();localStorage.setItem('aiProvider','OpenAI');localStorage.setItem('openaiModel','gpt-4.1');localStorage.setItem('openaiReasoningEffort','medium');
    const row={id:'brake-interface',traceId:'brake-code',fromFunction:'Vehicle controller',from:'Vehicle controller',controlAction:'Brake command',action:'Brake command',toFunction:'Brake actuator',to:'Brake actuator',fromDetails:'Automated braking item; no driver. An independent stop function holds standstill with propulsion inhibited. Timing analysis establishes 100 ms before crossing entry.',controlDetails:'The brake actuator depends on the brake command to stop the vehicle at occupied crossings. The maintained command has a validity interval and ordered enable prerequisites.',toDetails:'The brake actuator applies commanded braking to stop the vehicle.',rowRef:1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual',fromArchitecture:{subsystem:'Braking'},toArchitecture:{subsystem:'Braking'}};
    localStorage.setItem('xhandle.projects',JSON.stringify([{id:'profile-project',name:'Profile Projects fixture'}]));
    localStorage.setItem('xhandle.activeProjectId','profile-project');
    localStorage.setItem('xhandle.projectData',JSON.stringify({'profile-project':{riskMethod:'STPA-Textbook',responseRows:[row],hazardOperationalContexts:[{id:'crossing',scenario:'Occupied pedestrian crossing',mode:'Automated urban driving',conditions:'Wet pavement; frequent crossings; no human driver.',assumptions:'Recorded timing bound 100 ms.'}]},'profile-code':{organizationProfile:{mode:'inherit',overrideMarkdown:'PROJECT-PROFILE-MARKER: crossing frequency records govern.'}}}));
    localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'profile-code',name:'Profile Code fixture',activeRepoId:'brakes',repos:[{id:'brakes',repoId:'brakes',repoName:'brakes'}]}]));
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle',4);r.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('copilot_baseline','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.objectStore('copilot_baseline').put({key:'cba:profile-code:brakes',value:[row]});});db.close();
  });
  for(const method of ['STPA-Textbook','HARA']){
    await profile(false);await projectRun(method,{single:true});
    if(method==='HARA'){
      const severity=page.getByRole('textbox',{name:'Severity, row 1',exact:true});await severity.fill('S1');await severity.press('Tab');
      await waitUntil(async()=>{const head=await projectHead();return head.analysisResult.Summary[1][head.analysisResult.Summary[0].indexOf('Severity')]==='S1';},'Manual assessment did not save.');
    }
    await profile(true);let calibrated=await projectRun(method);
    if(method==='HARA'){
      assert.equal(calibrated.analysisResult.Summary[1][calibrated.analysisResult.Summary[0].indexOf('Severity')],'S1','Reassessment preserves the manual severity decision');
      const identity=Object.values(calibrated.draftHazardRowsByIndex)[0].organizationProfileProvenance.effectiveContextIdentity;
      await profile(true,{override:'PROJECT-PROFILE-MARKER: revised crossing frequency records govern.'});calibrated=await projectRun(method);
      assert.notEqual(Object.values(calibrated.draftHazardRowsByIndex)[0].organizationProfileProvenance.effectiveContextIdentity,identity,'An override content change invalidates generated row reuse');
      check('Profile-change reassessment preserves manual decisions and responds to override content changes');
    }
    await profile(true,{projectDisabled:true});await projectRun(method);
  }
  // Deliberately disable the unrelated Projects profile while leaving the Code
  // project enabled. This detects resolution against the wrong active project.
  for(const method of ['STPA-Textbook','HARA']){
    await profile(true);await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('xhandle.projectData'));data['profile-project'].organizationProfile.mode='disabled';localStorage.setItem('xhandle.projectData',JSON.stringify(data));});
    await codeRun(method);
    await profile(false);await codeRun(method);
  }
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.dialogs,[]);
  check('No renderer errors or failure alerts across profile transitions');
 }catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;if(page){await page.screenshot({path:root+'/failure.png'}).catch(()=>{});fs.writeFileSync(root+'/body.txt',await page.locator('body').innerText().catch(()=>''));}}
 finally{fs.writeFileSync(root+'/result.json',JSON.stringify(result,null,2));console.log('RESULT',root+'/result.json');if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app?.close();}
})();
