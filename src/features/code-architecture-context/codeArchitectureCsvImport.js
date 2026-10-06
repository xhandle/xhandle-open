import { parseCsv, csvHeaderKey } from '../../lib/csv';
import { resolveFunctionalCsvHeaders } from '../functional-decomposition/decompositionCsv';

// Code architecture permits identical function labels in different files.
// Validate the table shape without applying the Projects label-ownership rules.
export function parseCodeArchitectureCsv(text) {
  const grid = parseCsv(text);
  const headers = grid[0] || [];
  const { columns, missingRequired } = resolveFunctionalCsvHeaders(headers);
  if (missingRequired.length) throw new Error(`Missing required CSV columns: ${missingRequired.join(', ')}.`);
  const keys = headers.map(csvHeaderKey);
  if (new Set(keys).size !== keys.length) throw new Error('The CSV contains duplicate column headers.');
  if (keys.includes('guide phrase') || keys.includes('raw analysis row id')) {
    throw new Error('This is a hazard analysis CSV. Import it in Hazard & Remediation.');
  }
  const rows = [];
  grid.slice(1).forEach((cells, index) => {
    if (cells.every(cell => !cell.trim())) return;
    if (cells.length !== headers.length) throw new Error(`CSV record ${index + 2} has an unexpected number of columns.`);
    const row = Object.fromEntries(headers.map((header, column) => [header.trim(), cells[column]]));
    columns.forEach((column, field) => { row[field] = cells[column].trim(); });
    for (const field of ['fromFunction', 'controlAction', 'toFunction']) {
      if (!row[field]) throw new Error(`CSV record ${index + 2} is missing ${field}.`);
    }
    rows.push(row);
  });
  if (!rows.length) throw new Error('The CSV contains no functional decomposition rows.');
  return rows;
}
