const fs = require('node:fs');
const assert = require('node:assert/strict');

// Attribute first-input work separately from the sustained-gesture benchmark.
// Traced timings are diagnostic only, never substituted for untraced results.
module.exports = async ({ page, cdp, setup, zooms, report, out }) => {
  report.pinchStartupTraces = [];
  for (const scale of ['overview', 'close']) for (const kind of ['button', 'pinch']) {
    await setup(zooms[scale]);
    const box = await page.locator('.react-flow__pane').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    if (await page.locator('.x-architecture-motion').count()) await page.waitForFunction(() => Number(document.querySelector('[data-edge-images-ready]')?.getAttribute('data-edge-images-ready')) > 0, null, { timeout: 20000 });
    await cdp.send('Profiler.start');
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing,cc,gpu,viz,benchmark,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.timeline.invalidationTracking', transferMode: 'ReturnAsStream' });
    await page.evaluate(kind => {
      const viewport = document.querySelector('.react-flow__viewport');
      const state = window.__pinchStartup = { before: viewport.style.transform, first: null, changed: null, frames: [] };
      const type = kind === 'button' ? 'click' : 'wheel';
      const input = event => { state.first = performance.now(); state.trusted = event.isTrusted; performance.mark('pinch-trace-input'); };
      window.addEventListener(type, input, { capture: true, once: true });
      const observer = new MutationObserver(() => { if (state.changed === null && viewport.style.transform !== state.before) { state.changed = performance.now(); performance.mark('pinch-trace-commit'); } });
      observer.observe(viewport, { attributes: true, attributeFilter: ['style'] });
      const tick = time => { if (state.first !== null && time >= state.first && viewport.style.transform !== state.before) state.frames.push(time - state.first); state.raf = requestAnimationFrame(tick); };
      state.raf = requestAnimationFrame(tick);
      state.stop = () => { cancelAnimationFrame(state.raf); observer.disconnect(); window.removeEventListener(type, input, true); performance.mark('pinch-trace-end'); };
    }, kind);
    if (kind === 'button') await page.locator('.react-flow__controls-zoomin').click();
    else await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x + box.width / 2, y: box.y + box.height / 2, deltaX: 0, deltaY: -Math.log2(1.2) / .02, modifiers: 2 });
    await page.waitForTimeout(500);
    const measured = await page.evaluate(() => { const state = window.__pinchStartup; state.stop(); return { trusted: state.trusted, commitMs: state.changed - state.first, firstChangedFrameMs: state.frames[0] }; });
    assert.equal(measured.trusted, true);
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await done;
    let data = '';
    for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); data += chunk.data; if (chunk.eof) break; }
    await cdp.send('IO.close', { handle: stream });
    const filename = `${out}.startup-${scale}-${kind}`;
    fs.writeFileSync(filename + '.trace.json', data);
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(filename + '.cpuprofile', JSON.stringify(profile));
    const events = JSON.parse(data).traceEvents;
    const input = events.find(e => e.name === 'pinch-trace-input');
    assert.ok(input, 'Trace includes the actual input marker');
    const names = ['Layout', 'Paint', 'UpdateLayoutTree', 'Layerize', 'PrePaint', 'FunctionCall', 'MinorGC', 'MajorGC', 'RasterTask', 'Commit', 'HitTest', 'EventDispatch'];
    const tasks = events.filter(e => e.ph === 'X' && e.dur && e.ts >= input.ts && e.ts < input.ts + 350000 && names.includes(e.name))
      .map(e => ({ name: e.name, startMs: (e.ts - input.ts) / 1000, durationMs: e.dur / 1000, main: e.pid === input.pid && e.tid === input.tid })).sort((a, b) => a.startMs - b.startMs);
    const sample = { scale, kind, ...measured, filename, tasks, note: 'Inclusive overlapping trace tasks, not independent sums or presentation FPS.' };
    report.pinchStartupTraces.push(sample);
    console.log('Pinch startup trace', JSON.stringify(sample));
  }
};
