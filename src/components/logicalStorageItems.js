import { withHazardStorageCleanup, hazardStorageBusy } from '../features/code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { ARTIFACT_DEFINITIONS } from '../features/code-architecture-assurance/artifactDefinitions';
import { storageKeyFor, withArtifactStorageCleanup, artifactStorageBusy } from '../features/code-architecture-assurance/artifactUtils';
import { withWorkspaceGraphMigrationPaused } from '../features/workspace-graph/legacyWorkspaceGraphMigrator';
import { withArchitectureStorageCleanup, architectureStorageBusy } from '../features/code-architecture-assurance/codeArchitectureStorage';

const STORE = 'copilot_baseline';
const part = key => typeof key === 'string' && key.includes(':$part:');
const within = (key, prefix) => typeof key === 'string' && (key === prefix || key.startsWith(`${prefix}:`));
const validId = id => (typeof id === 'string' && id.length > 0) || (typeof id === 'number' && Number.isFinite(id));

// Never creates a missing database. A late open cannot start work after timeout.
export function openLogicalStorage(name) {
  return new Promise((resolve, reject) => {
    let settled = false, absent = false;
    const finish = (error, db) => {
      if (settled) { db?.close(); return; }
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(db);
    };
    const timer = setTimeout(() => finish(new Error('Saved work is unavailable. Close other writing tabs and retry.')), 10000);
    try {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(absent ? null : request.error);
      request.onblocked = () => finish(new Error('Saved work is blocked by another tab. Close it and retry.'));
    } catch (error) { finish(error); }
  });
}

export function logicalTransaction(db, stores, mode, start) {
  return new Promise((resolve, reject) => {
    let tx, failure, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const abort = error => { failure = error; try { tx?.abort(); } catch {} finish(error); };
    const timer = setTimeout(() => abort(new Error('Saved work operation timed out. Refresh and retry.')), 30000);
    try {
      tx = db.transaction(stores, mode);
      tx.oncomplete = () => finish(failure);
      tx.onabort = () => finish(failure || tx.error || new Error('Saved work operation was interrupted. Retry cleanup.'));
      tx.onerror = () => {};
      start(tx, abort);
    } catch (error) { abort(error); }
  });
}

export async function logicalKeys(db, store) {
  if (!db?.objectStoreNames.contains(store)) return [];
  const keys = [];
  await logicalTransaction(db, store, 'readonly', (tx, abort) => {
    const request = tx.objectStore(store).openKeyCursor();
    request.onsuccess = () => {
      try { const cursor = request.result; if (cursor) { keys.push(cursor.primaryKey); cursor.continue(); } }
      catch (error) { abort(error); }
    };
  });
  return keys;
}

function scopesForProjects(projects) {
  const scopes = [];
  for (const project of projects) {
    if (project.workspaceType !== 'code-architecture' || !validId(project.id)) continue;
    for (const repo of project.sourceData?.repos || project.repos || []) {
      if (!validId(repo.id)) continue;
      scopes.push({ project, repo, scope: `cba:${project.id}:${repo.id}` });
    }
  }
  return scopes;
}

// Keys establish identity; labels never establish ownership. Colon-delimited
// namespaces that overlap any other known project/repository fail closed.
export function architectureScopeEligible(entry, projects) {
  const { project, scope } = entry;
  if (project.storageOwnershipConflict || (project.workspaceId && project.workspaceId !== 'workspace:local') || (project.sourceData && String(project.sourceData.id) !== String(project.id))) return false;
  if (projects.some(other => String(other.id) === String(project.id) && other.workspaceType !== project.workspaceType)) return false;
  if (projects.some(other => String(other.id) !== String(project.id) &&
    (String(other.id).startsWith(`${project.id}:`) || String(project.id).startsWith(`${other.id}:`)))) return false;
  if (scopesForProjects(projects).filter(other => other.scope === scope).length !== 1) return false;
  return !scopesForProjects(projects).some(other => other !== entry && other.scope !== scope &&
    (within(scope, other.scope) || within(other.scope, scope)));
}

