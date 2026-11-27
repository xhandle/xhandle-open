import { openCodeArchitectureHazardDB, withHazardStorageCleanup } from './codeArchitectureHazardStore';
import { HAZARD_RESET_SNAPSHOTS as SNAPSHOTS, HAZARD_RESET_ENTRIES as ENTRIES, HAZARD_CHUNKS, HAZARD_STAGING, newHazardStorageRevision } from './hazardSchema';
import { revokeHazardSaveAttempts, restoreHazardSaveAttempts } from './hazardSaveAttempt';
import { deleteWorkingSets } from './hazardWorkingSetCache';
import { PAGED_HAZARD } from './hazardRowIndex';
import { validateHazardDescriptor, hazardChunkDigest } from './hazardRunChunks';

const RUNS = 'hazardAnalysisRuns', META = 'runMetadata', CHECKPOINTS = 'generationCheckpoints';
const stores = [RUNS, META, CHECKPOINTS, HAZARD_CHUNKS, HAZARD_STAGING, SNAPSHOTS, ENTRIES];
const identity = ({ projectId, repoId }) => {
  if (!projectId || !repoId) throw new Error('Select a code architecture project and repository before clearing results.');
  return JSON.stringify([projectId, repoId]);
};
const matches = (value, scope) => value.projectId === scope.projectId && value.repoId === scope.repoId;
function notify(scope) {
  window.dispatchEvent(new CustomEvent('xhandle:code-architecture-hazard-analysis:changed', { detail: scope }));
  window.dispatchEvent(new CustomEvent('xhandle:data-changed', { detail: { ...scope, key: 'code-architecture-hazard-reset' } }));
}
async function database() {
  const db = await openCodeArchitectureHazardDB();
  if (!db) throw new Error('Recovery snapshot storage is unavailable. No analysis was cleared.');
  return db;
}
export async function readCodeHazardReset(scope) {
  const id = identity(scope), db = await database();
  try {
    const record = await db.get(SNAPSHOTS, id);
    if (!record) return null;
    const { reviewItems, ...metadata } = record;
    return { ...metadata, reviewCount: reviewItems.length };
  } finally { db.close(); }
}
export function codeHazardResetCounts(run, contexts, reviewItems) {
  return {
    rawRows: run?.[PAGED_HAZARD]?.total ?? Math.max(0, (run?.generatedSheets?.Summary?.length || 1) - 1),
    draftRows: Object.keys(run?.userPreprocessing || {}).length,
    safetyIssues: run?.riskRegister?.length || run?.safetyIssues?.length || 0,
    reports: run?.reports?.length || 0, reviewItems, contexts: contexts.length,
  };
}
export async function clearCodeHazardAnalysis({ projectId, repoId, expectedRunId, expectedRevision,
  contexts = [], reviewItems = [], resetScope = 'results', contextRepoId = repoId } = {}) {
  const scope = { projectId, repoId }, id = identity(scope);
  if (!['results', 'results-and-contexts'].includes(resetScope)) throw new Error('Choose a valid reset scope.');
  return withHazardStorageCleanup(projectId, repoId, async () => {
    const db = await database();
    const tx = db.transaction(stores, 'readwrite');
    tx.done.catch(() => {});
    try {
      const metadata = (await tx.objectStore(META).index('projectId').getAll(projectId)).filter(value => matches(value, scope));
      const latest = [...metadata].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
      if (!latest || latest.id !== expectedRunId || (expectedRevision && latest.storageRevision !== expectedRevision)) {
        throw new Error('The saved analysis changed. Reopen the clear-analysis dialog.');
      }
      const ids = new Set(metadata.map(value => value.id));
      let old = await tx.objectStore(ENTRIES).index('snapshotId').openCursor(id);
      while (old) { await old.delete(); old = await old.continue(); }
      const snapshot = { id, ...scope, createdAt: new Date().toISOString(), contexts, contextRepoId, reviewItems, resetScope, runCount: ids.size };
      const expectedChunks = new Map(), copiedChunks = new Map();
      // Copy unchanged storage records, one chunk at a time. Large analyses
      // never need to be hydrated or JSON-stringified in the renderer to clear.
      for (const name of [RUNS, META, CHECKPOINTS, HAZARD_CHUNKS, HAZARD_STAGING]) {
        let cursor = await tx.objectStore(name).openCursor();
        while (cursor) {
          const value = cursor.value;
          let selected = name === RUNS || name === META ? ids.has(value.id)
            : name === CHECKPOINTS ? false : ids.has(value.runId);
          if (name === CHECKPOINTS) { try { selected = matches(JSON.parse(value.scope), scope); } catch {} }
          if (selected) {
            if (name === RUNS && value.payload) {
              const descriptor = validateHazardDescriptor(value);
              expectedChunks.set(descriptor.generation, descriptor.count);
            }
            if (name === HAZARD_CHUNKS && expectedChunks.has(value.generation)) {
              if (value.digest !== hazardChunkDigest(value.tokens)) throw new Error('A saved results chunk is damaged. No analysis was cleared.');
              copiedChunks.set(value.generation, (copiedChunks.get(value.generation) || 0) + 1);
            }
            await tx.objectStore(ENTRIES).put({ id: JSON.stringify([id, name, cursor.primaryKey]), snapshotId: id, store: name, key: cursor.primaryKey, value });
            await cursor.delete();
          }
          cursor = await cursor.continue();
        }
      }
      for (const [generation, count] of expectedChunks) if (copiedChunks.get(generation) !== count) {
        throw new Error('The saved analysis has missing chunks. A complete recovery snapshot could not be saved.');
      }
      await tx.objectStore(SNAPSHOTS).put(snapshot);
      await tx.done;
      revokeHazardSaveAttempts(scope);
      await deleteWorkingSets(ids).catch(() => {});
      notify(scope);
      return snapshot;
    } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
    finally { db.close(); }
  });
}
export async function restoreCodeHazardAnalysis(scope) {
  const id = identity(scope);
  return withHazardStorageCleanup(scope.projectId, scope.repoId, async () => {
    const db = await database(), tx = db.transaction(stores, 'readwrite');
    tx.done.catch(() => {});
    try {
      const snapshot = await tx.objectStore(SNAPSHOTS).get(id);
      if (!snapshot) throw new Error('The recovery snapshot is no longer available.');
      const current = (await tx.objectStore(META).index('projectId').getAll(scope.projectId)).filter(value => matches(value, scope));
      if (current.length) {
        if (current.length === snapshot.runCount && current.every(run => snapshot.restoredRevisions?.[run.id] === run.storageRevision)) {
          await tx.done;
          return snapshot; // Retry auxiliary review/context restoration safely.
        }
        throw new Error('New hazard results exist. Export or clear them before restoring the previous analysis.');
      }
      const restored = [];
      let cursor = await tx.objectStore(ENTRIES).index('snapshotId').openCursor(id);
      while (cursor) {
        const entry = cursor.value;
        const value = entry.store === META ? { ...entry.value, storageRevision: newHazardStorageRevision() } : entry.value;
        await tx.objectStore(entry.store).put(value);
        if (entry.store === META) restored.push(value);
        cursor = await cursor.continue();
      }
      if (restored.length !== snapshot.runCount) throw new Error('The recovery snapshot is incomplete; no changes were restored.');
      for (const run of restored) {
        const root = await tx.objectStore(RUNS).get(run.id);
        if (!root) throw new Error('The recovery snapshot is missing its analysis.');
        if (root.payload) {
          const descriptor = validateHazardDescriptor(root);
          const count = await tx.objectStore(HAZARD_CHUNKS).count(IDBKeyRange.bound(descriptor.generation + ':', descriptor.generation + ':\uffff'));
          if (count !== descriptor.count) throw new Error('The recovery snapshot has missing chunks; no changes were restored.');
        }
      }
      snapshot.restoredRevisions = Object.fromEntries(restored.map(run => [run.id, run.storageRevision]));
      await tx.objectStore(SNAPSHOTS).put(snapshot);
      await tx.done;
      restoreHazardSaveAttempts(restored);
      notify(scope);
      return snapshot;
    } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
    finally { db.close(); }
  });
}
