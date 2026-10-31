import { ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY, ACTIVE_FUNCTIONAL_PROJECTS_KEY } from './storageWorkspaceVisibility';
import { flushProjectArtifactWrites, clearProjectArtifactCache, blockDeletedProjectArtifactWrites } from '../features/code-architecture-assurance/artifactUtils';
import { flushProjectArchitectureWrites, blockDeletedProjectArchitectureWrites } from '../features/code-architecture-assurance/codeArchitectureStorage';
import { withWorkspaceGraphMigrationPaused } from '../features/workspace-graph/legacyWorkspaceGraphMigrator';
import { quiesceProjectRecovery } from '../lib/durableRecovery';

const DATABASES = ['xhandle', 'xhandle-recovery', 'xhandle-project-hazard-analysis',
  'xhandle-hazard-analysis-reset', 'xhandle-project-reports', 'xhandle-results-review',
  'xhandle-safety-remediation', 'xhandle-code-architecture-hazard-analysis',
  'xhandle-code-architecture-assurance', 'TraceabilityDB', 'TraceabilityMeta',
  'BaselinesDB', 'SafetyCaseEvidenceDB'];
const CLEANUP_LABELS = ['architecture analyses and diagrams', 'recovery checkpoints', 'hazard analyses',
  'hazard undo snapshots', 'saved reports', 'review results', 'safety remediation records',
  'code hazard analyses', 'engineering artifacts', 'traceability records', 'traceability metadata',
  'saved baselines', 'safety case evidence'];
const SHARED_FALLBACKS = ['xhandle:results-review:items', 'xhandle:safety-remediation:v1',
  'xhandle:code-architecture-hazard-analysis:v1', 'xhandle:review-summary-artifacts'];
const sameProjectId = (value, projectId) => ['string','number'].includes(typeof value) && String(value) === String(projectId);
const ambiguousProjectIds = (a, b) => String(a) !== String(b) && (String(a).startsWith(`${b}:`) || String(b).startsWith(`${a}:`));
const scoped = (key, root) => key === root || key.startsWith(`${root}:`);

export function projectOwnsStorageKey(key, projectId) {
  if (typeof key !== 'string' || projectId == null) return false;
  projectId = String(projectId);
  if (!projectId) return false;
  const roots = ['cba', 'cbaMeta', 'diagram:positions', 'diagram:github', 'decomposition',
    'decomposition-candidate', 'hazard-run', 'xhandle.hazardAnalysisResetSnapshot',
    'xhandle.safetyIssueReport', 'xhandle:safety-cases', 'functional-decomposition',
    'hazard-summary', 'code-architecture-functional-decomposition', 'code-architecture-hazard-summary'];
  if (roots.some(root => scoped(key, `${root}:${projectId}`))) return true;
  if (scoped(key, `functional-decomposition-checkpoint:cba:${projectId}`)) return true;
  if (scoped(key, `xhandle:code-architecture-hazard-contexts:v1:${encodeURIComponent(projectId)}`)) return true;
  if (/^xhandle:cba-[^:]+:/.test(key) && scoped(key.replace(/^xhandle:cba-[^:]+:/, ''), projectId)) return true;
  // LiteSummaryDiagram uses a lossy normalized ID; it cannot prove ownership.
  return false;
}

export function projectOwnsRecord(key, record, projectId, dbName, storeName) {
  projectId = String(projectId);
  // Exact scoped keys are authoritative, including chunk/recovery records.
  if ([key, record?.key, record?.scope, record?.artifactId, record?.sourceKey].some(value => projectOwnsStorageKey(value, projectId))) return true;
  if (dbName === 'xhandle-workspace-graph' && storeName === 'projects') return sameProjectId(key,projectId);
  if (['xhandle-project-hazard-analysis', 'xhandle-hazard-analysis-reset', 'xhandle-project-reports'].includes(dbName) && sameProjectId(key,projectId)) return true;
  return (record?.projectId != null && sameProjectId(record.projectId,projectId)) ||
    (record?.value?.projectId != null && sameProjectId(record.value.projectId,projectId));
}