export function buildArchitectureLogicalItems(keys, projects, { busy = architectureStorageBusy } = {}) {
  const items = [], assigned = new Set();
  for (const entry of scopesForProjects(projects)) {
    const { scope, project, repo } = entry;
    const owned = keys.filter(key => within(key, scope) || within(key, `functional-decomposition-checkpoint:${scope}`));
    if (!owned.length) continue;
    const safe = architectureScopeEligible(entry, projects);
    if (safe) owned.filter(key => !key.startsWith(`${scope}:requirements-work:`)).forEach(key => assigned.add(key));
    const roots = owned.filter(key => !part(key));
    const checkpoint = roots.some(key => key.startsWith(`functional-decomposition-checkpoint:${scope}:`));
    const reason = !safe ? 'Project or repository identity overlaps another workspace. Cleanup requires repair.'
      : busy(scope) ? 'Analysis or saving is in progress. Wait for it to finish.'
      : checkpoint ? 'Interrupted or unpublished work is retained. Resume or resolve it before cleanup.' : '';
    const common = { projectId: project.id, workspaceType: project.workspaceType, repoId: repo.id, scope,
      repository: repo.repoName || repo.name || (repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : 'Repository'),
      recoverable: checkpoint, reason, eligible: !reason };
    if ((roots.includes(scope) && !roots.includes(`${scope}:storage-deleted`)) || roots.includes(`${scope}:storage-cleanup-pending`)) items.push({ ...common, id: `${scope}/saved`, type: 'architecture', label: 'Architecture analysis', state: 'Saved' });
    if (roots.some(key => key.startsWith(`${scope}:history:`))) items.push({ ...common, id: `${scope}/history`, type: 'history', label: 'Previous analysis versions', state: 'Retained history; independent restore is not available' });
    if (checkpoint || roots.some(key => key.startsWith(`${scope}:functional-work:`))) items.push({ ...common, id: `${scope}/temporary`, type: 'temporary', label: 'Temporary analysis data', state: checkpoint ? 'Retained for recovery' : 'Publication must be verified before cleanup' });
  }
  const unassigned = keys.some(key => !assigned.has(key));
  return { items, unassigned };
}

function publicationVerified(meta,scope,keys) {
  const coverage=meta?.coverage,source=meta?.sourceAnalysis;
  return keys.includes(scope) && !keys.includes(`${scope}:storage-deleted`) &&
    meta?.storageSaved === true && !meta.storageError && !meta.functionalProcessingError &&
    Number(meta.failedFileCount || 0) === 0 && Number(meta.skippedForScale || 0) === 0 &&
    coverage?.acquisition === 'complete' && coverage.failed === 0 && coverage.skippedByLimits === 0 &&
    Number.isSafeInteger(coverage.selected) && coverage.selected === coverage.analyzed &&
    source?.scope === scope && source.status === 'selected-files-analyzed' &&
    /^[a-f0-9]{64}$/.test(source.fingerprint || '') &&
    source.manifestKey === `${scope}:run:${source.fingerprint}` &&
    keys.includes(source.manifestKey) && keys.includes(`${scope}:run`);
}

export async function inventoryLogicalStorage(projects) {
  const db = await openLogicalStorage('xhandle');
  try {
    const keys = await logicalKeys(db, STORE);
    const result = buildArchitectureLogicalItems(keys, projects);
    if (db?.objectStoreNames.contains(STORE)) await logicalTransaction(db,STORE,'readonly',(tx,abort) => {
      for (const item of result.items) {
        const request=tx.objectStore(STORE).get(`${item.scope}:metadata`);
        request.onsuccess=()=>{
          try {
            const meta=request.result?.value;
            item.savedAt=meta?.updatedAt || meta?.sourceAnalysis?.publishedAt || null;
            if (item.type === 'temporary' && item.eligible) {
              const published=publicationVerified(meta,item.scope,keys);
              if (!published) { item.eligible=false; item.reason='Successful publication cannot be verified. Temporary data is retained for recovery.'; }
              else item.state='Completed analysis request caches';
            }
          } catch(error) {abort(error);}
        };
      }
    });
    try {
      const artifacts = await inventoryArtifactItems(projects);
      result.items.push(...artifacts.items); result.unassigned ||= artifacts.unassigned;
    } catch (error) { result.warnings = [`Requirements inventory unavailable: ${error.message}`]; }
    try {
      const hazards = await inventoryHazardItems(projects);
      result.items.push(...hazards.items); result.unassigned ||= hazards.unassigned;
    } catch (error) { (result.warnings ||= []).push(`Hazard inventory unavailable: ${error.message}`); }
    const legacy=await inventoryLegacyProjectItems(projects);
    result.items.push(...legacy.items); result.unassigned ||= legacy.unassigned;
    if (legacy.warnings.length) (result.warnings ||= []).push(...legacy.warnings);
    return result;
  }
  finally { db?.close(); }
}

