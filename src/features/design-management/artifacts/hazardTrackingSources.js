import { semanticHash, mergeProposal } from './artifactModel';
import { consolidateHazardRows, hazardGroupValues } from './consolidateHazardRows';

const owners = config => (config.ownerProjects || [{ id: config.projectId, workspaceType: config.workspaceType }]).map(owner => `${owner.workspaceType}:${owner.id}`).sort();
export function matchesHazardTrackingSource(meta, config) {
  return !meta.deleted && meta.templateId === 'hazard-tracking-list'
    && JSON.stringify(owners(meta.config)) === JSON.stringify(owners(config))
    && meta.config.system.trim().toLowerCase() === config.system.trim().toLowerCase();
}

// Capture the consolidated records, never thousands of original assessment rows.
// The immutable source artifact retains the full assessment-level traceability.
export function consolidatedHazardSources(meta, objects, revision) {
  const groups = consolidateHazardRows(objects);
  if (!groups.length) throw new Error('The Hazard Tracking List has no actionable HTRs. Complete its hazard consolidation before generating Safety Requirements.');
  if (groups.some(group => !group.safetyIssue)) throw new Error('Finish consolidating the Hazard Tracking List so every HTR has an actionable safety issue before generating Safety Requirements.');
  const context = ['Function', 'Operational Scenario', 'Operational Mode', 'Operating Conditions', 'Loss', 'Safety Constraint', 'Verification', 'Safety Classification'];
  return groups.map(group => {
    const attributes = Object.fromEntries(context.map(column => [column, hazardGroupValues(group, column).filter(Boolean)]));
    return { id: `hazard-tracking-record:${meta.id}:${group.recordId}`, sourceType: 'hazard-tracking-record',
      artifactId: meta.id, artifactTitle: meta.title, revision, recordId: group.recordId,
      title: `${group.recordId} — ${group.issueTitle}`, text: group.issueBody,
      attributes: { HTR: group.recordId, 'Actionable Safety Issue Title': group.issueTitle, ...attributes },
      ownerProjects: meta.config.ownerProjects || [{ id: meta.config.projectId, workspaceType: meta.config.workspaceType }],
      objectIds: group.rows.map(row => row.id),
      contentHash: semanticHash({ title: group.issueTitle, description: group.issueBody, attributes }),
    };
  });
}

export async function captureConsolidatedHazardSources(config) {
  const { readArtifactStorage } = await import('./artifactRepository');
  return readArtifactStorage(async db => {
    const tx = db.transaction(['metadata', 'revisions', 'jobs']);
    const candidates = (await tx.objectStore('metadata').getAll()).filter(meta => matchesHazardTrackingSource(meta, config));
    const selected = config.hazardTrackingArtifactId ? candidates.find(meta => meta.id === config.hazardTrackingArtifactId) : candidates.length === 1 ? candidates[0] : null;
    if (!selected) throw new Error(candidates.length > 1 ? 'Select the consolidated Hazard Tracking List to use as the source for Safety Requirements.' : 'Create and consolidate a Hazard Tracking List for this project and system before generating Safety Requirements.');
    const entries = await readConsolidatedRecords(tx, selected);
    await tx.done;
    return entries;
  });
}

async function readConsolidatedRecords(tx, meta) {
  const job = await tx.objectStore('jobs').get(meta.id);
  const revision = meta.revision ? await tx.objectStore('revisions').get(`${meta.id}:${meta.revision}`) : null;
  if (job && (job.state !== 'ready' || job.baseRevision !== meta.revision)) throw new Error('Finish generating and consolidating the selected Hazard Tracking List before generating Safety Requirements.');
  if (!job && !revision) throw new Error('Generate and consolidate the selected Hazard Tracking List before generating Safety Requirements.');
  const objects = job ? mergeProposal(revision?.objects || [], Object.values(job.sections).flat()) : revision.objects;
  return consolidatedHazardSources(meta, objects, job ? meta.revision + 1 : revision.number);
}

// Check same-database dependencies in the publication transaction as well as
// before generation, so another tab cannot replace the HTL during acceptance.
export async function assertConsolidatedHazardInputs(tx, config, sources) {
  if (config.templateId !== 'safety-requirements' || config.programId) return;
  const captured = sources.entries.filter(source => source.sourceType === 'hazard-tracking-record');
  const meta = captured[0] && await tx.objectStore('metadata').get(captured[0].artifactId);
  if (!meta || !matchesHazardTrackingSource(meta, config)) throw new Error('The source Hazard Tracking List changed or was removed. Start a fresh Safety Requirements proposal.');
  const current = await readConsolidatedRecords(tx, meta);
  const ordered = entries => [...entries].sort((a, b) => a.id.localeCompare(b.id));
  if (semanticHash(ordered(current)) !== semanticHash(ordered(captured))) throw new Error('The consolidated HTR sources changed. Start a fresh Safety Requirements proposal.');
}
