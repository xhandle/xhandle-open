import { projectArtifact } from './workspaceGraphProjection';
import { openWorkspaceGraphDB, ensureWorkspaceGraphDb as ensureDb } from "./workspaceGraphDb";
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_GRAPH_STORES,
  type ArtifactFilters,
  type RelationshipFilters,
  type WorkspaceArtifact,
  type WorkspaceChange,
  type WorkspaceEvidence,
  type WorkspaceFolder,
  type WorkspaceProject,
  type WorkspaceRelationship,
  type WorkspaceReview,
  type WorkspaceRun,
  type WorkspaceSourceFile,
  type WorkspaceSummary,
} from "./workspaceGraphTypes";

const nowISO = () => new Date().toISOString();
let revisionSequence=0;
function touchGraph(tx:any){return tx.objectStore('workspaces').put({id:'graph-data-revision',token:`${Date.now()}:${++revisionSequence}:${Math.random()}`});}
async function putGraphRow(db:any,store:string,row:any){const tx=db.transaction([store,'workspaces'],'readwrite');await Promise.all([tx.objectStore(store).put(row),touchGraph(tx)]);await tx.done;}
async function initializeEmptyProjection(tx:any) {
  const state=await tx.objectStore('workspaces').get('artifact-projection-v1');
  // Remember an incomplete legacy projection too. Recounting the entire legacy
  // body store for every 256-row batch makes a scoped rebuild quadratic in I/O.
  // This marker does not certify completeness; projection repair still does that.
  if (state) return;
  const [artifacts,index]=await Promise.all([tx.objectStore('artifacts').count(),tx.objectStore('artifactIndex').count()]);
  // All subsequent repository writes update both stores in this transaction.
  // A legacy nonempty database still needs the existing projection repair.
  if (artifacts===0 && index===0) {
    await tx.objectStore('workspaces').put({id:'artifact-projection-v1',complete:true});
    await tx.objectStore('workspaces').put({id:'artifact-read-hints-v1',complete:true});
  } else {
    await tx.objectStore('workspaces').put({id:'artifact-projection-v1',complete:false});
  }
}


function stamp<T extends { id: string; createdAt?: string; updatedAt?: string; workspaceId?: string; version?: number }>(record: T): T {
  const now = nowISO();
  return {
    ...record,
    workspaceId: record.workspaceId || DEFAULT_WORKSPACE_ID,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    version: Number(record.version || 1),
  };
}

function matchesProject<T extends { projectId?: string }>(row: T, projectId?: string | null) {
  return !projectId || !row.projectId || row.projectId === projectId;
}

function typeSet(type?: string | string[]) {
  if (!type) return null;
  return new Set(Array.isArray(type) ? type : [type]);
}

function sortByUpdatedThenId<T extends { id: string; updatedAt?: string }>(rows: T[]) {
  return rows.sort((a, b) => (
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) ||
    String(a.id).localeCompare(String(b.id))
  ));
}

export const ensureWorkspaceGraphDb = ensureDb;

export async function upsertProject(project: WorkspaceProject) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(project);
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.projects, row);
  db.close();
  return row;
}

export async function upsertFolder(folder: WorkspaceFolder) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(folder);
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.folders, row);
  db.close();
  return row;
}

export async function upsertArtifact(artifact: WorkspaceArtifact) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(artifact);
  const tx=db.transaction(["artifacts","artifactIndex","workspaces"],"readwrite");
  await initializeEmptyProjection(tx);
  await Promise.all([tx.objectStore("artifacts").put(row),tx.objectStore("artifactIndex").put(projectArtifact(row))]);
  await touchGraph(tx);
  await tx.done;
  db.close();
  return row;
}

export async function upsertArtifacts(artifacts: WorkspaceArtifact[] = []) {
  const db = await openWorkspaceGraphDB();
  const tx = db.transaction(["artifacts","artifactIndex","workspaces"], "readwrite");
  await initializeEmptyProjection(tx);
  const rows = artifacts.filter(Boolean).map(stamp);
  const writable=await Promise.all(rows.map(async row=>{
    const fallbackHazard=row.sourceStore==='localStorage:xhandle.projectData'&&['risk','hazard_analysis_row'].includes(row.type);
    const fallbackFile=row.type==='source_file'&&row.sourceStore==='indexedDB:xhandle/copilot_baseline';
    if(fallbackHazard||fallbackFile){
      const existing=await tx.objectStore('artifactIndex').get(row.id);
      if(fallbackHazard&&existing?.sourceStore==='indexedDB:xhandle-project-hazard-analysis/analyses')return null;
      if(fallbackFile&&existing?.sourceStore==='indexedDB:xhandle/code_index')return null;
    }
    return row;
  }));
  await Promise.all(writable.filter(Boolean).flatMap((row) => [tx.objectStore("artifacts").put(row!),tx.objectStore("artifactIndex").put(projectArtifact(row!))]));
  await touchGraph(tx);
  await tx.done;
  db.close();
  return rows;
}

