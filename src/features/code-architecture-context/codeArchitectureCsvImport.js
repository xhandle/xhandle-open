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
    if (keys.includes('interaction type') && keys.includes('supporting source trace ids')) {
      const get = header => cells[keys.indexOf(csvHeaderKey(header))]?.trim() || '';
      const kind = get('interaction type').toLowerCase();
      if (!['internal operations', 'control', 'data', 'service', 'feedback', 'unknown'].includes(kind)) throw new Error(`CSV record ${index + 2} has an invalid Interaction Type.`);
      const allocation = side => Object.fromEntries(['subsystem', 'csci', 'csc'].map(level => [level, get(`${level} (${side})`)]));
      row.fromArchitecture = allocation('from'); row.toArchitecture = allocation('to'); row.architecture = row.fromArchitecture;
      row.functionalCsvSnapshot = { version: 1, kind: kind === 'internal operations' ? 'internal' : kind,
        sourceTraceIds: get('supporting source trace ids').split(',').map(value => value.trim()).filter(Boolean),
        sourceRowRefs: get('supporting source rows').split(',').map(value => value.trim()).filter(Boolean) };
      row.traceId = get('interaction id') || undefined;
      row.fromNodeId = get('function (from) id') || undefined;
      row.toNodeId = get('function (to) id') || undefined;
      row.hazardAnalysisEligibility = get('hazard analysis eligibility') || (kind === 'internal operations' ? 'Exclude' : 'Include');
      if (!['Include', 'Exclude', 'Needs Review'].includes(row.hazardAnalysisEligibility)) throw new Error(`CSV record ${index + 2} has an invalid Hazard Analysis Eligibility.`);
      row.hazardAnalysisEligibilitySource = get('eligibility source') || 'functional-csv-import';
      row.hazardAnalysisEligibilityRationale = get('eligibility rationale') || 'Imported Functional snapshot; internal operations excluded, interactions retained for assessment. Source completeness is not verified.';
    }
    rows.push(row);
  });
  if (!rows.length) throw new Error('The CSV contains no functional decomposition rows.');
  return rows;
}
