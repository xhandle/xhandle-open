import { assertStorageBudget, serializedBytes, ROW_HISTORY_BUDGET, SOURCE_INDEX_BUDGET } from '../code-architecture-context/codeAnalysisRun';
export const XHANDLE_IDB_NAME = "xhandle";
export const XHANDLE_IDB_VERSION = 4;
export const XHANDLE_IDB_CBA_STORE = "copilot_baseline";
const XHANDLE_IDB_CODE_INDEX_STORE = "code_index";
const XHANDLE_IDB_DIAGRAM_POSITIONS_STORE = "diagram_positions";

export const codeArchitectureRowsKey = (projectId, repoId) => `cba:${projectId}:${repoId}`;
export const codeArchitectureMetaKey = (projectId, repoId) => `cbaMeta:${projectId}:${repoId}`;

function openCbaIndexedDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(XHANDLE_IDB_NAME, XHANDLE_IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(XHANDLE_IDB_CODE_INDEX_STORE)) {
        db.createObjectStore(XHANDLE_IDB_CODE_INDEX_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(XHANDLE_IDB_CBA_STORE)) {
        db.createObjectStore(XHANDLE_IDB_CBA_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(XHANDLE_IDB_DIAGRAM_POSITIONS_STORE)) {
        db.createObjectStore(XHANDLE_IDB_DIAGRAM_POSITIONS_STORE, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB."));
    request.onsuccess = () => resolve(request.result);
  });
}

export function readCbaRowsFromIndexedDB(key) {
  if (typeof indexedDB === "undefined" || !key) return Promise.resolve([]);
  return new Promise((resolve) => {
    openCbaIndexedDB()
      .then((db) => {
        if (!db.objectStoreNames.contains(XHANDLE_IDB_CBA_STORE)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(XHANDLE_IDB_CBA_STORE, "readonly");
        const getRequest = tx.objectStore(XHANDLE_IDB_CBA_STORE).get(key);
        getRequest.onerror = () => resolve([]);
        getRequest.onsuccess = () => {
          const value = getRequest.result?.value;
          resolve(Array.isArray(value) ? value : []);
        };
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          try { db.close(); } catch {}
          resolve([]);
        };
      })
      .catch(() => resolve([]));
  });
}

export function readFirstCbaRowsFromIndexedDB(keys = []) {
  if (typeof indexedDB === "undefined") return Promise.resolve({ rows: [], key: "" });
  const uniqueKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys])
    .map((key) => String(key || "").trim())
    .filter(Boolean)));
  if (!uniqueKeys.length) return Promise.resolve({ rows: [], key: "" });

  return new Promise((resolve) => {
    openCbaIndexedDB()
      .then((db) => {
        if (!db.objectStoreNames.contains(XHANDLE_IDB_CBA_STORE)) {
          db.close();
          resolve({ rows: [], key: uniqueKeys[0] || "" });
          return;
        }

        const tx = db.transaction(XHANDLE_IDB_CBA_STORE, "readonly");
        const store = tx.objectStore(XHANDLE_IDB_CBA_STORE);
        const results = new Map();
        let settled = false;
        uniqueKeys.forEach((key) => {
          const getRequest = store.get(key);
          getRequest.onsuccess = () => {
            const value = getRequest.result?.value;
            results.set(key, Array.isArray(value) ? value : []);
          };
          getRequest.onerror = () => {
            results.set(key, []);
          };
        });

        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          db.close();
          const sourceKey = uniqueKeys.find((key) => (results.get(key) || []).length > 0) || uniqueKeys[0] || "";
          resolve({ rows: results.get(sourceKey) || [], key: sourceKey });
        };
        tx.onerror = () => {
          if (settled) return;
          settled = true;
          try { db.close(); } catch {}
          resolve({ rows: [], key: uniqueKeys[0] || "" });
        };
      })
      .catch(() => resolve({ rows: [], key: uniqueKeys[0] || "" }));
  });
}

