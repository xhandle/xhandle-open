import { openCbaIndexedDB, XHANDLE_IDB_NAME } from '../code-architecture-assurance/codeArchitectureStorage';
import { rawRecord, readRecord, writeRecord, isChunkedRecord } from '../code-architecture-storage/chunkedRecord';
import { notifyBackupDataChanged } from '../../lib/localBackupEvents';
import { throwIfAnalysisAborted, waitForAnalysisRetry } from './functionalAnalysisResponse';

// Safari and other browsers can abort an IndexedDB transaction independently
// of user cancellation. Retry a fresh transaction, with a finite allowance.
export async function retryAnalysisStorage(operation, { signal, onRetry, wait = waitForAnalysisRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    throwIfAnalysisAborted(signal);
    try { return await operation(); }
    catch (error) {
      throwIfAnalysisAborted(signal);
      if (error?.name !== 'AbortError' || attempt >= 2) throw error;
      onRetry?.('Browser storage interrupted a transaction; retrying the saved analysis…');
      await wait(100 * (attempt + 1), signal);
    }
  }
}
export async function writeAnalysisSourceRecord(store, key, value, options = {}) {
  let baseline, captured = false;
  return retryAnalysisStorage(async () => {
    const db = await openCbaIndexedDB({ signal: options.signal });
    try {
      if (!captured) {
        const before = await rawRecord(db, store, key, options);
        baseline = isChunkedRecord(before) ? before.root : JSON.stringify(before); captured = true;
      }
      // Retain the original baseline over retries. A competing edit must not
      // be silently overwritten merely because our first transaction aborted.
      await writeRecord(db, store, key, value, { signal:options.signal, expectedBaseline:baseline });
      notifyBackupDataChanged({ db:XHANDLE_IDB_NAME, stores:[store] });
    } finally { db.close(); }
  }, options);
}
export async function readAnalysisSourceRecord(store, key, options = {}) {
  return retryAnalysisStorage(async () => {
    const db = await openCbaIndexedDB({ signal:options.signal });
    try { return await readRecord(db, store, key, options); } finally { db.close(); }
  }, options);
}
export function analysisStorageError(cause, message) {
  if (['SOURCE_PUBLICATION_CONFLICT', 'SOURCE_STORAGE_FAILED'].includes(cause?.code)) return cause;
  // DOMException.code is read-only. Preserve the cause without mutating it.
  return Object.assign(new Error(`${message}: ${cause?.message || cause}`), { code:'SOURCE_STORAGE_FAILED', cause });
}
