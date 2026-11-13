// Run with Electron after npm run build. All workspace data and AI responses are synthetic.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-design-artifact-ui-'));
app.setPath('userData', profile);
const build = path.resolve(process.env.XHANDLE_AUDIT_BUILD_DIR || path.join(__dirname, '../../build'));
let server, calls = 0, holdNextRequest = false, releaseRequest, adaptiveFixture = false;
const adaptiveChildren = new Set();
const conciseRequests = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/fixture-setup') { res.end('<!doctype html><title>Fixture</title>'); return; }
    if (req.url === '/fixture-chat') {
      let body = ''; req.on('data', data => body += data); req.on('end', async () => {
        if (holdNextRequest) { holdNextRequest = false; await new Promise(resolve => { releaseRequest = resolve; }); }
        calls++; const prompt = JSON.parse(JSON.parse(body).messages[1].content);
        if (prompt.document.title === 'Concise evidence fixture') conciseRequests.push(prompt);
        const upstream = [...new Map(prompt.sources.filter(source => source.sourceType === 'artifact-object' && source.kind !== 'gap').map(source => [source.artifactTitle, source])).values()];
        const briefGap = prompt.document.title === 'Concise evidence fixture' && prompt.task === 'draft' ? prompt.sources.find(source => source.kind === 'gap')?.id : null;
        const citations = briefGap ? [prompt.sources.find(source => source.kind !== 'gap').id, briefGap] : calls === 5 ? ['unrecognized-fixture-source'] : upstream.length ? upstream.map(source => source.id) : [prompt.sources[prompt.sources.length - 1].id];
        assert(prompt.sources.every(source => /^S\d+$/.test(source.id)));
        if (calls === 2) assert(prompt.formatCorrection.includes('must not be empty'));
        if (calls >= 3 && calls <= 6) assert.equal(prompt.part.id, 'core');
        if (calls === 7) assert.equal(prompt.part.id, 'detail');
        if (calls === 5 || calls === 6) {
          assert.equal(JSON.parse(body).max_tokens, 16000);
          assert(prompt.outputGuidance.includes('Regenerate the complete section'));
        }
        if (calls === 6) assert(prompt.correction.includes('unrecognized citation'));
        if (calls <= 2) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"objects":[]}' } }] }));
          return;
        }
        if (calls === 3) { res.writeHead(503, { 'Retry-After': '5' }); res.end('{}'); return; }
        if (calls === 4) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"objects":[' } }] }));
          return;
        }
        if (adaptiveFixture && prompt.document.type === 'Concept of Operations' && prompt.section.id === 's1') {
          if (!prompt.part || prompt.part.id === 'core') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: Array.from({ length: 61 }, (_, i) => ({ key: `overflow-${i}`, kind: 'narrative', title: `Statement ${i}`, text: 'Selected operational evidence.', sourceIds: citations })) }) } }] }));
            return;
          }
          if (prompt.part.id.startsWith('core-')) adaptiveChildren.add(prompt.part.id);
        }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'fixture-object', kind: 'requirement', title: `${prompt.section.title} object`, text: 'The system shall retain operator commands for review.', sourceIds: citations }, { key: 'gap', kind: 'gap', title: 'Open performance budget', text: 'Unresolved: no timing budget was supplied.', sourceIds: [] }] }) } }] }));
      }); return;
    }
    if (req.url.startsWith('/api/')) { res.writeHead(401); res.end('{}'); return; }
    let file = path.join(build, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(build) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(build, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ width: 1500, height: 1050, show: false, webPreferences: { backgroundThrottling: false } });
  const run = async code => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{return await eval(${JSON.stringify(code)})}catch(error){return {diagnosticError:error.stack||String(error)}}})()`).catch(error => { throw new Error(`Renderer evaluation failed: ${code.slice(0, 220)}\n${error.stack || error}`); });
    if (result?.diagnosticError) throw new Error(result.diagnosticError); return result;
  };
  const until = async code => { const deadline = Date.now() + 60000; while (Date.now() < deadline) { try { if (await run(`(async()=>Boolean(await (${code})))()`)) return; } catch (error) { if (!/TypeError: Cannot read properties of (?:null|undefined)/.test(error.message)) throw error; } await wait(50); } throw new Error(`Timed out: ${code}\n${await run('document.body.innerText.slice(-7000)')}`); };
  const click = async text => {
    const title = { Outline: 'Outline view', Table: 'Table view', Trace: 'Traceability view', Document: 'Document view' }[text] || text;
    const match = `(b.textContent.trim()===${JSON.stringify(text)}||b.title===${JSON.stringify(title)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled`;
    const overflowActions = ['Edit details', 'Delete artifact', 'Source diagrams', 'Generate update', 'Generate / resume draft', 'Review proposal', 'Accept proposal', 'Preview saved sections', 'Return to accepted document', 'Open systems engineering project'];
    if (overflowActions.includes(text) || /^Export (?:diagram|current view)/.test(text) || text === 'Restore source layout') {
      await until(`[...document.querySelectorAll('button')].some(b=>${match})||document.querySelector('[aria-label="Artifact actions"]')`);
      await run(`(()=>{if (![...document.querySelectorAll('button')].some(b=>${match})) { const trigger=document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]'); trigger?.click(); }})()`);
    }
    await until(`[...document.querySelectorAll('button')].some(b=>${match})`);
    await run(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)||[...document.querySelectorAll('button')].find(b=>${match})).click()`);
  };
  const drag = async (from, to, position = 'inside') => {
    await run(`(()=>{window.__libraryTransfer=new DataTransfer(); const row=document.querySelector('[data-library-id="'+${JSON.stringify(from)}+'"] > [draggable="true"]');row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:window.__libraryTransfer}));})()`);
    await run(`(()=>{const row=document.querySelector('[data-library-id="'+${JSON.stringify(to)}+'"] > [draggable="true"]'), rect=row.getBoundingClientRect(), clientY=rect.top+rect.height*${position === 'before' ? 0.1 : position === 'after' ? 0.9 : 0.5}; row.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:window.__libraryTransfer,clientY}));row.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:window.__libraryTransfer,clientY}));})()`);
  };
  const checkEditorLayout = async view => {
    await until(`document.querySelector('.requirements-native-views .design-view-scroll')?.querySelector(${JSON.stringify(view === 'Table' ? '.requirements-table-scroll' : view === 'Outline' ? '.requirements-outline-scroll' : view === 'Document' ? '.artifact-document-reader' : ':scope > *')})`);
    const result = await run(`(()=>{const workspace=document.querySelector('.design-management-workspace'), toolbar=document.querySelector('.design-toolbar'), region=document.querySelector('.requirements-native-views .design-view-scroll'); const scroller=${JSON.stringify(view)}==='Table'?region.querySelector('.requirements-table-scroll'):${JSON.stringify(view)}==='Outline'?region.querySelector('.requirements-outline-scroll'):${JSON.stringify(view)}==='Document'?region.querySelector('.artifact-document-reader'):region; const before=toolbar.getBoundingClientRect().top, top=document.scrollingElement.scrollTop; scroller.scrollTop=scroller.scrollHeight; const header=scroller.querySelector('thead'); const result={view:${JSON.stringify(view)},height:scroller.clientHeight,innerScroll:scroller.scrollTop,pageScroll:document.scrollingElement.scrollTop-top,toolbarShift:toolbar.getBoundingClientRect().top-before,workspaceOverflow:workspace.scrollHeight-workspace.clientHeight,bottom:workspace.getBoundingClientRect().bottom,viewport:innerHeight,stickyHeader:header?Math.abs(header.getBoundingClientRect().top-scroller.getBoundingClientRect().top):0};scroller.scrollTop=0;return result;})()`);
    assert(result.height > 180, JSON.stringify(result)); assert.equal(result.pageScroll, 0, JSON.stringify(result)); assert.equal(result.toolbarShift, 0, JSON.stringify(result)); assert(result.workspaceOverflow <= 2 && result.bottom <= result.viewport + 2, JSON.stringify(result));
    if (view === 'Document' || view === 'Table') assert(result.innerScroll > 0, JSON.stringify(result));
    if (view === 'Table') assert(result.stickyHeader < 3, JSON.stringify(result));
  };
  const setField = async (label, value) => run(`(()=>{const label=[...document.querySelectorAll('.artifact-form label')].find(l=>([...l.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim()===${JSON.stringify(label)}||l.textContent.trim()===${JSON.stringify(label)})); const field=label.querySelector('input,select,textarea');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field),'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const intercept = () => run(`window.__originalFetch=window.fetch;window.fetch=(url,options)=>window.__originalFetch(String(url).includes('/api/chat')?'/fixture-chat':url,options);true`);
  const enterDesign = async () => {
    await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Design Management')`); await click('Design Management'); await until(`document.body.innerText.includes('Generate engineering artifact')`);
  };
  await win.loadURL(`http://127.0.0.1:${server.address().port}/fixture-setup`);
  await run(`localStorage.setItem('xhandle.projects',JSON.stringify([{id:'fixture-project',name:'Artifact fixture',functions:[]}]));localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'fixture-controller',name:'Controller fixture',repos:[{id:'fixture-repo',repoId:'fixture/controller',repoName:'fixture/controller',owner:'fixture',repo:'controller'}]}]));localStorage.setItem('xhandle:req-projects',JSON.stringify([{id:'fixture-folder',name:'Root',modules:[{id:'fixture-source',name:'Operational needs',type:'Requirement'}]}]));localStorage.setItem('xhandle:req-active-project',JSON.stringify('fixture-folder'));localStorage.setItem('xhandle:requirements',JSON.stringify(Array.from({length:150},(_,i)=>({id:'source-'+i,title:'Need '+i,folderId:'fixture-folder',projectId:'fixture-folder',moduleId:'fixture-source',module:'Operational needs',attributes:{Description:'Operator need '+i},parentId:null,order:i,links:[]}))));`);
  await run(`localStorage.setItem('xhandle.projectData',JSON.stringify({'fixture-project':{responseRows:[{id:'command',fromFunction:'Operator',toFunction:'Controller',controlAction:'Request command',controlDetails:'Requests execution'},{id:'feedback',fromFunction:'Controller',toFunction:'Operator',controlAction:'Command status'}]}}));`);
  await run(`localStorage.setItem('diagram:positions:fixture-project:groups:v1',JSON.stringify([
    {id:'g:vehicle',label:'Vehicle System',elementType:'system',position:{x:80,y:80},width:1100,height:500,manualMembership:true},
    {id:'g:operations',label:'Operations',parentNode:'g:vehicle',position:{x:40,y:70},width:430,height:350,brandColor:'#22aa66',manualMembership:true},
    {id:'g:control',label:'Control',parentNode:'g:vehicle',position:{x:580,y:70},width:430,height:350,brandColor:'#f59e0b',manualMembership:true}
  ]));localStorage.setItem('diagram:positions:fixture-project',JSON.stringify([
    ['n:Operator',{position:{x:80,y:120},parentId:'g:operations',groupingIntent:'explicit'}],
    ['n:Controller',{position:{x:80,y:120},parentId:'g:control',groupingIntent:'explicit'}]
  ]));localStorage.setItem('diagram:positions:fixture-project:edge-routing:v1',JSON.stringify({defaultStyle:'rectangular',edgeOverrides:{},colors:{}}));window.__sourceDiagramBefore=Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('diagram:positions:fixture-project')).map(k=>[k,localStorage.getItem(k)]));`);
  await run(`(async()=>{const request=indexedDB.open('xhandle',4);request.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};await new Promise((resolve,reject)=>{request.onsuccess=resolve;request.onerror=reject;});const db=request.result,tx=db.transaction('copilot_baseline','readwrite');tx.objectStore('copilot_baseline').put({key:'cba:fixture-controller:fixture-repo',value:[{traceId:'implementation-call',fromNodeId:'symbol:receive',toNodeId:'symbol:retain',fromFunction:'receiveCommand',toFunction:'retainCommand',controlAction:'Retain request',fromFile:'controller.cpp',fromArchitecture:{subsystem:'Control',csci:'Controller',csc:'Command handling',csu:'Command input'},toArchitecture:{subsystem:'Control',csci:'Controller',csc:'Command handling',csu:'Command storage'},architecture:{subsystem:'Control',csci:'Controller',csc:'Command handling'},lineage:{scope:'cba:fixture-controller:fixture-repo'}}]});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject;});db.close();})()`);
  await win.loadURL(`http://127.0.0.1:${server.address().port}`); await intercept(); const sourceDiagramBefore = await run(`Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('diagram:positions:fixture-project')).map(k=>[k,localStorage.getItem(k)]))`); await enterDesign();
  await until(`JSON.parse(localStorage.getItem('xhandle:req-projects')).find(folder=>folder.id==='fixture-folder').name==='Designs'`);
  await run(`window.__nativePrompt=window.prompt;window.prompt=()=> 'Peer folder';true`);
  await click('New folder');
  await run(`window.prompt=window.__nativePrompt;true`);
  assert(await run(`JSON.parse(localStorage.getItem('xhandle:req-projects')).filter(folder=>!folder.parentId).length===2`), await run(`localStorage.getItem('xhandle:req-projects')`));
  await click('Actions for Peer folder');
  await run(`window.prompt=()=> 'Nested folder';true`); await click('Add subfolder'); await run(`window.prompt=window.__nativePrompt;true`);
  await until(`(()=>{const folders=JSON.parse(localStorage.getItem('xhandle:req-projects'));return folders.find(folder=>folder.name==='Nested folder').parentId===folders.find(folder=>folder.name==='Peer folder').id;})()`);
  await click('Generate engineering artifact');
  await setField('Document type', 'system-spec'); await setField('Title', 'Fixture system specification'); await setField('Owning project', 'functional:fixture-project'); await setField('Destination folder', 'fixture-folder'); await setField('System', 'Orbital Operations');
  await run(`[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend')?.textContent==='Source modules').querySelector('input[type=checkbox]').click()`); await click('Create draft');
  holdNextRequest = true;
  await click('Generate / resume draft');
  await click('Operational needs');
  await click('Activities');
  await until(`document.body.innerText.includes('Generate artifact: Fixture system specification')`);
  for (let tries = 0; tries < 200 && !releaseRequest; tries++) await wait(50);
  assert(releaseRequest, 'The first artifact request should be held for activity inspection');
  releaseRequest(); releaseRequest = null;
  await until(`document.body.innerText.toLowerCase().includes('retrying request')`);
  await until(`document.body.innerText.includes('sections saved')`);
  await click('Activities');
  console.log('PASS activity visibility after navigation and automatic retry feedback');
  for (let tries = 0; tries < 400 && calls < 12; tries++) await wait(50);
  assert.equal(calls, 12, 'Generation must continue after leaving its editor');
  await click('Fixture system specification');
  await click('Artifact actions');
  await until(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Review proposal'&&!button.disabled)`);
  // Reproduce a legacy fully checkpointed draft blocked only by the old count cap.
  await run(`(async()=>{const request=indexedDB.open('xhandle-design-artifacts');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const tx=db.transaction(['jobs','metadata'],'readwrite');const query=tx.objectStore('jobs').getAll();const jobs=await new Promise(resolve=>query.onsuccess=()=>resolve(query.result));const job=jobs[0];for(const [sectionId,objects] of Object.entries(job.sections)){const sample=objects.find(object=>object.kind==='requirement');job.sections[sectionId]=[...objects,...Array.from({length:240},(_,i)=>({...sample,id:sample.id+'-volume-'+i,key:'volume-'+i,title:'Large draft row '+sectionId+' '+i}))];}job.state='paused';job.error='The document contains more than 1,000 objects.';job.version++;tx.objectStore('jobs').put(job);const getMeta=tx.objectStore('metadata').get(job.id);const meta=await new Promise(resolve=>getMeta.onsuccess=()=>resolve(getMeta.result));delete meta.draftCheckpoint;meta.draftSummary={state:'paused',completedSections:Object.keys(job.sections).length,partialParts:0};tx.objectStore('metadata').put(meta);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject});db.close();window.dispatchEvent(new Event('xhandle:design-artifacts-changed'));})()`);
  await click('Generate / resume draft'); await click('Review proposal'); await click('Document');
  assert.equal(calls, 12, 'A fully saved large draft must resume without another AI request');
  await until(`document.querySelector('.artifact-paper')?.innerText.includes('Unresolved: no timing budget')`);
  await click('Accept proposal'); await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  for (const view of ['Outline', 'Table', 'Trace', 'Document']) {
    await click(view);
    if (view === 'Table') {
      await until(`document.querySelectorAll('.requirements-native-views tbody tr').length>1400`);
      assert.equal(await run(`document.querySelectorAll('.requirements-native-views tr[data-artifact-object-id$="-volume-239"]').length`), 6);
      assert.equal(await run(`document.querySelector('.requirements-native-views').textContent.includes('Large draft row s6 239')`), false, 'Requirement titles are intentionally blank; their descriptions remain visible');
    }
    if (view === 'Document') await until(`document.querySelectorAll('.artifact-paper .artifact-object').length>1400`);
  }
  console.log('PASS legacy draft above 1,000 objects resumes without AI calls, accepts and renders in original Outline/Table/Trace/Document views');
  await click('Actions for Peer folder');
  await until(`document.querySelector('[aria-label="Folder actions for Peer folder"]').innerText.includes('Generate systems engineering project')`);
  await until(`document.querySelector('[aria-label="Folder actions for Peer folder"]').innerText.includes('Generate engineering artifact')`);
  assert.equal(await run(`document.querySelector('[aria-label="Folder actions for Peer folder"]').innerText.includes('Manage modules')`), false);
  await until(`document.querySelector('.artifact-header').innerText.includes('Fixture system specification')`);
  await click('Actions for Peer folder');
  await click('Actions for Designs');
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-folder-actions.png', (await win.webContents.capturePage()).toPNG());
  await click('Actions for Designs');
  assert.equal(calls, 12);
  assert.equal(await run(`[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Fixture system specification').length`), 1);
  await run(`document.querySelector('.artifact-object-title button').click()`); await setField('Content', 'Manually reviewed operator command design.'); await click('Save object'); await until(`document.querySelector('.artifact-header').innerText.includes('Revision 2')`);
  await click('Generate update'); await click('Review proposal'); await click('Accept proposal'); await until(`document.querySelector('.artifact-header').innerText.includes('Revision 3')`);
  await until(`document.querySelector('.artifact-paper')?.innerText.includes('Manually reviewed operator command design.')`);
  for (const view of ['Outline', 'Table', 'Trace', 'Document']) {
    await click(view);
    await checkEditorLayout(view);
    if (view === 'Table') {
      assert.deepEqual(await run(`[...document.querySelectorAll('.requirements-native-views thead th')].map(th=>th.innerText)`), ['ID', 'TITLE', 'DESCRIPTION', 'KIND', 'STATUS', 'VERSION', 'UPDATED', 'LINKS']);
      await until(`!!document.querySelector('[aria-label="Resize column Title"]')`);
      await until(`document.querySelector('.requirements-native-views th').getBoundingClientRect().width <= 170`);
      await until(`document.querySelectorAll('.requirements-native-views th')[1].getBoundingClientRect().width >= 330`);
    }
    if (view === 'Trace') await until(`document.body.innerText.includes('Traceability Metrics') && document.body.innerText.includes('Refined by')`);
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    fs.writeFileSync(`/tmp/xhandle-restored-${view.toLowerCase()}.png`, (await win.webContents.capturePage()).toPNG());
  }
  win.setSize(1150, 760); await wait(100); await checkEditorLayout('Document');
  await click('Table'); await checkEditorLayout('Table');
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-compact-table.png', (await win.webContents.capturePage()).toPNG());
  await click('Document'); await checkEditorLayout('Document');
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-compact-document.png', (await win.webContents.capturePage()).toPNG());
  win.setSize(1500, 1050); await wait(100);
  await run(`(()=>{const field=document.querySelector('input[aria-label="Baseline name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Review baseline');field.dispatchEvent(new Event('input',{bubbles:true}));})()`); await click('Create baseline'); await until(`document.body.innerText.includes('Review baseline (r3)')`);
  for (const format of ['json', 'docx', 'pdf']) {
    const saved = new Promise((resolve, reject) => win.webContents.session.once('will-download', (_event, item) => { const target = path.join(profile, `export.${format}`); item.setSavePath(target); item.once('done', (_event, state) => state === 'completed' ? resolve(target) : reject(new Error(state))); }));
    await run(`document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]')?.click();void 0`);
    await until(`document.querySelector('select[aria-label="Export artifact"]')`);
    await run(`(()=>{const field=document.querySelector('select[aria-label="Export artifact"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,${JSON.stringify(format)});field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const filename = await Promise.race([saved, wait(30000).then(() => { throw new Error('Export timed out: ' + format); })]); assert(fs.statSync(filename).size > 500);
    if (format === 'json') assert.equal(JSON.parse(fs.readFileSync(filename)).revision.sources.entries.length, 150);
  }
  await click('Reports');
  await run(`(()=>{const rows=JSON.parse(localStorage.getItem('xhandle:requirements'));rows[149].title='Changed need 149';localStorage.setItem('xhandle:requirements',JSON.stringify(rows));window.dispatchEvent(new CustomEvent('xhandle:requirements-data-changed'));})()`);
  await until(`(async()=>{const request=indexedDB.open('xhandle-design-artifacts');await new Promise((resolve,reject)=>{request.onsuccess=resolve;request.onerror=reject});const db=request.result,read=db.transaction('metadata').objectStore('metadata').getAll();const rows=await new Promise((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=reject});db.close();return rows.some(row=>row.freshness==='stale');})()`);
  await enterDesign(); await click('Fixture system specification'); await until(`document.querySelector('.artifact-header')?.innerText.includes('Sources changed')`);
  fs.writeFileSync('/tmp/xhandle-natural-language-artifacts.png', (await win.webContents.capturePage()).toPNG());
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); }); await intercept(); await enterDesign();
  // Generated modules share the existing folder browser and survive a fresh app mount.
  await click('Fixture system specification'); await click('Document'); await until(`document.querySelector('.artifact-paper')?.innerText.includes('Manually reviewed operator command design.')`);
  await until(`document.body.innerText.includes('Review baseline (r3)')`);
  await click('Delete artifact'); await click('Permanently delete artifact'); await until(`![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Fixture system specification')`);
  await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Operational needs')`);
  await click('Generate systems engineering project');
  await setField('Project name', 'Complete fixture project'); await setField('System', 'Orbital Operations');
  await click('Create destination folder'); await setField('Folder name', 'Generated project documents'); await setField('Parent folder', ''); await click('Create folder');
  await until(`[...document.querySelectorAll('.artifact-form select option')].some(option=>option.selected&&option.textContent==='Generated project documents')`);
  for (const index of [0, 1]) await run(`document.querySelectorAll('.artifact-source-picker input')[${index}].click()`);
  await setField('Source notes — Artifact fixture', 'Operators request and review commands.');
  await setField('Source notes — Controller fixture', 'The controller retains operator commands.');
  await run(`[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend')?.textContent==='Source diagrams').querySelector('input[type=checkbox]').click()`);
  await setField('Diagram level — Artifact fixture', '1');
  await click('Select all document types');
  assert.equal(await run(`[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend').textContent==='Artifacts to generate').querySelectorAll('input[type=checkbox]:checked').length`), 9);
  // This architecture fixture has no hazard analysis. Exercise the original
  // seven-document project; safety documents have dedicated source fixtures.
  for (const name of ['Hazard Tracking List', 'Safety Requirements']) await run(`(()=>{const section=[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend').textContent==='Artifacts to generate');[...section.querySelectorAll('label')].find(label=>label.textContent.trim()===${JSON.stringify(name)}).querySelector('input[type=checkbox]').click();})()`);
  assert.equal(await run(`[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend').textContent==='Artifacts to generate').querySelectorAll('input[type=checkbox]:checked').length`), 7);
  await run(`(()=>{for(const label of document.querySelectorAll('.artifact-form label')) { const name=label.firstChild?.textContent; const value=name==='Subsystem'?'Command processing':name==='Endpoint A'?'Controller':name==='Endpoint B'?'Operator console':null; if(value){const field=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));} } })()`);
  await run(`(()=>{const section=[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend').textContent==='Artifacts to generate');document.querySelector('.artifact-form').scrollTop=section.offsetTop-100;})()`);
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-project-checklist.png', (await win.webContents.capturePage()).toPNG());
  await click('Create systems engineering project');
  await click('Collapse project Complete fixture project');
  await until(`!document.querySelector('[data-library-kind="project"] ul')`);
  await click('Collapse folder Generated project documents');
  await until(`document.querySelector('.artifact-header').innerText.includes('Complete fixture project')`);
  await click('Expand folder Generated project documents');
  holdNextRequest = true; adaptiveFixture = true;
  await click('Generate / resume project');
  await until(`document.querySelector('[aria-label="Project generation progress"]')?.innerText.includes('Document 2 of 7')`);
  for (let tries = 0; tries < 200 && !releaseRequest; tries++) await wait(50);
  assert(releaseRequest, 'The first project request should be held for progress inspection');
  await until(`document.querySelector('[aria-label="Project generation progress"]').innerText.includes('Purpose and scope')`);
  await until(`document.querySelector('progress[aria-label="Saved project sections"]').max > 30`);
  await until(`!!document.querySelector('[aria-label="Project content"] tr.bg-indigo-50')`);
  await click('Activities');
  await until(`document.body.innerText.includes('Generate project: Complete fixture project')`);
  fs.writeFileSync('/tmp/xhandle-generation-progress.png', (await win.webContents.capturePage()).toPNG());
  await click('Activities');
  releaseRequest(); releaseRequest = null;
  await click('Review project proposal');
  await until(`document.body.innerText.includes('Belongs to project')`);
  assert.deepEqual([...adaptiveChildren].sort(), ['core-a', 'core-b']);
  await until(`!document.querySelector('[aria-label="Project generation progress"]')`);
  // Generation checkpoints must not reopen a branch the user deliberately collapsed.
  await until(`!document.querySelector('[data-library-kind="project"] ul')`);
  await until(`document.body.innerText.includes('Belongs to project') && document.body.innerText.includes('Uses drafting input')`);
  await click('Accept complete project'); await until(`document.querySelector('.artifact-header')?.innerText.includes('accepted')`);
  await click('Expand all');
  const libraryIds = await run(`(()=>{const folder=JSON.parse(localStorage.getItem('xhandle:req-projects')).find(folder=>folder.name==='Peer folder');const project=document.querySelector('[data-library-kind="project"]');const artifacts=[...project.querySelectorAll('[data-library-kind="artifact"]')];return { folder:folder.id, project:project.dataset.libraryId, first:artifacts[0].dataset.libraryId, last:artifacts[artifacts.length-1].dataset.libraryId };})()`);
  await drag(libraryIds.last, libraryIds.first, 'before');
  await until(`document.querySelector('[data-library-kind="project"] [data-library-kind="artifact"]').dataset.libraryId===${JSON.stringify(libraryIds.last)}`);
  await drag(libraryIds.project, libraryIds.folder);
  await until(`document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.folder)}+'"] [data-library-id="'+${JSON.stringify(libraryIds.project)}+'"]')!==null`);
  const reportSaved = new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{const target=path.join(profile,'project-report.html');item.setSavePath(target);item.once('done',(_event,state)=>state==='completed'?resolve(target):reject(new Error(state)));}));
  await click('Export project and traceability');
  const report = fs.readFileSync(await reportSaved,'utf8');
  assert(report.startsWith('<!doctype html>')); assert(report.includes('Supporting sources and trace records')); assert(!report.includes('&quot;sourceType&quot;'));
  await until(`(()=>{const report=new DOMParser().parseFromString(${JSON.stringify(report)},'text/html');return [...report.querySelectorAll('a[href^="#"]')].every(link=>report.getElementById(link.getAttribute('href').slice(1)));})()`);
  const saved = new Promise((resolve, reject) => win.webContents.session.once('will-download', (_event, item) => { const target = path.join(profile, 'project.json'); item.setSavePath(target); item.once('done', (_event, state) => state === 'completed' ? resolve(target) : reject(new Error(state))); }));
  await click('Download project backup (JSON)');
  const exported = JSON.parse(fs.readFileSync(await saved));
  assert.equal(exported.records.length, 7); assert(exported.records.every(record=>record.meta.revision===1 && record.meta.folderId===libraryIds.folder));
  const ownerIds = new Set(exported.traceability.links.filter(link=>link.type==='derived-from-project'&&link.from===exported.program.id).map(link=>link.to));
  assert.deepEqual([...ownerIds].sort(), ['project:code-architecture:fixture-controller','project:functional:fixture-project']);
  const spec = exported.records.find(record=>record.meta.templateId==='system-spec'), conops = exported.records.find(record=>record.meta.templateId==='conops');
  assert(exported.traceability.links.some(link=>link.type==='refines'&&link.from.startsWith(spec.meta.id)&&link.to.startsWith(conops.meta.id)));
  assert(exported.traceability.links.some(link=>link.type==='derived-from-diagram'));
  const architecture=exported.records.find(record=>record.meta.templateId==='architecture');
  assert.equal(architecture.revision.sources.entries.find(source=>source.sourceType==='architecture-diagram').snapshot.edges.length,2);
  await click('Documents'); await click('Architecture');
  await until(`document.querySelectorAll('.architecture-diagrams .project-functional-diagram .react-flow__node').length===5`);
  assert.equal(await run(`document.querySelectorAll('.architecture-diagrams .react-flow__node-groupBox').length`),3);
  assert.equal(await run(`document.querySelectorAll('.architecture-diagrams .react-flow__node.draggable').length`),0);
  assert.equal(await run(`document.querySelectorAll('.architecture-diagrams [aria-label="Add system"]').length`),0);
  assert.deepEqual(await run(`Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('diagram:positions:fixture-project')).map(k=>[k,localStorage.getItem(k)]))`), sourceDiagramBefore);
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const architectureFits = `(()=>{const canvas=document.querySelector('.architecture-diagrams .architecture-canvas'),region=document.querySelector('[aria-label="Artifact content"]');if(!canvas||!region)return false;const bounds=canvas.getBoundingClientRect(),pane=region.getBoundingClientRect(),controls=canvas.querySelector('.react-flow__controls')?.getBoundingClientRect();return bounds.height>120&&bounds.bottom<=pane.bottom+1&&controls?.bottom<=bounds.bottom+1&&[...canvas.querySelectorAll('.react-flow__node')].every(node=>{const r=node.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1&&r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1;});})()`;
  await until(architectureFits);
  win.setSize(1280,800); await until(`innerWidth<=1280`); await wait(600); await until(architectureFits);
  await until(`document.querySelector('[aria-label="Artifact content"]').scrollHeight<=document.querySelector('[aria-label="Artifact content"]').clientHeight+1`);
  win.setSize(1500,1050); await until(`innerWidth===1500`); await wait(600); await until(architectureFits);
  fs.writeFileSync('/tmp/xhandle-system-architecture.png',(await win.webContents.capturePage()).toPNG());
  for (const format of ['png','docx','pdf']) {
    const saved=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{const target=path.join(profile,'native-architecture.'+format);item.setSavePath(target);item.once('done',(_event,state)=>state==='completed'?resolve(target):reject(new Error(state)));}));
    if(format==='png') await click('Export diagram (PNG)');
    else {
      await run(`document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]')?.click();void 0`);
      await until(`document.querySelector('select[aria-label="Export artifact"]')`);
      await run(`(()=>{const field=document.querySelector('select[aria-label="Export artifact"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,${JSON.stringify(format)});field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    const file=await Promise.race([saved,wait(30000).then(()=>{throw new Error('Native architecture export timed out: '+format);})]);assert(fs.statSync(file).size>1500);
    if(format==='png') fs.copyFileSync(file,'/tmp/xhandle-native-architecture-export.png');
  }
  assert.deepEqual(await run(`Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('diagram:positions:fixture-project')).map(k=>[k,localStorage.getItem(k)]))`), sourceDiagramBefore);

  await click('Trace');
  await until(`document.body.innerText.includes('Diagram and element traceability')`);
  await click('Open systems engineering project');
  await click('Documents'); await click('Concept of Operations'); await click('Table');
  await until(`!!document.querySelector('[aria-label="Resize column Title"]')`);
  await click('Trace'); await click('Refined by'); await until(`document.querySelector('.requirements-native-views').innerText.includes('System Specification')`);
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-project-native-trace.png', (await win.webContents.capturePage()).toPNG());
  assert.equal(await run(`document.querySelectorAll('[data-library-kind="project"] [data-library-kind="artifact"]').length`), 7);
  assert.equal(await run(`document.querySelectorAll('[data-library-kind="artifact"]').length`), 7);
  await click('Collapse all');
  assert.equal(await run(`document.querySelectorAll('[data-library-kind="artifact"]').length`), 0);
  await until(`document.querySelector('.artifact-header').innerText.includes('Concept of Operations')`);
  await click('Expand all');
  assert.equal(await run(`document.querySelectorAll('[data-library-kind="project"] [data-library-kind="artifact"]').length`), 7);
  await click('Open systems engineering project'); await click('Traceability');
  await until(`document.querySelector('[aria-label="Project content"]')?.innerText.includes('unresolved coverage items')`);
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-project-traceability.png', (await win.webContents.capturePage()).toPNG());
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); }); await intercept(); await enterDesign();
  await click('Complete fixture project'); await until(`document.querySelector('.artifact-header')?.innerText.includes('accepted')`);
  await until(`document.querySelector('.artifact-editor').innerText.includes('Controller fixture')`);
  assert.equal(await run(`document.querySelector('[data-library-kind="project"] [data-library-kind="artifact"]').dataset.libraryId`), libraryIds.last);
  await click('Generate engineering artifact');
  // Exercise a CSU snapshot above the old 350k single-request admission limit.
  await run(`(async()=>{const request=indexedDB.open('xhandle',4);const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const tx=db.transaction('copilot_baseline','readwrite'),store=tx.objectStore('copilot_baseline'),get=store.get('cba:fixture-controller:fixture-repo');get.onsuccess=()=>{const row=get.result.value[0];store.put({key:get.result.key,value:Array.from({length:320},(_,i)=>({...row,traceId:'implementation-call-'+i,controlDetails:'Implementation evidence '+i+': '+('Saved code behavior. '.repeat(60))}))});};await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();})()`);
  await setField('Document type','architecture'); await setField('Architecture type','code-based'); await setField('Title','Implementation Architecture');
  await setField('Owning project','code-architecture:fixture-controller'); await setField('Destination folder','fixture-folder'); await setField('System','Controller');
  await run(`[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend')?.textContent==='Source diagrams').querySelector('input[type=checkbox]').click()`);
  assert.deepEqual(await run(`[...document.querySelectorAll('.artifact-form select')].find(select=>select.value==='csu')&&[...[...document.querySelectorAll('.artifact-form select')].find(select=>select.value==='csu').options].map(option=>option.textContent)`),['Subsystem','CSCI','CSC','CSU','Functional']);
  await setField('Abstraction level — Controller fixture','csu');
  await click('Create draft'); const beforeArchitecture=calls; await click('Generate / resume draft'); await click('Review proposal'); await click('Accept proposal');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  assert.equal(calls,beforeArchitecture);
  await until(`[...document.querySelectorAll('.architecture-diagrams .react-flow__node-bidirectional')].filter(node=>getComputedStyle(node).visibility!=='hidden').length===2`);
  await run(`document.querySelector('.architecture-inspector-toggle[aria-expanded="false"]')?.click()`);
  await run(`(()=>{const label=[...document.querySelectorAll('.architecture-diagrams label')].find(l=>l.textContent.startsWith('Inspect element')),field=label.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,[...field.options].find(option=>option.textContent.includes('Command input')).value);field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.architecture-diagrams').innerText.includes('Source files') && document.querySelector('.architecture-diagrams').innerText.includes('controller.cpp')`);
  await until(`[...document.querySelectorAll('.architecture-diagrams .react-flow__node-bidirectional')].filter(node=>getComputedStyle(node).visibility!=='hidden').length===2`);
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await until(`(()=>{const nodes=[...document.querySelectorAll('.architecture-canvas .react-flow__node-bidirectional')];if(nodes.length!==2)return false;const [a,b]=nodes.map(n=>n.getBoundingClientRect());return a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top;})()`);
  fs.writeFileSync('/tmp/xhandle-code-architecture-artifact.png',(await win.webContents.capturePage()).toPNG());
  await click('Source diagrams');
  await until(`document.querySelector('[aria-label="Manage source diagrams"] input[type=checkbox]').checked`);
  await until(`[...document.querySelectorAll('[aria-label="Manage source diagrams"] select')].some(select=>select.value==='csu')`);
  await click('Cancel');
  await click('Trace');
  await until(`document.querySelector('.requirements-native-views details summary')!==null`);
  await run(`document.querySelector('.requirements-native-views details summary').click()`);
  await until(`document.querySelector('.requirements-native-views details p button')!==null`);
  await run(`document.querySelector('.requirements-native-views details p button').click()`);
  await until(`document.querySelector('.xhandle-modal-viewport .source-evidence-details')!==null`);
  await until(`!document.querySelector('.xhandle-modal-viewport pre')`);
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  fs.writeFileSync('/tmp/xhandle-readable-source-evidence.png',(await win.webContents.capturePage()).toPNG());
  await click('View source diagram');
  await until(`document.querySelector('.xhandle-modal-viewport .architecture-diagrams .react-flow__node')!==null`);
  await run(`(()=>{const dialogs=[...document.querySelectorAll('.xhandle-modal-viewport')];dialogs[dialogs.length-1].querySelector('button').click();})()`);
  await run(`document.querySelector('.xhandle-modal-viewport button').click()`);
  await click('Document');
  for (const format of ['docx','pdf']) {
    const saved=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{const target=path.join(profile,'architecture.'+format);item.setSavePath(target);item.once('done',(_event,state)=>state==='completed'?resolve(target):reject(new Error(state)));}));
    await run(`document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]')?.click();void 0`);
    await until(`document.querySelector('select[aria-label="Export artifact"]')`);
    await run(`(()=>{const field=document.querySelector('select[aria-label="Export artifact"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,${JSON.stringify(format)});field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const file=await Promise.race([saved,wait(30000).then(()=>{throw new Error('Architecture export timed out: '+format);})]);assert(fs.statSync(file).size>1500);
  }
  await click('Expand all');
  const adoptedId = await run(`(()=>{const button=[...document.querySelectorAll('[data-library-kind="artifact"] button')].find(button=>button.textContent==='Implementation Architecture');return button.closest('[data-library-kind="artifact"]').dataset.libraryId;})()`);
  const savedArchitecture = await run(`(async()=>{const request=indexedDB.open('xhandle-design-artifacts');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const tx=db.transaction('revisions');const query=tx.objectStore('revisions').get(${JSON.stringify(adoptedId)}+':1');const revision=await new Promise(resolve=>query.onsuccess=()=>resolve(query.result));db.close();return revision;})()`);
  const largeSnapshot = savedArchitecture.sources.entries.find(source=>source.sourceType==='architecture-diagram').snapshot;
  assert.equal(largeSnapshot.edges.flatMap(edge=>edge.relationships).length,320);
  assert(JSON.stringify(savedArchitecture.sources).length>350000);
  console.log('PASS large CSU snapshot creation and acceptance with all 320 implementation relationships and no AI requests');
  // Exercise a large saved functional decomposition through the production UI.
  // This synthetic revision is isolated from both user data and source capture tests.
  const largeViewId = await run(`(async()=>{
    const request=indexedDB.open('xhandle-design-artifacts');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));
    const original=await new Promise(resolve=>{const q=db.transaction('metadata').objectStore('metadata').get(${JSON.stringify(adoptedId)});q.onsuccess=()=>resolve(q.result);});
    const id=crypto.randomUUID(), diagramId='large-functional-fixture';
    const nodes=Array.from({length:3001},(_,i)=>({id:'function-'+i,label:'Responsibility '+i,architectures:[{subsystem:'Compute',csci:'AV',csc:'Functional model',csu:'Unit '+Math.floor(i/20)}]}));
    const edges=Array.from({length:4500},(_,i)=>({id:'relationship-'+i,from:'function-'+(i%3001),to:'function-'+((i+1)%3001),label:'Interaction '+i,row:{traceId:'saved-'+i}}));
    const diagram={id:diagramId,diagramId,title:'Large saved functional decomposition',diagramTitle:'Large saved functional decomposition',sourceType:'architecture-diagram',workspaceType:'code-architecture',abstraction:'functional',snapshot:{nodes,edges}};
    const entries=[diagram,...nodes.map(node=>({id:diagramId+':'+node.id,diagramId,sourceType:'architecture-element',elementType:'node',elementId:node.id,title:node.label,element:node})),...edges.map(edge=>({id:diagramId+':'+edge.id,diagramId,sourceType:'architecture-element',elementType:'edge',elementId:edge.id,title:edge.label,element:edge}))];
    const objects=entries.map((source,i)=>({id:id+':'+i,title:source.title,text:'Saved synthetic evidence',kind:'narrative',parentId:null,sourceIds:[source.id],sourceEvidence:[source],manual:false}));
    const tx=db.transaction(['metadata','revisions'],'readwrite');
    tx.objectStore('metadata').put({...original,id,title:'Large functional view fixture',programId:null,revision:1,config:{...original.config,title:'Large functional view fixture'}});
    tx.objectStore('revisions').put({id:id+':1',artifactId:id,number:1,objects,sources:{hash:'fixture',entries},sourceHash:'fixture'});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject;});db.close();window.dispatchEvent(new Event('xhandle:design-artifacts-changed'));return id;
  })()`);
  await run(`window.__viewHeartbeat={last:performance.now(),max:0,ticks:0};window.__viewTimer=setInterval(()=>{const h=window.__viewHeartbeat,now=performance.now();h.max=Math.max(h.max,now-h.last);h.last=now;h.ticks++;},20);true`);
  await click('Large functional view fixture');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Large functional view fixture') && document.querySelectorAll('.architecture-canvas .react-flow__node').length>0`);
  await until(`document.querySelectorAll('.architecture-canvas .react-flow__node-bidirectional').length<=120 && document.querySelectorAll('.architecture-canvas .react-flow__node').length<=600 && document.querySelectorAll('.architecture-inspector option').length<=202`);
  await run(`document.querySelector('.architecture-inspector-toggle[aria-expanded="false"]')?.click()`);
  await run(`(()=>{const input=document.querySelector('input[placeholder="Search all views"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Responsibility 3000');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.architecture-inspector select').options.length===2`);
  await run(`(()=>{const field=document.querySelector('.architecture-inspector select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'function-3000');field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.architecture-canvas .react-flow__node[data-id="n:code:function-3000"]')!==null`);
  await until(`(()=>{const target=document.querySelector('.architecture-canvas .react-flow__node[data-id="n:code:function-3000"]'),canvas=document.querySelector('.architecture-canvas');if(!target)return false;const a=target.getBoundingClientRect(),b=canvas.getBoundingClientRect();return a.left>=b.left && a.right<=b.right && a.top>=b.top && a.bottom<=b.bottom;})()`);
  const viewPerformance=await run(`(()=>{clearInterval(window.__viewTimer);return window.__viewHeartbeat;})()`);
  assert(viewPerformance.ticks>0 && viewPerformance.max<1500,JSON.stringify(viewPerformance));
  fs.writeFileSync('/tmp/xhandle-large-functional-architecture.png',(await win.webContents.capturePage()).toPNG());
  console.log('PASS bounded production diagram navigation for 3001 elements / 4500 relationships',viewPerformance);
  await run(`(async()=>{const request=indexedDB.open('xhandle-design-artifacts');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const tx=db.transaction(['metadata','revisions'],'readwrite');tx.objectStore('metadata').delete(${JSON.stringify(largeViewId)});tx.objectStore('revisions').delete(${JSON.stringify(largeViewId)}+':1');await new Promise(resolve=>tx.oncomplete=resolve);db.close();window.dispatchEvent(new Event('xhandle:design-artifacts-changed'));})()`);
  await click('Implementation Architecture');
  await drag(adoptedId, libraryIds.project);
  await until(`document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.project)}+'"] [data-library-id="'+${JSON.stringify(adoptedId)}+'"]')!==null`);
  assert.equal(await run(`document.querySelectorAll('[data-library-kind="project"] [data-library-kind="artifact"]').length`),8);
  const nestedFolderId = await run(`JSON.parse(localStorage.getItem('xhandle:req-projects')).find(folder=>folder.name==='Nested folder').id`);
  await drag(adoptedId, nestedFolderId);
  const filedInSubfolder = `document.querySelector('[data-library-id="'+${JSON.stringify(nestedFolderId)}+'"] [data-library-id="'+${JSON.stringify(adoptedId)}+'"]')!==null`;
  await until(filedInSubfolder);
  await until(`document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.project)}+'"]').innerText.includes('8 artifacts')`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await intercept();await enterDesign();await click('Expand all');
  await until(filedInSubfolder);
  await click('Implementation Architecture');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Implementation Architecture')`);
  await click('Open systems engineering project');
  await until(`document.querySelector('.artifact-editor table')?.innerText.includes('Implementation Architecture')`);
  await click('Generate engineering artifact');
  await until(`[...document.querySelectorAll('.artifact-form select option')].some(option=>option.textContent==='Peer folder / Nested folder')`);
  await click('Cancel');
  await drag(nestedFolderId, libraryIds.project);
  const folderInProject = `document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.project)}+'"] [data-library-kind="folder"][data-library-id="'+${JSON.stringify(nestedFolderId)}+'"]')!==null`;
  await until(folderInProject); await until(filedInSubfolder);
  assert.equal(await run(`document.querySelectorAll('[data-library-id="'+${JSON.stringify(nestedFolderId)}+'"]').length`),1);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await intercept();await enterDesign();
  await until(`document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.project)}+'"]')!==null`);
  await click('Expand all');
  await until(folderInProject); await until(filedInSubfolder);
  await click('Generate engineering artifact');
  await until(`[...document.querySelectorAll('.artifact-form select option')].some(option=>option.textContent.includes('Complete fixture project / Nested folder'))`);
  await click('Cancel');
  // Move the folder back out, then into the project again. Its artifacts stay members.
  await drag(nestedFolderId, libraryIds.folder);
  await until(`!(${folderInProject})`); await until(filedInSubfolder);
  await drag(nestedFolderId, libraryIds.project); await until(folderInProject);
  fs.writeFileSync('/tmp/xhandle-project-folder-nesting.png', (await win.webContents.capturePage()).toPNG());
  console.log('PASS folders and their artifacts move into/out of projects, retain nesting across reload, and show accurate destination paths');
  await drag(adoptedId, libraryIds.project);
  await until(`document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.project)}+'"] [data-library-id="'+${JSON.stringify(adoptedId)}+'"]')!==null`);
  await click('Implementation Architecture');
  console.log('PASS project artifact subfolder placement survives reload, retains project membership/count/list, exposes destination paths, and moves back into the project');
  await click('Open systems engineering project');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('8 documents')`);
  await until(`document.querySelector('.artifact-editor table').innerText.includes('Implementation Architecture')`);
  const preservedArchitecture = await run(`(async()=>{const request=indexedDB.open('xhandle-design-artifacts');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const query=db.transaction('revisions').objectStore('revisions').get(${JSON.stringify(adoptedId)}+':1');const revision=await new Promise(resolve=>query.onsuccess=()=>resolve(query.result));db.close();return revision;})()`);
  assert.deepEqual(preservedArchitecture,savedArchitecture);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await intercept();await enterDesign();await click('Complete fixture project');await click('Expand all');
  await until(`document.querySelector('[data-library-id="'+${JSON.stringify(libraryIds.project)}+'"] [data-library-id="'+${JSON.stringify(adoptedId)}+'"]')!==null`);
  await click('Complete fixture project');
  await click('Edit details'); await setField('Title','Renamed fixture project'); await setField('Description','Project overview for reviewers.'); await click('Save details');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Renamed fixture project')`);
  await until(`document.querySelector('[data-library-kind="project"]').innerText.includes('Renamed fixture project')`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await intercept();await enterDesign();await click('Renamed fixture project');
  await click('Edit details');
  assert.equal(await run(`document.querySelector('[aria-label="Edit details"] textarea').value`),'Project overview for reviewers.');
  await click('Cancel');
  await click('Delete project'); await click('Delete complete project');
  await until(`![...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Renamed fixture project')`);
  await until(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Operational needs')`);
  // Exercise the new evidence-review -> section-synthesis path through real UI/fetch plumbing.
  adaptiveFixture = false;
  await run(`localStorage.setItem('xhandle:requirements',JSON.stringify(Array.from({length:14},(_,i)=>({id:'concise-source-'+i,title:'Distinct operational input '+i,folderId:'fixture-folder',projectId:'fixture-folder',moduleId:'fixture-source',module:'Operational needs',attributes:{Description:'Selected engineering evidence. '.repeat(350)},parentId:null,order:i,links:[]}))));`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await intercept();await enterDesign();
  await click('Generate engineering artifact');
  await setField('Title','Concise evidence fixture'); await setField('Owning project','functional:fixture-project'); await setField('Destination folder','fixture-folder'); await setField('System','Orbital Operations');
  await run(`[...document.querySelectorAll('.artifact-form fieldset')].find(field=>field.querySelector('legend')?.textContent==='Source modules').querySelector('input[type=checkbox]').click()`);
  await click('Create draft'); await click('Generate / resume draft'); await click('Review proposal');
  assert.equal(conciseRequests.filter(prompt=>prompt.task==='evidence-review').length,2);
  assert.equal(conciseRequests.filter(prompt=>prompt.task==='evidence-review').flatMap(prompt=>prompt.sources).length,14);
  assert.equal(conciseRequests.filter(prompt=>prompt.task==='draft').length,6);
  assert(conciseRequests.filter(prompt=>prompt.task==='draft').every(prompt=>prompt.sources.every(source=>source.sourceType==='evidence-brief')));
  await click('Artifact actions');
  await until(`document.querySelector('.artifact-actions-popover')?.innerText.includes('Drafted from a condensed evidence review')`);
  await click('View document and source register');
  await until(`document.querySelector('.artifact-paper')?.innerText.includes('Distinct operational input 13')`);
  await until(`document.querySelector('.artifact-paper')?.innerText.includes('Unverified generated text:')`);
  await click('Accept proposal');await until(`document.querySelector('.artifact-header')?.innerText.includes('Revision 1')`);
  const conciseRevision=await run(`(async()=>{const request=indexedDB.open('xhandle-design-artifacts');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const tx=db.transaction(['metadata','revisions']);const metas=tx.objectStore('metadata').getAll();const rows=await new Promise(resolve=>metas.onsuccess=()=>resolve(metas.result));const meta=rows.find(meta=>meta.title==='Concise evidence fixture');const query=tx.objectStore('revisions').get(meta.id+':1');const revision=await new Promise(resolve=>query.onsuccess=()=>resolve(query.result));db.close();return revision;})()`);
  assert.equal(conciseRevision.objects.length,18);
  assert.equal(conciseRevision.sources.entries.length,14);
  const conciseCitations=conciseRevision.objects.flatMap(object=>object.sourceIds);
  assert(conciseCitations.length>0);
  assert(conciseCitations.every(id=>id.startsWith('module:fixture-folder/fixture-source:')));
  const beforeDetailsCalls = calls;
  await click('Edit details'); await setField('Title','Updated operations overview'); await setField('Description','Human-readable document purpose.'); await click('Save details');
  await until(`document.querySelector('.artifact-header')?.innerText.includes('Updated operations overview')`);
  await until(`document.querySelector('.artifact-paper')?.innerText.includes('Human-readable document purpose.')`);
  await until(`[...document.querySelectorAll('[data-library-kind="artifact"]')].some(node=>node.innerText.includes('Updated operations overview'))`);
  await run(`document.querySelector('[aria-label="Artifact actions"][aria-expanded="false"]')?.click();void 0`);
  await until(`document.querySelector('select[aria-label="Export artifact"]')`);
  const savedDetails = new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{const target=path.join(profile,'details.md');item.setSavePath(target);item.once('done',(_event,state)=>state==='completed'?resolve(target):reject(new Error(state)));}));
  await run(`(()=>{const field=document.querySelector('select[aria-label="Export artifact"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'md');field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const detailsFile = await Promise.race([savedDetails,wait(30000).then(()=>{throw new Error('Details export timed out');})]);
  const detailsMarkdown = fs.readFileSync(detailsFile,'utf8');
  assert(detailsMarkdown.includes('# Updated operations overview')); assert(detailsMarkdown.includes('Human-readable document purpose.'));
  assert.equal(calls,beforeDetailsCalls);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await intercept();await enterDesign();await click('Updated operations overview');await click('Edit details');
  assert.equal(await run(`document.querySelector('[aria-label="Edit details"] textarea').value`),'Human-readable document purpose.');
  await click('Cancel');
  console.log('PASS document/project detail edits, sidebar/header updates, description export, reload and unchanged AI call count');
  console.log('PASS condensed evidence review, six concise section requests, coverage feedback, full source register, unresolved evidence propagation and canonical citations');
  console.log('PASS single-artifact regression and seven-artifact project and code architecture: diagram/element sources, graphical snapshots, no-AI architecture capture, diagram exports, checklist, multiple owners, generation, joint acceptance, cross-document/project traces, native table/trace, bounded document/table scrolling at desktop and laptop sizes, grouped sidebar, accessible folder actions, peer/subfolder creation, drag ordering and whole-project moves, independent collapse controls, export, reload, and group deletion. AI fixture calls:', calls);
  win.destroy(); server.close(); app.quit();
}).catch(error => { console.error(error); server?.close(); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
