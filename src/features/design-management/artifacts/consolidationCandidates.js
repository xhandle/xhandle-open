import { briefGroups, briefSources, mapBriefSources } from './generationBrief';

// Combine only identical wording and status; units and numeric criteria retain
// their exact case and values. Semantic merges are reviewed by the provider.
export function mergeIdenticalCandidates(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.kind, candidate.title.trim(), candidate.text.trim(), candidate.evidenceIssue, candidate.proposedKind]);
    const existing = seen.get(key);
    if (existing) existing.sourceIds = [...new Set([...existing.sourceIds, ...candidate.sourceIds])];
    else seen.set(key, { ...candidate, sourceIds: [...candidate.sourceIds] });
  }
  return [...seen.values()];
}

export function candidateConsolidationPlan(candidates) {
  const inputs = briefSources(candidates), citations = mapBriefSources(inputs, candidates);
  const byId = new Map(inputs.entries.map((entry, index) => [entry.id, candidates[index]]));
  const key = entry => {
    const candidate = byId.get(entry.id);
    return `${candidate.kind}:${[...candidate.sourceIds].sort()[0] || ''}:${candidate.title}`;
  };
  const entries = [...inputs.entries].sort((a, b) => key(a).localeCompare(key(b)));
  const groups = briefGroups({ entries }).flatMap(group => {
    const batches = [];
    for (let index = 0; index < group.length; index += 24) batches.push(group.slice(index, index + 24));
    return batches;
  });
  return { inputs, citations, byId, groups };
}

export function reviewedCandidates(rows, group, byId) {
  const cited = new Set(rows.flatMap(row => row.synthesisSourceIds || []));
  // Missing candidate citations are not permission to discard requirements.
  const omitted = group.filter(entry => !cited.has(entry.id)).map(entry => byId.get(entry.id));
  return { omitted, complete: !omitted.length };
}