export async function upsertRelationship(relationship: WorkspaceRelationship) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(relationship);
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.relationships, row);
  db.close();
  return row;
}

export async function upsertRelationships(relationships: WorkspaceRelationship[] = []) {
  const db = await openWorkspaceGraphDB();
  const tx = db.transaction([WORKSPACE_GRAPH_STORES.relationships,"workspaces"], "readwrite");
  const rows = relationships.filter(Boolean).map(stamp);
  await Promise.all(rows.map((row) => tx.objectStore("relationships").put(row)));
  await touchGraph(tx);
  await tx.done;
  db.close();
  return rows;
}

export async function upsertRun(run: WorkspaceRun) {
  const db = await openWorkspaceGraphDB();
  const row = stamp({...run,projectId:run.projectId||""});
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.runs, row);
  db.close();
  return row;
}

export async function upsertReview(review: WorkspaceReview) {
  const db = await openWorkspaceGraphDB();
  const row = stamp({...review,projectId:review.projectId||""});
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.reviews, row);
  db.close();
  return row;
}

export async function upsertEvidence(evidence: WorkspaceEvidence) {
  const db = await openWorkspaceGraphDB();
  const row = stamp({...evidence,projectId:evidence.projectId||""});
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.evidence, row);
  db.close();
  return row;
}

export async function upsertSourceFile(sourceFile: WorkspaceSourceFile) {
  const db = await openWorkspaceGraphDB();
  const row = stamp({...sourceFile,projectId:sourceFile.projectId||""});
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.sourceFiles, row);
  db.close();
  return row;
}

export async function upsertSourceFiles(sourceFiles: WorkspaceSourceFile[]) {
  const db = await openWorkspaceGraphDB();
  try {
    const rows = sourceFiles.map(row => stamp({...row,projectId:row.projectId||""}));
    const tx = db.transaction(['sourceFiles','workspaces'],'readwrite');
    await Promise.all(rows.map(row => tx.objectStore('sourceFiles').put(row)));
    await touchGraph(tx);
    await tx.done;
    return rows;
  } finally { db.close(); }
}

export async function upsertSummary(summary: WorkspaceSummary) {
  const db = await openWorkspaceGraphDB();
  const row = stamp(summary);
  await putGraphRow(db, WORKSPACE_GRAPH_STORES.summaries, row);
  db.close();
  return row;
}

