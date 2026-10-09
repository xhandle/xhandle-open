import { notifyBackupDataChanged } from '../../lib/localBackupEvents';
import { readRecord, rawRecord, stageRecord, hydrateRecord, isChunkedRecord, isRecordPart, putRawRecord, transactionDone, writeRecord } from '../code-architecture-storage/chunkedRecord';
export const XHANDLE_IDB_NAME = 'xhandle';
export const XHANDLE_IDB_VERSION = 4;
export const XHANDLE_IDB_CBA_STORE = 'copilot_baseline';
export const codeArchitectureRowsKey = (projectId, repoId) => `cba:${projectId}:${repoId}`;
export const codeArchitectureMetaKey = (projectId, repoId) => `cbaMeta:${projectId}:${repoId}`;
export function openCbaIndexedDB({ signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new Error('Storage operation cancelled.')); return; }
    const request = indexedDB.open(XHANDLE_IDB_NAME, XHANDLE_IDB_VERSION);
    const aborted = () => reject(signal.reason || new Error('Storage operation cancelled.'));
    signal?.addEventListener('abort', aborted, { once: true });
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of ['code_index', 'copilot_baseline', 'diagram_positions']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, {keyPath:'key'});
    };
    request.onblocked = () => { blocked = true; reject(new Error('Storage upgrade blocked. Close other xHandle tabs and retry.')); };
    request.onerror = () => { signal?.removeEventListener('abort', aborted); reject(request.error); };
    request.onsuccess = () => { signal?.removeEventListener('abort', aborted); if (blocked || signal?.aborted) request.result.close(); else resolve(request.result); };
  });
}
const changed = () => notifyBackupDataChanged({db:XHANDLE_IDB_NAME, stores:[XHANDLE_IDB_CBA_STORE]});
// Serialize mutations from this workspace before their first asynchronous read.
// A delayed open must not let an older payload choose a newer publication as its
// baseline. Different project/repository scopes remain independent.
const architectureWrites = new Map();
function queueArchitectureWrite(scope, operation) {
  const previous = architectureWrites.get(scope) || Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  architectureWrites.set(scope, settled);
  settled.then(() => { if (architectureWrites.get(scope) === settled) architectureWrites.delete(scope); });
  return result;
}
export async function flushArchitectureWrites(scope) {
  while (architectureWrites.has(scope)) await architectureWrites.get(scope);
}

export async function readCbaRowsFromIndexedDB(key, options) {
  if (!key || typeof indexedDB === 'undefined') return [];
  const db = await openCbaIndexedDB();
  try { const value = await readRecord(db, XHANDLE_IDB_CBA_STORE, key, options); return Array.isArray(value) ? value : []; }
  finally { db.close(); }
}
export async function readFirstCbaRowsFromIndexedDB(keys = [], { onProgress } = {}) {
  const unique = [...new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))];
  let reported = 0;
  const report = value => { reported = Math.max(reported, value); onProgress?.(reported); };
  onProgress?.(0);
  if (typeof indexedDB === 'undefined') { report(100); return { key: unique[0] || '', rows: [] }; }
  const db = await openCbaIndexedDB();
  try {
    for (const key of unique) {
      const value = await rawRecord(db, XHANDLE_IDB_CBA_STORE, key);
      if (!isChunkedRecord(value) && !Array.isArray(value)) continue;
      // These keys are alternative locations, not three equal parts of a load.
      // Give the actual record the full progress range, regardless of aliases.
      const rows = await hydrateRecord(db, XHANDLE_IDB_CBA_STORE, value, { onProgress: percent => report(Math.min(99, percent)) });
      if (Array.isArray(rows)) { report(100); return {key, rows, found:true}; }
    }
  } finally {
    db.close();
  }
  report(100);
  return {key:unique[0] || '', rows:[], found:false};
}
export async function readCbaRowsRevision(key) {
  const db = await openCbaIndexedDB();
  try { const value = await rawRecord(db, XHANDLE_IDB_CBA_STORE, key); return isChunkedRecord(value) ? value.root : JSON.stringify(value); }
  finally { db.close(); }
}
async function writeCbaRowsToIndexedDBNow(key, rows, options) {
  if (!key || typeof indexedDB === 'undefined') return false;
  const db = await openCbaIndexedDB();
  try { await writeRecord(db, XHANDLE_IDB_CBA_STORE, key, Array.isArray(rows) ? rows : [], options); changed(); return true; }
  catch { return false; } finally { db.close(); }
}
export async function readArchitectureRunRecords(key, rows = []) {
  const db = await openCbaIndexedDB();
  try {
    const records = [];
    for (const fingerprint of new Set(rows.map(row => row.lineage?.runFingerprint).filter(Boolean))) {
      const record = await readRecord(db, XHANDLE_IDB_CBA_STORE, `${key}:run:${fingerprint}`);
      if (record) records.push(record);
    }
    return records;
  } finally { db.close(); }
}
async function writeImportedArchitectureRunRecordsNow(key, records = [], rows, { signal } = {}) {
  const db = await openCbaIndexedDB({ signal });
  try {
    const writes = [];
    for (const record of records.filter(r => r.version === 1 && /^[a-f0-9]{64}$/.test(r.fingerprint || ''))) {
      const recordKey = `${key}:run:${record.fingerprint}`;
      writes.push({key:recordKey, value:await stageRecord(db, XHANDLE_IDB_CBA_STORE, recordKey, {...record, originalScope:record.originalScope || record.scope, scope:key}, { signal })});
    }
    if (Array.isArray(rows)) writes.push({key, value:await stageRecord(db, XHANDLE_IDB_CBA_STORE, key, rows, { signal })});
    if (signal?.aborted) throw signal.reason || new Error('Import cancelled.');
    const tx = db.transaction(XHANDLE_IDB_CBA_STORE, 'readwrite'), done = transactionDone(tx);
    const abort = () => { try { tx.abort(); } catch {} };
    signal?.addEventListener('abort', abort, { once: true });
    done.finally(() => signal?.removeEventListener('abort', abort)).catch(() => {});
    try {for (const write of writes) tx.objectStore(XHANDLE_IDB_CBA_STORE).put(write);}
    catch(error) {tx.abort();await done.catch(()=>{});throw error;}
    await done; changed();
  } finally { db.close(); }
}
const revision = value => isChunkedRecord(value) ? value.root : JSON.stringify(value || []);
const pendingInMemory = new Map();

