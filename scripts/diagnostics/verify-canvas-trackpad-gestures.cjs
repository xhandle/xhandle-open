// Uses an isolated browser profile and a synthetic project, never user data.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/verify-canvas-trackpad-gestures.cjs
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
(async () => {
  const browserName = process.env.GESTURE_BROWSER || 'chromium';
  const browser = browserName === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, executablePath: process.env.XHANDLE_CHROME_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 },
      ...(process.env.GESTURE_WINDOWS === '1' ? { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' } : {}) });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(windows => {
      if (windows) Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      const id = 'gesture-review-fixture';
      localStorage.setItem('xhandle.projects', JSON.stringify([{ id, name: 'Gesture review fixture' }]));
      localStorage.setItem('xhandle.sidebarProjectsOpen', 'true');
      localStorage.setItem('xhandle.projectData', JSON.stringify({ [id]: { responseRows: [
        { system: 'Vehicle', subsystem: 'Planning', fromFunction: 'Plan', controlAction: 'Command', toFunction: 'Control' },
        { system: 'Vehicle', subsystem: 'Control', fromFunction: 'Control', controlAction: 'Feedback', toFunction: 'Plan' },
      ] } }));
      window.gestureEvents = [];
      for (const phase of [true, false]) for (const type of ['keydown', 'keyup', 'wheel']) {
        document.addEventListener(type, event => window.gestureEvents.push({ type, phase: phase ? 'capture' : 'bubble',
          key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, dx: event.deltaX, dy: event.deltaY }), phase);
      }
    }, process.env.GESTURE_WINDOWS === '1');
    await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000');
    await page.getByRole('button', { name: 'Gesture review fixture', exact: true }).click({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
    await page.waitForTimeout(600);
    const platform = await page.evaluate(() => navigator.platform);
    const modifier = /Mac/.test(platform) ? 'Meta' : 'Control';
    const viewport = () => page.evaluate(() => {
      const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    });
    const scroll = async () => {
      const rect = await page.locator('.react-flow').boundingBox();
      await page.mouse.move(rect.x + 30, rect.y + 30);
      const before = await viewport();
      await page.mouse.wheel(80, 120);
      await page.waitForTimeout(250);
      const after = await viewport();
      return { before, after, zoomChanged: Math.abs(before.zoom - after.zoom) > 0.0001 };
    };
    const baseline = await scroll();
    const assertPan = (result, label) => {
      assert(!result.zoomChanged, label + ': scrolling changed zoom');
      assert(result.before.x !== result.after.x || result.before.y !== result.after.y, label + ': scrolling did not pan');
    };
    assertPan(baseline, 'Before search');
    const fit = async () => {
      await page.getByTitle('Fit entire diagram to view', { exact: true }).click();
      await page.waitForTimeout(650);
    };
    const plan = page.locator('.react-flow__node[data-id="n:Plan"]');
    const control = page.locator('.react-flow__node[data-id="n:Control"]');
    const nodeCount = await page.locator('.react-flow__node').count();
    const closeResults = {};
    for (const method of ['button', 'escape', 'result-click', 'result-enter', 'backdrop']) {
      await fit();
      await plan.click();
      await page.keyboard.down(modifier);
      await page.keyboard.down('f');
      const input = page.getByRole('combobox', { name: 'Search current view' });
      await input.waitFor();
      await page.keyboard.up('f');
      await page.keyboard.up(modifier);
      await input.fill('Planx');
      await page.keyboard.press('Backspace');
      assert.equal(await input.inputValue(), 'Plan');
      await page.keyboard.press('Delete');
      assert.equal(await input.inputValue(), 'Plan');
      assert.equal(await page.locator('.react-flow__node').count(), nodeCount, 'Deleting search text removed nodes');
      if (method === 'button') await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
      else if (method === 'escape') await page.keyboard.press('Escape');
      else if (method === 'result-click') await page.getByRole('option').first().click();
      else if (method === 'result-enter') await page.keyboard.press('Enter');
      else await page.locator('[data-quick-search]').click({ position: { x: 10, y: 10 } });
      await page.getByRole('dialog', { name: 'Quick search', exact: true }).waitFor({ state: 'detached' });
      await page.waitForTimeout(700); // result focus can animate the viewport
      const result = await scroll();
      assertPan(result, method);
      closeResults[method] = result;
      await fit();
      await plan.click();
      await control.click();
      assert.equal(await page.locator('.react-flow__node.selected').count(), 1, 'Multi-selection modifier remained stuck after ' + method);
    }
    // Real modifier-assisted selection must still work after search.
    await page.keyboard.down(modifier);
    await plan.click();
    await page.keyboard.up(modifier);
    assert.equal(await page.locator('.react-flow__node.selected').count(), 2, 'Multi-selection stopped working');
    await control.click();
    // Drag one function within its subsystem without disturbing the layout policy.
    const beforeDrag = await control.evaluate(el => el.style.transform);
    const box = await control.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.notEqual(await control.evaluate(el => el.style.transform), beforeDrag, 'Node drag did not move the node');
    await page.keyboard.down(modifier);
    const deliberateModifierScroll = await scroll();
    await page.keyboard.up(modifier);
    assert(deliberateModifierScroll.zoomChanged, 'Deliberate modifier-scroll zoom stopped working');
    assertPan(await scroll(), 'After deliberate modifier release');
    const beforePinch = await viewport();
    await page.locator('.react-flow__pane').dispatchEvent('wheel', { deltaX: 0, deltaY: 12, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true });
    await page.waitForTimeout(250);
    const afterPinch = await viewport();
    const syntheticPinch = { before: beforePinch, after: afterPinch, zoomChanged: Math.abs(beforePinch.zoom - afterPinch.zoom) > 0.0001 };
    assert(syntheticPinch.zoomChanged, 'Pinch-style ctrl-wheel should zoom');
    const events = await page.evaluate(() => window.gestureEvents);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browserName, platform, baseline, closeResults, deliberateModifierScroll, syntheticPinch, checks: { searchDeletionSafe: true, modifierSelection: true, drag: true }, events, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
