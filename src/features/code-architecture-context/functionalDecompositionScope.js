// Publication scope is independent of hazard eligibility. The full syntax
// inventory remains available even when a relationship is not a diagram row.
export const DECOMPOSITION_SCOPE_VERSION = 1;
export const isNonProductionCallPath = path => /(^|\/)(tests?|__tests__|fixtures?|examples?|mocks?|demos?|benchmarks?)(\/|$)|(^|\/)(test_[^/]*|[^/]*_test)\.py$/i.test(String(path || '').replace(/\\/g, '/'));

export function decompositionDisposition(row, ledger = {}) {
  const e = row.relationshipEvidence;
  const file = ledger[e?.fromFile || row.grounding?.currentFile || row.fromFile];
  if (!e?.supported) {
    // A new Python policy must not silently erase existing extraction support
    // for languages which have no syntax inventory yet.
    if (!file?.supported) return 'legacy-language-extraction';
    return 'review-model-proposal';
  }
  if (e.kind?.startsWith('structural_')) return 'hierarchy-evidence';
  if (!['direct_call', 'imported_call', 'call_expression'].includes(e.kind)) return 'review-relationship-kind';
  if (isNonProductionCallPath(e.fromFile)) return 'excluded-nonproduction-call';
  if (file?.presentationExclusions?.[row.canonicalRelationshipId]) return file.presentationExclusions[row.canonicalRelationshipId];
  return 'published-call';
}

export function decompositionRowsAllowed(row, ledger) {
  return ['published-call', 'legacy-language-extraction'].includes(decompositionDisposition(row, ledger));
}

export function decompositionTableEntries(rows, showHistorical = false, focusedIndex = null) {
  return rows.map((row, sourceIndex) => ({row, sourceIndex})).filter(({row,sourceIndex}) =>
    row.lineage?.status !== 'historical' || showHistorical ||
    (focusedIndex !== null && focusedIndex !== undefined && focusedIndex !== '' && sourceIndex === Number(focusedIndex)));
}

export function scopeFunctionalDecomposition(rows, ledger) {
  const included = [], reviewProposals = [];
  const dispositions = new Map();
  for (const row of rows) {
    const disposition = decompositionDisposition(row, ledger);
    if (row.canonicalRelationshipId) dispositions.set(row.canonicalRelationshipId, disposition);
    if (disposition === 'published-call' || disposition === 'legacy-language-extraction') included.push(row);
    else if (!row.canonicalRelationshipId) reviewProposals.push({...row, decompositionDisposition:disposition});
  }
  for (const file of Object.values(ledger)) {
    file.decompositionScopeVersion = DECOMPOSITION_SCOPE_VERSION;
    file.relationships = (file.relationships || []).map(e => ({...e, decompositionDisposition:dispositions.get(e.canonicalId) || 'not-published'}));
    file.publishedCalls = file.relationships.filter(e => e.decompositionDisposition === 'published-call').length;
    file.excludedRelationships = file.relationships.length - file.publishedCalls;
  }
  // Files without relationships can still have a model-only proposal.
  for (const [path,file] of Object.entries(ledger)) file.reviewProposals = reviewProposals.filter(row => (row.grounding?.currentFile || row.fromFile) === path);
  return included;
}
