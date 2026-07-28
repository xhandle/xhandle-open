import { openDB } from "idb";

const DB_NAME = "xhandle-code-architecture-hazard-analysis";
const DB_VERSION = 2;
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

async function openCodeArchitectureHazardDB() {
  if (typeof indexedDB === "undefined") return null;
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("repoId", "repoId", { unique: false });
        store.createIndex("architectureSnapshotHash", "architectureSnapshotHash", { unique: false });
        store.createIndex("hazardMethod", "hazardMethod", { unique: false });
      }
    },
  });
}

function loadFallbackState() {
  if (typeof localStorage === "undefined") return emptyState();
  return { ...emptyState(), ...safeParse(localStorage.getItem(LS_KEY), emptyState()) };
}

function saveFallbackState(state) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...emptyState(), ...state }));
  } catch (error) {
    console.warn("[code-architecture-hazard-analysis] localStorage save failed", error);
  }
}

function matchesFilters(run, filters = {}) {
  return Object.entries(filters).every(([key, value]) => {
    if (value == null || value === "") return true;
    return String(run?.[key] || "") === String(value);
  });
}

async function readRuns() {
  try {
    const db = await openCodeArchitectureHazardDB();
    if (!db) return loadFallbackState().hazardAnalysisRuns || [];
    return await db.getAll(STORE_NAME);
  } catch (error) {
    console.warn("[code-architecture-hazard-analysis] IndexedDB read failed", error);
    return loadFallbackState().hazardAnalysisRuns || [];
  }
}

async function writeRuns(rows) {
  const state = { hazardAnalysisRuns: Array.isArray(rows) ? rows : [] };
  try {
    const db = await openCodeArchitectureHazardDB();
    if (db) {
      const tx = db.transaction(STORE_NAME, "readwrite");
      await tx.store.clear();
      await Promise.all(state.hazardAnalysisRuns.map((row) => tx.store.put(row)));
      await tx.done;
    } else {
      saveFallbackState(state);
    }
  } catch (error) {
    console.warn("[code-architecture-hazard-analysis] IndexedDB write failed; using localStorage fallback", error);
    saveFallbackState(state);
  }
  emitChanged({ storeName: STORE_NAME });
  return state.hazardAnalysisRuns;
}

export async function getCodeArchitectureHazardRuns(filters = {}) {
  const rows = await readRuns();
  return rows
    .filter((run) => matchesFilters(run, filters))
    .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || 0) || 0) - (Date.parse(a.updatedAt || a.createdAt || 0) || 0));
}

export async function getLatestCodeArchitectureHazardRun(filters = {}) {
  const rows = await getCodeArchitectureHazardRuns(filters);
  return rows[0] || null;
}

export async function getCodeArchitectureHazardRunById(id) {
  if (!id) return null;
  const rows = await readRuns();
  return rows.find((run) => run.id === id) || null;
}

export async function saveCodeArchitectureHazardRun(run) {
  if (!run?.id) throw new Error("Cannot save code architecture hazard analysis without an id.");
  const rows = await readRuns();
  const byId = new Map(rows.map((row) => [row.id, row]));
  byId.set(run.id, run);
  await writeRuns(Array.from(byId.values()));
  return run;
}

export async function deleteCodeArchitectureHazardRuns(filters = {}) {
  const rows = await readRuns();
  const next = rows.filter((run) => !matchesFilters(run, filters));
  await writeRuns(next);
  return rows.length - next.length;
}

export const codeArchitectureHazardStore = {
  getCodeArchitectureHazardRuns,
  getLatestCodeArchitectureHazardRun,
  getCodeArchitectureHazardRunById,
  saveCodeArchitectureHazardRun,
  deleteCodeArchitectureHazardRuns,
};

export { DB_NAME as CODE_ARCHITECTURE_HAZARD_DB_NAME, STORE_NAME as CODE_ARCHITECTURE_HAZARD_STORE_NAME };
