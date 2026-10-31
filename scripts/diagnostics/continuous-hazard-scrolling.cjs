// Actual production App, real IndexedDB row workers, disposable profiles only.
// PERF_HAZARD_SCROLL_FIXTURE=1 node scripts/diagnostics/build-desktop-performance-fixture.cjs /tmp/hazard-fixture
// node scripts/diagnostics/continuous-hazard-scrolling.cjs --build /absolute/build --out /tmp/hazard-electron.json --seeder /tmp/hazard-fixture/seed.js --rows 15000 --nodes 100 --trace 0 --verify 1
// Add --browser chrome for Chrome. No fixture-only React components are mounted.
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function continuousHazardScrolling({ page, cdp, result, args, out, app, collect }) {
  const rowCount = result.cbaFixture.rows;
  const fixture = result.cbaFixture.hazardScrollFixture;
  assert.ok(fixture, 'Build the opt-in PERF_HAZARD_SCROLL_FIXTURE=1 seeder');
  assert.ok(rowCount >= 1000, 'Use at least 1,000 rows to cross many storage boundaries');
  const report = result.hazardContinuous = {
    methodology: {
      productionApp: true, realSavedRowWorkers: true, fixture,
      timing: 'rAF intervals wholly within first/last trusted wheel input; settling and programmatic far jumps measured separately',
      visibleLoading: 'bounded per-rAF row/placeholder rectangle reads through final readiness; this diagnostic overhead is included in frame timings',
      memory: 'explicit diagnostic GC at equivalent first-row states; DOM counts plus application-reported cell-cache bounds',
      limits: 'Electron is the production shared App in a disposable BrowserWindow, not packaged backend/updater parity. Main-thread IDB instrumentation does not count worker transactions.',
    },
    snapshots: [], gestures: [], jumps: [], memory: [],
  };
  result.methodology = { version: 1, scenario: 'continuous saved hazard scrolling', samplesPerDirection: Number(args.samples ?? 3), ...report.methodology };
  const save = () => fs.writeFileSync(out + '.hazard-partial.json', JSON.stringify(result, null, 2));
  const tableSelector = 'table[data-hazard-total]';
  const scrollerSelector = '[data-hazard-scroll]';
  await page.evaluate(() => {
    const audit = window.__hazardScrollAudit = { active: new Set(), requests: [], maxActive: 0, observed: [] };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...values) {
        super(...values);
        this.addEventListener('message', ({ data }) => {
          if (!this.hazardRequest || data?.type === 'progress') return;
          const record = this.hazardRequest;
          record.completed = performance.now();
          record.resultRows = data?.result?.rows?.length ?? null;
          record.resultIndices = data?.result?.rowIndices || null;
          record.nextOffset = data?.result?.nextOffset ?? null;
          record.error = data?.type === 'error' ? data.message : null;
        });
      }
      postMessage(message, ...transfer) {
        if (message?.run?.__xhandlePagedHazard) {
          const options = message.options || {};
          const record = { operation: options.operation || 'page', offset: options.offset ?? null, requestedIndices: options.indices?.length ?? null, limit: options.limit ?? 100, started: performance.now() };
          this.hazardRequest = record;
          audit.active.add(this);
          audit.maxActive = Math.max(audit.maxActive, audit.active.size);
          if (audit.requests.length < 4000) audit.requests.push(record);
        }
        return super.postMessage(message, ...transfer);
      }
      terminate() {
        if (this.hazardRequest) {
          this.hazardRequest.terminated = performance.now();
          this.hazardRequest.aborted = !this.hazardRequest.completed;
        }
        audit.active.delete(this);
        return super.terminate();
      }
    };
  });

  const waitReady = async () => {
    await page.locator(tableSelector).waitFor();
    await page.evaluate(() => { window.__hazardScrollAudit.ready = { key: '', frames: 0 }; });
    await page.waitForFunction(selector => {
      const table = document.querySelector(selector);
      const loaded = table && Number(table.dataset.hazardTotal) > 0
        && table.querySelector('tr[data-hazard-row-index]:not([data-hazard-loading-row])')
        && !table.querySelector('[data-hazard-loading-row]')
        && window.__hazardScrollAudit.active.size === 0;
      const state = window.__hazardScrollAudit.ready;
      const key = loaded ? [document.querySelector('[data-hazard-scroll]')?.scrollTop, table.dataset.hazardTotal, table.dataset.hazardCacheRows, [...table.querySelectorAll('[data-hazard-row-index]')].map(row => row.dataset.hazardRowIndex).join(',')].join(':') : '';
      state.frames = loaded && key === state.key ? state.frames + 1 : 0;
      state.key = key;
      return loaded && state.frames >= 3;
    }, tableSelector);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const read = () => page.evaluate(({ tableSelector, scrollerSelector }) => {
    const table = document.querySelector(tableSelector), scroller = document.querySelector(scrollerSelector);
    if (!table || !scroller) return null;
    const rect = scroller.getBoundingClientRect();
    const rows = [...table.querySelectorAll('tbody tr[data-hazard-row-index]')].map(row => {
      const bounds = row.getBoundingClientRect();
      return { index: Number(row.dataset.hazardRowIndex), hazardIndex: Number(row.textContent.match(/Unsafe actuator motion (\d+)/)?.[1]), loading: row.hasAttribute('data-hazard-loading-row'), visible: bounds.bottom > rect.top + 35 && bounds.top < rect.bottom, text: row.textContent.slice(0, 180) };
    });
    return {
      top: scroller.scrollTop, height: scroller.clientHeight, scrollHeight: scroller.scrollHeight,
      total: Number(table.dataset.hazardTotal), accessibleRows: Number(table.getAttribute('aria-rowcount')),
      cacheRows: Number(table.dataset.hazardCacheRows), cacheBytes: Number(table.dataset.hazardCacheBytes),
      mountedRows: table.querySelectorAll('tbody tr').length, rows,
      activeWorkers: window.__hazardScrollAudit.active.size, heap: performance.memory?.usedJSHeapSize,
      dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
    };
  }, { tableSelector, scrollerSelector });
  const check = (snapshot, total = rowCount) => {
    assert.ok(snapshot, 'Populated hazard scroller must be present');
    assert.equal(snapshot.total, total);
    assert.ok(Number.isFinite(snapshot.cacheRows) && snapshot.cacheRows >= 1 && snapshot.cacheRows <= 400, 'Hydrated row cache must stay within 400 rows');
    assert.ok(Number.isFinite(snapshot.cacheBytes) && snapshot.cacheBytes > 0 && snapshot.cacheBytes <= 16 * 1024 * 1024, 'Synthetic rows must stay within 16 MiB cell-cache budget');
    assert.ok(snapshot.mountedRows < 160, 'DOM must stay virtualized across distant storage ranges');
    assert.ok(snapshot.accessibleRows >= total + 1, 'Accessible table row count must describe the complete result, not the cache');
    const ids = snapshot.rows.map(row => row.index);
    assert.equal(new Set(ids).size, ids.length, 'A source row must not mount twice');
    assert.ok(ids.every(index => Number.isInteger(index) && index >= 0 && index < rowCount));
    assert.ok(snapshot.rows.some(row => row.visible && !row.loading), 'Viewport must contain actual saved row content');
    for (const row of snapshot.rows.filter(row => !row.loading)) {
      assert.equal(row.hazardIndex, row.index, 'Rendered hazard text must match its absolute source ID');
    }
  };
  const snapshot = async (label, total = rowCount) => {
    await waitReady();
    const value = await read(); check(value, total);
    report.snapshots.push({ label, ...value }); save(); return value;
  };
  const openHazards = async () => {
    await page.getByRole('button', { name: 'Hazard & Remediation', exact: true }).click();
    const summary = page.getByRole('button', { name: 'Code Architecture Hazard Analysis', exact: true });
    if (await summary.count() && !(await page.locator(tableSelector).count())) await summary.click();
    await waitReady();
  };
  const started = Date.now();
  await page.getByRole('button', { name: 'CBA performance fixture', exact: true }).first().click();
  await openHazards();
  report.firstUsableMs = Date.now() - started;
  assert.equal(await page.getByRole('button', { name: /^(Next rows|Previous rows)$/ }).count(), 0, 'No user-facing chunk pagination');
  const initial = await snapshot('initial');
  assert.ok(initial.scrollHeight > initial.height * 20, 'Initial scroll extent must span unloaded saved rows');
  assert.ok(initial.rows.some(row => row.index === 0 && !row.loading));

  async function wheelSample(label, direction, count = 120) {
    const scroller = page.locator(scrollerSelector);
    const box = await scroller.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + Math.min(box.width / 2, 360), box.y + Math.min(box.height / 2, 180));
    const before = await read();
    await page.evaluate(() => {
      const audit = window.__hazardScrollAudit;
      audit.wheel = { events: [], frames: [], running: true, last: null };
      audit.onWheel = event => { if (event.isTrusted && event.target.closest('[data-hazard-scroll]')) audit.wheel.events.push(performance.now()); };
      window.addEventListener('wheel', audit.onWheel, { capture: true, passive: true });
      const tick = time => {
        const state = audit.wheel; if (!state.running) return;
        const scroller = document.querySelector('[data-hazard-scroll]'), bounds = scroller?.getBoundingClientRect();
        let loading = 0, loaded = 0;
        for (const row of scroller?.querySelectorAll('tbody tr[data-hazard-row-index],tbody tr[data-hazard-loading-row]') || []) {
          const rect = row.getBoundingClientRect();
          if (rect.bottom > bounds.top + 35 && rect.top < bounds.bottom) {
            if (row.hasAttribute('data-hazard-loading-row')) loading++; else loaded++;
          }
        }
        if (state.last != null) state.frames.push({ from: state.last, to: time, ms: time - state.last, loading, loaded });
        state.last = time; requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (let i = 0; i < count; i++) { await page.mouse.wheel(0, direction * 600); await page.waitForTimeout(16); }
    await waitReady();
    const timing = await page.evaluate(() => {
      const audit = window.__hazardScrollAudit, state = audit.wheel;
      state.running = false; window.removeEventListener('wheel', audit.onWheel, true);
      const first = state.events[0], last = state.events.at(-1);
      const active = state.frames.filter(frame => frame.from >= first && frame.to <= last);
      const loading = state.frames.filter(frame => frame.to >= first);
      let run = 0, maximum = 0;
      for (const frame of loading) { run = frame.loading ? run + frame.ms : 0; maximum = Math.max(maximum, run); }
      return {
        trustedInputs: state.events.length, duration: last - first, frames: active.map(frame => frame.ms),
        visibleLoading: { activeFrames: active.length, loadingFrames: active.filter(frame => frame.loading).length, whollyLoadingFrames: active.filter(frame => frame.loading && !frame.loaded).length, emptyFrames: active.filter(frame => !frame.loading && !frame.loaded).length,
          maximumVisiblePlaceholders: Math.max(0, ...loading.map(frame => frame.loading)), maximumContiguousMs: maximum,
          postInputLoadingTailMs: Math.max(0, ...loading.filter(frame => frame.loading).map(frame => frame.to - last)), samples: loading },
      };
    });
    const after = await read(); check(after);
    assert.ok(timing.trustedInputs >= 5, 'Frame sampling requires observed trusted wheel events');
    assert.ok(timing.frames.length >= 5, 'Gesture timing needs actual active-input frame samples');
    assert.ok(direction * (after.top - before.top) > 0, 'Trusted wheel must move the actual hazard scroller');
    assert.ok(after.rows.every((row, index) => index === 0 || row.index === after.rows[index - 1].index + 1), 'Continuous fixture must have no missing or duplicated rows at a storage boundary');
    const sorted = timing.frames.slice().sort((a, b) => a - b);
    const sample = { label, requestedInputs: count, before, after, ...timing, p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1), over25ms: sorted.filter(ms => ms > 25).length };
    report.gestures.push(sample); save();
    return sample;
  }
  // Warmup is recorded separately; acceptance samples use active input only.
  report.warmup = await wheelSample('warmup', 1, 12);
  report.gestures.pop();
  for (let sample = 0; sample < Number(args.samples ?? 3); sample++) {
    await wheelSample(`forward-${sample}`, 1);
    await wheelSample(`reverse-${sample}`, -1);
  }
  // Whole-table jumps represent scrollbar dragging, not wheel FPS. Test both
  // directions through widely separated storage ranges without accumulating cells.
  for (const fraction of [0.1, 0.35, 0.7, 1, 0.7, 0.35, 0.1, 0]) {
    const start = Date.now();
    await page.locator(scrollerSelector).evaluate((element, ratio) => { element.scrollTop = ratio * (element.scrollHeight - element.clientHeight); }, fraction);
    let value = await snapshot(`jump-${fraction}`);
    let finalWheelInputs = 0;
    if (fraction === 1) {
      assert.ok(value.rows.some(row => row.index === rowCount - 1 && !row.loading), 'Far end must load the final saved hazard');
      // Measurement may preserve the anchor above the newly measured bottom.
      // Confirm ordinary wheel input can actually expose the final row.
      while (!value.rows.some(row => row.index === rowCount - 1 && row.visible) && finalWheelInputs < 5) {
        await page.mouse.wheel(0, 600); finalWheelInputs++;
        await waitReady(); value = await read(); check(value);
      }
      assert.ok(value.rows.some(row => row.index === rowCount - 1 && row.visible && !row.loading), 'The final saved hazard must become visible, not merely prefetched');
    }
    report.jumps.push({ fraction, settledMs: Date.now() - start, finalWheelInputs, first: value.rows.find(row => row.visible)?.index, last: value.rows.filter(row => row.visible).at(-1)?.index });
  }
  const visited = report.snapshots.flatMap(value => value.rows.map(row => row.index));
  assert.ok(Math.max(...visited) - Math.min(...visited) >= rowCount - 1);

  const search = page.getByRole('textbox', { name: 'Search all saved hazard rows', exact: true });
  await search.fill(`HA-${rowCount - 1}`);
  await page.waitForFunction(({ selector, index }) => Number(document.querySelector(selector)?.dataset.hazardTotal) === 1 && document.querySelector(`[data-hazard-row-index="${index}"]:not([data-hazard-loading-row])`), { selector: tableSelector, index: rowCount - 1 });
  await snapshot('search-last-row', 1);
  const lastRow = page.locator(`[data-hazard-row-index="${rowCount - 1}"]:not([data-hazard-loading-row])`);
  await lastRow.locator('td').filter({ hasText: `Unsafe actuator motion ${rowCount - 1}` }).click();
  assert.match(await lastRow.getAttribute('class'), /bg-blue-50|ring-blue/, 'Selecting a distant source row must select that row');
  report.absoluteRowSelection = rowCount - 1;
  await search.fill('');
  await page.waitForFunction(({ selector, total }) => Number(document.querySelector(selector)?.dataset.hazardTotal) === total, { selector: tableSelector, total: rowCount });
  await snapshot('search-cleared');

  const contexts = page.locator('select[title="Filter results and scope the next analysis run to an operational scenario and mode"]');
  if (!(await contexts.isVisible())) await page.getByRole('button', { name: 'Show analysis setup', exact: true }).click();
  await contexts.selectOption(fixture.contexts[1]);
  const serviceTotal = Math.floor(rowCount / 2);
  await page.waitForFunction(({ selector, total }) => Number(document.querySelector(selector)?.dataset.hazardTotal) === total, { selector: tableSelector, total: serviceTotal });
  const service = await snapshot('service-context', serviceTotal);
  assert.ok(service.rows.every(row => row.index % 2 === 1), 'Context filtering must retain original source indexes');
  await contexts.selectOption('all');
  await page.waitForFunction(({ selector, total }) => Number(document.querySelector(selector)?.dataset.hazardTotal) === total, { selector: tableSelector, total: rowCount });
  await snapshot('all-contexts-restored');

  // Cancel actual work by leaving while the complete saved-row search runs.
  await search.fill('Unsafe actuator motion');
  await page.waitForFunction(() => window.__hazardScrollAudit.active.size > 0);
  await page.getByRole('button', { name: 'Architecture Diagram', exact: true }).click();
  await page.waitForFunction(() => window.__hazardScrollAudit.active.size === 0);
  report.abortedRequests = await page.evaluate(() => window.__hazardScrollAudit.requests.filter(request => request.aborted).length);
  assert.ok(report.abortedRequests > 0, 'Leaving must terminate active saved-row work');

  const retainedWorkerRequests = [];
  for (let cycle = 0; cycle <= Number(args.cycles || 5); cycle++) {
    if (cycle) await page.getByRole('button', { name: 'Architecture Diagram', exact: true }).click();
    await openHazards();
    await page.locator(scrollerSelector).evaluate(element => { element.scrollTop = 0; });
    await waitReady();
    // Retain diagnostics in the controller process, not in the renderer heap
    // whose repeated-entry working set is being measured.
    retainedWorkerRequests.push(...await page.evaluate(() => window.__hazardScrollAudit.requests.splice(0)));
    if (cycle === 0) report.beforeMemory = await collect();
    await page.evaluate(() => { for (const value of Object.values(window.__perf)) if (Array.isArray(value)) value.length = 0; });
    await cdp.send('HeapProfiler.collectGarbage');
    report.memory.push({ cycle, snapshot: await read(), dom: await cdp.send('Memory.getDOMCounters'), metrics: await cdp.send('Performance.getMetrics') });
    check(report.memory.at(-1).snapshot);
    save();
  }
  report.workerRequests = { ...await page.evaluate(() => ({ maxActive: window.__hazardScrollAudit.maxActive, active: window.__hazardScrollAudit.active.size })), requests: retainedWorkerRequests };
  assert.equal(report.workerRequests.active, 0);
  assert.ok(report.workerRequests.requests.filter(request => request.resultRows != null).every(request => request.resultRows <= 100), 'Each real worker page must retain the existing row limit');
  report.workerRequests.shortBoundedResponses = report.workerRequests.requests.filter(request => request.resultRows > 0
    && request.resultRows < Math.min(request.limit, (request.requestedIndices ?? request.limit) - (request.offset ?? 0))).length;
  assert.ok(report.workerRequests.shortBoundedResponses > 0, 'Wide fixture must return fewer rows than requested before reaching the end of its requested indices');
  const firstHeap = report.memory[0].snapshot.heap, lastHeap = report.memory.at(-1).snapshot.heap;
  report.retainedHeapGrowthBytes = lastHeap - firstHeap;
  assert.ok(report.retainedHeapGrowthBytes < Math.max(32 * 1024 * 1024, firstHeap * 0.25), 'Equivalent repeated entries must not retain an expanding row working set');
  report.final = await collect();
  report.processMetrics = app ? await app.evaluate(({ app }) => app.getAppMetrics()) : null;
  save();
};

if (require.main === module) {
  process.argv.push('--workspace', 'cba', '--hazardScroll', '1', '--interactions', 'skip');
  require('./desktop-interaction-performance.cjs');
}
