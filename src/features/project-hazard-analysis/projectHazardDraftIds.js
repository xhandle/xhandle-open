import { ensureHazardAnalysisRowIds } from './classificationResolutionStatus';

/** Preserve an assigned ID; otherwise bind the draft's identity before editing. */
export function identifyProjectHazardDraftRow(headers, row, fallbackRow = null, identity = '') {
  const index = headers.indexOf('Raw Analysis Row ID');
  if (index < 0 || String(row[index] || '').trim()) return row;
  const next = [...row];
  // Include the target key to distinguish otherwise identical interfaces.
  const generated = fallbackRow?.[index] || ensureHazardAnalysisRowIds([
    [...headers, 'Draft identity'], [...row, identity],
  ])[1][index];
  next[index] = generated;
  return next;
}