const targetRoot = (key, item) => typeof key === 'string' && !part(key) && (item.type === 'temporary' ? key.startsWith(`${item.scope}:functional-work:`)
  : item.type === 'history' ? key.startsWith(`${item.scope}:history:`)
  : key === item.scope || key === `${item.scope}:metadata` || key === `${item.scope}:run` || key.startsWith(`${item.scope}:history:`) || key.startsWith(`${item.scope}:functional-work:`));

export function logicalItemConfirmation(item) {
  if (item.type === 'hazards') return `Delete saved hazard analyses for ${item.repository}? Saved hazard results, their reports within those results and diagram representations will be lost. Architecture, requirements, the project and repository connection, external reports, source files, credentials and backups remain. Existing review evidence, provenance needed by other saved work and uncertain shared data are retained.`;
  if (item.type === 'artifact') return `Delete ${item.label} for ${item.repository}? This saved collection and its diagram representations will be lost. Other requirement collections, architecture, hazard evidence, the project and repository connection, credentials, backups and reusable processing progress remain. Existing review evidence remains.`;
  if (item.type === 'temporary') return `Clean temporary data for ${item.repository}? Accepted request caches will be removed after verifying publication. Saved output, previous versions, repository connection, requirements, hazard evidence, source indexes, credentials and backups remain. A future analysis may need more AI requests.`;
  if (item.type === 'history') return `Delete previous analysis versions for ${item.repository}? Retained architecture history will be lost. The current analysis and its provenance, recovery data, repository connection, requirements, hazard evidence, credentials and backups remain.`;
  return `Delete saved analysis for ${item.repository}? The architecture result, its analysis details, previous architecture versions and request caches will be lost. The project and repository connection, requirements, hazard evidence, source files, credentials and backups remain. Existing review evidence, provenance needed by other saved work and uncertain shared data are retained.`;
}

async function cleanGraphArchitecture(item) {
  const db = await openLogicalStorage('xhandle-workspace-graph');
  if (!db) return;
  try {
    const stores = ['artifacts', 'relationships'].filter(name => db.objectStoreNames.contains(name));
    if (!stores.length) return;
    await logicalTransaction(db, stores, 'readwrite', (tx, abort) => {
      const removed = new Set();
      if (!stores.includes('artifacts')) return;
      const request = tx.objectStore('artifacts').openCursor();
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (cursor) {
            const row = cursor.value;
            if (row.sourceStore === (item.type === 'artifact' ? 'indexedDB:xhandle-code-architecture-assurance/artifactRows' : 'indexedDB:xhandle/copilot_baseline') && (item.type === 'artifact' ? row.sourceKey === item.key : targetRoot(row.sourceKey,item)) && (item.type === 'artifact' || row.type === 'code_architecture_edge')) {
              if (String(row.projectId) !== String(item.projectId) || row.workspaceId !== 'workspace:local') throw new Error('Saved analysis has conflicting workspace ownership. Cleanup stopped.');
              removed.add(row.id); cursor.delete();
            }
            cursor.continue(); return;
          }
          if (!stores.includes('relationships')) return;
          const links = tx.objectStore('relationships').openCursor();
          links.onsuccess = () => {
            try { const link = links.result; if (link) { if (removed.has(link.value.fromArtifactId) || removed.has(link.value.toArtifactId)) link.delete(); link.continue(); } }
            catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      };
    });
  } finally { db.close(); }
}

async function readCurrentProjects(getProjects) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(getProjects), new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Project ownership check timed out. No delayed cleanup will be started.')),10000);
    })]);
  } finally {clearTimeout(timer);}
}

