// Only downstream analysis cells: identity, context, user decisions, rationales
// and provenance must not be inferred or replaced when an exclusion is recorded.
const downstream = new Set([
  'Loss', 'Hazard', 'Raw Loss Candidate', 'Raw Hazard Candidate', 'Canonical Loss ID',
  'Canonical Hazard ID', 'Unsafe Control Action', 'Causal Scenario', 'Causal Factor',
  'Causal Factor Category', 'Mitigation Strategy', 'Safety Constraint', 'System Requirement',
  'Requirement Parameter Source', 'Verification Method', 'Acceptance Criteria',
  'Causal Effect', 'Resulting System State', 'Intermediate Safety Function',
  'Intermediate Safety Effect', 'Protection Assessment', 'Protection Status',
  'Physical-Harm Chain Termination',
]);

export function fillNotApplicableHazardCells(headers, row) {
  const applicability = headers.indexOf('Guide Phrase Applicable');
  if (!/^no$/i.test(String(row?.[applicability] || '').trim())) return row;
  let next = row;
  headers.forEach((header, index) => {
    if (downstream.has(header) && !String(row[index] ?? '').trim()) {
      if (next === row) next = [...row];
      next[index] = 'Not Applicable';
    }
  });
  return next;
}

export function fillNotApplicableHazardSummary(summary) {
  if (!Array.isArray(summary?.[0])) return summary;
  const rows = summary.slice(1).map(row => fillNotApplicableHazardCells(summary[0], row));
  return rows.some((row, index) => row !== summary[index + 1]) ? [summary[0], ...rows] : summary;
}