// Missing databases must not be created, and a timed-out open must never delete
// data later after the UI has reported failure.
function openExistingDatabase(name) {
  return new Promise((resolve,reject) => {
    let finished=false, absent=false;
    const finish=(error,db)=>{
      if (finished) { db?.close(); return; }
      finished=true; clearTimeout(timer);
      if (error) reject(new Error(`${name}: ${error.message || error}`)); else resolve(db);
    };
    const timer=setTimeout(()=>finish(new Error(`Storage connection timed out (${name}).`)),10000);
    try {
      const request=indexedDB.open(name);
      request.onupgradeneeded=()=>{absent=true;request.transaction.abort();};
      request.onsuccess=()=>finish(null,request.result);
      request.onerror=()=>finish(absent ? null : request.error);
      request.onblocked=()=>finish(new Error(`Storage is blocked (${name}). Close other xHandle tabs and retry.`));
    } catch(error) {finish(error);}
  });
}

async function deleteOwnedDatabaseRecords(name,projectId) {
  const db=await openExistingDatabase(name);
  if (!db) return 0;
  // Source indexes are shared by snapshots/repositories and are not owned by
  // a single project. Keep them when deleting a project.
  const stores=Array.from(db.objectStoreNames).filter(store=>!(name==='xhandle' && store==='code_index'));
  if (!stores.length) {db.close();return 0;}
  return new Promise((resolve,reject)=>{
    let count=0, tx, timer, failure, settled=false;
    const finish=error=>{
      if (settled) return;
      settled=true; clearTimeout(timer); db.close();
      error ? reject(new Error(`Unable to clean ${name}: ${error.message || error}`)) : resolve(count);
    };
    const abort=error=>{ failure=failure || error; try { tx.abort(); } catch { finish(error); } };
    try {
      tx=db.transaction(stores,'readwrite');
      timer=setTimeout(()=>abort(new Error('Storage cleanup timed out. Close other tabs and retry.')),30000);
      tx.oncomplete=()=>finish();
      tx.onerror=()=>{ failure=failure || tx.error; };
      tx.onabort=()=>finish(failure || tx.error || new Error('Storage transaction aborted. Retry cleanup.'));
      stores.forEach(store => {
        const objectStore = tx.objectStore(store);
        const keyOwned = (name === 'xhandle' && ['copilot_baseline', 'diagram_positions'].includes(store)) ||
          (name === 'xhandle-recovery' && store === 'checkpoints') ||
          (name === 'xhandle-code-architecture-assurance' && store === 'artifactRows') ||
          (name === 'xhandle-workspace-graph' && store === 'projects') ||
          objectStore.keyPath === 'projectId';
        // Walk primary keys, not the project index: missing index entries must
        // not hide scoped records. Hydrate only stores with payload ownership.
        const request = objectStore.openKeyCursor();
        request.onerror=()=>abort(request.error);
        request.onsuccess=()=>{
          try {
            const cursor=request.result;
            if (!cursor) return;
            const owned = projectOwnsRecord(cursor.primaryKey, null, projectId, name, store) ||
              (objectStore.keyPath === 'projectId' && sameProjectId(cursor.primaryKey,projectId));
            const advance=record=>{
              try {
                if (owned || projectOwnsRecord(cursor.primaryKey,record,projectId,name,store)) {
                  objectStore.delete(cursor.primaryKey); count++;
                }
                cursor.continue();
              } catch(error) { abort(new Error(`${store}: ${error.message}`)); }
            };
            if (owned || keyOwned) advance(null);
            else {
              const read=objectStore.get(cursor.primaryKey);
              read.onerror=()=>abort(read.error);
              read.onsuccess=()=>advance(read.result);
            }
          } catch(error) { abort(new Error(`${store}: ${error.message}`)); }
        };
      });
    } catch(error) { if (tx) abort(error); else finish(error); }
  });
}

