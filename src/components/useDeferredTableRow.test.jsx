import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useDeferredTableRow, { estimateTableRowHeight } from './useDeferredTableRow';
import { registerTableSearchProvider, modelTableSearchEntries, tableSearchEntries } from './quickSearchUtils';

let host, root, observations, observer;
const refs = { current: {} };
function Row({ active = false }) {
  const placeholder = useDeferredTableRow({ id: 'hazard-source-row-51', index: 50, originalIndex: 50, active, height: 100, colSpan: 2, rowRefs: refs });
  return placeholder || <tr id="hazard-source-row-51"><td data-column-index="0">Command fifty</td></tr>;
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  observations = [];
  global.IntersectionObserver = class {
    constructor(callback) { observer = callback; }
    observe(element) { observations.push(element); }
    unobserve() {}
    disconnect() {}
  };
  jest.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 100 }]);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete global.IntersectionObserver; jest.restoreAllMocks(); });

test('renders offscreen rows on approach and retains mounted cells after leaving the viewport', () => {
  act(() => root.render(<table><tbody><Row /></tbody></table>));
  expect(host.querySelector('[data-deferred-row]')).toBeTruthy();
  act(() => observer([{ target: observations[0], isIntersecting: true }]));
  expect(host.textContent).toBe('Command fifty');
  const cell = host.querySelector('td');
  act(() => observer([{ target: observations[0], isIntersecting: false }]));
  expect(host.querySelector('td')).toBe(cell);
  expect(estimateTableRowHeight(['long '.repeat(100)], [120], [0])).toBeGreaterThan(100);
});

test('model search includes deferred rows, reveals them, and stops overriding DOM search on unregister', () => {
  act(() => root.render(<table><tbody><Row /></tbody></table>));
  const table = host.querySelector('table');
  const unregister = registerTableSearchProvider(table, () => modelTableSearchEntries({ table, label: 'Hazards', indexes: [0], items: [{ row: ['Command fifty', 'hidden context'], originalIndex: 50 }] }));
  const entries = tableSearchEntries(host);
  expect(entries).toHaveLength(1);
  expect(entries[0].text).toBe('Command fifty');
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  act(() => entries[0].activate('fifty'));
  expect(host.querySelector('[data-deferred-row]')).toBeNull();
  unregister();
  expect(tableSearchEntries(host)[0].label).not.toBe('Hazards');
});

test('expanding an unvisited collapsed group does not eagerly mount all its cells', () => {
  function CollapsedRow({ collapsed }) {
    const placeholder = useDeferredTableRow({ id: 'later', index: 50, originalIndex: 50, bypass: collapsed, height: 100, colSpan: 1, rowRefs: refs });
    return collapsed ? null : placeholder || <tr><td>Expensive cells</td></tr>;
  }
  act(() => root.render(<table><tbody><CollapsedRow collapsed /></tbody></table>));
  act(() => root.render(<table><tbody><CollapsedRow collapsed={false} /></tbody></table>));
  expect(host.querySelector('[data-deferred-row]')).toBeTruthy();
});

test('model search keeps the visible review status and excludes columns outside the supplied indexes', () => {
  const table = document.createElement('table'); host.appendChild(table);
  const entries = modelTableSearchEntries({ table, label: 'Hazards', indexes: [0], items: [{ row: ['Command', 'Hidden scenario'], originalIndex: 0, searchPrefix: 'Pending Review · Regenerate' }] });
  expect(entries[0].text).toBe('Pending Review · Regenerate · Command');
});
