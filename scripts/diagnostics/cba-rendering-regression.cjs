// Full-App presentation regressions. Called by the disposable production harness.
// No application hooks or replacement renderers: use the real canvas, exports,
// trusted input, and a fixture-only persisted manual route.
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function checkCbaRendering({ page, cdp, app, result, args, out, ready }) {
  const checks = result.cbaRenderingChecks = {};
  const save = () => fs.writeFileSync(out + '.rendering-checks.json', JSON.stringify(checks, null, 2));
  const settle = () => page.waitForTimeout(350);
  const edge = id => page.locator(`[data-testid="rf__edge-${id}"]`);
  const path = id => edge(id).locator('.react-flow__edge-path');
  const viewport = () => page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a, pane: { x: pane.x, y: pane.y, width: pane.width, height: pane.height } };
  });
  const presentation = () => page.evaluate(() => ({
    moving: document.querySelector('.x-csu-large')?.hasAttribute('data-viewport-moving') || false,
    willChange: getComputedStyle(document.querySelector('.react-flow__viewport')).willChange,
    labels: getComputedStyle(document.querySelector('.react-flow__edgelabel-renderer')).visibility,
  }));
  const resetScroll = () => page.evaluate(() => {
    let e = document.querySelector('.react-flow');
    while (e) { e.scrollLeft = 0; e.scrollTop = 0; e = e.parentElement; }
  });
  const fit = async () => { await resetScroll(); await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(700); };
  const reload = async () => {
    await page.reload();
    await page.getByRole('button', { name: 'CBA performance fixture', exact: true }).first().click();
    await ready(); await page.waitForTimeout(800);
  };
  async function download(label, suffix) {
    const target = out + suffix;
    if (app) {
      // Electron uses a native save dialog by default and does not expose the
      // Chrome Playwright download event. Capture its real DownloadItem before
      // clicking, and confine the actual exported file to the task directory.
      await app.evaluate(({ session }, target) => {
        const record = { state: 'waiting' };
        global.fixtureDownload = record;
        session.defaultSession.once('will-download', (_event, item) => {
          item.setSavePath(target);
          record.filename = item.getFilename();
          record.state = 'progressing';
          item.once('done', (_event, state) => { record.state = state; });
        });
      }, target);
      await page.getByRole('button', { name: label, exact: true }).click();
      let record;
      for (let attempt = 0; attempt < 200; attempt++) {
        record = await app.evaluate(() => global.fixtureDownload);
        if (!['waiting', 'progressing'].includes(record.state)) break;
        await page.waitForTimeout(100);
      }
      assert.equal(record.state, 'completed', 'Native Electron export must complete');
      checks.exportTransport = 'Electron session DownloadItem with task-only save path';
      return fs.readFileSync(target, 'utf8');
    }
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const item = await waiting;
    await item.saveAs(target);
    return fs.readFileSync(target, 'utf8');
  }
  const exportJson = async suffix => JSON.parse(await download('Export diagram JSON', suffix));
  async function verifySavedLayout() {
    await page.getByRole('button', { name: 'Quick search', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search current view' }).fill('Function 10');
    await page.getByRole('option').filter({ has: page.getByText('Diagram node · Function 10', { exact: true }) }).click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'Clear diagram selection', exact: true }).click();
    const before = await exportJson('.before-node-drag.json');
    const position = diagram => diagram.nodes.find(n => n.id === 'perf-node-10').position;
    // CBA's JSON position is positionAbsolute || position, including for
    // parented functions. Reconstructed group bounds may change local offsets.
    const functions = diagram => diagram.nodes.filter(n => n.type === 'bidirectional').map(n => ({ id: n.id, position: n.position })).sort((a, b) => a.id.localeCompare(b.id));
    const node = page.locator('[data-id="perf-node-10"]');
    await resetScroll();
    const box = await node.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 + 14, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(900);
    const after = await exportJson('.after-node-drag.json');
    assert.notDeepEqual(position(after), position(before), 'Trusted node drag must update actual layout');
    assert.deepEqual(functions(after).filter(n => n.id !== 'perf-node-10'), functions(before).filter(n => n.id !== 'perf-node-10'), 'Dragging one function must preserve other absolute positions');
    const stored = await page.evaluate(key => new Promise((resolve, reject) => {
      const open = indexedDB.open('xhandle', 4);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('diagram_positions'), get = tx.objectStore('diagram_positions').get(key);
        get.onsuccess = () => resolve(get.result?.value?.find(([id]) => id === 'perf-node-10')?.[1]);
        get.onerror = () => reject(get.error); tx.oncomplete = () => db.close();
      };
      open.onerror = () => reject(open.error);
    }), before.storageKey);
    assert.deepEqual(stored, position(after), 'The actual saved absolute position must match the dragged node');
    checks.nodeDragBeforeReload = { before: position(before), after: position(after), stored };
    save();
    await reload();
    const restored = await exportJson('.restored-node-drag.json');
    assert.deepEqual(position(restored), position(after), 'Node layout edit must survive App reload');
    assert.deepEqual(functions(restored), functions(after), 'Every absolute function position must survive App reload');
    checks.nodeDragRestored = checks.nodeDragBeforeReload;
    save();
  }
  if (args.renderingChecks === 'layout') {
    await verifySavedLayout(); checks.complete = true; save(); return;
  }
  async function verifyMemoryCycles() {
    const count = Number(args.memoryCycles || 5);
    assert.ok(Number.isInteger(count) && count > 0 && count <= 50);
    checks.memoryCycles = [];
    for (let i = 0; i < count; i++) {
      // Do not count the diagnostic's accumulated event/read records as retained
      // application state across equivalent navigation cycles.
      await page.evaluate(() => Object.values(window.__perf).forEach(records => { records.length = 0; }));
      await page.getByRole('button', { name: 'Software Requirements', exact: true }).click();
      await page.locator('tbody').filter({ hasText: 'SWR-0' }).waitFor();
      await page.getByRole('button', { name: 'Architecture Diagram', exact: true }).click();
      await ready(); await settle(); await cdp.send('HeapProfiler.collectGarbage');
      const metrics = (await cdp.send('Performance.getMetrics')).metrics;
      checks.memoryCycles.push({ cycle: i + 1, heap: await page.evaluate(() => performance.memory?.usedJSHeapSize), cdpHeap: metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value, ...await cdp.send('Memory.getDOMCounters') });
      save();
    }
  }
  if (args.renderingChecks === 'memory') {
    await verifyMemoryCycles(); checks.complete = true; save(); return;
  }
  const paint = () => page.evaluate(() => {
    const p = document.querySelector('[data-testid="rf__edge-perf-edge-0"] .react-flow__edge-path');
    const style = getComputedStyle(p);
    // React Flow includes rgba(...) in marker IDs; its inner ')' is part of
    // the ID, not the end of the quoted url(...) reference.
    const markerId = p.getAttribute('marker-end')?.replace(/^url\(['"]?#/, '').replace(/['"]?\)$/, '');
    const marker = markerId ? document.getElementById(markerId) : null;
    return { opacity: style.opacity, strokeOpacity: style.strokeOpacity, stroke: style.stroke, markerFill: marker && getComputedStyle(marker.querySelector('polyline')).fill };
  });
  checks.lightPaint = await paint();
  assert.equal(Number(checks.lightPaint.opacity), 1, 'Marker-bearing paths must not use element opacity (the raster regression)');
  assert.equal(Number(checks.lightPaint.strokeOpacity), 0.92, 'Detailed stroke alpha must be retained');
  assert.match(checks.lightPaint.markerFill, /0\.92\)/, 'Arrow paint must retain alpha');
  const wasDark = await page.evaluate(() => { const e = document.documentElement; const dark = e.classList.contains('dark'); e.classList.add('dark'); return dark; });
  checks.darkPaint = await paint();
  assert.equal(Number(checks.darkPaint.strokeOpacity), 0.92, 'Dark theme must retain stroke alpha despite its important stroke color');
  assert.equal(checks.darkPaint.stroke, 'rgb(106, 168, 255)');
  await page.screenshot({ path: out + '.dark.png' });
  if (!wasDark) await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.screenshot({ path: out + '.light.png' });
  save();
  if (args.renderingChecks === 'paint') return;

  let beginMotion;
  if (await page.locator('.x-csu-large').count()) {
    const panePoint = await page.evaluate(() => {
      const r = document.querySelector('.react-flow__pane').getBoundingClientRect();
      for (let y = r.top + 30; y < r.bottom - 70; y += 30) for (let x = r.left + 100; x < r.right - 90; x += 35) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
      throw Error('No exposed pane point for cancellation checks');
    });
    const startPan = async () => {
      await page.mouse.move(panePoint.x, panePoint.y); await page.mouse.down({ button: 'middle' });
      await page.mouse.move(panePoint.x + 30, panePoint.y + 12, { steps: 3 });
      assert.deepEqual(await presentation(), { moving: true, willChange: 'transform', labels: 'hidden' });
    };
    beginMotion = startPan;
    checks.motionPresentation = [];
    for (const type of ['blur', 'pointercancel', 'visibilitychange']) {
      await startPan();
      await page.evaluate(type => (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type)), type);
      assert.equal((await presentation()).moving, false, `${type} must release transient presentation`);
      await page.mouse.up({ button: 'middle' }); await settle();
      assert.deepEqual(await presentation(), { moving: false, willChange: 'auto', labels: 'visible' });
      checks.motionPresentation.push(type);
    }
    await startPan(); await page.mouse.up({ button: 'middle' }); await page.waitForTimeout(50);
    await startPan(); await page.waitForTimeout(200);
    assert.equal((await presentation()).moving, true, 'An old idle timer must not clear a new gesture');
    await page.mouse.up({ button: 'middle' }); await settle();
    assert.deepEqual(await presentation(), { moving: false, willChange: 'auto', labels: 'visible' });
    checks.motionPresentation.push('rapid-restart'); save();
    await page.mouse.move(panePoint.x, panePoint.y);
    const beforeNoMotion = await viewport();
    await page.mouse.down({ button: 'middle' }); await settle();
    assert.equal((await presentation()).moving, true, 'A held pointer must not expire while stationary');
    await page.mouse.up({ button: 'middle' }); await settle();
    assert.deepEqual(await viewport(), beforeNoMotion, 'A stationary press/release must leave the view unchanged');
    assert.deepEqual(await presentation(), { moving: false, willChange: 'auto', labels: 'visible' });
    checks.motionPresentation.push('no-motion-release'); save();
  }

  const initial = await exportJson('.initial-diagram.json');
  const expected = Number(args.nodes || 100);
  assert.equal(initial.functionalDecomposition.length, expected * 2);
  assert.deepEqual(initial.nodes.filter(n => n.type === 'bidirectional').map(n => n.id).sort(), Array.from({ length: expected }, (_, i) => `perf-node-${i}`).sort());
  assert.deepEqual(initial.edges.map(e => e.id).sort(), Array.from({ length: expected * 2 }, (_, i) => `perf-edge-${i}`).sort());
  const xml = await download('Export diagram XML', '.diagram.xml');
  assert.equal((xml.match(/edge="1"/g) || []).length, expected * 2, 'XML must retain all relationships');
  checks.completeExports = { nodes: initial.nodes.length, edges: initial.edges.length, rows: initial.functionalDecomposition.length };
  // Find the mounted public imperative ref through React's DOM owner chain.
  // This invokes the application's actual html-to-image export implementation;
  // it does not inject a replacement screenshot/export renderer.
  if (beginMotion) await beginMotion();
  const png = await page.evaluate(async () => {
    const host = document.querySelector('.x-csu-large') || document.querySelector('.react-flow').parentElement.parentElement;
    let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    while (fiber && typeof fiber.ref?.current?.exportAsImage !== 'function') fiber = fiber.return;
    if (!fiber) throw Error('Mounted CBA exportAsImage ref was not found');
    const capture = fiber.ref.current.exportAsImage();
    const labelsAtCapture = getComputedStyle(document.querySelector('.react-flow__edgelabel-renderer')).visibility;
    const data = await capture;
    const image = new Image(); image.src = data; await image.decode();
    return { data, width: image.naturalWidth, height: image.naturalHeight, labelsAtCapture };
  });
  if (beginMotion) { await page.mouse.up({ button: 'middle' }); await settle(); }
  assert.ok(png.width > 0 && png.height > 0);
  assert.equal(png.labelsAtCapture, 'visible', 'PNG must restore labels before computing clone styles');
  fs.writeFileSync(out + '.application-export.png', Buffer.from(png.data.split(',')[1], 'base64'));
  checks.pngExport = { width: png.width, height: png.height, actualApplicationMethod: true, labelsAtCapture: png.labelsAtCapture };
  if (beginMotion) await beginMotion();
  await page.emulateMedia({ media: 'print' });
  assert.equal(Number((await paint()).strokeOpacity), 0.92);
  assert.equal(await page.locator('.react-flow__edgelabel-renderer').evaluate(e => getComputedStyle(e).visibility), 'visible', 'Print must include labels even during a gesture');
  const pdf = app
    ? await app.evaluate(async ({ BrowserWindow }) => ({ data: (await BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })).toString('base64') }))
    : await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const pdfBytes = Buffer.from(pdf.data, 'base64');
  assert.ok(pdfBytes.length > 10000, 'Actual page print must produce a populated PDF');
  fs.writeFileSync(out + '.print.pdf', pdfBytes);
  await page.emulateMedia({ media: 'screen' });
  if (beginMotion) { await page.mouse.up({ button: 'middle' }); await settle(); }
  checks.printPDFBytes = pdfBytes.length;
  if (args.browser === 'chrome') {
    const originalSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }));
    const originalPath = await path('perf-edge-0').getAttribute('d');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    await page.waitForTimeout(600);
    assert.equal(await path('perf-edge-0').getAttribute('d'), originalPath, 'Resize/DPR changes must preserve route coordinates');
    assert.equal(await page.evaluate(() => devicePixelRatio), 1);
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...originalSize, mobile: false });
    await page.waitForTimeout(600); await ready();
    assert.equal(await path('perf-edge-0').getAttribute('d'), originalPath);
    checks.resizeAndDprRestoration = true;
  }
  save();

  // Use a real saved route, deliberately far from both endpoints. This variant
  // is separate from the unchanged matched performance fixture.
  const routeKey = initial.storageKey + ':csu-edge-routing';
  const previousRoute = await page.evaluate(key => localStorage.getItem(key), routeKey);
  const manual = { model: 'segment-v2', axis: 'x', corridor: -2000, sourceOffset: -1000, targetOffset: 1000 };
  await page.evaluate(({ key, route }) => {
    const state = JSON.parse(localStorage.getItem(key) || '{}');
    state.defaultStyle = 'rectangular'; state.manualRoutes = { ...(state.manualRoutes || {}), 'perf-edge-0': route };
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: routeKey, route: manual });
  await reload(); await fit();
  const routePath = await path('perf-edge-0').getAttribute('d');
  const points = [...routePath.matchAll(/[ML]\s*([-\d.e+]+),\s*([-\d.e+]+)/gi)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  const corridorIndex = points.findIndex((p, i) => p.x === manual.corridor && points[i + 1]?.x === manual.corridor && p.y !== points[i + 1].y);
  assert.ok(corridorIndex >= 0, 'Persisted manual route must be rendered');
  const target = { x: manual.corridor, y: (points[corridorIndex].y + points[corridorIndex + 1].y) / 2 };
  // Center at fitted scale using bounded trusted middle-button drags, then
  // zoom around that point with trusted pinch input.
  for (let i = 0; i < 20; i++) {
    const v = await viewport();
    const dx = v.pane.width / 2 - (v.x + target.x * v.zoom);
    const dy = v.pane.height / 2 - (v.y + target.y * v.zoom);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const x = v.pane.x + v.pane.width / 2, y = v.pane.y + v.pane.height / 2;
    await page.mouse.move(x, y); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(x + Math.max(-180, Math.min(180, dx)), y + Math.max(-120, Math.min(120, dy)), { steps: 4 });
    await page.mouse.up({ button: 'middle' });
  }
  for (let i = 0; i < 15; i++) {
    const v = await viewport(); if (v.zoom >= 1) break;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: v.pane.x + v.pane.width / 2, y: v.pane.y + v.pane.height / 2, deltaX: 0, deltaY: -80, modifiers: 2 });
    await page.waitForTimeout(80);
  }
  await settle();
  checks.crossingRoute = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    const intersects = r => r.right > pane.left && r.left < pane.right && r.bottom > pane.top && r.top < pane.bottom;
    const endpoints = [0, 1].map(id => intersects(document.querySelector(`[data-id="perf-node-${id}"]`).getBoundingClientRect()));
    const p = document.querySelector('[data-testid="rf__edge-perf-edge-0"] .react-flow__edge-path');
    const matrix = p.getScreenCTM(), length = p.getTotalLength();
    const hits = Array.from({ length: 401 }, (_, i) => p.getPointAtLength(length * i / 400).matrixTransform(matrix)).filter(q => q.x > pane.left && q.x < pane.right && q.y > pane.top && q.y < pane.bottom);
    return { endpointsVisible: endpoints, visibleSamples: hits.length, hit: hits.length ? { x: hits[Math.floor(hits.length / 2)].x, y: hits[Math.floor(hits.length / 2)].y } : null, path: p.getAttribute('d') };
  });
  assert.deepEqual(checks.crossingRoute.endpointsVisible, [false, false], 'Both manual-edge endpoints must be offscreen');
  assert.ok(checks.crossingRoute.visibleSamples > 0, 'The distant route must visibly cross the viewport');
  assert.equal(checks.crossingRoute.path, routePath, 'Pan/zoom must not reroute an offscreen-ended relationship');
  await page.mouse.click(checks.crossingRoute.hit.x, checks.crossingRoute.hit.y);
  const adjuster = page.getByRole('button', { name: 'Adjust selected edge corridor', exact: true });
  await adjuster.waitFor();
  assert.equal(Number((await paint()).strokeOpacity), 1, 'Highlighted route must retain full opacity');
  const handle = await adjuster.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(900);
  const editedPath = await path('perf-edge-0').getAttribute('d');
  assert.notEqual(editedPath, routePath, 'Trusted manual-segment drag must change the actual path');
  const savedManual = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).manualRoutes['perf-edge-0'], routeKey);
  await reload();
  assert.equal(await path('perf-edge-0').getAttribute('d'), editedPath, 'Manual route edit must survive actual App reload');
  const manualExport = await exportJson('.manual-diagram.json');
  assert.deepEqual(manualExport.edges.find(e => e.id === 'perf-edge-0').data.manualRoute, savedManual);
  assert.deepEqual(manualExport.functionalDecomposition, initial.functionalDecomposition, 'Presentation and route editing must preserve exact architecture data');
  checks.manualRouteEditRestored = savedManual;
  checks.zoomBounds = {};
  const zoomPoint = () => page.evaluate(() => {
    const r = document.querySelector('.react-flow__pane').getBoundingClientRect();
    for (let y = Math.max(120, r.top + 20); y < Math.min(innerHeight - 90, r.bottom - 90); y += 30) {
      for (let x = Math.max(300, r.left + 100); x < Math.min(innerWidth - 90, r.right - 90); x += 35) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    throw Error('No exposed pane point for zoom bound');
  });
  for (const [name, deltaY, control] of [['minimum', 4000, 'zoomout'], ['maximum', -4000, 'zoomin']]) {
    const events = [];
    const button = page.locator(`.react-flow__controls-${control}`);
    for (let attempt = 0; attempt < 3 && !(await button.isDisabled()); attempt++) {
      const point = await zoomPoint();
      await page.evaluate(() => {
        window.__boundWheel = null;
        window.addEventListener('wheel', event => {
          window.__boundWheel = { trusted: event.isTrusted, ctrlKey: event.ctrlKey, target: String(event.target.className?.baseVal || event.target.className) };
        }, { capture: true, once: true });
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY, modifiers: 2 });
      await page.waitForTimeout(600);
      events.push(await page.evaluate(() => window.__boundWheel));
    }
    checks.zoomBounds[name] = { zoom: (await viewport()).zoom, disabled: await button.isDisabled(), events }; save();
    assert.ok(events.every(event => event?.trusted && event.ctrlKey), 'Zoom bounds must use trusted pinch input');
    assert.equal(checks.zoomBounds[name].disabled, true, 'Trusted pinch must reach the actual ' + name + ' zoom bound');
    const beforeNoop = await viewport();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...await zoomPoint(), deltaX: 0, deltaY, modifiers: 2 });
    await page.waitForTimeout(600);
    assert.deepEqual(await viewport(), beforeNoop, 'A further pinch at the bound must leave the view unchanged');
    assert.deepEqual(await presentation(), { moving: false, willChange: 'auto', labels: 'visible' }, 'No-op zoom must release its temporary presentation');
    checks.zoomBounds[name].idleAfterNoop = true; save();
    assert.equal(await path('perf-edge-0').getAttribute('d'), editedPath, 'Extreme zoom must preserve the manual route');
  }
  assert.ok(checks.zoomBounds.maximum.zoom > checks.zoomBounds.minimum.zoom && checks.zoomBounds.minimum.zoom > 0);
  save();

  // Restore the matched fixture route before exercising normal navigation.
  await page.evaluate(({ key, value }) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value), { key: routeKey, value: previousRoute });
  await reload(); await fit();
  const node = page.locator('[data-id="perf-node-10"]');
  await page.getByRole('button', { name: 'Quick search', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search current view' }).fill('Function 10');
  await page.getByRole('option').filter({ has: page.getByText('Diagram node · Function 10', { exact: true }) }).click();
  await page.waitForTimeout(700);
  await node.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-id="perf-node-10"]')?.classList.contains('selected'));
  assert.equal(await node.locator('.react-flow__handle').count(), 32, 'Keyboard selection must restore the complete connection ports');
  await node.dblclick();
  await page.getByRole('button', { name: 'Close', exact: true }).waitFor();
  const nodeModal = page.getByRole('heading', { name: 'Edit Node', exact: true }).locator('..').locator('..');
  assert.equal(await nodeModal.getByLabel('Label', { exact: true }).inputValue(), 'Function 10');
  await nodeModal.locator('summary').filter({ hasText: 'Architecture Trace' }).click();
  await nodeModal.locator('summary').filter({ hasText: /^Details$/ }).first().click();
  const sourceLink = nodeModal.locator('button[title="Function 10 (src/unit_10.cpp:11)"]').first();
  await sourceLink.click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-id="perf-node-10"]')?.style.filter.includes('184'));
  await page.waitForTimeout(700);
  const tracePanel = page.getByText('Selected Source Trace', { exact: true }).locator('..').locator('..');
  assert.match(await tracePanel.innerText(), /Function:\s*Function 10/);
  assert.match(await tracePanel.innerText(), /File:\s*src\/unit_10\.cpp/);
  const sourceView = await viewport();
  const sourceNodeBox = await node.boundingBox();
  assert.ok(sourceNodeBox.x + sourceNodeBox.width > sourceView.pane.x && sourceNodeBox.x < sourceView.pane.x + sourceView.pane.width
    && sourceNodeBox.y + sourceNodeBox.height > sourceView.pane.y && sourceNodeBox.y < sourceView.pane.y + sourceView.pane.height,
  'Source trace navigation must reveal the selected source node');
  checks.sourceTraceViewport = { zoom: sourceView.zoom, nodeVisible: true, file: 'src/unit_10.cpp' };
  await page.screenshot({ path: out + '.source-detail.png' });
  checks.sourceTraceAndKeyboardPorts = true;
  save();
  await page.getByRole('button', { name: 'Clear diagram selection', exact: true }).click();
  await verifySavedLayout();
  await page.getByRole('button', { name: 'Add canvas note', exact: true }).click();
  const noteModal = page.getByRole('heading', { name: 'Edit Node', exact: true }).locator('..').locator('..');
  await noteModal.getByLabel('Label', { exact: true }).fill('Rendering regression note');
  await noteModal.getByLabel('Description', { exact: true }).fill('Saved note remains accessible with the complete graph.');
  await noteModal.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(900); await reload();
  assert.equal(await page.locator('.react-flow__node-note').filter({ hasText: 'Rendering regression note' }).count(), 1);
  checks.noteRestoration = true;
  await verifyMemoryCycles();
  await fit();
  await page.screenshot({ path: out + '.verified.png' });
  checks.complete = true; save();
};