// The caller supplies fresh authoritative registries plus durable retained rows,
// and synchronously invalidates owned React snapshots before the write gate opens.
export async function deleteLogicalStorageItem(item, { getProjects, isBusy = () => false, reconcile = () => {}, onProgress = () => {}, storage = localStorage } = {}) {
  if (!item || !['architecture','history','temporary','artifact','hazards'].includes(item.type) ||
      !validId(item.projectId) || !validId(item.repoId) || item.workspaceType !== 'code-architecture' ||
      item.scope !== `cba:${item.projectId}:${item.repoId}` || typeof getProjects !== 'function') throw new Error('Invalid saved item identity. Refresh and retry.');
  if (item.type === 'hazards') return deleteHazardItem(item, { getProjects, isBusy, reconcile, onProgress, storage });
  if (item.type === 'artifact') return deleteArtifactItem(item, { getProjects, isBusy, reconcile, onProgress, storage });
  return withWorkspaceGraphMigrationPaused(() => withArchitectureStorageCleanup(item.scope, async () => {
    onProgress('Checking saved work and recovery');
    const projects = await readCurrentProjects(getProjects);
    const entry = scopesForProjects(projects).find(entry => entry.scope === item.scope && String(entry.project.id) === String(item.projectId));
    if (!entry || !architectureScopeEligible(entry, projects)) throw new Error('Project ownership could not be verified. Refresh and retry.');
    if (isBusy(item.scope)) throw new Error('Analysis is still running. Wait for it to finish before cleanup.');
    const db = await openLogicalStorage('xhandle');
    if (!db?.objectStoreNames.contains(STORE)) { db?.close(); throw new Error('Saved work is unavailable. Refresh and retry.'); }
    try {
      const keys = await logicalKeys(db, STORE);
      const recovery = await openLogicalStorage('xhandle-recovery');
      let recoveryPresent;
      try { recoveryPresent = (await logicalKeys(recovery, 'checkpoints')).length > 0; }
      finally { recovery?.close(); }
      if (keys.some(key => typeof key === 'string' && !part(key) && key.startsWith(`functional-decomposition-checkpoint:${item.scope}:`))) throw new Error('Interrupted or unpublished work needs these data. Resume or resolve it before cleanup.');
      // Deleting graph copies first leaves the original result discoverable on
      // failure. A subsequent retry can safely finish either stage.
      if (item.type === 'architecture' || item.type === 'history') { onProgress('Removing saved diagram representations'); await cleanGraphArchitecture(item); }
      onProgress(item.type === 'temporary' ? 'Verifying publication and cleaning temporary data' : 'Removing saved analysis');
      const removed = [];
      await logicalTransaction(db, STORE, 'readwrite', (tx, abort) => {
        const store = tx.objectStore(STORE);
        // Repeat the checkpoint check in the same transaction as deletion.
        const scan = store.openKeyCursor();
        const roots = [], transactionKeys = [];
        scan.onsuccess = () => {
          try {
            const cursor = scan.result;
            if (cursor) {
              transactionKeys.push(cursor.primaryKey);
              if (typeof cursor.key === 'string' && !part(cursor.key) && cursor.key.startsWith(`functional-decomposition-checkpoint:${item.scope}:`)) throw new Error('New recoverable work appeared. Cleanup cancelled.');
              if (targetRoot(cursor.key, item)) roots.push(cursor.key);
              cursor.continue(); return;
            }
            const remove = () => {
              // Resolve both deleted and surviving trees in this transaction.
              // References, never key resemblance, decide chunk reclamation.
              if (!roots.length && !transactionKeys.includes(`${item.scope}:storage-cleanup-pending`)) throw new Error('Saved item changed or was already removed. Refresh and review it before cleanup.');
              const allParts = new Set(transactionKeys.filter(part));
              const deletedParts = new Set(), survivingParts = new Set();
              let pending = 0, uncertain = false;
              const finish = () => {
                if (pending) return;
                try {
                for (const key of roots) { store.delete(key); removed.push(key); }
                if (!uncertain && !recoveryPresent) for (const key of deletedParts) if (within(key,item.scope) && !survivingParts.has(key)) store.delete(key);
                if (item.type === 'architecture') {
                  store.put({ key: `${item.scope}:storage-deleted`, value: { deletedAt: new Date().toISOString() } });
                  store.put({ key: `${item.scope}:storage-cleanup-pending`, value: true });
                }
                } catch(error) {abort(error);}

              };
              const reads = [], rootSet = new Set(roots);
              let activeReads = 0;
              const readEntry = entry => {
                const read=store.get(entry.key);
                activeReads++;
                read.onsuccess=()=>{
                  try {
                    const value=read.result?.value;
                    if(entry.chunk) {
                      if(typeof value !== 'string') uncertain=true;
                      else {try{walk(JSON.parse(value),entry.reached);}catch{uncertain=true;}}
                    } else walk(value,entry.reached);
                    activeReads--;pending--;
                    drainReads();finish();
                  } catch(error) {abort(error);}
                };
              };
              const drainReads = () => {
                while (activeReads < 16 && reads.length) readEntry(reads.shift());
              };
              const walk = (value, reached) => {
                const stack = [value];
                while (stack.length) {
                  const node = stack.pop();
                  if (typeof node === 'string' && allParts.has(node)) {
                    if (reached.has(node)) continue;
                    reached.add(node); pending++;
                    reads.push({key:node,reached,chunk:true});
                  } else if (typeof node === 'string' && node.includes(':$part:')) uncertain = true;
                  else if (node && typeof node === 'object') { for (const child of Object.values(node)) stack.push(child); };
                }
              };
              const allRoots = transactionKeys.filter(key => !part(key));
              pending = allRoots.length;
              allRoots.forEach(key => reads.push({key,reached:rootSet.has(key) ? deletedParts : survivingParts,chunk:false}));
              drainReads();
              finish();
            };
            const metadata = store.get(`${item.scope}:metadata`);
            metadata.onsuccess = () => {
              try {
                const meta = metadata.result?.value;
                if (item.savedAt && item.savedAt !== (meta?.updatedAt || meta?.sourceAnalysis?.publishedAt || null)) throw new Error('Saved analysis changed since it was listed. Refresh and review it before cleanup.');
                if (item.type !== 'temporary') { remove(); return; }
                if (!publicationVerified(meta,item.scope,transactionKeys)) throw new Error('Successful publication cannot be verified. Temporary data is retained for recovery.');
                remove();
              } catch (error) { abort(error); }
            };
          } catch (error) { abort(error); }
        };
      });
      if (item.type === 'architecture') {
        storage.removeItem(item.scope);
        storage.removeItem(`cbaMeta:${item.projectId}:${item.repoId}`);
      }
      reconcile(item);
      onProgress('Verifying saved work was removed');
      const remaining = await logicalKeys(db, STORE);
      if (remaining.some(key => targetRoot(key, item))) throw new Error('Saved work remains. Refresh and retry cleanup.');
      if (item.type === 'architecture') await logicalTransaction(db,STORE,'readwrite',tx => tx.objectStore(STORE).delete(`${item.scope}:storage-cleanup-pending`));
      return { removedRoots: removed.length, limitation: 'Shared and uncertain internal data was retained to protect surviving results and recovery.' };
    } finally { db.close(); }
  }), 30000);
}


