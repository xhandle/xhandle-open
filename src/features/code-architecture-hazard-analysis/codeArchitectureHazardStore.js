import { HAZARD_CHUNKS, stageHazardRun, hydrateHazardRun, isChunkedHazardRun, removeHazardGeneration, publishHazardRun } from './hazardRunChunks';
import {isCurrentHazardSaveAttempt,revokeHazardSaveAttempts} from './hazardSaveAttempt';
import { openHazardSchema, hazardMetadata, HAZARD_STAGING } from './hazardSchema';

const DB_NAME = "xhandle-code-architecture-hazard-analysis";
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
  const db = await openHazardSchema();
  // Recover legacy fallback saves into the authoritative database once.
  const legacy = loadFallbackState().hazardAnalysisRuns || [];
  if (legacy.length) {
    for (const run of legacy) {
      if (!run?.id) continue;
      const current = await db.get(META_STORE,run.id);
      if (!current || newestFirst(run, current) < 0) {
        const stored=await stageHazardRun(db,run);
        await publishHazardRun(db,stored,metadata(run),()=>{},current);
      }
    }
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

const metadata = hazardMetadata;
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
    else { for(const meta of await matchingMetadata(db,filters)){const run=await hydrateHazardRun(db,await db.get(STORE_NAME,meta.id));if(run)saved.push(run);} }
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
    return latest?(await hydrateHazardRun(db,await db.get(STORE_NAME,latest.id))) || null:memory || null;
  }catch(error){if(memory)return memory;throw error;}
}

export async function getCodeArchitectureHazardRunById(id) {
  if (!id) return null;
  if(unsavedRuns.has(id))return unsavedRuns.get(id);
  const db = await openCodeArchitectureHazardDB();
  return db ? (await hydrateHazardRun(db,await db.get(STORE_NAME, id))) || null : loadFallbackState().hazardAnalysisRuns.find(run => run.id === id) || null;
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
        let tx,db,staged;
        try {
          db = await openCodeArchitectureHazardDB();
          checkDeleted();
          if (db) {
            staged=await stageHazardRun(db,persisted,checkDeleted);
            checkDeleted();
            await publishHazardRun(db,staged,metadata(persisted),checkDeleted);
          } else {
            const rows = loadFallbackState().hazardAnalysisRuns;
            saveFallbackState({hazardAnalysisRuns:[...rows.filter(row => row.id !== run.id), persisted]});
          }
          break;
        } catch (error) {
          // Wait for transaction retirement before opening another writer.
          try { tx?.abort(); } catch {}
          if (tx) await tx.done.catch(() => {});
          if(isChunkedHazardRun(staged))await removeHazardGeneration(db,staged.payload.generation).catch(()=>{});
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
  const tx = db.transaction([STORE_NAME, META_STORE, CHECKPOINT_STORE, HAZARD_CHUNKS, HAZARD_STAGING], 'readwrite');
  let count = 0;
  const deletedRunIds = new Set();
  let cursor = await tx.objectStore(META_STORE).openCursor();
  while (cursor) {
    if (matchesFilters(cursor.value, filters)) {
      deletedRunIds.add(cursor.primaryKey);
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
  let part=await tx.objectStore(HAZARD_CHUNKS).openCursor();
  while(part){if(deletedRunIds.has(part.value.runId))await part.delete();part=await part.continue();}
  let lease=await tx.objectStore(HAZARD_STAGING).openCursor();
  while(lease){
    if(matchesFilters({...lease.value,id:lease.value.runId},filters)){
      await tx.objectStore(HAZARD_CHUNKS).delete(IDBKeyRange.bound(lease.value.id+':',lease.value.id+':\uffff'));await lease.delete();
    }
    lease=await lease.continue();
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
