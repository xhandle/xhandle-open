import { openWorkspaceGraphDB } from '../features/workspace-graph/workspaceGraphDb';
import { withWorkspaceGraphMigrationPaused } from '../features/workspace-graph/legacyWorkspaceGraphMigrator';

// Use the existing retained project store, independently of optional indexing.
// Commit the snapshot before changing either React state or the active registry.
async function openRetentionDatabase() {
  let expired = false;
  let timer;
  const pending = openWorkspaceGraphDB().then(db => {
    if (expired) { db.close(); throw new Error('Project snapshot storage open expired. Retry removal.'); }
    return db;
  });
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('Project snapshot storage timed out. Close other tabs and retry removal.')); }, 10000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function retainWorkspaceProject(project, storageKey) {
  if (!project || !['string', 'number'].includes(typeof project.id) || String(project.id) === '' ||
      (typeof project.id === 'number' && !Number.isFinite(project.id)) ||
      !['xhandle.projects', 'xhandle.codeArchitectureProjects'].includes(storageKey)) throw new Error('Invalid project snapshot.');
  const snapshot = JSON.parse(JSON.stringify(project));
  return withWorkspaceGraphMigrationPaused(async () => {
    const db = await openRetentionDatabase();
    let timer;
    try {
      const tx = db.transaction('projects', 'readwrite');
      timer = setTimeout(() => { try { tx.abort(); } catch {} }, 10000);
      const done = tx.done;
      // Observe transaction aborts even when a request or validation fails first.
      done.catch(() => {});
      const textId = String(snapshot.id);
      const stringRecord = await tx.store.get(textId);
      const numericRecord = String(Number(textId)) === textId ? await tx.store.get(Number(textId)) : null;
      const existing = stringRecord || numericRecord;
      const sourceStore = `localStorage:${storageKey}`;
      if ([stringRecord, numericRecord].some(record => record && record.sourceStore !== sourceStore)) {
        throw new Error('A different workspace owns this retained project ID. Removal was cancelled.');
      }
      const now = new Date().toISOString();
      await tx.store.put({ ...existing, id: existing?.id ?? String(snapshot.id), projectId: String(snapshot.id),
        name: snapshot.name, sourceStore, sourceKey: storageKey, sourceId: String(snapshot.id),
        sourceData: snapshot, createdAt: snapshot.createdAt || now, updatedAt: now, version: 1 });
      await done;
    } finally { clearTimeout(timer); db.close(); }
  }, 10000);
}

// Call synchronously after retention, before publishing removal to React.
export function persistWorkspaceProjectRemoval(project, current, storageKey, storage = localStorage) {
  if (current.find(entry => entry.id === project.id) !== project) {
    throw new Error('Project changed while its snapshot was being saved. It was kept active; retry removal.');
  }
  const remaining = current.filter(entry => entry.id !== project.id);
  storage.setItem(storageKey, JSON.stringify(remaining));
  return remaining;
}
