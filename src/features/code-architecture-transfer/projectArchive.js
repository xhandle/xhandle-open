import {prepareHazardTableIndex} from '../code-architecture-hazard-analysis/prepareHazardTableIndex';
import { portableLocalMetadata } from './portableLocalMetadata';
import { encodeCompact, decodeCompact } from './compactArchiveCodec';
import { exportHazardRun, portableHazardRun } from './projectHazardExport';
import { HAZARD_DB, HAZARD_DB_VERSION, HAZARD_SCHEMA, HAZARD_STAGING, upgradeHazardSchema, hazardMetadata, newHazardStorageRevision } from '../code-architecture-hazard-analysis/hazardSchema';
import { createHazardChunkIntegrityCheck } from './hazardChunkIntegrity';
import { HAZARD_CHUNKS } from '../code-architecture-hazard-analysis/hazardRunChunks';
/* global BigInt */
import { flushProjectArtifactWrites } from '../code-architecture-assurance/artifactUtils';
import { flushProjectArchitectureWrites } from '../code-architecture-assurance/codeArchitectureStorage';
import { assertProjectHazardsSaved } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { openTransferDatabase, readTransferTransaction } from './transferDatabase';
import { EXPORT_FALLBACKS, selectedExportCategories, analysisProjectMetadata, projectExportScope } from './projectExportScope';
import { streamValue, createValueAssembler, fitsArchiveLine } from './archiveValueStream';
import { createChunkIntegrityCheck } from './projectChunkIntegrity';
import { sha256 } from 'hash.js';
import { projectOwnsRecord, projectOwnsStorageKey } from '../../components/permanentlyDeleteStoredProject';
import { codeSourceIndexPrefix } from '../code-architecture-context/codeSourceIdentity';

export const PROJECT_ARCHIVE_TYPE = 'xhandle-code-architecture-archive';
const PROJECTS = 'xhandle.codeArchitectureProjects';
// Only these application databases can be written by an archive.
const DATABASES = ['xhandle', 'xhandle-code-architecture-assurance', 'xhandle-code-architecture-hazard-analysis',
  'xhandle-safety-remediation', 'xhandle-results-review', 'xhandle-workspace-graph', 'TraceabilityDB',
  'TraceabilityMeta', 'BaselinesDB', 'SafetyCaseEvidenceDB', 'xhandle-project-reports', 'xhandle-recovery'];
// Fixed-version application openers must never be upgraded by archive metadata.
const SUPPORTED_VERSIONS = {
  xhandle: 4, 'xhandle-code-architecture-assurance': 1,
  'xhandle-code-architecture-hazard-analysis': HAZARD_DB_VERSION, 'xhandle-safety-remediation': 2,
  'xhandle-results-review': 1, 'xhandle-workspace-graph': 2, TraceabilityDB: 7,
  TraceabilityMeta: 1, BaselinesDB: 1, SafetyCaseEvidenceDB: 1,
  'xhandle-project-reports': 1, 'xhandle-recovery': 1,
};
const REPAIRABLE_DATABASES = new Set(['xhandle-code-architecture-assurance', 'TraceabilityDB']);
function validateSchemaVersion(schema) {
  if (!REPAIRABLE_DATABASES.has(schema.name) && schema.version > SUPPORTED_VERSIONS[schema.name]) {
    throw new Error(`Unsupported database version (${schema.name}). Update xHandle before importing this project.`);
  }
}
async function assertCompatibleSchema(db, schema, allowHazardUpgrade = false) {
  validateSchemaVersion({name: schema.name, version: db.version});
  for (const [name, spec] of Object.entries(schema.stores)) {
    if (!db.objectStoreNames.contains(name) && allowHazardUpgrade && HAZARD_SCHEMA[name]) continue;
    if (!db.objectStoreNames.contains(name)) throw new Error(`Incompatible destination schema (${schema.name}/${name}). Update xHandle before importing.`);
    const tx = db.transaction(name), store = tx.store;
    const matches = JSON.stringify(store.keyPath) === JSON.stringify(spec.keyPath) && store.autoIncrement === spec.autoIncrement &&
      spec.indexes.every(index => {
        if (!store.indexNames.contains(index.name)) return allowHazardUpgrade && HAZARD_SCHEMA[name]?.indexes.some(expected => JSON.stringify(expected) === JSON.stringify(index));
        const current = store.index(index.name);
        return JSON.stringify(current.keyPath) === JSON.stringify(index.keyPath) && current.unique === index.unique && current.multiEntry === index.multiEntry;
      });
    await tx.done;
    if (!matches) throw new Error(`Incompatible destination schema (${schema.name}/${name}). Nothing was imported.`);
  }
}
const FALLBACKS = ['xhandle:results-review:items', 'xhandle:safety-remediation:v1', 'xhandle:code-architecture-hazard-analysis:v1', 'xhandle:review-summary-artifacts'];
const check = signal => { if (signal?.aborted) throw new DOMException('Project transfer cancelled.', 'AbortError'); };
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

