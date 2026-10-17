import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { hasArchitectureConnectionWork, openCbaIndexedDB } from './codeArchitectureStorage';
import { putRawRecord } from '../code-architecture-storage/chunkedRecord';
const fs = require('fs'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default;
const source = fs.readFileSync('src/App.js', 'utf8');
let handler;
traverse(parser.parse(source, { sourceType: 'module', plugins: ['jsx'] }), {
  JSXAttribute({ node }) {
    if (node.name.name !== 'onClick' || !node.value?.expression) return;
    const body = source.slice(node.value.expression.start, node.value.expression.end);
    if (body.includes('Remove the inactive connection')) handler = body;
  },
});
const original = { indexedDB: global.indexedDB, IDBKeyRange: global.IDBKeyRange, structuredClone: global.structuredClone };
beforeEach(() => { global.indexedDB = new IDBFactory(); global.IDBKeyRange = IDBKeyRange; global.structuredClone = value => deserialize(serialize(value)); localStorage.clear(); });
afterEach(() => { Object.assign(global, original); });
const scope = 'cba:p:unused';
async function put(key, value) { const db = await openCbaIndexedDB(); try { await putRawRecord(db, 'copilot_baseline', key, value); } finally { db.close(); } }

test.each([scope, `${scope}:metadata`, `${scope}:run`, `functional-decomposition-checkpoint:${scope}:failed`, `functional-decomposition-checkpoint:${scope}:ready`])('protects persisted record %s without hydrating it', async key => {
  await put(key, { format: 'xhandle-json-tree-v1', root: 'deliberately-unavailable-parts' });
  expect(await hasArchitectureConnectionWork([scope])).toBe(true);
});
test('checks legacy aliases and does not confuse similarly prefixed scopes', async () => {
  await put(`${scope}2`, ['other project data']);
  expect(await hasArchitectureConnectionWork([scope])).toBe(false);
  await put('cba:p:local:legacy:metadata', {});
  expect(await hasArchitectureConnectionWork([scope, 'cba:p:local:legacy'])).toBe(true);
});

function fixture(inspect = hasArchitectureConnectionWork) {
  const repo = { id: 'unused', repoId: 'local:legacy', folderName: 'Folder' };
  let project = { id: 'p', activeRepoId: 'active', repos: [{ id: 'active' }, repo] };
  const activity = { current: false }, alert = jest.fn(), confirm = jest.fn(() => true);
  const env = { repo, project, localStorage, codeArchitectureAnalysisInFlightRef: activity,
    codeArchitectureRowsKey: (p, r) => `cba:${p}:${r}`, codeArchitectureMetaKey: (p, r) => `cbaMeta:${p}:${r}`,
    hasArchitectureConnectionWork: inspect, window: { alert, confirm },
    updateCodeArchitectureProject: (id, update) => { project = { ...project, ...update(project) }; } };
  // Exercise the actual UI callback, including its state recheck.
  const run = () => new Function(...Object.keys(env), `return (${handler})();`)(...Object.values(env)); // eslint-disable-line no-new-func
  return { run, alert, confirm, activity, remaining: () => project.repos.map(entry => entry.id) };
}
test('UI keeps a connection containing a checkpoint even without an analysis timestamp', async () => {
  await put(`functional-decomposition-checkpoint:${scope}:attempt`, { rows: [{}] });
  const f = fixture(); await f.run();
  expect(f.remaining()).toContain('unused'); expect(f.confirm).not.toHaveBeenCalled(); expect(f.alert).toHaveBeenCalled();
});
test('UI fails closed on storage errors', async () => {
  const f = fixture(async () => { throw new Error('Storage unavailable'); }); await f.run();
  expect(f.remaining()).toContain('unused'); expect(f.confirm).not.toHaveBeenCalled();
});
test('UI removes a verified empty connection only after confirmation', async () => {
  const f = fixture(); await f.run();
  expect(f.remaining()).toEqual(['active']); expect(f.confirm).toHaveBeenCalledTimes(1);
});
test('UI protects work started while storage inspection was pending', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const run = f.run(); f.activity.current = true; finish(false); await run;
  expect(f.remaining()).toContain('unused'); expect(f.confirm).not.toHaveBeenCalled();
});