export function assertRemovedProject(project, storage=localStorage) {
  if (!['string','number'].includes(typeof project?.id) || (typeof project.id === 'number' && !Number.isFinite(project.id)) || String(project.id) === '' || !['functional','code-architecture'].includes(project.workspaceType)) throw new Error('Invalid project.');
  for (const key of [ACTIVE_FUNCTIONAL_PROJECTS_KEY,ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY]) {
    const projects=readJson(storage,key,[]);
    if (!Array.isArray(projects)) throw new Error(`Unable to verify active projects in ${key}: expected a project list. Repair or restore it, then retry.`);
    if (projects.some(entry => entry?.id != null && ambiguousProjectIds(entry.id, project.id))) throw new Error('Ambiguous project ID namespaces. Cleanup was cancelled to preserve another project.');
    if (projects.some(entry=>sameProjectId(entry?.id,project.id))) throw new Error('This project is active. Remove it from the workspace before permanently deleting it.');
  }
  if (project.active) throw new Error('Only removed projects can be permanently deleted.');
}

function readJson(storage,key,fallback) {
  const raw=storage.getItem(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error(`Cannot safely clean ${key}: invalid JSON. Repair or restore this storage entry, then retry.`); }
}

export function deleteProjectLocalRecords(projectId, storage=localStorage) {
  let count=0;
  const data=readJson(storage,'xhandle.projectData',{});
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Cannot safely clean xhandle.projectData: expected a project map.');
  if (Object.prototype.hasOwnProperty.call(data,projectId)) {
    delete data[projectId];storage.setItem('xhandle.projectData',JSON.stringify(data));count++;
  }
  for (const key of Array.from({length:storage.length},(_,i)=>storage.key(i))) {
    if (projectOwnsStorageKey(key,projectId)) {storage.removeItem(key);count++;}
  }
  for (const key of SHARED_FALLBACKS) {
    const raw=storage.getItem(key);
    if (!raw) continue;
    const value=readJson(storage,key,[]);
    if (!value || typeof value !== 'object') throw new Error(`Cannot safely clean ${key}: expected records.`);
    const prune=rows=>rows.filter(row=>!projectOwnsRecord(null,row,projectId,'',''));
    const next=Array.isArray(value) ? prune(value) : Object.fromEntries(Object.entries(value).map(([k,v])=>[k,Array.isArray(v)?prune(v):v]));
    const serialized=JSON.stringify(next);
    if (serialized!==raw) {storage.setItem(key,serialized);count++;}
  }
  return count;
}

async function deleteStoredProject(project, prepareRecovery, progress) {
  assertRemovedProject(project);
  const id=String(project.id);
  if (typeof indexedDB==='undefined') throw new Error('Browser storage is unavailable.');
  await assertRetainedWorkspaceOwnership(project);
  await progress.step('Finishing pending analysis saves', () => waitForPendingWrites(() => flushProjectArchitectureWrites(id), 'Architecture writes'));
  await progress.step('Finishing pending artifact saves', () => waitForPendingWrites(() => flushProjectArtifactWrites(id), 'Requirements writes'));
  await progress.step('Finishing recovery saves', prepareRecovery);

  let deleted=0;
  for (const [index, database] of DATABASES.entries()) {
    assertRemovedProject(project);
    deleted+=await progress.step(`Deleting ${CLEANUP_LABELS[index]}`, () => deleteOwnedDatabaseRecords(database,id));
  }
  assertRemovedProject(project);
  deleted+=await progress.step('Deleting project settings and local records', () => deleteProjectLocalRecords(id));
  // Delete the recoverable workspace record last, so failed cleanup can be
  // retried from the same removed-project row.
  assertRemovedProject(project);
  deleted+=await progress.step('Deleting the retained project record', () => deleteOwnedDatabaseRecords('xhandle-workspace-graph',id));
  await progress.step('Verifying permanent deletion', () => verifyProjectAbsent(id));
  clearProjectArtifactCache(id);
  return {deleted};
}