// Explicit tagged containers retain structured values without reserving property
// names in user data. Unsupported values fail export rather than silently vanish.
export async function encodeValue(value) {
  if (value === undefined) return ['undefined'];
  if (typeof value === 'number' && !Number.isFinite(value)) return ['number', String(value)];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return ['date', value.toISOString()];
  if (value instanceof Blob) return ['blob', value.type, Array.from(new Uint8Array(await value.arrayBuffer()))];
  if (value instanceof ArrayBuffer) return ['bytes', Array.from(new Uint8Array(value))];
  if (ArrayBuffer.isView(value)) return ['view', value.constructor.name, Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))];
  if (Array.isArray(value)) { const entries=[]; for (const item of value) entries.push(await encodeValue(item)); return ['array', entries]; }
  if (value instanceof Map) { const entries=[]; for (const [k,v] of value) entries.push([await encodeValue(k), await encodeValue(v)]); return ['map', entries]; }
  if (value instanceof Set) return ['set', await encodeValue([...value])];
  if (Object.getPrototypeOf(value)?.constructor?.name !== 'Object' && Object.getPrototypeOf(value) !== null) throw new Error('Unsupported project storage value. Export was not created.');
  const entries=[]; for (const [k,v] of Object.entries(value)) entries.push([k,await encodeValue(v)]);
  return ['object', entries];
}
export function decodeValue(value) {
  if (Array.isArray(value) && value[0] === 'compact-v1') return decodeCompact(value);
  if (!Array.isArray(value)) return value;
  const [type, body, extra] = value;
  if (type === 'undefined') return undefined;
  if (type === 'number') return Number(body);
  if (type === 'bigint') return BigInt(body);
  if (type === 'date') return new Date(body);
  if (type === 'blob') return new Blob([new Uint8Array(extra)], {type:body});
  if (type === 'bytes') return new Uint8Array(body).buffer;
  if (type === 'view') {
    const constructors = {Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView};
    if (!constructors[body]) throw new Error('Unsupported binary view.');
    return new constructors[body](new Uint8Array(extra).buffer);
  }
  if (type === 'array') return body.map(decodeValue);
  if (type === 'map') return new Map(body.map(([k,v])=>[decodeValue(k),decodeValue(v)]));
  if (type === 'set') return new Set(decodeValue(body));
  if (type === 'object') return Object.fromEntries(body.map(([k,v])=>[k,decodeValue(v)]));
  throw new Error('Invalid archive value.');
}
async function archiveValueDigest(value, signal) {
  const hash = sha256(); let count = 0;
  const iterator=streamValue(value);
  try {
    for (;;) {
      check(signal);
      const step=await iterator.next();
      if(step.done)break;
      hash.update(JSON.stringify(step.value)); hash.update('\n');
      if (++count % 256 === 0) await yieldTask();
    }
  } finally {iterator.return();}
  return hash.digest('hex');
}
const openArchiveDB=(name,version,upgrade,options)=>openTransferDatabase(name,{...options,version,upgrade});
const existingDB=(name,options)=>openTransferDatabase(name,{...options,existingOnly:true});
// One record per transaction: encoding/hash/file work never keeps an IDB
// transaction alive across unrelated awaits (important in Safari).
async function visitRecords(db, store, scope, signal, visit) {
  let after;
  for (;;) {
    // Inspect bounded key pages before cloning payloads. Large unrelated source
    // indexes and old project records must not be hydrated just to skip them.
    const range=after===undefined?undefined:IDBKeyRange.lowerBound(after,true);
    const keys=await readTransferTransaction(db,store,s=>s.getAllKeys(range,128),{signal});
    if(!keys.length)return;
    for(const key of keys){
      check(signal);
      // Immutable parts are visited from live records below. Old abandoned
      // revisions can contain many times the current project's data.
      if(String(key).includes(':$part:'))continue;
      if(!scope.mayOwnKey(db.name,store,key))continue;
      const value=await readTransferTransaction(db,store,s=>s.get(key),{signal});
      if(value===undefined)throw new Error('Saved project data changed during export. Stop active work and retry.');
      await visit({key,value});
    }
    after=keys[keys.length-1];
    await yieldTask();
  }
}
function ownership(project) {
  const prefixes = (project.repos || []).flatMap(repo => [codeSourceIndexPrefix(repo), repo.sourceType === 'local' && repo.sourceId ? `code:local:${repo.sourceId}:` : '', repo.owner && repo.repo ? `code:github:${repo.owner}/${repo.repo}:` : '', repo.owner && repo.repo ? `code:file:${repo.owner}/${repo.repo}:` : '']).filter(Boolean);
  const layouts = (project.repos || []).flatMap(repo => {
    const ids = [repo.repoId, repo.repoName, repo.id, repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : null].filter(Boolean);
    return ids.flatMap(id => { const base=`diagram:github:${id}:${repo.branch || 'main'}`; return [base, `${base}:function-spacing-v3`]; });
  });
  const related = new Set();
  const owns = (db, store, key, value) => {
    const layout = db === 'xhandle' && store === 'diagram_positions' && layouts.some(base => key === base || String(key).startsWith(`${base}:$part:`));
    const direct = layout || projectOwnsRecord(key,value,project.id,db,store) ||
      (db === 'TraceabilityDB' && store === 'Projects' && key === project.id) ||
      (db === 'xhandle' && store === 'code_index' && prefixes.some(prefix => String(key).startsWith(prefix))) ||
      (db === 'xhandle-safety-remediation' && [value?.safetyFindingId,value?.patchProposalId,value?.targetId].some(id=>id && related.has(id)));
    if (direct && value?.id && db === 'xhandle-safety-remediation') related.add(value.id);
    return direct;
  };
  const mayOwnKey=(db,store,key)=>{
    if(db!=='xhandle' || typeof key!=='string')return true;
    if(store==='code_index' && /^code:(file|github|local):/.test(key))return prefixes.some(prefix=>key.startsWith(prefix));
    if(store==='copilot_baseline' && /^(cba:|cbaMeta:|functional-decomposition-checkpoint:cba:)/.test(key))return projectOwnsStorageKey(key,project.id);
    return true;
  };
  return { owns, mayOwnKey, local: key => projectOwnsStorageKey(key,project.id) || prefixes.some(prefix=>key.startsWith(prefix)) };
}
const storeOrder = name => ['safetyFindings','patchProposals'].includes(name) ? ['safetyFindings','patchProposals'].indexOf(name) : 2;
function portableProject(project) {
  const repos = (project.repos || []).map(repo => {
    const copy = {...repo};
    for (const key of ['token','accessToken','apiKey','password','handle','directoryHandle','localPath','absolutePath']) delete copy[key];
    return copy;
  });
  return {...project, folderId:null, repos};
}
export async function exportProjectArchive(project, options = {}) {
  try { return await writeProjectArchive(project, options); }
  catch(error) { try { await options.sink?.abort(); } catch {} throw error; }
}
async function writeProjectArchive(project, {signal,onProgress=()=>{},sink,categories} = {}) {
  if (!['string','number'].includes(typeof project?.id) || String(project.id)==='' || (typeof project.id==='number' && !Number.isFinite(project.id))) throw new Error('Select a project.');
  const selected=selectedExportCategories(categories);
  check(signal); onProgress('Preparing project export — saving pending edits…');
  const preparation = {projectId: project.id, tasks: []};
  window.dispatchEvent(new CustomEvent('xhandle:prepare-project-export', {detail: preparation}));
  await Promise.all(preparation.tasks);
  check(signal); onProgress('Preparing project export — saving architecture results…');
  await flushProjectArchitectureWrites(project.id);
  check(signal); onProgress('Preparing project export — saving requirements and design results…');
  await flushProjectArtifactWrites(project.id);
  check(signal);
  if(selected.includes('hazard'))assertProjectHazardsSaved(project.id);
  const portable = analysisProjectMetadata(project), scope=projectExportScope(portable,ownership(portable),selected), parts=sink?null:[], hash=sha256();
  const write=async line=>{if(sink)await sink.write(line);else parts.push(new Blob([line]));};
  let count=0, stagePercent=0;
  let pendingParts=[];
  const chunkIntegrity=createChunkIntegrityCheck((entry,key)=>pendingParts.push({db:entry.db,store:entry.store,key})), hazardIntegrity=createHazardChunkIntegrityCheck();
  const integrity={add:entry=>{chunkIntegrity.add(entry);hazardIntegrity.add(entry);},finish:()=>{chunkIntegrity.finish();hazardIntegrity.finish();}};
  let serializedBytes = 0, lastProgress = 0, category = 'project information';
  const encoder=new TextEncoder();
  const appendLine = async entry => {
    check(signal);
    const line=JSON.stringify(await encodeCompact(entry))+'\n';
    hash.update(line); await write(line); count++;
    serializedBytes += encoder.encode(line).byteLength;
    if (Date.now() - lastProgress >= 100 || count % 32 === 0) {
      const compressed = typeof sink?.bytesWritten === 'number' ? `, ${(sink.bytesWritten / 1048576).toFixed(1)} MB compressed so far` : '';
      onProgress(`Exporting ${category} (${stagePercent}%) — ${(serializedBytes / 1048576).toFixed(1)} MB raw data${compressed}…`);
      await yieldTask(); lastProgress = Date.now();
    }
  };
  const append = async entry => {
    check(signal); integrity.add(entry);
    if (fitsArchiveLine(entry,262144)) return appendLine(entry);
    await appendLine({kind:'stream-start',transportVersion:2});
    let tokens=[], size=0;
    const iterator=streamValue(entry);
    try {
      for (;;) {
        check(signal);const step=await iterator.next();if(step.done)break;
        tokens.push(step.value); size += JSON.stringify(step.value).length;
        if (size >= 16384) { await appendLine({kind:'stream-data',tokens}); tokens=[]; size=0; }
      }
    } finally {iterator.return();}
    if (tokens.length) await appendLine({kind:'stream-data',tokens});
    await appendLine({kind:'stream-end'});
  };
  await append({type:PROJECT_ARCHIVE_TYPE,version:3,categories:selected,project:portable,createdAt:new Date().toISOString()});
  for (let i=0;i<scope.databases.length;i++) {
    check(signal); stagePercent=Math.round(i/scope.databases.length*95); onProgress(`Exporting saved analysis data (${stagePercent}%)…`);
    const name=scope.databases[i], db=await existingDB(name,{signal,onProgress});
    category=name;
    if (!db) continue;
    try {
      // Include the complete schema even for empty stores so existing app openers
      // never encounter a partially initialized database on the destination.
      const stores=Array.from(db.objectStoreNames).sort((a,b)=>storeOrder(a)-storeOrder(b));
      const schema={};
      for (const storeName of stores) {
        const tx=db.transaction(storeName), store=tx.store;
        schema[storeName]={keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:Array.from(store.indexNames).map(name=>{
          const index=store.index(name); return {name,keyPath:index.keyPath,unique:index.unique,multiEntry:index.multiEntry};
        })}; await tx.done;
      }
      const hazardDB=name==='xhandle-code-architecture-hazard-analysis';
      if(hazardDB)Object.assign(schema,HAZARD_SCHEMA);
      await append({kind:'database',name,version:hazardDB?HAZARD_DB_VERSION:db.version,stores:schema});

      for (const store of stores.filter(store=>scope.store(name,store) && !(hazardDB && store===HAZARD_CHUNKS))) {
        category=`${name} / ${store}`;
        await visitRecords(db,store,scope,signal,async ({key,value}) => {
        check(signal);
        if(hazardDB && ['runMetadata',HAZARD_STAGING].includes(store))return;
        if(!scope.owns(name,store,key,value))return;
        if(name==='xhandle-code-architecture-assurance' && value.chunked){
          const keys=value.chunkKeys;
          if(!Array.isArray(keys) || new Set(keys).size!==keys.length || !Number.isInteger(value.rowCount) || value.rowCount<0)throw new Error('Saved requirements are incomplete. Export was not created.');
          let rows=0;
          for(const chunkKey of keys){
            check(signal);
            if(typeof chunkKey!=='string' || !chunkKey.startsWith(`${key}:chunk:`))throw new Error('Invalid requirements chunk reference.');
            const chunk=await readTransferTransaction(db,store,s=>s.get(chunkKey),{signal});
            if(chunk?.parentKey!==key || !Array.isArray(chunk.rows))throw new Error('Saved requirements are missing a data chunk. Export was not created.');
            rows+=chunk.rows.length;
            await append({kind:'record',db:name,store,key:chunkKey,value:chunk});
          }
          if(rows!==value.rowCount)throw new Error('Saved requirements are incomplete. Export was not created.');
        }
        if(hazardDB && store==='hazardAnalysisRuns'){
          // Legacy IDB values require one full read. Export converts them to small durable
          // records without mutating the source; the destination never hydrates them on import.
          await exportHazardRun(db,value,{signal,onEntry:async entry=>{
            if(entry.chunk)await append({kind:'record',db:name,store:HAZARD_CHUNKS,key:entry.chunk.id,value:entry.chunk});
            else {await append({kind:'record',db:name,store,key,value:entry.run});}
          }});
          await append({kind:'record',db:name,store:'runMetadata',key,value:hazardMetadata(value)});
        }else if(!hazardDB || store!==HAZARD_CHUNKS){
          await append({kind:'record',db:name,store,key,value});
        }
        });
      }
      // Follow only selected result roots and their incomplete checkpoints.
      // Each immutable part is emitted once; unreachable parts stay in the
      // source database and never inflate the portable archive.
      for(let part=0;part<pendingParts.length;part++){
        check(signal);
        const reference=pendingParts[part];
        if(reference.db!==name)throw new Error('Invalid cross-database project reference.');
        const value=await readTransferTransaction(db,reference.store,s=>s.get(reference.key),{signal});
        if(value===undefined)throw new Error('Saved analysis is missing a data chunk. No complete project transfer was created. Restore a complete backup.');
        if(!scope.owns(name,reference.store,reference.key,value))throw new Error('Analysis references data outside this project. Export was not created.');
        category=`${name} / ${reference.store}`;
        await append({kind:'record',...reference,value});
      }
      pendingParts=[];
    } finally {db.close();}
  }
  category='analysis context and saved results';
  for (const key of Object.keys(localStorage)) {
    if (scope.local(key)) await append({kind:'local',key,value:portableLocalMetadata(key,localStorage.getItem(key))});
  }
  // Legacy fallback stores hold several projects; transfer only owned entries.
  for (const key of selected.includes('hazard') ? EXPORT_FALLBACKS : []) {
    const raw=localStorage.getItem(key); if (!raw) continue;
    const state=JSON.parse(raw), filter=rows=>rows.filter(row=>scope.owns('xhandle-safety-remediation','',null,row)).map(portableHazardRun);
    const value=Array.isArray(state) ? filter(state) : Object.fromEntries(Object.entries(state).map(([k,v])=>[k,Array.isArray(v)?filter(v):[]]));
    await append({kind:'fallback',key,value});
  }
  integrity.finish();
  await write(JSON.stringify(await encodeCompact({kind:'end',count,digest:hash.digest('hex')}))+'\n');
  check(signal); onProgress('Finalizing and verifying the project file…');
  const result=sink?await sink.finish():new Blob(parts,{type:'application/x-xhandle-project'});
  check(signal); onProgress(`100% — archive ready${typeof result?.bytes === 'number' ? ` (${(result.bytes / 1048576).toFixed(1)} MB)` : ''}. Save the project file.`);
  return result;
}

