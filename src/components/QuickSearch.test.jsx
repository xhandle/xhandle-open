import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import QuickSearch from './QuickSearch.js';
import { useKeyPress } from 'reactflow';
import { tableSearchEntries, filterSearchEntries, QUICK_SEARCH_COLLECT } from './quickSearchUtils';

jest.mock('lucide-react', () => ({ Search: () => null }));

let host, root, scroll;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{ width: 100, height: 20 }]);
  scroll = jest.fn();
  Element.prototype.scrollIntoView = scroll;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  jest.restoreAllMocks();
  jest.useRealTimers();
});
function table() {
  const element = document.createElement('div');
  element.innerHTML = '<table aria-label="Requirements"><tbody><tr><td>Brake</td><td><input value="100 ms"></td></tr><tr hidden><td>Hidden row</td></tr></tbody></table>';
  document.body.appendChild(element);
  return element;
}
test('indexes visible table rows and edited values, with multi-word case-insensitive matching', () => {
  table();
  const entries = tableSearchEntries();
  expect(entries).toHaveLength(1);
  expect(filterSearchEntries(entries, 'BRAKE 100')).toHaveLength(1);
  expect(filterSearchEntries(entries, 'missing')).toHaveLength(0);
  entries[0].activate('100');
  expect(scroll).toHaveBeenCalled();
  expect(document.querySelector('tr').classList.contains('xhandle-search-hit')).toBe(true);
});
test.each(['ctrlKey', 'metaKey'])('%s+F opens without F keyup and Escape restores focus', modifier => {
  jest.useFakeTimers();
  table();
  act(() => root.render(<QuickSearch />));
  const trigger = host.querySelector('button');
  trigger.focus();
  const event = new KeyboardEvent('keydown', { key: 'f', [modifier]: true, bubbles: true, cancelable: true });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  act(() => jest.runOnlyPendingTimers());
  const input = document.querySelector('[role="combobox"]');
  expect(document.activeElement).toBe(input);
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(input.isConnected).toBe(true);
  act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
test('collects diagram results on demand and navigates with Enter', () => {
  const activate = jest.fn();
  const collect = event => event.detail.entries.push({ id: 'node-1', kind: 'System', label: 'Drive', text: 'Braking', activate });
  window.addEventListener(QUICK_SEARCH_COLLECT, collect);
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'braking');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('[role="option"]').textContent).toContain('Drive');
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(activate).not.toHaveBeenCalled();
  expect(input.isConnected).toBe(true);
  act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })));
  expect(activate).toHaveBeenCalledWith('braking');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  window.removeEventListener(QUICK_SEARCH_COLLECT, collect);
});


test.each(['Backspace', 'Delete'])('%s stays inside search and allows normal text deletion', key => {
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  const backgroundHandler = jest.fn();
  document.addEventListener('keydown', backgroundHandler);
  document.addEventListener('keyup', backgroundHandler);
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => input.dispatchEvent(event));
  act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })));
  expect(event.defaultPrevented).toBe(false);
  expect(backgroundHandler).not.toHaveBeenCalled();
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(input);
  document.removeEventListener('keydown', backgroundHandler);
  document.removeEventListener('keyup', backgroundHandler);
});

test('Escape during IME composition keeps the search input mounted', () => {
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', isComposing: true, bubbles: true })));
  expect(input.isConnected).toBe(true);
});

test('indexes only current control values and selected option labels', () => {
  const fixture = table();
  fixture.innerHTML = '<table><tbody><tr><td><select><option value="a" selected>Approved</option><option value="r">Rejected</option></select></td>'
    + '<td><textarea>Obsolete draft</textarea></td>'
    + '<td><input type="checkbox" checked><input type="radio"><input type="password" value="private-secret"></td>'
    + '<td><select multiple><option selected>Alpha</option><option>Beta</option><option selected>Gamma</option></select></td></tr></tbody></table>';
  fixture.querySelector('textarea').value = 'Current requirement';
  const entries = tableSearchEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].text).toContain('Approved');
  expect(entries[0].text).toContain('Current requirement');
  expect(entries[0].text).toContain('Checked');
  expect(entries[0].text).toContain('Unchecked');
  expect(entries[0].text).toContain('Alpha Gamma');
  for (const term of ['Rejected', 'Obsolete', 'Beta', 'private-secret']) {
    expect(filterSearchEntries(entries, term)).toHaveLength(0);
  }
  expect(entries[0].text.split(/\W+/)).not.toContain('on');
});

