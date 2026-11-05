import { iterateRecordRows, readSourceFileProjection, iterateHazardSummary } from './workspaceSourcePages';
import shajs from 'sha.js';
import { openWorkspaceGraphDB } from './workspaceGraphDb';
import { yieldIndexWork, ensureWorkspaceProjection } from './workspaceGraphQueries';
import { boundedValue } from './workspaceGraphProjection';
import { wrap } from 'idb';
import { hydrateHazardRun, isChunkedHazardRun } from '../code-architecture-hazard-analysis/hazardRunChunks';
import { hydrateRecord, isRecordPart, requestValue } from '../code-architecture-storage/chunkedRecord';
import {
  upsertArtifacts,
  getArtifact,
  upsertEvidence as persistEvidence,
  upsertFolder,
  upsertProject,
  upsertRelationships,
  upsertReview as persistReview,
  upsertRun as persistRun,
  upsertSourceFiles as persistSourceFiles,
  reconcileWorkspaceGraphSources,
} from "./workspaceGraphRepository";
import {
  DEFAULT_WORKSPACE_ID,
  type WorkspaceArtifact,
  type WorkspaceRelationship,
  type WorkspaceRelationshipType,
} from "./workspaceGraphTypes";

import { workspaceGraphSourceSnapshot, sameWorkspaceGraphSources, INDEX_DIRTY_PREFIX } from './workspaceGraphFreshness';

export type WorkspaceIndexProgress = {step:string;durationMs:number;complete:boolean;recordsPrepared?:number};
export type MigrationOptions = { mode?: "incremental" | "full"; signal?: AbortSignal; force?: boolean; steps?:string[]; projectIds?:string[]; onProgress?:(value:WorkspaceIndexProgress)=>void };


const MIGRATION_VERSION = 7;
export const WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY = "xhandle.workspaceGraph.lastMigration";

const nowISO = () => new Date().toISOString();

let successfulSources: Set<string> | null = null;
let auxiliaryIds: Record<string, Set<string>> = {};

function remember(store: string, row: any) {
  if(activeRoot&&row.sourceStore===activeRoot.source)row.sourceKey ||= activeRoot.key;
  (auxiliaryIds[store] ||= new Set()).add(String(row.id));
  return row;
}
const upsertEvidence = (row: any) => includedProject(row.projectId)?persistEvidence(remember("evidence", row)):Promise.resolve();
const upsertReview = (row: any) => includedProject(row.projectId)?persistReview(remember("reviews", row)):Promise.resolve();
const upsertRun = (row: any) => includedProject(row.projectId)?persistRun(remember("runs", row)):Promise.resolve();
let pendingSourceFiles:any[]=[];
const upsertSourceFile = (row: any) => {if(includedProject(row.projectId))pendingSourceFiles.push(remember("sourceFiles",row));};


let passSignal:AbortSignal|undefined;
let passProjects:Set<string>|null=null;
let passNamespace='';
const includedProject=(id:any)=>!passProjects||passProjects.has(String(id||''));
let sink:{artifacts:WorkspaceArtifact[];relationships:WorkspaceRelationship[];artifactIds:Set<string>;relationshipIds:Set<string>}|null=null;
const checkIndex=()=>{if(passSignal?.aborted)throw passSignal.reason || new DOMException('Workspace indexing cancelled.','AbortError');};
let batchProgress: (()=>void)|null=null;
async function flushIndexBatch(force=false){
 if(!sink)return;
 checkIndex();
 while(pendingSourceFiles.length>=128 || (force&&pendingSourceFiles.length)){
  await persistSourceFiles(pendingSourceFiles.splice(0,128));batchProgress?.();await yieldIndexWork(passSignal);checkIndex();
 }
 while(sink.artifacts.length>=256 || (force&&sink.artifacts.length)){
  const rows=sink.artifacts.splice(0,256).filter(row=>includedProject(row.projectId));await upsertArtifacts(rows);for(const row of rows)sink.artifactIds.add(row.id);batchProgress?.();await yieldIndexWork(passSignal);checkIndex();
 }
 while(sink.relationships.length>=256 || (force&&sink.relationships.length)){
  const rows=sink.relationships.splice(0,256).filter(row=>includedProject(row.projectId));await upsertRelationships(rows);for(const row of rows)sink.relationshipIds.add(row.id);batchProgress?.();await yieldIndexWork(passSignal);checkIndex();
 }
}
const stepKeys:Record<string,string[]>={
 projects:['xhandle.projects','xhandle.projectFolders','xhandle.codeArchitectureProjects','cbaMeta:'],
 projectData:['xhandle.projectData','xhandle:vnv-test-case-documents','xhandle:requirements','xhandle:req-projects',INDEX_DIRTY_PREFIX+'traceability'],
 verificationTests:['xhandle.projectData','xhandle:vnv-test-case-documents','xhandle:requirements','xhandle:req-projects',INDEX_DIRTY_PREFIX+'traceability'],
 requirements:['xhandle:req-projects','xhandle:requirements'],
 codeArchitecture:['xhandle.codeArchitectureProjects','cbaMeta:'],codeIndex:['cbaMeta:'],
 sysml:['xhandle.designManagement.sysmlV2.models'],
};
function stepSignature(step:string,values:Map<string,string|null>){
 const hash=shajs('sha256');hash.update(String(MIGRATION_VERSION));
 const keys=[...values.keys()].filter(key=>stepKeys[step]?.some(prefix=>key===prefix||(prefix==='cbaMeta:'&&key.startsWith(prefix)))||key===INDEX_DIRTY_PREFIX+'*'||key===INDEX_DIRTY_PREFIX+step).sort();
 for(const key of keys){hash.update(key+'\n');hash.update(values.get(key)||'');hash.update('\n');}
 return hash.digest('hex');
}

