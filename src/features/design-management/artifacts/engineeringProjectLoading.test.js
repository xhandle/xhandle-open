import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { openArtifactDatabase, writeArtifactStorage } from './artifactRepository';
import { putArtifactJob, deleteArtifactJob } from './artifactJobSummary';
import { readProjectOverview, readProjectTrace } from './engineeringProjectLoading';

beforeEach(() => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
});
afterEach(() => jest.restoreAllMocks());
async function seed(summary = undefined) {
  const db = await openArtifactDatabase();
  await db.put('metadata', { id: 'p', recordType: 'systems-engineering-project', title: 'Example', ownerProjects: [], state: 'accepted', members: [{ id: 'a' }] });
  await db.put('metadata', { id: 'a', programId: 'p', revision: 1, title: 'Architecture', config: {}, draftSummary: summary });
  await db.put('jobs', { id: 'a', artifactId: 'a', state: 'paused', sections: { scope: [{ text: 'Saved' }] }, sectionParts: { scope: { completed: { one: [] } }, interfaces: { completed: { one: [], two: [] } } }, sources: { evidence: 'x'.repeat(1000000) } });
  await db.put('revisions', { id: 'a:1', objects: [{ id: 'a:n', title: 'Controller', kind: 'requirement', sourceEvidence: [{ id: 'source', title: 'Diagram', sourceType: 'architecture-diagram', diagramId: 'diagram', diagramHash: 'saved', snapshot: { evidence: 'y'.repeat(1000000) } }] }] });
  db.close();
}
function reads() {
  const calls = [], get = IDBObjectStore.prototype.get;
  jest.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function(key) { calls.push([this.name, key]); return get.call(this, key); });
  return calls;
}
test('project overview reads metadata only once summaries exist, never revisions, jobs or baselines', async () => {
  await seed({ state: 'paused', completedSections: 1, partialParts: 2 });
  const calls = reads(), progress = [];
  const data = await readProjectOverview('p', value => progress.push(value.percent));
  expect(calls).toEqual([['metadata', 'p'], ['metadata', 'a']]);
  expect(data.records[0].meta.draftSummary.partialParts).toBe(2);
  expect(data.records[0]).not.toHaveProperty('job'); expect(data.records[0]).not.toHaveProperty('revision');
  expect(JSON.stringify(data).length).toBeLessThan(2000);
  expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(100); expect(progress).toEqual([...progress].sort((a,b) => a-b));
});
test('legacy drafts are summarized once; subsequent opens do not reread large evidence', async () => {
  await seed(); const calls = reads();
  const first = await readProjectOverview('p');
  expect(first.records[0].meta.draftSummary).toEqual({ state: 'paused', completedSections: 1, partialParts: 2 });
  expect(calls.filter(([store]) => store === 'jobs')).toHaveLength(1);
  calls.length = 0; await readProjectOverview('p');
  expect(calls.every(([store]) => store === 'metadata')).toBe(true);
});
test('job checkpoints and removal atomically update compact progress summaries', async () => {
  await seed(null);
  await writeArtifactStorage(['metadata', 'jobs'], tx => putArtifactJob(tx, { id: 'a', state: 'ready', sections: { scope: [], interfaces: [] } }));
  expect((await readProjectOverview('p')).records[0].meta.draftSummary).toEqual({ state: 'ready', completedSections: 2, partialParts: 0 });
  await expect(writeArtifactStorage(['metadata', 'jobs'], async tx => { await deleteArtifactJob(tx, 'a'); throw new Error('rollback'); })).rejects.toThrow('rollback');
  expect((await readProjectOverview('p')).records[0].meta.draftSummary.state).toBe('ready');
  await writeArtifactStorage(['metadata', 'jobs'], tx => deleteArtifactJob(tx, 'a'));
  expect((await readProjectOverview('p')).records[0].meta.draftSummary).toBeNull();
});
test('trace list keeps every relationship but transfers no heavyweight evidence or baselines', async () => {
  await seed(null); const calls = reads(); const progress = [];
  const graph = await readProjectTrace('p', value => progress.push(value.percent));
  expect(graph.links.some(link => link.type === 'refines')).toBe(true);
  expect(graph.nodes.some(node => node.hasArchitectureEvidence)).toBe(true);
  expect(graph.nodes.every(node => !node.evidence)).toBe(true);
  expect(JSON.stringify(graph).length).toBeLessThan(4000);
  expect(calls.some(([store]) => store === 'jobs' || store === 'baselines')).toBe(false);
  expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(100);
});
test('explicit accepted trace mode does not load drafts even when the project proposal is ready', async () => {
  await seed(null);
  const db = await openArtifactDatabase();
  const program = await db.get('metadata', 'p');
  await db.put('metadata', { ...program, state: 'ready' }); db.close();
  const calls = reads();
  await readProjectTrace('p', undefined, undefined, false);
  expect(calls.some(([store]) => store === 'jobs')).toBe(false);
  calls.length = 0;
  await readProjectTrace('p', undefined, undefined, true);
  expect(calls.filter(([store]) => store === 'jobs')).toEqual([['jobs', 'a']]);
});
