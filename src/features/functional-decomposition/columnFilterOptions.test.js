import { functionalColumnFilterOptions } from './columnFilterOptions';
const rows = [
  { system: 'A', subsystem: 'Planning', fn: 'Plan' },
  { system: 'A', subsystem: 'Control', fn: 'Drive' },
  { system: 'B', subsystem: 'Monitor', fn: 'Observe' },
];
const options = (filters, field, search) => functionalColumnFilterOptions(rows, filters, field, (row, key) => row[key] || '', search);
test('shows only values compatible with the other active filters', () => {
  expect(options({ system: ['A'] }, 'subsystem')).toEqual(['Control', 'Planning']);
  expect(options({ system: ['A'], subsystem: ['Planning'] }, 'fn')).toEqual(['Plan']);
});
test('ignores its own selection so more compatible values remain selectable', () => {
  expect(options({ system: ['A'], subsystem: ['Planning'] }, 'subsystem')).toEqual(['Control', 'Planning']);
});
test('clearing filters restores values and search applies to the narrowed list', () => {
  expect(options({}, 'subsystem')).toEqual(['Control', 'Monitor', 'Planning']);
  expect(options({ system: ['A'] }, 'subsystem', 'mon')).toEqual([]);
  expect(options({ system: ['A'] }, 'subsystem', 'plan')).toEqual(['Planning']);
});
