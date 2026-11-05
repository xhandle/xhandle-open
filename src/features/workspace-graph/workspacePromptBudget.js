// Fit whole records and their citations. Slicing a serialized context can remove
// provenance, cut a row mid-field, or turn a valid object into invalid JSON.
export function fitWorkspacePromptSample(sample, maxCharacters) {
  const keys = ['relevantArtifacts', 'sourceFiles', 'projects', 'relationships', 'runs', 'reviews', 'evidence'];
  const suppliedCitations = new Map((sample.citations || []).map(row => [row.artifactId, row]));
  const result = Object.fromEntries(keys.map(key => [key, []]));
  result.citations = [];
  result.coverage = { sampled: true, omittedRecords: 0,
    indexIncomplete: Boolean(sample.diagnostics?.migrationError || sample.diagnostics?.migration?.errors?.length || sample.diagnostics?.migration?.sourceChangedDuringMigration),
  };
  const ids = new Set();
  // Leave room for the omitted counter to grow while fitting subsequent rows.
  const fits = () => JSON.stringify(result).length <= maxCharacters - 32;
  for (const key of keys) {
    for (const row of sample[key] || []) {
      if (key === 'relationships' && !ids.has(row.fromArtifactId) && !ids.has(row.toArtifactId)) {
        result.coverage.omittedRecords += 1; continue;
      }
      const needsCitation = key === 'relevantArtifacts' || key === 'sourceFiles';
      const citation = needsCitation ? suppliedCitations.get(row.id) || {
        artifactId: row.id, projectId: row.projectId, title: row.title || row.path, type: row.type,
      } : null;
      result[key].push(row);
      if (citation) result.citations.push(citation);
      if (fits()) { if (row.id) ids.add(row.id); }
      else {
        result[key].pop();
        if (citation) result.citations.pop();
        result.coverage.omittedRecords += 1;
      }
    }
  }
  // Diagnostic metadata is optional; evidence and citations have priority.
  result.diagnostics = sample.diagnostics || {};
  if (!fits()) delete result.diagnostics;
  return result;
}

// Compare only JSON-visible fields. A matching ID alone is insufficient: the
// graph may hold a different revision or extra fields absent from a read result.
function includesFields(available, requested) {
  if (requested === undefined) return true;
  if (requested === null || typeof requested !== 'object') return available === requested;
  if (!available || typeof available !== 'object') return false;
  if (Array.isArray(requested)) return Array.isArray(available) && requested.length === available.length
    && requested.every((value, index) => includesFields(available[index], value));
  return !Array.isArray(available) && Object.keys(requested).every(key => includesFields(available[key], requested[key]));
}

export function deduplicateWorkspacePromptSample(sample, fittedEvidence, {projectRow = row => row, originalRows = []} = {}) {
  if (!fittedEvidence?.results?.length) return sample;
  // Both sides have already passed their budgets. Never deduplicate against a
  // record that might subsequently be omitted or truncated from the prompt.
  const rows = fittedEvidence.results.flatMap(result => result.rows || []);
  const candidates = rows.map(row => ({raw: row, projected: projectRow(row)}));
  const duplicate = row => {
    const original = originalRows.find(source => source.id === row.id && source.projectId === row.projectId) || row;
    return row.id && row.projectId && candidates.some(({raw, projected}) =>
      raw.id === row.id && raw.projectId === row.projectId
      && ['updatedAt', 'revision', 'version'].every(key => raw[key] === original[key])
      && (includesFields(raw, row) || includesFields(projected, row)));
  };
  const result = {...sample};
  for (const key of ['relevantArtifacts', 'sourceFiles', 'runs', 'reviews', 'evidence']) {
    if (sample[key]) result[key] = sample[key].filter(row => !duplicate(row));
  }
  const citations = fittedEvidence.results.flatMap(result => result.citations || []);
  if (sample.citations) result.citations = sample.citations.filter(row => !citations.some(other =>
    row.artifactId && row.projectId && other.artifactId === row.artifactId && other.projectId === row.projectId && includesFields(other, row)));
  if (sample.diagnostics?.overview && fittedEvidence.results.some(read => read.operation === 'overview'
    && read.excerpt?.text === JSON.stringify(sample.diagnostics.overview))) {
    const {overview, ...diagnostics} = sample.diagnostics;
    result.diagnostics = diagnostics;
  }
  return result;
}