// Only prune mirrors of sources which were read successfully in this snapshot.
// The authoritative stores and retained workspace project records are untouched.
export async function reconcileWorkspaceGraphSources({ sourceStores, ids, retainedKeys, fullRefresh = false, projectIds }: {
  sourceStores: Set<string>;
  ids: Record<string, Set<string>>;
  retainedKeys?: Map<string, Set<string>>;
  fullRefresh?: boolean;
  projectIds?: string[];
}) {
  // A pass whose steps were all already fresh has no source records to prune.
  // Do not walk every project artifact merely to discover that fact per row.
  if (!sourceStores.size) return 0;
  const db = await openWorkspaceGraphDB();
  const stores = ["artifacts", "artifactIndex", "relationships", "runs", "reviews", "evidence", "sourceFiles"] as const;
  let deleted = 0;
  try {
    const tx = db.transaction([...stores,"workspaces"], "readwrite");
    tx.done.catch(() => {});
    try {
      for (const name of stores) {
        // A complete refresh already knows the IDs of all retained records.
        // Scan bounded key pages and inspect only obsolete candidates, avoiding
        // one value-cursor round trip per freshly indexed row in every store.
        if (fullRefresh && !projectIds?.length) {
          let after:IDBValidKey|undefined;
          const desired=ids[name === 'artifactIndex' ? 'artifacts' : name];
          while (true) {
            const keys=await tx.objectStore(name).getAllKeys(after===undefined?undefined:IDBKeyRange.lowerBound(after,true),256);
            if (!keys.length) break;
            for (const key of keys) {
              if (desired?.has(String(key))) continue;
              const row:any=(name==='artifacts' ? await tx.objectStore('artifactIndex').get(key as string) : null) || await tx.objectStore(name).get(key as string);
              if (!row || !sourceStores.has(row.sourceStore)) continue;
              const retainedIdentity=['artifacts','artifactIndex','workspaces'].includes(name)&&['project','folder'].includes(row.type);
              if (!retainedIdentity && !retainedKeys?.get(row.sourceStore)?.has(String(row.sourceKey||''))) {
                await tx.objectStore(name).delete(key as string); deleted++;
              }
            }
            after=keys[keys.length-1];
          }
          continue;
        }
        for (const source of projectIds?.length ? projectIds : sourceStores) {
          // Key cursors never clone the large saved body for records that this
          // pass already retained. Scoped passes never traverse another project.
          let cursor = await tx.objectStore(name).index(projectIds?.length ? 'by_project' : 'by_source_store').openKeyCursor(source);
          while (cursor) {
            const desired=ids[name === "artifactIndex" ? "artifacts" : name];
            if(desired?.has(String(cursor.primaryKey))){cursor=await cursor.continue();continue;}
            const row:any=(name==='artifacts'?await tx.objectStore('artifactIndex').get(cursor.primaryKey as string):null)||await tx.objectStore(name).get(cursor.primaryKey as string);
            if(!row||!sourceStores.has(row.sourceStore)){cursor=await cursor.continue();continue;}
            const retainedIdentity = ["artifacts","artifactIndex","workspaces"].includes(name) && ["project", "folder"].includes(row.type);
            const kept = retainedKeys?.get(row.sourceStore)?.has(String(row.sourceKey || ""));
            if (!retainedIdentity && !kept && !desired?.has(String(row.id))) {
              await tx.objectStore(name).delete(cursor.primaryKey as string); deleted += 1;
            }
            cursor = await cursor.continue();
          }
        }
      }
      if(deleted)await touchGraph(tx);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch {}
      await tx.done.catch(() => {});
      throw error;
    }
    return deleted;
  } finally { db.close(); }
}

export async function listProjects() {
  const db = await openWorkspaceGraphDB();
  try {
    const rows = await db.getAll(WORKSPACE_GRAPH_STORES.projects);
    return rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  } finally { db.close(); }
}

export async function listArtifacts(filters: ArtifactFilters = {}) {
  const db = await openWorkspaceGraphDB();
  let rows;
  try {
    if (filters.sourceStore) rows=await db.getAllFromIndex('artifacts','by_source_store',filters.sourceStore);
    else if (typeof filters.type === 'string') rows=await db.getAllFromIndex('artifacts','by_type',filters.type);
    else rows=await db.getAll('artifacts');
  } finally { db.close(); }
  const types = typeSet(filters.type);
  rows = rows.filter((row) => matchesProject(row, filters.projectId));
  if (types) rows = rows.filter((row) => types.has(row.type));
  if (filters.sourceStore) rows = rows.filter((row) => row.sourceStore === filters.sourceStore);
  if (filters.sourceKey) rows = rows.filter((row) => row.sourceKey === filters.sourceKey);
  if (filters.sourceId) rows = rows.filter((row) => row.sourceId === filters.sourceId);
  sortByUpdatedThenId(rows);
  return typeof filters.limit === "number" ? rows.slice(0, filters.limit) : rows;
}

export async function listRelationships(filters: RelationshipFilters = {}) {
  const db = await openWorkspaceGraphDB();
  let rows;
  try {
    const store=db.transaction('relationships').store;
    if(filters.fromArtifactId)rows=await store.index('by_from').getAll(filters.fromArtifactId,filters.projectId||filters.type?undefined:filters.limit);
    else if(filters.toArtifactId)rows=await store.index('by_to').getAll(filters.toArtifactId,filters.projectId||filters.type?undefined:filters.limit);
    else rows=await db.getAll('relationships');
  } finally {db.close();}
  const types = typeSet(filters.type);
  rows = rows.filter((row) => matchesProject(row, filters.projectId));
  if (types) rows = rows.filter((row) => types.has(row.type));
  if (filters.fromArtifactId) rows = rows.filter((row) => row.fromArtifactId === filters.fromArtifactId);
  if (filters.toArtifactId) rows = rows.filter((row) => row.toArtifactId === filters.toArtifactId);
  return typeof filters.limit === "number" ? rows.slice(0, filters.limit) : rows;
}

