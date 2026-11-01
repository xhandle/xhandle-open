const assert = require('node:assert/strict');
const quant = values => { const a = [...values].sort((x, y) => x - y); return { n: a.length, median: a[Math.floor(a.length / 2)], p95: a[Math.ceil(a.length * .95) - 1], max: a.at(-1) }; };

// Chromium represents two-finger trackpad scrolling as ordinary wheel input;
// pinching uses ctrl-wheel. Test both axes and reverse direction independently
// of the middle-button dragging benchmark.
module.exports = async ({ page, cdp, setup, zooms, report }) => {
  report.trackpadPan = [];
  for (const scale of ['overview', 'close']) {
    await setup(zooms[scale]);
    const box = await page.locator('.react-flow__pane').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const renderer = document.querySelector('.react-flow__renderer');
      const state = window.__trackpadPan = { before: { ...renderer.__zoom }, scroll: [scrollX, scrollY], events: [], frames: [], first: null, last: null };
      const input = event => { const time = performance.now(); state.first ??= time; state.last = time; state.events.push({ x: event.deltaX, y: event.deltaY, ctrl: event.ctrlKey, trusted: event.isTrusted }); };
      window.addEventListener('wheel', input, { capture: true, passive: true });
      let previous = performance.now();
      const tick = time => { state.frames.push({ start: previous, time, ms: time - previous, camera: { ...renderer.__zoom } }); previous = time; state.raf = requestAnimationFrame(tick); };
      state.raf = requestAnimationFrame(tick);
      state.stop = () => { cancelAnimationFrame(state.raf); window.removeEventListener('wheel', input, true); };
    });
    for (const direction of [1, -1]) {
      const pending = [];
      for (let i = 0; i < 60; i++) {
        pending.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x + box.width / 2, y: box.y + box.height / 2, deltaX: direction * 6, deltaY: direction * 4, modifiers: 0 }));
        await new Promise(resolve => setTimeout(resolve, 8));
      }
      await Promise.all(pending);
      await page.waitForFunction(direction => {
        const state = window.__trackpadPan, camera = document.querySelector('.react-flow__renderer').__zoom;
        const dx = direction === 1 ? -180 : 0, dy = direction === 1 ? -120 : 0;
        return Math.abs(camera.x - state.before.x - dx) < .01 && Math.abs(camera.y - state.before.y - dy) < .01;
      }, direction, { timeout: 20000 });
      if (direction === 1) await page.evaluate(() => { window.__trackpadPan.forward = { ...document.querySelector('.react-flow__renderer').__zoom }; });
    }
    await page.waitForFunction(() => performance.now() - window.__trackpadPan.last >= 650, null, { timeout: 20000 });
    const measured = await page.evaluate(() => {
      const state = window.__trackpadPan; state.stop();
      return { before: state.before, forward: state.forward, after: { ...document.querySelector('.react-flow__renderer').__zoom },
        received: state.events.length, trusted: state.events.every(e => e.trusted && !e.ctrl), deltaX: state.events.reduce((s, e) => s + e.x, 0), deltaY: state.events.reduce((s, e) => s + e.y, 0),
        zoomUnchanged: state.frames.every(f => f.camera.k === state.before.k), pageScrollUnchanged: scrollX === state.scroll[0] && scrollY === state.scroll[1],
        inputMs: state.last - state.first, frames: state.frames.filter(f => f.start >= state.first && f.time <= state.last).map(f => f.ms), moving: !!document.querySelector('[data-viewport-moving]') };
    });
    assert.equal(measured.trusted, true);
    assert.equal(measured.deltaX, 0); assert.equal(measured.deltaY, 0);
    assert.equal(measured.zoomUnchanged, true, 'Two-finger panning must never zoom');
    assert.equal(measured.pageScrollUnchanged, true, 'The diagram pans without scrolling the page');
    assert.equal(measured.moving, false, 'Motion presentation restores after trackpad panning');
    assert.ok(measured.frames.length > 3);
    const sample = { scale, sent: 120, ...measured, frames: quant(measured.frames) };
    report.trackpadPan.push(sample); console.log('Trackpad pan', JSON.stringify(sample));
  }
};
