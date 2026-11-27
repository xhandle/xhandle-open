import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { clearCodeHazardAnalysis, restoreCodeHazardAnalysis, readCodeHazardReset, codeHazardResetCounts } from './codeHazardReset';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun, openCodeArchitectureHazardDB, deleteCodeArchitectureHazardRuns } from './codeArchitectureHazardStore';
import { HAZARD_RESET_ENTRIES, HAZARD_RESET_SNAPSHOTS, HAZARD_CHUNKS } from './hazardSchema';
import { claimHazardSaveAttempt } from './hazardSaveAttempt';
import { PAGED_HAZARD } from './hazardRowIndex';

beforeAll(() => {
  global.structuredClone = value => deserialize(serialize(value));
  global.IDBKeyRange = IDBKeyRange;
  Object.defineProperty(global, 'crypto', { value: webcrypto, configurable: true });
});
beforeEach(() => { global.indexedDB = new IDBFactory(); localStorage.clear(); });
const scope = { projectId: 'synthetic-project', repoId: 'synthetic-repository' };
const run = (id, extra = {}) => ({ ...scope, id, hazardMethod: 'STPA-Textbook', updatedAt: '2026-01-01T00:00:00.000Z',
  generatedSheets: { Summary: [['Function', 'Hazard'], ['Controller', 'Incorrect controlled state']] }, ...extra });
const contexts = [{ id: 'context-a', scenario: 'Nominal operation', mode: 'Automatic' }];

test('clear and restore preserve chunked results, checkpoints, contexts and review records within the repository scope', async () => {
  const original = run('large', { source: 'Synthetic evidence. '.repeat(20000), userPreprocessing: { 'ROW-1': { values: { Hazard: 'Reviewed state' } } } });
  claimHazardSaveAttempt(original);
  await saveCodeArchitectureHazardRun(original);
  await saveCodeArchitectureHazardRun(run('unrelated', { repoId: 'other-repository' }));
  const db = await openCodeArchitectureHazardDB();
  const checkpoint = { id: 'checkpoint-a', scope: JSON.stringify({ ...scope, method: 'STPA' }), value: { id: 'ROW-1', uca: 'Retained assessment' } };
  await db.put('generationCheckpoints', checkpoint);
  await db.put('generationCheckpoints', { ...checkpoint, id: 'checkpoint-b', scope: JSON.stringify({ ...scope, repoId: 'other-repository' }) });
  const reviewItems = [{ id: 'review-a', sourceRunId: original.id, currentContent: { decision: 'Yes' } }];
  await clearCodeHazardAnalysis({ ...scope, expectedRunId: original.id, contexts, reviewItems, contextRepoId: 'connection-id' });
  expect(await getLatestCodeArchitectureHazardRun(scope)).toBeNull();
  expect(await getLatestCodeArchitectureHazardRun({ ...scope, repoId: 'other-repository' })).toMatchObject({ id: 'unrelated' });
  expect(await db.get('generationCheckpoints', checkpoint.id)).toBeUndefined();
  expect(await db.get('generationCheckpoints', 'checkpoint-b')).toBeDefined();
  expect(await readCodeHazardReset(scope)).toMatchObject({ contexts, reviewCount: 1, runCount: 1 });
  expect((await db.getAllFromIndex(HAZARD_CHUNKS, 'runId', original.id))).toHaveLength(0);
  const restored = await restoreCodeHazardAnalysis(scope);
  expect(restored.reviewItems).toEqual(reviewItems);
  expect(restored.contextRepoId).toBe('connection-id');
  expect(await getLatestCodeArchitectureHazardRun(scope)).toMatchObject(original);
  expect(await db.get('generationCheckpoints', checkpoint.id)).toEqual(checkpoint);
  // Auxiliary restoration can be retried without replacing or duplicating runs.
  await expect(restoreCodeHazardAnalysis(scope)).resolves.toMatchObject({ runCount: 1 });
  const latest = await getLatestCodeArchitectureHazardRun(scope);
  await saveCodeArchitectureHazardRun({ ...latest, updatedAt: '2026-01-02T00:00:00.000Z' });
  db.close();
});

