// Interface identity is already rendered in the collapsible group heading.
// Keep that identity available in the picker for copying/individual inspection.
export const STPA_DEFAULT_COLUMNS = [
  'Operational Context', 'Guide Phrase', 'Guide Phrase Applicable',
  'Unsafe Control Action', 'Loss', 'Hazard', 'Causal Scenario', 'Safety Constraint',
  'Software Safety Requirement', 'Verification', 'Safety Classification',
];
const defaultColumns = new Set(STPA_DEFAULT_COLUMNS.map(name => name.toLowerCase()));
const internalColumns = new Set([
  'execution dependency', 'execution evidence quote', 'operator dependency', 'operator context quote',
  'assessed control action', 'assessment basis', 'causal assessment basis',
  'guide phrase applicability review status', 'raw analysis row id', 'operational context id',
  'from node id', 'control edge id', 'to node id', 'architecture row ref',
  'source symbols', 'source line ranges',
  // Historical template columns unrelated to STPA artifacts.
  'severity', 'exposure', 'controllability', 'asil', 'rating rationale', 'safety goal',
  'malfunctioning behavior', 'hazardous event', 'mishap', 'severity category', 'severity rationale',
  'software control category', 'software control category rationale', 'software criticality index',
  'swci rationale / derivation', 'safety significant', 'protection assessment', 'protection status',
  'physical-harm chain termination', 'classification resolution status',
]);
const normalize = name => String(name || '').trim().toLowerCase();

export function stpaColumnOptions(columns, rows, { remote = false } = {}) {
  const candidates = columns.filter(column => {
    const name = normalize(column.header);
    return name && !internalColumns.has(name) && !/\b(?:confidence|uncertainty|review status|needs review)\b/.test(name);
  });
  // A remote window cannot establish whether the entire column is empty.
  // Never add/remove picker choices as users move between remote windows.
  if (remote) return candidates;
  const populated = new Set(candidates.filter(column => defaultColumns.has(normalize(column.header))).map(column => column.index));
  const pending = candidates.filter(column => !populated.has(column.index));
  for (const row of rows) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (String(row?.[pending[i].index] ?? '').trim()) {
        populated.add(pending[i].index); pending.splice(i, 1);
      }
    }
    if (!pending.length) break;
  }
  return candidates.filter(column => populated.has(column.index));
}
