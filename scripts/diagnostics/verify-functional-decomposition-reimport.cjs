// Isolated browser storage: never connects to the user's browser or projects.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/verify-functional-decomposition-reimport.cjs
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const id = 'csv-replacement-fixture';
const storageKey = `diagram:positions:${id}`;
const original = [
  ['Vehicle', 'Planning', 'Plan', 'Command', 'Control'],
  ['Vehicle', 'Execution', 'Control', 'Feedback', 'Plan'],
];
const updated = [
  ['Vehicle', 'Execution', 'Plan', 'Command', 'Control'],
  ['Vehicle', 'Planning', 'Control', 'Feedback', 'Plan'],
  ['External', 'Dispatch', 'Operator', 'Request', 'Plan'],
];
const fields = ['system', 'subsystem', 'fromFunction', 'controlAction', 'toFunction'];
const csv = rows => ['System,Subsystem,Function (From),Control Action,Function (To)', ...rows.map(row => row.join(','))].join('\n');
(async () => {
  const browser = process.env.VERIFY_BROWSER === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, executablePath: process.env.XHANDLE_CHROME_PATH });
  try {
    for (const mode of ['diagram', 'table', 'split']) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : Promise.reject(new Error(dialog.message())));
      await page.addInitScript(({ id, original, fields }) => {
        if (sessionStorage.getItem('fixture-seeded')) return;
        localStorage.setItem('xhandle.projects', JSON.stringify([{ id, name: 'CSV replacement fixture' }]));
        localStorage.setItem('xhandle.sidebarProjectsOpen', 'true');
        localStorage.setItem('xhandle.projectData', JSON.stringify({ [id]: { responseRows: original.map(row => Object.fromEntries(fields.map((field, i) => [field, row[i]]))) } }));
        sessionStorage.setItem('fixture-seeded', 'true');
      }, { id, original, fields });
      const ready = async () => {
        await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
        await page.waitForTimeout(500);
      };
      const view = async name => {
        await page.locator('summary[aria-label="Functional diagram actions"]').click();
        await page.getByRole('button', { name, exact: true }).click();
      };
      const geometry = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(el => ({
        id: el.dataset.id, position: el.style.transform, width: el.style.width, height: el.style.height,
      })).sort((a, b) => a.id.localeCompare(b.id)));
      const check = async rows => {
        await ready();
        const graph = await geometry();
        const expectedFunctions = [...new Set(rows.flatMap(row => [row[2], row[4]]))];
        for (const name of expectedFunctions) assert(graph.some(node => node.id === 'n:' + name), `Missing function ${name}`);
        const boxes = await page.evaluate(key => JSON.parse(localStorage.getItem(key + ':groups:v1')), storageKey);
        for (const row of rows) {
          const system = boxes.find(box => box.elementType === 'system' && box.label === row[0]);
          assert(system && graph.some(node => node.id === system.id), `Missing system ${row[0]}`);
          const subsystem = boxes.find(box => box.label === row[1] && box.elementType !== 'system');
          assert(subsystem && graph.some(node => node.id === subsystem.id), `Missing subsystem ${row[1]}`);
          assert.equal(subsystem.parentNode, system.id);
        }
        await page.getByTitle('Auto arrange', { exact: true }).click();
        await ready();
        assert.deepEqual(await geometry(), graph, `${mode}: first replacement layout differs from Auto arrange`);
      };
      await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000');
      await page.getByRole('button', { name: 'CSV replacement fixture', exact: true }).click({ timeout: 60000 });
      await ready();
      if (mode !== 'diagram') await view(mode === 'table' ? 'Table' : 'Split view');
      await page.locator('input[type=file][accept=".csv,text/csv"]').first().setInputFiles({ name: 'updated.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(updated)) });
      await page.waitForFunction(({ key }) => JSON.parse(localStorage.getItem('xhandle.projectData'))?.[key]?.responseRows?.length === 3, { key: id });
      if (mode === 'table') await view('Diagram');
      await check(updated);
      // A second replacement in the same project must also initialize once.
      await page.locator('input[type=file][accept=".csv,text/csv"]').first().setInputFiles({ name: 'updated.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(original)) });
      await page.waitForFunction(({ key }) => JSON.parse(localStorage.getItem('xhandle.projectData'))?.[key]?.responseRows?.length === 2, { key: id });
      await check(original);
      const before = await geometry();
      await page.getByRole('tab', { name: 'Hazard Analysis', exact: true }).click();
      await page.getByRole('tab', { name: 'Functional Diagramming', exact: true }).click();
      await ready();
      assert.deepEqual(await geometry(), before, 'Tab switch changed the layout');
      await page.reload();
      await page.getByRole('button', { name: 'CSV replacement fixture', exact: true }).click();
      await ready();
      assert.deepEqual(await geometry(), before, 'Reload changed the layout');
      assert.deepEqual(errors, []);
      console.log(`${mode}: repeated CSV replacements, complete hierarchy, Auto arrange parity, tab switch and reload passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
