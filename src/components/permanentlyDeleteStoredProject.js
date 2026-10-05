import { ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY, ACTIVE_FUNCTIONAL_PROJECTS_KEY } from './storageWorkspaceVisibility';
import { deleteProjectRecovery } from '../lib/durableRecovery';

const DATABASES = ['xhandle', 'xhandle-recovery', 'xhandle-project-hazard-analysis',
  'xhandle-hazard-analysis-reset', 'xhandle-project-reports', 'xhandle-results-review',
  'xhandle-safety-remediation', 'xhandle-code-architecture-hazard-analysis',
  'xhandle-code-architecture-assurance', 'TraceabilityDB', 'TraceabilityMeta',
  'BaselinesDB', 'SafetyCaseEvidenceDB'];
const SHARED_FALLBACKS = ['xhandle:results-review:items', 'xhandle:safety-remediation:v1',
  'xhandle:code-architecture-hazard-analysis:v1', 'xhandle:review-summary-artifacts'];
const scoped = (key, root) => key === root || key.startsWith(`${root}:`);

export function projectOwnsStorageKey(key, projectId) {
  if (typeof key !== 'string' || !projectId) return false;
  const roots = ['cba', 'cbaMeta', 'diagram:positions', 'diagram:github', 'decomposition',
    'decomposition-candidate', 'hazard-run', 'xhandle.hazardAnalysisResetSnapshot',
    'xhandle.safetyIssueReport', 'xhandle:safety-cases', 'functional-decomposition',
    'hazard-summary', 'code-architecture-functional-decomposition', 'code-architecture-hazard-summary'];
  if (roots.some(root => scoped(key, `${root}:${projectId}`))) return true;
  if (scoped(key, `functional-decomposition-checkpoint:cba:${projectId}`)) return true;
  if (scoped(key, `xhandle:code-architecture-hazard-contexts:v1:${encodeURIComponent(projectId)}`)) return true;
  if (/^xhandle:cba-[^:]+:/.test(key) && scoped(key.replace(/^xhandle:cba-[^:]+:/, ''), projectId)) return true;
  const liteId = `proj_${projectId.toLowerCase().trim().replace(/[^a-z0-9]+/gi, '_')}`;
  return key.startsWith(`LiteSummaryDiagram::${liteId}::`);
}

export function projectOwnsRecord(key, record, projectId, dbName, storeName) {
  // Never infer ownership from a repository name, source path or description.
  if (dbName === 'xhandle-workspace-graph' && storeName === 'projects') return record?.id === projectId;
  if (record?.projectId != null) return String(record.projectId) === projectId;
  if (record?.value?.projectId != null) return String(record.value.projectId) === projectId;
  if (['xhandle-project-hazard-analysis', 'xhandle-hazard-analysis-reset', 'xhandle-project-reports'].includes(dbName) && key === projectId) return true;
  return [key,record?.key,record?.scope,record?.artifactId,record?.sourceKey].some(value => projectOwnsStorageKey(value,projectId));
}

// Missing databases must not be created, and a timed-out open must never delete
// data later after the UI has reported failure.
function openExistingDatabase(name) {
  return new Promise((resolve,reject) => {
    let finished=false, absent=false;
    const finish=(error,db)=>{
      if (finished) { db?.close(); return; }
      finished=true; clearTimeout(timer);
      if (error) reject(error); else resolve(db);
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
    let count=0, tx, timer;
    const finish=error=>{clearTimeout(timer);db.close();error ? reject(error) : resolve(count);};
    try {
      tx=db.transaction(stores,'readwrite');
      timer=setTimeout(()=>{try{tx.abort();}catch{}},30000);
      tx.oncomplete=()=>finish();
      tx.onerror=()=>finish(tx.error || new Error(`Unable to clean ${name}.`));
      tx.onabort=()=>finish(tx.error || new Error(`Storage cleanup was aborted (${name}).`));
      stores.forEach(store => {
        const request=tx.objectStore(store).openCursor();
        request.onsuccess=()=>{
          const cursor=request.result;
          if (!cursor) return;
          if (projectOwnsRecord(cursor.primaryKey,cursor.value,projectId,name,store)) {cursor.delete();count++;}
          cursor.continue();
        };
      });
    } catch(error) {try{tx?.abort();}catch{}finish(error);}
  });
}

export function assertRemovedProject(project, storage=localStorage) {
  if (!project?.id || !['functional','code-architecture'].includes(project.workspaceType)) throw new Error('Invalid project.');
  for (const key of [ACTIVE_FUNCTIONAL_PROJECTS_KEY,ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY]) {
    const projects=JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(projects)) throw new Error('Unable to verify active projects. Refresh and retry.');
    if (projects.some(entry=>String(entry.id)===String(project.id))) throw new Error('This project is active. Remove it from the workspace before permanently deleting it.');
  }
  if (project.active) throw new Error('Only removed projects can be permanently deleted.');
}

export function deleteProjectLocalRecords(projectId, storage=localStorage) {
  let count=0;
  const data=JSON.parse(storage.getItem('xhandle.projectData') || '{}');
  if (Object.prototype.hasOwnProperty.call(data,projectId)) {
    delete data[projectId];storage.setItem('xhandle.projectData',JSON.stringify(data));count++;
  }
  for (const key of Array.from({length:storage.length},(_,i)=>storage.key(i))) {
    if (projectOwnsStorageKey(key,projectId)) {storage.removeItem(key);count++;}
  }
  for (const key of SHARED_FALLBACKS) {
    const raw=storage.getItem(key);
    if (!raw) continue;
    const value=JSON.parse(raw);
    const prune=rows=>rows.filter(row=>!projectOwnsRecord(null,row,projectId,'',''));
    const next=Array.isArray(value) ? prune(value) : Object.fromEntries(Object.entries(value).map(([k,v])=>[k,Array.isArray(v)?prune(v):v]));
    const serialized=JSON.stringify(next);
    if (serialized!==raw) {storage.setItem(key,serialized);count++;}
  }
  return count;
}

export async function permanentlyDeleteStoredProject(project) {
  assertRemovedProject(project);
  const id=String(project.id);
  if (typeof indexedDB==='undefined') throw new Error('Browser storage is unavailable.');
  if (project.workspaceType==='functional') {
    const recoveryDb=await openExistingDatabase('xhandle-recovery');
    const hasCheckpoints=recoveryDb?.objectStoreNames.contains('checkpoints');
    recoveryDb?.close();
    if (hasCheckpoints) await deleteProjectRecovery(id);
  }
  let deleted=0;
  for (const database of DATABASES) {
    assertRemovedProject(project);
    deleted+=await deleteOwnedDatabaseRecords(database,id);
  }
  assertRemovedProject(project);
  deleted+=deleteProjectLocalRecords(id);
  // Delete the recoverable workspace record last, so failed cleanup can be
  // retried from the same removed-project row.
  deleted+=await deleteOwnedDatabaseRecords('xhandle-workspace-graph',id);
  return {deleted};
}
