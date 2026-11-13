import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openDB } from 'idb';
import { serialize, deserialize } from 'v8';
import { randomUUID, webcrypto } from 'crypto';
import { HAZARD_TRACKING_COLUMNS } from './hazardTrackingFields';
import { createArtifact, loadArtifact, acceptProposal, updateFreshness } from './artifactRepository';
import { generateArtifact } from './artifactGeneration';
import { fixtureSafetyIssues } from '../../project-hazard-analysis/testHelpers/safetyIssueFixtures';
import { consolidateHazardRows } from './consolidateHazardRows';
import { saveCodeArchitectureHazardRun, openCodeArchitectureHazardDB } from '../../code-architecture-hazard-analysis/codeArchitectureHazardStore';

// The full 26,278-row generation runs in the native browser diagnostic.
// Fake IndexedDB retains transaction copies in the Node heap; keep this
// storage-projection fixture bounded while still excluding over 32 MB.
test('1201 wide saved assessments create, generate and accept an HTL without importing excluded columns', async () => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'scale-project', name: 'Large analysis' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Safety', modules: [] }]));
  const count = 1201, excluded = 'Excluded internal diagnostic evidence. '.repeat(900);
  const rows = Array.from({ length: count }, (_, index) => [`R-${index}`, `Hazard ${index}`, `Function ${index % 35}`, 'Urban', 'Driving', 'Wet road', 'Not provided', index % 2 ? 'No' : 'Yes', 'Command omitted', 'Collision', 'Dropped exchange', 'Retain safe commands.', 'Fault injection', 'Safety — Direct', excluded]);
  expect(count * excluded.length).toBeGreaterThan(32000000);
  const db = await openDB('xhandle-project-hazard-analysis', 2, { upgrade(database) { database.createObjectStore('analyses', { keyPath: 'projectId' }); database.createObjectStore('analysisRevisions', { keyPath: 'key' }); } });
  await db.put('analyses', { projectId: 'scale-project', revision: 1, analysisResult: { Summary: [['Raw Analysis Row ID', ...HAZARD_TRACKING_COLUMNS, 'Internal diagnostic evidence'], ...rows] } });
  db.close();
  const id = await createArtifact({ templateId: 'hazard-tracking-list', title: 'Large hazard tracking list', folderId: 'f', projectId: 'scale-project', workspaceType: 'functional', system: 'Mission', sources: [], notes: '' });
  const request = jest.fn(); await generateArtifact(id, { request, hazardIssueRequest: fixtureSafetyIssues });
  let data = await loadArtifact(id);
  expect(data.job.sources.entries).toHaveLength(count);
  expect(data.job.sources.entries[0].attributes).not.toHaveProperty('Internal diagnostic evidence');
  expect(data.job.sources.entries[0].text).toBeUndefined();
  expect(data.job.sections.s2.filter(object => object.hazardTrackingRow)).toHaveLength(count);
  expect(Object.values(data.job.sections).flat().filter(object => object.hazardTrackingRow)).toHaveLength(count);
  expect(data.job.sections.s2.at(-1).sourceEvidence[0].sourceRowId).toBe('R-1200');
  expect(request).not.toHaveBeenCalled();
  await acceptProposal(id, 0, data.job.token); data = await loadArtifact(id);
  expect(data.meta.revision).toBe(1);
  expect(consolidateHazardRows(data.revision.objects)).toHaveLength(35);
  expect(data.revision.objects.filter(object => object.hazardTrackingRow)).toHaveLength(count);
}, 180000);

// The full 26,278-row chunked case also runs in the native-browser diagnostic.
// Keep fake IndexedDB's transaction-copy overhead bounded in the unit suite.
test('1201 chunked code assessments generate and resume after a timeout with linear source reads', async () => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID, getRandomValues: array => webcrypto.getRandomValues(array) } });
  localStorage.clear();
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'code-scale', name: 'Large code analysis', repos: [{ id: 'repo', repoId: 'owner/repo' }] }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Safety', modules: [] }]));
  const count = 1201, excluded = 'Excluded internal diagnostic evidence. '.repeat(2);
  const rows = Array.from({ length: count }, (_, index) => [`CODE-${index}`, `Hazard ${index}`, `Function ${index % 35}`, 'Urban', 'Driving', 'Wet road', 'Not provided', index % 2 ? 'No' : 'Yes', 'Command omitted', 'Collision', 'Dropped exchange', 'Retain safe commands.', 'Fault injection', 'Safety — Direct', excluded]);
  await saveCodeArchitectureHazardRun({ id: 'code-scale-run', projectId: 'code-scale', repoId: 'owner/repo', runState: 'complete', hazardMethod: 'STPA', generatedSheets: { Summary: [['Raw Analysis Row ID', ...HAZARD_TRACKING_COLUMNS, 'Internal diagnostic evidence'], ...rows] }, architectureRowsSnapshot: ['Unrelated repository snapshot. '.repeat(10000)] });
  const db = await openCodeArchitectureHazardDB();
  expect((await db.get('hazardAnalysisRuns', 'code-scale-run')).payload.format).toBe('xhandle-hazard-run-chunks-v1'); db.close();
  const get = jest.spyOn(IDBObjectStore.prototype, 'get');
  const started = Date.now(), progress = [];
  try {
    const id = await createArtifact({ templateId: 'hazard-tracking-list', title: 'Code hazard tracking list', folderId: 'f', projectId: 'code-scale', workspaceType: 'code-architecture', system: 'Mission', sources: [], notes: '' });
    let data = await loadArtifact(id);
    await updateFreshness(id, data.meta.sourceHash, 'unavailable', 'Previous source check timed out.');
    await generateArtifact(id, { hazardIssueRequest: fixtureSafetyIssues, onProgress: (message, details) => { if (details.sourceRowsRead !== undefined) progress.push(details.sourceRowsRead); } });
    data = await loadArtifact(id);
    expect(data.job.sections.s2.filter(object => object.hazardTrackingRow)).toHaveLength(count);
    expect(data.job.sections.s2.at(-1).sourceEvidence[0].sourceRowId).toBe('CODE-1200');
    expect(data.meta.freshness).toBe('current'); expect(data.meta.freshnessError).toBeNull();
    expect(progress).toContain(count);
    await acceptProposal(id, 0, data.job.token);
    expect((await loadArtifact(id)).meta.revision).toBe(1);
    const rootReads = get.mock.instances.filter(store => store.name === 'hazardAnalysisRuns').length;
    expect(rootReads).toBeLessThanOrEqual(8);
    console.info(`[HTL paged regression] ${count} rows captured, generated and accepted in ${Date.now() - started} ms; ${rootReads} root reads.`);
  } finally { get.mockRestore(); }
}, 180000);