function safeParse<T = any>(raw: string | null, fallback: T): T {
  try {
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

let workerValues:Map<string,string|null>|null=null;
const sourceStorage=()=>workerValues ? {getItem:(key:string)=>workerValues!.get(key)??null} : localStorage;
const sourceSnapshot=()=>workerValues ? {revision:0,values:new Map(workerValues)} : workspaceGraphSourceSnapshot();
function canUseBrowserStorage() {
  return Boolean(workerValues) || (typeof window !== "undefined" && typeof window.localStorage !== "undefined");
}

function stableId(prefix: string, ...parts: any[]) {
  const raw = parts
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join(":");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  const encoded = encodeURIComponent(raw).replace(/%/g, "").slice(0, 150);
  return `${prefix}:${encoded || "unknown"}:${Math.abs(hash).toString(36)}`;
}

function text(value: any, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function compact(value: any, max = 1200) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

function titleFromRow(row: any, fallback: string) {
  if (!row || typeof row !== "object") return fallback;
  return text(
    row.title ||
    row.name ||
    row.id ||
    row.Hazard ||
    row.Hazards ||
    row["Failure Mode"] ||
    row.Risk ||
    row.from ||
    row.fromFunction ||
    fallback,
    fallback
  );
}

function artifactFromLegacy({
  id,
  type,
  projectId,
  parentId = null,
  sourceFeature,
  sourceStore,
  sourceKey,
  sourceId,
  title,
  summary,
  content,
  structuredData,
  status,
  tags = [],
  createdAt,
  updatedAt,
}: Partial<WorkspaceArtifact> & Pick<WorkspaceArtifact, "id" | "type" | "title">): WorkspaceArtifact {
  const now = nowISO();
  return {
    id,
    type,
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId: projectId || "",
    parentId,
    sourceFeature,
    sourceStore,
    sourceKey: sourceKey || (activeRoot?.source===sourceStore?activeRoot.key:undefined),
    sourceId,
    title,
    summary,
    content,
    structuredData,
    status,
    tags,
    createdAt: createdAt || updatedAt || now,
    updatedAt: updatedAt || createdAt || now,
    version: 1,
  };
}

function relationship({
  type,
  fromArtifactId,
  toArtifactId,
  projectId = "",
  sourceFeature,
  sourceStore,
  sourceId,
  confidence,
}: {
  type: WorkspaceRelationshipType;
  fromArtifactId: string;
  toArtifactId: string;
  projectId?: string;
  sourceFeature?: string;
  sourceStore?: string;
  sourceId?: string;
  confidence?: number;
}): WorkspaceRelationship {
  const now = nowISO();
  return {
    id: stableId("rel", type, fromArtifactId, toArtifactId, sourceStore, sourceId),
    type,
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId,
    fromArtifactId,
    toArtifactId,
    confidence,
    sourceFeature,
    sourceStore,
    sourceKey: activeRoot?.source===sourceStore?activeRoot.key:undefined,
    sourceId,
    createdAt: now,
    updatedAt: now,
  };
}

function readLS<T = any>(key: string, fallback: T): T {
  if (!canUseBrowserStorage()) return fallback;
  const raw = sourceStorage().getItem(key);
  const value = raw == null ? fallback : JSON.parse(raw) as T;
  successfulSources?.add(`localStorage:${key.startsWith("cbaMeta:") ? "cbaMeta:*" : key}`);
  return value;
}

function localStorageKeys() {
  if (!canUseBrowserStorage()) return [];
  return workerValues ? [...workerValues.keys()] : Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean) as string[];
}

export function getLatestWorkspaceGraphMigrationDiagnostics() {
  if (!canUseBrowserStorage()) return null;
  return safeParse<any>(sourceStorage().getItem(WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY), null);
}

async function databaseExists(name: string) {
  const indexedDBWithList = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof indexedDBWithList?.databases !== "function") return true;
  try {
    const databases = await indexedDBWithList.databases();
    return databases.some((entry) => entry.name === name);
  } catch {
    return true;
  }
}

async function openExistingDB(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable.");
  if (!(await databaseExists(name))) return null;
  return new Promise((resolve, reject) => {
    let absent = false, finished = false;
    const finish = (error: any, db: IDBDatabase | null = null) => {
      if (finished) { db?.close(); return; }
      finished = true; clearTimeout(timer);
      error ? reject(error) : resolve(db);
    };
    const timer = setTimeout(() => finish(new Error(`Opening ${name} timed out.`)), 10000);
    try {
      const req = indexedDB.open(name);
      req.onupgradeneeded = () => { absent = true; req.transaction?.abort(); };
      req.onerror = () => finish(absent ? null : req.error || new Error(`Opening ${name} failed.`));
      req.onblocked = () => finish(new Error(`Opening ${name} is blocked.`));
      req.onsuccess = () => { req.result.onversionchange=()=>req.result.close(); finish(null, req.result); };
    } catch (error) { finish(error); }
  });
}

let recordStates=new Map<string,any>();
let pendingRecords:any[]=[];
let retainedKeys=new Map<string,Set<string>>();
let seenRecords=new Set<string>();
let activeRoot:{source:string;key:string}|null=null;
let currentStep='';
let forceRecords=false;
async function* iterateStoreRows(dbName:string,storeName:string,{hydrate=true,sourceStoreName=storeName}={}) : AsyncGenerator<any> {
 const db=await openExistingDB(dbName),source=`indexedDB:${dbName}/${sourceStoreName}`;
 if(!db){successfulSources?.add(source);return;}
 try{
  if(!db.objectStoreNames.contains(storeName)){successfulSources?.add(source);return;}
  const architectureRoots=dbName==='xhandle'&&storeName==='copilot_baseline';
  const prefix=architectureRoots?(passProjects?.size===1?`cba:${[...passProjects][0]}:`:'cba:'):null;
  let after:IDBValidKey|undefined;
  while(true){
   checkIndex();
   const range=prefix?IDBKeyRange.bound(after??prefix,prefix+'\uffff',after!==undefined):after===undefined?undefined:IDBKeyRange.lowerBound(after,true);
   const keys=await requestValue(db.transaction(storeName,'readonly').objectStore(storeName).getAllKeys(range,64)) as IDBValidKey[];
   if(!keys.length)break;
   let skippedParts=false;
   for(const key of keys){
    checkIndex();
    const workMarker=architectureRoots?[':functional-work:',':requirements-work:',':run:'].find(marker=>String(key).includes(marker)):null;
    const partMarker=workMarker||(isRecordPart(key)?':$part:':storeName==='artifactRows'&&String(key).includes(':chunk:')?':chunk:':null);
    if(partMarker){
      // All internal chunks for this root occupy one contiguous key range.
      // Seek past it instead of paging through potentially millions of chunk
      // keys. Root readers still validate and read every referenced chunk.
      after=String(key).slice(0,String(key).indexOf(partMarker)+partMarker.length)+'\uffff';
      skippedParts=true;break;
    }
    const keyOwner=dbName==='xhandle'&&storeName==='copilot_baseline'?String(key).match(/^cba:([^:]+):/)?.[1]:dbName==='xhandle-code-architecture-assurance'?String(key).match(/^xhandle:cba-[^:]+:([^:]+):/)?.[1]:null;
    if(keyOwner&&!includedProject(keyOwner))continue;
    const raw:any=await requestValue(db.transaction(storeName,'readonly').objectStore(storeName).get(key));
    if(!raw)continue;
    const owner=raw.projectId||raw.sourceProjectId||raw.value?.projectId||keyOwner;
    if(owner&&!includedProject(owner))continue;
    const sourceKey=String(key),id=`index-record:${passNamespace}${source}:${sourceKey}`;
    seenRecords.add(id);
    const revision=raw.value?.root || raw.payload?.digest || raw.revision || raw.updatedAt || (dbName==="xhandle-generated-reports"?raw.createdAt:undefined) || raw.value?.updatedAt;
    const signature=revision==null?null:String(revision);
    if(!forceRecords&&signature&&recordStates.get(id)?.signature===signature&&recordStates.get(id)?.complete&&recordStates.get(id)?.version===MIGRATION_VERSION){
     const set=retainedKeys.get(source)||new Set<string>();set.add(sourceKey);retainedKeys.set(source,set);continue;
    }
    const previous=activeRoot;activeRoot={source,key:sourceKey};
    try{
     let value=raw;
     if(hydrate&&dbName==='xhandle'&&storeName==='code_index')value={...raw,value:await readSourceFileProjection(db,storeName,raw.value,passSignal)};
     else if(hydrate&&dbName==='xhandle'&&storeName==='copilot_baseline')value={...raw,value:await hydrateRecord(db,storeName,raw.value,{signal:passSignal})};
     yield value;
     // Source files are small independent mirrors. Commit bounded batches;
     // record checkpoints are only published after the whole step flushes.
     await flushIndexBatch(!(dbName==='xhandle'&&storeName==='code_index'));
     if(signature)pendingRecords.push({id,signature,complete:true,step:currentStep,sourceStore:source,sourceKey,projectId:String(raw.projectId||raw.value?.projectId||(dbName==='xhandle'&&String(key).startsWith('cba:')?String(key).split(':')[1]:'')),version:MIGRATION_VERSION});
    }finally{activeRoot=previous;}
   }
   if(!skippedParts)after=keys[keys.length-1];await yieldIndexWork(passSignal);
  }
  successfulSources?.add(source);
 }finally{db.close();}
}

async function readStoreRows(dbName: string, storeName: string) {
  const db = await openExistingDB(dbName);
  const source = `indexedDB:${dbName}/${storeName}`;
  if (!db) { successfulSources?.add(source); return []; }
  try {
    if (!db.objectStoreNames.contains(storeName)) { successfulSources?.add(source); return []; }
    const records = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const records: any[] = [];
      const req = tx.objectStore(storeName).openCursor();
      req.onerror = () => reject(req.error || new Error(`Reading ${source} failed.`));
      tx.onabort = () => reject(tx.error || new Error(`Reading ${source} was interrupted.`));
      req.onsuccess = () => {
        const cursor=req.result;
        if (!cursor) {resolve(records);return;}
        if (!isRecordPart(cursor.key)) records.push(cursor.value);
        cursor.continue();
      };
    });
    if (dbName === 'xhandle' && ['code_index','copilot_baseline'].includes(storeName)) {
      const output = [];
      for (const record of records) if (!isRecordPart(record.key)) output.push({...record, value:await hydrateRecord(db, storeName, record.value)});
      successfulSources?.add(source);
      return output;
    }
    if (dbName === 'xhandle-code-architecture-hazard-analysis' && storeName === 'hazardAnalysisRuns') {
      const output=[];for(const record of records)output.push(isChunkedHazardRun(record)?await hydrateHazardRun(wrap(db),record):record);
      successfulSources?.add(source);
      return output;
    }
    successfulSources?.add(source);
    return records;
  } finally {
    try { db.close(); } catch {}
  }
}

function folderArtifactId(folderId: string) {
  return stableId("artifact", "project-folder", folderId);
}

function projectArtifactId(projectId: string) {
  return stableId("artifact", "project", projectId);
}

function knownArtifactIdForLegacyTarget(target: any) {
  const raw = text(target?.artifactId || target?.requirementId || target?.safetyFindingId || target?.patchProposalId || target?.id || target?.targetId || target);
  const kind = text(target?.type || target?.artifactType || target?.targetType || "").toLowerCase();
  if (!raw) return "";
  if (String(raw).startsWith("artifact:")) return raw;
  if (/patch/.test(kind)) return stableId("artifact", "patch_proposal", raw);
  if (/finding|safety/.test(kind)) return stableId("artifact", "safety_finding", raw);
  if (/risk/.test(kind)) return stableId("artifact", "risk", raw);
  if (/requirement|req/.test(kind) || /^req[-_:]/i.test(raw)) return stableId("artifact", "requirement", raw);
  return stableId("artifact", "requirement", raw);
}

