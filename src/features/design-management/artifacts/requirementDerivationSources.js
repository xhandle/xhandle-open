import { artifactObjectText, getTemplate, mergeProposal, semanticHash } from './artifactModel';
import { upstreamRequirementTemplate } from './requirementDerivation';

const owners = config => (config.ownerProjects || [{ id: config.projectId, workspaceType: config.workspaceType }])
  .map(owner => `${owner.workspaceType}:${owner.id}`).sort();
export function matchesRequirementSource(meta, config) {
  return !meta.deleted && meta.templateId === upstreamRequirementTemplate(config) && meta.config
    && JSON.stringify(owners(meta.config)) === JSON.stringify(owners(config))
    && meta.config.system?.trim().toLowerCase() === config.system?.trim().toLowerCase()
    && (!config.programId || meta.programId === config.programId);
}

// Cite the exact requirement object and revision. Its source artifact retains
// the full decomposition and original evidence; do not copy those graphs into
// every software/hardware drafting request.
export function requirementSourceEntries(meta, objects, revision) {
  const selected = objects.filter(object => !object.deleted && (object.kind === 'requirement' || object.kind === 'gap'));
  if (!selected.some(object => object.kind === 'requirement' && artifactObjectText(object).trim())) {
    throw new Error(`Generate the ${getTemplate(meta.templateId).name} with requirement statements before deriving this specification.`);
  }
  return selected.map(object => ({
    id: `artifact-object:${meta.id}:${object.id}`, sourceType: 'artifact-object', templateId: meta.templateId,
    artifactId: meta.id, artifactTitle: meta.title, objectId: object.id, revision,
    contentHash: semanticHash(object), title: object.title || '', text: artifactObjectText(object),
    kind: object.kind, status: object.status || null, evidenceIssue: object.evidenceIssue || null,
    attributes: object.attributes || {}, upstreamSourceIds: object.sourceIds || [],
    ownerProjects: meta.config.ownerProjects || [{ id: meta.config.projectId, workspaceType: meta.config.workspaceType }],
  }));
}

function chooseSource(candidates, config) {
  const parent = upstreamRequirementTemplate(config), title = getTemplate(parent).name;
  const sourceId = config.requirementSourceArtifactId || (parent === 'system-spec' ? config.systemRequirementsArtifactId : null);
  const selected = sourceId
    ? candidates.find(meta => meta.id === sourceId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!selected) throw new Error(candidates.length > 1
    ? `Select the ${title} to use as the source.`
    : `Create and generate a ${title} for this project and system before deriving this specification.`);
  return selected;
}
async function readSource(tx, meta) {
  const revision = meta.revision ? await tx.objectStore('revisions').get(`${meta.id}:${meta.revision}`) : null;
  // An accepted source remains usable while an update is being drafted.
  if (revision) return requirementSourceEntries(meta, revision.objects, revision.number);
  const job = await tx.objectStore('jobs').get(meta.id);
  if (!job || job.state !== 'ready' || job.baseRevision !== meta.revision || getTemplate(meta.templateId).sections.some(section => !job.sections[section.id])) {
    throw new Error(`Finish generating the ${getTemplate(meta.templateId).name} before deriving this specification.`);
  }
  return requirementSourceEntries(meta, mergeProposal([], Object.values(job.sections).flat()), meta.revision + 1);
}
export async function captureRequirementSources(config) {
  const { readArtifactStorage } = await import('./artifactRepository');
  return readArtifactStorage(async db => {
    const tx = db.transaction(['metadata', 'revisions', 'jobs']);
    const candidates = (await tx.objectStore('metadata').getAll()).filter(meta => matchesRequirementSource(meta, config));
    const entries = await readSource(tx, chooseSource(candidates, config));
    await tx.done;
    return entries;
  });
}

// Recheck the source inside the acceptance transaction, including source
// removal, edits or a newly ambiguous automatic selection from another tab.
export async function assertRequirementInputs(tx, config, sources) {
  const parent = upstreamRequirementTemplate(config);
  if (!parent || config.programId) return;
  const candidates = (await tx.objectStore('metadata').getAll()).filter(meta => matchesRequirementSource(meta, config));
  const current = await readSource(tx, chooseSource(candidates, config));
  const captured = sources.entries.filter(source => source.sourceType === 'artifact-object' && source.templateId === parent);
  const sorted = entries => [...entries].sort((a, b) => a.id.localeCompare(b.id));
  if (semanticHash(sorted(current)) !== semanticHash(sorted(captured))) {
    throw new Error(`The source ${getTemplate(parent).name} changed. Generate a fresh proposal before accepting.`);
  }
}
