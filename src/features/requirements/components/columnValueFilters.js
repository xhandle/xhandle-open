export const filterValueSelected = (filter, value) => !filter || (filter.mode === 'exclude' ? !filter.values.includes(value) : filter.values.includes(value));

export function toggleColumnFilter(filter, value) {
  const current = filter || { mode: 'exclude', values: [] };
  const values = current.values.includes(value) ? current.values.filter(item => item !== value) : [...current.values, value];
  return current.mode === 'exclude' && !values.length ? undefined : { mode: current.mode, values };
}
