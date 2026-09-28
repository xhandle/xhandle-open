import { openDB } from 'idb';
import { notifyBackupDataChanged } from './localBackupEvents';

// Bound connection waits; a late connection must not run a timed-out write.
export function openRecoveryDatabase(name, version, options, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let expired = false;
    let connection;
    const timer = setTimeout(() => { expired = true; reject(new Error('Browser storage connection timed out.')); }, timeoutMs);
    Promise.resolve().then(() => openDB(name, version, {
      ...options,
      blocking() { connection?.close?.(); },
      blocked() { expired = true; clearTimeout(timer); reject(new Error('Browser storage is blocked by another tab. Close other xHandle tabs and retry.')); },
    })).then(db => {
      clearTimeout(timer);
      if (expired) { db?.close?.(); return; }
      connection = db;
      resolve(db);
    }, error => { clearTimeout(timer); reject(error); });
  });
}

export async function recoveryRecord(key, value, remove = false) {
  const db = await openRecoveryDatabase('xhandle-recovery', 1, {
    upgrade(database) { database.createObjectStore('checkpoints'); },
  });
  try {
    const tx = db.transaction('checkpoints', value === undefined && !remove ? 'readonly' : 'readwrite');
    tx.done.catch(() => {}); // Request failures can also reject the transaction.
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const result = remove ? await tx.store.delete(key) : value === undefined ? await tx.store.get(key) : await tx.store.put(value, key);
          await tx.done;
          if (value !== undefined) notifyBackupDataChanged({ database: 'xhandle-recovery', key });
          return result;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            try { tx.abort(); } catch {}
            reject(new Error('Browser storage operation timed out.'));
          }, 10000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  } finally { db.close?.(); }
}

const queues = new Map();
const deletedKeys = new Set();
export function saveRecoveryRecord(key, value) {
  if (deletedKeys.has(key)) return Promise.reject(new Error('Project was deleted; checkpoint discarded.'));
  const snapshot = JSON.parse(JSON.stringify(value));
  let state = queues.get(key);
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
        try { await recoveryRecord(key, current.snapshot); current.resolve(); }
        catch (error) { current.reject(error); }
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

// Block late producers immediately, then drain any in-flight transaction before
// deleting. IDs are unique; a newly created project has a different identity.
export async function deleteProjectRecovery(projectId) {
  const keys = ['decomposition', 'decomposition-candidate', 'hazard-run'].map(prefix => `${prefix}:${projectId}`);
  keys.forEach(key => deletedKeys.add(key));
  await Promise.all(keys.map(async key => {
    try { await flushRecoveryRecord(key); } catch {}
    await recoveryRecord(key, undefined, true);
  }));
}
