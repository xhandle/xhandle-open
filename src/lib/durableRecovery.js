import { captureHazardSnapshot } from './hazardMessageGraph';
import { recoveryRecord as localRecoveryRecord } from './recoveryDatabase';
import { canUseHazardStorageWorker, requestHazardStorage } from './hazardStorageClient';
export { openRecoveryDatabase } from './recoveryDatabase';

export function recoveryRecord(key, value, remove = false) {
  return canUseHazardStorageWorker()
    ? requestHazardStorage('recoveryRecord', [key, value, remove])
    : localRecoveryRecord(key, value, remove);
}

const queues = new Map();
const deletedKeys = new Set();
const failedSnapshots = new Map();
export function saveRecoveryRecord(key, value) {
  if (deletedKeys.has(key)) return Promise.reject(new Error('Project was deleted; checkpoint discarded.'));
  let state = queues.get(key);
  // Preserve shared workbook rows instead of expanding each Summary/HARA/method
  // alias into another complete JSON tree and allocating a giant JSON string.
  // Capture synchronously so edits after this call cannot change the checkpoint.
  // An immediate worker post already captures synchronously. Cloning before
  // that post would retain another full workbook on the renderer unnecessarily.
  // Pending replacements still need their own isolated snapshot until dispatched.
  const snapshot = canUseHazardStorageWorker() && !state?.running ? value
    : captureHazardSnapshot(value);
  if (!state) { state = { running: false, pending: null }; queues.set(key, state); }
  // One active snapshot and one latest pending snapshot per key. Superseded
  // callers share the promise for that latest replacement.
  if (state.pending) {
    state.pending.snapshot = snapshot;
    return state.pending.promise;
  }
  const pending = { snapshot };
  pending.promise = new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
  state.pending = pending;
  if (!state.running) {
    state.running = true;
    (async () => {
      while (state.pending) {
        const current = state.pending;
        state.active = current;
        state.pending = null;
        try { await recoveryRecord(key, current.snapshot); failedSnapshots.delete(key); current.resolve(); }
        catch (error) { failedSnapshots.set(key, current.snapshot); current.reject(error); }
      }
      queues.delete(key);
    })();
  }
  return pending.promise;
}

export function flushRecoveryRecord(key) {
  const state = queues.get(key);
  return state?.pending?.promise || state?.active?.promise || Promise.resolve();
}

export async function flushRecoveryRecordsBeforeUpdate() {
  while (queues.size) await Promise.allSettled([...queues.keys()].map(flushRecoveryRecord));
  for (const [key, snapshot] of [...failedSnapshots]) await saveRecoveryRecord(key, snapshot);
  if (failedSnapshots.size) throw new Error('Some recovery progress has not been saved.');
}

// Block late producers immediately, then drain any in-flight transaction before
// deleting. IDs are unique; a newly created project has a different identity.
export async function quiesceProjectRecovery(projectId) {
  const keys = ['decomposition', 'decomposition-candidate', 'hazard-run'].map(prefix => `${prefix}:${projectId}`);
  const newlyBlocked = keys.filter(key => !deletedKeys.has(key));
  keys.forEach(key => deletedKeys.add(key));
  keys.forEach(key => failedSnapshots.delete(key));
  await Promise.all(keys.map(async key => {
    try { await flushRecoveryRecord(key); } catch {}
  }));
  keys.forEach(key => failedSnapshots.delete(key));
  return () => newlyBlocked.forEach(key => deletedKeys.delete(key));
}

export async function deleteProjectRecovery(projectId) {
  await quiesceProjectRecovery(projectId);
  const keys = ['decomposition', 'decomposition-candidate', 'hazard-run'].map(prefix => `${prefix}:${projectId}`);
  await Promise.all(keys.map(key => recoveryRecord(key, undefined, true)));
}
