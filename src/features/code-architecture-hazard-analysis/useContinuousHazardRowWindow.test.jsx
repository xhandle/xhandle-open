import React, {act, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import useContinuousHazardRowWindow from './useContinuousHazardRowWindow';
import HazardRowHeightIndex from './hazardRowHeightIndex';

global.IS_REACT_ACT_ENVIRONMENT = true;
const columns = [{index: 0}], widths = {}, collapsed = new Set(), emptyRows = new Map();
const makeGroups = (count = 15000) => [{key: 'a', items: Array.from({length: count}, (_, rowIndex) => ({rowIndex}))}];
let result, host, root, originalBounds, heights;

function Probe({groups, hidden = collapsed, columnWidths = widths, datasetKey = 'one', rowsByIndex = emptyRows, enabled = true}) {
  const table = useRef();
  result = useContinuousHazardRowWindow(groups, hidden, columns, columnWidths, table, datasetKey, {enabled, rowsByIndex});
  return <div><table ref={table}><thead><tr><th>Hazard</th></tr></thead><tbody>
    {result.top > 0 && <tr aria-hidden="true"><td style={{height: result.top}} /></tr>}
    {result.visible.map(entry => <tr key={entry.key} data-window-key={entry.key}
      data-hazard-loading-row={entry.item && !rowsByIndex.has(entry.item.rowIndex) ? 'true' : undefined}>
      <td>{entry.item ? rowsByIndex.get(entry.item.rowIndex)?.[0] || 'Loading row…' : entry.key}</td>
    </tr>)}
    {result.bottom > 0 && <tr aria-hidden="true"><td style={{height: result.bottom}} /></tr>}
  </tbody></table></div>;
}

beforeEach(() => {
  jest.useFakeTimers();
  heights = new Map();
  originalBounds = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const table = this.closest('table'), scrollTop = table?.parentElement?.scrollTop || 0;
    const key = this.dataset?.windowKey;
    return {top: (this.tagName === 'TBODY' ? 40 : 0) - scrollTop,
      height: key ? heights.get(key) || (key.startsWith('group:') ? 48 : 64) : 800};
  };
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  Element.prototype.getBoundingClientRect = originalBounds;
  jest.useRealTimers();
});
const scrollTo = async top => {
  const scroller = host.querySelector('table').parentElement;
  await act(async () => { scroller.scrollTop = top; scroller.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(20); });
  flushFrames();
};
const flushFrames = (count = 8) => { for (let i = 0; i < count; i++) act(() => jest.advanceTimersByTime(17)); };

test('prefix sums preserve exact distant row positions after sparse height changes', () => {
  const values = Array.from({length: 20000}, (_, index) => 30 + index % 20);
  const index = new HazardRowHeightIndex(values);
  for (const row of [0, 1, 100, 19999]) {
    const expected = values.slice(0, row).reduce((sum, height) => sum + height, 0);
    expect(index.offset(row)).toBe(expected);
    expect(index.indexAt(expected)).toBe(row);
    expect(index.indexAt(expected + values[row] - 1)).toBe(row);
  }
  index.set(123, 500); values[123] = 500;
  expect(index.total).toBe(values.reduce((sum, height) => sum + height, 0));
  expect(index.offset(15000)).toBe(values.slice(0, 15000).reduce((sum, height) => sum + height, 0));
  expect(index.indexAt(index.total)).toBe(values.length - 1);
});

test('exposes the last row without sequential loading and resolves focus only after it loads', () => {
  const groups = makeGroups(100000);
  act(() => root.render(<Probe groups={groups} />));
  const ready = jest.fn();
  act(() => expect(result.reveal(99999, ready)).toBe(true));
  expect(ready).not.toHaveBeenCalled();
  expect(result.requestedRowIndices).toContain(99999);
  expect(result.requestedRowIndices.length).toBeLessThanOrEqual(150);
  expect(result.visible.length).toBeLessThan(25);
  expect(result.totalEntries).toBe(100001);
  expect(result.top).toBeGreaterThan(15000000);
  act(() => root.render(<Probe groups={groups} rowsByIndex={new Map([[99999, ['last result']]])} />));
  flushFrames();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(ready.mock.calls[0][0].textContent).toBe('last result');
  expect(ready.mock.calls[0][0].hasAttribute('data-hazard-loading-row')).toBe(false);
});

