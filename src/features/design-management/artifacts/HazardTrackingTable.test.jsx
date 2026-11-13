import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import HazardTrackingTable from './HazardTrackingTable';
import { HAZARD_TRACKING_TABLE_COLUMNS } from './hazardTrackingFields';
import { consolidateHazardRows } from './consolidateHazardRows';
import { hazardIssueEvidenceHash } from './hazardIssueEvidence';
import { hazardTrackingExportRows } from './hazardTrackingExport';

let host, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
test('renders exactly the selected columns and pages the full assessment list while preserving selection and editing', async () => {
  const rows = Array.from({ length: 26278 }, (_, index) => ({ id: `assessment-${index}`, sectionId: 's2', hazardTrackingRow: true, attributes: { Function: `Function ${index}`, 'Verification Method': 'Inspection', 'Internal reason': 'Excluded' } }));
  const onSelect = jest.fn(), onEdit = jest.fn();
  await act(async () => root.render(<HazardTrackingTable rows={rows} onSelect={onSelect} onEdit={onEdit} />));
  expect([...host.querySelectorAll('th')].map(node => node.querySelector('button span').textContent)).toEqual(HAZARD_TRACKING_TABLE_COLUMNS);
  expect(host.querySelector('th button span').textContent).toBe('HTR');
  expect(host.querySelectorAll('th')[1].querySelector('button span').textContent).toBe('Actionable Safety Issue Title');
  expect(host.querySelectorAll('th')[2].querySelector('button span').textContent).toBe('Actionable Safety Issue Description');
  expect([...host.querySelectorAll('thead button')].map(input => input.getAttribute('aria-label'))).toEqual(HAZARD_TRACKING_TABLE_COLUMNS.map(column => `Filter ${column}`));
  expect(host.querySelector('thead input')).toBeNull();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(100); expect(host.textContent).toContain('Rows 1–100 of 26278');
  expect(host.textContent).not.toContain('Excluded');
  const page = host.querySelector('input');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(page, '263'); page.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelectorAll('tbody tr')).toHaveLength(78); expect(host.textContent).toContain('Rows 26201–26278 of 26278');
  const last = host.querySelector('tbody tr:last-child');
  await act(async () => last.click()); expect(onSelect.mock.calls[0][0]).toBe('assessment-26277');
  await act(async () => last.querySelector('[data-object-field="Function"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onEdit).toHaveBeenCalledWith(rows[26277], 'Function');
});

test('consolidates matching hazards and expands their original editable assessment combinations', async () => {
  const rows = [
    { id: 'one', hazardTrackingRow: true, attributes: { Hazard: 'Lost commands', Function: 'Brake', 'Operational Mode': 'Driving', 'Safety Constraint': 'Retain brake command.' } },
    { id: 'two', hazardTrackingRow: true, attributes: { Hazard: 'Lost commands', Function: 'Steer', 'Operational Mode': 'Parking', 'Safety Constraint': 'Retain steer command.' } },
    { id: 'three', hazardTrackingRow: true, attributes: { Hazard: 'Late command', Function: 'Brake' } },
  ];
  const onSelect = jest.fn(), onEdit = jest.fn();
  await act(async () => root.render(<HazardTrackingTable rows={rows} onSelect={onSelect} onEdit={onEdit} />));
  expect(host.textContent).toContain('2 hazard entries from 3 assessment rows');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  const recordId = host.querySelector('tbody tr td').textContent;
  expect(recordId).toBe('HTR-1');
  expect(host.querySelector('[data-hazard-group]').textContent).toContain('Retain steer command.');
  const expand = host.querySelector('[aria-label="Expand Lost commands (2 assessments)"]');
  await act(async () => expand.click());
  const originals = host.querySelectorAll('[data-artifact-object-id]');
  expect(originals).toHaveLength(3);
  const second = host.querySelector('[data-artifact-object-id="two"]');
  expect(second.querySelector('td').textContent).toBe(recordId);
  await act(async () => second.querySelector('td').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onEdit).not.toHaveBeenCalled();
  expect(second.textContent).toContain('Steer'); expect(second.textContent).toContain('Parking');
  expect(second.textContent).not.toContain('Retain brake command.');
  await act(async () => second.querySelector('[data-object-field="Safety Constraint"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onEdit).toHaveBeenCalledWith(rows[1], 'Safety Constraint');
});

test('a large consolidated hazard expands only a page of original rows', async () => {
  const rows = Array.from({ length: 1201 }, (_, index) => ({ id: String(index), hazardTrackingRow: true, attributes: { Hazard: 'Lost command', Function: `Function ${index}` } }));
  await act(async () => root.render(<HazardTrackingTable rows={rows} onSelect={() => {}} onEdit={() => {}} />));
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(host.textContent).toContain('1198 more values');
  await act(async () => host.querySelector('[data-hazard-group] [aria-expanded="false"]').click());
  expect(host.querySelectorAll('[data-artifact-object-id]')).toHaveLength(100);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Next assessments').click());
  expect(host.textContent).toContain('Original assessments 101–200 of 1201');
  expect(host.querySelector('[data-artifact-object-id="199"]')).not.toBeNull();
});

test('column filters work across pages, widths persist, and selection reveals a collapsed assessment on another page', async () => {
  localStorage.clear();
  const rows = Array.from({ length: 250 }, (_, index) => ({ id: `r${index}`, hazardTrackingRow: true, attributes: { Hazard: `Hazard ${Math.floor(index / 2)}`, Function: index === 249 ? 'Unique target' : 'Brake', 'Operational Mode': index % 2 ? 'Parking' : 'Driving' } }));
  const render = selectedId => root.render(<HazardTrackingTable artifactId="control-test" rows={rows} selectedId={selectedId} onSelect={() => {}} onEdit={() => {}} />);
  await act(async () => render(null));
  const resize = host.querySelector('[aria-label="Resize Hazard column"]');
  await act(async () => { resize.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300 })); window.dispatchEvent(new MouseEvent('mousemove', { clientX: 420 })); window.dispatchEvent(new MouseEvent('mouseup')); });
  expect(resize.getAttribute('aria-valuenow')).toBe('420');
  expect(JSON.parse(localStorage.getItem('xhandle.htl.columns:control-test')).Hazard).toBe(420);
  await act(async () => host.querySelector('[aria-label="Filter Function"]').click());
  const popup = () => document.querySelector('[aria-label="Filter Function values"]');
  await act(async () => [...popup().querySelectorAll('button')].find(node => node.textContent === 'Deselect all').click());
  await act(async () => [...popup().querySelectorAll('label')].find(node => node.textContent === 'Unique target').querySelector('input').click());
  await act(async () => [...popup().querySelectorAll('button')].find(node => node.textContent === 'Done').click());
  expect(host.textContent).toContain('Rows 1–1 of 1');
  expect(host.querySelector('tbody tr td').textContent).toBe('HTR-125');
  await act(async () => render('r247'));
  await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  expect(host.textContent).toContain('Rows 101–125 of 125');
  expect(host.querySelector('[aria-label="Filter Function"]').textContent).not.toContain('●');
  expect(host.querySelector('[data-artifact-object-id="r247"]')).not.toBeNull();
  expect(host.querySelector('[data-artifact-object-id="r247"]').classList.contains('xhandle-search-hit')).toBe(true);
  await act(async () => root.render(<HazardTrackingTable key="remount" artifactId="control-test" rows={rows} onSelect={() => {}} onEdit={() => {}} />));
  expect(host.querySelector('[aria-label="Resize Hazard column"]').getAttribute('aria-valuenow')).toBe('420');
});