async function prepareArchitecturePublicationNow(key, rows, run, metadata, checkpointKey, previousRows, signal) {
  const db = await openCbaIndexedDB();
  const payload = {scope:key, rows, run, metadata, checkpointKey, previousRows};
  let durable = false;
  try {
    const current = await rawRecord(db, XHANDLE_IDB_CBA_STORE, key);
    // Compare the caller's snapshot before staging; repeat the revision check at commit.
    const expected = isChunkedRecord(current) ? await stageRecord(db, XHANDLE_IDB_CBA_STORE, key, previousRows, {signal}) : previousRows;
    payload.expected = revision(expected);
    let conflict = revision(current) !== payload.expected;
    if (conflict && isChunkedRecord(current)) {
      // Older encoders stored small objects as separate chunks. Re-encode both
      // snapshots with the current encoder before interpreting a root difference
      // as an edit. Keep the original root for the atomic commit-time guard.
      const hydrated = await hydrateRecord(db, XHANDLE_IDB_CBA_STORE, current);
      const comparable = await stageRecord(db, XHANDLE_IDB_CBA_STORE, key, hydrated, {signal});
      if (revision(comparable) === payload.expected) {
        payload.expected = revision(current);
        conflict = false;
      }
    }
    const rowRecord = await stageRecord(db, XHANDLE_IDB_CBA_STORE, key, rows, {signal});
    const runRecord = await stageRecord(db, XHANDLE_IDB_CBA_STORE, `${key}:run:${run.fingerprint}`, run, {signal});
    // The ready record references immutable chunks instead of copying the completed rows.
    const ready = {phase:'ready-to-publish', scope:key, checkpointKey, expected:payload.expected, rowRecord, runRecord, metadata,
      updatedAt:new Date().toISOString(), totalFiles:metadata.selectedFiles || 0};
    await putRawRecord(db, XHANDLE_IDB_CBA_STORE, checkpointKey, ready);
    durable = true;
    pendingInMemory.delete(checkpointKey);
    if (conflict) throw Object.assign(new Error('Architecture was edited during analysis. Completed results are saved in a checkpoint; current edits were preserved.'), {code:'SOURCE_PUBLICATION_CONFLICT'});
    return ready;
  } catch (error) {
    if (!durable && !signal?.aborted) pendingInMemory.set(checkpointKey, payload);
    throw error;
  } finally { db.close(); }
}