test('scrollbar jumps and reverse scrolling request the nearby rows rather than traversing earlier chunks', async () => {
  const groups = makeGroups();
  act(() => root.render(<Probe groups={groups} />));
  await scrollTo(40 + 48 + 12000 * 160);
  expect(result.requestedRowIndices[0]).toBe(12000);
  expect(result.requestedRowIndices.slice(0, 5)).toEqual([12000, 12001, 12002, 12003, 12004]);
  expect(result.requestedRowIndices).toContain(12000);
  expect(result.requestedRowIndices.indexOf(12000)).toBeLessThan(result.requestedRowIndices.indexOf(11999));
  expect(result.requestedRowIndices.length).toBeLessThanOrEqual(150);
  expect(result.viewportRowIndices).toEqual([12000, 12001, 12002, 12003, 12004]);
  expect(result.viewportRowIndices).not.toContain(11999);
  expect(result.viewportRowIndices).not.toContain(12005);
  expect(result.requestedRowIndices.every(index => index > 11800)).toBe(true);
  expect(result.visible.length).toBeLessThan(30);
  await scrollTo(40 + 48 + 150 * 160);
  expect(result.requestedRowIndices).toContain(150);
  expect(result.requestedRowIndices.every(index => index < 350)).toBe(true);
  expect(result.visible.length).toBeLessThan(30);
});

test('viewport demand retains its identity across unrelated cache fills', async () => {
  const groups = makeGroups();
  act(() => root.render(<Probe groups={groups} />));
  await scrollTo(40 + 48 + 12000 * 160);
  const viewportDemand = result.viewportRowIndices;
  const prefetchDemand = result.requestedRowIndices;
  act(() => root.render(<Probe groups={groups} rowsByIndex={new Map([[0, ['unrelated cached row']]])} />));
  expect(result.viewportRowIndices).toBe(viewportDemand);
  expect(result.requestedRowIndices).toBe(prefetchDemand);
});

test('a jump to the end keeps the final row visible as row heights settle, and scrolling upward releases it', async () => {
  const groups = makeGroups(1000);
  const loaded = new Map(Array.from({length: 20}, (_, i) => [980 + i, ['saved row']]));
  heights.set('row:998', 700); heights.set('row:997', 500);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} />));
  const scroller = host.querySelector('table').parentElement;
  const contentHeight = () => result.top + result.visible.reduce((sum, entry) => sum + entry.height, 0) + result.bottom;
  Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: 800});
  // Table borders can make the native maximum differ from the numeric model.
  Object.defineProperty(scroller, 'scrollHeight', {configurable: true, get: () => contentHeight() + 43});
  await scrollTo(scroller.scrollHeight - scroller.clientHeight);
  const last = () => result.visible.find(entry => entry.item?.rowIndex === 999);
  expect(last()).toBeDefined();
  expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
  expect(last().offset + last().height).toBeLessThanOrEqual(scroller.scrollTop - 40 + 800);
  heights.set('row:998', 1100);
  act(() => root.render(<Probe groups={groups} rowsByIndex={new Map(loaded)} />));
  flushFrames();
  expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
  expect(last().offset + last().height).toBeLessThanOrEqual(scroller.scrollTop - 40 + 800);
  await scrollTo(scroller.scrollTop - 200);
  const bottomGap = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  expect(bottomGap).toBe(200);
  act(() => root.render(<Probe groups={groups} rowsByIndex={new Map(loaded)} />));
  expect(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop).toBe(200);
});

test('keeps the anchor and relative offset when rows above it are measured or columns resize', async () => {
  const groups = makeGroups();
  act(() => root.render(<Probe groups={groups} />));
  await scrollTo(40 + 48 + 7000 * 160 + 37);
  heights.set('row:6999', 420); heights.set('row:7000', 600);
  const loaded = new Map([[6999, ['before']], [7000, ['anchored']]]);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} />));
  flushFrames();
  const scroller = host.querySelector('table').parentElement;
  const anchored = scroller.scrollTop;
  act(() => result.reveal(7000));
  expect(anchored - scroller.scrollTop).toBe(37);
  await scrollTo(scroller.scrollTop + 37);
  heights.set('row:6999', 700); heights.set('row:7000', 900);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} columnWidths={{0: 120}} />));
  flushFrames();
  const afterResize = scroller.scrollTop;
  act(() => result.reveal(7000));
  expect(afterResize - scroller.scrollTop).toBe(37);
});

