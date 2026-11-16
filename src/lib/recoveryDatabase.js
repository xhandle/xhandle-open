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

