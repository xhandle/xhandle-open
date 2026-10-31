import React, {act, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import useContinuousHazardRowWindow from './useContinuousHazardRowWindow';
import useHazardRowWindow from './useHazardRowWindow';

global.IS_REACT_ACT_ENVIRONMENT = true;
const columns = [{index: 0}], widths = {}, collapsed = new Set();
const groups = [{key: 'group', items: Array.from({length: 1000}, (_, rowIndex) => ({rowIndex, row: ['result']}))}];
const loaded = new Map(groups[0].items.map(item => [item.rowIndex, item.row]));
let host, root, originalBounds, latestWindow, originalObserver, observers;

function Rows({tableRef, window}) {
  latestWindow = window;
  return <div><table ref={tableRef}><tbody>
    {window.top > 0 && <tr aria-hidden="true"><td style={{height: window.top}} /></tr>}
    {window.visible.map(entry => <tr key={entry.key} data-window-key={entry.key}><td>{entry.key}</td></tr>)}
    {window.bottom > 0 && <tr aria-hidden="true"><td style={{height: window.bottom}} /></tr>}
  </tbody></table></div>;
}
function RemoteProbe({datasetKey = 'dataset', enabled = true}) {
  const tableRef = useRef();
  const window = useContinuousHazardRowWindow(groups, collapsed, columns, widths, tableRef, datasetKey, {rowsByIndex: loaded, enabled});
  return <Rows tableRef={tableRef} window={window} />;
}
function LocalProbe({datasetKey = 'dataset', enabled = true}) {
  const tableRef = useRef();
  const window = useHazardRowWindow(groups, collapsed, columns, widths, tableRef, datasetKey, undefined, enabled);
  return <Rows tableRef={tableRef} window={window} />;
}
function DenseProbe({remote}) {
  const tableRef = useRef();
  const remoteWindow = useContinuousHazardRowWindow(groups, collapsed, columns, widths, tableRef, 'dataset', {rowsByIndex: loaded, enabled: remote});
  const localWindow = useHazardRowWindow(groups, collapsed, columns, widths, tableRef, 'dataset', undefined, !remote);
  return <Rows tableRef={tableRef} window={remote ? remoteWindow : localWindow} />;
}

beforeEach(() => {
  jest.useFakeTimers();
  observers = [];
  originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  };
  originalBounds = Element.prototype.getBoundingClientRect;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  Element.prototype.getBoundingClientRect = originalBounds;
  global.ResizeObserver = originalObserver;
  jest.useRealTimers();
});

test.each([['continuous saved rows', RemoteProbe], ['complete local rows', LocalProbe]])(
  '%s does not recursively commit until React crashes when mounted rows change table geometry', (_label, Probe) => {
    // Models a table whose intrinsic width/wrapping changes as the virtualizer
    // mounts different cells. The height response is intentionally adverse;
    // measuring in a layout effect must not recursively set state unboundedly.
    let unstable = true, passes = 0;
    Element.prototype.getBoundingClientRect = function () {
      const count = this.closest('tbody')?.querySelectorAll('[data-window-key]').length || 0;
      const group = this.dataset?.windowKey?.startsWith('group:');
      if (group) passes++;
      return {top: 0, height: group ? 48 : unstable && count > 12 ? 320 : 64};
    };
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => act(() => root.render(<Probe />))).not.toThrow(/Maximum update depth/);
      expect(passes).toBe(0);
      for (let frame = 0; frame < 10; frame++) {
        const before = passes;
        const rowObserver = observers.find(observer => observer.targets.some(target => target.dataset.windowKey));
        act(() => { for (let i = 0; i < 20; i++) rowObserver?.callback(); jest.advanceTimersByTime(17); });
        expect(passes - before).toBeLessThanOrEqual(1);
      }
      unstable = false;
      for (let frame = 0; frame < 20; frame++) act(() => jest.advanceTimersByTime(17));
      expect(jest.getTimerCount()).toBe(0);
      expect(latestWindow.visible.some(entry => entry.item)).toBe(true);
    } finally { errors.mockRestore(); }
  },
);

test.each([true, false])('stable very short rows yield successive window expansion instead of nested commits (remote=%s)', remote => {
  Element.prototype.getBoundingClientRect = function () {
    return {top: 0, height: this.dataset?.windowKey?.startsWith('group:') ? 48 : 1};
  };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(() => act(() => root.render(<DenseProbe remote={remote} />))).not.toThrow(/Maximum update depth/);
    for (let frame = 0; frame < 500 && jest.getTimerCount(); frame++) act(() => jest.advanceTimersByTime(17));
    expect(latestWindow.visible.filter(entry => entry.item)).toHaveLength(1000);
    expect(jest.getTimerCount()).toBe(0);
  } finally { errors.mockRestore(); }
});

test.each([['continuous saved rows', RemoteProbe], ['complete local rows', LocalProbe]])(
  '%s completes a reveal on a stable measurement frame and cancels retired work', (_label, Probe) => {
    Element.prototype.getBoundingClientRect = function () {
      return {top: 0, height: this.dataset?.windowKey?.startsWith('group:') ? 48 : 160};
    };
    act(() => root.render(<React.StrictMode><Probe /></React.StrictMode>));
    const ready = jest.fn();
    act(() => latestWindow.reveal(500, ready));
    expect(ready).not.toHaveBeenCalled();
    for (let frame = 0; frame < 12; frame++) act(() => jest.advanceTimersByTime(17));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0][0].dataset.windowKey).toBe('row:500');
    const retired = jest.fn();
    act(() => latestWindow.reveal(900, retired));
    act(() => root.render(<React.StrictMode><Probe datasetKey="another" /></React.StrictMode>));
    for (let frame = 0; frame < 12; frame++) act(() => jest.advanceTimersByTime(17));
    expect(retired).not.toHaveBeenCalled();
    expect(host.querySelector('table').parentElement.scrollTop).toBe(0);
    act(() => latestWindow.reveal(900, retired));
    act(() => root.render(<React.StrictMode><Probe datasetKey="another" enabled={false} /></React.StrictMode>));
    act(() => jest.advanceTimersByTime(100));
    expect(retired).not.toHaveBeenCalled();
    act(() => root.render(null));
    expect(jest.getTimerCount()).toBe(0);
  },
);

test.each([['continuous saved rows', RemoteProbe], ['complete local rows', LocalProbe]])(
  '%s ignores a cancelled frame even if it is delivered after a new source owns measurement', (_label, Probe) => {
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () { reads++; return {top: 0, height: 160}; };
    const callbacks = [], originalRAF = global.requestAnimationFrame;
    const raf = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => {
      callbacks.push(callback); return originalRAF(callback);
    });
    try {
      act(() => root.render(<Probe />));
      const retiredFrame = callbacks[0];
      act(() => root.render(<Probe datasetKey="new-source" />));
      const ready = jest.fn();
      act(() => latestWindow.reveal(700, ready));
      const before = reads;
      act(() => retiredFrame(0));
      expect(reads).toBe(before);
      expect(ready).not.toHaveBeenCalled();
      for (let frame = 0; frame < 12; frame++) act(() => jest.advanceTimersByTime(17));
      expect(ready).toHaveBeenCalledTimes(1);
    } finally { raf.mockRestore(); }
  },
);
