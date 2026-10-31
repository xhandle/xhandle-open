import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VirtualTableBody from './VirtualTableBody';
global.IS_REACT_ACT_ENVIRONMENT = true;
const items = Array.from({ length: 10000 }, (_, index) => ({ id: `trace-${index}`, text: `Function ${index}` }));
const getKey = row => row.id;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (props = {}) => act(() => root.render(<div style={{ overflowY: 'auto', height: 500 }}><table><VirtualTableBody items={items} getKey={getKey} columns={1} {...props}>{row => <tr><td><input defaultValue={row.text} /></td></tr>}</VirtualTableBody></table></div>));
test('bounds mounted rows independently of dataset size and reveals an exact offscreen identity', () => {
  render();
  expect(host.querySelectorAll('[data-virtual-key]').length).toBeLessThan(30);
  render({ revealKey: 'trace-9999', requestKey: 'one' });
  expect(host.querySelector('[data-virtual-key="trace-9999"] input').value).toBe('Function 9999');
  expect(host.querySelectorAll('[data-virtual-key]').length).toBeLessThan(30);
});
test('retains an active editor while another faraway row is mounted', () => {
  render();
  const input = host.querySelector('input');
  act(() => input.focus()); input.value = 'Unsaved edit';
  render({ revealKey: 'trace-9999', requestKey: 'two' });
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe('Unsaved edit');
});

test('search finds an unmounted row, centers the matching cell, and tracks filtered contents', () => {
  const { tableSearchEntries } = require('./quickSearchUtils');
  jest.useFakeTimers();
  const rects = jest.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}]);
  const scroll = jest.fn();
  const originalScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    render({ searchText: item => item.text });
    const entries = tableSearchEntries(host);
    expect(entries).toHaveLength(10000);
    expect(host.querySelector('[data-virtual-key="trace-9999"]')).toBeNull();
    act(() => entries[9999].activate('Function 9999'));
    act(() => jest.advanceTimersByTime(40));
    const row = host.querySelector('[data-virtual-key="trace-9999"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('input').value).toBe('Function 9999');
    expect(scroll.mock.instances).toContain(row.querySelector('td'));
    render({ items: items.slice(0, 2), searchText: item => item.text });
    expect(tableSearchEntries(host).map(entry => entry.text)).toEqual(['Function 0', 'Function 1']);
    expect(host.querySelector('table').getAttribute('aria-rowcount')).toBe('3');
  } finally {
    rects.mockRestore(); Element.prototype.scrollIntoView = originalScroll; jest.useRealTimers();
  }
});

test('repeated source navigation to the same row acknowledges a fresh request', () => {
  jest.useFakeTimers();
  const scroll = jest.fn();
  const originalScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    render({ revealKey: 'trace-9999', requestKey: 1 });
    act(() => jest.advanceTimersByTime(40));
    const first = scroll.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    render({ revealKey: 'trace-9999', requestKey: 2 });
    act(() => jest.advanceTimersByTime(40));
    expect(scroll.mock.calls.length).toBeGreaterThan(first);
  } finally {
    Element.prototype.scrollIntoView = originalScroll; jest.useRealTimers();
  }
});
