// Collect distinct display values during the existing layout scan, never row
// bodies. Per-column quotas prevent a narrative column starving later columns.
export const FILTER_OPTION_BYTES = 4 * 1024 * 1024;
const COLUMN_BYTES = 64 * 1024;
const MAX_VALUES = 500;
const MAX_CHARS = 2048;
const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
export const FILTER_ROW_INDEX_BYTES = 4 * 1024 * 1024;
export function createHazardFilterOptions(columnCount, rowCount = 0) {
  const codeBytes = Math.ceil(rowCount * 9 / 8);
  const indexed = rowCount > 0 && Number.isSafeInteger(rowCount) && codeBytes * columnCount <= FILTER_ROW_INDEX_BYTES;
  let position = 0;
  const quota = Math.min(COLUMN_BYTES, Math.floor(FILTER_OPTION_BYTES / Math.max(1, columnCount)));
  const columns = Array.from({ length: columnCount }, () => ({ values: new Map(), codes: indexed ? new Uint8Array(codeBytes) : null, bytes: 128 + (indexed ? codeBytes : 0), valueBytes: 128, truncated: false }));
  return {
    addRow(row) {
      columns.forEach((column, index) => {
        const value = String(row[index] ?? '').trim() || '(blank)';
        if (column.values.has(value)) {
          if (column.codes) writeCode(column.codes, position, column.values.get(value));
          return;
        }
        const bytes = 128 + value.length * 2;
        if (value.length > MAX_CHARS || column.values.size >= MAX_VALUES || column.valueBytes + bytes > quota) {
          column.truncated = true;
          return;
        }
        // Detach trimmed substrings from potentially much larger source cells.
        const code = column.values.size + 1;
        column.values.set(value.split('').join(''), code);
        if (column.codes) writeCode(column.codes, position, code);
        column.bytes += bytes;
        column.valueBytes += bytes;
      });
      position++;
    },
    finish() {
      return {
        columns: columns.map(column => {
          const options = [...column.values.keys()].sort(compare);
          return { options, truncated: column.truncated, ...(column.codes ? {codes: column.codes, optionCodes: options.map(value => column.values.get(value))} : {}) };
        }),
        rowCount: indexed ? rowCount : 0,
        metadataBytes: columns.reduce((total, column) => total + column.bytes, 0),
      };
    },
  };
}
export function findPreparedHazardOptions(index, column, search = '') {
  const prepared = index?.columns?.[column];
  if (!prepared) return null;
  const needle = search.trim().toLowerCase();
  // Searching a truncated list must still find values outside its cached prefix.
  if (needle && prepared.truncated) return null;
  return needle ? { options: prepared.options.filter(value => value.toLowerCase().includes(needle)), truncated: false } : prepared;
}

// Nine bits encode up to 500 values plus zero for unlisted values. This is
// membership metadata, not cell text; bounded independently of the value lists.
function writeCode(bytes, row, code) {
  const bit = row * 9, offset = bit >> 3, shift = bit & 7;
  bytes[offset] |= (code << shift) & 255;
  bytes[offset + 1] |= code >> (8 - shift);
}
function readCode(bytes, row) {
  const bit = row * 9, offset = bit >> 3, shift = bit & 7;
  return ((bytes[offset] | (bytes[offset + 1] << 8)) >> shift) & 511;
}
export function filterPreparedHazardLayout(layout, filters = {}) {
  if (!layout) return null;
  const selected = Object.entries(filters).filter(([, values]) => values.length);
  if (!selected.length) return layout;
  const index = layout.optionIndex;
  if (!index?.rowCount) return layout.total === 0 ? layout : null;
  const predicates = [];
  for (const [key, values] of selected) {
    const column = index.columns[Number(key)];
    if (!column?.codes) return null;
    const codes = new Set();
    for (const value of values) {
      const at = column.options.indexOf(value);
      if (at < 0) { if (column.truncated) return null; }
      else codes.add(column.optionCodes[at]);
    }
    predicates.push({column, codes});
  }
  const matched = new Uint8Array(index.rowCount);
  const indices = layout.indices.filter(row => {
    const match = predicates.every(({column, codes}) => codes.has(readCode(column.codes, row)));
    if (match) matched[row] = 1;
    return match;
  });
  const groups = layout.groups.map(group => {
    const rowIndices = group.rowIndices.filter(row => matched[row]);
    return {...group, rowIndices, rowCount: rowIndices.length};
  }).filter(group => group.rowCount);
  return {...layout, indices, groups, total: indices.length,
    metadataBytes: layout.metadataBytes + indices.length * 32 + groups.length * 128};
}