async function readArchiveLines(file, onLine, signal) {
  const magic=new Uint8Array(await file.slice(0,2).arrayBuffer());
  const gzip=magic[0]===0x1f && magic[1]===0x8b;
  if(gzip && typeof DecompressionStream!=='function')throw new Error('This app cannot read compressed project files. Update xHandle and retry.');
  const decoder=new TextDecoder(); let buffer='';
  if (!gzip) {
    for(let offset=0;offset<file.size;offset+=256*1024){
      check(signal);
      buffer+=decoder.decode(await file.slice(offset,offset+256*1024).arrayBuffer(),{stream:true});
      let end;
      while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end+1);buffer=buffer.slice(end+1);check(signal);await onLine({line,physicalBytes:Math.min(file.size,offset+256*1024)});}
    }
  } else {
    let physicalBytes=0;
    const compressed=new ReadableStream({
      async pull(controller){
        if(physicalBytes>=file.size){controller.close();return;}
        const chunk=new Uint8Array(await file.slice(physicalBytes,physicalBytes+256*1024).arrayBuffer());
        physicalBytes+=chunk.byteLength;controller.enqueue(chunk);
      }
    });
    const reader=compressed.pipeThrough(new DecompressionStream('gzip')).getReader();
    try {
      for (;;) {
        check(signal);
        const {done,value}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let end;
        while ((end=buffer.indexOf('\n'))>=0) { const line=buffer.slice(0,end+1); buffer=buffer.slice(end+1); check(signal);await onLine({line,physicalBytes}); }
      }
    } finally {
      await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
  }
  buffer+=decoder.decode();
  if (buffer) throw new Error('Archive is incomplete (missing final newline).');
}
async function visitArchive(file, visit, signal, onReadProgress=()=>{}) {
  let bytes=0, lastPercent=-1;
  const chunkIntegrity=createChunkIntegrityCheck(), hazardIntegrity=createHazardChunkIntegrityCheck();
  const integrity={add:entry=>{chunkIntegrity.add(entry);hazardIntegrity.add(entry);},finish:()=>{chunkIntegrity.finish();hazardIntegrity.finish();}};
  let header,scope,end=false,count=0, assembling=null; const hash=sha256(), schemas=new Map(), seen=new Set();
  await readArchiveLines(file, async ({line,physicalBytes}) => {
    check(signal); bytes = physicalBytes;
    if (end) throw new Error('Unexpected data after archive checksum.');
    // Report physical bytes even while a single large record is being assembled.
    // Integer changes bound each pass to at most 100 updates; reserve 100% for publication.
    const percent = Math.min(99, Math.floor(bytes / file.size * 100));
    if (percent !== lastPercent) {
      lastPercent = percent; onReadProgress(percent);
      await yieldTask(); check(signal);
    }
    let entry=decodeValue(JSON.parse(line));
    const framed = ['stream-start','stream-data','stream-end'].includes(entry?.kind);
    if (framed) {
      if (header?.version === 1) throw new Error('Unexpected streamed record in legacy archive.');
      hash.update(line); count++;
      if (entry.kind === 'stream-start') {
        if (assembling || entry.transportVersion !== 2) throw new Error('Invalid streamed project record.');
        assembling = createValueAssembler(); return;
      }
      if (!assembling) throw new Error('Unexpected streamed project record.');
      if (entry.kind === 'stream-data') {
        if (!Array.isArray(entry.tokens)) throw new Error('Invalid streamed project record.');
        for (const token of entry.tokens) assembling.add(token);
        if (count % 32 === 0) { await yieldTask(); check(signal); }
        return;
      }
      entry = assembling.finish(); assembling = null;
      if (entry?.kind === 'end') throw new Error('Invalid streamed archive footer.');
    } else if (assembling) throw new Error('Incomplete streamed project record.');
    if (!header) {
      if (entry?.type!==PROJECT_ARCHIVE_TYPE || ![1,2,3].includes(entry.version) || !['string','number'].includes(typeof entry.project?.id) || String(entry.project.id)==='' || (typeof entry.project.id==='number' && !Number.isFinite(entry.project.id)) || !Array.isArray(entry.project.repos)) throw new Error('Unsupported project archive.');
      header=entry; scope=ownership(header.project);
    } else if (entry.kind==='end') {
      if (entry.count!==count || entry.digest!==hash.digest('hex')) throw new Error('Project archive checksum failed. No project was imported.');
      end=true; return;
    } else if (entry.kind==='database') {
      if (!DATABASES.includes(entry.name) || schemas.has(entry.name) || !Number.isInteger(entry.version) || entry.version<1) throw new Error('Invalid archive database.');
      validateSchemaVersion(entry);
      schemas.set(entry.name,entry);
    } else if (entry.kind==='record') {
      if(entry.db===HAZARD_DB && entry.store===HAZARD_STAGING)throw new Error('Archive contains transient hazard save state.');
      if (!Object.hasOwn(schemas.get(entry.db)?.stores || {},entry.store) || !scope.owns(entry.db,entry.store,entry.key,entry.value)) throw new Error('Archive contains records outside this project.');
      const keyPath=schemas.get(entry.db).stores[entry.store].keyPath;
      const readPath=path=>path.split('.').reduce((value,part)=>value != null && Object.hasOwn(value,part) ? value[part] : undefined,entry.value);
      if (keyPath !== null) {
        const inline=Array.isArray(keyPath)?keyPath.map(readPath):readPath(keyPath);
        if (JSON.stringify(inline)!==JSON.stringify(entry.key)) throw new Error('Archive primary key does not match its record.');
      }
    } else if (entry.kind==='local') {
      if (!scope.local(entry.key) || typeof entry.value!=='string') throw new Error('Invalid project settings.');
    } else if (entry.kind==='fallback') {
      if (!FALLBACKS.includes(entry.key)) throw new Error('Invalid fallback store.');
      const rows=Array.isArray(entry.value)?entry.value:Object.values(entry.value).flat();
      const currentScope=scope;
      if (!rows.every(row=>currentScope.owns('xhandle-safety-remediation','',null,row))) throw new Error('Unrelated fallback records.');
    } else throw new Error('Unknown archive record.');
    const identity=entry.kind==='record' ? JSON.stringify([entry.db,entry.store,entry.key]) : ['local','fallback'].includes(entry.kind) ? entry.key : null;
    if (identity && seen.has(identity)) throw new Error('Duplicate archive record.');
    if (identity) seen.add(identity);
    integrity.add(entry);
    if (!framed) { hash.update(line); count++; }
    await visit(entry,header,schemas);
    if (count%32===0) await yieldTask();
  }, signal);
  if (!end || assembling) throw new Error('Incomplete project archive.');
  integrity.finish();
  return header;
}
function portableRecordForComparison(entry, value) {
  if (value === undefined || entry.db !== HAZARD_DB) return value;
  if (entry.store === 'hazardAnalysisRuns' && (value?.payload?.tableIndex || value?.payload?.rowIndex)) {
    const {tableIndex, rowIndex, ...payload} = value.payload;
    return {...value, payload};
  }
  if (entry.store !== 'runMetadata') return value;
  const {storageRevision, ...content} = value;
  return content;
}

