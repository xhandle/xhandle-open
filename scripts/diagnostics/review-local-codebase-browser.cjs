// Read-only capability probe using an isolated browser page and synthetic files.
// Does not load xHandle, read user projects, invoke AI, or persist application data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const engines = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xhandle-folder-review-'));
  const project = path.join(root, 'sample-project');
  try {
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await fs.writeFile(path.join(project, 'README.md'), '# Synthetic fixture\n');
    await fs.writeFile(path.join(project, 'src', 'control.js'), 'export function stop() { return 0; }\n');
    for (const engine of ['chromium', 'webkit']) {
      const browser = await engines[engine].launch({
        headless: true,
        ...(engine === 'chromium' && process.env.XHANDLE_CHROME_PATH
          ? { executablePath: process.env.XHANDLE_CHROME_PATH } : {}),
      });
      try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.fulfill({
          contentType: 'text/html',
          body: '<input type="file" webkitdirectory multiple>',
        }));
        await page.goto('http://localhost:3000/__local-folder-capability-probe');
        const capabilities = await page.evaluate(() => ({
          secureContext: window.isSecureContext,
          showDirectoryPicker: typeof window.showDirectoryPicker === 'function',
          directoryInput: 'webkitdirectory' in document.querySelector('input'),
        }));
        await page.locator('input').setInputFiles(project);
        const files = await page.locator('input').evaluate(async input => Promise.all(
          [...input.files].map(async file => ({ path: file.webkitRelativePath, text: await file.text() })),
        ));
        assert.deepEqual(files.map(file => file.path).sort(), [
          'sample-project/README.md', 'sample-project/src/control.js',
        ]);
        assert.ok(files.find(file => file.path.endsWith('control.js')).text.includes('function stop'));
        console.log(JSON.stringify({ engine, ...capabilities, relativePaths: files.map(file => file.path) }));
      } finally {
        await browser.close();
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
