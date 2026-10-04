import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import useTableRowFocus from './useTableRowFocus';

global.IS_REACT_ACT_ENVIRONMENT = true;
function Fixture({ requestKey, visible, onResolved }) {
  const rowRefs = useRef({});
  useTableRowFocus({ requestKey, rowIndex: 0, rowRefs, revision: visible, onResolved });
  return visible ? <div ref={element => { rowRefs.current[0] = element; }}>destination</div> : null;
}
test('acknowledges only after a hidden destination mounts, using the current callback', () => {
  jest.useFakeTimers();
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); const old = jest.fn(), current = jest.fn();
  try {
    act(() => root.render(<Fixture requestKey="first" visible={false} onResolved={old} />));
    act(() => jest.advanceTimersByTime(100));
    expect(old).not.toHaveBeenCalled();
    act(() => root.render(<Fixture requestKey="first" visible onResolved={current} />));
    act(() => jest.advanceTimersByTime(100));
    expect(current).toHaveBeenCalledWith('first');
    act(() => root.render(<Fixture requestKey="second" visible onResolved={current} />));
    act(() => jest.advanceTimersByTime(100));
    expect(current).toHaveBeenLastCalledWith('second');
    expect(current).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); host.remove(); jest.useRealTimers(); }
});
test('does not scroll or acknowledge an unmounted destination', () => {
  jest.useFakeTimers();
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host), done = jest.fn();
  act(() => root.render(<Fixture requestKey="old" visible onResolved={done} />));
  act(() => root.unmount());
  act(() => jest.advanceTimersByTime(100));
  expect(done).not.toHaveBeenCalled();
  host.remove(); jest.useRealTimers();
});
