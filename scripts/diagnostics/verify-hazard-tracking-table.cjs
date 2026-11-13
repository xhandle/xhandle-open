const fs = require('node:fs');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  const until = async expression => { const deadline = Date.now() + 120000; while (Date.now() < deadline) { if (await run('Boolean(' + expression + ')')) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Timed out: ' + expression + '\n' + await run('document.body.innerText.slice(-3000)')); };
  const click = async label => { const expression = `[...document.querySelectorAll('button')].find(button => (button.textContent.trim() === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)} || button.title === ${JSON.stringify(label)}) && !button.disabled)`; await until(expression); await run(`${expression}.click()`); };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const field = async (label, value) => run(`(() => { const label=[...document.querySelectorAll('.artifact-form label')].find(node => [...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()===${JSON.stringify(label)}); const input=label.querySelector('input,select,textarea'); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const actions = async () => { await until(`document.querySelector('[aria-label="Artifact actions"]')`); await run(`document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]')?.click()`); };
  const snapshot = async filename => { const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(filename,Buffer.from(result.data,'base64')); };
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin==='http://localhost:3000'&&!localStorage.getItem('stream-fixture')){localStorage.setItem('stream-fixture','yes');localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'code-scale',name:'Localization code analysis',repos:[{id:'repo',repoId:'owner/repo'}]}]));localStorage.setItem('xhandle.projects','[]');localStorage.setItem('xhandle:req-projects',JSON.stringify([{id:'f',name:'Safety documents',modules:[]}]));localStorage.setItem('xhandle:req-active-project',JSON.stringify('f'));}window.__hazardProgress=[];const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data.progress?.completed!==undefined)window.__hazardProgress.push(event.data.progress.completed);});}};`});
  await send('Page.navigate',{url:'http://localhost:3000'});await click('Design Management');
  const available=await run(`(()=>{const key=Object.keys(window).find(key=>key.startsWith('webpackChunk'));if(!key)return [];window[key].push([['synthetic-diagnostic-'+Date.now()],{},require=>window.__fixtureRequire=require]);return Object.keys(window.__fixtureRequire.m).filter(key=>key.includes('codeArchitectureHazardStore')||key.includes('artifactRepository'));})()`);
  assert(available.some(key=>key.includes('codeArchitectureHazardStore')),'Development runtime modules were not available for the disposable fixture');
  const seed=await run(`(async()=>{const modules=Object.keys(window.__fixtureRequire.m);const store=window.__fixtureRequire(modules.find(key=>key.endsWith('/codeArchitectureHazardStore.js')));const columns=['Function','Operational Scenario','Operational Mode','Operating Conditions','Guide Phrase','Guide Phrase Applicable','Unsafe Control Action','Loss','Hazard','Causal Scenario','Safety Constraint','Verification','Safety Classification'];const excluded='Excluded internal diagnostic evidence. '.repeat(40);const rows=Array.from({length:26278},(_,index)=>['CODE-'+index,'Function '+index,'Urban','Driving','Wet road','Not provided',index%2?'No':'Yes','Command omitted','Collision','Hazard '+Math.floor(index/4),'Dropped exchange','Retain safe commands.','Fault injection','Safety — Direct',excluded]);const started=performance.now();await store.saveCodeArchitectureHazardRun({id:'code-scale-run',projectId:'code-scale',repoId:'owner/repo',runState:'complete',hazardMethod:'STPA',generatedSheets:{Summary:[['Raw Analysis Row ID',...columns,'Internal diagnostic evidence'],...rows]},architectureRowsSnapshot:['Unrelated repository snapshot. '.repeat(100000)]});return {rows:rows.length,seedMs:Math.round(performance.now()-started)};})()`);
  console.log(JSON.stringify(seed));
  await click('Generate engineering artifact');await field('Document type','hazard-tracking-list');await field('Owning project','code-architecture:code-scale');await field('Destination folder','f');await field('System','Localization');
  await until(`![...document.querySelectorAll('button')].find(button=>button.textContent==='Create draft').disabled`);
  let started=Date.now();await click('Create draft');await until(`document.querySelector('.artifact-header')?.innerText.includes('Hazard Tracking List')`);await actions();console.log('Create draft ms: '+(Date.now()-started));
  await run(`(async()=>{const key=Object.keys(window.__fixtureRequire.m).find(key=>key.endsWith('/artifacts/artifactRepository.js'));const store=window.__fixtureRequire(key);const meta=(await store.listArtifacts())[0];await store.updateFreshness(meta.id,meta.sourceHash,'unavailable','Previous source check timed out.');})()`);
  started=Date.now();await actions();await click('Generate / resume draft');await until(`document.body.innerText.includes('Proposal ready for review')`);console.log('Generate ms: '+(Date.now()-started));
  await actions();await click('Review proposal');started=Date.now();await actions();await click('Accept proposal');await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);console.log('Accept ms: '+(Date.now()-started));
  await until(`document.body.innerText.includes('6570 hazard entries from 26278 assessment rows')`);
  assert.equal(await run(`document.querySelectorAll('.design-view-tools').length`),0);
  assert.equal(await run(`document.querySelector('[aria-label=\"Hazard tracking assessments\"] th').textContent`),'HTR');
  assert.equal(await run(`[...document.querySelectorAll('button')].filter(button=>['Outline view','Table view','Document view','Traceability view'].includes(button.title)).length`),0);
  await until(`document.body.innerText.includes('Rows 1–100 of 6570')`);assert(await run(`document.querySelector('.artifact-header').innerText.includes('Sources current')`));
  await run(`(()=>{const input=document.querySelector('[aria-label="Hazard tracking page"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'66');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`document.body.innerText.includes('Rows 6501–6570 of 6570')`);
  assert.equal(await run(`document.querySelectorAll('[aria-label="Hazard tracking assessments"] tbody tr').length`),70);
  assert(await run(`document.querySelector('[aria-label="Hazard tracking assessments"]').innerText.includes('Hazard 6569')`));
  assert(await run(`window.__hazardProgress.includes(26278)`));
  await run(`document.querySelector('[aria-label="Expand Hazard 6569 (2 assessments)"]').click()`);
  await until(`document.querySelectorAll('[data-hazard-group="hazard:hazard 6569"] ~ [data-artifact-object-id]').length===2`);
  assert(await run(`document.querySelector('[aria-label="Hazard tracking assessments"]').innerText.includes('Function 26277')`));
  const exports = await run(`(async()=>{
    const key=Object.keys(window.__fixtureRequire.m).find(key=>key.endsWith('/artifacts/hazardTrackingExport.js'));
    const exporter=window.__fixtureRequire(key);
    const meta={title:'HTL export fixture'}, revision={number:1,objects:[
      {id:'one',hazardTrackingRow:true,attributes:{Hazard:'Lost command',Function:'Brake'}},
      {id:'two',hazardTrackingRow:true,attributes:{Hazard:'Lost command',Function:'Steer'}},
      {id:'three',hazardTrackingRow:true,attributes:{Hazard:'Late command',Function:'Brake'}}
    ]};
    const word=await exporter.hazardTrackingWord(meta,revision), pdf=await exporter.hazardTrackingPDF(meta,revision);
    return {word:Array.from(new Uint8Array(await word.arrayBuffer())),pdf:Array.from(new Uint8Array(await pdf.arrayBuffer())),markdown:exporter.hazardTrackingMarkdown(meta,revision),csv:exporter.hazardTrackingCSV(revision.objects)};
  })()`);
  const { unzipSync, strFromU8 } = require('fflate');
  const xml = strFromU8(unzipSync(Uint8Array.from(exports.word))['word/document.xml']);
  assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);
  assert.equal((xml.match(/<w:tr>/g)||[]).length,3);
  assert.equal((xml.match(/<w:tc>/g)||[]).length,42);
  assert.equal(xml.match(/<w:tr>([\s\S]*?)<\/w:tr>/)[1].match(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/)[1],'HTR');
  assert.equal(new Set(xml.match(/HTR-\d+/g)).size,2);
  for(const value of ['Lost command','Late command','Brake','Steer']) assert(xml.includes(value));
  assert(Buffer.from(exports.pdf).toString('latin1').startsWith('%PDF-'));
  assert(Buffer.from(exports.pdf).toString('latin1').includes('HTR-'));
  assert(exports.markdown.includes('| HTR | Hazard | Function | Operational Scenario |'));
  assert(exports.csv.includes('"Brake\n\nSteer"'));
  assert(exports.csv.startsWith('\uFEFF"HTR","Hazard","Function"'));
  console.log('PASS consolidated Word, PDF, Markdown and CSV table exports; Word contains one table with 14 columns and 2 hazard rows.');
  if(process.env.SCREENSHOT_PATH) await snapshot(process.env.SCREENSHOT_PATH);
  console.log('PASS browser: 26,278 chunked code assessments generated and accepted as 6,570 consolidated hazards; table only; last hazard expands to the final original assessments; freshness and worker progress recovered.');
  // Exercise semantic generation through the actual UI and request client. The
  // provider reply is intercepted locally; no AI service receives fixture data.
  let semanticCalls = 0, badReferenceCalls = 0, pairCalls = 0, referenceMode = 'duplicates';
  ws.on('message', async bytes => {
    const event = JSON.parse(bytes);
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = event.params;
    const headers = [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Access-Control-Allow-Origin', value: 'http://localhost:3000' },
      { name: 'Access-Control-Allow-Credentials', value: 'true' },
      { name: 'Access-Control-Allow-Methods', value: 'POST,OPTIONS' },
      { name: 'Access-Control-Allow-Headers', value: request.headers['Access-Control-Request-Headers'] || '*' },
    ];
    let body = '';
    if (request.method === 'POST') {
      const payload = JSON.parse(request.postData);
      assert.equal(payload.xhandleWorkflow, 'hazard-description-consolidation');
      const input = JSON.parse(payload.messages[1].content);
      assert.deepEqual(input.allowedIds,input.records.map((record,index)=>'D'+(index+1)));
      let content;
      if(referenceMode === 'duplicates') {
        assert.equal(input.records.length,3);
        semanticCalls++;
        if(semanticCalls === 2) assert(payload.messages.at(-1).content.includes('Regenerate the complete result'));
        content = semanticCalls === 1 ? '{"groups":[["D1","D2"]]' : 'Equivalent events:\n```json\n' + JSON.stringify({groups:[['D1','D2','D1'],['D1','D2'],['D3']]}) + '\n```\nOther events remain separate.';
      } else if(input.records.length > 2) {
        badReferenceCalls++;
        content = JSON.stringify({groups:[['D1','D404']]});
      } else {
        pairCalls++;
        assert(payload.messages[0].content.includes('Do not return IDs or groups'));
        content = JSON.stringify({equivalent:input.records.every(record=>!record.hazard.includes('continues after release'))});
      }
      body = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] });
    }
    await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(body).toString('base64') });
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api/chat', requestStage: 'Request' }] });
  await run(`(async()=>{const modules=Object.keys(window.__fixtureRequire.m);const store=window.__fixtureRequire(modules.find(key=>key.endsWith('/codeArchitectureHazardStore.js')));await store.saveCodeArchitectureHazardRun({id:'code-scale-run',projectId:'code-scale',repoId:'owner/repo',runState:'complete',hazardMethod:'STPA',generatedSheets:{Summary:[['Raw Analysis Row ID','Function','Hazard','Loss','Safety Constraint'],['S-1','Brake controller','Brake command is not delivered','Collision','Retain valid brake commands.'],['S-2','Brake controller','Braking request fails to reach the controller','Collision','Acknowledge command delivery.'],['S-3','Brake controller','Braking continues after release is commanded','Collision','Release braking when commanded.']]}});})()`);
  await click('Generate engineering artifact');await field('Document type','hazard-tracking-list');await field('Title','Semantic HTL fixture');await field('Owning project','code-architecture:code-scale');await field('Destination folder','f');await field('System','Localization');
  await until(`![...document.querySelectorAll('button')].find(button=>button.textContent==='Create draft').disabled`);
  await click('Create draft');await until(`document.querySelector('.artifact-header')?.innerText.includes('Semantic HTL fixture')`);
  await actions();await click('Generate / resume draft');await until(`document.body.innerText.includes('Proposal ready for review')`);
  await actions();await click('Review proposal');await actions();await click('Accept proposal');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  await until(`document.body.innerText.includes('2 hazard entries from 3 assessment rows')`);
  assert.equal(semanticCalls,2);
  await click('Expand Brake command is not delivered (2 assessments)');
  assert(await run(`document.querySelector('[aria-label=\"Hazard tracking assessments\"]').innerText.includes('Braking request fails to reach the controller')`));
  const saved = await run(`(async()=>{const key=Object.keys(window.__fixtureRequire.m).find(key=>key.endsWith('/artifacts/artifactRepository.js'));const repo=window.__fixtureRequire(key);const meta=(await repo.listArtifacts()).find(meta=>meta.title==='Semantic HTL fixture');const data=await repo.loadArtifact(meta.id);return data.revision.objects.filter(object=>object.hazardTrackingRow).map(object=>({hazard:object.attributes.Hazard,group:object.hazardEquivalence?.groupId,source:object.sourceEvidence[0].sourceRowId}));})()`);
  assert.equal(saved.length,3);assert.equal(saved[0].group,saved[1].group);assert.equal(saved[2].group,undefined);
  assert.deepEqual(saved.map(row=>row.source),['S-1','S-2','S-3']);
  referenceMode = 'unknown';
  await click('Generate engineering artifact');await field('Document type','hazard-tracking-list');await field('Title','Reference fallback HTL');await field('Owning project','code-architecture:code-scale');await field('Destination folder','f');await field('System','Localization');
  await until(`![...document.querySelectorAll('button')].find(button=>button.textContent==='Create draft').disabled`);
  await click('Create draft');await until(`document.querySelector('.artifact-header')?.innerText.includes('Reference fallback HTL')`);
  await actions();await click('Generate / resume draft');await until(`document.body.innerText.includes('Proposal ready for review')`);
  assert.equal(badReferenceCalls,2); assert.equal(pairCalls,2);
  await actions();await click('Review proposal');await actions();await click('Accept proposal');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  await until(`document.body.innerText.includes('2 hazard entries from 3 assessment rows')`);
  console.log('PASS reference recovery UI: repeated unknown IDs reduce to two-description boolean comparisons; duplicates/overlaps normalize safely; all source rows remain available.');
  await send('Fetch.disable');
  console.log('PASS semantic UI: malformed output automatically retries with a correction; a complete JSON result wrapped in prose is accepted; paraphrased descriptions consolidate; the opposite event remains separate; all original source rows persist after acceptance.');
  ws.close();
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