async function migrateProjects(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  await migrateCodeArchitectureCatalog(artifacts,relationships);
  const projects = readLS<any[]>("xhandle.projects", []);
  const folders = readLS<any[]>("xhandle.projectFolders", []);

  for (const folder of folders) {
    if (!folder?.id) continue;
    const id = text(folder.id);
    const artifactId = folderArtifactId(id);
    await upsertFolder({
      id: stableId("folder", "project-folder", id),
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: "",
      name: text(folder.name, "Project Folder"),
      parentId: folder.parentId || null,
      kind: "project",
      sourceStore: "localStorage:xhandle.projectFolders",
      sourceKey: "xhandle.projectFolders",
      sourceId: id,
      sourceData: folder,
      createdAt: folder.createdAt || nowISO(),
      updatedAt: folder.updatedAt || folder.createdAt || nowISO(),
      version: 1,
    });
    artifacts.push(artifactFromLegacy({
      id: artifactId,
      type: "folder",
      parentId: folder.parentId ? folderArtifactId(text(folder.parentId)) : null,
      sourceFeature: "Projects",
      sourceStore: "localStorage:xhandle.projectFolders",
      sourceKey: "xhandle.projectFolders",
      sourceId: id,
      title: text(folder.name, "Project Folder"),
      structuredData: folder,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      tags: ["folder", "project-folder"],
    }));
    if (folder.parentId) {
      relationships.push(relationship({
        type: "contains",
        fromArtifactId: folderArtifactId(text(folder.parentId)),
        toArtifactId: artifactId,
        sourceStore: "localStorage:xhandle.projectFolders",
        sourceId: id,
      }));
    }
  }

  for (const project of projects) {
    if (!project?.id) continue;
    const id = text(project.id);
    await upsertProject({
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: id,
      name: text(project.name, "Project"),
      folderId: project.folderId || null,
      sourceStore: "localStorage:xhandle.projects",
      sourceKey: "xhandle.projects",
      sourceId: id,
      sourceData: project,
      createdAt: project.createdAt || nowISO(),
      updatedAt: project.updatedAt || project.createdAt || nowISO(),
      version: 1,
    });
    const artifact = artifactFromLegacy({
      id: projectArtifactId(id),
      type: "project",
      projectId: id,
      parentId: project.folderId ? folderArtifactId(text(project.folderId)) : null,
      sourceFeature: "Projects",
      sourceStore: "localStorage:xhandle.projects",
      sourceKey: "xhandle.projects",
      sourceId: id,
      title: text(project.name, "Project"),
      structuredData: project,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      tags: ["project"],
    });
    artifacts.push(artifact);
    if (project.folderId) {
      relationships.push(relationship({
        type: "contains",
        projectId: id,
        fromArtifactId: folderArtifactId(text(project.folderId)),
        toArtifactId: artifact.id,
        sourceStore: "localStorage:xhandle.projects",
        sourceId: id,
      }));
    }
  }
}