async function listRecent(store: "runs"|"reviews"|"evidence"|"sourceFiles",projectId:string|null|undefined,limit:number) {
  const db=await openWorkspaceGraphDB();
  try {
    const rows:any[]=[];
    for(const owner of projectId?[projectId,'']:[null]){
      const tx=db.transaction(store);
      const source=owner!==null?tx.store.index('by_project_updated' as any):tx.store.index('by_updated' as any);
      const range=owner!==null?IDBKeyRange.bound([owner,''],[owner,'\uffff','\uffff']):undefined;
      let cursor=await source.openCursor(range,'prev'),count=0;
      while(cursor&&count<limit){rows.push(cursor.value);count++;cursor=await cursor.continue();}
      await tx.done;
    }
    return sortByUpdatedThenId(rows).slice(0,limit);
  }finally{db.close();}
}
export const listRuns=(projectId?:string|null,limit=80)=>listRecent('runs',projectId,limit);
export const listReviews=(projectId?:string|null,limit=100)=>listRecent('reviews',projectId,limit);
export const listEvidence=(projectId?:string|null,limit=80)=>listRecent('evidence',projectId,limit);
export const listSourceFiles=(projectId?:string|null,limit=40)=>listRecent('sourceFiles',projectId,limit);

export async function getArtifact(id: string) {
  const db = await openWorkspaceGraphDB();
  const row = await db.get(WORKSPACE_GRAPH_STORES.artifacts, id);
  db.close();
  return row || null;
}

export async function deleteArtifacts(filters: ArtifactFilters = {}) {
  const rows = await listArtifacts(filters);
  if (!rows.length) return 0;
  const ids = new Set(rows.map((row) => row.id));
  const db = await openWorkspaceGraphDB();
  const tx = db.transaction(
    [WORKSPACE_GRAPH_STORES.artifacts, "artifactIndex", WORKSPACE_GRAPH_STORES.relationships, "workspaces"],
    "readwrite"
  );
  const relationships = await tx.objectStore(WORKSPACE_GRAPH_STORES.relationships).getAll();
  await Promise.all([
    ...rows.flatMap((row) => [tx.objectStore(WORKSPACE_GRAPH_STORES.artifacts).delete(row.id),tx.objectStore("artifactIndex").delete(row.id)]),
    ...relationships
      .filter((relationship) => ids.has(relationship.fromArtifactId) || ids.has(relationship.toArtifactId))
      .map((relationship) => tx.objectStore(WORKSPACE_GRAPH_STORES.relationships).delete(relationship.id)),
  ]);
  await touchGraph(tx);
  await tx.done;
  db.close();
  return rows.length;
}

export async function getNeighborhood(artifactId: string, { depth = 1 } = {}) {
  const seen = new Set<string>([artifactId]);
  const artifacts = new Map<string, WorkspaceArtifact>();
  const relationships: WorkspaceRelationship[] = [];
  let frontier = new Set<string>([artifactId]);

  for (let level = 0; level < Math.max(1, depth); level += 1) {
    const allRels = (await Promise.all([...frontier].slice(0,24).flatMap(id => [listRelationships({fromArtifactId:id,limit:100}),listRelationships({toArtifactId:id,limit:100})]))).flat().slice(0,200);
    const next = new Set<string>();
    const currentFrontier = new Set(frontier);
    allRels.forEach((rel) => {
      if (!currentFrontier.has(rel.fromArtifactId) && !currentFrontier.has(rel.toArtifactId)) return;
      relationships.push(rel);
      [rel.fromArtifactId, rel.toArtifactId].forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          next.add(id);
        }
      });
    });
    frontier = next;
    if (!frontier.size) break;
  }

  await Promise.all(Array.from(seen).map(async (id) => {
    const artifact = await getArtifact(id);
    if (artifact) artifacts.set(id, artifact);
  }));

  return { artifacts: Array.from(artifacts.values()), relationships: Array.from(new Map(relationships.map((rel) => [rel.id, rel])).values()) };
}

export async function recordChange(change: Omit<WorkspaceChange, "id" | "at"> & Partial<Pick<WorkspaceChange, "id" | "at">>) {
  const db = await openWorkspaceGraphDB();
  const at = change.at || nowISO();
  const row = {
    ...change,
    id: change.id || `change:${change.entityType}:${change.entityId}:${Date.now()}`,
    at,
    workspaceId: change.workspaceId || DEFAULT_WORKSPACE_ID,
  } as WorkspaceChange;
  await db.put(WORKSPACE_GRAPH_STORES.changeLog, row);
  db.close();
  return row;
}
