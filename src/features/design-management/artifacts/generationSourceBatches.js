import { citationContext } from './artifactCitations';

// Budget the actual model-facing projection, not stored diagram snapshots.
// Every selected citable source belongs to exactly one batch; none are sampled.
export function sourceBatchPlan(sources) {
  const projected = citationContext(sources).sources;
  if (JSON.stringify(projected).length <= 90000) return null;
  const entries = sources.entries.filter(entry => entry.sourceType !== 'project');
  const batches = []; let ids = [], size = 2;
  for (let index = 0; index < projected.length; index++) {
    const length = JSON.stringify(projected[index]).length + 1;
    if (length > 90000) throw new Error('One supporting source is too large for a generation request. Split that source into smaller linked items and start a fresh update.');
    if (size + length > 90000) { batches.push(ids); ids = []; size = 2; }
    ids.push(entries[index].id); size += length;
  }
  if (ids.length) batches.push(ids);
  return batches.map((sourceIds, index) => ({ id: `sources${index + 1}`, title: `Source group ${index + 1} of ${batches.length}`, sourceIds,
    focus: 'Draft this section using the current source group. Include supported statements and explicit evidence gaps relevant to this section. Other groups are processed separately; do not claim their evidence is absent or infer their content.' }));
}
export function savedPartCount(job) {
  return Object.entries(job?.sectionParts || {}).filter(([id]) => !job.sections[id]).reduce((sum, [, parts]) => sum + Object.keys(parts.completed || {}).length, 0);
}

// Split only unfinished work. Persist the replacement plan before requesting a
// child so pause/reload resumes the same source partition and stable item IDs.
export function splitGenerationPart(part, sources) {
  if ((part.depth || 0) >= 4) return null;
  const sourceIds = part.sourceIds || sources.entries.filter(entry => entry.sourceType !== 'project').map(entry => entry.id);
  const middle = Math.ceil(sourceIds.length / 2);
  const partitions = sourceIds.length > 1 ? [sourceIds.slice(0, middle), sourceIds.slice(middle)] : null;
  return ['a', 'b'].map((suffix, index) => ({
    ...part, id: `${part.id}-${suffix}`, depth: (part.depth || 0) + 1,
    title: `${part.title} · ${partitions ? `source subset ${index + 1}` : index === 0 ? 'principal statements' : 'remaining detail and questions'}`,
    sourceIds: partitions ? partitions[index] : sourceIds,
    focus: `${part.focus} ${partitions
      ? 'Address only this smaller source subset. The other subset is processed separately; do not infer that its evidence is missing.'
      : index === 0 ? 'Address only the principal supported statements. Additional detail and open questions will be handled in the next part.'
        : 'Address only additional distinct details, constraints and unresolved questions not already saved. Do not repeat saved statements.'}`,
  }));
}
