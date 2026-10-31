import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { ResultsReviewProvider, useResultsReview } from '../results-review/ResultsReviewProvider';
import { loadReviewItems } from '../results-review/reviewStore';
import { ARTIFACT_DEFINITIONS, ARTIFACT_KINDS } from './artifactDefinitions';
import { useArtifactReview } from './useArtifactReview';

jest.mock('../results-review/ResultsReviewDrawer', () => () => null);
global.IS_REACT_ACT_ENVIRONMENT = true;

test('artifact review registrations survive reload and retain review decisions', async () => {
  const oldDb = global.indexedDB, oldClone = global.structuredClone;
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
  const definition = ARTIFACT_DEFINITIONS[ARTIFACT_KINDS.SYSTEM];
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: `R-${i}` }));
  let api;
  function Probe() {
    api = useResultsReview();
    useArtifactReview({ rows, columns: definition.columns, definition, projectId: 'p', repoId: 'r', setRows: () => {} });
    return null;
  }
  const host = document.createElement('div'); document.body.appendChild(host);
  let root = createRoot(host);
  const settle = async () => {
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  };
  try {
    await act(async () => root.render(<ResultsReviewProvider><Probe /></ResultsReviewProvider>));
    await settle();
    expect((await loadReviewItems())).toHaveLength(120);
    const item = api.reviewItems[0];
    await act(async () => api.updateReviewItem(item.id, { status: 'rejected', reviewerFeedback: 'Retain this' }));
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ResultsReviewProvider><Probe /></ResultsReviewProvider>));
    await settle();
    const stored = await loadReviewItems();
    expect(stored).toHaveLength(120);
    expect(stored.find(entry => entry.id === item.id)).toMatchObject({ status: 'rejected', reviewerFeedback: 'Retain this' });
  } finally {
    act(() => root.unmount()); host.remove();
    global.indexedDB = oldDb; global.structuredClone = oldClone;
  }
});
