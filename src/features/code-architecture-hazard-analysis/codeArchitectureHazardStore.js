import {sha256} from 'hash.js';
import {hazardChunkKey,hazardChunkDigest} from './hazardRunChunks';
import {PAGED_HAZARD,validateHazardRowIndex} from './hazardRowIndex';
import { WORKING_SET, compactHazardRun, restoreDeferredHazardFields } from './hazardWorkingSet';
import {validateHazardTableIndex} from './hazardTableIndex';
import {deleteWorkingSets} from './hazardWorkingSetCache';
import { beginHazardLoadDiagnostic } from './hazardLoadDiagnostics';
import { readHazardTransaction } from './readHazardTransaction';
import { HAZARD_CHUNKS, stageHazardRun, hydrateHazardRun, isChunkedHazardRun, removeHazardGeneration, publishHazardRun } from './hazardRunChunks';
import {isCurrentHazardSaveAttempt,revokeHazardSaveAttempts} from './hazardSaveAttempt';
import { openHazardSchema, hazardMetadata, newHazardStorageRevision, HAZARD_STAGING } from './hazardSchema';

const DB_NAME = "xhandle-code-architecture-hazard-analysis";
const META_STORE = "runMetadata";
const CHECKPOINT_STORE = "generationCheckpoints";
const STORE_NAME = "hazardAnalysisRuns";
// Enumerable symbol survives edit spreads but is never serialized into storage.
export const HAZARD_EDIT_REVISION = Symbol("hazardEditRevision");
const unsavedRuns = new Map();
// Weak keys do not keep previously viewed runs alive. Only objects returned by
// this reader can be reused; edited/spread objects must be revalidated normally.
const loadedRevisions = new WeakMap();
async function latestRevision(db, filters, options) {
  try { return await readHazardTransaction(db, META_STORE, async store => {
    const key = ['projectId', 'repoId'].find(name => filters[name] != null && filters[name] !== '');
    const rows = key ? await store.index(key).getAll(filters[key]) : await store.getAll();
    const latest = rows.filter(run => matchesFilters(run, filters)).sort(newestFirst)[0];
    // Assign a revision to legacy metadata without reading the analysis payload.
    if (latest && !latest.storageRevision) {
      latest.storageRevision = newHazardStorageRevision();
      await store.put(latest);
    }
    return latest;
  }, {...options, mode: 'readwrite'});
  } catch (error) {
    // A full disk must not prevent reading previously saved legacy results.
    if (error?.name !== 'QuotaExceededError') throw error;
    return (await matchingMetadata(db, filters, options))[0];
  }
}
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

export async function openCodeArchitectureHazardDB(options = {}) {
  if (typeof indexedDB === "undefined") return null;
  const db = await openHazardSchema(options);
  try {
  checkRead(options.signal);
  // Recover legacy fallback saves into the authoritative database once.
  const legacy = loadFallbackState().hazardAnalysisRuns || [];
  if (legacy.length) {
    for (const run of legacy) {
      if (!run?.id) continue;
      const current = await readHazardTransaction(db, META_STORE, store => store.get(run.id), options);
      if (!current || newestFirst(run, current) < 0) {
        const stored=await stageHazardRun(db,run,()=>checkRead(options.signal));
        await publishHazardRun(db,stored,metadata(run),()=>checkRead(options.signal),current);
      }
    }
    localStorage.removeItem(LS_KEY);
  }
  return db;
  } catch(error) { db.close(); throw error; }
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
    return String(run?.[key] ?? "") === String(value);
  });
}

const metadata = hazardMetadata;
const newestFirst = (a, b) => (Date.parse(b.updatedAt || b.createdAt || 0) || 0) - (Date.parse(a.updatedAt || a.createdAt || 0) || 0);

async function matchingMetadata(db, filters, options = {}) {
  const key = ['projectId', 'repoId'].find(name => filters[name] != null && filters[name] !== '');
  const rows = await readHazardTransaction(db, META_STORE, store => key ? store.index(key).getAll(filters[key]) : store.getAll(), options);
  return rows.filter(run => matchesFilters(run, filters)).sort(newestFirst);
}

