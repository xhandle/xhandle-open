const DB_NAME = "xhandle-project-reports";
const DB_VERSION = 1;
const STORE_NAME = "safetyIssueReports";
const FALLBACK_KEY_PREFIX = "xhandle.safetyIssueReport:";

const fallbackKey = (projectId) => `${FALLBACK_KEY_PREFIX}${String(projectId || "").trim()}`;

function openReportDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "projectId" });
      }
    };
    request.onerror = () => reject(request.error || new Error("Unable to open safety issue report storage."));
    request.onsuccess = () => resolve(request.result);
  });
}

function readFallback(projectId) {
  try {
    const raw = localStorage.getItem(fallbackKey(projectId));
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? { projectId, markdown: String(parsed.markdown || ""), updatedAt: parsed.updatedAt || null }
      : null;
  } catch {
    return null;
  }
}

function writeFallback(record) {
  try {
    localStorage.setItem(fallbackKey(record.projectId), JSON.stringify(record));
    return true;
  } catch (error) {
    console.error("[safety-issue-reports] Unable to persist report fallback", error);
    return false;
  }
}

export async function loadSafetyIssueReportRecord(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return null;
  if (typeof indexedDB === "undefined") return readFallback(id);
  try {
    const record = await new Promise((resolve, reject) => {
      openReportDatabase()
        .then((db) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("Unable to read the safety issue report."));
          tx.oncomplete = () => db.close();
          tx.onerror = () => {
            try { db.close(); } catch {}
          };
        })
        .catch(reject);
    });
    return record && typeof record === "object"
      ? { ...record, projectId: id, markdown: String(record.markdown || "") }
      : readFallback(id);
  } catch (error) {
    console.warn("[safety-issue-reports] IndexedDB read failed; using localStorage fallback", error);
    return readFallback(id);
  }
}

export async function saveSafetyIssueReportRecord(projectId, markdown) {
  const id = String(projectId || "").trim();
  if (!id) return false;
  const record = {
    projectId: id,
    markdown: String(markdown || ""),
    updatedAt: new Date().toISOString(),
  };
  if (typeof indexedDB === "undefined") return writeFallback(record);
  try {
    await new Promise((resolve, reject) => {
      openReportDatabase()
        .then((db) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put(record);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            try { db.close(); } catch {}
            reject(tx.error || new Error("Unable to write the safety issue report."));
          };
          tx.onabort = () => {
            try { db.close(); } catch {}
            reject(tx.error || new Error("Safety issue report write was aborted."));
          };
        })
        .catch(reject);
    });
    return true;
  } catch (error) {
    console.warn("[safety-issue-reports] IndexedDB write failed; using localStorage fallback", error);
    return writeFallback(record);
  }
}

export const SAFETY_ISSUE_REPORT_DB_CONFIG = {
  name: DB_NAME,
  version: DB_VERSION,
  storeName: STORE_NAME,
};