async function inventoryArtifactItems(projects, storage = localStorage) {
  const db = await openLogicalStorage('xhandle-code-architecture-assurance');
  try {
    const keys = await logicalKeys(db, 'artifactRows');
    for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith('xhandle:cba-')) keys.push(key); }
    const assigned = new Set(), items = [];
    for (const entry of scopesForProjects(projects)) {
      const {project,repo,scope} = entry;
      for (const [kind, definition] of Object.entries(ARTIFACT_DEFINITIONS)) {
        const key = storageKeyFor(kind, project.id, repo.id);
        if (!keys.includes(key) && !keys.includes(`${key}:storage-cleanup-pending`)) continue;
        const eligible = architectureScopeEligible(entry, projects) && !artifactStorageBusy(key);
        keys.filter(value => value === key || (typeof value === 'string' && value.startsWith(`${key}:chunk:`))).forEach(value => assigned.add(value));
        items.push({id:`artifact/${key}`, type:'artifact', key, kind, scope, projectId:project.id, repoId:repo.id, workspaceType:project.workspaceType,
          label:definition.title, repository:repo.repoName || repo.name || 'Repository', state:keys.includes(`${key}:storage-cleanup-pending`) ? 'Cleanup needs verification; retry to finish' : 'Saved collection', recoverable:false,
          eligible, reason:eligible ? '' : 'Ownership is ambiguous or requirements are still being saved. Refresh after saving finishes.'});
      }
    }
    return {items, unassigned:keys.some(key => !assigned.has(key))};
  } finally { db?.close(); }
}