function migrateProjectData(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const projectData = readLS<Record<string, any>>("xhandle.projectData", {});
  Object.entries(projectData || {}).forEach(([projectId, data]) => {
    if(!includedProject(projectId))return;
    const parent = projectArtifactId(projectId);
    const rows = Array.isArray(data?.responseRows) ? data.responseRows : [];
    rows.forEach((row, index) => {
      const id = stableId("artifact", "projectData", projectId, "responseRows", index);
      artifacts.push(artifactFromLegacy({
        id,
        type: "functional_decomposition_row",
        projectId,
        parentId: parent,
        sourceFeature: "Functional Decomposition",
        sourceStore: "localStorage:xhandle.projectData",
        sourceKey: `xhandle.projectData.${projectId}.responseRows`,
        sourceId: `${projectId}:responseRows:${index}`,
        title: `${text(row.fromFunction || row.from || "Function")} -> ${text(row.toFunction || row.to || "Function")}`,
        summary: compact(row, 500),
        structuredData: row,
        updatedAt: data?._updatedAt,
        tags: ["functional", "decomposition"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
    });

    const risks = Array.isArray(data?.riskRegister) ? data.riskRegister : [];
    risks.forEach((row, index) => {
      const sourceId = row?.id || `${projectId}:riskRegister:${index}`;
      const id = stableId("artifact", "risk", sourceId);
      artifacts.push(artifactFromLegacy({
        id,
        type: "risk",
        projectId,
        parentId: parent,
        sourceFeature: "Risk Register",
        sourceStore: "localStorage:xhandle.projectData",
        sourceKey: `xhandle.projectData.${projectId}.riskRegister`,
        sourceId: text(sourceId),
        title: titleFromRow(row, `Risk ${index + 1}`),
        summary: row?.description || compact(row, 500),
        structuredData: row,
        status: row?.status,
        updatedAt: data?._updatedAt,
        tags: ["risk"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
    });

    const draftHazardRows = data?.draftHazardRowsByIndex && typeof data.draftHazardRowsByIndex === "object"
      ? data.draftHazardRowsByIndex
      : {};
    const draftHazardHeaders = Array.isArray(data?.draftHazardHeaders)
      ? data.draftHazardHeaders
      : (Array.isArray(data?.analysisResult?.Summary?.[0]) ? data.analysisResult.Summary[0] : []);
    const configuredContextIds = (Array.isArray(data?.hazardOperationalContexts) ? data.hazardOperationalContexts : [])
      .map((context: any) => String(context?.id || "").trim())
      .filter(Boolean);
    const hasUnspecifiedContext = Object.keys(draftHazardRows).some((key) => (
      !String(key).includes(":context:") || String(key).includes(":context:context-unspecified")
    ));
    const contextIds = hasUnspecifiedContext
      ? ["context-unspecified", ...configuredContextIds.filter((id: string) => id !== "context-unspecified")]
      : configuredContextIds;
    Object.entries(draftHazardRows).forEach(([rowKey, draft]: [string, any]) => {
      if (!draft?.generated || !Array.isArray(draft.row)) return;
      const keyMatch = String(rowKey).match(/^(?<functionalRowIndex>\d+):guide:(?<guidePhraseIndex>\d+)(?::context:(?<contextId>.+))?$/i);
      const fallbackIndex = Number(rowKey);
      const functionalRowIndex = keyMatch?.groups?.functionalRowIndex == null
        ? (Number.isFinite(fallbackIndex) ? fallbackIndex : 0)
        : Number(keyMatch.groups.functionalRowIndex);
      const guidePhraseIndex = keyMatch?.groups?.guidePhraseIndex == null
        ? 0
        : Number(keyMatch.groups.guidePhraseIndex);
      let contextId = keyMatch?.groups?.contextId || "context-unspecified";
      try { contextId = decodeURIComponent(contextId); } catch {}
      const guidePhraseCount = data?.riskMethod === "STPA-Textbook" || data?.riskMethod === "STPA" ? 7 : 1;
      const contextCount = Math.max(1, contextIds.length);
      const contextIndex = Math.max(0, contextIds.indexOf(contextId));
      const targetIndex = keyMatch
        ? (((functionalRowIndex * guidePhraseCount) + guidePhraseIndex) * contextCount) + contextIndex
        : functionalRowIndex;
      const structuredData = {
        rowIndex: targetIndex,
        rowKey,
        functionalRowIndex,
        guidePhraseIndex,
        contextId,
        columns: draftHazardHeaders,
        row: draft.row,
        generated: true,
        draft: true,
        riskMethod: data?.riskMethod || "",
      };
      const titledRow = Object.fromEntries(draftHazardHeaders.map((header: string, index: number) => [header, draft.row[index]]));
      const id = stableId("artifact", "hazard-summary", projectId, targetIndex);
      artifacts.push(artifactFromLegacy({
        id,
        type: "hazard_analysis_row",
        projectId,
        parentId: parent,
        sourceFeature: "Hazard Analysis",
        sourceStore: "localStorage:xhandle.projectData",
        sourceKey: `xhandle.projectData.${projectId}.draftHazardRowsByIndex`,
        sourceId: `${projectId}:draftHazardRowsByIndex:${rowKey}`,
        title: titleFromRow(titledRow, `Generated hazard row ${targetIndex + 1}`),
        summary: compact(structuredData, 900),
        structuredData,
        updatedAt: data?._updatedAt,
        tags: ["hazard", "analysis", "incremental"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
    });

    const summary = data?.analysisResult?.Summary;
    if (Array.isArray(summary) && summary.length > 1) {
      const headers = summary[0] || [];
      summary.slice(1).forEach((row, rowIndex) => {
        const structuredData = { rowIndex, columns: headers, row };
        const id = stableId("artifact", "hazard-summary", projectId, rowIndex);
        artifacts.push(artifactFromLegacy({
          id,
          type: "hazard_analysis_row",
          projectId,
          parentId: parent,
          sourceFeature: "Hazard Analysis",
          sourceStore: "localStorage:xhandle.projectData",
          sourceKey: `xhandle.projectData.${projectId}.analysisResult.Summary`,
          sourceId: `${projectId}:analysisResult:Summary:${rowIndex}`,
          title: titleFromRow(Object.fromEntries(headers.map((header: string, i: number) => [header, row[i]])), `Hazard row ${rowIndex + 1}`),
          summary: compact(structuredData, 500),
          structuredData,
          updatedAt: data?._updatedAt,
          tags: ["hazard", "analysis"],
        }));
        relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "localStorage:xhandle.projectData" }));
      });
    }
  });
}

async function migrateGeneratedReports(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const dbName = "xhandle-generated-reports";

  const db = await openExistingDB(dbName);
  if (!db || !db.objectStoreNames.contains("reports")) {
    db?.close();
    const metadata=await readStoreRows(dbName,"metadata");
    if(metadata.some(row=>!row.deleted))throw new Error("Saved report bodies are unavailable.");
    successfulSources?.add(`indexedDB:${dbName}/reports`);
    return;
  }
  try {
    // Read one body at a time. Never accumulate report diagram images in the graph.
    for await (const meta of iterateStoreRows(dbName,"metadata",{sourceStoreName:"reports"})) {
      if (meta.deleted) continue;
      const report = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction("reports", "readonly");
        const request = tx.objectStore("reports").get(meta.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || new Error("Reading a saved report failed."));
      });
      if (!report || String(report.projectId) !== String(meta.projectId)) throw new Error("A saved report body is missing or has different ownership.");
      const projectId = text(meta.projectId);
      const id = stableId("artifact", "generated-report", projectId, meta.id);
      const content = text(report.report);
      artifacts.push(artifactFromLegacy({
        id, projectId, type: "generated_report", parentId: projectArtifactId(projectId),
        title: text(meta.title || meta.reportType, "Saved report"),
        summary: compact(content, 900), content,
        structuredData: { libraryId: meta.id, reportType: meta.reportType, status: meta.status },
        status: meta.status, createdAt: meta.createdAt, updatedAt: meta.createdAt,
        sourceFeature: "Reports", sourceStore: `indexedDB:${dbName}/reports`, sourceKey: text(meta.id), sourceId: text(meta.id),
        tags: ["report", "saved", meta.status === "draft" ? "draft" : "complete"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore: `indexedDB:${dbName}/reports`, sourceId: text(meta.id) }));
    }
    successfulSources?.add(`indexedDB:${dbName}/reports`);
  } finally { db.close(); }
}

async function migrateVerificationTests(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const documents = readLS<any[]>("xhandle:vnv-test-case-documents", []);
  const addTests = async (projectId: string, rows: any[], sourceStore: string, documentId = "", updatedAt?: string) => {
    for(let index=0;index<rows.length;index++){const row=rows[index];
      const sourceId = `${projectId}:${documentId || "legacy"}:${row?.id || index}`;
      const id = stableId("artifact", "test-case", sourceId);
      artifacts.push(artifactFromLegacy({
        id, projectId, type: "test_case", parentId: projectArtifactId(projectId),
        title: titleFromRow(row, `Test case ${index + 1}`),
        summary: row?.objective || row?.description || compact(row, 900),
        structuredData: { ...row, documentId, rowIndex: index }, status: row?.status,
        sourceFeature: "System Test", sourceStore, sourceId, updatedAt,
        tags: ["test", "verification"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore, sourceId }));
      const inBatch = row?.requirementId && artifacts.find(artifact =>
        /requirement$/.test(artifact.type) && artifact.projectId === projectId &&
        (artifact.sourceId === String(row.requirementId) || String(artifact.structuredData?.id || "") === String(row.requirementId)));
      const target=inBatch || (row?.requirementId && (await getArtifact(stableId("artifact","requirement",row.requirementId)) || await getArtifact(stableId("artifact","traceability-requirement",row.requirementId))));
      if (target && target.projectId===projectId) relationships.push(relationship({ type: "verifies", projectId, fromArtifactId: id, toArtifactId: target.id, sourceStore, sourceId }));
      if(index%128===0)await flushIndexBatch();
    }
  };
  for(const doc of documents){
    const projectId = text(doc.sourceProjectId ?? doc.projectId);
    if(!includedProject(projectId))continue;
    await addTests(projectId, Array.isArray(doc.testCases) ? doc.testCases : [], "localStorage:xhandle:vnv-test-case-documents", text(doc.id), doc.updatedAt);
  }
  const projects = readLS<Record<string, any>>("xhandle.projectData", {});
  for(const [projectId,data] of Object.entries(projects)){
    if(!includedProject(projectId))continue;
    const vnv = data?.vnvArtifacts;
    // A project cache of a document must not resurrect a deleted document.
    if (!vnv || vnv.testCaseDocument?.id) continue;
    const tests = Array.isArray(vnv.tests) && vnv.tests.length ? vnv.tests : vnv.testCases;
    await addTests(projectId, Array.isArray(tests) ? tests : [], "localStorage:xhandle.projectData", "", data._updatedAt);
  }
}

async function migrateDurableProjectAnalysis(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  for await (const record of iterateStoreRows("xhandle-project-hazard-analysis", "analyses")) {
    const projectId = text(record?.projectId || "");
    if (!projectId) continue;
    const parent = projectArtifactId(projectId);
    const summary = record?.analysisResult?.Summary;
    if (Array.isArray(summary) && summary.length > 1) {
      const headers = summary[0] || [];
      summary.slice(1).forEach((row: any[], rowIndex: number) => {
        const rowObject = Object.fromEntries(headers.map((header: string, index: number) => [header, row[index]]));
        const id = stableId("artifact", "hazard-summary", projectId, rowIndex);
        artifacts.push(artifactFromLegacy({
          id,
          type: "hazard_analysis_row",
          projectId,
          parentId: parent,
          sourceFeature: "Hazard Analysis",
          sourceStore: "indexedDB:xhandle-project-hazard-analysis/analyses",
          sourceKey: projectId,
          sourceId: `${projectId}:analysisResult:Summary:${rowIndex}`,
          title: titleFromRow(rowObject, `Hazard row ${rowIndex + 1}`),
          summary: compact(rowObject, 900),
          structuredData: { rowIndex, columns: headers, row },
          updatedAt: record?.updatedAt,
          tags: ["hazard", "analysis", "durable"],
        }));
        relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "indexedDB:xhandle-project-hazard-analysis/analyses" }));
      });
    }

    (Array.isArray(record?.riskRegister) ? record.riskRegister : []).forEach((risk: any, index: number) => {
      const sourceId = text(risk?.id || `${projectId}:riskRegister:${index}`);
      const id = stableId("artifact", "risk", sourceId);
      artifacts.push(artifactFromLegacy({
        id,
        type: "risk",
        projectId,
        parentId: parent,
        sourceFeature: "Safety Issues & Risk Assessment",
        sourceStore: "indexedDB:xhandle-project-hazard-analysis/analyses",
        sourceKey: projectId,
        sourceId,
        title: titleFromRow(risk, `Safety issue ${index + 1}`),
        summary: risk?.description || compact(risk, 900),
        structuredData: risk,
        status: risk?.status,
        updatedAt: record?.updatedAt,
        tags: ["risk", "safety-issue", "durable"],
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "indexedDB:xhandle-project-hazard-analysis/analyses" }));
    });
  }

  for await (const report of iterateStoreRows("xhandle-project-reports","safetyIssueReports")) {
    const projectId = text(report?.projectId || "");
    if (!projectId || !String(report?.markdown || "").trim()) continue;
    const id = stableId("artifact", "safety-issue-report", projectId);
    artifacts.push(artifactFromLegacy({
      id,
      type: "safety_issue_report",
      projectId,
      parentId: projectArtifactId(projectId),
      sourceFeature: "Safety Issues & Risk Assessment",
      sourceStore: "indexedDB:xhandle-project-reports/safetyIssueReports",
      sourceKey: projectId,
      sourceId: projectId,
      title: "Safety Issue Report",
      summary: compact(report.markdown, 900),
      content: report.markdown,
      structuredData: { projectId, updatedAt: report.updatedAt },
      updatedAt: report.updatedAt,
      tags: ["report", "safety-issue", "durable"],
    }));
    relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore: "indexedDB:xhandle-project-reports/safetyIssueReports" }));

}
}

function migrateRequirements(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const reqProjects = readLS<any[]>("xhandle:req-projects", []);
  reqProjects.forEach((project) => {
    if (!project?.id) return;
    const projectId = text(project.id);
    const id = stableId("artifact", "requirements-project", projectId);
    artifacts.push(artifactFromLegacy({
      id,
      type: "requirements_project",
      projectId,
      parentId: projectArtifactId(projectId),
      sourceFeature: "Requirements",
      sourceStore: "localStorage:xhandle:req-projects",
      sourceKey: "xhandle:req-projects",
      sourceId: projectId,
      title: text(project.name || project.title, "Requirements Project"),
      summary: project.description || "",
      structuredData: project,
      tags: ["requirements", "project"],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
    relationships.push(relationship({
      type: "contains",
      projectId,
      fromArtifactId: projectArtifactId(projectId),
      toArtifactId: id,
      sourceStore: "localStorage:xhandle:req-projects",
      sourceId: projectId,
    }));
  });

  const rows = readLS<any[]>("xhandle:requirements", []);
  rows.forEach((row, index) => {
    const projectId = text(row?.projectId || row?.folderId || "");
    const id = stableId("artifact", "requirement", row?.id || index);
    artifacts.push(artifactFromLegacy({
      id,
      type: "requirement",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "Requirements",
      sourceStore: "localStorage:xhandle:requirements",
      sourceId: text(row?.id || index),
      title: titleFromRow(row, `Requirement ${index + 1}`),
      summary: row?.title || compact(row, 500),
      structuredData: row,
      status: row?.status,
      tags: ["requirement"],
      updatedAt: row?.updatedAt,
      createdAt: row?.createdAt,
    }));
    if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore: "localStorage:xhandle:requirements" }));
    (Array.isArray(row?.links) ? row.links : []).forEach((link: any) => {
      const target = knownArtifactIdForLegacyTarget(link);
      if (target) relationships.push(relationship({ type: "traces_to", projectId, fromArtifactId: id, toArtifactId: target, sourceStore: "localStorage:xhandle:requirements" }));
    });
  });
}

async function migrateCodeArchitectureCatalog(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const cbaProjects = readLS<any[]>("xhandle.codeArchitectureProjects", []);
  for (const project of cbaProjects) {
    const projectId = text(project?.id || "");
    if (!projectId) continue;
    await upsertProject({
      id: projectId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      name: text(project?.name, "Code-Based Architecture Project"),
      folderId: project?.folderId || null,
      projectType: "code-based-architecture",
      sourceStore: "localStorage:xhandle.codeArchitectureProjects",
      sourceKey: "xhandle.codeArchitectureProjects",
      sourceId: projectId,
      sourceData: project,
      createdAt: project?.createdAt || nowISO(),
      updatedAt: project?.updatedAt || project?.createdAt || nowISO(),
      version: 1,
    });
    artifacts.push(artifactFromLegacy({
      id: projectArtifactId(projectId),
      type: "project",
      projectId,
      sourceFeature: "Code-Based Architecture",
      sourceStore: "localStorage:xhandle.codeArchitectureProjects",
      sourceKey: "xhandle.codeArchitectureProjects",
      sourceId: projectId,
      title: text(project?.name, "Code-Based Architecture Project"),
      structuredData: { ...project, projectType: "code-based-architecture" },
      tags: ["project", "code-architecture-project"],
      createdAt: project?.createdAt,
      updatedAt: project?.updatedAt,
    }));
    (Array.isArray(project?.repos) ? project.repos : []).forEach((repo: any) => {
      const repoArtifactId = stableId("artifact", "repository", projectId, repo?.id || repo?.repoId);
      artifacts.push(artifactFromLegacy({
        id: repoArtifactId,
        type: "repository",
        projectId,
        parentId: projectId ? projectArtifactId(projectId) : null,
        sourceFeature: "Code-Based Architecture",
        sourceStore: "localStorage:xhandle.codeArchitectureProjects",
        sourceId: text(repo?.id || repo?.repoId),
        title: text(repo?.repoName || repo?.repoId || `${repo?.owner || ""}/${repo?.repo || ""}`, "Repository"),
        summary: repo?.repoUrl || "",
        structuredData: { ...repo, token: undefined },
        tags: ["repository", "code-architecture"],
        updatedAt: repo?.updatedAt,
        createdAt: repo?.createdAt,
      }));
      if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: repoArtifactId, sourceStore: "localStorage:xhandle.codeArchitectureProjects" }));
    });
  }

  localStorageKeys()
    .filter((key) => key.startsWith("cbaMeta:"))
    .forEach((key) => {
      const meta = readLS<any>(key, null);
      if (!meta) return;
      const projectId = text(meta.projectId || meta.cbaProjectId || "");
      const repoId = text(meta.repoId || meta.repoName || meta.repositoryId || key.replace(/^cbaMeta:/, ""));
      const repoArtifactId = stableId("artifact", "repository", projectId || "cbaMeta", repoId);
      artifacts.push(artifactFromLegacy({
        id: repoArtifactId,
        type: "repository",
        projectId,
        parentId: projectId ? projectArtifactId(projectId) : null,
        sourceFeature: "Code-Based Architecture",
        sourceStore: "localStorage:cbaMeta:*",
        sourceKey: key,
        sourceId: repoId,
        title: text(meta.repoName || meta.repoId || meta.repository || repoId, "Repository"),
        summary: meta.repoUrl || meta.branch || "",
        structuredData: { ...meta, token: undefined },
        tags: ["repository", "code-architecture", "metadata"],
        updatedAt: meta.updatedAt,
        createdAt: meta.createdAt,
      }));
      if (projectId) {
        relationships.push(relationship({
          type: "contains",
          projectId,
          fromArtifactId: projectArtifactId(projectId),
          toArtifactId: repoArtifactId,
          sourceStore: "localStorage:cbaMeta:*",
          sourceId: repoId,
        }));
      }
    });

}

