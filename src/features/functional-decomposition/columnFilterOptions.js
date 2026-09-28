export function functionalColumnFilterOptions(rows, filters, field, getCellValue, search = '') {
  const otherFilters = Object.entries(filters).filter(([key, values]) => key !== field && values?.length);
  const values = new Set();
  rows.forEach(row => {
    if (!otherFilters.every(([key, allowed]) => allowed.includes(getCellValue(row, key)))) return;
    const value = getCellValue(row, field);
    if (value) values.add(value);
  });
  const query = String(search || '').toLowerCase();
  return [...values]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .filter(value => value.toLowerCase().includes(query));
}
