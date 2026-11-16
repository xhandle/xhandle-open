import { readableValue } from './readableValues';

// Match the values rendered in cells, including defaults and intentionally
// hidden requirement titles. Numbering is a hierarchy annotation, not a title.
export function tableColumnValue(row, key, hideRequirementTitles = false) {
  let value;
  if (key.startsWith('attr:')) {
    value = row.attributes?.[key.slice(5)];
    value = value == null ? '' : readableValue(value);
  } else if (key === 'title') {
    if (hideRequirementTitles && (row.kind === 'requirement' || row.proposedKind === 'requirement')) return '';
    value = row.content?.type === 'table'
      ? (row.content.table?.cells || []).map(line => line.map(cell => String(cell ?? '')).join(' | ')).join('\n')
      : row.title || (row.content?.type === 'image' ? row.content.image?.name : '') || '';
  } else if (key === 'status') value = row.status || 'Proposed';
  else if (key === 'version') value = row.version ?? 1;
  else if (key === 'updatedAt') value = (row.updatedAt || '').replace('T', ' ').slice(0, 16);
  else if (key === 'links') value = (row.links || []).length;
  else value = row[key];
  return String(value ?? '').trim();
}

export function tableColumnOptions(rows, key, hideRequirementTitles) {
  return [...new Set(rows.map(row => tableColumnValue(row, key, hideRequirementTitles)))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export function filterTableRows(rows, filters, hideRequirementTitles) {
  const predicates = Object.entries(filters).filter(([, filter]) => filter).map(([key, filter]) => ({ key, mode: filter.mode, values: new Set(filter.values) }));
  if (!predicates.length) return rows;
  // OR within a column, AND across columns. Keep source order/identities intact.
  return rows.filter(row => predicates.every(({ key, mode, values }) => {
    const selected = values.has(tableColumnValue(row, key, hideRequirementTitles));
    return mode === 'exclude' ? !selected : selected;
  }));
}
