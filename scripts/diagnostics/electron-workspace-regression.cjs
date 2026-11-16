// Production Electron UI with populated, disposable workspaces. No real AI calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron } = require(process.env.XHANDLE_PLAYWRIGHT_MODULE || 'playwright-core');
const { electronFixtureMain, cleanEnvironment } = require('./electron-regression-support.cjs');
const arg = name => process.argv[process.argv.indexOf(name)+1];
const stage = fs.realpathSync(arg('--stage')), fixtures = fs.realpathSync(arg('--fixtures'));
const root = fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-workspace-regression-'));
const result = { root, checks: [], failures: [], errors: [], consoleErrors: [], unexpectedAI: [], samples: [] };
let app, page;
const save = () => fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
async function step(name, action) {
  const started = Date.now();
  try { await action(); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));result.checks.push(name);console.log('PASS '+name); }
  catch(error) { result.failures.push({name,error:error.stack});console.error('FAIL '+name+': '+error.message);await page.screenshot({path:path.join(root,`failure-${result.failures.length}.png`)}).catch(()=>{});fs.writeFileSync(path.join(root,`failure-${result.failures.length}.txt`),(await page.locator('body').innerText()).slice(0,40000));await page.keyboard.press('Escape').catch(()=>{}); }
  finally { result.samples.push({name,elapsedMs:Date.now()-started,dom:await page.locator('*').count(),tableRows:await page.locator('tbody tr').count()});save(); }
}
const nav = async name => { await page.locator('#xhandle-primary-sidebar').hover();await page.getByRole('button',{name,exact:true}).first().click(); };
async function project(name, area = 'Projects') {
  await page.locator('#xhandle-primary-sidebar').hover();
  if (!await page.getByRole('button',{name,exact:true}).count()) await page.getByRole('button',{name:area==='Projects'?/^Projects(?:\s+\d+)?$/:area,exact:area!=='Projects'}).first().click();
  await page.getByRole('button',{name,exact:true}).first().click();
}
const designObject = async id => { await nav('Design Management');await page.locator(`[data-library-id="${id}"] button`).first().click(); };
async function closeDialog() {const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:/^Close/}).first().click();}
(async()=>{try{
  for(const name of ['profile','session','downloads'])fs.mkdirSync(path.join(root,name));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'xhandle-workspace-regression',version:'1.0.0',main:'main.cjs'}));
  fs.writeFileSync(path.join(root,'main.cjs'),electronFixtureMain(stage,root));
  app=await _electron.launch({executablePath:arg('--electron'),args:[root],env:cleanEnvironment()});page=await app.firstWindow();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>{result.errors.push(error.stack||error.message);save();});page.on('console',message=>{if(message.type()==='error')result.consoleErrors.push(message.text().slice(0,1000));});page.on('dialog',dialog=>dialog.accept());
  await app.evaluate(({BrowserWindow,session},downloads)=>{BrowserWindow.getAllWindows()[0].setBounds({width:1600,height:1050});session.defaultSession.on('will-download',(_event,item)=>item.setSavePath(downloads+'/'+item.getFilename()));},path.join(root,'downloads'));
  await page.route('**/api/chat',async route=>{result.unexpectedAI.push(route.request().url());await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Unexpected AI request in offline interaction test"}'});});
  result.runtime=await app.evaluate(({app})=>({profile:app.getPath('userData'),versions:process.versions,packaged:app.isPackaged}));assert.equal(result.runtime.profile,path.join(root,'profile'));
  await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
  await page.addScriptTag({path:path.join(fixtures,'cba/seed.js')});await page.evaluate(()=>window.seedCbaPerformance(8000,160,2000));
  await page.evaluate(()=>{localStorage.setItem('xhandle.sidebarLocked','true');localStorage.setItem('xhandle.projects',JSON.stringify([{id:'perf',name:'Functional performance fixture'}]));localStorage.setItem('xhandle.projectData',JSON.stringify({perf:{responseRows:Array.from({length:120},(_,i)=>({id:'functional-'+i,fromFunction:'Controller '+i%30,toFunction:'Actuator '+i%40,controlAction:'Command '+i})),riskMethod:'STPA',riskRegister:[],requirements:[]}}));});
  await page.addScriptTag({path:path.join(fixtures,'extra.seed.js')});await page.evaluate(()=>window.seedAuditExtras({assessmentRows:8000,requirementRows:2000}));await page.reload();
  const sourceBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData')).perf.responseRows);
  await step('Functional diagram opens, selects elements and responds to zoom controls',async()=>{
    await project('Functional performance fixture');const diagram=page.locator('[aria-label="Functional architecture diagram"]');await diagram.locator('.react-flow__node').first().waitFor();
    await diagram.locator('.react-flow__node-bidirectional').first().click();assert(await diagram.locator('.react-flow__node.selected').count()>0);
    const before=await diagram.locator('.react-flow__viewport').getAttribute('style');await diagram.locator('.react-flow__controls-zoomin').click();await page.waitForTimeout(300);assert.notEqual(await diagram.locator('.react-flow__viewport').getAttribute('style'),before);
    await diagram.locator('.react-flow__controls-fitview').click();
  });
  await step('Code architecture switches CSU, CSC, CSCI, Subsystem and Functional abstractions',async()=>{
    await project('CBA performance fixture','Code-Based Architecture');await page.locator('.react-flow__node-bidirectional').first().waitFor();
    for(const level of ['CSC','CSCI','Subsystem','Functional','CSU']){await page.getByRole('button',{name:level,exact:true}).click();await page.locator('.react-flow__node').first().waitFor();}
  });
  await step('All code requirements, design and traceability tabs render their persisted artifacts',async()=>{
    for(const [name,id]of [['Software Requirements','SWR-0'],['System Requirements','SYS-0'],['Subsystem Requirements','SUB-0'],['System / Subsystem Design','DES-0'],['Traceability Matrix','TRACE-']]){
      await page.getByRole('button',{name,exact:true}).click();await page.locator('tbody').filter({hasText:id}).first().waitFor();
    }
  });
  await step('Large saved code hazard analysis loads, virtualizes rows, scrolls and survives tab reentry',async()=>{
    for(let cycle=0;cycle<3;cycle++){
      await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();const subtab=page.getByRole('button',{name:'Code Architecture Hazard Analysis',exact:true});if(await subtab.isVisible())await subtab.click();
      await page.locator('tbody td').first().waitFor();assert(await page.locator('tbody tr').count()<500,'The 8,000-row source must not mount all rows');
      const body=page.locator('tbody').first();await body.evaluate(node=>{for(let e=node.parentElement;e;e=e.parentElement)if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight){e.scrollTop=e.scrollHeight/2;return;}});
      await page.getByRole('button',{name:'Software Requirements',exact:true}).click();await page.getByText('SWR-0',{exact:true}).first().waitFor();
    }
  });
  await step('New folder creation opens a bounded dialog and persists the new folder across reload',async()=>{
    await nav('Design Management');await page.locator('.design-library-pane').getByRole('button',{name:'New folder',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New folder',exact:true});await dialog.getByRole('textbox').fill('Regression folder');
    const bounds=await dialog.getByRole('button',{name:'Create',exact:true}).boundingBox();assert(bounds&&bounds.y+bounds.height<1050);await dialog.getByRole('button',{name:'Create',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.reload();await nav('Design Management');await page.getByRole('button',{name:'Regression folder',exact:true}).first().waitFor();
  });
  await step('Every requirements table column opens a searchable multiselect; filtering includes the last record',async()=>{
    await designObject('audit-req');await page.getByTitle('Table view',{exact:true}).click();await page.locator('.requirements-table-panel').waitFor();
    const filters=page.locator('thead button[aria-haspopup="dialog"]');assert(await filters.count()>=3);
    for(let i=0;i<await filters.count();i++){await filters.nth(i).click();const dialog=page.getByRole('dialog');await dialog.getByRole('searchbox').fill('');assert(await dialog.getByRole('checkbox').count()>0);await dialog.getByRole('button',{name:'Done',exact:true}).click();}
    await page.getByRole('button',{name:'Filter Description',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('searchbox').fill('command 1999');await dialog.getByRole('button',{name:'Select matching',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByText('The controller shall reject command 1999 when the command validity interval has expired.',{exact:true}).waitFor();assert(!await page.getByText('The controller shall reject command 1998 when the command validity interval has expired.',{exact:true}).count());await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  });
  await step('Table history, Outline, Traceability and Document views work on a populated specification',async()=>{
    await designObject('audit-req');await page.getByTitle('Table view',{exact:true}).click();await page.locator('.requirements-table-scroll tbody tr').first().click();await page.getByTitle('History',{exact:true}).click();await page.getByRole('dialog',{name:'Object history',exact:true}).waitFor();await closeDialog();
    for(const [view,selector]of [['Outline','.requirements-outline-scroll'],['Traceability','.design-view-scroll[data-view="trace"]'],['Document','.artifact-document-reader']]){await page.getByTitle(view+' view',{exact:true}).click();await page.locator(selector).first().waitFor();}
  });
  await step('HTL multiselect filtering, assessment expansion and column resizing work across 8,000 assessments',async()=>{
    await designObject('audit-htl');await page.getByRole('button',{name:'Filter Hazard',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('searchbox').fill('motion 59');assert(await dialog.getByRole('checkbox').count()>0);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/^Expand .*assessments\)$/}).first().click();await page.getByText(/Original assessments 1/).first().waitFor();
    const handle=page.getByRole('separator',{name:'Resize Hazard column',exact:true});const box=await handle.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+10);await page.mouse.down();await page.mouse.move(box.x+80,box.y+10,{steps:10});await page.mouse.up();
  });
  await step('Design Management global keyboard search finds a requirement outside the initial table page',async()=>{
    await page.keyboard.press(process.platform==='darwin'?'Meta+f':'Control+f');const search=page.getByRole('combobox',{name:'Search Design Management',exact:true});await search.fill('command 1999');await page.getByRole('option').filter({hasText:'Audit Safety Requirements'}).first().waitFor();await page.keyboard.press('Escape');
  });
  await step('Saved report library searches and opens complete report content',async()=>{
    await project('Functional performance fixture');await nav('Reports');await page.getByLabel('Search saved reports',{exact:true}).fill('Audit report 0');await page.getByRole('button',{name:'Audit report 0',exact:true}).click();await page.getByText('Recorded safety concern 149',{exact:true}).first().waitFor();
  });
  await step('Safety Case diagram selects a persisted claim and supports fit/zoom',async()=>{
    await nav('Safety Case');await page.locator('.react-flow__node').first().waitFor();await page.locator('.react-flow__controls-fitview').click();await page.waitForTimeout(400);
    const id=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.find(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})?.getAttribute('data-id'));
    assert(id,'Fit must expose a selectable claim');await page.locator(`.react-flow__node[data-id="${id}"]`).click();assert(await page.locator('.react-flow__node.selected').count()>0);
  });
  await step('System Test filters, edits and persists a test case across reload',async()=>{
    await nav('System Test');await page.getByPlaceholder('ID',{exact:true}).fill('TC-999');await page.getByText('Reject stale command 999',{exact:true}).click();const inspector=page.locator('aside').filter({has:page.getByRole('heading',{name:'Test Case Inspector',exact:true})});await inspector.locator('input').nth(1).fill('Regression stale-command test');await page.getByPlaceholder('ID',{exact:true}).click();
    await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xhandle:vnv-test-case-documents')).some(doc=>doc.testCases.some(test=>test.id==='TC-999'&&test.title==='Regression stale-command test')));
    await page.reload();await nav('System Test');await page.getByText('Regression stale-command test',{exact:true}).first().waitFor();
  });
  await step('Help, provider settings and activities open without obscured action controls',async()=>{
    await page.getByRole('button',{name:'README',exact:true}).click();await page.getByRole('button',{name:'Close guide',exact:true}).click();
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'AI Provider',exact:true}).waitFor();await page.getByText('Effort',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).last().click();
    await page.getByRole('button',{name:/^Activities/}).click();await page.getByText('No active activities.',{exact:true}).waitFor();await page.keyboard.press('Escape');
  });
  await step('SysML starter model supports diagram, table, text, validation and persisted reload',async()=>{
    await nav('Design Management');await page.getByRole('button',{name:'SysML v2 Modeler',exact:true}).click();await page.getByRole('button',{name:'Drone starter',exact:true}).click();
    await page.getByText('FlightController',{exact:true}).first().waitFor();await page.getByRole('button',{name:'Auto-layout',exact:true}).click();await page.getByRole('button',{name:'Validate',exact:true}).click();
    await page.getByRole('button',{name:'Table',exact:true}).click();await page.locator('tbody tr').filter({hasText:'FlightController'}).first().click();
    await page.getByRole('button',{name:'Text',exact:true}).click();const textual=page.getByText('SysML v2-style textual export subset',{exact:true});await textual.waitFor();assert.match(await textual.locator('xpath=ancestor::div[./textarea][1]').locator('textarea').inputValue(),/FlightController/);
    await page.reload();await nav('Design Management');await page.getByRole('button',{name:'SysML v2 Modeler',exact:true}).click();await page.getByText('FlightController',{exact:true}).first().waitFor();
  });
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData')).perf.responseRows),sourceBefore,'Reading/navigating must not mutate source functional decomposition');assert.deepEqual(result.unexpectedAI,[]);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.consoleErrors,[]);assert.deepEqual(result.failures,[]);result.ok=true;await page.screenshot({path:path.join(root,'complete.png')});
}catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;}
finally{save();await app?.close();console.log('RESULT '+path.join(root,'result.json')+' '+JSON.stringify({ok:result.ok,checks:result.checks.length,failures:result.failures.length,errors:result.errors.length}));}})();
