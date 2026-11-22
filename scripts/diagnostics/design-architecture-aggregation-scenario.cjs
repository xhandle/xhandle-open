// Exercise real diagram controls using immutable synthetic source snapshots.
const assert = require('node:assert/strict');

module.exports = async function verifyArchitectureAggregation(page, root) {
  const before = await page.evaluate(async () => {
    const owners = JSON.parse(localStorage.getItem('xhandle.projects') || '[]');
    if (!owners.some(owner => owner.id === 'example-functional')) localStorage.setItem('xhandle.projects', JSON.stringify([...owners, { id: 'example-functional', name: 'Aggregation source' }]));
    const codeOwners = JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects') || '[]');
    if (!codeOwners.some(owner => owner.id === 'example-code')) localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([...codeOwners, { id: 'example-code', name: 'Aggregation code source', folderId: null, repos: [], activeRepoId: null, createdAt: '2026-11-15T12:00:00Z', updatedAt: '2026-11-15T12:00:00Z' }]));
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('xhandle-design-artifacts', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['metadata', 'revisions', 'presentations'], 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const saved = {};
    for (const kind of ['code', 'functional', 'legacy']) {
      const id = `aggregation-${kind}`, title = `Aggregation ${kind} fixture`, hash = `aggregation-${kind}-v1`, diagramId = `diagram:${id}`;
      const rows = [
        { id: 'start', fromFunction: 'Planner', toFunction: 'Controller', controlAction: 'Start command' },
        { id: 'stop', fromFunction: 'Planner', toFunction: 'Controller', controlAction: 'Stop command' },
        { id: 'feedback', fromFunction: 'Controller', toFunction: 'Planner', controlAction: 'Feedback' },
      ];
      const functional = kind === 'functional';
      const nodes = ['Planner', 'Controller'].map(label => ({ id: functional ? `n:${label}` : label, label,
        ...(functional ? {} : { displayArchitecture: { subsystem: 'Control', csci: 'Software', csc: label, csu: `${label} unit` } }) }));
      const prefix = functional ? 'n:' : '';
      const edges = functional ? rows.map(row => ({ id: row.id, from: prefix + row.fromFunction, to: prefix + row.toFunction, label: row.controlAction, row })) : [
        { id: 'forward', from: 'Planner', to: 'Controller', label: 'Start command · Stop command', relationships: [{ id: 'start', label: 'Start command' }, { id: 'stop', label: 'Stop command' }] },
        { id: 'back', from: 'Controller', to: 'Planner', label: 'Feedback', relationships: [{ id: 'feedback', label: 'Feedback' }] },
      ];
      const snapshot = { nodes, edges, projectionVersion: 2,
        ...(functional ? { native: { rows, storage: { ':edge-aggregation:v1': JSON.stringify({ aggregateAll: true, aggregateBidirectionalAll: true }) } } } : {}) };
      const source = { id: diagramId, title, sourceType: 'architecture-diagram', workspaceType: functional ? 'functional' : 'code-architecture',
        diagramHash: hash, snapshot, ...(functional ? {} : { abstraction: 'csc' }) };
      const config = { templateId: 'architecture', architectureKind: functional ? 'system' : 'code-based', projectId: functional ? 'example-functional' : 'example-code', workspaceType: source.workspaceType, system: 'Controller', sources: [] };
      const meta = { id, title, templateId: 'architecture', templateVersion: 1, projectId: config.projectId, workspaceType: config.workspaceType, folderId: 'trace-folder', config, revision: 1, sourceHash: 'fixture', baseSourceHash: 'fixture', freshness: 'current' };
      const sectionId = `${id}:s1`;
      const objects = [{ id: sectionId, sectionId: 's1', parentId: null, title, kind: 'section', text: '', sourceIds: [] },
        { id: `${id}:diagram`, sectionId: 's1', parentId: sectionId, title, kind: 'diagram', text: '', sourceIds: [diagramId], sourceEvidence: [source] }];
      const revision = { id: `${id}:1`, artifactId: id, number: 1, objects, sources: { hash: 'fixture', entries: [source] }, sourceHash: 'fixture', createdAt: '2026-11-15T12:00:00Z' };
      tx.objectStore('metadata').put(meta); tx.objectStore('revisions').put(revision); saved[id] = JSON.stringify(revision);
      if (kind === 'legacy') tx.objectStore('presentations').put({ id: JSON.stringify([id, diagramId, hash]), artifactId: id, projectId: config.projectId,
        presentation: { storage: { ':edge-aggregation:v1': JSON.stringify({ aggregateAll: true, aggregateBidirectionalAll: true }) } } });
    }
    await done; db.close();
    return { saved, projects: localStorage.getItem('xhandle.projects'), codeProjects: localStorage.getItem('xhandle.codeArchitectureProjects') };
  });
  const canvas = page.locator('.architecture-canvas');
  const edges = canvas.locator('.react-flow__edge');
  const count = async expected => {
    try { await page.waitForFunction(n => document.querySelectorAll('.architecture-canvas .react-flow__edge').length === n, expected); }
    catch (error) {
      console.error('Aggregation diagnostics', await page.evaluate(async () => {
        const db = await new Promise(resolve => { const r = indexedDB.open('xhandle-design-artifacts', 2); r.onsuccess = () => resolve(r.result); });
        const records = await new Promise(resolve => { const r = db.transaction('presentations').objectStore('presentations').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
        return { edges: [...document.querySelectorAll('.architecture-canvas .react-flow__edge')].map(edge => edge.outerHTML.slice(0, 300)), presentations: records.filter(record => record.artifactId?.startsWith('aggregation-')).map(record => ({ id: record.id, aggregation: record.presentation?.storage?.[':edge-aggregation:v1'] })) };
      })); throw error;
    }
  };
  const open = async kind => {
    await page.reload(); await page.getByRole('button', { name: 'Design Management', exact: true }).click();
    await page.locator('.design-library-pane').getByRole('button', { name: `Aggregation ${kind} fixture`, exact: true }).click();
    await page.getByRole('heading', { name: `Aggregation ${kind} fixture`, exact: true }).waitFor();
    await canvas.locator('.react-flow__node').first().waitFor();
  };
  const click = title => canvas.getByTitle(title, { exact: true }).click();
  const ids = async () => {
    const values = await edges.evaluateAll(items => items.map(item => item.getAttribute('data-testid')).sort());
    assert(values.every(Boolean), 'Every original edge has a stable rendered identity');
    assert.equal(new Set(values).size, values.length);
    return values;
  };
  await open('legacy'); await count(1); await click('Expand all bidirectional bundles'); await count(3);
  await open('code'); await count(3); const originals = await ids();
  await click('Aggregate repeated directional edges'); await count(2);
  await click('Aggregate all traffic between node pairs regardless of direction'); await count(1);
  assert.equal(await canvas.getByTitle('Expand directional edge bundles', { exact: true }).count(), 0);
  await click('Expand all bidirectional bundles'); await count(3); assert.deepEqual(await ids(), originals);
  await click('Undo last diagram change'); await count(1);
  await click('Redo diagram change'); await count(3); assert.deepEqual(await ids(), originals);
  await page.screenshot({ path: root + '/architecture-edges-expanded.png' });
  await click('Aggregate repeated directional edges'); await count(2);
  const readSavedGrouping = async () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('xhandle-design-artifacts', 2); r.onsuccess = () => resolve(r.result); });
    const key = JSON.stringify(['aggregation-code', 'diagram:aggregation-code', 'aggregation-code-v1']);
    const record = await new Promise(resolve => { const r = db.transaction('presentations').objectStore('presentations').get(key); r.onsuccess = () => resolve(r.result); }); db.close();
    return JSON.parse(record?.presentation?.storage?.[':edge-aggregation:v1'] || '{}').aggregateAll === true;
  });
  let grouped = false;
  for (let attempt = 0; attempt < 100 && !grouped; attempt++) { grouped = await readSavedGrouping(); if (!grouped) await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(grouped, true, 'Directional grouping is saved before reloading');
  await open('code'); await count(2); await click('Expand directional edge bundles'); await count(3); assert.deepEqual(await ids(), originals);
  await open('functional'); await count(3);
  const functionalOriginals = await ids();
  await click('Aggregate repeated directional edges'); await count(2);
  await click('Aggregate all traffic between node pairs regardless of direction'); await count(1);
  await click('Expand all bidirectional bundles'); await count(3); assert.deepEqual(await ids(), functionalOriginals);
  const after = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('xhandle-design-artifacts', 2); r.onsuccess = () => resolve(r.result); });
    const saved = {};
    for (const kind of ['code', 'functional', 'legacy']) {
      const id = `aggregation-${kind}`;
      const revision = await new Promise(resolve => { const r = db.transaction('revisions').objectStore('revisions').get(`${id}:1`); r.onsuccess = () => resolve(r.result); }); saved[id] = JSON.stringify(revision);
    }
    db.close(); return { saved, projects: localStorage.getItem('xhandle.projects'), codeProjects: localStorage.getItem('xhandle.codeArchitectureProjects') };
  });
  assert.deepEqual(after, before, 'Aggregation only changes artifact presentation, never source revisions or owning projects');
};