test('excludes CSS-hidden cells, rows and descendants but retains offscreen columns', () => {
  const fixture = table();
  fixture.innerHTML = '<table><tbody><tr><td style="display:none">hidden-cell</td>'
    + '<td>Visible <span style="visibility:hidden">hidden-descendant</span><input type="hidden" value="hidden-input"></td>'
    + '<td style="position:relative;left:5000px">Offscreen content</td></tr>'
    + '<tr style="visibility:hidden"><td>hidden-row</td></tr>'
    + '<tr style="visibility:collapse"><td>collapsed-row</td></tr></tbody></table>';
  const entries = tableSearchEntries();
  expect(entries).toHaveLength(1);
  for (const term of ['hidden-cell', 'hidden-descendant', 'hidden-input', 'hidden-row', 'collapsed-row']) {
    expect(filterSearchEntries(entries, term)).toHaveLength(0);
  }
  expect(filterSearchEntries(entries, 'Offscreen')).toHaveLength(1);
  const offscreen = fixture.querySelector('td[style*="5000px"]');
  offscreen.scrollIntoView = jest.fn();
  entries[0].activate('Offscreen');
  expect(offscreen.scrollIntoView).toHaveBeenCalled();
});

test('refining a scrolled list resets it even when active index remains zero', () => {
  table();
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  const list = document.querySelector('[role="listbox"]');
  const type = value => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  type('Bra');
  list.scrollTop = 900;
  type('Brake');
  expect(list.scrollTop).toBe(0);
  expect(document.querySelector('[role="option"]').getAttribute('aria-selected')).toBe('true');
  expect(scroll).not.toHaveBeenCalled();
});

test('arrow navigation scrolls only the result list', () => {
  const fixture = table();
  fixture.innerHTML = '<table><tbody><tr><td>Brake first</td></tr><tr><td>Brake second</td></tr></tbody></table>';
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Brake');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const list = document.querySelector('[role="listbox"]');
  Object.defineProperty(list, 'clientHeight', { value: 78 });
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(list.scrollTop).toBe(50);
  expect(scroll).not.toHaveBeenCalled();
});

function typeSearch(value) {
  const input = document.querySelector('[role="combobox"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

function diagramEntries(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `function:${index}`, kind: 'Diagram node', label: `Function ${index}`, text: 'Description',
    navigator: { group: 'Functions', context: index % 2 ? 'Controls › Actuation' : 'Controls › Planning', identity: `n:${index}` },
    activate: jest.fn(),
  }));
}

test.each(['button', 'ctrlKey', 'metaKey'])('%s opens a clickable diagram glossary before typing', trigger => {
  jest.useFakeTimers();
  const entries = diagramEntries();
  const collect = event => event.detail.entries.push(...entries);
  window.addEventListener(QUICK_SEARCH_COLLECT, collect);
  try {
    act(() => root.render(<QuickSearch />));
    if (trigger === 'button') act(() => host.querySelector('button').click());
    else {
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', [trigger]: true, bubbles: true, cancelable: true })));
      act(() => jest.runOnlyPendingTimers());
    }
    expect(document.querySelector('[role="tree"]')).toBeTruthy();
    expect(document.querySelector('[role="combobox"]').value).toBe('');
    expect(document.querySelector('[role="status"]').textContent).toContain('2 elements');
    const group = document.querySelector('[role="treeitem"]');
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    act(() => group.click());
    const entry = [...document.querySelectorAll('[role="treeitem"]')].find(item => item.textContent.includes('Function 1'));
    expect(entry.textContent).toContain('Controls › Actuation');
    act(() => entry.click());
    expect(entries[1].activate).toHaveBeenCalledWith('');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { window.removeEventListener(QUICK_SEARCH_COLLECT, collect); }
});

test('glossary sections expand with the keyboard; parent context filters duplicate names', () => {
  const entries = diagramEntries();
  entries.forEach(entry => { entry.label = 'Controller'; });
  const collect = event => event.detail.entries.push(...entries);
  window.addEventListener(QUICK_SEARCH_COLLECT, collect);
  try {
    act(() => root.render(<QuickSearch />));
    act(() => host.querySelector('button').click());
    const input = document.querySelector('[role="combobox"]');
    const key = name => act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })));
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    key('ArrowRight'); key('ArrowRight');
    expect(document.getElementById(input.getAttribute('aria-activedescendant')).textContent).toContain('Controller');
    typeSearch('controller actuation');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    act(() => document.querySelector('[role="option"]').click());
    expect(entries[1].activate).toHaveBeenCalledWith('controller actuation');
    expect(entries[0].activate).not.toHaveBeenCalled();
  } finally { window.removeEventListener(QUICK_SEARCH_COLLECT, collect); }
});