async function migrateCodeArchitecture(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  for await (const record of iterateStoreRows("xhandle", "copilot_baseline",{hydrate:false})) {
    const key = text(record?.key);
    const sourceDb=await openExistingDB("xhandle");
    if(!sourceDb)throw new Error("Architecture storage is unavailable.");
    const parts = key.split(":");
    const projectId = parts[1] || "";
    const repoId = parts.slice(2).join(":");
    const referencedFiles=new Set<string>();
    let index=0;
    try{for await (const row of iterateRecordRows(sourceDb,"copilot_baseline",record.value,passSignal)){
      const id = stableId("artifact", "cba", key, row?.traceId || row?.edgeId || index);
      const repoArtifactId = repoId ? stableId("artifact", "repository", projectId, repoId) : "";
      artifacts.push(artifactFromLegacy({
        id,
        type: "code_architecture_edge",
        projectId,
        parentId: repoArtifactId || null,
        sourceFeature: "Code-Based Architecture",
        sourceStore: "indexedDB:xhandle/copilot_baseline",
        sourceKey: key,
        sourceId: `${key}:${row?.traceId || row?.edgeId || index}`,
        title: `${text(row.from || row.fromFunction || "Source")} -> ${text(row.to || row.toFunction || "Target")}`,
        summary: compact(row, 700),
        structuredData: { ...row, _rowIndex: index, _repoId: repoId },
        tags: ["code-architecture", "edge"],
        updatedAt: row?.updatedAt,
      }));
      if (repoArtifactId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: repoArtifactId, toArtifactId: id, sourceStore: "indexedDB:xhandle/copilot_baseline" }));
      [row?.fromFile, row?.toFile].filter(Boolean).forEach((path) => {
        const fileId = stableId("artifact", "source-file", repoId || projectId, path);
        // Many edges reference the same file. Persist its identical metadata
        // once per root while retaining every edge-to-file relationship.
        if(!referencedFiles.has(fileId))artifacts.push(artifactFromLegacy({
          id: fileId,
          type: "source_file",
          projectId,
          parentId: repoArtifactId || null,
          sourceFeature: "Code-Based Architecture",
          sourceStore: "indexedDB:xhandle/copilot_baseline",
          sourceKey: key,
          sourceId: `${key}:${path}`,
          title: text(path, "Source file"),
          summary: "Source file referenced by a code architecture edge.",
          structuredData: { path, repoId },
          tags: ["source-file", "code-architecture"],
        }));
        referencedFiles.add(fileId);
        relationships.push(relationship({ type: "references", projectId, fromArtifactId: id, toArtifactId: fileId, sourceStore: "indexedDB:xhandle/copilot_baseline" }));
      });
      if(++index%128===0)await flushIndexBatch();
    }}finally{sourceDb.close();}
  }
}

async function migrateCodeArchitectureAssurance(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const definitions: Record<string, { type: string; label: string }> = {
    "software-requirements": { type: "code_architecture_software_requirement", label: "Software requirement" },
    "system-requirements": { type: "code_architecture_system_requirement", label: "System requirement" },
    "subsystem-requirements": { type: "code_architecture_subsystem_requirement", label: "Subsystem requirement" },
    "design-elements": { type: "code_architecture_design_element", label: "Design element" },
  };
  for await (const record of iterateStoreRows("xhandle-code-architecture-assurance", "artifactRows")) {
    const key = text(record?.key);
    const match = key.match(/^xhandle:cba-(software-requirements|system-requirements|subsystem-requirements|design-elements):([^:]+):(.+)$/);
    if (!match) continue;
    const [, kind, projectId, repoId] = match;
    const definition = definitions[kind];
    const sourceDb=await openExistingDB("xhandle-code-architecture-assurance");
    if(!sourceDb)throw new Error("Requirements storage is unavailable.");
    async function* rows(){
      if(!record.chunked){if(Array.isArray(record.rows))yield* record.rows;return;}
      let count=0;
      for(const chunkKey of record.chunkKeys||[]){
        checkIndex();const chunk:any=await requestValue(sourceDb!.transaction('artifactRows','readonly').objectStore('artifactRows').get(chunkKey));
        if(!Array.isArray(chunk?.rows))throw new Error("Saved requirements are missing a chunk.");
        count+=chunk.rows.length;yield* chunk.rows;
      }
      if(typeof record.rowCount==='number'&&count!==record.rowCount)throw new Error("Saved requirement row count does not match its chunks.");
    }
    const repoArtifactId = stableId("artifact", "repository", projectId, repoId);
    let index=0;
    try{for await(const row of rows()){
      const sourceRowId = text(row?.id || row?.internalId || index);
      const id = stableId("artifact", definition.type, key, sourceRowId);
      artifacts.push(artifactFromLegacy({
        id,
        type: definition.type,
        projectId,
        parentId: repoArtifactId,
        sourceFeature: "Code-Based Architecture Assurance",
        sourceStore: "indexedDB:xhandle-code-architecture-assurance/artifactRows",
        sourceKey: key,
        sourceId: `${key}:${sourceRowId}`,
        title: titleFromRow(row, `${definition.label} ${index + 1}`),
        summary: row?.requirementText || row?.description || row?.designRationale || row?.rationale || compact(row, 700),
        structuredData: { ...row, _rowIndex: index, _artifactKind: kind, _repoId: repoId },
        status: row?.status || row?.reviewStatus,
        tags: ["code-architecture", "assurance", kind],
        updatedAt: row?.updatedAt || record?.updatedAt,
        createdAt: row?.createdAt,
      }));
      relationships.push(relationship({
        type: "contains",
        projectId,
        fromArtifactId: repoArtifactId,
        toArtifactId: id,
        sourceStore: "indexedDB:xhandle-code-architecture-assurance/artifactRows",
        sourceId: sourceRowId,
      }));
      if(++index%128===0)await flushIndexBatch();
    }}finally{sourceDb.close();}
  }
}