async function recoverArchitecturePublicationNow(scope, checkpointKey, signal) {
  if (!checkpointKey.startsWith(`functional-decomposition-checkpoint:${scope}:`)) throw new Error('Checkpoint does not belong to this project.');
  if (pendingInMemory.has(checkpointKey)) {
    const payload = pendingInMemory.get(checkpointKey);
    await prepareArchitecturePublicationNow(scope, payload.rows, payload.run, payload.metadata, checkpointKey, payload.previousRows, signal);
  }
  const db = await openCbaIndexedDB();
  try {
    const ready = await rawRecord(db, XHANDLE_IDB_CBA_STORE, checkpointKey);
    if (ready?.phase !== 'ready-to-publish' || ready.scope !== scope) throw new Error('No completed publication is available for this checkpoint.');
    const rows = await hydrateRecord(db, XHANDLE_IDB_CBA_STORE, ready.rowRecord);
    const run = await hydrateRecord(db, XHANDLE_IDB_CBA_STORE, ready.runRecord);
    // Validate all chunks before changing the active pointer. Retry only transient aborts.
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError');
      const tx = db.transaction(XHANDLE_IDB_CBA_STORE, 'readwrite'), store = tx.objectStore(XHANDLE_IDB_CBA_STORE);
      const done = transactionDone(tx); let failure;
      const stop = () => { try { tx.abort(); } catch {} };
      signal?.addEventListener('abort', stop, {once:true});
      const current = store.get(scope);
      current.onsuccess = () => {
        try {
          if (revision(current.result?.value) !== ready.expected) throw Object.assign(new Error('Architecture was edited before publication. Saved analysis is retained; current edits were not overwritten.'), {code:'SOURCE_PUBLICATION_CONFLICT'});
          const oldRun = store.get(`${scope}:run`);
          oldRun.onsuccess = () => {
            try {
            // Immutable pointer history reuses existing data; never duplicates the row array.
            if (current.result) store.put({key:`${scope}:history:${oldRun.result?.value?.root?.split(':$part:').pop() || 'legacy'}`,value:current.result.value});
            store.put({key:scope,value:ready.rowRecord});
            store.put({key:`${scope}:metadata`,value:{...ready.metadata,storageSaved:true,storageError:''}});
            store.put({key:`${scope}:run:${run.fingerprint}`,value:ready.runRecord});
            store.put({key:`${scope}:run`,value:ready.runRecord});
            store.delete(checkpointKey);
            } catch(error) {failure=error;stop();}
          };
        } catch (error) { failure=error; stop(); }
      };
      try { await done; break; }
      catch (error) {
        if (failure) throw failure;
        if (signal?.aborted || error?.name !== 'AbortError' || attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      } finally { signal?.removeEventListener('abort', stop); }
    }
    pendingInMemory.delete(checkpointKey); changed();
    return {rows, metadata:{...ready.metadata, storageSaved:true, storageError:''}};
  } finally { db.close(); }
}

export async function readArchitectureCheckpoint(key) {
  if (!String(key).startsWith('functional-decomposition-checkpoint:')) throw new Error('Invalid checkpoint.');
  if (pendingInMemory.has(key)) return {...pendingInMemory.get(key), phase:'ready-to-publish', durable:false};
  const db = await openCbaIndexedDB();
  try {
    const value = await readRecord(db, XHANDLE_IDB_CBA_STORE, key);
    if (value?.phase === 'ready-to-publish') return {...value, rows:await hydrateRecord(db,XHANDLE_IDB_CBA_STORE,value.rowRecord), run:await hydrateRecord(db,XHANDLE_IDB_CBA_STORE,value.runRecord)};
    return value;
  } finally { db.close(); }
}
export async function readLatestArchitectureCheckpoint(scope) {
  if (!scope) return null;
  const db = await openCbaIndexedDB();
  try {
    const keys = await new Promise((resolve,reject) => {
      const output=[], request=db.transaction(XHANDLE_IDB_CBA_STORE,'readonly').objectStore(XHANDLE_IDB_CBA_STORE).openKeyCursor(IDBKeyRange.bound(`functional-decomposition-checkpoint:${scope}:`,`functional-decomposition-checkpoint:${scope}:\uffff`));
      request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(output);return;}if(!isRecordPart(cursor.key))output.push(cursor.key);cursor.continue();};
      request.onerror=()=>reject(request.error);
    });
    for (const [key,value] of pendingInMemory) if(value.scope===scope && !keys.includes(key))keys.push(key);
    let latest=null;
    const published=await readRecord(db,XHANDLE_IDB_CBA_STORE,`${scope}:run`);
    for (const key of keys) {
      const value=await readArchitectureCheckpoint(key);
      if (!value)continue;
      const completed=value.completedPaths?.length || (value.phase==='ready-to-publish' ? value.totalFiles || value.metadata?.selectedFiles || 0 : 0);
      const updatedAt=value.updatedAt || value.run?.publishedAt || '';
      if (value.phase!=='ready-to-publish' && (!completed && !value.failedFiles?.length))continue;
      if (published?.publishedAt && updatedAt<=published.publishedAt)continue;
      if (!latest || updatedAt>latest.updatedAt)latest={key,updatedAt,publicationReady:value.phase==='ready-to-publish',durable:value.durable!==false,completed,total:value.totalFiles || value.metadata?.selectedFiles || 0,failedFiles:value.failedFiles || [],rowCount:value.rows?.length || 0,rows:(value.rows || []).slice(0,50)};
    }
    return latest;
  } finally {db.close();}
}

export async function readArchitectureMetadata(scope) {
  const db=await openCbaIndexedDB();
  try {return await readRecord(db,XHANDLE_IDB_CBA_STORE,`${scope}:metadata`) || null;} finally {db.close();}
}

export function writeCbaRowsToIndexedDB(...args) {
  return queueArchitectureWrite(args[0], () => writeCbaRowsToIndexedDBNow(...args));
}

export function writeImportedArchitectureRunRecords(...args) {
  return queueArchitectureWrite(args[0], () => writeImportedArchitectureRunRecordsNow(...args));
}

export function prepareArchitecturePublication(...args) {
  return queueArchitectureWrite(args[0], () => prepareArchitecturePublicationNow(...args));
}

export function recoverArchitecturePublication(...args) {
  return queueArchitectureWrite(args[0], () => recoverArchitecturePublicationNow(...args));
}
