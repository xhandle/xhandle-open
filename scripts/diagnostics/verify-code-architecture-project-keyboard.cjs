// Isolated keyboard regression: no real project data or AI calls.
const assert = require('node:assert/strict');
const engines = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const engine = process.env.XHANDLE_BROWSER || 'chromium';
(async () => {
  const browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { executablePath: process.env.XHANDLE_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/chat', route => route.fulfill({ status: 400, body: 'No AI calls in keyboard test' }));
    await page.route('**/__keyboard-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await page.goto('http://localhost:3000/__keyboard-fixture');
    await page.evaluate(() => localStorage.setItem('xhandle.codeArchitectureProjects', '[]'));
    await page.goto('http://localhost:3000');
    const projects = () => page.evaluate(() => JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects') || '[]'));
    const dashboard = async () => {
      await page.getByRole('button', { name: /Code-Based Architecture/ }).first().click({ timeout: 60000 });
      await page.getByRole('heading', { name: 'Code architecture dashboard', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Project', exact: true }).click();
    };
    const input = page.getByPlaceholder('e.g., Interlock System');
    await dashboard();
    await input.fill('Return keyboard fixture');
    const originalInput = await input.elementHandle();
    await page.keyboard.down('Enter');
    assert.equal(await originalInput.evaluate(node => node.isConnected), true, 'Keep the input mounted throughout Return keydown for Safari input inspection');
    assert.equal((await projects()).length, 0, 'Create only on key release');
    await page.keyboard.down('Enter'); // held-key repeat
    await page.keyboard.up('Enter');
    await page.getByRole('heading', { name: 'GitHub repo configuration', exact: true }).waitFor();
    assert.equal((await projects()).length, 1, 'Return creates exactly one project');
    assert.equal((await projects())[0].name, 'Return keyboard fixture');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await dashboard();
    await input.press('Enter');
    await page.getByText('Please enter a project name.', { exact: true }).waitFor();
    await input.fill('Return keyboard fixture');
    await input.press('Enter');
    await page.getByText('A Code-Based Architecture project with this name already exists.', { exact: true }).waitFor();
    assert.equal((await projects()).length, 1);
    await input.fill('Composition fixture');
    await input.evaluate(node => {
      for (const type of ['keydown', 'keyup']) node.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    });
    assert.equal((await projects()).length, 1, 'IME confirmation must not create a project');
    await page.keyboard.down('Escape');
    assert.equal(await input.count(), 1, 'Keep the input mounted throughout Escape keydown');
    await page.keyboard.up('Escape');
    await input.waitFor({ state: 'detached' });
    assert.equal((await projects()).length, 1);

    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await input.fill('Mouse fixture');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('heading', { name: 'GitHub repo configuration', exact: true }).waitFor();
    assert.equal((await projects()).length, 2, 'Mouse creation remains available');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine, returnKey: true, repeat: true, validation: true, composition: true, escape: true, mouse: true, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