export async function getCodeArchitectureHazardRuns(filters = {}) {
  const memory=memoryMatches(filters);let saved=[],db;
  try{
    db=await openCodeArchitectureHazardDB();
    if(!db)saved=loadFallbackState().hazardAnalysisRuns.filter(run=>matchesFilters(run,filters));
    else { for(const meta of await matchingMetadata(db,filters)){const run=await hydrateHazardRun(db,await db.get(STORE_NAME,meta.id));if(run)saved.push(run);} }
  }catch(error){if(!memory.length)throw error;}finally{db?.close();}
  const completeMemory=await Promise.all(memory.map(run=>resolveCodeArchitectureHazardRun(run)));
  return [...new Map([...saved,...completeMemory].map(run=>[run.id,run])).values()].sort(newestFirst);
}

const checkRead = signal => { if(signal?.aborted) throw new DOMException('Hazard loading cancelled.', 'AbortError'); };
export async function getLatestCodeArchitectureHazardRun(filters = {}, options = {}) {
  const {signal}=options;
  checkRead(signal);
  const memory=memoryMatches(filters)[0];
  const diagnostic=beginHazardLoadDiagnostic();
  let outcome='complete';
  let db;
  try{
    db=await openCodeArchitectureHazardDB(options);
    checkRead(signal);
    if(!db)return (await getCodeArchitectureHazardRuns(filters))[0] || null;
    diagnostic.phase('read-metadata');
    const latest=await latestRevision(db,filters,options);
    checkRead(signal);
    const useWorkingSet=Boolean(options.workingSet && latest?.storageRevision);
    if(memory && (!latest || memory.id===latest.id || newestFirst(memory,latest)<=0))return options.workingSet ? memory : resolveCodeArchitectureHazardRun(memory,options);
    const reuse = options.reuseRun;
    if (reuse && latest?.storageRevision && reuse.id === latest.id && reuse.projectId === latest.projectId && reuse.repoId === latest.repoId &&
      loadedRevisions.get(reuse) === latest.storageRevision && (Boolean(reuse[PAGED_HAZARD]) === Boolean(options.paged)) && (options.workingSet || !reuse[WORKING_SET])) return reuse;
    diagnostic.phase('read-root');
    const root=latest ? await readHazardTransaction(db, STORE_NAME, store => store.get(latest.id), options) : null;
    if(options.paged && isChunkedHazardRun(root)){
      let index;
      try{index=validateHazardRowIndex(root.payload);}
      catch(error){throw Object.assign(new Error('This saved analysis needs a one-time row storage upgrade.'),{code:'HAZARD_TABLE_UPGRADE_REQUIRED',runId:root.id});}
      const result={...index.metadata,id:root.id,projectId:root.projectId,repoId:root.repoId,
        [PAGED_HAZARD]:{revision:latest.storageRevision,generation:root.payload.generation,total:index.spans.length,pending:index.pending,partialMetadata:index.partial?.metadata || {},partialCount:index.partial?.spans.length || 0,narrative:index.narrative,headers:index.headers,details:Object.keys(index.details || {}),omittedMetadata:index.omittedMetadata || []}};
      const after=await readHazardTransaction(db,META_STORE,store=>store.get(latest.id),options);
      if(after?.storageRevision!==latest.storageRevision){
        if(options.revisionRetry)throw Error('Saved analysis changed while loading. Retry loading.');
        return getLatestCodeArchitectureHazardRun(filters,{...options,revisionRetry:true,reuseRun:null});
      }
      loadedRevisions.set(result,latest.storageRevision);return result;
    }
    let paths=[];
    if(useWorkingSet && isChunkedHazardRun(root)){
      try{paths=validateHazardTableIndex(root.payload).paths;}
      catch(error){throw Object.assign(new Error('This analysis needs a one-time table storage upgrade before its first fast opening. Original results are unchanged.'),{code:'HAZARD_TABLE_UPGRADE_REQUIRED',runId:root.id});}
    }
    diagnostic.phase(useWorkingSet ? 'read-indexed-table' : 'hydrate-and-verify');
    let result=latest ? await hydrateHazardRun(db,root,{...options,tableOnly:useWorkingSet,onProgress:progress=>{
      diagnostic.progress(progress);options.onProgress?.(progress);
    }}) : memory || null;
    if(useWorkingSet && result && !isChunkedHazardRun(root))result=compactHazardRun(result,paths);
    checkRead(signal);
    diagnostic.phase('revalidate-revision');
    if (result && latest) {
      const after = await readHazardTransaction(db, META_STORE, store => store.get(latest.id), options);
      if (latest.storageRevision && after?.storageRevision === latest.storageRevision) {
        if(useWorkingSet){
          if(paths.length)result={...result,[WORKING_SET]:{revision:latest.storageRevision,paths}};
        }
        loadedRevisions.set(result, latest.storageRevision);
      } else if(useWorkingSet) {
        if(options.revisionRetry)throw Error('Saved analysis changed while loading. Retry loading.');
        return getLatestCodeArchitectureHazardRun(filters,{...options,revisionRetry:true,reuseRun:null});
      }

    }
    return result || null;
  }catch(error){outcome=signal?.aborted?'cancelled':memory?'memory-fallback':'failed';checkRead(signal);if(memory)return options.workingSet ? memory : resolveCodeArchitectureHazardRun(memory,options);throw error;}
  finally{db?.close();diagnostic.finish(outcome);}
}

