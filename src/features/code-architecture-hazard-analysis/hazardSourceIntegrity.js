export const HAZARD_SOURCE_INCOMPLETE = 'HAZARD_SOURCE_INCOMPLETE';

export function incompleteHazardSource(runId, counts = {}) {
  const detail = Number.isSafeInteger(counts.found) && Number.isSafeInteger(counts.expected)
    ? ` Found ${counts.found.toLocaleString()} of ${counts.expected.toLocaleString()} required data chunks.` : '';
  return Object.assign(new Error(`Saved hazard results are incomplete.${detail} A storage upgrade cannot restore missing data. Restore a backup containing hazard results or run a new hazard analysis. Existing stored records have been preserved.`), {
    code: HAZARD_SOURCE_INCOMPLETE, runId,
  });
}
