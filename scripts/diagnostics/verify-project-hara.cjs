// Real Projects UI/storage/generation, with only the remote AI responses controlled.
// XHANDLE_PLAYWRIGHT_MODULE=/path/to/playwright-core node ... --stage <stage> --chrome <Chrome>
// Pass --electron <Electron> instead for an isolated desktop session.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium, _electron } = require(process.env.XHANDLE_PLAYWRIGHT_MODULE || 'playwright-core');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const stage = fs.realpathSync(arg('--stage'));
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'xhandle-hara-live-'));
const result = { root, checks: [], requests: [], errors: [], outputRecovery: { singleton: false, batch: false, requests: [] } };
let page, browser, app, server;
const check = name => { result.checks.push(name); console.log('PASS', name); };
async function checkOperationalColumns(name) {
  for (const column of ['Operational Mode', 'Operating Conditions']) {
    assert.equal(await page.getByRole('columnheader').filter({ hasText: column }).count(), 1, `${column} is visible`);
  }
  check(name);
}
function lastArray(prompt) {
  const end = prompt.lastIndexOf(']') + 1;
  for (let i = prompt.lastIndexOf('[', end - 1); i >= 0; i = prompt.lastIndexOf('[', i - 1)) {
    try { const value = JSON.parse(prompt.slice(i, end).trim()); if (Array.isArray(value)) return value; } catch {}
  }
  throw Error('No source array in controlled provider prompt.');
}
const answer = id => ({ id, applicabilityDecision: 'Yes', hazardOutcome: 'Failure to stop at an occupied crossing', guidePhraseApplicable: 'Yes', guidePhraseApplicabilityRationale: 'The brake actuator depends on the brake command to stop the vehicle.',
  applicabilityEvidenceField: 'Control Action', applicabilityEvidenceQuote: 'Brake command', applicabilityMechanism: 'Omitted brake command prevents the brake actuator from stopping the vehicle.',
  unsafeControlActions: 'Vehicle controller omits the brake command while approaching an occupied pedestrian crossing.',
  losses: 'Pedestrians are injured or killed in a collision.', hazards: 'The vehicle enters an occupied crossing without stopping.',
  rawLossCandidate: 'Pedestrian fatal injury', rawHazardCandidate: 'Vehicle enters occupied crossing without stopping',
  causalScenario: 'An omitted brake command prevents the brake actuator from stopping the vehicle at an occupied pedestrian crossing.',
  causalFactors: 'A brake command transmission fault prevents the actuator from receiving the commanded deceleration.', causalFactorCategory: 'Communication / interface',
  mitigationStrategy: 'Detect brake command loss and invoke independent braking.', safetyRequirementsConstraints: 'The vehicle shall stop before an occupied crossing.',
  systemRequirement: 'The vehicle controller shall command braking before entering an occupied pedestrian crossing.',
  verificationMethod: 'Inject loss of the brake command at an occupied crossing.', acceptanceCriteria: 'The vehicle stops before reaching the crossing.',
  safetyClassification: 'Safety — Direct', safetyClassificationRule: 'D1', causalPathType: 'Direct', protectionStatus: 'Absent',
  causalEffect: 'Brake actuator does not apply braking.', resultingSystemState: 'Vehicle fails to stop at the crossing.', classificationEvidence: 'Braking directly controls vehicle motion.',
  classificationConfidence: 'High', safetySignificant: 'Yes', safetySignificanceRationale: 'The omitted brake command directly causes loss of stopping and a pedestrian collision.',
  canonicalLossIds: ['L1'], canonicalHazardId: 'H1',
  itemFunction: 'Vehicle braking', malfunction: 'Loss of commanded braking', hazardousEvent: 'The vehicle fails to stop at an occupied crossing during automated urban driving.',
  potentialHarm: 'Fatal pedestrian injuries.', personsAtRisk: 'Pedestrians', severity: 'S3', severityRationale: 'Vehicle impact can fatally injure a pedestrian.',
  exposure: 'E4', exposureRationale: 'The operating-domain record identifies occupied crossings as frequent.', controllability: 'C3',
  controllabilityRationale: 'No human driver is present and the exposed pedestrian cannot avoid the impact.',
  safetyGoal: 'The vehicle shall prevent loss of braking at occupied crossings.', safeState: 'Stationary with propulsion inhibited.',
  vehicleHazard: 'Vehicle enters an occupied crossing without stopping.', harmChain: 'Omitted braking permits crossing entry and fatal pedestrian impact.', evidenceBasis: 'E/E malfunction', hazardMappingReview: 'Supported: the raw event and canonical hazard both concern failure to stop before crossing entry.', exposureEvidence: 'frequent crossings', safeStateJustification: 'Independent braking holds the vehicle outside the occupied crossing.', safeStateEvidence: 'The braking item has an independent stop function that holds standstill with propulsion inhibited.', fttiEvidence: 'response bound 100 ms per timing analysis.', ftti: '100 ms', fttiRationale: 'The supplied hazard timing analysis bounds fault-to-crossing entry at 100 ms.', assumptions: 'No additional assumptions.', gaps: '',
});
async function readHead() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('xhandle-project-hazard-analysis', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const value = await new Promise((resolve, reject) => { const r = db.transaction('analyses').objectStore('analyses').get('hara-fixture'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return value;
  });
}
async function waitForSavedHead(predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  // waitForFunction treats a returned Promise as truthy before its condition
  // resolves. Poll the completed IndexedDB read from Node instead.
  while (Date.now() < deadline) {
    const head = await readHead();
    if (predicate(head)) return head;
    await page.waitForTimeout(100);
  }
  throw Error('The expected HARA assessment was not saved before the deadline.');
}
(async () => {
  try {
    if (process.argv.includes('--electron')) {
      for (const name of ['profile','session','downloads']) fs.mkdirSync(path.join(root, name));
      fs.writeFileSync(root + '/package.json', JSON.stringify({ name: 'xhandle-hara-live', version: '1.0.0', main: 'main.cjs' }));
      fs.writeFileSync(root + '/main.cjs', require('./electron-regression-support.cjs').electronFixtureMain(stage, root));
      app = await _electron.launch({ executablePath: arg('--electron'), args: [root], env: Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]])) });
      const desktopLog = [];
      result.desktopLog = desktopLog;
      app.process().stderr?.on('data', chunk => { desktopLog.push(String(chunk).slice(-2000)); if(desktopLog.length > 40) desktopLog.shift(); });
      page = await app.firstWindow();
      await page.waitForURL('xhandle://app/**', { waitUntil: 'domcontentloaded' });
      await app.evaluate(({ BrowserWindow, session }, downloads) => {
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1500, height: 1000 });
        session.defaultSession.on('will-download', (_event, item) => item.setSavePath(downloads + '/' + item.getFilename()));
      }, root + '/downloads');
    } else {
      server = http.createServer((req, res) => {
        const base = stage + '/stage/renderer', url = new URL(req.url, 'http://127.0.0.1');
        let file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(base + '/')) { res.writeHead(404); res.end(); return; }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = base + '/index.html';
        res.setHeader('content-type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html');
        fs.createReadStream(file).pipe(res);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ executablePath: arg('--chrome'), headless: true });
      const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
      page = await context.newPage();
      await page.addInitScript(() => { window.__BACKEND_URL = location.origin; });
      await page.goto('http://127.0.0.1:' + server.address().port + '/index.html');
    }
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if(message.type()==='error') console.error('BROWSER', message.text()); });
    page.on('dialog', async dialog => { result.checks.push('Dialog: ' + dialog.message()); await dialog.accept(); });
    await page.route('**/api/**', async route => {
      // CSV streams through the native loopback file service. Keep that real;
      // only remote AI and unrelated cloud calls use controlled responses.
      const url=new URL(route.request().url());
      const localFileService=['127.0.0.1','localhost'].includes(url.hostname)||(url.protocol==='xhandle:'&&url.hostname==='app');
      if(app && localFileService && url.pathname.startsWith('/api/project-transfer-files'))return route.continue();
      if (!route.request().url().endsWith('/api/chat')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"projects":[],"rows":[]}' });
      const body = route.request().postDataJSON(), prompt = body.messages?.find(message => message.role === 'user')?.content || '';
      result.requests.push({ workflow: body.xhandleWorkflow, prompt: prompt.slice(0, 180), length: prompt.length });
      fs.writeFileSync(root + '/prompt-' + result.requests.length + '.txt', prompt);
      assert(result.requests.length < 60, 'Requests remain bounded');
      let content, finishReason = 'stop';
      if (prompt.includes('Return ONLY one JSON object with arrays losses and hazards')) content = { losses: [{ id: 'L1', statement: 'Fatal injury to pedestrians.' }], hazards: [{ id: 'H1', statement: 'Vehicle enters an occupied crossing without stopping.' }] };
      else if(prompt.startsWith('You are consolidating hazard-analysis rows into a concise set of Consolidated Safety Issues.')){
        const evidence=prompt.split('Safety hazard evidence, grouped only to reduce transport size (the grouping does not decide issue boundaries):\n')[1];
        const families=JSON.parse(evidence.split('\n')[0]);
        assert(families.length && families.every(family=>family.familyId),'Safety issue fixture receives exact evidence families');
        content={issues:[{title:'Loss of braking before an occupied crossing',description:'Loss of the commanded braking response permits crossing entry and pedestrian impact. The linked brake-command variants require a common stopping safeguard and fault-injection campaign.',likelihood:4,severity:5,tags:'braking',sourceFamilyIds:families.map(family=>family.familyId)}]};
      }
      else {
        const inputs = lastArray(prompt);
        const entries = inputs.map(input => answer(input.id || input.row?.id || input.item?.id));
        assert(entries.every(entry => entry.id), 'Provider response is tied to input ids');
        const hara = prompt.includes('Perform the ISO 26262-3 HARA risk-assessment step');
        content = hara ? { assessments: entries } : entries;
        if (hara) {
          assert(body.max_tokens >= 12000, 'HARA reserves output instead of using the generic 1,200-token default');
          result.outputRecovery.requests.push({ ids: entries.map(entry=>entry.id), maxTokens: body.max_tokens });
          if (!result.outputRecovery.singleton && entries.length === 1) {
            result.outputRecovery.singleton = true; finishReason = 'length';
            // Even parseable JSON is incomplete when the provider says length.
            content = { assessments: entries.map(entry=>({...entry,severity:'S0'})) };
          } else if (!result.outputRecovery.batch && entries.length > 1) {
            result.outputRecovery.batch = true; finishReason = 'length';
          }
        }
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(content) } }] }) });
    });
    await page.getByRole('button', { name: 'Design Management', exact: true }).waitFor();
    await page.evaluate(async () => {
      localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'hara-fixture', name: 'HARA brake fixture' }]));
      localStorage.setItem('xhandle.activeProjectId', 'hara-fixture');
      localStorage.setItem('xhandle.projectData', JSON.stringify({ 'hara-fixture': { riskMethod: 'STPA-Textbook', haraItemDefinition: 'Automated vehicle braking item; vehicle controller and brake actuator; pedestrian crossings in the operating domain; no driver; response bound 100 ms per timing analysis.', responseRows: [{ id: 'brake-interface', fromFunction: 'Vehicle controller', fromDetails: 'Automated urban driving controller. The braking item has an independent stop function that holds standstill with propulsion inhibited.', controlAction: 'Brake command', controlDetails: 'The brake actuator depends on the Brake command to stop the vehicle at occupied pedestrian crossings.', toFunction: 'Brake actuator', toDetails: 'Actuator applies braking from the brake command.' }], hazardOperationalContexts: [{ id: 'crossing', scenario: 'Occupied pedestrian crossing', mode: 'Automated urban driving', conditions: 'Wet pavement; frequent crossings; no human driver.', assumptions: 'Recorded timing bound 100 ms.' }] } }));
      localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'hara-code', name: 'HARA code fixture', activeRepoId: 'brakes', repos: [{ id: 'brakes', repoId: 'brakes', repoName: 'brakes' }] }]));
      const db = await new Promise((resolve,reject) => { const request=indexedDB.open('xhandle',4); request.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const transaction=db.transaction('copilot_baseline','readwrite');
      const done=new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});
      transaction.objectStore('copilot_baseline').put({key:'cba:hara-code:brakes',value:[{traceId:'brake-code',fromFunction:'Vehicle controller',controlAction:'Brake command',toFunction:'Brake actuator',fromArchitecture:{subsystem:'Braking'},toArchitecture:{subsystem:'Braking'}}]});
      await done; db.close();
    });
    await page.reload();
    await page.getByRole('button', { name: 'HARA brake fixture', exact: true }).click();
    await page.getByText('Hazard Analysis', { exact: true }).click();
    const method = page.getByLabel('Hazard analysis method', { exact: true });
    await method.waitFor(); await page.waitForFunction(() => !document.querySelector('[aria-label="Hazard analysis method"]').disabled);
    assert.deepEqual(await method.locator('option').allTextContents(), ['STPA','HARA (ISO 26262)']);
    await checkOperationalColumns('STPA draft exposes Operational Mode and Operating Conditions as separate table columns');
    await method.selectOption('HARA');
    assert.equal(await page.getByRole('textbox', { name: 'HARA item definition', exact: true }).count(), 0);
    check('Projects offers HARA with existing operational contexts and no Item definition text box');
    await page.getByRole('button', { name: 'Generate', exact: true }).first().click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button=>/Generating(?:…|\.\.\.)/.test(button.textContent)), null, { timeout: 90000 });
    await waitForSavedHead(head => head?.analysisResult?.Summary?.[0]?.includes('Severity') && head.analysisResult.Summary.length > 1);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Hazard analysis method"]').disabled);
    await page.waitForTimeout(400);
    let head = await readHead();
    fs.writeFileSync(root+'/generated-head.json', JSON.stringify(head,null,2));
    const cell = name => head.analysisResult.Summary[1][head.analysisResult.Summary[0].indexOf(name)];
    assert.equal(cell('Assessment Gaps'), ''); assert(cell('Unsafe Control Action').includes('omits the brake command')); assert.equal(cell('ASIL'), 'ASIL D'); assert.equal(cell('Severity'), 'S3'); assert.equal(cell('Exposure'), 'E4'); assert.equal(cell('Controllability'), 'C3');
    assert(head.analysisResult['Safety Goals'].length > 1); assert(cell('Hazardous Event ID')); assert(cell('Safety Goal ID'));
    await checkOperationalColumns('Completed HARA exposes Operational Mode and Operating Conditions as separate table columns');
    assert.equal(cell('Operational Mode'), 'Automated urban driving');
    assert.equal(cell('Operating Conditions'), 'Wet pavement; frequent crossings; no human driver.');
    check('Generate row runs shared STPA mechanics followed by HARA and persists linked safety goals');
    assert.deepEqual(result.outputRecovery.requests.slice(0,2).map(request=>request.maxTokens),[12000,16000]);
    check('A provider output-limit response retries automatically with more output and never publishes its incomplete ratings');
    await page.screenshot({ path: root + '/hara-generated.png' });
    await method.selectOption('STPA-Textbook');
    await page.waitForFunction(() => document.querySelector('[aria-label="Hazard analysis method"]').value === 'STPA-Textbook');
    assert.equal((await readHead()).analysisResult, null);
    await method.selectOption('HARA');
    await page.getByRole('textbox', { name: 'Severity, row 1', exact: true }).waitFor();
    head = await readHead();
    assert.equal(cell('ASIL'), 'ASIL D');
    check('Switching methods preserves HARA and does not reinterpret it as STPA');
    const severity = page.getByRole('textbox', { name: 'Severity, row 1', exact: true });
    await severity.fill('S1'); await severity.press('Tab');
    await page.waitForTimeout(700); head = await readHead();
    assert.equal(cell('ASIL'), 'ASIL B'); assert(head.analysisResult['Safety Goals'][1][2].startsWith('ASIL B'));
    check('Editing Severity recalculates event and safety-goal ASIL');
    if (app) {
      await page.getByRole('button', { name: 'Export HARA workbook', exact: true }).click();
      const deadline=Date.now()+15000;
      while(!fs.readdirSync(root+'/downloads').some(name=>name.endsWith('.xlsx')) && Date.now()<deadline)await page.waitForTimeout(100);
      const file=fs.readdirSync(root+'/downloads').find(name=>name.endsWith('.xlsx'));assert(file,'Electron native download completed');
      fs.copyFileSync(root+'/downloads/'+file,root+'/HARA.xlsx');
    } else {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export HARA workbook', exact: true }).click();
      const download = await downloadPromise; await download.saveAs(root + '/HARA.xlsx');
    }
    const XLSX = require(path.resolve('node_modules/xlsx'));
    const workbook = XLSX.readFile(root + '/HARA.xlsx');
    assert.deepEqual(workbook.SheetNames, ['HARA','Safety Goals','Item Definition','HARA Coverage','HARA Quality Review','Candidate Safety Requirements']);
    check('Workbook exports events, goals, item definition, selected-scenario coverage, quality findings and candidate requirements');
    await page.reload(); await page.getByRole('button', {name:'HARA brake fixture',exact:true}).click(); await page.getByText('Hazard Analysis', { exact: true }).click();
    await method.waitFor(); await page.waitForFunction(() => document.querySelector('[aria-label="Hazard analysis method"]').value === 'HARA');
    head = await readHead(); assert.equal(cell('ASIL'), 'ASIL B');
    assert(cell('Item Definition').includes('Automated vehicle braking'));
    check('HARA method, item definition, edited ratings and safety goals survive reload');
    await page.getByRole('button',{name:'Develop risk profile',exact:true}).click();
    // Generation first awaits saved review evidence; the enabled selector can
    // still be visible briefly after click. Wait for the actual saved result.
    await waitForSavedHead(head => head?.analysisResult?.Summary?.length === 8);
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Hazard analysis method"]').disabled,null,{timeout:90000});
    head=await readHead();assert.equal(head.analysisResult.Summary.length,8);assert.equal(cell('Severity'),'S1');
    const severityIndex=head.analysisResult.Summary[0].indexOf('Severity'), applicabilityIndex=head.analysisResult.Summary[0].indexOf('Guide Phrase Applicable');
    assert(head.analysisResult.Summary.slice(2).every(row=>row[severityIndex]===(/^no$/i.test(row[applicabilityIndex])?'Not applicable':'S3')),'Applicable events are assessed; non-applicable deviations never receive invented ratings');
    assert(result.outputRecovery.batch,'The real Generate all path exercised batch truncation');
    const batchIndex=result.outputRecovery.requests.findIndex(request=>request.ids.length>1);assert(batchIndex>=0);
    assert(result.outputRecovery.requests.slice(batchIndex+1).every(request=>request.ids.length===1),'Later requests stay within the recovered batch size');
    assert.equal(result.checks.filter(check=>check.startsWith('Dialog:')).length,0,'Automatic recovery never interrupts the user with a failure alert');
    check('Develop risk profile shrinks a truncated HARA batch, completes every remaining event and preserves the edited assessment');
    await page.reload();
    await page.getByRole('button', {name:'HARA brake fixture',exact:true}).click();
    await page.getByText('Hazard Analysis', { exact: true }).click();
    await method.waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Hazard analysis method"]').disabled);
    head = await readHead();
    assert.equal(head.analysisResult.Summary.length, 8);
    assert.equal(cell('Severity'), 'S1');
    assert(head.analysisResult.Summary.slice(2).every(row=>row[severityIndex]===(/^no$/i.test(row[applicabilityIndex])?'Not applicable':'S3')));
    check('Completed batch recovery and the earlier manual assessment survive a desktop reload');
    if(await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).count()) await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).click();
    await page.locator('#xhandle-primary-sidebar').hover();
    await page.getByRole('button', { name: 'HARA code fixture', exact: true }).click();
    await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
    await page.locator('select:has(option[value="HARA"])').waitFor();
    const options = await page.locator('select').evaluateAll(selects => selects.map(select => [...select.options].map(option => option.textContent)));
    assert(options.some(items => items.includes('STPA') && items.includes('HARA') && !items.includes('FHA')));
    check('Code-Based Architecture offers STPA and HARA without FHA');
    const fixtureDir=process.argv.includes('--fixtures')?arg('--fixtures'):path.resolve(stage,'../fixtures');
    await page.addScriptTag({path:path.join(fixtureDir,'extra.seed.js')});
    const generated=await page.evaluate(()=>window.seedCodeHaraAudit());
    async function openCodeHara(){
      // Keep the seeded navigation available while reload changes pointer/layout state.
      await page.evaluate(()=>localStorage.setItem('xhandle.sidebarLocked','true'));
      await page.reload();
      if(await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).count())await page.getByRole('button',{name:'Restore navigation sidebar',exact:true}).click();
      await page.locator('#xhandle-primary-sidebar').hover();
      await page.locator('#xhandle-primary-sidebar').getByRole('button',{name:'HARA code fixture',exact:true}).click();
      await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
      const selector=page.locator('select:has(option[value="HARA"])').first();
      await selector.waitFor();if(await selector.inputValue()!=='HARA')await selector.selectOption('HARA');
      await page.getByRole('table',{name:'Code architecture hazard analysis',exact:true}).waitFor();
    }
    await openCodeHara();
    const codeTable=page.getByRole('table',{name:'Code architecture hazard analysis',exact:true});
    for(const column of generated.columns)assert.equal(await codeTable.getByTitle('Filter '+column,{exact:true}).count(),1,column+' is available as a filterable column');
    assert.equal(await page.getByRole('textbox',{name:'HARA item definition',exact:true}).count(),0);
    await codeTable.getByTitle('Filter Fault Tolerant Time Interval',{exact:true}).click();
    await page.getByPlaceholder('Search values...',{exact:true}).fill('100');
    await page.getByRole('checkbox',{name:'100 ms',exact:true}).check();
    await page.getByRole('status').filter({hasText:/^1 of 2 rows match filters$/}).waitFor();
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await page.getByRole('status').filter({hasText:/^2 of 2 rows match filters$/}).waitFor();
    check('Code HARA exposes all Projects fields, including FTTI and separate rationales, with searchable multiselect filtering');
    await codeTable.getByTitle('Filter Fault Tolerant Time Interval',{exact:true}).click();
    if(app){
      await page.getByRole('button',{name:'Export CSV',exact:true}).click();
      const deadline=Date.now()+15000;
      while(!fs.readdirSync(root+'/downloads').some(name=>name.endsWith('.csv'))&&Date.now()<deadline)await page.waitForTimeout(100);
      const file=fs.readdirSync(root+'/downloads').find(name=>name.endsWith('.csv'));assert(file,'Code HARA CSV download completed');
      const csv=XLSX.utils.sheet_to_json(XLSX.readFile(root+'/downloads/'+file,{type:'file',raw:true}).Sheets.Sheet1,{header:1});
      for(const column of generated.columns)assert(csv[0].includes(column),'Export contains '+column);
      assert(csv.slice(1).some(row=>row[csv[0].indexOf('Fault Tolerant Time Interval')]==='100 ms'));
      check('Code HARA CSV retains the new assessment fields and supplied timing values');
    }
    await openCodeHara();
    await codeTable.getByTitle('Filter Fault Tolerant Time Interval',{exact:true}).click();
    await page.getByRole('checkbox',{name:'100 ms',exact:true}).waitFor();
    check('New Code HARA values survive a full Electron reload');
    await page.addScriptTag({path:path.join(fixtureDir,'extra.seed.js')});
    await page.evaluate(()=>window.seedCodeHaraAudit({legacy:true}));
    await openCodeHara();
    for(const column of generated.columns)assert.equal(await codeTable.getByTitle('Filter '+column,{exact:true}).count(),1,'Legacy result exposes '+column);
    await codeTable.getByTitle('Filter Fault Tolerant Time Interval',{exact:true}).click();
    await page.getByRole('checkbox',{name:'(blank)',exact:true}).check();
    await page.getByRole('status').filter({hasText:/^2 of 2 rows match filters$/}).waitFor();
    assert.equal(await page.getByRole('checkbox',{name:'100 ms',exact:true}).count(),0);
    check('Legacy Code HARA results expose missing fields as blank and support filtering without invented timing evidence');
    await page.screenshot({path:root+'/code-hara-columns.png'});
    assert.deepEqual(result.errors, []);
  } catch (error) {
    result.failure = error.stack; console.error(error);
    if (page) { fs.writeFileSync(root+'/failure-head.json',JSON.stringify(await readHead().catch(()=>null),null,2)); await page.screenshot({ path: root + '/failure.png' }).catch(() => {}); fs.writeFileSync(root + '/body.txt', await page.locator('body').innerText().catch(() => '')); }
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(root + '/result.json', JSON.stringify(result, null, 2)); console.log('RESULT', root + '/result.json');
    if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{}); await app?.close(); await browser?.close(); server?.close();
  }
})();
