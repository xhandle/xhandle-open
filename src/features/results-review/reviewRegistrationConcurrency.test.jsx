import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ResultsReviewProvider, useResultsReview } from './ResultsReviewProvider';

jest.mock('./reviewStore', () => ({
  loadReviewItems: jest.fn(async () => []),
  saveReviewItems: jest.fn(async () => ({ ok: true, durability: 'indexeddb' })),
}));
jest.mock('./ResultsReviewDrawer', () => () => null);

global.IS_REACT_ACT_ENVIRONMENT = true;

test('late automatic registration preserves existing review evidence', async () => {
  let api;
  function Probe() { api = useResultsReview(); return null; }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const reviewed = { id: 'row-1', status: 'rejected', reviewerFeedback: 'Keep this feedback', originalContent: { row: 'original' } };
  try {
    await act(async () => root.render(<ResultsReviewProvider initialReviewItems={[reviewed]}><Probe /></ResultsReviewProvider>));
    await act(async () => api.createReviewItems([
      { id: 'row-1', originalContent: { row: 'new' } },
      { id: 'row-2', originalContent: { row: 'second' } },
    ], { preserveExisting: true }));
    expect(api.reviewItems.find(item => item.id === 'row-1')).toEqual(reviewed);
    expect(api.reviewItems.find(item => item.id === 'row-2')).toBeDefined();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
