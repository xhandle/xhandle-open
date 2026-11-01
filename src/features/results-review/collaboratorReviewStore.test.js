import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { openReviewDB } from './reviewStore';
import { putStoredReviewItems, readStoredReviewItems, saveCollaboratorReviewEvidence, deleteStoredReviewItems, readHazardDecisionEvidence, hazardDecisionEvidence } from './collaboratorReviewStore';
import { createReviewItemsFromGeneratedTable, createVibeReviewDecisionEvidence, createVibeReviewSessionEvidence } from './reviewUtils';

const decision = (n = 1, overrides = {}) => createVibeReviewDecisionEvidence({
  domain: 'hazard-analysis', projectId: 'p', sessionId: 'session', rowId: 'HA-1', rowIndex: 0,
  reviewTarget: 'guidePhraseApplicable', action: 'accept', decision: 'Yes',
  beforeRow: ['HA-1', 'No'], afterRow: ['HA-1', 'Yes'], columns: ['Raw Analysis Row ID', 'Guide Phrase Applicable'],
  timestamp: `2026-10-31T12:00:0${n}.000Z`, ...overrides,
});
let oldDb, oldClone;
beforeEach(() => {
  oldDb = global.indexedDB; oldClone = global.structuredClone;
  global.indexedDB = new IDBFactory(); global.structuredClone = value => deserialize(serialize(value));
  localStorage.clear();
});
afterEach(() => { jest.restoreAllMocks(); global.indexedDB = oldDb; global.structuredClone = oldClone; });

test('writes concurrent Collaborator decisions without reading or rewriting the legacy collection', async () => {
  const [legacy] = createReviewItemsFromGeneratedTable({sourceFeature: 'AI Hazard Analysis', artifactType: 'hazard_summary_table', artifactId: 'hazard-summary:p', sourceRunId: 'old-run', projectId: 'p', rows: [['HA-1', 'No']], columns: ['Raw Analysis Row ID', 'Guide Phrase Applicable']});
  await putStoredReviewItems([legacy, ...Array.from({length: 1000}, (_, i) => ({id:`old-${i}`,projectId:'other',originalContent:{row:'large legacy evidence '.repeat(100)}}))]);
  const all = jest.spyOn(IDBObjectStore.prototype, 'getAll');
  const writes = jest.spyOn(IDBObjectStore.prototype, 'put');
  const a = decision(1), b = decision(2, {decision:'No',afterRow:['HA-1','No']});
  await Promise.all([saveCollaboratorReviewEvidence(a), saveCollaboratorReviewEvidence(b)]);
  expect(all).not.toHaveBeenCalled(); expect(writes).toHaveBeenCalledTimes(2);
  const stored = await readStoredReviewItems();
  expect(stored).toHaveLength(1002);
  expect(stored.find(item => item.id === legacy.id)).toEqual(legacy);
  const result = stored.find(item => item.id === a.id);
  expect(result.originalContent).toEqual(legacy.originalContent);
  expect(result.history).toHaveLength(2);
  expect(result.currentContent.row).toEqual(['HA-1','No']);
  expect(result.sourceRunId).toBe('old-run');
});

test('import, export, delete and undo preserve unrelated stored history', async () => {
  await putStoredReviewItems([{id:'keep',projectId:'other',currentContent:{row:'untouched'}},decision()]);
  const exported = await readStoredReviewItems(item => item.projectId === 'p');
  const removed = await deleteStoredReviewItems(exported.map(item => item.id));
  expect(removed).toEqual(exported);
  expect((await readStoredReviewItems()).map(item => item.id)).toEqual(['keep']);
  await putStoredReviewItems(exported);
  expect(await readStoredReviewItems(item => item.projectId === 'p')).toEqual(exported);
  await putStoredReviewItems([{...exported[0],status:'rejected'}],{preserveExisting:true});
  expect(await readStoredReviewItems(item => item.projectId === 'p')).toEqual(exported);
});

test('failed multi-record import rolls back instead of losing prior evidence', async () => {
  await putStoredReviewItems([{id:'keep',projectId:'p'}]);
  const real = IDBObjectStore.prototype.put;
  jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(value) {
    if(value.id === 'fail') throw new Error('quota exhausted');
    return real.call(this,value);
  });
  await expect(putStoredReviewItems([{id:'new'},{id:'fail'}])).rejects.toThrow('quota');
  expect((await readStoredReviewItems()).map(item => item.id)).toEqual(['keep']);
});

test('failed evidence write rejects, retains history and can be retried', async () => {
  const first = await saveCollaboratorReviewEvidence(decision());
  const spy = jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(() => {throw new Error('disk full');});
  await expect(saveCollaboratorReviewEvidence(decision(2))).rejects.toThrow('disk full');
  expect((await readStoredReviewItems())[0]).toEqual(first);
  spy.mockRestore();
  await saveCollaboratorReviewEvidence(decision(2));
  expect((await readStoredReviewItems())[0].history).toHaveLength(2);
});

test('project reconciliation reads decision bases without session queues or history', async () => {
  await saveCollaboratorReviewEvidence(decision());
  await saveCollaboratorReviewEvidence(decision(2,{projectId:'other'}));
  await saveCollaboratorReviewEvidence(createVibeReviewSessionEvidence({domain:'hazard-analysis',session:{id:'session',projectId:'p',queue:['HA-1']}}));
  const all = jest.spyOn(IDBObjectStore.prototype,'getAll');
  const items = await readHazardDecisionEvidence('p');
  expect(items).toHaveLength(1); expect(items[0].vibeReview.decision).toBe('Yes');
  expect(items[0].currentContent.row).toEqual(['HA-1','Yes']);
  expect(items[0].history).toBeUndefined(); expect(items[0].originalContent).toBeUndefined();
  expect(all).not.toHaveBeenCalled();
  const db = await openReviewDB(); expect(await db.count('reviewItems')).toBe(3); db.close();
});

test('fallback storage failure is not reported as a successful decision', async () => {
  global.indexedDB = undefined;
  localStorage.setItem('xhandle:results-review:items',JSON.stringify([{id:'keep'}]));
  jest.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw Error('quota');});
  await expect(saveCollaboratorReviewEvidence(decision())).rejects.toThrow('quota');
  expect(JSON.parse(localStorage.getItem('xhandle:results-review:items'))).toEqual([{id:'keep'}]);
});

test('decision compaction retains regeneration rationale but excludes session ledgers', () => {
  const entry = decision();
  entry.vibeReview.humanAdjudicationRationale = 'This output is advisory only.';
  expect(hazardDecisionEvidence(entry).vibeReview.humanAdjudicationRationale).toBe('This output is advisory only.');
  const session = createVibeReviewSessionEvidence({domain:'hazard-analysis',session:{id:'s',projectId:'p',reviewTarget:'guidePhraseApplicable',decisions:[{rowId:'HA-1',decision:'Yes'}]}});
  expect(hazardDecisionEvidence(session)).toBeNull();
});
