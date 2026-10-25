import {isCurrentHazardSaveAttempt,revokeHazardSaveAttempts} from './hazardSaveAttempt';
import { openDB } from "idb";

const DB_NAME = "xhandle-code-architecture-hazard-analysis";
const DB_VERSION = 3;
const META_STORE = "runMetadata";
const CHECKPOINT_STORE = "generationCheckpoints";
const STORE_NAME = "hazardAnalysisRuns";
const unsavedRuns = new Map();
if(typeof window!=='undefined')window.addEventListener('beforeunload',event=>{
  if(unsavedRuns.size){event.preventDefault();event.returnValue='';}
});
const memoryMatches=filters=>[...unsavedRuns.values()].filter(run=>matchesFilters(run,filters)).sort(newestFirst);
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
  const memory=memoryMatches(filters);let saved=[];
  try{
    const db=await openCodeArchitectureHazardDB();
    if(!db)saved=loadFallbackState().hazardAnalysisRuns.filter(run=>matchesFilters(run,filters));
    else saved=(await Promise.all((await matchingMetadata(db,filters)).map(run=>db.get(STORE_NAME,run.id)))).filter(Boolean);
  }catch(error){if(!memory.length)throw error;}
  return [...new Map([...saved,...memory].map(run=>[run.id,run])).values()].sort(newestFirst);
}

export async function getLatestCodeArchitectureHazardRun(filters = {}) {
  const memory=memoryMatches(filters)[0];
  try{
    const db=await openCodeArchitectureHazardDB();
    if(!db)return (await getCodeArchitectureHazardRuns(filters))[0] || null;
    const latest=(await matchingMetadata(db,filters))[0];
    if(memory && (!latest || memory.id===latest.id || newestFirst(memory,latest)<=0))return memory;
    return latest?(await db.get(STORE_NAME,latest.id)) || null:memory || null;
  }catch(error){if(memory)return memory;throw error;}
}

export async function getCodeArchitectureHazardRunById(id) {
  if (!id) return null;
  if(unsavedRuns.has(id))return unsavedRuns.get(id);
  const db = await openCodeArchitectureHazardDB();
  return db ? (await db.get(STORE_NAME, id)) || null : loadFallbackState().hazardAnalysisRuns.find(run => run.id === id) || null;
}

// One queue per record prevents slow or retried writes overtaking newer saves.
const saveQueues = new Map();
const saveOwners = new Map();
const saveEpochs = new Map();
function publishSaveState(run) {
  try { window.dispatchEvent(new CustomEvent('xhandle:hazard-save-state', {detail:{run}})); } catch {}
}
const transientSaveError = error => ['AbortError', 'TransactionInactiveError', 'InvalidStateError', 'UnknownError'].includes(error?.name);
export async function saveCodeArchitectureHazardRun(run, { notify = true, onSaveState = () => {} } = {}) {
  if (!run?.id) throw new Error("Cannot save code architecture hazard analysis without an id.");
  const checkAttempt = () => {
    if (!isCurrentHazardSaveAttempt(run)) throw Object.assign(new Error('Hazard save superseded by a newer analysis attempt.'), {name:'AbortError', code:'HAZARD_SAVE_SUPERSEDED'});
  };
  checkAttempt();
  const owner = {};
  const epoch = saveEpochs.get(run.id) || 0;
  const checkDeleted = () => {
    checkAttempt();
    if ((saveEpochs.get(run.id) || 0) !== epoch) throw Object.assign(new Error('Hazard save canceled because the results were deleted.'), {name:'AbortError', code:'HAZARD_SAVE_DELETED'});
  };
  saveOwners.set(run.id, owner);
  const current = () => saveOwners.get(run.id) === owner && isCurrentHazardSaveAttempt(run);
  const state = (status, message = '') => {
    if (!current()) return;
    unsavedRuns.set(run.id, {...run, finalSavePending:true, finalSaveStatus:status, saveFailureMessage:message});
    publishSaveState(unsavedRuns.get(run.id));
    try { onSaveState({status, message}); } catch {}
  };
  const previous = saveQueues.get(run.id);
  const work = (async () => {
    await previous?.catch(() => {});
    checkDeleted();
    const persisted = {...run, finalSavePending:false, finalSaveStatus:'saved', saveFailureMessage:''};
    const slow = setTimeout(() => state('slow'), 5000);
    try {
      for (let attempt = 0; ; attempt++) {
        let tx;
        try {
          const db = await openCodeArchitectureHazardDB();
          checkDeleted();
          if (db) {
            tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
            await Promise.all([tx.objectStore(STORE_NAME).put(persisted), tx.objectStore(META_STORE).put(metadata(persisted)), tx.done]);
          } else {
            const rows = loadFallbackState().hazardAnalysisRuns;
            saveFallbackState({hazardAnalysisRuns:[...rows.filter(row => row.id !== run.id), persisted]});
          }
          break;
        } catch (error) {
          // Wait for transaction retirement before opening another writer.
          try { tx?.abort(); } catch {}
          if (tx) await tx.done.catch(() => {});
          checkDeleted();
          console.warn('[hazard-final-save]', {event:'failed-attempt', attempt:attempt+1, errorName:error?.name, message:error?.message});
          if (error.code === 'HAZARD_SAVE_DELETED' || !transientSaveError(error) || attempt >= 2) throw error;
          state('retrying', error.message);
          await new Promise(resolve => setTimeout(resolve, [1000, 3000][attempt]));
          checkDeleted();
          state('saving');
        }
      }
      checkDeleted();
      if (current()) {
        unsavedRuns.delete(run.id);
        publishSaveState(persisted);
        try { onSaveState({status:'saved', message:''}); } catch {}
        if (notify) emitChanged({storeName:STORE_NAME, projectId:run.projectId, repoId:run.repoId, runId:run.id});
      }
      return run;
    } catch (error) {
      state('failed', error.message || String(error));
      throw error;
    } finally {
      clearTimeout(slow);
    }
  })();
  saveQueues.set(run.id, work);
  // Reserve the queue slot before synchronous events or callbacks can enqueue
  // another revision. Work yields above before opening storage.
  state('saving'); // Protect results from reload while queued or writing, too.
  try { return await work; }
  finally {
    if (saveQueues.get(run.id) === work) saveQueues.delete(run.id);
    if (current()) saveOwners.delete(run.id);
  }
}

export async function deleteCodeArchitectureHazardRuns(filters = {}) {
  revokeHazardSaveAttempts(filters);
  for(const run of memoryMatches(filters)){saveEpochs.set(run.id,(saveEpochs.get(run.id) || 0)+1);saveOwners.delete(run.id);unsavedRuns.delete(run.id);}
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

export function assertProjectHazardsSaved(projectId) {
  if (memoryMatches({projectId}).length) throw new Error('Some hazard results have not been saved. Retry saving before exporting this project.');
}
