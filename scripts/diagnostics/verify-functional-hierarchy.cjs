// Isolated browser context, synthetic repository, stubbed provider. No paid calls/customer data.
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
    const getRequire = () => {
      const chunk = Object.keys(window).find(key => key.startsWith('webpackChunk'));
      window[chunk].push([[Date.now()], {}, req => { window.fixtureRequire = req; }]);
    };
    await page.evaluate(getRequire);
    const saved = await page.evaluate(async () => {
      const req = window.fixtureRequire;
      const { processFunctionalModel, buildFunctionalModelRows } = req('./src/features/code-architecture-context/functionalModel.js');
      const storage = req('./src/features/code-architecture-assurance/codeArchitectureStorage.js');
      const names = ['Authenticate', 'Authorize', 'Publish', 'Render'];
      const source = names.map((name, i) => ({ from: name, to: names[i + 1] || 'escape', fromFile: `shared/${name}.java`, toFile: `shared/${names[i + 1] || name}.java`, action: 'Send result', traceId: `raw-${i}`, rowRef: i + 1 }));
      const rows = await processFunctionalModel(source, { request: async prompt => {
        if (prompt.includes('Functional hierarchy input:')) {
          const { functions } = JSON.parse(prompt.split('Functional hierarchy input: ')[1]);
          return { allocations: functions.map(unit => ({ id: unit.id, subsystem: 'Service', csci: ['Authenticate', 'Authorize'].includes(unit.name) ? 'Access Management' : 'Content Delivery',
            csc: ({ Authenticate: 'Credentials', Authorize: 'Sessions', Publish: 'Publication', Render: 'Formatting' })[unit.name], rationale: 'Fixture responsibility.' })) };
        }
        const data = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
        return { function: { name: data[0].from, description: `${data[0].from} responsibility.`, significance: 'meaningful' }, relationships: data.map(row => ({ index: row.index,
          significance: row.to === 'escape' ? 'implementation' : 'meaningful', disposition: row.to === 'escape' ? 'internal' : 'interaction', target: { name: row.to, description: 'Destination responsibility.' },
          action: 'Send result', kind: 'data', description: 'Result data.', rationale: 'Fixture boundary.' })) };
      } });
      const saved = await storage.writeCbaRowsToIndexedDB('cba:hierarchy-fixture:local', rows);
      return { saved, ids: buildFunctionalModelRows(rows).map(row => row.traceId) };
    });
    assert(saved.saved);
    await page.reload();
    await page.evaluate(getRequire);
    const restored = await page.evaluate(async () => {
      const req = window.fixtureRequire;
      const React = req('./node_modules/react/index.js');
      const { readCbaRowsFromIndexedDB } = req('./src/features/code-architecture-assurance/codeArchitectureStorage.js');
      const { buildFunctionalModelRows, functionalModelIsReady } = req('./src/features/code-architecture-context/functionalModel.js');
      const { functionalHierarchyIsReady } = req('./src/features/code-architecture-context/functionalHierarchy.js');
      const rows = await readCbaRowsFromIndexedDB('cba:hierarchy-fixture:local');
      const Component = req('./src/components/FunctionalArchitectureDiagram.jsx').default;
      const host = document.createElement('div'); host.style.height = '950px'; document.body.replaceChildren(host);
      req('./node_modules/react-dom/client.js').createRoot(host).render(React.createElement(Component, { rows, ready: true, viewMode: 'split', storageKey: 'hierarchy-fixture', height: 800 }));
      return { ready: functionalModelIsReady(rows), hierarchy: functionalHierarchyIsReady(rows), ids: buildFunctionalModelRows(rows).map(row => row.traceId) };
    });
    assert(restored.ready && restored.hierarchy);
    assert.deepEqual(restored.ids, saved.ids);
    await page.waitForSelector('.react-flow__node[data-id^="box:csc:"]');
    const counts = {};
    for (const kind of ['csci', 'csc', 'csu']) counts[kind] = await page.locator(`.react-flow__node[data-id^="box:${kind}:"]`).count();
    assert.equal(counts.csci, 2); assert.equal(counts.csc, 4); assert.equal(counts.csu, 0);
    assert.equal(await page.locator('.react-flow__node-bidirectional').count(), 4);
    assert(await page.getByTitle('Filter CSCI (From)', { exact: true }).count());
    assert(await page.getByTitle('Filter CSC (To)', { exact: true }).count());
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ persistedAcrossReload: true, stableTraceIds: true, diagram: counts, functions: 4, splitTableHierarchy: true, runtimeErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
