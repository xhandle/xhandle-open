/* global BigInt */
import { flushProjectArtifactWrites } from '../code-architecture-assurance/artifactUtils';
import { flushProjectArchitectureWrites } from '../code-architecture-assurance/codeArchitectureStorage';
import { assertProjectHazardsSaved } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { openDB } from 'idb';
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
  'xhandle-code-architecture-hazard-analysis': 3, 'xhandle-safety-remediation': 2,
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
async function assertCompatibleSchema(db, schema) {
  validateSchemaVersion({name: schema.name, version: db.version});
  for (const [name, spec] of Object.entries(schema.stores)) {
    if (!db.objectStoreNames.contains(name)) throw new Error(`Incompatible destination schema (${schema.name}/${name}). Update xHandle before importing.`);
    const tx = db.transaction(name), store = tx.store;
    const matches = JSON.stringify(store.keyPath) === JSON.stringify(spec.keyPath) && store.autoIncrement === spec.autoIncrement &&
      spec.indexes.every(index => {
        if (!store.indexNames.contains(index.name)) return false;
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
  for await (const token of streamValue(value)) {
    check(signal); hash.update(JSON.stringify(token)); hash.update('\n');
    if (++count % 256 === 0) await yieldTask();
  }
  return hash.digest('hex');
}
function openArchiveDB(name, version, upgrade) {
  return new Promise((resolve,reject) => {
    let settled=false;
    const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}};
    const timer=setTimeout(()=>fail(new Error(`Storage connection timed out (${name}). Close other xHandle tabs and retry.`)),15000);
    openDB(name,version,{
      upgrade(db,old,next,tx) {tx.done.catch(()=>{});if(settled){tx.abort();return;}upgrade?.(db,old,next,tx);},
      blocked(){fail(new Error(`Storage upgrade blocked (${name}). Close other xHandle tabs and retry.`));},
    }).then(db=>{if(settled){db.close();return;}settled=true;clearTimeout(timer);resolve(db);},fail);
  });
}
async function existingDB(name) {
  let absent = false;
  try { return await openArchiveDB(name, undefined, (db, old, next, tx) => { absent = true; tx.abort(); }); }
  catch (error) { if (absent) return null; throw error; }
}
// One record per transaction: encoding/hash/file work never keeps an IDB
// transaction alive across unrelated awaits (important in Safari).
async function* records(db, store) {
  let after;
  for (;;) {
    const tx = db.transaction(store);
    const cursor = await tx.store.openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true));
    if (!cursor) { await tx.done; return; }
    const record = {key:cursor.primaryKey, value:cursor.value};
    after = cursor.primaryKey;
    await tx.done;
    yield record;
  }
}
function ownership(project) {
  const prefixes = (project.repos || []).flatMap(repo => [codeSourceIndexPrefix(repo), repo.sourceType === 'local' && repo.sourceId ? `code:local:${repo.sourceId}:` : '', repo.owner && repo.repo ? `code:github:${repo.owner}/${repo.repo}:` : '', repo.owner && repo.repo ? `code:file:${repo.owner}/${repo.repo}:` : '']).filter(Boolean);
  const layouts = (project.repos || []).flatMap(repo => {
    const ids = [repo.repoId, repo.repoName, repo.id, repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : null].filter(Boolean);
    return ids.map(id => `diagram:github:${id}:${repo.branch || 'main'}`);
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
  return { owns, local: key => projectOwnsStorageKey(key,project.id) || prefixes.some(prefix=>key.startsWith(prefix)) };
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
export async function exportProjectArchive(project, {signal,onProgress=()=>{}} = {}) {
  if (!project?.id) throw new Error('Select a project.');
  check(signal); onProgress('Preparing project export — saving pending edits…');
  const preparation = {projectId: project.id, tasks: []};
  window.dispatchEvent(new CustomEvent('xhandle:prepare-project-export', {detail: preparation}));
  await Promise.all(preparation.tasks);
  check(signal); onProgress('Preparing project export — saving architecture results…');
  await flushProjectArchitectureWrites(project.id);
  check(signal); onProgress('Preparing project export — saving requirements and design results…');
  await flushProjectArtifactWrites(project.id);
  check(signal);
  assertProjectHazardsSaved(project.id);
  const portable = portableProject(project), scope=ownership(portable), parts=[], hash=sha256();
  let count=0, stagePercent=0;
  const integrity = createChunkIntegrityCheck();
  let serializedBytes = 0, lastProgress = 0;
  const appendLine = async entry => {
    check(signal);
    const line=JSON.stringify(await encodeValue(entry))+'\n';
    hash.update(line); parts.push(new Blob([line])); count++;
    serializedBytes += line.length;
    if (Date.now() - lastProgress >= 100 || count % 32 === 0) {
      onProgress(`Exporting saved project data (${stagePercent}%) — ${(serializedBytes / 1048576).toFixed(1)} MB prepared…`);
      await yieldTask(); lastProgress = Date.now();
    }
  };
  const append = async entry => {
    check(signal); integrity.add(entry);
    if (fitsArchiveLine(entry)) return appendLine(entry);
    await appendLine({kind:'stream-start',transportVersion:2});
    let tokens=[], size=0;
    for await (const token of streamValue(entry)) {
      check(signal);
      tokens.push(token); size += JSON.stringify(token).length;
      if (size >= 16384) { await appendLine({kind:'stream-data',tokens}); tokens=[]; size=0; }
    }
    if (tokens.length) await appendLine({kind:'stream-data',tokens});
    await appendLine({kind:'stream-end'});
  };
  await append({type:PROJECT_ARCHIVE_TYPE,version:2,project:portable,createdAt:new Date().toISOString()});
  for (let i=0;i<DATABASES.length;i++) {
    check(signal); stagePercent=Math.round(i/DATABASES.length*95); onProgress(`Exporting saved project data (${stagePercent}%)…`);
    const name=DATABASES[i], db=await existingDB(name);
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
      await append({kind:'database',name,version:db.version,stores:schema});
      for (const store of stores) for await (const {key,value} of records(db,store)) {
        if (scope.owns(name,store,key,value)) await append({kind:'record',db:name,store,key,value});
      }
    } finally {db.close();}
  }
  for (const key of Object.keys(localStorage)) {
    if (scope.local(key)) await append({kind:'local',key,value:localStorage.getItem(key)});
  }
  // Legacy fallback stores hold several projects; transfer only owned entries.
  for (const key of FALLBACKS) {
    const raw=localStorage.getItem(key); if (!raw) continue;
    const state=JSON.parse(raw), filter=rows=>rows.filter(row=>scope.owns('xhandle-safety-remediation','',null,row));
    const value=Array.isArray(state) ? filter(state) : Object.fromEntries(Object.entries(state).map(([k,v])=>[k,Array.isArray(v)?filter(v):[]]));
    await append({kind:'fallback',key,value});
  }
  integrity.finish();
  parts.push(new Blob([JSON.stringify(await encodeValue({kind:'end',count,digest:hash.digest('hex')}))+'\n']));
  check(signal); onProgress('100% — archive ready. Save the project file.');
  return new Blob(parts,{type:'application/x-xhandle-project'});
}

async function* archiveLines(file) {
  const decoder=new TextDecoder(); let buffer='';
  for (let offset=0;offset<file.size;offset+=256*1024) {
    buffer+=decoder.decode(await file.slice(offset,offset+256*1024).arrayBuffer(),{stream:true});
    let end;
    while ((end=buffer.indexOf('\n'))>=0) { const line=buffer.slice(0,end+1); buffer=buffer.slice(end+1); yield line; }
  }
  buffer+=decoder.decode();
  if (buffer) throw new Error('Archive is incomplete (missing final newline).');
}
async function visitArchive(file, visit, signal, onReadProgress=()=>{}) {
  let bytes=0, lastPercent=-1;
  const integrity = createChunkIntegrityCheck();
  let header,scope,end=false,count=0, assembling=null; const hash=sha256(), schemas=new Map(), seen=new Set();
  for await (const line of archiveLines(file)) {
    check(signal); bytes += new Blob([line]).size;
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
        assembling = createValueAssembler(); continue;
      }
      if (!assembling) throw new Error('Unexpected streamed project record.');
      if (entry.kind === 'stream-data') {
        if (!Array.isArray(entry.tokens)) throw new Error('Invalid streamed project record.');
        for (const token of entry.tokens) assembling.add(token);
        if (count % 32 === 0) { await yieldTask(); check(signal); }
        continue;
      }
      entry = assembling.finish(); assembling = null;
      if (entry?.kind === 'end') throw new Error('Invalid streamed archive footer.');
    } else if (assembling) throw new Error('Incomplete streamed project record.');
    if (!header) {
      if (entry?.type!==PROJECT_ARCHIVE_TYPE || ![1,2].includes(entry.version) || typeof entry.project?.id!=='string' || !entry.project.id || !Array.isArray(entry.project.repos)) throw new Error('Unsupported project archive.');
      header=entry; scope=ownership(header.project);
    } else if (entry.kind==='end') {
      if (entry.count!==count || entry.digest!==hash.digest('hex')) throw new Error('Project archive checksum failed. No project was imported.');
      end=true; continue;
    } else if (entry.kind==='database') {
      if (!DATABASES.includes(entry.name) || schemas.has(entry.name) || !Number.isInteger(entry.version) || entry.version<1) throw new Error('Invalid archive database.');
      validateSchemaVersion(entry);
      schemas.set(entry.name,entry);
    } else if (entry.kind==='record') {
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
  }
  if (!end || assembling) throw new Error('Incomplete project archive.');
  integrity.finish();
  return header;
}
export async function importProjectArchive(file, {signal,onProgress=()=>{}} = {}) {
  const opened=new Map(), preflight=new Map(), journal=[], localJournal=[];
  const connect=async schema=>{
    if (opened.has(schema.name)) return opened.get(schema.name);
    validateSchemaVersion(schema);
    const current = await existingDB(schema.name);
    if (current) {
      try { await assertCompatibleSchema(current, schema); }
      catch (error) { current.close(); throw error; }
      opened.set(schema.name, current);
      return current;
    }
    const version = REPAIRABLE_DATABASES.has(schema.name) ? SUPPORTED_VERSIONS[schema.name] : schema.version;
    const db=await openArchiveDB(schema.name,version,(db,old,next,tx)=>{
      if (old !== 0) { tx.abort(); return; } // Another tab created it after preflight.
      for (const [name,spec] of Object.entries(schema.stores)) {
        const store=db.objectStoreNames.contains(name)?tx.objectStore(name):db.createObjectStore(name,{keyPath:spec.keyPath,autoIncrement:spec.autoIncrement});
        for (const index of spec.indexes) if (!store.indexNames.contains(index.name)) store.createIndex(index.name,index.keyPath,{unique:index.unique,multiEntry:index.multiEntry});
      }
    });
    opened.set(schema.name,db);return db;
  };
  const assertNew=project=>{
    if (JSON.parse(localStorage.getItem(PROJECTS)||'[]').some(p=>p.id===project.id)) throw new Error('This project already exists here. Import into another instance to preserve its original analysis identity.');
  };
  try {
    onProgress('Validating project archive…');
    const header=await visitArchive(file,async(entry,header,schemas)=>{
      assertNew(header.project);
      if (entry.kind==='database') {
        const db = await existingDB(entry.name);
        preflight.set(entry.name, db);
        if (db) await assertCompatibleSchema(db, entry);
      }
      if (entry.kind==='record') {
        if (!preflight.has(entry.db)) preflight.set(entry.db,await existingDB(entry.db));
        const db=preflight.get(entry.db);
        if (db) {
          if (db.objectStoreNames.contains(entry.store)) {
            const current=await db.get(entry.store,entry.key);
            if (current!==undefined && await archiveValueDigest(current, signal)!==await archiveValueDigest(entry.value, signal)) throw new Error(`Destination already contains different data in ${entry.store}. Nothing was imported.`);
          }
        }
      }
      if (entry.kind==='local' && localStorage.getItem(entry.key)!==null && localStorage.getItem(entry.key)!==entry.value) throw new Error('Destination has conflicting project settings.');
    },signal,percent=>onProgress(`Validating project archive (${percent}%)…`));
    for (const db of preflight.values()) db?.close();
    preflight.clear();
    onProgress('Importing validated project records…');
    await visitArchive(file,async(entry,header,schemas)=>{
      assertNew(header.project);
      if (entry.kind==='record') {
        const db=await connect(schemas.get(entry.db));
        const tx=db.transaction(entry.store,'readwrite'); tx.done.catch(()=>{});
        const current=await tx.store.get(entry.key);
        if (current!==undefined) {
          await tx.done;
          if (await archiveValueDigest(current, signal)!==await archiveValueDigest(entry.value, signal)) throw new Error('Destination changed during import.');
          return;
        }
        if (tx.store.keyPath===null) await tx.store.add(entry.value,entry.key); else await tx.store.add(entry.value);
        await tx.done;
        journal.push([db,entry.store,entry.key]);
      } else if (entry.kind==='local' || entry.kind==='fallback') {
        const before=localStorage.getItem(entry.key); localJournal.push([entry.key,before]);
        if (entry.kind==='local') localStorage.setItem(entry.key,entry.value);
        else {
          const current=JSON.parse(before || (Array.isArray(entry.value)?'[]':'{}'));
          const merge=(a=[],b=[])=>{ const ids=new Set(a.map(v=>v.id)); if(b.some(v=>ids.has(v.id))) throw new Error('Conflicting fallback record.'); return [...a,...b]; };
          const next=Array.isArray(entry.value)?merge(current,entry.value):{...current,...Object.fromEntries(Object.entries(entry.value).map(([k,v])=>[k,merge(current[k],v)]))};
          localStorage.setItem(entry.key,JSON.stringify(next));
        }
      }
    },signal,percent=>onProgress(`Importing project records (${percent}%)…`));
    check(signal);assertNew(header.project);
    const projects=JSON.parse(localStorage.getItem(PROJECTS)||'[]');
    const project=portableProject(header.project);
    localStorage.setItem(PROJECTS,JSON.stringify([...projects,project]));
    onProgress('100% — project imported. Reload to open it and continue saved analyses.');
    return project;
  } catch(error) {
    const failures=[];
    for (const [db,store,key] of journal.reverse()) try {await db.delete(store,key);} catch(e){failures.push(e);}
    for (const [key,value] of localJournal.reverse()) try {if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch(e){failures.push(e);}
    if(failures.length) throw new Error(`${error.message} Cleanup was incomplete; retry in a fresh instance.`);
    throw error;
  } finally { for(const db of opened.values())db.close(); for(const db of preflight.values())db?.close(); }
}
