import React from 'react';
import { createRoot } from 'react-dom/client';
import ResultsReviewDrawer from './ResultsReviewDrawer';

const { act } = React;
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => <span /> }));

test('preparing a save keeps the selected review and its pending retry visible', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const content = { columns: ['ID', 'Hazard'], row: ['HA-2', 'original'] };
  const items = ['first', 'second'].map(id => ({ id, currentContent: content, originalContent: content }));
  const options = {};
  const retry = jest.fn();
  try {
    await act(async () => root.render(<ResultsReviewDrawer isOpen options={options} items={items} onRetryPending={retry} />));
    const next = Array.from(host.querySelectorAll('button')).find(button => button.textContent.trim() === 'Next');
    await act(async () => next.click());
    expect(host.textContent).toContain('2 of 2');
    // The provider publishes this state before attempting the source save.
    const prepared = items.map(item => item.id === 'second'
      ? { ...item, pendingSourceCommit: { id: 'operation', patch: { currentContent: content } } }
      : item);
    await act(async () => root.render(<ResultsReviewDrawer isOpen options={options} items={prepared} onRetryPending={retry} />));
    expect(host.textContent).toContain('2 of 2');
    expect(host.textContent).toContain('Retry review save');
    expect(prepared[1].pendingSourceCommit).toBeDefined();
    await act(async () => Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent === 'Retry review save').click());
    expect(retry).toHaveBeenCalledWith('second');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('reordering review items preserves selection and opening a new scope selects its requested item', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const items = ['first', 'second', 'third'].map(id => ({ id, sourceFeature: id }));
  const options = {};
  try {
    await act(async () => root.render(<ResultsReviewDrawer isOpen options={options} items={items} />));
    await act(async () => Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent.trim() === 'Next').click());
    expect(host.textContent).toContain('2 of 3');
    await act(async () => root.render(<ResultsReviewDrawer isOpen options={options} items={[items[2], items[0], items[1]]} />));
    expect(host.textContent).toContain('3 of 3');
    await act(async () => root.render(<ResultsReviewDrawer isOpen options={{ initialReviewItemId: 'first' }} items={items} />));
    expect(host.textContent).toContain('1 of 3');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
