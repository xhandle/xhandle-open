import { openDB } from "idb";

const DB_NAME = "xhandle-code-architecture-hazard-analysis";
const DB_VERSION = 3;
const META_STORE = "runMetadata";
const CHECKPOINT_STORE = "generationCheckpoints";
const STORE_NAME = "hazardAnalysisRuns";
const LS_KEY = "xhandle:code-architecture-hazard-analysis:v1";

function emptyState() {
  return { hazardAnalysisRuns: [] };
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function emitChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent("xhandle:code-architecture-hazard-analysis:changed", { detail }));
    window.dispatchEvent(new CustomEvent("xhandle:data-changed", { detail: { key: LS_KEY, ...detail } }));
  } catch {}
}

export async function openCodeArchitectureHazardDB() {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("repoId", "repoId", { unique: false });
        store.createIndex("architectureSnapshotHash", "architectureSnapshotHash", { unique: false });
        store.createIndex("hazardMethod", "hazardMethod", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const meta = db.createObjectStore(META_STORE, { keyPath: "id" });
        meta.createIndex("projectId", "projectId");
        meta.createIndex("repoId", "repoId");
        // Upgrade existing records once, without materializing all run payloads.
        const copy = async () => {
          let cursor = await tx.objectStore(STORE_NAME).openCursor();
          while (cursor) {
            await meta.put(metadata(cursor.value));
            cursor = await cursor.continue();
          }
        };
        copy().catch(() => tx.abort());
      }
      if (!db.objectStoreNames.contains(CHECKPOINT_STORE)) {
        db.createObjectStore(CHECKPOINT_STORE, { keyPath: "id" }).createIndex("scope", "scope");
      }
    },
  });
  // Recover legacy fallback saves into the authoritative database once.
  const legacy = loadFallbackState().hazardAnalysisRuns || [];
  if (legacy.length) {
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    for (const run of legacy) {
      if (!run?.id) continue;
      const current = await tx.objectStore(META_STORE).get(run.id);
      if (!current || newestFirst(run, current) < 0) {
        await tx.objectStore(STORE_NAME).put(run);
        await tx.objectStore(META_STORE).put(metadata(run));
      }
    }
    await tx.done;
    localStorage.removeItem(LS_KEY);
  }
  return db;
}

function loadFallbackState() {
  if (typeof localStorage === "undefined") return emptyState();
  return { ...emptyState(), ...safeParse(localStorage.getItem(LS_KEY), emptyState()) };
}

function saveFallbackState(state) {
  if (typeof localStorage === "undefined") throw new Error("Browser storage is unavailable.");
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...emptyState(), ...state }));
  } catch (error) {
    console.warn("[code-architecture-hazard-analysis] localStorage save failed", error);
    throw error;
  }
}

function matchesFilters(run, filters = {}) {
  return Object.entries(filters).every(([key, value]) => {
    if (value == null || value === "") return true;
    return String(run?.[key] || "") === String(value);
  });
}

function metadata(run) {
  const { id, projectId, repoId, architectureSnapshotHash, hazardMethod, updatedAt, createdAt } = run;
  return { id, projectId, repoId, architectureSnapshotHash, hazardMethod, updatedAt, createdAt };
}
const newestFirst = (a, b) => (Date.parse(b.updatedAt || b.createdAt || 0) || 0) - (Date.parse(a.updatedAt || a.createdAt || 0) || 0);

async function matchingMetadata(db, filters) {
  const key = ['projectId', 'repoId'].find(name => filters[name] != null && filters[name] !== '');
  const rows = key ? await db.getAllFromIndex(META_STORE, key, filters[key]) : await db.getAll(META_STORE);
  return rows.filter(run => matchesFilters(run, filters)).sort(newestFirst);
}

export async function getCodeArchitectureHazardRuns(filters = {}) {
  const db = await openCodeArchitectureHazardDB();
  if (!db) return loadFallbackState().hazardAnalysisRuns.filter(run => matchesFilters(run, filters)).sort(newestFirst);
  const meta = await matchingMetadata(db, filters);
  return (await Promise.all(meta.map(run => db.get(STORE_NAME, run.id)))).filter(Boolean);
}

export async function getLatestCodeArchitectureHazardRun(filters = {}) {
  const db = await openCodeArchitectureHazardDB();
  if (!db) return (await getCodeArchitectureHazardRuns(filters))[0] || null;
  const latest = (await matchingMetadata(db, filters))[0];
  return latest ? (await db.get(STORE_NAME, latest.id)) || null : null;
}

export async function getCodeArchitectureHazardRunById(id) {
  if (!id) return null;
  const db = await openCodeArchitectureHazardDB();
  return db ? (await db.get(STORE_NAME, id)) || null : loadFallbackState().hazardAnalysisRuns.find(run => run.id === id) || null;
}

export async function saveCodeArchitectureHazardRun(run) {
  if (!run?.id) throw new Error("Cannot save code architecture hazard analysis without an id.");
  const db = await openCodeArchitectureHazardDB();
  if (db) {
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    await Promise.all([tx.objectStore(STORE_NAME).put(run), tx.objectStore(META_STORE).put(metadata(run)), tx.done]);
  } else {
    const rows = loadFallbackState().hazardAnalysisRuns;
    saveFallbackState({hazardAnalysisRuns: [...rows.filter(row => row.id !== run.id), run]});
  }
  // Do not silently switch storage backends after a failed IndexedDB write.
  emitChanged({storeName: STORE_NAME, projectId: run.projectId, repoId: run.repoId, runId: run.id});
  return run;
}

export async function deleteCodeArchitectureHazardRuns(filters = {}) {
  const db = await openCodeArchitectureHazardDB();
  if (!db) {
    const rows = loadFallbackState().hazardAnalysisRuns;
    const next = rows.filter(run => !matchesFilters(run, filters));
    saveFallbackState({hazardAnalysisRuns: next});
    emitChanged({...filters, storeName: STORE_NAME});
    return rows.length - next.length;
  }
  const tx = db.transaction([STORE_NAME, META_STORE, CHECKPOINT_STORE], 'readwrite');
  let count = 0;
  let cursor = await tx.objectStore(META_STORE).openCursor();
  while (cursor) {
    if (matchesFilters(cursor.value, filters)) {
      await tx.objectStore(STORE_NAME).delete(cursor.primaryKey);
      await cursor.delete();
      count++;
    }
    cursor = await cursor.continue();
  }
  let checkpoint = await tx.objectStore(CHECKPOINT_STORE).openCursor();
  while (checkpoint) {
    const scope = safeParse(checkpoint.value.scope, {});
    if (matchesFilters({...scope, hazardMethod: scope.method}, filters)) await checkpoint.delete();
    checkpoint = await checkpoint.continue();
  }
  await tx.done;
  emitChanged({...filters, storeName: STORE_NAME});
  return count;
}

export const codeArchitectureHazardStore = {
  getCodeArchitectureHazardRuns,
  getLatestCodeArchitectureHazardRun,
  getCodeArchitectureHazardRunById,
  saveCodeArchitectureHazardRun,
  deleteCodeArchitectureHazardRuns,
};

export { DB_NAME as CODE_ARCHITECTURE_HAZARD_DB_NAME, STORE_NAME as CODE_ARCHITECTURE_HAZARD_STORE_NAME };
