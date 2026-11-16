import { putArtifactJob, deleteArtifactJob } from './artifactJobSummary';
import { captureLiveSources, assertOwner } from './artifactSources';
import { semanticHash } from './artifactModel';
import { loadArtifact, makeArtifactJob, readArtifactStorage, writeArtifactStorage } from './artifactRepository';
import { ENGINEERING_PROJECT_TYPE } from './engineeringProjectModel';
import { isSafetyArtifact } from './safetyArtifactTypes';
import { requirementDerivationMode } from './requirementDerivation';

// Update evidence selection without discarding accepted objects or historical links.
// Invalidate old run tokens so late generation responses cannot publish old sources.
export async function updateArchitectureSources(id, selections) {
  const initial = await readArtifactStorage(db => db.get('metadata', id));
  if (!initial || initial.deleted) throw new Error('This design item no longer exists.');
  if (initial.programId) throw new Error('Change source diagrams from the owning systems engineering project.');
  const isProgram = initial.recordType === ENGINEERING_PROJECT_TYPE;
  const mode = requirementDerivationMode({ architectureSources: selections, ownerProjects: initial.ownerProjects || initial.config.ownerProjects, workspaceType: initial.config.workspaceType });
  const records = isProgram ? await Promise.all(initial.members.map(member => loadArtifact(member.id).then(data => data.meta))) : [initial];
  const updates = await Promise.all(records.map(async meta => {
    const config = { ...meta.config, requirementDerivation: mode, architectureSources: isSafetyArtifact(meta.templateId) ? [] : selections.filter(source => meta.templateId !== 'architecture' || (source.workspaceType === 'code-architecture') === (meta.config.architectureKind === 'code-based')) };
    return { meta, config, sources: await captureLiveSources(config) };
  }));
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const current = await tx.objectStore('metadata').get(id);
    if (!current || current.deleted || semanticHash(current) !== semanticHash(initial)) throw new Error('This design item changed. Reload before updating its sources.');
    assertOwner(current.config);
    for (const update of updates) {
      const meta = await tx.objectStore('metadata').get(update.meta.id);
      if (!meta || meta.deleted || semanticHash(meta) !== semanticHash(update.meta)) throw new Error('A document changed. Reload before updating its sources.');
      const next = { ...meta, ...(!meta.revision ? { sourceHash: update.sources.hash, baseSourceHash: update.sources.hash } : {}), config: update.config, freshness: meta.revision ? 'stale' : 'current', freshnessError: null, updatedAt: new Date().toISOString() };
      await tx.objectStore('metadata').put(next);
      if (isProgram) await deleteArtifactJob(tx, meta.id);
      else await putArtifactJob(tx, makeArtifactJob(next, update.sources));
    }
    if (isProgram) await tx.objectStore('metadata').put({ ...current, requirementDerivation: mode, config: { ...updates[0].config, architectureSources: selections }, members: current.members.map(member => ({ ...member, config: updates.find(update => update.meta.id === member.id).config })), version: current.version + 1, state: 'paused', runToken: null, error: null });
  });
}
