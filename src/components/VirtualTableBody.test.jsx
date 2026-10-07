import React, { act } from 'react';
global.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import VirtualTableBody from './VirtualTableBody';
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
