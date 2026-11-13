import { openArtifactDatabase } from './artifactRepository';
import { BACKUP_DATA_CHANGED_EVENT } from '../../../lib/localBackupEvents';

// Layouts belong to an artifact and a specific saved diagram/view. Source evidence
// stays immutable, and opening a project never needs to read these records.
export const presentationKey = (artifactId, diagram) => JSON.stringify([artifactId, diagram.id, diagram.diagramHash]);
export async function loadArchitecturePresentation(artifactId, diagram) {
  if (!artifactId) return null;
  const db = await openArtifactDatabase();
  try { return (await db.get('presentations', presentationKey(artifactId, diagram)))?.presentation || null; }
  finally { db.close(); }
}
export async function saveArchitecturePresentation(artifactId, diagram, presentation) {
  const db = await openArtifactDatabase();
  try {
    const tx = db.transaction(['metadata', 'presentations'], 'readwrite');
    const meta = await tx.objectStore('metadata').get(artifactId);
    if (!meta || meta.deleted) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error('This artifact no longer exists.');
    }
    await tx.objectStore('presentations').put({ id: presentationKey(artifactId, diagram), artifactId, projectId: meta.projectId, presentation });
    await tx.done;
    // Layout changes must not cause every artifact/project to reload its evidence.
    window.dispatchEvent(new Event(BACKUP_DATA_CHANGED_EVENT));
  } finally { db.close(); }
}
export async function diagramWithPresentation(artifactId, diagram) {
  return { ...diagram, presentation: await loadArchitecturePresentation(artifactId, diagram) };
}

export async function listArchitecturePresentations(artifactId) {
  const db = await openArtifactDatabase();
  try { return await db.getAllFromIndex('presentations', 'artifactId', artifactId); }
  finally { db.close(); }
}
