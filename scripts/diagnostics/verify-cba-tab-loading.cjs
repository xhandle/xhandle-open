// Actual production App, disposable profiles and synthetic saved data only.
// node scripts/diagnostics/verify-cba-tab-loading.cjs --build /absolute/build --out /tmp/loading-chrome.json --browser chrome --seeder /tmp/fixture/seed.js --rows 15000 --nodes 100
const assert = require('node:assert/strict');
const fs = require('node:fs');

module.exports = async function verifyCbaTabLoading({page, cdp, result, out}) {
  const report = result.loadingUi = {
    methodology: 'Actual App and real IndexedDB/worker data. Fourfold main-thread CPU throttling makes brief preparation states observable; timings are not performance results. One genuine hazard layout progress event at or above76% is delivered, then later real messages are queued until the screenshot is captured and released unchanged.',
    phases: [], screenshots: {},
  };
  result.methodology = {version: 1, scenario: 'single visible CBA tab loading indicator', details: report.methodology};
  const save = () => fs.writeFileSync(out + '.loading-partial.json', JSON.stringify(result, null, 2));
  page.setDefaultTimeout(30000);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
  await page.evaluate(() => {
    const audit = window.__loadingUi = {phase: '', transitions: [], frames: 0, active: new Set(), holdLayout: false, gatedProgress: null, activePhase: false};
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...values) {
        super(...values); this.auditQueue = []; this.auditClosed = false;
        this.addEventListener('message', event => {
          if (this.auditClosed) { this.auditQueue.push(event); return; }
          this.auditHandler?.call(this, event);
          if (audit.holdLayout && this.auditOperation === 'layout' && event.data?.type === 'progress'
            && event.data.progress.completed >= event.data.progress.total * 0.76 && event.data.progress.completed < event.data.progress.total) {
            this.auditClosed = true; audit.gatedProgress = event.data.progress;
          }
        });
      }
      set onmessage(handler) { this.auditHandler = handler; }
      get onmessage() { return this.auditHandler; }
      postMessage(message, ...values) {
        if (message?.run?.__xhandlePagedHazard) { this.auditOperation = message.options?.operation || 'page'; audit.active.add(this); }
        return super.postMessage(message, ...values);
      }
      terminate() { audit.active.delete(this); this.auditQueue.length = 0; return super.terminate(); }
      release() {
        this.auditClosed = false;
        for (const event of this.auditQueue.splice(0)) this.auditHandler?.call(this, event);
      }
    };
    audit.release = () => { audit.holdLayout = false; for (const worker of audit.active) worker.release(); };
    const visible = element => {
      if (!element?.isConnected) return false;
      let bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return false;
      let top = Math.max(0, bounds.top), bottom = Math.min(innerHeight, bounds.bottom), left = Math.max(0, bounds.left), right = Math.min(innerWidth, bounds.right);
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
          || style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return false;
        if (parent !== element && /auto|hidden|scroll|clip/.test(style.overflow + style.overflowY + style.overflowX)) {
          bounds = parent.getBoundingClientRect(); top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
        }
      }
      return bottom > top && right > left;
    };
    const loadingText = /^(?:loading|preparing|refreshing saved|reconnecting|restoring|building traceability|arranging|upgrading saved)/i;
    audit.read = () => {
      const candidates = new Set();
      for (const element of document.querySelectorAll('[role="progressbar"],.xhandle-working-mark,[role="status"]')) {
        if (!visible(element)) continue;
        if (element.matches('[role="status"]') && !loadingText.test(element.textContent.trim()) && !element.querySelector('.xhandle-working-mark')) continue;
        candidates.add(element.closest('[role="progressbar"],[role="status"]') || element);
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const value = text.textContent.trim(), element = text.parentElement;
        if (!value || value.length > 180 || !loadingText.test(value) || !visible(element)) continue;
        candidates.add(element.closest('[role="progressbar"],[role="status"]') || element);
      }
      const roots = [...candidates].filter(element => ![...candidates].some(other => other !== element && other.contains(element)));
      return {count: roots.length, indicators: roots.map(element => ({role: element.getAttribute('role'), label: element.getAttribute('aria-label'), text: element.textContent.trim().slice(0, 200), value: element.getAttribute('aria-valuenow'), marks: element.matches('.xhandle-working-mark') ? 1 : element.querySelectorAll('.xhandle-working-mark').length})), activeHazardWorkers: audit.active.size};
    };
    audit.start = phase => { audit.phase = phase; audit.transitions = []; audit.frames = 0; audit.readyFrames = 0; audit.activePhase = true; };
    const tick = time => {
      if (audit.activePhase) {
        const state = audit.read(), previous = audit.transitions.at(-1), signature = JSON.stringify(state);
        if (previous?.signature === signature) { previous.frames++; previous.lastTime = time; }
        else audit.transitions.push({...state, signature, firstTime: time, lastTime: time, frames: 1});
        audit.readyFrames = state.count === 0 && state.activeHazardWorkers === 0 ? audit.readyFrames + 1 : 0;
        audit.frames++;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function phase(name, action, ready, {gate = false, requireLoading = false} = {}) {
    await page.evaluate(name => window.__loadingUi.start(name), name);
    if (gate) await page.evaluate(() => { window.__loadingUi.holdLayout = true; window.__loadingUi.gatedProgress = null; });
    await action();
    if (gate) {
      await page.waitForFunction(() => window.__loadingUi.gatedProgress);
      await frame();
      report.hazardProgressScreenshotState = await page.evaluate(() => ({progress: window.__loadingUi.gatedProgress, ...window.__loadingUi.read()}));
      report.screenshots.hazardPreparing = out + '.hazard-preparing.png';
      await page.screenshot({path: report.screenshots.hazardPreparing}); save();
      await page.evaluate(() => window.__loadingUi.release());
    }
    if (requireLoading) await page.waitForFunction(() => window.__loadingUi.transitions.some(state => state.count > 0));
    await ready();
    await page.waitForFunction(() => window.__loadingUi.readyFrames >= 4);
    await frame();
    const sample = await page.evaluate(() => {
      const audit = window.__loadingUi; audit.activePhase = false;
      return {name: audit.phase, frames: audit.frames, transitions: audit.transitions.map(({signature, ...state}) => state), ready: audit.read()};
    });
    sample.maximumVisibleIndicators = Math.max(0, ...sample.transitions.map(state => state.count));
    sample.loadingFrames = sample.transitions.filter(state => state.count > 0).reduce((sum, state) => sum + state.frames, 0);
    report.phases.push(sample); save();
    assert.ok(sample.maximumVisibleIndicators <= 1, name + ' must never show competing visible loading indicators');
    assert.equal(sample.ready.count, 0, name + ' must remove its loader when ready');
    if (requireLoading) assert.ok(sample.loadingFrames > 0, name + ' must exercise a visible loading state');
    return sample;
  }
  try {
    await phase('Architecture Diagram', () => page.getByRole('button', {name: 'CBA performance fixture', exact: true}).first().click(), () => page.locator('.react-flow__node-bidirectional').first().waitFor());
    await phase('Architecture Table', async () => {
      await page.getByLabel('Code architecture actions', {exact: true}).click();
      await page.getByRole('button', {name: 'Table', exact: true}).click();
    }, () => page.getByRole('button', {name: 'Copy code architecture functional decomposition table', exact: true}).waitFor());
    for (const [name, content] of [['Software Requirements','SWR-0'],['System Requirements','SYS-0'],['Subsystem Requirements','SUB-0'],['System / Subsystem Design','DES-0'],['Traceability Matrix','TRACE-']]) {
      await phase(name, () => page.getByRole('button', {name, exact: true}).click(), () => page.locator('tbody').filter({hasText: content}).waitFor(), {requireLoading: true});
    }
    await phase('Traceability refresh', () => page.getByRole('button', {name: 'Refresh Traceability', exact: true}).click(), () => page.locator('tbody').filter({hasText: 'TRACE-'}).waitFor(), {requireLoading: true});
    await phase('Hazard cold load', async () => {
      await page.getByRole('button', {name: 'Hazard & Remediation', exact: true}).click();
      const analysis = page.getByRole('button', {name: 'Code Architecture Hazard Analysis', exact: true});
      if (await analysis.count()) await analysis.click();
    }, () => page.locator('[data-hazard-row-index="0"]').waitFor(), {gate: true, requireLoading: true});
    assert.equal(report.hazardProgressScreenshotState.count, 1, 'Stalled real hazard progress must show exactly one loader');
    report.screenshots.hazardReady = out + '.hazard-ready.png';
    await page.screenshot({path: report.screenshots.hazardReady});
    const scroller = page.locator('[data-hazard-scroll]'), before = await scroller.evaluate(element => element.scrollTop);
    await phase('Hazard short scroll', async () => {
      const bounds = await scroller.boundingBox(); await page.mouse.move(bounds.x + 250, bounds.y + Math.min(180, bounds.height / 2));
      for (let index = 0; index < 12; index++) await page.mouse.wheel(0, 600);
    }, () => page.waitForFunction(() => document.querySelector('[data-hazard-scroll]').scrollTop > 0 && !document.querySelector('[data-hazard-loading-row]')));
    report.hazardScroll = {before, after: await scroller.evaluate(element => element.scrollTop), renderedRows: await page.locator('[data-hazard-row-index]').count()};
    assert.ok(report.hazardScroll.after > before);
    await phase('Safety Remediation', () => page.getByRole('button', {name: 'Safety Remediation', exact: true}).click(), () => page.getByRole('heading', {name: 'Safety Remediation', exact: true}).waitFor());
    report.passed = true; save();
  } finally {
    await page.evaluate(() => { window.__loadingUi.activePhase = false; window.__loadingUi.release(); });
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
  }
};

if (require.main === module) {
  process.argv.push('--workspace', 'cba', '--loadingUi', '1', '--interactions', 'skip', '--trace', '0');
  require('./desktop-interaction-performance.cjs');
}