test('snapshot failure aborts removal and retains both live results and the previous recovery snapshot', async () => {
  await saveCodeArchitectureHazardRun(run('first'));
  await clearCodeHazardAnalysis({ ...scope, expectedRunId: 'first', contexts });
  await saveCodeArchitectureHazardRun(run('second'));
  const { IDBObjectStore } = require('fake-indexeddb');
  const put = IDBObjectStore.prototype.put;
  const failure = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
    if (this.name === HAZARD_RESET_SNAPSHOTS) throw new DOMException('Storage full', 'QuotaExceededError');
    return put.apply(this, args);
  });
  try { await expect(clearCodeHazardAnalysis({ ...scope, expectedRunId: 'second', contexts: [] })).rejects.toThrow('Storage full'); }
  finally { failure.mockRestore(); }
  expect(await getLatestCodeArchitectureHazardRun(scope)).toMatchObject({ id: 'second' });
  expect(await readCodeHazardReset(scope)).toMatchObject({ contexts });
});

test('stale dialogs cannot clear newer results and restoration cannot overwrite a new run', async () => {
  await saveCodeArchitectureHazardRun(run('first'));
  await expect(clearCodeHazardAnalysis({ ...scope, expectedRunId: 'stale' })).rejects.toThrow('changed');
  expect(await getLatestCodeArchitectureHazardRun(scope)).toMatchObject({ id: 'first' });
  await clearCodeHazardAnalysis({ ...scope, expectedRunId: 'first', resetScope: 'results-and-contexts', contexts });
  expect(await readCodeHazardReset(scope)).toMatchObject({ resetScope: 'results-and-contexts', contexts });
  await saveCodeArchitectureHazardRun(run('new'));
  await expect(restoreCodeHazardAnalysis(scope)).rejects.toThrow('New hazard results exist');
  expect(await getLatestCodeArchitectureHazardRun(scope)).toMatchObject({ id: 'new' });
});

test('an incomplete saved payload cannot replace a usable recovery snapshot', async () => {
  await saveCodeArchitectureHazardRun(run('retained'));
  await clearCodeHazardAnalysis({ ...scope, expectedRunId: 'retained', contexts });
  await saveCodeArchitectureHazardRun(run('damaged', { source: 'Synthetic evidence. '.repeat(20000) }));
  const db = await openCodeArchitectureHazardDB();
  const chunks = await db.getAllFromIndex(HAZARD_CHUNKS, 'runId', 'damaged');
  expect(chunks.length).toBeGreaterThan(0);
  await db.delete(HAZARD_CHUNKS, chunks[0].id);
  await expect(clearCodeHazardAnalysis({ ...scope, expectedRunId: 'damaged' })).rejects.toThrow('missing chunks');
  expect(await db.get('runMetadata', 'damaged')).toBeDefined();
  expect(await readCodeHazardReset(scope)).toMatchObject({ contexts });
  db.close();
});

test('permanent repository removal also removes its recovery snapshot', async () => {
  await saveCodeArchitectureHazardRun(run('first'));
  await clearCodeHazardAnalysis({ ...scope, expectedRunId: 'first' });
  await deleteCodeArchitectureHazardRuns(scope);
  expect(await readCodeHazardReset(scope)).toBeNull();
  const db = await openCodeArchitectureHazardDB();
  expect(await db.count(HAZARD_RESET_ENTRIES)).toBe(0);
  db.close();
});

test('dialog counts use paged metadata without loading the analysis payload', () => {
  expect(codeHazardResetCounts({ [PAGED_HAZARD]: { total: 3500 }, userPreprocessing: { a: {}, b: {} } }, contexts, 4))
    .toEqual({ rawRows: 3500, draftRows: 2, safetyIssues: 0, reports: 0, reviewItems: 4, contexts: 1 });
});