test('10,000 diagram elements stay bounded and the last item is reachable by scrolling and keyboard', () => {
  const entries = diagramEntries(10000);
  const collect = event => event.detail.entries.push(...entries);
  window.addEventListener(QUICK_SEARCH_COLLECT, collect);
  try {
    act(() => root.render(<QuickSearch />));
    act(() => host.querySelector('button').click());
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    act(() => document.querySelector('[role="treeitem"]').click());
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(25);
    const input = document.querySelector('[role="combobox"]');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.getElementById(input.getAttribute('aria-activedescendant')).textContent).toContain('Function 9999');
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(25);
    typeSearch('function');
    const list = document.querySelector('[role="listbox"]');
    act(() => { list.scrollTop = 9995 * 64; list.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const last = [...list.querySelectorAll('[role="option"]')].find(item => item.textContent.includes('Function 9999'));
    expect(last).toBeTruthy();
    expect(list.querySelectorAll('[role="option"]').length).toBeLessThan(25);
    expect(document.querySelector('[role="status"]').textContent).toBe('10000 matches');
    act(() => last.click());
    expect(entries[9999].activate).toHaveBeenCalled();
  } finally { window.removeEventListener(QUICK_SEARCH_COLLECT, collect); }
});


test('Cmd+F refocuses an open search without waiting for key release', () => {
  jest.useFakeTimers();
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  const close = document.querySelector('[role="dialog"] button');
  close.focus();
  act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(close);
  act(() => jest.runOnlyPendingTimers());
  expect(document.activeElement).toBe(input);
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});

test('a pending shortcut is cancelled when the window loses focus', () => {
  jest.useFakeTimers();
  act(() => root.render(<QuickSearch />));
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })));
  act(() => window.dispatchEvent(new Event('blur')));
  act(() => jest.runOnlyPendingTimers());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});


// Exercise React Flow's actual document listener, not a mock canvas handler.
test.each([['Meta', 'metaKey'], ['Control', 'ctrlKey']])('%s is released in the canvas after shortcut search takes focus', (key, modifier) => {
  jest.useFakeTimers();
  function CanvasKeyState() {
    const pressed = useKeyPress(key);
    return <output data-canvas-modifier>{String(pressed)}</output>;
  }
  act(() => root.render(<><CanvasKeyState /><QuickSearch /></>));
  act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true })));
  expect(host.querySelector('output').textContent).toBe('true');
  act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', [modifier]: true, bubbles: true, cancelable: true })));
  act(() => jest.runOnlyPendingTimers());
  const input = document.querySelector('[role="combobox"]');
  expect(document.activeElement).toBe(input);
  act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key: 'f', [modifier]: true, bubbles: true })));
  act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })));
  expect(host.querySelector('output').textContent).toBe('false');
  expect(input.isConnected).toBe(true);
});

test.each(['Meta', 'Control', 'Shift', 'Alt'])('search allows %s release but blocks new modifier presses', key => {
  act(() => root.render(<QuickSearch />));
  act(() => host.querySelector('button').click());
  const input = document.querySelector('[role="combobox"]');
  const backgroundDown = jest.fn();
  const backgroundUp = jest.fn();
  document.addEventListener('keydown', backgroundDown);
  document.addEventListener('keyup', backgroundUp);
  try {
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })));
    expect(backgroundDown).not.toHaveBeenCalled();
    expect(backgroundUp).toHaveBeenCalledTimes(1);
  } finally {
    document.removeEventListener('keydown', backgroundDown);
    document.removeEventListener('keyup', backgroundUp);
  }
});
