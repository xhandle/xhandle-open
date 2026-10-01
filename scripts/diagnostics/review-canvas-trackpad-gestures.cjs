// Uses an isolated browser profile and a synthetic project, never user data.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/review-canvas-trackpad-gestures.cjs
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
    assert(!baseline.zoomChanged, 'Ordinary scrolling should pan before search');
    // Release keys only after the search input has focus, as a human can do.
    await page.keyboard.down(modifier);
    await page.keyboard.down('f');
    await page.getByRole('combobox', { name: 'Search current view' }).waitFor();
    await page.keyboard.up('f');
    await page.keyboard.up(modifier);
    await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
    const afterSearch = await scroll();
    // A fresh modifier press/release outside the modal clears the stuck state.
    await page.keyboard.down(modifier);
    await page.keyboard.up(modifier);
    const afterModifierReset = await scroll();
    // Opening search with its button never starts a canvas modifier press.
    await page.getByRole('button', { name: 'Quick search', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search current view' }).waitFor();
    await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
    const afterButtonSearch = await scroll();
    const beforePinch = await viewport();
    await page.locator('.react-flow__pane').dispatchEvent('wheel', { deltaX: 0, deltaY: 12, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true });
    await page.waitForTimeout(250);
    const afterPinch = await viewport();
    const syntheticPinch = { before: beforePinch, after: afterPinch, zoomChanged: Math.abs(beforePinch.zoom - afterPinch.zoom) > 0.0001 };
    assert(syntheticPinch.zoomChanged, 'Pinch-style ctrl-wheel should zoom');
    const events = await page.evaluate(() => window.gestureEvents);
    assert(!afterModifierReset.zoomChanged, 'Modifier reset should restore panning');
    assert(!afterButtonSearch.zoomChanged, 'Search button should preserve panning');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browserName, platform, baseline, afterSearch, afterModifierReset, afterButtonSearch, syntheticPinch, events, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
