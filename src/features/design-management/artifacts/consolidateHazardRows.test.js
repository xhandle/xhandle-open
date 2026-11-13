import { consolidateHazardRows, assignHazardTrackingRecordNumbers } from './consolidateHazardRows';
import { HAZARD_TRACKING_TABLE_COLUMNS } from './hazardTrackingFields';
import { hazardTrackingExportRows, hazardTrackingCSV } from './hazardTrackingExport';
import { artifactMarkdown } from './artifactExport';

const row = (id, attributes) => ({ id, hazardTrackingRow: true, attributes });
test('groups matching wording, retaining exact values and all original source associations', () => {
  const rows = [row('a', { Hazard: 'Lost command', Function: 'Brake', Verification: 'Injection', 'Safety Classification': 'Direct' }), row('b', { Hazard: ' lost  COMMAND ', Function: 'Steer', Verification: 'Inspection', 'Safety Classification': 'Indirect' }), row('c', { Hazard: 'Delayed command' }), row('d', {}), row('e', {}), { ...row('deleted', { Hazard: 'Lost command' }), deleted: true }];
  const groups = consolidateHazardRows(rows);
  expect(groups).toHaveLength(4);
  expect(groups[0].rows).toEqual(rows.slice(0, 2));
  expect(groups[0].values.Function).toEqual(['Brake', 'Steer']);
  expect(groups[0].values['Safety Classification']).toEqual(['Direct', 'Indirect']);
  expect(groups[0].values.Verification).toEqual(['Injection', 'Inspection']);
  expect(rows[0].attributes.Hazard).toBe('Lost command');
});

test('exports the same consolidated 16-column table without document sections or extra source columns', () => {
  const objects = [{ id: 'section', kind: 'section', title: 'Old scope section', text: 'Old narrative' }, row('a', { Hazard: 'Lost command', Function: 'Brake', Verification: 'Inject | stop\nCheck', Debug: 'Excluded evidence' }), row('b', { Hazard: 'Lost command', Function: 'Steer', Verification: 'Inspect' })];
  const exported = hazardTrackingExportRows(objects);
  expect(exported).toHaveLength(1); expect(exported[0]).toHaveLength(16);
  expect(exported[0][0]).toMatch(/^HTR-\d+$/);
  expect(exported[0][1]).toContain('Safety issue summary pending');
  expect(exported[0][1]).not.toContain('Generate or resume');
  expect(exported[0][2]).toContain('Generate or resume consolidation');
  expect(exported[0][2]).not.toContain('Safety issue summary pending');
  expect(exported[0][3]).toBe('Lost command');
  expect(exported[0][4]).toBe('Brake\n\nSteer');
  const markdown = artifactMarkdown({ title: 'HTL', templateId: 'hazard-tracking-list' }, { number: 1, objects });
  expect(markdown).toContain('| ' + HAZARD_TRACKING_TABLE_COLUMNS.join(' | ') + ' |');
  expect(markdown).toContain('Inject &#124; stop<br>Check');
  expect(markdown).not.toMatch(/Old scope|Old narrative|Source register|Excluded evidence/);
  const csv = hazardTrackingCSV(objects);
  expect(csv).toContain(`"${exported[0][0]}"`);
  expect(csv).toContain('"Brake\n\nSteer"'); expect(csv).not.toContain('Excluded evidence');
});

test('HTR is stable across ordering, cell edits and consolidation and agrees with exports', () => {
  const first = row('a', { Hazard: 'Lost command', Function: 'Brake' }), second = row('b', { Hazard: 'Lost command', Function: 'Steer' });
  const numbered = assignHazardTrackingRecordNumbers([first, second]);
  const record = consolidateHazardRows(numbered)[0].recordId;
  expect(record).toBe('HTR-1');
  expect(consolidateHazardRows([second, first])[0].recordId).toBe(record);
  expect(consolidateHazardRows([{ ...first, attributes: { ...first.attributes, Verification: 'Inspection' } }, second])[0].recordId).toBe(record);
  expect(hazardTrackingExportRows([first, second])[0][0]).toBe(record);
  const distinct = consolidateHazardRows([first, row('c', { Hazard: 'Late command' })]);
  expect(distinct[0].recordId).not.toBe(distinct[1].recordId);
  expect(consolidateHazardRows([{ ...first, attributes: { Hazard: 'Revised hazard wording' } }])[0].recordId).toBe(consolidateHazardRows([first])[0].recordId);
});

test('saved sequential IDs survive reordering, new records and deletion without reusing numbers', () => {
  const section = { id: 'table', kind: 'section', sectionId: 's2' };
  const original = assignHazardTrackingRecordNumbers([section, row('a', { Hazard: 'Missing command' }), row('b', { Hazard: 'Late command' })]);
  expect(consolidateHazardRows(original).map(group => group.recordId)).toEqual(['HTR-1', 'HTR-2']);
  const reordered = assignHazardTrackingRecordNumbers([section, row('c', { Hazard: 'Unexpected command' }), original[2], original[1]], original);
  expect(consolidateHazardRows(reordered).map(group => group.recordId)).toEqual(['HTR-3', 'HTR-2', 'HTR-1']);
  const deleted = assignHazardTrackingRecordNumbers([reordered[0], reordered[2], reordered[3]], reordered);
  const added = assignHazardTrackingRecordNumbers([...deleted, row('d', { Hazard: 'Corrupt command' })], deleted);
  expect(consolidateHazardRows(added).map(group => group.recordId)).toEqual(['HTR-2', 'HTR-1', 'HTR-4']);
});

test('splitting a saved record assigns a new number while merged records retain an existing number', () => {
  const original = assignHazardTrackingRecordNumbers([row('a', { Hazard: 'Missing command' }), row('b', { Hazard: 'Missing command' })]);
  const split = assignHazardTrackingRecordNumbers([original[0], { ...original[1], attributes: { Hazard: 'Late command' } }], original);
  expect(consolidateHazardRows(split).map(group => group.recordId)).toEqual(['HTR-1', 'HTR-2']);
  const merged = assignHazardTrackingRecordNumbers([split[0], { ...split[1], attributes: { Hazard: 'Missing command' } }], split);
  expect(consolidateHazardRows(merged).map(group => group.recordId)).toEqual(['HTR-1']);
});
