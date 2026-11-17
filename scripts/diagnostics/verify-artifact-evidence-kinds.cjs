#!/usr/bin/env node
// Real production renderer in Electron; isolated workspace and local synthetic AI.
// XHANDLE_PLAYWRIGHT_MODULE=/path/to/playwright-core node this-file --electron <executable> [--build <build>]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.XHANDLE_PLAYWRIGHT_MODULE || 'playwright-core');
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const build = fs.realpathSync(option('--build') || path.resolve(__dirname, '../../build'));
const electron = option('--electron');
if (!electron) throw Error('Provide --electron with the Electron executable.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-evidence-kinds-'));
const report = { root, status: 'running', ok: false, checks: [], requests: [], errors: [], syntheticProvider: true,
  rendererManifestSHA256: createHash('sha256').update(fs.readFileSync(path.join(build, 'asset-manifest.json'))).digest('hex') };
let server, app, page, failFourthReview = true, projectCompletion = false;
const check = message => { report.checks.push(message); console.log('PASS ' + message); };
const writeReport = () => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));

async function stored() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xhandle-design-artifacts');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const all = async name => new Promise((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      return { metadata: await all('metadata'), jobs: await all('jobs'), revisions: await all('revisions') };
    } finally { db.close(); }
  });
}

async function waitForStored(predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await stored();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Artifact persistence did not reach the expected state.');
}

async function action(name, menu = 'Artifact actions') {
  let button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) {
    await page.locator('.design-toolbar-actions button').waitFor();
    let trigger = page.getByRole('button', { name: menu, exact: true });
    if (!await trigger.count()) trigger = page.locator('.design-toolbar-actions button');
    if (await trigger.getAttribute('aria-expanded') === 'false') await trigger.click();
    button = page.locator('.artifact-actions-popover').getByRole('button', { name, exact: true, includeHidden: true });
    if (!await button.isVisible()) await button.locator('xpath=ancestor::details[1]').locator(':scope > summary').click();
  }
  await button.click();
}

