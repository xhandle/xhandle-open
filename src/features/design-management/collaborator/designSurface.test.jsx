import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getActionProvider, ACTION_REGISTRY_CHANGE_EVENT } from '../../app/actionRegistry';
import { useDesignSurface } from './useDesignCollaborator';

global.IS_REACT_ACT_ENVIRONMENT = true;
const scope = 'design-surface-regression';
function Surface({ state, clearSelection }) { useDesignSurface(state, clearSelection, scope); return null; }

test('equivalent context rerenders retain a live provider without a registry notification feedback loop', () => {
  const host = document.createElement('div'), root = createRoot(host), events = [];
  const listener = event => { if (event.detail.scope === scope) events.push(event.detail); };
  window.addEventListener(ACTION_REGISTRY_CHANGE_EVENT, listener);
  const state = () => ({ target: { kind: 'artifact', id: 'document', draft: true }, title: 'Safety Requirements', view: 'table', selectedIds: [] });
  const firstClear = jest.fn(), nextClear = jest.fn();
  try {
    act(() => root.render(<Surface state={state()} clearSelection={firstClear} />));
    const provider = getActionProvider(scope); expect(events).toHaveLength(1);
    const next = state();
    act(() => root.render(<Surface state={next} clearSelection={nextClear} />));
    expect(events).toHaveLength(1); expect(getActionProvider(scope)).toBe(provider); expect(provider.getState()).toBe(next);
    provider.clearSelection(); expect(nextClear).toHaveBeenCalledTimes(1); expect(firstClear).not.toHaveBeenCalled();
    act(() => root.render(<Surface state={{ ...state(), selectedIds: ['requirement-1'] }} />));
    expect(events).toHaveLength(2); expect(provider.getState().selectedIds).toEqual(['requirement-1']);
    act(() => root.render(<Surface state={{ ...state(), target: { ...next.target, draft: false } }} />));
    expect(events).toHaveLength(3); expect(provider.getState().target.draft).toBe(false);
  } finally { act(() => root.unmount()); window.removeEventListener(ACTION_REGISTRY_CHANGE_EVENT, listener); }
  expect(getActionProvider(scope)).toBeNull(); expect(events).toHaveLength(4);
});

test('large selections expose their latest state while notifications use the bounded selection context', () => {
  const root = createRoot(document.createElement('div')), events = [];
  const listener = event => { if (event.detail.scope === scope) events.push(event.detail); };
  window.addEventListener(ACTION_REGISTRY_CHANGE_EVENT, listener);
  const ids = Array.from({ length: 26000 }, (_, index) => `row-${index}`);
  try {
    act(() => root.render(<Surface state={{ selectedIds: ids }} />));
    const next = [...ids]; next[25000] = 'outside-bounded-selection';
    act(() => root.render(<Surface state={{ selectedIds: next }} />));
    expect(events).toHaveLength(1); expect(getActionProvider(scope).getState().selectedIds).toBe(next);
    act(() => root.render(<Surface state={{ selectedIds: [...next, 'new-row'] }} />));
    expect(events).toHaveLength(2);
  } finally { act(() => root.unmount()); window.removeEventListener(ACTION_REGISTRY_CHANGE_EVENT, listener); }
});
