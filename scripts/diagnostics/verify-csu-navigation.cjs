// Isolated 800-relationship CSU fixture. No customer data or model calls.
// BASELINE=1 disables idle-port pruning in the served bundle for comparison.
const assert = require('node:assert/strict');
const {
  chromium
} = require('/tmp/xhandle-copy-check/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1500,
        height: 1000
      }
    });
    await page.route('**/api/**', r => r.fulfill({
      status: 401,
      body: 'fixture'
    }));
    if (process.env.BASELINE === '1') await page.route('**/static/js/bundle.js', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('withCsuVisibleHandles)(viewNodes, viewEdges, largeCsuCanvas)', 'withCsuVisibleHandles)(viewNodes, viewEdges, false)');
      await route.fulfill({
        response,
        body
      });
    });
    await page.goto(process.env.XHANDLE_URL || 'http://localhost:3001');
    await page.evaluate(baseline => {
      window[Object.keys(window).find(k => k.startsWith('webpackChunk'))].push([[Date.now()], {}, r => window.req = r]);
      const r = window.req;
      const R = r('./node_modules/react/index.js');
      const el = document.createElement('div');
      el.style.height = '950px';
      document.body.replaceChildren(el);
      window.diagramRef = R.createRef();
      const rows = Array.from({
        length: 800
      }, (_, i) => ({
        fromFunction: `function_${i}`,
        toFunction: `function_${i + 1}`,
        controlAction: 'Call',
        fromFile: 'fixture.cpp',
        toFile: 'fixture.cpp',
        architecture: {
          subsystem: 'System',
          csci: 'Software',
          csc: `Component ${Math.floor(i / 80)}`,
          csu: `Unit ${Math.floor(i / 20)}`
        },
        traceId: `row-${i}`
      }));
      r('./node_modules/react-dom/client.js').createRoot(el).render(R.createElement(r('./src/components/LiteSummaryDiagramReactFlowGitHub.js').default, {
        ref: window.diagramRef,
        rows,
        architectureMode: true,
        architectureAbstraction: 'detailed',
        cleanOnceKey: 'benchmark',
        storageKey: 'benchmark',
        height: 900
      }));
    }, process.env.BASELINE === '1');
    await page.waitForSelector('.react-flow__edge', {
      timeout: 120000
    });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.diagramRef.current.fitViewToDiagram());
    await page.waitForTimeout(1000);
    const counts = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.react-flow__node-bidirectional').length,
      handles: document.querySelectorAll('.react-flow__handle').length
    }));
    if (process.env.BASELINE !== '1') assert(counts.handles < counts.nodes * 8, 'Idle ports were not pruned');
    await page.evaluate(() => {
      window.fixtureNode = document.querySelector('.react-flow__node-bidirectional');
      window.fixturePaths = [...document.querySelectorAll('.react-flow__edge-path')].map(p => p.getAttribute('d'));
      window.fixtureNode.querySelector('.x-node').dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true
      }));
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.fixtureNode.querySelectorAll('.react-flow__handle').length), 32, 'Hover must restore all ports');
    await page.evaluate(() => window.fixtureNode.querySelector('.x-node').dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true,
      relatedTarget: document.body
    })));
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => {
      const normalize = path => {
        const values = (path.match(/-?\d+(?:\.\d+)?/g) || []).map(Number),
          points = [];
        for (let i = 0; i < values.length; i += 2) {
          const point = [values[i].toFixed(2), values[i + 1].toFixed(2)].join(',');
          if (points.at(-1) !== point) points.push(point);
        }
        return points.join(' ');
      };
      const after = [...document.querySelectorAll('.react-flow__edge-path')].map(p => p.getAttribute('d'));
      return after.length === window.fixturePaths.length && after.every((p, i) => normalize(p) === normalize(window.fixturePaths[i]));
    }), true, 'Hover must preserve routes within subpixel measurement tolerance');
    const result = await page.evaluate(async () => {
      const pane = document.querySelector('.react-flow__pane'),
        times = [];
      let alive = true,
        last = performance.now();
      function frame(now) {
        times.push(now - last);
        last = now;
        if (alive) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      const start = performance.now();
      for (let i = 0; i < 90; i++) {
        pane.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 12,
          deltaX: i < 45 ? 15 : -15,
          clientX: 750,
          clientY: 450
        }));
        await new Promise(r => setTimeout(r, 16));
      }
      alive = false;
      times.sort((a, b) => a - b);
      return {
        transform: document.querySelector('.react-flow__viewport').style.transform,
        duration: performance.now() - start,
        frames: times.length,
        p95: times[Math.floor(times.length * .95)],
        handles: document.querySelectorAll('.react-flow__handle').length,
        nodes: document.querySelectorAll('.react-flow__node').length,
        edges: document.querySelectorAll('.react-flow__edge').length
      };
    });
    const beforeZoom = await page.locator('.react-flow__viewport').getAttribute('style');
    await page.evaluate(async () => {
      const pane = document.querySelector('.react-flow__pane');
      for (let i = 0; i < 20; i++) {
        pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
          ctrlKey: true, deltaY: -3, clientX: 750, clientY: 450 }));
        await new Promise(resolve => setTimeout(resolve, 16));
      }
    });
    await page.waitForTimeout(500);
    assert.notEqual(await page.locator('.react-flow__viewport').getAttribute('style'), beforeZoom);
    assert.equal(await page.locator('[data-viewport-moving]').count(), 0, 'Gesture decoration must restore');
    assert(await page.locator('.react-flow__edge-path').count() > 0, 'Edges must survive zoom');
    console.log(JSON.stringify({
      baseline: process.env.BASELINE === '1',
      initial: counts,
      hoverPorts: 32,
      stableEdgePaths: true,
      pinchZoom: true,
      ...result
    }));
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
