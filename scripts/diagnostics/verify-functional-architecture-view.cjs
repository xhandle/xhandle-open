// Fresh browser context, synthetic evidence and stubbed semantic processing.
// No customer records or paid model calls.
const { chromium } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || '/tmp/xhandle-copy-check/node_modules/playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.XHANDLE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status: 401, body: 'fixture' }));
    await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000');
    await page.evaluate(async () => {
      const chunk = Object.keys(window).find(k => k.startsWith('webpackChunk'));
      window[chunk].push([[Date.now()], {}, req => { window.fixtureRequire = req; }]);
      const req = window.fixtureRequire;
      const React = req('./node_modules/react/index.js');
      const rootEl = document.createElement('div'); rootEl.style.height = '950px'; document.body.replaceChildren(rootEl);
      const root = req('./node_modules/react-dom/client.js').createRoot(rootEl);
      const Component = req('./src/components/generateFunctionalDecompositionFromGitHub.js').FunctionalDecompositionTable;
      const { processFunctionalModel, buildFunctionalModelRows } = req('./src/features/code-architecture-context/functionalModel.js');
      const { ensureCodeArchitectureTraceIds, buildCodeArchitectureHazardInput } = req('./src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js');
      const arch = { subsystem: 'Vehicle Control', csci: 'Control Software', csc: 'Motion Planning', csu: 'Internal Operations' };
      let rows = Array.from({ length: 20 }, (_, i) => ({ from: 'plan', to: `plan::values.operation${i}`, fromFile: 'src/planner.py', toFile: 'src/planner.py', action: `Call operation${i}`, architecture: arch, relationshipEvidence: { supported: true, targetResolution: 'unresolved-runtime-target' }, traceId: `row-${i}`, rowRef: i + 1 }));
      rows.push({ from: 'plan', to: 'send', fromFile: 'src/planner.py', toFile: 'src/transport.cpp', action: 'Send command', architecture: arch, traceId: 'boundary', rowRef: 21 });
      rows.push({ from: 'send', to: 'actuate', fromFile: 'src/transport.cpp', toFile: 'src/vehicle.cpp', action: 'Actuation request', architecture: { ...arch, subsystem: 'Vehicle Platform', csc: 'Actuation' }, traceId: 'cpp-call', rowRef: 22 });
      rows = ensureCodeArchitectureTraceIds(rows.map(row => ({ ...row, lifecyclePhase: 'Runtime', hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'user' })));
      rows = await processFunctionalModel(rows, { request: async prompt => {
        const data = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
        return { function: { name: data[0].from === 'plan' ? 'Plan Vehicle Motion' : 'Send Motion Request', description: 'Evidence-grounded responsibility.' }, relationships: data.map(row => ({ index: row.index, significance: (row.sourceDefinedTarget || row.crossFile) ? 'meaningful' : 'implementation', disposition: (row.sourceDefinedTarget || row.crossFile) ? 'interaction' : 'internal', target: (row.sourceDefinedTarget || row.crossFile) ? { name: 'Execute Vehicle Motion', description: 'Requested motion at the vehicle boundary.' } : null, action: (row.sourceDefinedTarget || row.crossFile) ? 'Motion Request' : '', kind: 'control', description: 'Motion request information.', rationale: 'Fixture-grounded classification.' })) };
      } });
      window.fixtureRows = rows; window.fixtureChanges = []; window.fixtureOpen = [];
      window.fixtureModel = buildFunctionalModelRows(rows);
      window.fixtureHazard = buildCodeArchitectureHazardInput({ cbaRows: rows });
      // Exercise real IndexedDB persistence and a fresh serialized row reload.
      const storage = req('./src/features/code-architecture-assurance/codeArchitectureStorage.js');
      if (!await storage.writeCbaRowsToIndexedDB('functional-fixture', rows)) throw new Error('fixture save failed');
      const reloaded = await storage.readCbaRowsFromIndexedDB('functional-fixture');
      await storage.writeCbaRowsToIndexedDB('functional-conflict-fixture', rows);
      const revision = await storage.readCbaRowsRevision('functional-conflict-fixture');
      const edited = rows.map((row, index) => index ? row : { ...row, action: 'Concurrent edit' });
      await storage.writeCbaRowsToIndexedDB('functional-conflict-fixture', edited);
      if (await storage.writeCbaRowsToIndexedDB('functional-conflict-fixture', rows, { expectedBaseline: revision })) throw new Error('stale publication accepted');
      if ((await storage.readCbaRowsFromIndexedDB('functional-conflict-fixture'))[0].action !== 'Concurrent edit') throw new Error('concurrent edit lost');
      window.renderFunctionalFixture = sourceType => root.render(React.createElement(Component, { data: reloaded, projectId: 'fixture', rowsStorageKey: 'functional-fixture', repoId: `functional-fixture-${sourceType}`, repoMeta: { sourceType, repoName: 'Fixture' }, onDataChange: value => window.fixtureChanges.push(value), onOpenFunctionalRow: value => window.fixtureOpen.push(value) }));
      window.renderFunctionalFixture('github');
    });
    await page.getByRole('button', { name: 'Functional', exact: true }).click();
    await page.waitForSelector('.react-flow__node-bidirectional');
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.react-flow__node-bidirectional').count(), 3);
    assert.equal(await page.locator('.react-flow__node[data-id^="box:csu:"]').count(), 0, 'Functional responsibilities must not have redundant CSU wrappers');
    assert(await page.locator('.react-flow__node-groupBox').count() >= 4);
    assert.equal(await page.locator('.react-flow__edge').count(), 2);
    const groups = await page.locator('.react-flow__node-groupBox').evaluateAll(nodes => nodes.filter(node => ['Vehicle Control', 'Vehicle Platform'].includes(node.textContent.trim())).map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
    assert.equal(groups.length, 2);
    assert(groups[0].right <= groups[1].x || groups[1].right <= groups[0].x || groups[0].bottom <= groups[1].y || groups[1].bottom <= groups[0].y, 'functional containers overlap');
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.getByRole('button', { name: '20 source rows', exact: true }).click();
    await page.getByRole('button', { name: 'Open in table', exact: true }).first().click();
    assert.equal(await page.evaluate(() => window.fixtureOpen[0].traceId), 'row-0');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Architecture', exact: true }).click();
    await page.getByRole('button', { name: 'Functional', exact: true }).click();
    await page.evaluate(() => window.renderFunctionalFixture('local'));
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.react-flow__node-bidirectional').count(), 3);
    assert.equal(await page.evaluate(() => window.fixtureChanges.length), 0);
    assert.equal(await page.evaluate(() => window.fixtureHazard.analysisAbstraction), 'functional');
    assert.equal(await page.evaluate(() => window.fixtureHazard.sourceTableRows.length), 2);
    assert.equal(await page.evaluate(() => new Set(window.fixtureModel.flatMap(row => row.functionalModel.sourceIndices)).size), 22);
    assert.equal(await page.getByRole('button', { name: 'Inspect supporting calls', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.getByRole('button', { name: '20 source rows', exact: true }).click();
    await page.getByRole('button', { name: 'Show in CSU', exact: true }).first().click();
    await page.waitForTimeout(800);
    assert(await page.locator('.react-flow__node-bidirectional').count() > 3);
    assert(await page.locator('.react-flow__node[data-id^="box:csu:"]').count() > 0, 'Detailed CSU containers must remain available');
    await page.getByRole('button', { name: 'Functional', exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.react-flow__node-bidirectional').count(), 3);
    await page.screenshot({ path: '/tmp/xhandle-functional-view-v2.png' });
    // Exercise the actual ellipsis portal controls, then a real browser reload.
    await page.evaluate(() => {
      const R=window.fixtureRequire('./node_modules/react/index.js');
      const menu=document.createElement('details');menu.id='fixture-menu';menu.innerHTML='<summary>...</summary><div></div>';document.body.append(menu);
      const host=document.createElement('div');host.style.height='900px';document.body.replaceChildren(menu,host);
      window.menuRoot=window.fixtureRequire('./node_modules/react-dom/client.js').createRoot(host);
      window.menuRoot.render(R.createElement(window.fixtureRequire('./src/components/generateFunctionalDecompositionFromGitHub.js').FunctionalDecompositionTable, {data:window.fixtureRows,projectId:'fixture',repoId:'functional-fixture-local',repoMeta:{sourceType:'local',repoName:'Fixture'},rowsStorageKey:'functional-fixture',showViewControls:false,viewControlsTarget:menu.querySelector('div')}));
    });
    await page.locator('#fixture-menu summary').click();
    await page.locator('#fixture-menu').getByRole('button',{name:'Split view',exact:true}).click();
    await page.getByRole('region',{name:'Functional model table',exact:true}).waitFor();
    await page.getByRole('region',{name:'Functional model diagram',exact:true}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Code architecture functional decomposition table',exact:true}).count(),0);
    await page.locator('#fixture-menu summary').click();
    await page.locator('#fixture-menu').getByRole('button',{name:'Table',exact:true}).click();
    assert.equal(await page.getByRole('region',{name:'Functional model diagram',exact:true}).count(),0);
    await page.getByRole('button',{name:'Export CSV',exact:true}).waitFor();
    await page.locator('#fixture-menu summary').click();
    await page.locator('#fixture-menu').getByRole('button',{name:'Architecture',exact:true}).click();
    await page.waitForSelector('.react-flow__edge');
    assert.equal(await page.locator('.react-flow__node-bidirectional').count(),3);
    // First and repeated table-only links use CSU's diagram-only transition.
    for (const mode of ['from', 'action', 'to', 'from']) {
      await page.locator('#fixture-menu summary').click();
      await page.locator('#fixture-menu').getByRole('button', {name:'Table',exact:true}).click();
      const label={from:'Function (From)',action:'Control Action',to:'Function (To)'}[mode];
      const arrow=page.locator(`button[aria-label^="Show ${label} in diagram"]`).first();
      const expected=await page.evaluate(({mode,label})=>{
        const text=document.querySelector(`button[aria-label^="Show ${label} in diagram"]`).getAttribute('aria-label');
        const row=window.fixtureModel.find(row=>text===`Show ${label} in diagram: ${row[mode]}` && (mode==='from'||!row.functionalModel.internal));
        return mode==='action'?[row.fromNodeId,row.toNodeId]:[mode==='to'?row.toNodeId:row.fromNodeId];
      },{mode,label});
      await arrow.click();
      await page.waitForFunction(ids=>ids.every(id=>[...document.querySelectorAll('.react-flow__node.selected')].some(node=>node.dataset.id===id)),expected);
      assert.equal(await page.getByRole('region',{name:'Functional model table',exact:true}).count(),0);
    }
    await page.locator('#fixture-menu summary').click();
    await page.locator('#fixture-menu').getByRole('button',{name:'Split view',exact:true}).click();
    const divider=page.getByRole('separator',{name:'Resize code architecture diagram and functional table panes'});
    await divider.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'55');
    await page.getByRole('button',{name:'CSU',exact:true}).click();
    assert.equal(await divider.getAttribute('aria-valuenow'),'55');
    await page.getByRole('button',{name:'Functional',exact:true}).click();
    assert.equal(await divider.getAttribute('aria-valuenow'),'55');
    const widthHandle=page.getByRole('region',{name:'Functional model table',exact:true}).locator('[title="Drag to resize column"]').first();
    const handleBox=await widthHandle.boundingBox();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+10);await page.mouse.down();await page.mouse.move(handleBox.x+handleBox.width/2+80,handleBox.y+10);await page.mouse.up();
    await page.waitForTimeout(200);
    const savedWidths=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('functional-table-widths-v1:')));
    assert(savedWidths.some(([,value])=>JSON.parse(value).type===300));
    await page.reload();
    await page.evaluate(async()=>{
      window[Object.keys(window).find(k=>k.startsWith('webpackChunk'))].push([[Date.now()],{},r=>window.fixtureRequire=r]);
      const req=window.fixtureRequire,R=req('./node_modules/react/index.js');
      const rows=await req('./src/features/code-architecture-assurance/codeArchitectureStorage.js').readCbaRowsFromIndexedDB('functional-fixture');
      if(!req('./src/features/code-architecture-context/functionalModel.js').functionalModelIsReady(rows))throw Error('Saved functional model is not ready');
      const host=document.createElement('div');host.style.height='900px';document.body.replaceChildren(host);
      req('./node_modules/react-dom/client.js').createRoot(host).render(R.createElement(req('./src/components/generateFunctionalDecompositionFromGitHub.js').FunctionalDecompositionTable,{data:rows,projectId:'fixture',repoId:'functional-fixture-local',repoMeta:{sourceType:'local',repoName:'Fixture'},rowsStorageKey:'functional-fixture'}));
    });
    await page.waitForSelector('.react-flow__edge');await page.waitForTimeout(600);
    assert.equal(await page.locator('.react-flow__node-bidirectional').count(),3);
    assert.equal(await page.getByRole('button',{name:'Generate functional model',exact:true}).count(),0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ sourceRows: 22, functionalNodes: 3, functionalInteractions: 2, nestedContainers: true, nonOverlappingContainers: true, persistedReload: true, realPageReload: true, functionalMenuTableAndSplit: true, firstAndRepeatedArrowLinks: true, sharedSplitRetention: true, columnResizePersistence: true, stalePublicationRejected: true, githubLocalParity: true, sourceCoverage: true, exactTableLink: true, csuDrillThrough: true, hazardUsesFunctionalModel: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