export async function getCodeArchitectureHazardRunById(id, options = {}) {
  checkRead(options.signal);
  if (!id) return null;
  if(!options.committedOnly && unsavedRuns.has(id))return resolveCodeArchitectureHazardRun(unsavedRuns.get(id),options);
  const db = await openCodeArchitectureHazardDB(options);
  try {
    checkRead(options.signal);
    if(!db && options.committedOnly)throw Error('Saved hazard storage is unavailable.');
    if(!db)return loadFallbackState().hazardAnalysisRuns.find(run => run.id === id) || null;
    const before=await readHazardTransaction(db,META_STORE,store=>store.get(id),options);
    const full=await hydrateHazardRun(db,await readHazardTransaction(db,STORE_NAME,store=>store.get(id),options),options);
    const after=await readHazardTransaction(db,META_STORE,store=>store.get(id),options);
    if(before?.storageRevision!==after?.storageRevision)throw Error('Saved analysis changed. Reload it before editing.');
    return full ? {...full,...(after?.storageRevision?{[HAZARD_EDIT_REVISION]:after.storageRevision}:{})} : null;
  } finally {db?.close();}
}

// Working sets remain editable, but cannot overwrite deferred source data.
// Resolve automatically for actions that need evidence or continuation inputs.
export async function resolveCodeArchitectureHazardRun(run, options={}) {
  if(run?.[PAGED_HAZARD]){
    const descriptor=run[PAGED_HAZARD],db=await openCodeArchitectureHazardDB(options);
    try{
      const before=await readHazardTransaction(db,META_STORE,s=>s.get(run.id),options);
      if(before?.storageRevision!==descriptor.revision)throw Error('Saved analysis changed. Reload it before editing or continuing.');
      const full=await hydrateHazardRun(db,await readHazardTransaction(db,STORE_NAME,s=>s.get(run.id),options),options);
      const after=await readHazardTransaction(db,META_STORE,s=>s.get(run.id),options);
      if(after?.storageRevision!==descriptor.revision || !full)throw Error('Saved analysis changed. Reload it before editing or continuing.');
      return {...full,[HAZARD_EDIT_REVISION]:descriptor.revision};
    }finally{db?.close();}
  }
  if(!run?.[WORKING_SET])return run;
  const db=await openCodeArchitectureHazardDB(options);
  try {
    if(!db)throw Error('Saved hazard storage is unavailable.');
    const before=await readHazardTransaction(db,META_STORE,s=>s.get(run.id),options);
    if(before?.storageRevision!==run[WORKING_SET].revision)throw Error('Saved analysis changed. Reload it before editing or continuing.');
    const full=await hydrateHazardRun(db,await readHazardTransaction(db,STORE_NAME,s=>s.get(run.id),options),options);
    const after=await readHazardTransaction(db,META_STORE,s=>s.get(run.id),options);
    if(!full || after?.storageRevision!==before.storageRevision || full.projectId!==run.projectId || full.repoId!==run.repoId)
      throw Error('Saved analysis changed. Reload it before editing or continuing.');
    return {...restoreDeferredHazardFields(run,full),[HAZARD_EDIT_REVISION]:before.storageRevision};
  }finally{db?.close();}
}

