// Keep project lists independent of immutable evidence and draft object payloads.
export function artifactJobSummary(job) {
  if (!job) return null;
  const sections = job.sections || {};
  return { state: job.state, completedSections: Object.keys(sections).length,
    partialParts: Object.entries(job.sectionParts || {}).filter(([id]) => !sections[id])
      .reduce((total, [, parts]) => total + Object.keys(parts.completed || {}).length, 0) };
}
export async function putArtifactJob(tx, job, add = false) {
  await tx.objectStore('jobs')[add ? 'add' : 'put'](job);
  const store = tx.objectStore('metadata'), meta = await store.get(job.id);
  if (meta && !meta.deleted) await store.put({ ...meta, draftSummary: artifactJobSummary(job), draftCheckpoint: typeof job.token === 'string' && Number.isInteger(job.version) ? { token: job.token, version: job.version } : null });
}
export async function deleteArtifactJob(tx, id) {
  await tx.objectStore('jobs').delete(id);
  const store = tx.objectStore('metadata'), meta = await store.get(id);
  if (meta && !meta.deleted) await store.put({ ...meta, draftSummary: null, draftCheckpoint: null });
}
