// Run with Electron after npm run build. Disposable synthetic IndexedDB only.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-artifact-worker-'));
app.setPath('userData', profile);
let server;
app.whenReady().then(async () => {
  const build = path.resolve(process.env.XHANDLE_AUDIT_BUILD_DIR || path.join(__dirname, '../../build'));
  const worker = fs.readdirSync(path.join(build, 'static/js')).find(name => name.endsWith('.js') && fs.readFileSync(path.join(build, 'static/js', name), 'utf8').includes('Unknown artifact background operation.'));
  assert(worker, 'Production artifact worker must be emitted');
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.end('<!doctype html><button id="probe">Workspace action</button>'); return; }
    const file = path.join(build, req.url.split('?')[0]);
    if (!file.startsWith(build) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  win.on('unresponsive', () => { throw new Error('Synthetic artifact processing made the page unresponsive'); });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const request = indexedDB.open('xhandle', 4);
    request.onupgradeneeded = () => request.result.createObjectStore('copilot_baseline', { keyPath: 'key' });
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const rows = Array.from({ length: 2000 }, (_, i) => ({ traceId: 'call-' + i, fromFunction: 'Function ' + i, toFunction: 'Function ' + (i + 1), controlAction: 'Invoke', fromFile: 'source.cpp', fromArchitecture: { system: 'Vehicle', subsystem: 'Control', csci: 'Controller', csc: 'Runtime', csu: 'Unit ' + (i % 80) }, toArchitecture: { system: 'Vehicle', subsystem: 'Control', csci: 'Controller', csc: 'Runtime', csu: 'Unit ' + ((i + 1) % 80) }, ...(i === 0 ? { savedEvidence: 'z'.repeat(32000100) } : {}) }));
    const tx = db.transaction('copilot_baseline', 'readwrite'); tx.objectStore('copilot_baseline').put({ key: 'cba:p:repo', value: rows });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    const config = { templateId: 'architecture', architectureKind: 'code-based', title: 'Large CSU fixture', projectId: 'p', workspaceType: 'code-architecture', folderId: 'f', system: 'Vehicle', sources: [], architectureSources: [{ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo', abstraction: 'csu' }] };
    const storage = { 'xhandle.projects': '[]', 'xhandle.codeArchitectureProjects': JSON.stringify([{ id: 'p', name: 'Controller', repos: [{ id: 'repo', repoName: 'controller' }] }]), 'xhandle:req-projects': JSON.stringify([{ id: 'f', name: 'Designs', modules: [] }]) };
    const tasks = [];
    async function background(operation, payload) {
      const thread = new Worker('/static/js/${worker}');
      let last = performance.now(), maximumGap = 0, ticks = 0, clicks = 0;
      const button = document.getElementById('probe'), click = () => clicks++;
      button.addEventListener('click', click);
      const heartbeat = setInterval(() => { const now = performance.now(); maximumGap = Math.max(maximumGap, now - last); last = now; ticks++; button.click(); }, 20);
      const started = performance.now();
      try {
        const value = await new Promise((resolve, reject) => {
          thread.onmessage = ({ data }) => data.error ? reject(new Error(data.error.message)) : resolve(data.result);
          thread.onerror = event => reject(new Error(event.message));
          thread.postMessage({ operation, payload });
        });
        maximumGap = Math.max(maximumGap, performance.now() - last);
        tasks.push({ operation, durationMs: Math.round(performance.now() - started), maximumGapMs: Math.round(maximumGap), ticks, clicks });
        return value;
      } finally { clearInterval(heartbeat); button.removeEventListener('click', click); thread.terminate(); }
    }
    const sources = await background('sources', { config, storage });
    const hash = await background('source-hash', { config, storage });
    if (hash !== sources.hash) throw new Error('Worker checksum changed between full capture and freshness check');
    const diagram = sources.entries.find(entry => entry.snapshot);
    const relationships = [...diagram.snapshot.edges.flatMap(edge => edge.relationships || []), ...diagram.snapshot.nodes.flatMap(node => node.internalRelationships || [])];
    if (relationships.length !== rows.length) throw new Error('Original relationships were omitted');
    if (!relationships.some(edge => edge.row.savedEvidence?.length === 32000100)) throw new Error('Large saved evidence was truncated');
    const display = { snapshot: { nodes: diagram.snapshot.nodes.map(({ id, label, parentId, group }) => ({ id, label, parentId, group })), edges: diagram.snapshot.edges.map(({ id, from, to, label }) => ({ id, from, to, label })) } };
    const layout = await background('layout', display);
    if (layout.nodes.length !== display.snapshot.nodes.length) throw new Error('Layout lost nodes');
    return { tasks, relationships: relationships.length, nodes: layout.nodes.length, evidenceCharacters: 32000100 };
  })()`);
  for (const task of result.tasks) {
    assert(task.ticks > 0 && task.clicks === task.ticks, JSON.stringify(task));
    assert(task.maximumGapMs < 1500, `UI stalled: ${JSON.stringify(task)}`);
  }
  console.log('PASS background capture, checksum-only freshness, and layout retain complete evidence with responsive UI', result);
  win.destroy(); server.close(); app.quit();
}).catch(error => { console.error(error); process.exitCode = 1; server?.close(); app.quit(); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