async function migrateCodeIndex(artifacts: WorkspaceArtifact[]) {
  for await (const record of iterateStoreRows("xhandle", "code_index")) {
    const key = text(record?.key);
    const value = record?.value || {};
    const path = value.path || key.split(":").slice(-1)[0] || key;
    const repoId = value.sourceType === "local" ? `local:${value.sourceId}` : key.startsWith("code:file:") ? key.replace(/^code:file:/, "").split(":").slice(0, -1).join(":") : value.repoId || "";
    const id = value.sourceType === "local"
      ? stableId("artifact", "source-file", repoId, value.snapshotId || "", path)
      : stableId("artifact", "source-file", repoId, path);
    const sourceFile = {
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: value.projectId || "",
      repoId,
      path,
      title: path,
      language: value.lang || value.language || "",
      content: boundedValue(value.content || "",900),
      symbols: [...(value.functions || []).slice(0,100), ...(value.exports || []).slice(0,100)].filter(Boolean).map(symbol=>boundedValue(symbol,300)),
      structuredData: {path,repoId,sourceId:value.sourceId,snapshotId:value.snapshotId,sourceType:value.sourceType},
      sourceFeature: "Code Index",
      sourceStore: "indexedDB:xhandle/code_index",
      sourceKey: key,
      sourceId: key,
      createdAt: value.createdAt || nowISO(),
      updatedAt: value.updatedAt || nowISO(),
      version: 1,
    };
    await upsertSourceFile(sourceFile);
    artifacts.push(artifactFromLegacy({
      id,
      type: "source_file",
      projectId: sourceFile.projectId,
      sourceFeature: "Code Index",
      sourceStore: "indexedDB:xhandle/code_index",
      sourceKey: key,
      sourceId: key,
      title: path,
      summary: `${sourceFile.language || "source"} file with ${sourceFile.symbols?.length || 0} indexed symbols.`,
      content: sourceFile.content?.slice(0, 4000),
      structuredData: sourceFile.structuredData,
      tags: ["source-file"],
    }));
  }
}