(async () => {
  try {
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      let file = path.resolve(build, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(build + path.sep)) { response.writeHead(404); response.end(); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(build, 'index.html');
      response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html');
      fs.createReadStream(file).pipe(response);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const main = path.join(root, 'main.cjs');
    fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(root, 'profile'))});app.setPath('sessionData',${JSON.stringify(path.join(root, 'session'))});app.whenReady().then(()=>{const win=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{backgroundThrottling:false}});win.loadURL(${JSON.stringify(origin + '/index.html')});});app.on('window-all-closed',()=>app.quit());`);
    app = await _electron.launch({ executablePath: electron, args: [main], env: Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]])) });
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), path.join(root, 'profile'));
    page = await app.firstWindow(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(() => { window.__BACKEND_URL = location.origin; });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
      if (url.pathname === '/api/chat') {
        const body = route.request().postDataJSON(), prompt = JSON.parse(body.messages[1].content);
        if (projectCompletion) await page.evaluate(() => { window.__generationElapsedMs += 90000; });
        assert(body.messages[0].content.includes('Fact and constraint are descriptions of content, not kind values'));
        report.requests.push({ section: prompt.section.id, task: prompt.task, correction: !!prompt.formatCorrection });
        const review = prompt.task === 'evidence-review';
        if (review) assert(prompt.synthesisGuidance.includes('Label source-backed facts as kind narrative'));
        const sourceIds = prompt.sources.map(source => source.id);
        assert(sourceIds.every(id => /^S\d+$/.test(id)));
        const objects = [{ key: 'recorded-behavior', kind: review ? ' Fact ' : 'narrative', title: 'Audio processing', text: 'The controller processes captured audio frames.', sourceIds }];
        if (review || prompt.section.id === 's2') objects.push({ key: 'recorded-constraint', kind: review ? 'CONSTRAINT' : 'requirement', title: 'Frame integrity', text: 'The microphone controller shall reject corrupted audio frames.', sourceIds });
        if (failFourthReview && prompt.section.id === 'review-0-3') {
          if (prompt.formatCorrection) assert(prompt.formatCorrection.includes('objects[0].kind was "safety-goal"'));
          objects[0].kind = 'safety-goal';
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects }) } }] }) });
      } else if (url.pathname.startsWith('/api/')) await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, projects: [] }) });
      else await route.continue();
    });
    await page.evaluate(() => {
      localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'fixture-project', name: 'Microphone controller' }]));
      localStorage.setItem('xhandle.projectData', JSON.stringify({ 'fixture-project': { responseRows: [
        { id: 'capture', fromFunction: 'Capture audio', controlAction: 'Audio frame', toFunction: 'Process audio', controlDetails: 'Send captured audio frames for processing.' },
        { id: 'status', fromFunction: 'Process audio', controlAction: 'Audio status', toFunction: 'Report status', controlDetails: 'Report processed audio status.' },
      ] } }));
      localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'fixture-folder', name: 'Evidence regression', modules: [{ id: 'fixture-source', name: 'Recorded inputs', type: 'Requirement' }] }]));
      localStorage.setItem('xhandle:req-active-project', JSON.stringify('fixture-folder'));
      localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ id: `need${index}`, title: `Recorded input ${index}`, folderId: 'fixture-folder', moduleId: 'fixture-source', module: 'Recorded inputs', attributes: { Description: 'Evidence '.repeat(1200) }, parentId: null, order: index }))));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Design Management', exact: true }).click();
    await action('Generate engineering artifact', 'Design Management actions');
    const dialog = page.getByRole('dialog', { name: 'Generate engineering artifact', exact: true });
    await dialog.locator('label').filter({ hasText: /^Document type/ }).locator('select').selectOption('system-spec');
    await dialog.getByLabel('Title', { exact: true }).fill('Evidence-kind system specification');
    await dialog.locator('label').filter({ hasText: /^Owning project/ }).locator('select').selectOption('functional:fixture-project');
    await dialog.locator('label').filter({ hasText: /^Destination folder/ }).locator('select').selectOption('fixture-folder');
    await dialog.getByLabel('System', { exact: true }).fill('Microphone controller');
    await dialog.getByRole('group', { name: 'Source modules', exact: true }).getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: 'Create draft', exact: true }).click();
    await action('Generate / resume draft');
    await page.getByText(/Evidence review 4 of 4: The AI returned an unsupported type/).first().waitFor();
    const paused = await stored(), saved = paused.jobs[0];
    assert.equal(saved.state, 'paused');
    assert.deepEqual(Object.keys(saved.evidenceBrief.rounds[0].completed), ['0', '1', '2']);
    assert.equal(saved.sources.entries.length, 30);
    assert.equal(report.requests.filter(request => request.section === 'review-0-3').length, 2);
    await page.screenshot({ path: path.join(root, 'paused.png') });
    check('Unknown type receives a targeted bounded retry; three earlier evidence reviews and all 30 sources are saved');
    failFourthReview = false;
    await page.reload();
    await page.getByRole('button', { name: 'Design Management', exact: true }).click();
    await page.locator('[data-library-kind="artifact"]').getByRole('button', { name: 'Evidence-kind system specification', exact: true }).click();
    const resumeIndex = report.requests.length;
    await action('Generate / resume draft');
    const ready = (await waitForStored(value => value.jobs[0]?.state === 'ready')).jobs[0];
    assert.equal(ready.token, saved.token); assert.deepEqual(ready.sources, saved.sources);
    assert.equal(Object.keys(ready.sections).length, 6);
    for (let index = 0; index < 3; index++) assert.deepEqual(ready.evidenceBrief.rounds[0].completed[index], saved.evidenceBrief.rounds[0].completed[index]);
    assert.deepEqual(ready.evidenceBrief.rounds[0].completed[3].map(object => object.kind), ['narrative', 'requirement']);
    assert(!report.requests.slice(resumeIndex).some(request => ['review-0-0', 'review-0-1', 'review-0-2'].includes(request.section)));
    const sourceIds = ready.sources.entries.map(source => source.id);
    for (const section of Object.values(ready.sections)) for (const object of section.filter(object => object.kind !== 'section')) assert.deepEqual(object.sourceIds, sourceIds);
    check('Reload and resume reuse every saved review; facts and constraints complete all six sections with original citations');
    await action('Review proposal');
    await action('Accept proposal');
    await waitForStored(value => value.metadata[0]?.revision === 1);
    await page.reload();
    const published = await stored();
    assert.equal(published.metadata[0].revision, 1); assert.equal(published.jobs.length, 0);
    assert(published.revisions[0].objects.some(object => object.kind === 'requirement' && object.text === 'The microphone controller shall reject corrupted audio frames.'));
    await page.getByRole('button', { name: 'Design Management', exact: true }).click();
    await page.locator('[data-library-kind="artifact"]').getByRole('button', { name: 'Evidence-kind system specification', exact: true }).click();
    await page.screenshot({ path: path.join(root, 'completed.png') });
    assert.deepEqual(report.errors, []);
    check('Accepted specification and complete requirement persist after reload without renderer errors');

    // Age the renderer's wall clock during real UI/fetch/storage operations.
    // This deterministically crosses the former run cutoff without a 36-minute
    // sleep. Provider request deadlines continue to use real timers.
    await action('Generate systems engineering project');
    const projectDialog = page.getByRole('dialog', { name: 'Generate systems engineering project', exact: true });
    await projectDialog.getByLabel('Project name', { exact: true }).fill('Finite project completion');
    await projectDialog.getByLabel('System', { exact: true }).fill('Microphone controller');
    await projectDialog.locator('label').filter({ hasText: /^Destination folder/ }).locator('select').selectOption('fixture-folder');
    await projectDialog.getByRole('group', { name: 'Owning source projects', exact: true }).getByRole('checkbox').first().check();
    await projectDialog.getByRole('group', { name: 'Source diagrams', exact: true }).getByRole('checkbox').first().check();
    await projectDialog.getByRole('button', { name: 'Select all document types', exact: true }).click();
    await projectDialog.getByRole('button', { name: 'Create systems engineering project', exact: true }).click();
    const initialProject = (await waitForStored(value => value.metadata.some(meta => meta.title === 'Finite project completion'))).metadata.find(meta => meta.title === 'Finite project completion');
    projectCompletion = true;
    await page.evaluate(() => {
      window.__nativeDateNow = Date.now; window.__generationElapsedMs = 0;
      Date.now = () => window.__nativeDateNow() + window.__generationElapsedMs;
    });
    const projectRequestStart = report.requests.length;
    await action('Generate / resume project', 'Project actions');
    const complete = await waitForStored(value => value.metadata.find(meta => meta.id === initialProject.id)?.state === 'ready');
    const members = complete.metadata.filter(meta => meta.programId === initialProject.id);
    assert.equal(members.length, 5);
    assert.deepEqual(members.map(meta => meta.templateId).sort(), ['architecture', 'conops', 'hardware-spec', 'software-spec', 'system-spec']);
    assert(members.every(meta => complete.jobs.find(job => job.id === meta.id)?.state === 'ready'));
    assert.equal(report.requests.length - projectRequestStart, 24);
    report.simulatedProjectElapsedMs = await page.evaluate(() => window.__generationElapsedMs);
    assert(report.simulatedProjectElapsedMs > 900000);
    await page.evaluate(() => { Date.now = window.__nativeDateNow; window.dispatchEvent(new Event('focus')); });
    projectCompletion = false;
    await page.waitForTimeout(2500);
    const checkedProject = await stored();
    assert(checkedProject.metadata.filter(meta => meta.programId === initialProject.id).every(meta => meta.freshness === 'current'));
    await page.screenshot({ path: path.join(root, 'project-complete.png') });
    check('Five-document project completes a simulated 36-minute run; unchanged sources remain current');
    await action('Review project proposal', 'Project actions');
    await action('Accept complete project', 'Project actions');
    await waitForStored(value => value.metadata.find(meta => meta.id === initialProject.id)?.state === 'accepted');
    await page.reload();
    const acceptedProject = await stored();
    assert(acceptedProject.metadata.filter(meta => meta.programId === initialProject.id).every(meta => meta.revision === 1));
    assert(!acceptedProject.jobs.some(job => members.some(meta => meta.id === job.id)));
    assert.deepEqual(report.errors, []);
    check('All five project revisions publish together and persist after reload');
    report.status = 'passed'; report.ok = true;
  } catch (error) {
    report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1;
    if (page) {
      await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
      report.visibleText = await page.locator('body').innerText().catch(() => 'Page unavailable');
    }
  }
  finally {
    writeReport(); console.log('RESULT ' + path.join(root, 'result.json'));
    if (app) await app.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
