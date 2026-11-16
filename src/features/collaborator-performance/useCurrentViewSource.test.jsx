import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useCurrentViewSource } from './useCurrentViewSource';
import { getActionProvider } from '../app/actionRegistry';

test('surface readers are lazy, stay current without notification loops and unregister on unmount', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  const reader = jest.fn(); const changed = jest.fn();
  const Surface = ({ title }) => { useCurrentViewSource('test-surface', () => { reader(); return { title }; }); return null; };
  window.addEventListener('xhandle:action-registry-changed', changed);
  try {
    await act(async () => root.render(<Surface title="First" />));
    const provider = getActionProvider('collaborator-current-view:test-surface');
    expect(reader).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Surface title="Current" />));
    expect(getActionProvider('collaborator-current-view:test-surface')).toBe(provider);
    expect(provider.read()).toEqual({ title: 'Current' }); expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount()); window.removeEventListener('xhandle:action-registry-changed', changed);
  }
  expect(getActionProvider('collaborator-current-view:test-surface')).toBeNull();
});