// One queue per record prevents slow or retried writes overtaking newer saves.
const saveQueues = new Map();
const cleaningHazardScopes = new Set();
const hazardStorageScope = (projectId,repoId) => JSON.stringify([String(projectId),String(repoId)]);
export const hazardStorageBusy = (projectId,repoId) => memoryMatches({projectId,repoId}).length > 0 || saveQueues.size > 0;
export async function withHazardStorageCleanup(projectId,repoId,operation) {
  const scope = hazardStorageScope(projectId,repoId);
  if (cleaningHazardScopes.has(scope) || hazardStorageBusy(projectId,repoId)) throw new Error('Hazard analysis is running or has unsaved results. Finish or save it before cleanup.');
  cleaningHazardScopes.add(scope);
  try { return await operation(); } finally { cleaningHazardScopes.delete(scope); }
}

const queuedSourceRevisions = new Map();
const saveOwners = new Map();
const saveEpochs = new Map();
function publishSaveState(run) {
  try { window.dispatchEvent(new CustomEvent('xhandle:hazard-save-state', {detail:{run}})); } catch {}
}
const transientSaveError = error => ['AbortError', 'TransactionInactiveError', 'InvalidStateError', 'UnknownError'].includes(error?.name);
export async function saveCodeArchitectureHazardRun(run, { notify = true, onSaveState = () => {} } = {}) {
  if (cleaningHazardScopes.has(hazardStorageScope(run?.projectId,run?.repoId))) throw new Error('Hazard cleanup is in progress. Retry saving later.');

  if(run?.[PAGED_HAZARD])throw new Error('Resolve the saved analysis before editing it. A paged table descriptor cannot be saved.');
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
    // An edit is not authoritative until its revision check commits.
    if(!run[HAZARD_EDIT_REVISION] || status==='failed')publishSaveState(unsavedRuns.get(run.id));
    try { onSaveState({status, message}); } catch {}
  };
  const previous = saveQueues.get(run.id);
  const queuedRevision=run[WORKING_SET]?.revision;
  const previousSourceRevision=queuedSourceRevisions.get(run.id);
  const work = (async () => {
    const priorSaved=await previous?.catch(() => undefined);
    // Preserve existing local save-queue semantics for rapid consecutive edits.
    // Only a save already queued from the same source can advance this token;
    // unrelated windows and later stale objects still fail revision checks.
    if(queuedRevision && queuedRevision===previousSourceRevision && priorSaved?.[WORKING_SET])
      run[WORKING_SET]={...run[WORKING_SET],revision:priorSaved[WORKING_SET].revision};
    checkDeleted();
    const sourceRevision=run[HAZARD_EDIT_REVISION] || run[WORKING_SET]?.revision;
    let persisted;
    const slow = setTimeout(() => state('slow'), 5000);
    try {
      const complete=await resolveCodeArchitectureHazardRun(run);
      checkDeleted();
      persisted = {...complete, finalSavePending:false, finalSaveStatus:'saved', saveFailureMessage:''};
      for (let attempt = 0; ; attempt++) {
        let tx,db,staged;
        try {
          db = await openCodeArchitectureHazardDB();
          checkDeleted();
          if (db) {
            staged=await stageHazardRun(db,persisted,checkDeleted);
            checkDeleted();
            const storageRevision=await publishHazardRun(db,staged,metadata(persisted),checkDeleted,undefined,sourceRevision);
            const saved={...metadata(persisted),storageRevision};
            if(saved?.storageRevision){
              if(run[HAZARD_EDIT_REVISION]) { run[HAZARD_EDIT_REVISION]=saved.storageRevision; persisted[HAZARD_EDIT_REVISION]=saved.storageRevision; }
              if(run[WORKING_SET])run[WORKING_SET]={...run[WORKING_SET],revision:saved.storageRevision};
            }
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
        } finally { db?.close(); }
      }
      checkDeleted();
      if (current()) {
        unsavedRuns.delete(run.id);
        publishSaveState(run[WORKING_SET] ? {...run,finalSavePending:false,finalSaveStatus:'saved',saveFailureMessage:''} : persisted);
        try { onSaveState({status:'saved', message:''}); } catch {}
        if (notify) emitChanged({storeName:STORE_NAME, projectId:run.projectId, repoId:run.repoId, runId:run.id});
      }
      return run;
    } catch (error) {
      if(error.code==='HAZARD_REVISION_CONFLICT'){
        if(current()){
          unsavedRuns.delete(run.id);
          if(notify)emitChanged({storeName:STORE_NAME,projectId:run.projectId,repoId:run.repoId,runId:run.id});
        }
      } else state('failed', error.message || String(error));
      throw error;
    } finally {
      clearTimeout(slow);
    }
  })();
  saveQueues.set(run.id, work);
  queuedSourceRevisions.set(run.id,queuedRevision);
  // Reserve the queue slot before synchronous events or callbacks can enqueue
  // another revision. Work yields above before opening storage.
  state('saving'); // Protect results from reload while queued or writing, too.
  try { return await work; }
  finally {
    if (saveQueues.get(run.id) === work) {saveQueues.delete(run.id);queuedSourceRevisions.delete(run.id);}
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
  await deleteWorkingSets(deletedRunIds).catch(()=>{});
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

// A row deletion rewrites the token stream, not a fully hydrated analysis.
// Publication compares the source revision; no partial run can overwrite it.
export async function deletePagedHazardRow(run,rowIndex,{signal}={}) {
  const descriptor=run?.[PAGED_HAZARD];if(!descriptor)throw Error('Expected a saved table descriptor.');
  const db=await openCodeArchitectureHazardDB({signal});let staged;
  try{
    const meta=await db.get(META_STORE,run.id),root=await db.get(STORE_NAME,run.id);
    if(meta?.storageRevision!==descriptor.revision || root?.payload?.generation!==descriptor.generation)throw Error('Saved analysis changed. Reload before deleting a row.');
    const index=validateHazardRowIndex(root.payload),span=index.spans[rowIndex];if(!span)throw Error('This saved row no longer exists.');
    async function* tokens(){
      const hash=sha256();
      for(let seq=0;seq<root.payload.count;seq++){
        checkRead(signal);const page=await db.get(HAZARD_CHUNKS,hazardChunkKey(descriptor.generation,seq));
        if(!page || page.digest!==hazardChunkDigest(page.tokens))throw Error('Saved source changed or is damaged. No row was deleted.');
        hash.update(page.digest+'\n');
        for(let offset=0;offset<page.tokens.length;offset++){
          const inside=(seq>span[0] || seq===span[0]&&offset>=span[1]) && (seq<span[2] || seq===span[2]&&offset<span[3]);
          if(!inside)yield page.tokens[offset];
        }
      }
      if(hash.digest('hex')!==root.payload.digest)throw Error('Saved source failed integrity verification.');
    }
    staged=await stageHazardRun(db,root,()=>checkRead(signal),{tokenSource:tokens(),signal});
    await publishHazardRun(db,staged,metadata(root),()=>checkRead(signal),undefined,descriptor.revision);
    emitChanged({projectId:run.projectId,repoId:run.repoId,runId:run.id});
  }catch(error){if(isChunkedHazardRun(staged))await removeHazardGeneration(db,staged.payload.generation).catch(()=>{});throw error;}
  finally{db.close();}
}
