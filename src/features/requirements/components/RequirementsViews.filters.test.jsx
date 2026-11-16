import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TablePanel, computeNumbering } from './RequirementsViews';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));

let host, root;
const attrs = ['Description', 'Kind', 'Mode', 'Enabled'];
const rows = [
  { id: 'topic', title: 'Command validity', kind: 'section', heading: true, attributes: { Description: '', Kind: 'section', Mode: '' } },
  { id: 'req-1', title: 'Hidden first title', kind: 'requirement', parentId: 'topic', order: 0, status: 'Approved', version: 2, updatedAt: '2026-11-14T12:03:09Z', links: [{ toId: 'source' }], attributes: { Description: 'The controller shall reject expired commands.', Kind: 'requirement', Mode: 'Driving', Enabled: true } },
  { id: 'req-2', title: 'Hidden second title', kind: 'requirement', parentId: 'topic', order: 1, attributes: { Description: 'The controller shall report rejected commands.', Kind: 'requirement', Mode: 'Parking', Enabled: false } },
  { id: 'note', title: 'Operational notes', kind: 'narrative', attributes: { Description: 'Recorded context', Kind: 'narrative', Mode: 'Driving' } },
];
const popup = () => document.querySelector('[role="dialog"]');
const visible = () => [...host.querySelectorAll('tr[data-artifact-object-id]')].map(row => row.dataset.artifactObjectId);
const render = (props = {}) => act(async () => root.render(<TablePanel moduleName="Requirements" filterScope="doc:draft" rows={rows} numbering={computeNumbering(rows)} attrColumns={attrs} hideRequirementTitles {...props} />));
const open = label => act(async () => host.querySelector(`[aria-label="Filter ${label}"]`).click());
const press = text => act(async () => [...popup().querySelectorAll('button')].find(button => button.textContent === text).click());
const check = text => act(async () => [...popup().querySelectorAll('label')].find(label => label.textContent === text).querySelector('input').click());
const search = text => act(async () => {
  const input = popup().querySelector('input[type="search"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test('every fixed and custom column exposes a searchable multiselect without editing records', async () => {
  const onInlineUpdate = jest.fn(), onSelect = jest.fn();
  await render({ onInlineUpdate, onSelect, disabled: true });
  const labels = ['ID', 'Title', ...attrs, 'Status', 'Version', 'Updated', 'Links'];
  expect([...host.querySelectorAll('thead button')].map(button => button.getAttribute('aria-label'))).toEqual(labels.map(label => `Filter ${label}`));
  for (const label of labels) {
    await open(label);
    expect(popup().getAttribute('aria-label')).toBe(`Filter ${label} values`);
    expect(document.activeElement.getAttribute('aria-label')).toBe(`Search ${label} values`);
    expect(popup().querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
    await press('Done');
  }
  await open('Enabled'); expect(popup().textContent).toContain('Yes'); expect(popup().textContent).toContain('No');
  expect(onInlineUpdate).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
});

test('searchable exact values combine OR within a column and AND across columns, with clear and blank selection', async () => {
  const onInlineUpdate = jest.fn(); await render({ onInlineUpdate });
  await open('Kind'); await press('Deselect all');
  expect(visible()).toEqual([]); expect(host.textContent).toContain('No items match');
  await check('requirement'); await check('narrative'); await press('Done');
  expect(visible()).toEqual(['req-1', 'req-2', 'note']);
  await open('Description'); await search('REJECT');
  expect(popup().querySelectorAll('label')).toHaveLength(2);
  expect(visible()).toEqual(['req-1', 'req-2', 'note']); // Searching options alone does not silently change selection.
  await press('Select matching'); await press('Done');
  expect(visible()).toEqual(['req-1', 'req-2']);
  await open('Mode'); await press('Deselect all'); await check('Driving'); await press('Done');
  expect(visible()).toEqual(['req-1']);
  expect(host.querySelector('[role="status"]').textContent).toContain('1 of 4 items');
  expect(host.querySelector('[aria-label="Filter Kind"]').textContent).toContain('●');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Clear filters').click());
  expect(visible()).toEqual(rows.map(row => row.id));
  await open('Description'); await press('Deselect all'); await check('(blank)'); await press('Done');
  expect(visible()).toEqual(['topic']); expect(onInlineUpdate).not.toHaveBeenCalled();
});

test('fixed columns filter the same values shown in their cells and requirement titles remain blank', async () => {
  await render();
  await open('Title'); expect(popup().textContent).not.toContain('Hidden first title');
  await press('Deselect all'); await check('(blank)'); await press('Done');
  expect(visible()).toEqual(['req-1', 'req-2']);
  expect(host.querySelector('[data-artifact-object-id="req-1"]').children[1].textContent.trim()).toBe('1.1');
  for (const [label, value] of [['Status', 'Approved'], ['Version', '2'], ['Updated', '2026-11-14 12:03'], ['Links', '1'], ['ID', 'req-1']]) {
    await open(label); await press('Deselect all'); await check(value); await press('Done');
    expect(visible()).toEqual(['req-1']);
  }
});

test('filter choices use all rows, page long value lists, and support search, keyboard dismissal and resize', async () => {
  const many = Array.from({ length: 205 }, (_, i) => ({ id: `id-${i}`, title: `Topic ${i}`, attributes: { Description: `Evidence ${i}` } }));
  await render({ rows: many }); await open('ID');
  expect(popup().querySelectorAll('label')).toHaveLength(100);
  await press('Show more values (105 remaining)'); expect(popup().querySelectorAll('label')).toHaveLength(200);
  await search('id-204'); expect(popup().querySelectorAll('label')).toHaveLength(1);
  await press('Select matching');
  expect(visible()).toEqual(['id-204']);
  await act(async () => popup().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(popup()).toBeNull(); expect(document.activeElement.getAttribute('aria-label')).toBe('Filter ID');
  const separator = host.querySelector('[aria-label="Resize column ID"]');
  await act(async () => { separator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 })); window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180 })); window.dispatchEvent(new MouseEvent('mouseup')); });
  expect(host.querySelector('col').style.width).toBe('240px'); expect(popup()).toBeNull();
});

test('document/draft scope changes reset filters and menus; current data updates the options', async () => {
  await render(); await open('ID'); await press('Deselect all'); await check('req-1');
  await render({ filterScope: 'doc:revision' });
  expect(visible()).toEqual(rows.map(row => row.id)); expect(popup()).toBeNull();
  const updated = [...rows, { id: 'new', title: 'New topic', attributes: { Description: 'New evidence' } }];
  await render({ filterScope: 'doc:revision', rows: updated }); await open('Description'); await search('New evidence');
  expect(popup().querySelectorAll('label')).toHaveLength(1);
  await render({ filterScope: 'another:revision', rows: updated }); expect(popup()).toBeNull(); expect(visible()).toHaveLength(5);
});

test('filtering clears hidden selections and exact external navigation reveals a filtered-out object', async () => {
  const onClearSelection = jest.fn(), onEdit = jest.fn();
  await render({ selectedId: 'req-2', selectedIds: new Set(['req-2']), onClearSelection, onEdit });
  await open('ID'); await press('Deselect all'); expect(onClearSelection).toHaveBeenCalled();
  await check('req-1'); await press('Done'); expect(visible()).toEqual(['req-1']);
  await render({ selectedId: 'note', onClearSelection, onEdit });
  expect(visible()).toEqual(rows.map(row => row.id));
  await act(async () => host.querySelector('[data-artifact-object-id="note"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onEdit).toHaveBeenCalledWith(rows[3]);
});
