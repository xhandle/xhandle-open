const fs = require('node:fs');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assessmentCount = Number(process.env.HTL_ASSESSMENT_COUNT || 3482);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-htl-table-'));
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let chrome, browserSocket;
// Requires the development app on localhost:3000. Seeds synthetic data only in
// its own temporary Chrome profile; never opens the user's browser profile.
(async () => {
  await fetch('http://localhost:3000');
  assert(fs.existsSync(chromePath), 'Set CHROME_BIN to your Chrome executable');
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  const activePort = path.join(profile, 'DevToolsActivePort'), deadline = Date.now() + 45000;
  while (!fs.existsSync(activePort)) { assert(Date.now() < deadline, 'Chrome did not start'); await new Promise(resolve => setTimeout(resolve, 100)); }
  const port = fs.readFileSync(activePort, 'utf8').split('\n')[0];
  browserSocket = (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()).webSocketDebuggerUrl;
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.on('open', resolve));
  let sequence = 0; const pending = new Map();
  ws.on('message', bytes => { const message = JSON.parse(bytes); if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const run = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const until = async expression => { const deadline = Date.now() + Number(process.env.TEST_STAGE_TIMEOUT || 120000); while (Date.now() < deadline) { if (await run('Boolean(' + expression + ')')) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Timed out: ' + expression + '\n' + await run('document.body.innerText.slice(-3000)')); };
  const click = async label => { const expression = `[...document.querySelectorAll('button')].find(button => (button.textContent.trim() === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.title === ${JSON.stringify(label)}) && !button.disabled)`; await until(expression); await run(`${expression}.click()`); };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const field = async (label, value) => run(`(() => { const label=[...document.querySelectorAll('.artifact-form label')].find(node => [...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()===${JSON.stringify(label)}); const input=label.querySelector('input,select,textarea'); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const actions = async () => { await until(`document.querySelector('[aria-label="Artifact actions"]')`); await run(`document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]')?.click()`); };
  const snapshot = async filename => { const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(filename,Buffer.from(result.data,'base64')); };
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin==='http://localhost:3000'&&!localStorage.getItem('actionable-fixture')){localStorage.setItem('actionable-fixture','yes');localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'code-scale',name:'Localization code analysis',repos:[{id:'repo',repoId:'owner/repo'}]}]));localStorage.setItem('xhandle.projects','[]');localStorage.setItem('xhandle:req-projects',JSON.stringify([{id:'f',name:'Safety documents',modules:[]},{id:'other',name:'Other design folder',modules:[{id:'m',name:'Hidden module'}]}]));localStorage.setItem('xhandle:req-active-project',JSON.stringify('f'));localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'hidden-r',folderId:'other',moduleId:'m',module:'Hidden module',title:'Buried requirement marker',attributes:{Verification:'Offscreen requirement test'},links:[]}]));}`});
  await send('Page.navigate',{url:'http://localhost:3000'});await click('Design Management');
  await run(`(()=>{const key=Object.keys(window).find(key=>key.startsWith('webpackChunk'));window[key].push([['actionable-diagnostic-'+Date.now()],{},require=>window.__fixtureRequire=require]);})()`);
  const seed=await run(`(async()=>{const modules=Object.keys(window.__fixtureRequire.m);const store=window.__fixtureRequire(modules.find(key=>key.endsWith('/codeArchitectureHazardStore.js')));const rows=Array.from({length:${assessmentCount + 3}},(_,index)=>['ROW-'+index,'Function '+index%35,'Distinct unsafe event '+index,'Scenario '+index%8,index%2?'Parking':'Driving',index>=${assessmentCount}?'No':'Yes','Safety — Direct','Constraint '+index+(index%35===0?' '+('Retain valid control commands under documented conditions. '.repeat(40)):''),index===${assessmentCount - 1}?'Unique evidence marker':'Test '+index+(index%35===0?' '+('Recorded verification acceptance criteria. '.repeat(80)):'')]);await store.saveCodeArchitectureHazardRun({id:'code-scale-run',projectId:'code-scale',repoId:'owner/repo',runState:'complete',hazardMethod:'STPA',generatedSheets:{Summary:[['Raw Analysis Row ID','Function','Hazard','Operational Scenario','Operational Mode','Guide Phrase Applicable','Safety Classification','Safety Constraint','Verification'],...rows]}});return rows.length;})()`);
  let comparisons=0, partialSent=false, badReferences=0, fixedRepairs=0, requirementsRequests=0, largerReviews=0, writingRepairs=0;const oversizedSections=new Set();
  ws.on('message', async bytes=>{const event=JSON.parse(bytes);if(event.method!=='Fetch.requestPaused')return;const {requestId,request}=event.params;let body='';if(request.method==='POST'){
    const input=JSON.parse(request.postData);
    if (input.xhandleWorkflow === 'design-artifact-generation') {
      const draft = JSON.parse(input.messages[1].content);
      assert.equal(draft.document.type, 'Safety Requirements');
      assert(draft.contentGuidance.includes('Consolidate repeated constraints'));
      assert(draft.contentGuidance.includes('INCOSE Guide to Writing Requirements'));
      assert(draft.contentGuidance.includes('ONE complete, grammatically correct, standalone sentence'));
      assert(draft.sources.every(source=>['hazard-tracking-record','evidence-brief'].includes(source.sourceType)));
      for(const source of draft.sources.filter(source=>source.sourceType==='hazard-tracking-record'&&!source.content)){assert(Object.keys(source.attributes).every(field=>['HTR','Safety Constraint'].includes(field)));}
      assert(!JSON.stringify(draft.sources).includes('Recorded verification acceptance criteria.'));
      requirementsRequests++;
      const content = {objects:[{key:'reject-invalid-output',kind:draft.section.id==='s2'?'requirement':'narrative',title:'Reject invalid control output',text:'The controller shall reject invalid control output under the recorded operating conditions.',sourceIds:draft.sources.map(source=>source.id)}]};
      if(draft.task==='section-consolidation'&&draft.section.id==='s2'){content.objects=draft.sources.map((source,index)=>({key:'retained-'+index,kind:'requirement',title:source.title,text:source.text,sourceIds:[source.id]}));}
      if(draft.task==='section-consolidation'&&draft.section.id==='s2'&&!writingRepairs){if(draft.writingCorrection){assert(draft.writingCorrection.instruction.includes('standalone sentence'));writingRepairs++;}else content.objects[0].text='otherwise a result shall be flagged after that limit.';}
      if(draft.task==='draft'&&!draft.part&&!oversizedSections.has(draft.section.id)){oversizedSections.add(draft.section.id);content.objects=Array.from({length:61},(_,index)=>({...content.objects[0],key:'draft-candidate-'+index,title:'Candidate statement '+index,text:content.objects[0].text+' Recorded fixture condition '+index+'.'}));}
      if(draft.task==='evidence-review' && largerReviews<2){const count=largerReviews++===0?13:61;content.objects=Array.from({length:count},(_,index)=>({...content.objects[0],key:'review-fact-'+index,title:'Supported review fact '+index}));}
      body=JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
    } else {
    assert.equal(input.xhandleWorkflow,'safety-issue-consolidation');
    assert(input.messages[1].content.includes('same control strategy, requirement set, design change, or verification campaign'));
    const evidence=JSON.parse(input.messages[1].content.split('Safety hazard evidence, grouped only to reduce transport size (the grouping does not decide issue boundaries):\n')[1].split('\n\nReturn strict JSON')[0]);
    const issues=evidence.map(family=>{const cells=family.rows[0].cells;const fn=cells['Function (From)']||cells['Safety Issue Title'];return {title:cells['Safety Issue Title']||'Invalid output from '+fn,description:cells['Engineering Concern']||fn+' may produce an unsafe result under the recorded operating conditions. The linked hazard evidence requires a coherent engineering response.',sourceFamilyIds:[family.familyId],likelihood:3,severity:3};});
    const compact = evidence.every(family=>family.rows[0].cells['Safety Issue Title']);
    const fixed = input.messages.some(message=>message.content.includes('Do not return IDs, sourceFamilyIds'));
    let content = {issues};
    if (fixed) { fixedRepairs++; content={title:issues[0].title,description:issues[0].description}; }
    else if(compact && !partialSent && evidence.length>2) { partialSent=true; content={issues:issues.slice(0,-2)}; }
    else if(compact && partialSent && evidence.length<=2 && badReferences<6) { badReferences++; content={issues:issues.map(issue=>({...issue,sourceFamilyIds:['family-999']}))}; }
    else if(comparisons===0) { content.issues[0].title=content.issues[0].title.replace('output from','output\nfrom'); content.issues[0].description+=' The recorded operating variations must remain traceable to the source assessments.'.repeat(9); }
    comparisons++;body=JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
    }
  }await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'http://localhost:3000'},{name:'Access-Control-Allow-Credentials',value:'true'},{name:'Access-Control-Allow-Methods',value:'POST,OPTIONS'},{name:'Access-Control-Allow-Headers',value:request.headers['Access-Control-Request-Headers']||'*'}],body:Buffer.from(body).toString('base64')});});
  await send('Fetch.enable',{patterns:[{urlPattern:'*api/chat',requestStage:'Request'}]});
  await click('Generate engineering artifact');await field('Document type','hazard-tracking-list');await field('Owning project','code-architecture:code-scale');await field('Destination folder','f');await field('System','Localization');
  await until(`![...document.querySelectorAll('button')].find(button=>button.textContent==='Create draft').disabled`);await click('Create draft');await until(`document.querySelector('.artifact-header')?.innerText.includes('Hazard Tracking List')`);
  await actions();await click('Generate / resume draft');await until(`document.body.innerText.includes('Proposal ready for review')`);await actions();await click('Review proposal');await actions();await click('Accept proposal');await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  await until(`document.body.innerText.includes('35 hazard entries from ${assessmentCount} assessment rows')`);
  assert.equal(seed,assessmentCount + 3);assert(comparisons>1);assert(partialSent);assert(badReferences>=4);assert(fixedRepairs>=1);
  assert.equal(await run(`document.querySelectorAll('[aria-label="Hazard tracking assessments"] th').length`),16);
  assert.deepEqual(await run(`[...document.querySelectorAll('[aria-label="Hazard tracking assessments"] th button span:first-child')].slice(0,4).map(node=>node.textContent)`),['HTR','Actionable Safety Issue Title','Actionable Safety Issue Description','Hazard']);
  assert(await run(`document.querySelector('[data-hazard-group] td:nth-child(2)').innerText.includes('Invalid output from Function 0')`));
  assert(await run(`document.querySelector('[data-hazard-group] td:nth-child(4)').innerText.includes('Distinct unsafe event 0')`));
  const saved=await run(`(async()=>{const m=Object.keys(window.__fixtureRequire.m);const repo=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactRepository.js')));const data=await repo.loadArtifact((await repo.listArtifacts())[0].id);const rows=data.revision.objects.filter(object=>object.hazardTrackingRow);return {rows:rows.length,excluded:rows.filter(row=>row.hazardFamily.excluded).length,ids:[...new Set(rows.filter(row=>!row.hazardFamily.excluded).map(row=>row.hazardTrackingRecordNumber))].sort((a,b)=>a-b)};})()`);
  assert.equal(saved.rows,assessmentCount + 3);assert.equal(saved.excluded,3);assert.deepEqual(saved.ids,Array.from({length:35},(_,i)=>i+1));
  await click('Filter Function');await click('Deselect all');
  await run(`(()=>{const popup=document.querySelector('[aria-label="Filter Function values"]');for(const value of ['Function 33','Function 34'])[...popup.querySelectorAll('label')].find(label=>label.textContent===value).querySelector('input').click();})()`);
  await until(`document.body.innerText.includes('Rows 1–2 of 2')`);
  await run(`(()=>{const popup=document.querySelector('[aria-label="Filter Function values"]');[...popup.querySelectorAll('label')].find(label=>label.textContent==='Function 33').querySelector('input').click();})()`);
  await click('Done');
  await run(`(()=>{const edge=document.querySelector('[aria-label="Resize Hazard column"]');edge.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:300}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:460}));window.dispatchEvent(new MouseEvent('mouseup'));})()`);
  await until(`document.body.innerText.includes('Rows 1–1 of 1')`);
  assert.equal(await run(`document.querySelector('[aria-label="Resize Hazard column"]').getAttribute('aria-valuenow')`),'460');
  const search=async query=>{await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',metaKey:true,bubbles:true,cancelable:true}))`);await until(`document.querySelector('[role="combobox"]')`);await run(`(()=>{const input=document.querySelector('[role="combobox"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until(`document.querySelector('[role="option"]')`);await run(`document.querySelector('[role="option"]').click()`);};
  await search('Unique evidence marker');
  await until(`[...document.querySelectorAll('[data-artifact-object-id]')].some(node=>node.innerText.includes('Unique evidence marker')&&node.classList.contains('xhandle-search-hit'))`);
  assert(await run(`document.body.innerText.includes('35 hazard entries from ${assessmentCount} assessment rows')`));
  await search('Buried requirement marker');await until(`document.querySelector('[data-artifact-object-id="hidden-r"]')?.classList.contains('xhandle-search-hit')`);
  await search('Safety documents');await until(`document.querySelector('[aria-label="Folder contents"]')?.innerText.includes('Hazard Tracking List')`);
  await click('Open Hazard Tracking List');await until(`document.querySelector('[aria-label="Resize Hazard column"]')?.getAttribute('aria-valuenow')==='460'`);
  await click('Review other assessments');await until(`document.body.innerText.includes('Other assessments are retained for review without HTRs.')`);assert.equal(await run(`document.querySelectorAll('[aria-label="Hazard tracking assessments"] tbody tr').length`),3);
  await click('Generate engineering artifact');await field('Document type','safety-requirements');await field('Owning project','code-architecture:code-scale');await field('Destination folder','f');await field('System','Localization');
  await until(`document.querySelector('[aria-label="Consolidated hazard sources"]')?.innerText.includes('35 consolidated HTRs available')`);
  await until(`![...document.querySelectorAll('button')].find(button=>button.textContent==='Create draft').disabled`);await click('Create draft');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Safety Requirements')`);
  await run(`(async()=>{const m=Object.keys(window.__fixtureRequire.m);const repo=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactRepository.js')));const meta=(await repo.listArtifacts()).find(meta=>meta.templateId==='safety-requirements');const data=await repo.loadArtifact(meta.id);const candidates=Array.from({length:75},(_,index)=>({key:'saved-'+index,kind:'requirement',title:'Recorded protective condition '+index,text:'The controller shall preserve recorded fixture condition '+index+'.',sourceIds:[data.job.sources.entries[index%35].id]}));await repo.checkpointJob(meta.id,data.job,{sectionSynthesis:{s2:{version:1,sourceHash:data.job.sources.hash,candidates,round:8,completed:{}}},state:'paused',error:'Safety requirements: The AI has not produced a concise synthesis after eight saved consolidation passes. All candidate statements are retained.'});})()`);

  await actions();await click('Generate / resume draft');await until(`document.body.innerText.includes('Proposal ready for review')`);
  const requestsBeforeSizeRecovery=requirementsRequests;
  const oversizedContent=await run(`(async()=>{const m=Object.keys(window.__fixtureRequire.m);const repo=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactRepository.js')));const sizes=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactSize.js')));const meta=(await repo.listArtifacts()).find(meta=>meta.templateId==='safety-requirements');const data=await repo.loadArtifact(meta.id);const evidence=data.job.sources.entries;const verification=[...new Set(evidence.flatMap(source=>source.attributes.Verification||[]))].join(String.fromCharCode(10));const sections=Object.fromEntries(Object.entries(data.job.sections).map(([key,objects])=>[key,objects.map(object=>{if(object.kind!=='requirement')return object;const {verificationSourceIds,...saved}=object;return {...saved,sourceIds:evidence.map(source=>source.id),sourceEvidence:evidence,attributes:{...object.attributes,HTR:evidence.map(source=>source.recordId).join(', '),Verification:verification}};})]));const content=sizes.artifactDocumentSize(Object.values(sections).flat()).content;await repo.checkpointJob(meta.id,data.job,{sections,state:'paused',error:'Safety Requirements contains 21.8 million characters of document content, above the saved-document limit of 20.0 million characters. Saved sections are retained.'});return content;})()`);
  assert(oversizedContent>20000000);
  await actions();await click('Generate / resume draft');await until(`document.body.innerText.includes('Proposal ready for review')`);assert.equal(requirementsRequests,requestsBeforeSizeRecovery);
  await actions();await click('Review proposal');await actions();await click('Accept proposal');await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  const safety=await run(`(async()=>{const m=Object.keys(window.__fixtureRequire.m);const repo=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactRepository.js')));const meta=(await repo.listArtifacts()).find(meta=>meta.templateId==='safety-requirements');const data=await repo.loadArtifact(meta.id);return {sources:data.revision.sources.entries.map(source=>({type:source.sourceType,recordId:source.recordId})),requirements:data.revision.objects.filter(object=>object.kind==='requirement').map(object=>({text:object.text,htrs:object.attributes.HTR,verification:object.attributes.Verification}))};})()`);
  assert.equal(safety.sources.length,35);assert(safety.sources.every(source=>source.type==='hazard-tracking-record'));assert.equal(safety.requirements.length,75);assert(safety.requirements.every(requirement=>requirement.verification.length<2000));assert.equal(new Set(safety.requirements.flatMap(requirement=>requirement.htrs.split(', '))).size,35);assert.equal(new Set(safety.requirements.map(requirement=>requirement.text)).size,75);assert(requirementsRequests>=6);assert.equal(largerReviews,2);assert.equal(oversizedSections.size,5);assert.equal(writingRepairs,1);
  const atomic=await run(`(async()=>{const m=Object.keys(window.__fixtureRequire.m);const repo=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactRepository.js')));const meta=(await repo.listArtifacts()).find(meta=>meta.templateId==='safety-requirements');const data=await repo.loadArtifact(meta.id);const topic=data.revision.objects.find(object=>object.kind==='requirement');const revision=await repo.saveObjects(meta.id,data.meta.revision,data.revision.objects.map(object=>object.id===topic.id?{...object,title:'Marker readiness',text:'The controller shall build the marker array only when the input is valid and the sample age is less than 20 ms; otherwise no marker shall be built, and a no-marker status shall be published.'}:object));return {id:meta.id,topic:topic.id,children:revision.objects.filter(object=>object.parentId===topic.id).map(object=>({id:object.id,text:object.text,htrs:object.attributes.HTR}))};})()`);
  assert.equal(atomic.children.length,3);assert(atomic.children.every(child=>child.htrs===safety.requirements[0].htrs));
  assert.equal(atomic.children[1].text,'If NOT (the input is valid and the sample age is less than 20 ms), the controller shall not build a marker.');
  assert.equal(atomic.children[2].text,'If NOT (the input is valid and the sample age is less than 20 ms), the controller shall publish a no-marker status.');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 2')`);await click('Table view');
  await until(`document.querySelector('[data-artifact-object-id="${atomic.children[1].id}"]')`);
  assert((await run(`document.querySelector('[data-artifact-object-id="${atomic.topic}"]').innerText`)).includes('Marker readiness'));
  assert(!(await run(`document.querySelector('[data-artifact-object-id="${atomic.children[1].id}"]').children[1].innerText`)).includes('shall'));
  await run(`document.querySelector('[data-artifact-object-id="${atomic.children[1].id}"] [data-object-field="Description"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  await until(`document.querySelector('[aria-label="Edit artifact object"]')`);await field('Content','If NOT (the input is valid and the sample age is less than 20 ms), the controller shall prohibit marker construction.');await click('Save object');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 3')`);
  const edited=await run(`(async()=>{const m=Object.keys(window.__fixtureRequire.m);const repo=window.__fixtureRequire(m.find(key=>key.endsWith('/artifacts/artifactRepository.js')));const data=await repo.loadArtifact('${atomic.id}');return data.revision.objects.filter(object=>object.parentId==='${atomic.topic}').map(object=>({id:object.id,text:object.text}));})()`);
  assert.equal(edited.length,3);assert.equal(edited[0].text,atomic.children[0].text);assert.equal(edited[1].text,'If NOT (the input is valid and the sample age is less than 20 ms), the controller shall prohibit marker construction.');assert.equal(edited[2].text,atomic.children[2].text);
  console.log('PASS native browser: complete standalone child requirements retain the explicit alternative condition and HTR evidence; redundant titles stay blank; double-click editing saves only the selected child.');
  await click('SysML v2 Modeler');
  await until(`document.body.innerText.includes('Active model:')`);
  await run(`(()=>{const m=Object.keys(window.__fixtureRequire.m);const store=window.__fixtureRequire(m.find(key=>key.endsWith('/SysMLV2Modeler/sysmlV2Store.js')));const model=store.loadSysMLV2Model(null,null);store.addSysMLElement(model.id,{type:'PartDefinition',name:'NeedleSearchSysML',description:'Deep model marker'});})()`);
  await search('NeedleSearchSysML');
  await until(`[...document.querySelectorAll('input')].some(input=>input.value==='NeedleSearchSysML')`);
  console.log(`PASS native browser: consolidated Safety Requirements draft and acceptance cite all 35 HTRs without raw analysis inputs; resumed an oversized legacy metadata draft without any additional AI requests (${requirementsRequests} drafting requests, including 13- and 61-item evidence reviews and recovery of an eight-pass checkpoint retaining 75 distinct requirements, plus consolidation of 61-item responses for the other five sections); ${assessmentCount} distinct hazard variants → 35 HTRs; all ${assessmentCount + 3} source rows retained, including 3 nonapplicable rows; multi-select column dropdowns/resizing/persistence; Projects AI workflow, partial-response recovery and prose-only reference repair; saved semantic issue titles; Cmd+F reveals hidden assessments, requirements in other folders, folder contents and SysML elements.`);
  if(process.env.SCREENSHOT_PATH) await snapshot(process.env.SCREENSHOT_PATH);
  await send('Fetch.disable');ws.close();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if (chrome?.exitCode === null && browserSocket) {
    const socket = new WebSocket(browserSocket);
    await new Promise(resolve => { socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))); socket.on('close', resolve); socket.on('error', resolve); });
  }
  if(chrome?.exitCode === null) await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
  if(chrome?.exitCode === null) chrome.kill();
  // Chrome's helpers may finish writing the disposable profile after the parent
  // exits. Async retries let those processes finish rather than blocking them.
  await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250});
});