test('column menus select multiple exact values, combine columns and restore all records when cleared', async () => {
  const rows = [
    { id: 'one', hazardTrackingRow: true, attributes: { Hazard: 'Loss', Function: 'Brake', 'Operational Mode': 'Driving' } },
    { id: 'two', hazardTrackingRow: true, attributes: { Hazard: 'Loss', Function: 'Steer', 'Operational Mode': 'Parking' } },
    { id: 'three', hazardTrackingRow: true, attributes: { Hazard: 'Late', Function: 'Steer', 'Operational Mode': 'Driving' } },
    { id: 'blank', hazardTrackingRow: true, attributes: { Hazard: 'Unknown interface' } },
  ];
  await act(async () => root.render(<HazardTrackingTable rows={rows} onSelect={() => {}} onEdit={() => {}} />));
  const menu = () => document.querySelector('[role="dialog"]');
  const click = async text => act(async () => [...menu().querySelectorAll('button')].find(node => node.textContent === text).click());
  const check = async value => act(async () => [...menu().querySelectorAll('label')].find(node => node.textContent === value).querySelector('input').click());
  await act(async () => host.querySelector('[aria-label="Filter Function"]').click());
  expect(menu().querySelectorAll('input:checked')).toHaveLength(3);
  await click('Deselect all'); expect(host.textContent).toContain('No assessment rows');
  await check('Brake'); await check('Steer');
  expect(host.textContent).toContain('Rows 1–2 of 2');
  await click('Done');
  await act(async () => host.querySelector('[aria-label="Filter Operational Mode"]').click());
  await click('Deselect all'); await check('Parking'); await click('Done');
  expect(host.textContent).toContain('Rows 1–1 of 1');
  expect(host.querySelector('tbody tr td').textContent).toBe('HTR-1');
  await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === 'Clear filters').click());
  expect(host.textContent).toContain('Rows 1–3 of 3');
  await act(async () => host.querySelector('[aria-label="Filter Function"]').click());
  await click('Deselect all'); await check('(blank)');
  expect(host.querySelector('tbody tr td').textContent).toBe('HTR-3');
  await act(async () => menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(menu()).toBeNull(); expect(document.activeElement).toBe(host.querySelector('[aria-label="Filter Function"]'));
});