async function deleteArtifactItem(item, {getProjects,isBusy,reconcile,onProgress,storage}) {
  return withWorkspaceGraphMigrationPaused(() => withArtifactStorageCleanup(item.key, async () => {
    onProgress('Checking requirements and ownership');
    const projects = await readCurrentProjects(getProjects);
    const entry = scopesForProjects(projects).find(entry => entry.scope === item.scope);
    if (!entry || !architectureScopeEligible(entry,projects) || storageKeyFor(item.kind,entry.project.id,entry.repo.id) !== item.key || !ARTIFACT_DEFINITIONS[item.kind]) throw new Error('Requirements ownership could not be verified. Refresh and retry.');
    if (isBusy(item.scope)) throw new Error('Analysis is still running. Wait for it to finish before cleanup.');
    storage.setItem(`${item.key}:storage-cleanup-pending`, 'true');
    onProgress('Removing saved requirement representations');
    await cleanGraphArchitecture(item);
    const db = await openLogicalStorage('xhandle-code-architecture-assurance');
    try {
      onProgress('Removing saved requirements and their data');
      if (db?.objectStoreNames.contains('artifactRows')) {
        await logicalTransaction(db,'artifactRows','readwrite',(tx,abort)=>{
          const store=tx.objectStore('artifactRows'), root=store.get(item.key);
          root.onsuccess=()=>{
            try {
              const references=new Set(Array.isArray(root.result?.chunkKeys) ? root.result.chunkKeys : []);
              const request=store.openKeyCursor();
              request.onsuccess=()=>{
                try {
                  const cursor=request.result;
                  if (!cursor) {store.delete(item.key);return;}
                  const key=cursor.primaryKey;
                  if (key!==item.key && (references.has(key) || (typeof key==='string' && key.startsWith(`${item.key}:chunk:`)))) {
                    const page=store.get(key);
                    page.onsuccess=()=>{
                      try {
                        // A page is exclusive only when its explicit parent
                        // agrees. Similar keys alone cannot establish ownership.
                        if(page.result?.parentKey===item.key)store.delete(key);
                        cursor.continue();
                      }catch(error){abort(error);}
                    };
                  }else cursor.continue();
                }catch(error){abort(error);}
              };
            }catch(error){abort(error);}
          };
        });
      }
      storage.removeItem(item.key);
      reconcile(item);
      onProgress('Verifying requirements were removed');
      const remaining = await logicalKeys(db,'artifactRows');
      if (remaining.includes(item.key) || storage.getItem(item.key) !== null) throw new Error('Saved requirements remain. Refresh and retry.');
      storage.removeItem(`${item.key}:storage-cleanup-pending`);
      return {limitation:'Other saved work, processing caches and connections were preserved.'};
    } finally { db?.close(); }
  }),30000);
}


const HAZARD_DB = 'xhandle-code-architecture-hazard-analysis';
const HAZARD_FALLBACK = 'xhandle:code-architecture-hazard-analysis:v1';
async function hazardMetadataRows(db) {
  const rows=[];
  if (db?.objectStoreNames.contains('runMetadata')) await logicalTransaction(db,'runMetadata','readonly',(tx,abort) => {
    const request=tx.objectStore('runMetadata').openCursor();
    request.onsuccess=()=>{try{const cursor=request.result;if(cursor){rows.push(cursor.value);cursor.continue();}}catch(error){abort(error);}};
  });
  return rows;
}
function hazardFallback(storage) {
  const raw=storage.getItem(HAZARD_FALLBACK);
  if (raw === null) return null;
  let value;
  try {value=JSON.parse(raw);} catch {throw new Error('Saved hazard fallback is damaged. Restore or repair it before cleanup.');}
  if (!Array.isArray(value?.hazardAnalysisRuns)) throw new Error('Saved hazard fallback is unavailable. Restore or repair it before cleanup.');
  return value;
}
async function inventoryHazardItems(projects) {
  const db=await openLogicalStorage(HAZARD_DB);
  try {
    const rows=await hazardMetadataRows(db), roots=await logicalKeys(db,'hazardAnalysisRuns');
    // A legacy fallback contains full runs. Do not parse it merely to list work.
    const fallbackPresent=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).includes(HAZARD_FALLBACK);
    const checkpoints=await logicalKeys(db,'generationCheckpoints');
    const items=[], assigned=new Set();
    for(const entry of scopesForProjects(projects)) {
      const {project,repo,scope}=entry;
      const analysisRepoId=repo.repoId ?? repo.id;
      const connections=scopesForProjects(projects).filter(other=>String(other.project.id)===String(project.id) && String(other.repo.repoId ?? other.repo.id)===String(analysisRepoId));
      if(connections.length!==1)continue;
      const owned=rows.filter(row=>String(row.projectId)===String(project.id) && String(row.repoId)===String(analysisRepoId));
      if (!owned.length) continue;
      const eligible=owned.every(row=>validId(row.id)) && architectureScopeEligible(entry,projects) && !checkpoints.length && !hazardStorageBusy(project.id,analysisRepoId) && !fallbackPresent;
      if (architectureScopeEligible(entry,projects)) owned.forEach(row=>assigned.add(row.id));
      items.push({id:`${scope}/hazards`,type:'hazards',scope,projectId:project.id,repoId:repo.id,workspaceType:project.workspaceType,
        analysisRepoId,label:'Hazard analyses',repository:repo.repoName || repo.name || 'Repository',state:owned.some(row=>!roots.includes(row.id)) ? 'Cleanup needs verification; retry to finish' : 'Saved results',recoverable:!!checkpoints.length,
        savedAt:owned.map(row=>row.updatedAt || row.createdAt || '').sort().pop() || null,eligible,
        reason:eligible ? '' : 'Hazard work is pending, legacy fallback data needs inspection, or ownership cannot be verified. Recovery data is preserved.'});
    }
    return {items,unassigned:fallbackPresent || roots.some(key=>!assigned.has(key)) || !!checkpoints.length};
  } finally {db?.close();}
}