export function writeCbaRowsToIndexedDB(key, rows) {
  if (typeof indexedDB === "undefined" || !key) return Promise.resolve(false);
  return new Promise((resolve) => {
    openCbaIndexedDB()
      .then((db) => {
        if (!db.objectStoreNames.contains(XHANDLE_IDB_CBA_STORE)) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(XHANDLE_IDB_CBA_STORE, "readwrite");
        tx.objectStore(XHANDLE_IDB_CBA_STORE).put({ key, value: Array.isArray(rows) ? rows : [] });
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          try { db.close(); } catch {}
          resolve(false);
        };
      })
      .catch(() => resolve(false));
  });
}

// Portable evidence is optional for old exports. Never include local handles or credentials.
export async function readArchitectureRunRecords(key, rows = []) {
  const db = await openCbaIndexedDB();
  const fingerprints = [...new Set(rows.map(row => row.lineage?.runFingerprint).filter(Boolean))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(XHANDLE_IDB_CBA_STORE, 'readonly'), store=tx.objectStore(XHANDLE_IDB_CBA_STORE);
    const records=[];
    fingerprints.forEach(fingerprint => {
      const request=store.get(`${key}:run:${fingerprint}`);
      request.onsuccess=()=>{ if(request.result?.value) records.push(request.result.value); };
    });
    tx.oncomplete=()=>resolve(records);tx.onerror=()=>reject(tx.error);
  }).finally(()=>db.close());
}

export async function writeImportedArchitectureRunRecords(key, records = [], rows) {
  const writes = records.filter(record => record.version === 1 && /^[a-f0-9]{64}$/.test(record.fingerprint || '')).map(record => ({
    key: `${key}:run:${record.fingerprint}`,
    value: {...record, originalScope: record.originalScope || record.scope, scope: key},
  }));
  if (Array.isArray(rows)) writes.push({key, value: rows});
  if (!writes.length) return;
  writes.forEach(record => assertStorageBudget(serializedBytes(record), ROW_HISTORY_BUDGET, 'Imported architecture record'));
  const replacementKeys = new Set(writes.map(record => record.key));
  const db = await openCbaIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(XHANDLE_IDB_CBA_STORE, 'readwrite');
    const store = tx.objectStore(XHANDLE_IDB_CBA_STORE);
    let failure, total = writes.reduce((sum, record) => sum + serializedBytes(record), 0);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if (!replacementKeys.has(cursor.key)) total += serializedBytes(cursor.value);
        cursor.continue();
        return;
      }
      try {
        assertStorageBudget(total, SOURCE_INDEX_BUDGET, 'Architecture history and checkpoints');
        // Rows and their portable run manifests become visible together.
        writes.forEach(record => store.put(record));
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('Architecture import aborted.'));
  }).finally(() => db.close());
}

export async function readLatestArchitectureCheckpoint(scope) {
  if (!scope) return null;
  const db = await openCbaIndexedDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(XHANDLE_IDB_CBA_STORE, 'readonly').objectStore(XHANDLE_IDB_CBA_STORE);
    let latest = null, publishedAt = '';
    const active = store.get(`${scope}:run`);
    active.onsuccess = () => { publishedAt = active.result?.value?.publishedAt || ''; };
    const prefix = `functional-decomposition-checkpoint:${scope}:`;
    const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(latest && (!publishedAt || latest.updatedAt > publishedAt) ? latest : null); return; }
      const value = cursor.value?.value;
      if (value?.failedFiles?.length && (!latest || (value.updatedAt || '') > latest.updatedAt)) {
        latest = {
          key: cursor.key, updatedAt: value.updatedAt || '',
          completed: value.completedPaths?.length || 0, total: value.totalFiles || 0,
          failedFiles: value.failedFiles, rowCount: value.rows?.length || 0,
          rows: (value.rows || []).slice(0, 50),
        };
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function readArchitectureCheckpoint(key) {
  if (!String(key).startsWith('functional-decomposition-checkpoint:')) throw new Error('Invalid checkpoint.');
  const db = await openCbaIndexedDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(XHANDLE_IDB_CBA_STORE, 'readonly').objectStore(XHANDLE_IDB_CBA_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}
