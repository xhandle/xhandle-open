import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { ResultsReviewProvider, useResultsReview } from './ResultsReviewProvider';
import ReviewStatusBadge from './ReviewStatusBadge';
import { putStoredReviewItems, readStoredReviewItems } from './collaboratorReviewStore';
import { createVibeReviewDecisionEvidence } from './reviewUtils';
import { ARTIFACT_DEFINITIONS, ARTIFACT_KINDS } from '../code-architecture-assurance/artifactDefinitions';
import { useArtifactReview } from '../code-architecture-assurance/useArtifactReview';

jest.mock('./ResultsReviewDrawer', () => () => <aside data-testid="legacy-drawer" />);
global.IS_REACT_ACT_ENVIRONMENT = true;
let oldDb, oldClone, host, root, api, renders;
const rows = Array.from({ length: 15000 }, (_, i) => ({ id: `R-${i}`, requirement: `Requirement ${i}` }));
function Probe({ kind = ARTIFACT_KINDS.SYSTEM }) {
  api = useResultsReview(); renders++;
  const definition = ARTIFACT_DEFINITIONS[kind];
  useArtifactReview({ rows, columns: definition.columns, definition, projectId: 'p', repoId: 'r', setRows: () => {} });
  return <ReviewStatusBadge reviewItem={{ id: 'legacy', status: 'pending_review' }} />;
}
beforeEach(() => {
  oldDb = global.indexedDB; oldClone = global.structuredClone;
  global.indexedDB = new IDBFactory(); global.structuredClone = value => deserialize(serialize(value));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); renders = 0;
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); jest.restoreAllMocks();
  global.indexedDB = oldDb; global.structuredClone = oldClone;
});
const render = async kind => act(async () => { root.render(<ResultsReviewProvider mode="collaborator"><Probe kind={kind} /></ResultsReviewProvider>); await new Promise(r => setTimeout(r, 30)); });
const decision = () => createVibeReviewDecisionEvidence({domain:'functional-analysis',projectId:'p',sessionId:'s',rowId:'F-1',rowIndex:0,reviewTarget:'function',action:'accept',decision:'accepted',beforeRow:['old'],afterRow:['reviewed'],columns:['Function']});

test('mounting, switching and remounting large artifact tables never loads or generates retired queues', async () => {
  await putStoredReviewItems([{id:'legacy',projectId:'p',history:[{id:'history',note:'retained'}],currentContent:{row:'old evidence'}}]);
  const open = jest.spyOn(global.indexedDB, 'open');
  await render();
  const stableApi = api;
  await render(ARTIFACT_KINDS.SOFTWARE);
  act(() => root.unmount()); root = createRoot(host); await render();
  expect(open).not.toHaveBeenCalled();
  expect(api.reviewItems).toHaveLength(0); expect(api.legacyReviewEnabled).toBe(false);
  expect(host.querySelector('[data-testid="legacy-drawer"]')).toBeNull(); expect(host.textContent).toBe('');
  expect(stableApi.reviewItems).toBe(api.reviewItems);
  expect((await readStoredReviewItems())[0].history).toEqual([{id:'history',note:'retained'}]);
});

test('active Collaborator evidence persists without filling global context or rerendering every table', async () => {
  await render(); const before = renders, context = api;
  const saved = jest.fn(); window.addEventListener('xhandle:collaborator-review:evidence-saved', saved);
  try {
    await act(async () => api.recordVibeReviewEvidence(decision()));
    expect(renders).toBe(before); expect(api).toBe(context); expect(api.reviewItems).toHaveLength(0);
    expect(saved).toHaveBeenCalledTimes(1);
    const stored = await readStoredReviewItems(); expect(stored).toHaveLength(1);
    expect(stored[0].currentContent.row).toEqual(['reviewed']);
    act(() => root.unmount()); root = createRoot(host); await render();
    expect(await readStoredReviewItems()).toEqual(stored);
  } finally { window.removeEventListener('xhandle:collaborator-review:evidence-saved', saved); }
});

test('failed evidence persistence is visible and retry preserves existing history', async () => {
  await render(); await act(async () => api.recordVibeReviewEvidence(decision()));
  const before = await readStoredReviewItems();
  const put = jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(() => {throw Error('quota exhausted');});
  await act(async () => { await expect(api.recordVibeReviewEvidence(decision())).rejects.toThrow('quota'); });
  expect(host.querySelector('[role="alert"]').textContent).toContain('could not be saved');
  expect(await readStoredReviewItems()).toEqual(before);
  put.mockRestore(); await act(async () => api.recordVibeReviewEvidence(decision()));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(api.reviewItems).toHaveLength(0);
});

test('standalone read-only review packages retain their existing compatibility mode', async () => {
  const items = [{id:'packaged',currentContent:{row:'packaged evidence'}}];
  const open = jest.spyOn(global.indexedDB,'open');
  await act(async () => root.render(<ResultsReviewProvider readOnly initialReviewItems={items}><Probe /></ResultsReviewProvider>));
  expect(api.legacyReviewEnabled).toBe(true); expect(api.reviewItems[0].id).toBe('packaged');
  expect(host.querySelector('[data-testid="legacy-drawer"]')).not.toBeNull();
  expect(open).not.toHaveBeenCalled();
});