function migrateSysML(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  const models = readLS<any[]>("xhandle.designManagement.sysmlV2.models", []);
  models.forEach((model) => {
    const projectId = text(model?.projectId || "");
    const modelId = stableId("artifact", "sysml-model", model?.id);
    artifacts.push(artifactFromLegacy({
      id: modelId,
      type: "sysml_model",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "SysML v2 Modeler",
      sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models",
      sourceId: text(model?.id),
      title: text(model?.name, "SysML Model"),
      summary: model?.description || "",
      structuredData: model,
      tags: ["sysml"],
      updatedAt: model?.updatedAt,
    }));
    (model?.elements || []).forEach((element: any) => {
      const elementId = stableId("artifact", "sysml-element", model?.id, element?.id);
      artifacts.push(artifactFromLegacy({
        id: elementId,
        type: "sysml_element",
        projectId,
        parentId: modelId,
        sourceFeature: "SysML v2 Modeler",
        sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models",
        sourceId: `${model?.id}:${element?.id}`,
        title: text(element?.name, "SysML Element"),
        summary: element?.description || element?.type || "",
        structuredData: element,
        tags: ["sysml", element?.type].filter(Boolean),
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: modelId, toArtifactId: elementId, sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models" }));
    });
    (model?.relationships || []).forEach((rel: any) => {
      if (!rel?.sourceId || !rel?.targetId) return;
      relationships.push(relationship({
        type: "traces_to",
        projectId,
        fromArtifactId: stableId("artifact", "sysml-element", model?.id, rel.sourceId),
        toArtifactId: stableId("artifact", "sysml-element", model?.id, rel.targetId),
        sourceFeature: "SysML v2 Modeler",
        sourceStore: "localStorage:xhandle.designManagement.sysmlV2.models",
        sourceId: `${model?.id}:${rel?.id || rel.sourceId}`,
      }));
    });
  });
}

async function migrateSimpleIndexedStores(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  for await (const item of iterateStoreRows("xhandle-results-review", "reviewItems")) {
    const id = stableId("artifact", "review", item?.id);
    const target = item?.artifactId || item?.targetArtifactId || item?.sourceRunId
      ? knownArtifactIdForLegacyTarget({
          id: item?.artifactId || item?.targetArtifactId || item?.sourceRunId,
          type: item?.artifactType || item?.reviewUnitType,
        })
      : "";
    const projectId = text(item?.projectId || "");
    const artifact = artifactFromLegacy({
      id,
      type: "review_item",
      projectId,
      sourceFeature: item?.sourceFeature || "Results Review",
      sourceStore: "indexedDB:xhandle-results-review/reviewItems",
      sourceId: text(item?.id),
      title: `${item?.sourceFeature || "Review"} ${item?.reviewUnitType || "item"}`,
      summary: item?.reviewerFeedback || compact(item?.currentContent || item?.originalContent, 700),
      structuredData: item,
      status: item?.status,
      tags: ["review"],
      updatedAt: item?.updatedAt,
      createdAt: item?.createdAt,
    });
    artifacts.push(artifact);
    await upsertReview({ ...artifact, artifactId: target || undefined });
    if (target) relationships.push(relationship({ type: "reviews", projectId, fromArtifactId: id, toArtifactId: target, sourceStore: "indexedDB:xhandle-results-review/reviewItems" }));
  }

  for await (const run of iterateStoreRows("xhandle-code-architecture-hazard-analysis", "hazardAnalysisRuns")) {
    const projectId = text(run?.projectId || "");
    const runId = stableId("run", "cba-hazard", run?.id);
    await upsertRun({
      id: runId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      type: "code_architecture_hazard_analysis",
      title: `${run?.hazardMethod || "Hazard"} analysis`,
      status: run?.reviewStatus,
      artifactIds: [],
      structuredData: { repoId:run.repoId,hazardMethod:run.hazardMethod,rowCount:run.generatedSheets?.Summary?.length ? run.generatedSheets.Summary.length-1 : run.payload?.rowIndex?.spans?.length || 0 },
      sourceFeature: "Code Architecture Hazard Analysis",
      sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
      sourceId: text(run?.id),
      createdAt: run?.createdAt || nowISO(),
      updatedAt: run?.updatedAt || run?.createdAt || nowISO(),
      version: 1,
    });
    for await (const {headers,row,index} of iterateHazardSummary(run,passSignal)) {
        const id = stableId("artifact", "cba-hazard-row", run?.id, index);
        artifacts.push(artifactFromLegacy({
          id,
          type: "code_architecture_hazard_row",
          projectId,
          sourceFeature: "Code Architecture Hazard Analysis",
          sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
          sourceId: `${run?.id}:summary:${index}`,
          title: titleFromRow(Object.fromEntries(headers.map((h: string, i: number) => [h, row[i]])), `Hazard row ${index + 1}`),
          summary: compact({ headers, row }, 700),
          structuredData: { rowIndex: index, columns: headers, row },
          status: run?.reviewStatus,
          tags: ["hazard", "code-architecture"],
          updatedAt: run?.updatedAt,
        }));
        relationships.push(relationship({ type: "derived_from", projectId, fromArtifactId: id, toArtifactId: stableId("run", "cba-hazard", run?.id), sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns" }));
      if(index%128===0)await flushIndexBatch();
    }
  }

  const remediationStores = [
    ["safetyFindings", "safety_finding"],
    ["patchProposals", "patch_proposal"],
    ["reviewDecisions", "review_decision"],
    ["summaryArtifacts", "summary_artifact"],
    ["verificationRuns", "verification_run"],
    ["safetyRemediationEvidence", "implementation_evidence"],
  ];
  for (const [store, type] of remediationStores) {
    for await (const row of iterateStoreRows("xhandle-safety-remediation", store)) {
      const projectId = text(row?.projectId || "");
      const id = stableId("artifact", type, row?.id);
      artifacts.push(artifactFromLegacy({
        id,
        type,
        projectId,
        sourceFeature: "Safety Remediation",
        sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
        sourceId: text(row?.id),
        title: titleFromRow(row, type),
        summary: row?.summary || row?.description || row?.rationale || compact(row, 700),
        structuredData: row,
        status: row?.status || row?.reviewStatus || row?.verificationStatus,
        tags: ["safety-remediation", type],
        updatedAt: row?.updatedAt,
        createdAt: row?.createdAt,
      }));
      if (projectId) {
        relationships.push(relationship({
          type: "contains",
          projectId,
          fromArtifactId: projectArtifactId(projectId),
          toArtifactId: id,
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
          sourceId: text(row?.id),
        }));
      }
      if (type === "verification_run") {
        await upsertRun({
          id: stableId("run", "verification", row?.id),
          workspaceId: DEFAULT_WORKSPACE_ID,
          projectId,
          type: "verification_run",
          title: titleFromRow(row, "Verification run"),
          status: row?.status || row?.verificationStatus,
          artifactIds: [
            row?.patchProposalId ? stableId("artifact", "patch_proposal", row.patchProposalId) : null,
            row?.safetyFindingId ? stableId("artifact", "safety_finding", row.safetyFindingId) : null,
          ].filter(Boolean) as string[],
          structuredData: row,
          sourceFeature: "Safety Remediation",
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
          sourceId: text(row?.id),
          createdAt: row?.createdAt || nowISO(),
          updatedAt: row?.updatedAt || row?.createdAt || nowISO(),
          version: 1,
        });
      }
      if (type === "implementation_evidence") {
        await upsertEvidence({
          id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          projectId,
          artifactId: row?.patchProposalId ? stableId("artifact", "patch_proposal", row.patchProposalId) : undefined,
          title: titleFromRow(row, "Implementation evidence"),
          type: "implementation_evidence",
          content: row?.summary || row?.description || "",
          structuredData: row,
          sourceFeature: "Safety Remediation",
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
          sourceId: text(row?.id),
          createdAt: row?.createdAt || nowISO(),
          updatedAt: row?.updatedAt || row?.createdAt || nowISO(),
          version: 1,
        });
      }
      if (type === "patch_proposal" && row?.safetyFindingId) {
        relationships.push(relationship({
          type: "implements",
          projectId,
          fromArtifactId: id,
          toArtifactId: stableId("artifact", "safety_finding", row.safetyFindingId),
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
        }));
      }
      if ((type === "verification_run" || type === "implementation_evidence") && (row?.patchProposalId || row?.safetyFindingId)) {
        relationships.push(relationship({
          type: "verifies",
          projectId,
          fromArtifactId: id,
          toArtifactId: stableId("artifact", row?.patchProposalId ? "patch_proposal" : "safety_finding", row?.patchProposalId || row?.safetyFindingId),
          sourceStore: `indexedDB:xhandle-safety-remediation/${store}`,
        }));
      }
    }
  }

  for await (const item of iterateStoreRows("SafetyCaseEvidenceDB", "Attachments")) {
    const projectId = text(item?.projectId || "");
    const artifactId = stableId("artifact", "safety-evidence-attachment", item?.id);
    const evidence = {
      id: artifactId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId,
      artifactId: item?.nodeId ? stableId("artifact", "safety-case-node", item?.safetyCaseId, item.nodeId) : undefined,
      title: text(item?.title || item?.name, "Evidence attachment"),
      type: item?.type || "file-attachment",
      content: item?.description || "",
      structuredData: { ...item, dataUrl: item?.dataUrl ? "[data-url omitted from LLM graph summary]" : undefined },
      sourceFeature: "Safety Case Evidence",
      sourceStore: "indexedDB:SafetyCaseEvidenceDB/Attachments",
      sourceId: text(item?.id),
      createdAt: item?.createdAt || nowISO(),
      updatedAt: item?.updatedAt || item?.createdAt || nowISO(),
      version: 1,
    };
    await upsertEvidence(evidence);
    artifacts.push(artifactFromLegacy({
      id: artifactId,
      type: "evidence",
      projectId,
      sourceFeature: "Safety Case Evidence",
      sourceStore: "indexedDB:SafetyCaseEvidenceDB/Attachments",
      sourceId: text(item?.id),
      title: evidence.title,
      summary: evidence.content,
      structuredData: evidence.structuredData,
      tags: ["evidence", "attachment"],
    }));
    if (evidence.artifactId) {
      relationships.push(relationship({
        type: "evidences",
        projectId,
        fromArtifactId: artifactId,
        toArtifactId: evidence.artifactId,
        sourceStore: "indexedDB:SafetyCaseEvidenceDB/Attachments",
        sourceId: text(item?.id),
      }));
    }
  }
}

async function migrateTraceabilityDB(artifacts: WorkspaceArtifact[], relationships: WorkspaceRelationship[]) {
  for await (const folder of iterateStoreRows("TraceabilityDB","Folders")) {
    if (!folder?.id) continue;
    const id = folderArtifactId(`traceability:${folder.id}`);
    artifacts.push(artifactFromLegacy({
      id,
      type: "folder",
      parentId: folder.parentId ? folderArtifactId(`traceability:${folder.parentId}`) : null,
      sourceFeature: "Traceability",
      sourceStore: "indexedDB:TraceabilityDB/Folders",
      sourceId: text(folder.id),
      title: text(folder.name || folder.title, "Traceability Folder"),
      structuredData: folder,
      tags: ["folder", "traceability"],
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }));
    if (folder.parentId) {
      relationships.push(relationship({
        type: "contains",
        fromArtifactId: folderArtifactId(`traceability:${folder.parentId}`),
        toArtifactId: id,
        sourceStore: "indexedDB:TraceabilityDB/Folders",
        sourceId: text(folder.id),
      }));
    }

}

  for await (const project of iterateStoreRows("TraceabilityDB","Projects")) {
    if (!project?.id) continue;
    const projectId = text(project.id);
    const artifactId = projectArtifactId(projectId);
    artifacts.push(artifactFromLegacy({
      id: artifactId,
      type: "project",
      projectId,
      parentId: project.folderId ? folderArtifactId(`traceability:${project.folderId}`) : null,
      sourceFeature: "Traceability",
      sourceStore: "indexedDB:TraceabilityDB/Projects",
      sourceId: projectId,
      title: text(project.name || project.title, "Traceability Project"),
      summary: project.description || "",
      structuredData: project,
      tags: ["project", "traceability"],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
    if (project.folderId) {
      relationships.push(relationship({
        type: "contains",
        projectId,
        fromArtifactId: folderArtifactId(`traceability:${project.folderId}`),
        toArtifactId: artifactId,
        sourceStore: "indexedDB:TraceabilityDB/Projects",
        sourceId: projectId,
      }));
    }

}

  let notesOrdinal=0;
for await (const note of iterateStoreRows("TraceabilityDB","Notes")) {const index=notesOrdinal++;
    const projectId = text(note?.projectId || "");
    const id = stableId("artifact", "traceability-note", note?.id || index);
    artifacts.push(artifactFromLegacy({
      id,
      type: "note",
      projectId,
      parentId: note?.folderId ? folderArtifactId(`traceability:${note.folderId}`) : (projectId ? projectArtifactId(projectId) : null),
      sourceFeature: "Traceability",
      sourceStore: "indexedDB:TraceabilityDB/Notes",
      sourceId: text(note?.id || index),
      title: titleFromRow(note, `Note ${index + 1}`),
      summary: note?.summary || note?.content || note?.body || "",
      content: note?.content || note?.body || "",
      structuredData: note,
      tags: ["note", "traceability"],
      createdAt: note?.createdAt,
      updatedAt: note?.updatedAt,
    }));
    const parent = note?.folderId ? folderArtifactId(`traceability:${note.folderId}`) : (projectId ? projectArtifactId(projectId) : "");
    if (parent) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: parent, toArtifactId: id, sourceStore: "indexedDB:TraceabilityDB/Notes" }));

}

  for await (const sc of iterateStoreRows("TraceabilityDB","SafetyCases")) {
    const projectId = text(sc?.projectId || sc?.sourceProjectId || "");
    const scId = stableId("artifact", "safety-case", sc?.id);
    artifacts.push(artifactFromLegacy({
      id: scId,
      type: "safety_case",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "Safety Case",
      sourceStore: "indexedDB:TraceabilityDB/SafetyCases",
      sourceId: text(sc?.id),
      title: text(sc?.name || sc?.title, "Safety Case"),
      summary: sc?.description || "",
      structuredData: sc,
      tags: ["safety-case"],
      updatedAt: sc?.updatedAt,
      createdAt: sc?.createdAt,
    }));
    if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: scId, sourceStore: "indexedDB:TraceabilityDB/SafetyCases" }));
    (sc?.nodes || []).forEach((node: any) => {
      const nodeId = stableId("artifact", "safety-case-node", sc?.id, node?.id);
      artifacts.push(artifactFromLegacy({
        id: nodeId,
        type: "safety_case_node",
        projectId,
        parentId: scId,
        sourceFeature: "Safety Case",
        sourceStore: "indexedDB:TraceabilityDB/SafetyCases",
        sourceId: `${sc?.id}:${node?.id}`,
        title: text(node?.title || node?.label, "Safety Case Node"),
        summary: node?.description || node?.statement || "",
        structuredData: node,
        status: node?.status,
        tags: ["safety-case", node?.type].filter(Boolean),
      }));
      relationships.push(relationship({ type: "contains", projectId, fromArtifactId: scId, toArtifactId: nodeId, sourceStore: "indexedDB:TraceabilityDB/SafetyCases" }));
    });
    (sc?.edges || []).forEach((edge: any) => {
      if (!edge?.source || !edge?.target) return;
      relationships.push(relationship({
        type: "traces_to",
        projectId,
        fromArtifactId: stableId("artifact", "safety-case-node", sc?.id, edge.source),
        toArtifactId: stableId("artifact", "safety-case-node", sc?.id, edge.target),
        sourceFeature: "Safety Case",
        sourceStore: "indexedDB:TraceabilityDB/SafetyCases",
        sourceId: `${sc?.id}:${edge?.id || edge.source}`,
      }));
    });
  }

  let requirementsOrdinal=0;
for await (const row of iterateStoreRows("TraceabilityDB","Requirements")) {const index=requirementsOrdinal++;
    const projectId = text(row?.projectId || "");
    const id = stableId("artifact", "traceability-requirement", row?.id || index);
    artifacts.push(artifactFromLegacy({
      id,
      type: "requirement",
      projectId,
      parentId: projectId ? projectArtifactId(projectId) : null,
      sourceFeature: "Traceability Requirements",
      sourceStore: "indexedDB:TraceabilityDB/Requirements",
      sourceId: text(row?.id || index),
      title: titleFromRow(row, `Requirement ${index + 1}`),
      summary: row?.title || row?.description || compact(row, 500),
      structuredData: row,
      status: row?.status,
      tags: ["requirement", "traceability"],
    }));
    if (projectId) relationships.push(relationship({ type: "contains", projectId, fromArtifactId: projectArtifactId(projectId), toArtifactId: id, sourceStore: "indexedDB:TraceabilityDB/Requirements" }));

}
}

async function migrateLegacyStorageToWorkspaceGraphNow(options: MigrationOptions = {}) {
  const startedAt = Date.now();
  const selectedSteps=options.steps?new Set(options.steps):null;
  // These two writers share projectData ownership. Reconcile them together,
  // with requirement targets present before creating verification links.
  if(selectedSteps&&(selectedSteps.has('projectData')||selectedSteps.has('verificationTests'))){
    for(const step of ['projectData','verificationTests','requirements','traceability'])selectedSteps.add(step);
  }
  passSignal=options.signal;
  passProjects=options.projectIds?.length?new Set(options.projectIds):null;
  passNamespace=passProjects?'scope:'+JSON.stringify([...passProjects].sort())+':':'';
  checkIndex();
  const stateDb=await openWorkspaceGraphDB();
  const states=new Map((await stateDb.getAll("workspaces")).map((row:any)=>[row.id,row]));
  stateDb.close();
  recordStates=states;pendingRecords=[];pendingSourceFiles=[];retainedKeys=new Map();seenRecords=new Set();forceRecords=Boolean(options.force||options.mode==="full");
  const pendingStates:any[]=[];
  const failedSteps=new Set<string>();
  const skippedSteps:string[]=[];
  const deferredSteps:string[]=[];
  const stepDurationsMs:Record<string,number>={};
  const snapshot = sourceSnapshot();
  successfulSources = new Set();
  auxiliaryIds = {};
  const artifacts: WorkspaceArtifact[] = [];
  const relationships: WorkspaceRelationship[] = [];
  sink={artifacts,relationships,artifactIds:new Set(),relationshipIds:new Set()};
  const errors: Array<{ step: string; error: string }> = [];
  const failedSources = new Set<string>();
  const progress=(value:WorkspaceIndexProgress)=>{if(!passSignal?.aborted){try{options.onProgress?.(value);}catch{}}};
  let lastProgressAt=0;
  let progressStartedAt=startedAt;
  batchProgress=()=>{
    const at=Date.now();
    if(at-lastProgressAt<500)return;
    lastProgressAt=at;
    progress({step:currentStep,durationMs:at-progressStartedAt,complete:false,recordsPrepared:sink!.artifactIds.size});
  };

  async function runStep(step: string, fn: () => void | Promise<void>) {
    if(selectedSteps&&!selectedSteps.has(step)){deferredSteps.push(step);return;}
    await yieldIndexWork(passSignal);checkIndex();
    const stepStartedAt=Date.now();
    progressStartedAt=stepStartedAt;lastProgressAt=stepStartedAt;
    progress({step,durationMs:0,complete:false});
    checkIndex();
    currentStep=step;
    const id=`index-step:${passNamespace}${step}`;const signature=stepSignature(step,snapshot.values);
    const previous:any=states.get(id);
    const partner=step==='projectData'?'verificationTests':step==='verificationTests'?'projectData':null;
    const partnerState=partner?states.get(`index-step:${passNamespace}${partner}`):null;
    const partnerFresh=!partner||(partnerState?.complete&&partnerState.signature===stepSignature(partner,snapshot.values));
    if(!options.force&&options.mode!=="full"&&previous?.complete&&previous.signature===signature&&partnerFresh){skippedSteps.push(step);progress({step,durationMs:0,complete:true});return;}
    const sourcesBefore = new Set(successfulSources);
    try {
      await fn();
      await flushIndexBatch(true);
      pendingStates.push({id,signature,complete:true,version:MIGRATION_VERSION});
    } catch (error: any) {
      if(passSignal?.aborted)throw error;
      failedSteps.add(step);
      successfulSources?.forEach(source => { if (!sourcesBefore.has(source)) failedSources.add(source); });
      if (["projectData", "verificationTests"].includes(step)) failedSources.add("localStorage:xhandle.projectData");
      successfulSources = sourcesBefore;
      errors.push({ step, error: error?.message || String(error) });
    } finally {
      stepDurationsMs[step]=Date.now()-stepStartedAt;
      progress({step,durationMs:stepDurationsMs[step],complete:true,recordsPrepared:sink!.artifactIds.size});
    }
  }

  await runStep("projects", () => migrateProjects(artifacts, relationships));
  await runStep("projectData", () => migrateProjectData(artifacts, relationships));
  await runStep("generatedReports", () => migrateGeneratedReports(artifacts, relationships));
  await runStep("durableProjectAnalysis", () => migrateDurableProjectAnalysis(artifacts, relationships));
  await runStep("requirements", () => migrateRequirements(artifacts, relationships));
  await runStep("codeArchitecture", () => migrateCodeArchitecture(artifacts, relationships));
  await runStep("codeArchitectureAssurance", () => migrateCodeArchitectureAssurance(artifacts, relationships));
  await runStep("codeIndex", () => migrateCodeIndex(artifacts));
  await runStep("sysml", () => migrateSysML(artifacts, relationships));
  await runStep("traceability", () => migrateTraceabilityDB(artifacts, relationships));
  await runStep("verificationTests", () => migrateVerificationTests(artifacts, relationships));
  await runStep("indexedFeatureStores", () => migrateSimpleIndexedStores(artifacts, relationships));

  await flushIndexBatch(true);
  const artifactIds=sink!.artifactIds,relationshipIds=sink!.relationshipIds;
  await yieldIndexWork(passSignal);checkIndex();
  const reconcileStarted=Date.now();
  progress({step:"reconciliation",durationMs:0,complete:false,recordsPrepared:artifactIds.size});
  const reconciledRecords=await reconcileWorkspaceGraphSources({
    sourceStores:new Set(Array.from(successfulSources||[]).filter(source=>!failedSources.has(source))),
    ids:{...auxiliaryIds,artifacts:artifactIds,relationships:relationshipIds},
    retainedKeys,
    fullRefresh:!passProjects&&skippedSteps.length===0&&deferredSteps.length===0,
    projectIds:options.projectIds,
  });
  const reconciliationMs=Date.now()-reconcileStarted;
  checkIndex();
  const db=await openWorkspaceGraphDB();
  try{const tx=db.transaction('workspaces','readwrite');await Promise.all([...pendingStates.filter(state=>!([`index-step:${passNamespace}projectData`,`index-step:${passNamespace}verificationTests`].includes(state.id)&&(failedSteps.has('projectData')||failedSteps.has('verificationTests')))),...pendingRecords.filter(row=>!failedSteps.has(row.step))].map(state=>tx.store.put(state)));
    for(const [id,state] of states)if(String(id).startsWith('index-record:'+passNamespace)&&successfulSources?.has(state.sourceStore)&&!failedSources.has(state.sourceStore)&&!seenRecords.has(String(id)))await tx.store.delete(id);
    await tx.done;}finally{db.close();}
  const projectionStarted=Date.now();
  progress({step:"projection",durationMs:0,complete:false,recordsPrepared:artifactIds.size});
  await ensureWorkspaceProjection(passSignal,options.projectIds);
  const projectionMs=Date.now()-projectionStarted;
  const sourceChangedDuringMigration = !sameWorkspaceGraphSources(snapshot, sourceSnapshot());

  if (canUseBrowserStorage() && !workerValues) {
    try {
      const diagnostics = {
        version: MIGRATION_VERSION,
        migratedAt: nowISO(),
        artifactCount: artifactIds.size,
        relationshipCount: relationshipIds.size,
        errors,
        durationMs: Date.now() - startedAt,
      };
      localStorage.setItem(WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
    } catch {}
  }

  const result = {
    version: MIGRATION_VERSION,
    projectIds:options.projectIds,
    migratedAt: nowISO(),
    artifactCount: artifactIds.size,
    relationshipCount: relationshipIds.size,
    errors,
    durationMs: Date.now() - startedAt,
    reconciledRecords,
    sourceChangedDuringMigration,
    skippedSteps,
    deferredSteps,
    stepDurationsMs,
    maintenanceDurationsMs:{reconciliationMs,projectionMs},
  };

  successfulSources = null;
  return result;
}


export async function runWorkspaceGraphIndexPass(options:MigrationOptions={}, values?:Map<string,string|null>){
 workerValues=values||null;
 try{return await migrateLegacyStorageToWorkspaceGraphNow(options);}
 finally{batchProgress=null;workerValues=null;successfulSources=null;auxiliaryIds={};sink=null;passSignal=undefined;passProjects=null;passNamespace='';recordStates=new Map();pendingRecords=[];retainedKeys=new Map();activeRoot=null;}
}