test('ignores placeholder measurements and preserves numeric geometry when cells are evicted', () => {
  const groups = makeGroups(1000), loaded = new Map([[500, ['saved']]]);
  heights.set('row:500', 900);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} />));
  act(() => result.reveal(500));
  flushFrames();
  expect(result.visible.find(entry => entry.item?.rowIndex === 500).height).toBe(900);
  act(() => root.render(<Probe groups={groups} />));
  expect(result.visible.find(entry => entry.item?.rowIndex === 500).height).toBe(900);
});

test('column resize preserves a tall row offset until actual measurement clamps it, including native correction events', async () => {
  const groups = makeGroups(1000), loaded = new Map([[500, ['tall result']]]);
  heights.set('row:500', 2000);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} />));
  act(() => result.reveal(500)); flushFrames();
  const scroller = host.querySelector('table').parentElement;
  await scrollTo(scroller.scrollTop + 1500);
  heights.set('row:500', 400);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} columnWidths={{0: 600}} />));
  act(() => scroller.dispatchEvent(new Event('scroll')));
  flushFrames();
  const shrunk = result.visible.find(entry => entry.item?.rowIndex === 500);
  expect(shrunk).toBeDefined();
  expect(scroller.scrollTop - 40 - shrunk.offset).toBe(399);
  heights.set('row:500', 2000);
  act(() => root.render(<Probe groups={groups} rowsByIndex={loaded} columnWidths={{0: 120}} />));
  flushFrames();
  const grown = result.visible.find(entry => entry.item?.rowIndex === 500);
  expect(grown).toBeDefined();
  expect(scroller.scrollTop - 40 - grown.offset).toBe(399);
});

test('a cache fill before the next scroll frame cannot snap the user back to the previous viewport', () => {
  const groups = makeGroups();
  act(() => root.render(<Probe groups={groups} />));
  const scroller = host.querySelector('table').parentElement;
  const target = 40 + 48 + 12000 * 160;
  act(() => {
    scroller.scrollTop = target;
    scroller.dispatchEvent(new Event('scroll'));
    root.render(<Probe groups={groups} rowsByIndex={new Map([[0, ['late previous viewport']]])} />);
  });
  expect(scroller.scrollTop).toBe(target);
  expect(result.requestedRowIndices).toContain(12000);
});

test('collapsing the anchor group selects its header and expanding restores a complete range', () => {
  const rows = makeGroups(1000)[0].items;
  const groups = [{key: 'a', items: rows.slice(0, 500)}, {key: 'b', items: rows.slice(500)}];
  act(() => root.render(<Probe groups={groups} />));
  act(() => result.reveal(750));
  act(() => root.render(<Probe groups={groups} hidden={new Set(['b'])} />));
  expect(result.visible.some(entry => entry.key === 'group:b')).toBe(true);
  expect(result.totalEntries).toBe(502);
  expect(result.reveal(750)).toBe(false);
  act(() => root.render(<Probe groups={groups} />));
  act(() => expect(result.reveal(750)).toBe(true));
  expect(result.totalEntries).toBe(1002);
});

test('source changes cancel unresolved focus and reset scroll without stale completion', () => {
  const groups = makeGroups(1000), ready = jest.fn();
  act(() => root.render(<Probe groups={groups} />));
  act(() => result.reveal(750, ready));
  act(() => root.render(<Probe groups={groups} datasetKey="two" rowsByIndex={new Map([[750, ['other source']]])} />));
  expect(host.querySelector('table').parentElement.scrollTop).toBe(0);
  expect(ready).not.toHaveBeenCalled();
});

test('disabled remote virtualization does not alter a local table scroll position', async () => {
  act(() => root.render(<Probe groups={makeGroups()} enabled={false} />));
  await scrollTo(12345);
  expect(host.querySelector('table').parentElement.scrollTop).toBe(12345);
  expect(result.visible).toEqual([]);
  expect(result.requestedRowIndices).toEqual([]);
  expect(result.viewportRowIndices).toEqual([]);
  expect(result.reveal(3)).toBe(false);
});
