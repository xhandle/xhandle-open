const DB_NAME = "xhandle-hazard-analysis-reset";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const FALLBACK_PREFIX = "xhandle.hazardAnalysisResetSnapshot:";

const fallbackKey = (projectId) => `${FALLBACK_PREFIX}${String(projectId || "").trim()}`;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "projectId" });
      }
    };
    request.onerror = () => reject(request.error || new Error("Unable to open hazard reset storage."));
    request.onsuccess = () => resolve(request.result);
  });
}

function writeFallback(record) {
  try {
    localStorage.setItem(fallbackKey(record.projectId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export async function saveHazardAnalysisResetSnapshot(projectId, snapshot) {
  const id = String(projectId || "").trim();
  if (!id) return false;
  const record = { projectId: id, createdAt: new Date().toISOString(), snapshot };
  if (typeof indexedDB === "undefined") return writeFallback(record);
  try {
    await new Promise((resolve, reject) => {
      openDatabase().then((db) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      }).catch(reject);
    });
    return true;
  } catch {
    return writeFallback(record);
  }
}

export async function loadHazardAnalysisResetSnapshot(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return null;
  if (typeof indexedDB !== "undefined") {
    try {
      const record = await new Promise((resolve, reject) => {
        openDatabase().then((db) => {
          const transaction = db.transaction(STORE_NAME, "readonly");
          const request = transaction.objectStore(STORE_NAME).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
          transaction.oncomplete = () => db.close();
        }).catch(reject);
      });
      if (record) return record;
    } catch {}
  }
  try {
    return JSON.parse(localStorage.getItem(fallbackKey(id)) || "null");
  } catch {
    return null;
  }
}

export async function deleteHazardAnalysisResetSnapshot(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return false;
  try { localStorage.removeItem(fallbackKey(id)); } catch {}
  if (typeof indexedDB === "undefined") return true;
  try {
    await new Promise((resolve, reject) => {
      openDatabase().then((db) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(id);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      }).catch(reject);
    });
    return true;
  } catch {
    return false;
  }
}

