import { HAZARD_TRACKING_DERIVED_COLUMNS, projectHazardTrackingFields } from './hazardTrackingFields';
import { hazardGroupValues } from './consolidateHazardRows';

export const columnWidth = value => Math.max(100, Math.min(1200, Number(value) || 240));
export const columnFilterValue = value => String(value ?? '').trim();
export const filterValueSelected = (filter, value) => !filter || (filter.mode === 'exclude' ? !filter.values.includes(value) : filter.values.includes(value));
export function toggleColumnFilter(filter, value) {
  const current = filter || { mode: 'exclude', values: [] };
  const values = current.values.includes(value) ? current.values.filter(item => item !== value) : [...current.values, value];
  return current.mode === 'exclude' && !values.length ? undefined : { mode: current.mode, values };
}
export function hazardColumnOptions(groups, column) {
  return [...new Set(groups.flatMap(group => hazardGroupValues(group, column)).map(columnFilterValue))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
export function filterHazardGroups(groups, filters) {
  const entries = Object.entries(filters).filter(([, filter]) => filter);
  if (!entries.length) return groups;
  const predicates = entries.map(([column, filter]) => {
    const values = new Set(filter.values);
    return [column, value => filter.mode === 'exclude' ? !values.has(value) : values.has(value)];
  });
  return groups.filter(group => group.rows.some(row => {
    const attributes = projectHazardTrackingFields(row.attributes);
    // OR within a column; AND across columns on the same source assessment.
    return predicates.every(([column, matches]) => matches(columnFilterValue(HAZARD_TRACKING_DERIVED_COLUMNS.includes(column) ? hazardGroupValues(group, column)[0] : attributes[column])));
  }));
}