export async function importProjectArchive(file, {signal,onProgress=()=>{}} = {}) {
  const opened=new Map(), preflight=new Map(), journal=[], localJournal=[];
  let writing='project storage';
  const storageOptions={signal,onProgress};
  const hazardIds=new Set(), importedMetadata=new Set();
  const connect=async schema=>{
    if (opened.has(schema.name)) return opened.get(schema.name);
    validateSchemaVersion(schema);
    let current = await existingDB(schema.name,storageOptions);
    if (current && schema.name===HAZARD_DB && current.version<HAZARD_DB_VERSION){
      current.close();current=await openArchiveDB(HAZARD_DB,HAZARD_DB_VERSION,upgradeHazardSchema,storageOptions);
    }
    if (current) {
      try { await assertCompatibleSchema(current, schema); }
      catch (error) { current.close(); throw error; }
      opened.set(schema.name, current);
      return current;
    }
    const version = (schema.name === 'xhandle-code-architecture-hazard-analysis' || REPAIRABLE_DATABASES.has(schema.name)) ? SUPPORTED_VERSIONS[schema.name] : schema.version;
    const db=await openArchiveDB(schema.name,version,(db,old,next,tx)=>{
      if (old !== 0) { tx.abort(); return; } // Another tab created it after preflight.
      if(schema.name===HAZARD_DB)upgradeHazardSchema(db,old,next,tx);
      for (const [name,spec] of Object.entries(schema.stores)) {
        const store=db.objectStoreNames.contains(name)?tx.objectStore(name):db.createObjectStore(name,{keyPath:spec.keyPath,autoIncrement:spec.autoIncrement});
        for (const index of spec.indexes) if (!store.indexNames.contains(index.name)) store.createIndex(index.name,index.keyPath,{unique:index.unique,multiEntry:index.multiEntry});
      }
    },storageOptions);
    opened.set(schema.name,db);return db;
  };
  const assertNew=project=>{
    if (JSON.parse(localStorage.getItem(PROJECTS)||'[]').some(p=>String(p.id)===String(project.id))) throw new Error('This project already exists here. Import into another instance to preserve its original analysis identity.');
  };
  try {
    onProgress('Validating project archive…');
    const header=await visitArchive(file,async(entry,header,schemas)=>{
      assertNew(header.project);
      if (entry.kind==='database') {
        const db = await existingDB(entry.name,storageOptions);
        preflight.set(entry.name, db);
        if (db) await assertCompatibleSchema(db, entry, entry.name===HAZARD_DB && db.version<HAZARD_DB_VERSION);
      }
      if (entry.kind==='record') {
        if (!preflight.has(entry.db)) preflight.set(entry.db,await existingDB(entry.db,storageOptions));
        const db=preflight.get(entry.db);
        if (db) {
          if (db.objectStoreNames.contains(entry.store)) {
            const current=await readTransferTransaction(db,entry.store,s=>s.get(entry.key),{signal});
            // Storage revisions are installation-local invalidation tokens, not
            // portable project content. Preserve comparison of all other fields.
            const existingValue = portableRecordForComparison(entry, current);
            const incomingValue = portableRecordForComparison(entry, entry.value);
            if (current!==undefined && await archiveValueDigest(existingValue, signal)!==await archiveValueDigest(incomingValue, signal)) throw new Error(`Destination already contains different data in ${entry.store}. Nothing was imported.`);
          }
        }
      }
      if (entry.kind==='local' && localStorage.getItem(entry.key)!==null && portableLocalMetadata(entry.key,localStorage.getItem(entry.key))!==portableLocalMetadata(entry.key,entry.value)) throw new Error('Destination has conflicting project settings.');
    },signal,percent=>onProgress(`Validating project archive (${percent}%)…`));
    for (const db of preflight.values()) db?.close();
    preflight.clear();
    onProgress('Importing validated project records…');
    await visitArchive(file,async(entry,header,schemas)=>{
      assertNew(header.project);
      if (entry.kind==='record') {
        if(entry.db===HAZARD_DB && entry.store==='hazardAnalysisRuns')hazardIds.add(entry.key);
        writing=`IndexedDB ${entry.db} / ${entry.store}`;
        const db=await connect(schemas.get(entry.db));
        const deriveMetadata=entry.db===HAZARD_DB && entry.store==='hazardAnalysisRuns' && !schemas.get(entry.db).stores.runMetadata;
        const tx=db.transaction(deriveMetadata?[entry.store,'runMetadata']:entry.store,'readwrite'); tx.done.catch(()=>{});
        const recordStore=tx.objectStore(entry.store);
        const current=await recordStore.get(entry.key);
        if (current!==undefined) {
          await tx.done;
          if (await archiveValueDigest(portableRecordForComparison(entry, current), signal)!==await archiveValueDigest(portableRecordForComparison(entry, entry.value), signal)) throw new Error('Destination changed during import.');
          return;
        }
        if (recordStore.keyPath===null) await recordStore.add(entry.value,entry.key); else await recordStore.add(entry.value);
        if(deriveMetadata)await tx.objectStore('runMetadata').add(hazardMetadata(entry.value));
        await tx.done;
        journal.push([db,entry.store,entry.key]);
        if(entry.db===HAZARD_DB && entry.store==='runMetadata')importedMetadata.add(entry.key);
        if(deriveMetadata){journal.push([db,'runMetadata',entry.key]);importedMetadata.add(entry.key);}
      } else if (entry.kind==='local' || entry.kind==='fallback') {
        const before=localStorage.getItem(entry.key); localJournal.push([entry.key,before]);
        writing=`localStorage ${entry.key.startsWith('cbaMeta:') ? 'architecture metadata' : 'project settings'}`;
        if (entry.kind==='local') localStorage.setItem(entry.key,portableLocalMetadata(entry.key,entry.value));
        else {
          const current=JSON.parse(before || (Array.isArray(entry.value)?'[]':'{}'));
          const merge=(a=[],b=[])=>{ const ids=new Set(a.map(v=>v.id)); if(b.some(v=>ids.has(v.id))) throw new Error('Conflicting fallback record.'); return [...a,...b]; };
          const next=Array.isArray(entry.value)?merge(current,entry.value):{...current,...Object.fromEntries(Object.entries(entry.value).map(([k,v])=>[k,merge(current[k],v)]))};
          localStorage.setItem(entry.key,JSON.stringify(next));
        }
      }
    },signal,percent=>onProgress(`Importing project records (${percent}%)…`));
    // Older archives may declare a metadata store but omit its rows. Complete the
    // small derived index before the project becomes visible, with rollback tracking.
    for(const id of hazardIds){
      check(signal);
      const db=opened.get(HAZARD_DB),tx=db.transaction(['hazardAnalysisRuns','runMetadata'],'readwrite');tx.done.catch(()=>{});
      try{
        const run=await tx.objectStore('hazardAnalysisRuns').get(id),metaStore=tx.objectStore('runMetadata');
        const expected=hazardMetadata(run),current=await metaStore.get(id);
        if(current && JSON.stringify(hazardMetadata(current))!==JSON.stringify(expected) && !importedMetadata.has(id))throw new Error('Destination has conflicting hazard metadata.');
        if(!current || importedMetadata.has(id))await metaStore.put({...expected, storageRevision: newHazardStorageRevision()});
        await tx.done;if(!current)journal.push([db,'runMetadata',id]);
      }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
    }
    // Prepare random-access table ranges before exposing the imported project.
    // This is part of import, never an implicit cold-view hydration.
    for(const id of hazardIds){
      onProgress('Preparing imported hazard tables for fast opening…');
      await prepareHazardTableIndex(opened.get(HAZARD_DB),id,{signal,onProgress:({completed,total})=>onProgress(`Preparing imported hazard tables (${Math.floor(completed*100/total)}%)…`)});
    }
    check(signal);assertNew(header.project);
    const projects=JSON.parse(localStorage.getItem(PROJECTS)||'[]');
    const project=portableProject(header.project);
    writing='localStorage project list';
    localStorage.setItem(PROJECTS,JSON.stringify([...projects,project]));
    onProgress('100% — project imported. Reload to open it and continue saved analyses.');
    return project;
  } catch(error) {
    const failures=[];
    for (const [db,store,key] of journal.reverse()) try {await db.delete(store,key);} catch(e){failures.push(e);}
    for (const [key,value] of localJournal.reverse()) try {if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch(e){failures.push(e);}
    const message=error?.name==='QuotaExceededError' ? `Browser storage quota exceeded while saving ${writing}. The compressed download size is smaller than the restored data. Existing projects were not removed.` : error.message;
    if(failures.length) throw new Error(`${message} Cleanup was incomplete; keep the export file and contact support before retrying.`);
    if(error?.name==='QuotaExceededError')throw new Error(`${message} This import was rolled back.`);
    throw error;
  } finally { for(const db of opened.values())db.close(); for(const db of preflight.values())db?.close(); }
}
