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