// IDs are shared across legacy feature stores. Refuse ambiguous cross-workspace
// ownership before touching any of those stores, including numeric key aliases.
async function assertRetainedWorkspaceOwnership(project) {
  const db = await openExistingDatabase('xhandle-workspace-graph');
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains('projects')) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      let conflict = false;
      const expected = `localStorage:${project.workspaceType === 'functional' ? ACTIVE_FUNCTIONAL_PROJECTS_KEY : ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY}`;
      const store = tx.objectStore('projects');
      const textId = String(project.id);
      const timer = setTimeout(() => { try { tx.abort(); } catch {} }, 10000);
      const inventory = store.getAllKeys();
      inventory.onsuccess = () => {
        inventory.result.forEach(key => {
          if (ambiguousProjectIds(key, textId)) conflict = true;
          if (!sameProjectId(key, textId)) return;
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result?.sourceStore && request.result.sourceStore !== expected) conflict = true;
          };
        });
      };
      tx.oncomplete = () => { clearTimeout(timer); conflict ? reject(new Error('A different workspace owns this retained project ID, or its namespace is ambiguous. Cleanup was cancelled.')) : resolve(); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error || new Error('Unable to verify retained project ownership. Retry cleanup.')); };
    });
  } finally { db.close(); }
}

async function verifyProjectAbsent(projectId) {
  const db=await openExistingDatabase('xhandle-workspace-graph');
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains('projects')) return;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('projects','readonly');
      const request=tx.objectStore('projects').openKeyCursor();
      let retained=false;
      const timer=setTimeout(()=>{try {tx.abort();} catch {}},10000);
      request.onsuccess=()=>{
        try {
          const cursor=request.result;
          if (!cursor) return;
          if (sameProjectId(cursor.primaryKey,projectId)) retained=true;
          cursor.continue();
        } catch { try {tx.abort();} catch {} }
      };
      tx.oncomplete=()=>{clearTimeout(timer); retained ? reject(new Error('The retained project still exists. Retry cleanup.')) : resolve();};
      tx.onabort=tx.onerror=()=>{clearTimeout(timer); reject(tx.error || new Error('Could not verify persisted project deletion.'));};
    });
  } finally { db.close(); }
}

export async function permanentlyDeleteStoredProject(project, { onProgress } = {}) {
  const total = DATABASES.length + 7;
  let completed = 0;
  const report = label => {
    // Presentation callbacks must never interrupt cleanup or change its result.
    try { onProgress?.({ completed, total, label }); } catch {}
  };
  const progress = { step: async (label, operation) => {
    report(label);
    const result = await operation();
    completed++;
    report(label);
    return result;
  }};
  assertRemovedProject(project);
  const id=String(project.id);
  let releaseArchitecture = false;
  let releaseArtifacts = false;
  let unblockRecovery;
  let failed=false;
  const prepareRecovery=()=>waitForPendingWrites(async()=>{
    const unblock=await quiesceProjectRecovery(id);
    if (failed) unblock(); else unblockRecovery=unblock;
  }, 'Recovery writes');
  report('Waiting for current workspace updates');
  try {
    return await withWorkspaceGraphMigrationPaused(() => {
      releaseArchitecture = blockDeletedProjectArchitectureWrites(id);
      releaseArtifacts = blockDeletedProjectArtifactWrites(id);
      completed++;
      return deleteStoredProject(project,prepareRecovery,progress);
    },30000);
  } catch(error) {
    failed=true;
    unblockRecovery?.();
    // Failed cleanup remains retryable/restorable from the retained row.
    if (releaseArchitecture) blockDeletedProjectArchitectureWrites(id,false);
    if (releaseArtifacts) blockDeletedProjectArtifactWrites(id,false);
    throw error;
  }
}

async function waitForPendingWrites(operation, label) {
  let timer;
  try {
    await Promise.race([
      operation(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} did not finish. Wait for saving to complete and retry cleanup.`)),30000);}),
    ]);
  } finally { clearTimeout(timer); }
}