async function deleteHazardItem(item,{getProjects,isBusy,reconcile,onProgress,storage}) {
  return withWorkspaceGraphMigrationPaused(()=>withHazardStorageCleanup(item.projectId,item.analysisRepoId ?? item.repoId,async()=>{
    onProgress('Checking hazard results and recovery');
    const projects=await readCurrentProjects(getProjects),entry=scopesForProjects(projects).find(entry=>entry.scope===item.scope);
    if (!entry || !architectureScopeEligible(entry,projects) || String(entry.repo.repoId ?? entry.repo.id)!==String(item.analysisRepoId ?? item.repoId) || scopesForProjects(projects).filter(other=>String(other.project.id)===String(item.projectId) && String(other.repo.repoId ?? other.repo.id)===String(item.analysisRepoId ?? item.repoId)).length!==1) throw new Error('Hazard ownership could not be verified. Refresh and retry.');
    if (isBusy(item.scope)) throw new Error('Analysis is running. Wait for it to finish.');
    if (hazardFallback(storage)) throw new Error('Legacy hazard results require inspection before whole-item cleanup. Existing results were preserved.');
    const db=await openLogicalStorage(HAZARD_DB);
    if (!db?.objectStoreNames.contains('runMetadata') || !db.objectStoreNames.contains('hazardAnalysisRuns')) {db?.close();throw new Error('Saved hazard results are unavailable.');}
    try {
      if ((await logicalKeys(db,'generationCheckpoints')).length) throw new Error('Recoverable hazard work is present. Resume or resolve it before cleanup.');
      const allRows=await hazardMetadataRows(db);
      const rows=allRows.filter(row=>String(row.projectId)===String(item.projectId) && String(row.repoId)===String(item.analysisRepoId ?? item.repoId));
      if (rows.some(row=>allRows.some(other=>other.id!==row.id && (String(other.id).startsWith(`${row.id}:summary:`) || String(row.id).startsWith(`${other.id}:summary:`))))) throw new Error('Ambiguous hazard result identities. Cleanup was cancelled.');
      const ids=new Set(rows.map(row=>row.id));
      if (!ids.size) throw new Error('Saved hazard results changed. Refresh and retry.');
      onProgress('Removing saved hazard diagram representations');
      await cleanHazardGraph(item,ids);
      onProgress('Removing saved hazard results');
      const stores=['runMetadata','hazardAnalysisRuns',...(db.objectStoreNames.contains('generationCheckpoints')?['generationCheckpoints']:[])];
      await logicalTransaction(db,stores,'readwrite',(tx,abort)=>{
        const remove=()=>{
          for(const id of ids){
            const request=tx.objectStore('runMetadata').get(id);
            request.onsuccess=()=>{
              try {
                const row=request.result;
                if (!row || String(row.projectId)!==String(item.projectId) || String(row.repoId)!==String(item.analysisRepoId ?? item.repoId)) throw new Error('Hazard ownership changed. Cleanup cancelled.');
                const payload=tx.objectStore('hazardAnalysisRuns').get(id);
                payload.onsuccess=()=>{
                  try {
                    if(payload.result && (String(payload.result.projectId)!==String(item.projectId) || String(payload.result.repoId)!==String(item.analysisRepoId ?? item.repoId))) throw new Error('Hazard payload ownership conflicts. Cleanup cancelled.');
                    tx.objectStore('hazardAnalysisRuns').delete(id);
                  }catch(error){abort(error);}
                };
              }catch(error){abort(error);}
            };
          }
        };
        if(!stores.includes('generationCheckpoints')) {remove();return;}
        const check=tx.objectStore('generationCheckpoints').count();
        check.onsuccess=()=>{if(check.result)abort(new Error('Recoverable hazard work appeared. Cleanup cancelled.'));else remove();};
      });
      reconcile(item);
      onProgress('Verifying hazard results were removed');
      await logicalTransaction(db,'runMetadata','readwrite',tx=>{for(const id of ids)tx.objectStore('runMetadata').delete(id);});
      const remaining=await logicalKeys(db,'hazardAnalysisRuns'),metadata=await logicalKeys(db,'runMetadata');
      if ([...ids].some(id=>remaining.includes(id)||metadata.includes(id))) throw new Error('Hazard results remain. Refresh and retry.');
      return {limitation:'Shared and uncertain hazard pages and table caches were retained to protect recovery. Other saved work was preserved.'};
    }finally{db.close();}
  }),30000);
}
async function cleanHazardGraph(item,ids) {
  const db=await openLogicalStorage('xhandle-workspace-graph');
  if(!db)return;
  try {
    const stores=['artifacts','runs','relationships'].filter(name=>db.objectStoreNames.contains(name)),removed=new Set();
    if(!stores.length)return;
    await logicalTransaction(db,stores,'readwrite',(tx,abort)=>{
      let pending=stores.filter(name=>name!=='relationships').length;
      const links=()=>{
        if(--pending>0 || !stores.includes('relationships'))return;
        const request=tx.objectStore('relationships').openCursor();
        request.onsuccess=()=>{try{const cursor=request.result;if(cursor){if(removed.has(cursor.value.fromArtifactId)||removed.has(cursor.value.toArtifactId))cursor.delete();cursor.continue();}}catch(error){abort(error);}};
      };
      for(const name of stores.filter(name=>name!=='relationships')){
        const request=tx.objectStore(name).openCursor();
        request.onsuccess=()=>{
          try {
            const cursor=request.result;
            if(!cursor){links();return;}
            const row=cursor.value;
            const matches=row.sourceStore==='indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns' &&
              [...ids].some(id=>row.sourceId===String(id) || (name==='artifacts' && typeof row.sourceId==='string' && row.sourceId.startsWith(`${id}:summary:`)));
            if(matches){
              if(String(row.projectId)!==String(item.projectId)||row.workspaceId!=='workspace:local')throw new Error('Hazard workspace ownership conflicts. Cleanup stopped.');
              removed.add(row.id);cursor.delete();
            }
            cursor.continue();
          }catch(error){abort(error);}
        };
      }
    });
  }finally{db.close();}
}