test('separate actionable issue title and description columns are shared with original assessments and read-only', async () => {
  const rows = [{ id: 'a', hazardTrackingRow: true, attributes: { Hazard: 'Lost command', Function: 'Brake', Loss: 'Collision' } }, { id: 'b', hazardTrackingRow: true, attributes: { Hazard: 'Lost command', Function: 'Steer', Loss: 'Collision' } }];
  const edit = jest.fn();
  await act(async () => root.render(<HazardTrackingTable rows={rows} onSelect={() => {}} onEdit={edit} />));
  const title = host.querySelector('tbody tr td:nth-child(2)').textContent;
  const description = host.querySelector('tbody tr td:nth-child(3)').textContent;
  expect(title).toBe('Safety issue summary pending');
  expect(description).toContain('Generate or resume consolidation');
  expect(description).not.toContain(title);
  expect(title).not.toContain(description);
  expect(host.querySelector('tbody tr td:nth-child(2) strong').textContent).toBe('Safety issue summary pending');
  expect(host.querySelector('tbody tr td:nth-child(12)').textContent).toContain('Collision');
  expect(host.querySelector('tbody tr td:nth-child(4)').textContent).toContain('Lost command');
  await act(async () => host.querySelector('[data-hazard-group] [aria-expanded="false"]').click());
  for (const row of host.querySelectorAll('[data-artifact-object-id]')) {
    expect(row.querySelector('td:nth-child(2)').textContent).toBe(title);
    expect(row.querySelector('td:nth-child(3)').textContent).toBe(description);
    for (const cell of [...row.querySelectorAll('td')].slice(1, 3)) {
      expect(cell.hasAttribute('data-object-field')).toBe(false);
      await act(async () => cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    }
  }
  expect(edit).not.toHaveBeenCalled();
});

test('existing saved issue fields appear separately in the table, filters and exports without regeneration', async () => {
  const assessments = ['Brake', 'Steer'].map((name, index) => ({ id: name, hazardTrackingRow: true, attributes: { Hazard: `${name} command lost`, Function: name } }));
  const issues = [{ title: 'Brake command unavailable', description: 'A missing braking command prevents the vehicle from stopping.' }, { title: 'Steering command unavailable', description: 'A missing steering command prevents the vehicle from following its path.' }];
  const summaries = Object.fromEntries(consolidateHazardRows(assessments).map((group, index) => [group.id, { ...issues[index], evidenceHash: hazardIssueEvidenceHash(group) }]));
  const rows = [{ id: 'section', kind: 'section', sectionId: 's2', hazardIssueSummaries: summaries }, ...assessments];
  await act(async () => root.render(<HazardTrackingTable artifactId="split-issue" rows={rows} onSelect={() => {}} onEdit={() => {}} />));
  const cells = [...host.querySelector('tbody tr').querySelectorAll('td')];
  expect(cells[1].textContent).toBe(issues[0].title);
  expect(cells[2].textContent).toBe(issues[0].description);
  expect(hazardTrackingExportRows(rows).map(row => row.slice(1, 3))).toEqual(issues.map(issue => [issue.title, issue.description]));
  const container = host;
  for (const [column, value] of [['Actionable Safety Issue Title', issues[1].title], ['Actionable Safety Issue Description', issues[1].description]]) {
    await act(async () => container.querySelector(`[aria-label="Filter ${column}"]`).click());
    const menu = document.querySelector('[role="dialog"]');
    await act(async () => [...menu.querySelectorAll('button')].find(button => button.textContent === 'Deselect all').click());
    await act(async () => [...menu.querySelectorAll('label')].find(label => label.textContent === value).querySelector('input').click());
    await act(async () => [...menu.querySelectorAll('button')].find(button => button.textContent === 'Done').click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('tbody tr td:nth-child(2)').textContent).toBe(issues[1].title);
    const edge = host.querySelector(`[aria-label="Resize ${column} column"]`);
    await act(async () => edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(edge.getAttribute('aria-valuenow')).toBe('320');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Clear filters').click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  }
});