// These older formats have no small per-item publication/write-ownership
// metadata. Show recognizable roots when exact keys prove project identity,
// but never promise safe whole-item deletion while App owns their fallback,
// recovery and autosave state. Unknown owners remain in Advanced.
async function inventoryLegacyProjectItems(projects) {
  const items=[],warnings=[];
  let unassigned=false;
  for(const spec of [
    {db:'xhandle-project-hazard-analysis',store:'analyses',label:'Project hazard analysis'},
    {db:'xhandle-project-reports',store:'safetyIssueReports',label:'Safety issue report',fallback:'xhandle.safetyIssueReport:'},
  ]) {
    let db;
    try {
      db=await openLogicalStorage(spec.db);
      const keys=await logicalKeys(db,spec.store);
      const localKeys=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index));
      const assigned=new Set();
      for(const project of projects.filter(project=>project.workspaceType==='functional')) {
        const aliases=keys.filter(key=>validId(key) && String(key)===String(project.id));
        const fallback=spec.fallback && localKeys.includes(`${spec.fallback}${project.id}`);
        if(!aliases.length && !fallback)continue;
        if(projects.filter(other=>String(other.id)===String(project.id)).length!==1){unassigned=true;continue;}
        aliases.forEach(key=>assigned.add(key));
        items.push({id:`${project.workspaceType}:${project.id}/${spec.store}`,type:'legacy',projectId:project.id,workspaceType:project.workspaceType,
          label:spec.label,repository:'Project saved work',state:'Saved; whole-item cleanup unavailable',eligible:false,recoverable:false,
          reason:'This older format has linked recovery and fallback data. Use Advanced storage details for inspection. Normal project removal keeps saved work recoverable.'});
      }
      unassigned ||= keys.some(key=>!assigned.has(key));
      if(spec.fallback && localKeys.some(key=>key.startsWith(spec.fallback) && !projects.some(project=>project.workspaceType==='functional' && key===`${spec.fallback}${project.id}`))) unassigned=true;
    }catch(error){warnings.push(`${spec.label} inventory unavailable: ${error.message}`);}
    finally{db?.close();}
  }
  return {items,warnings,unassigned};
}
