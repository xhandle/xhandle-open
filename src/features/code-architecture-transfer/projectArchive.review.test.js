// Regression coverage for the complete-project transfer review findings.
import { deriveSoftwareRequirements } from '../code-architecture-assurance/artifactAI';
import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { openDB } from 'idb';
import { sha256 } from 'hash.js';
import { exportProjectArchive, importProjectArchive, encodeValue, decodeValue } from './projectArchive';
import { createRequirementCheckpoint } from './requirementCheckpoint';
import { readCbaRowsFromIndexedDB, openCbaIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { writeRecord, stageRecord, putRawRecord, readRecord } from '../code-architecture-storage/chunkedRecord';
import { saveArtifactRowsAsync, loadArtifactRowsAsync } from '../code-architecture-assurance/artifactUtils';

const project={id:'p1',name:'Partial project',repos:[{id:'r1',owner:'test',repo:'source',commitSha:'abc',token:'PRIVATE'}],activeRepoId:'r1'};
const scope='cba:p1:r1';
function fresh() { global.indexedDB=new IDBFactory(); localStorage.clear(); }
beforeAll(()=>{global.structuredClone=value=>deserialize(serialize(value));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);

test('export omits unreachable old chunks but preserves current results and checkpoints without reading unrelated payloads',async()=>{
  const db=await openCbaIndexedDB();
  await stageRecord(db,'copilot_baseline',scope,{obsolete:'unused data'.repeat(10000)});
  const history=await stageRecord(db,'copilot_baseline',scope,{saved:'historical results'});
  await putRawRecord(db,'copilot_baseline',`${scope}:history:one`,history);
  await writeRecord(db,'copilot_baseline',scope,[{from:'Current'}]);
  const checkpoint=`functional-decomposition-checkpoint:${scope}:partial`;
  await writeRecord(db,'copilot_baseline',checkpoint,{completedPaths:['a.cpp'],failedFiles:[{path:'b.cpp'}]});
  await putRawRecord(db,'code_index','code:file:other/repo:huge.cpp',{content:'unrelated payload'});db.close();
  const get=IDBObjectStore.prototype.get;
  const spy=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){
    if(key==='code:file:other/repo:huge.cpp')throw new Error('Unrelated payload was hydrated');
    return get.call(this,key);
  });
  let file;try{file=await exportProjectArchive(project);}finally{spy.mockRestore();}
  expect(file.size).toBeLessThan(20000);
  expect(await file.text()).not.toContain('unused data');
  fresh();await importProjectArchive(file);
  const restored=await openCbaIndexedDB();
  expect(await readRecord(restored,'copilot_baseline',`${scope}:history:one`)).toBeUndefined();
  expect(await readRecord(restored,'copilot_baseline',checkpoint)).toEqual({completedPaths:['a.cpp'],failedFiles:[{path:'b.cpp'}]});restored.close();
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{from:'Current'}]);
});


test('repository-scoped diagram positions survive transfer', async()=>{
  const key='diagram:github:test/source:main';
  const db=await openDB('xhandle',4,{upgrade(db){for(const store of ['code_index','copilot_baseline','diagram_positions'])db.createObjectStore(store,{keyPath:'key'});}});
  await db.put('diagram_positions',{key,value:{node1:{x:42,y:90}}});db.close();
  const archive=await exportProjectArchive({...project,repos:[{...project.repos[0],repoId:'test/source',branch:'main'}]});
  expect(await archive.text()).toContain(key);
  fresh();await importProjectArchive(archive);
  const restored=await openCbaIndexedDB();
  const tx=restored.transaction('diagram_positions');
  const value=await new Promise((resolve,reject)=>{const request=tx.objectStore('diagram_positions').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  restored.close();expect(value.value).toEqual({node1:{x:42,y:90}});
});

test('export rejects a missing architecture chunk',async()=>{
  const db=await openDB('xhandle',4,{upgrade(db){for(const store of ['code_index','copilot_baseline','diagram_positions'])db.createObjectStore(store,{keyPath:'key'});}});
  await db.put('copilot_baseline',{key:scope,value:{format:'xhandle-json-tree-v1',root:`${scope}:$part:missing`}});db.close();
  await expect(exportProjectArchive(project)).rejects.toThrow(/missing a data chunk/);
});

test('compatible newer assurance database accepts import without downgrade',async()=>{
  await saveArtifactRowsAsync('software-requirements','p1','r1',[{id:'SW-1',requirementText:'Saved'}]);
  const archive=await exportProjectArchive(project);fresh();
  const db=await openDB('xhandle-code-architecture-assurance',2,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'key'});}});db.close();
  await expect(importProjectArchive(archive)).resolves.toMatchObject({id:'p1'});
  expect(await loadArtifactRowsAsync('software-requirements','p1','r1')).toEqual([{id:'SW-1',requirementText:'Saved'}]);
});

test('legacy incomplete checkpoint is retried after transfer and complete results are then reused',async()=>{
  const cbaRows=[1,2].map(n=>({traceId:`FD-${n}`,from:`handler${n}`,action:'Validate commands',to:'actuator',fromFile:'control.cpp'}));
  const task=options=>JSON.parse(JSON.parse(options.body).messages[1].content).task;
  global.fetch=jest.fn(async(url,options)=>task(options)==='rewrite_code_echo_software_requirements'
    ? {ok:false,status:400,text:async()=>'Rewrite unavailable'}
    : {ok:true,json:async()=>({answer:JSON.stringify({requirements:[{id:'SWR-001',requirementText:'The software shall validate incoming commands before execution.',sourceTraceId:'FD-1'}]})})});
  const checkpoint=createRequirementCheckpoint('p1','r1','software-requirements');
  const onProgress=jest.fn();
  // Simulate an archive produced by the previous permissive cache validator.
  onProgress.requestCheckpoint=(basis,generate)=>checkpoint(basis,generate,()=>true);
  const first=await deriveSoftwareRequirements({cbaRows,onProgress});
  expect(first.some(row=>row.source==='functional-derived-fallback')).toBe(true);
  const archive=await exportProjectArchive(project);fresh();await importProjectArchive(archive);
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({answer:JSON.stringify({requirements:[1,2].map(n=>({id:`SWR-00${n}`,requirementText:'The software shall validate incoming commands before execution.',sourceTraceId:`FD-${n}`}))})})}));
  const continued=jest.fn();continued.requestCheckpoint=createRequirementCheckpoint('p1','r1','software-requirements');
  const second=await deriveSoftwareRequirements({cbaRows,onProgress:continued});
  expect(global.fetch.mock.calls.some(([,options])=>task(options)==='derive_software_requirements_from_functional_decomposition_batch')).toBe(true);
  expect(second.some(row=>row.source==='functional-derived-fallback')).toBe(false);
  global.fetch.mockClear();
  await deriveSoftwareRequirements({cbaRows,onProgress:continued});
  expect(global.fetch).not.toHaveBeenCalled();
});

test('unsupported source version cannot upgrade the shared database',async()=>{
  const source=await openDB('xhandle',5,{upgrade(db){for(const store of ['code_index','copilot_baseline','diagram_positions'])db.createObjectStore(store,{keyPath:'key'});}});
  await source.put('copilot_baseline',{key:scope,value:[{from:'Imported'}]});source.close();
  const archive=await exportProjectArchive(project);fresh();
  const destination=await openCbaIndexedDB();await writeRecord(destination,'copilot_baseline','cba:other:r1',[{from:'Keep accessible'}]);destination.close();
  await expect(importProjectArchive(archive)).rejects.toThrow(/Unsupported database version/);
  expect(await readCbaRowsFromIndexedDB('cba:other:r1')).toEqual([{from:'Keep accessible'}]);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});

async function rewriteArchive(archive, change) {
  const entries = (await archive.text()).trim().split('\n').map(line => decodeValue(JSON.parse(line)));
  const updated = change(entries.slice(0, -1));
  const hash = sha256(), lines = [];
  for (const entry of updated) {
    const line = JSON.stringify(await encodeValue(entry)) + '\n';
    hash.update(line); lines.push(line);
  }
  lines.push(JSON.stringify(await encodeValue({kind:'end', count:updated.length, digest:hash.digest('hex')})) + '\n');
  return new Blob(lines);
}

test('checksum-valid archive missing a referenced part is rejected before any writes', async()=>{
  const db=await openCbaIndexedDB();
  await writeRecord(db,'copilot_baseline',scope,[{from:'Complete'}]);db.close();
  const archive=await exportProjectArchive(project);
  const broken=await rewriteArchive(archive,entries=>entries.filter(entry=>!(entry.kind==='record' && String(entry.key).includes(':$part:'))));
  fresh();
  await expect(importProjectArchive(broken)).rejects.toThrow(/missing a data chunk/);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([]);
});

test('checksum-valid archive with modified chunk contents fails its content digest', async()=>{
  const db=await openCbaIndexedDB();
  await writeRecord(db,'copilot_baseline',scope,[{from:'Complete'}]);db.close();
  const archive=await exportProjectArchive(project);
  const broken=await rewriteArchive(archive,entries=>entries.map(entry=>entry.kind==='record' && String(entry.key).includes(':$part:')
    ? {...entry,value:{...entry.value,value:'["value","tampered"]'}} : entry));
  fresh();
  await expect(importProjectArchive(broken)).rejects.toThrow(/Invalid analysis data chunk/);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});

test('incompatible destination key paths are rejected before project writes', async()=>{
  await saveArtifactRowsAsync('software-requirements','p1','r1',[{id:'SW-1'}]);
  const archive=await exportProjectArchive(project);fresh();
  const db=await openDB('xhandle-code-architecture-assurance',2,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'wrong'});}});db.close();
  await expect(importProjectArchive(archive)).rejects.toThrow(/Incompatible destination schema/);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});

test('diagram layout ownership excludes unrelated repositories and branches', async()=>{
  const db=await openDB('xhandle',4,{upgrade(db){for(const store of ['code_index','copilot_baseline','diagram_positions'])db.createObjectStore(store,{keyPath:'key'});}});
  for (const key of ['diagram:github:test/source:main','diagram:github:test/source:other','diagram:github:other/repo:main']) {
    await db.put('diagram_positions',{key,value:{node1:{x:12}}});
  }
  db.close();
  const archive=await exportProjectArchive({...project,repos:[{...project.repos[0],repoId:'test/source',branch:'main'}]});
  expect(await archive.text()).toContain('diagram:github:test/source:main');
  expect(await archive.text()).not.toContain('diagram:github:test/source:other');
  expect(await archive.text()).not.toContain('diagram:github:other/repo:main');
});

test('complete-sized responses with duplicate source coverage are retried', async()=>{
  const cbaRows=[1,2].map(n=>({traceId:`FD-${n}`,from:`handler${n}`,action:'Validate commands',to:'actuator',fromFile:'control.cpp'}));
  const duplicate={requirements:[1,2].map(n=>({id:`SWR-00${n}`,requirementText:'The software shall validate incoming commands before execution.',sourceTraceId:'FD-1'}))};
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({answer:JSON.stringify(duplicate)})}));
  const progress=jest.fn();progress.requestCheckpoint=createRequirementCheckpoint('p1','r1','software-requirements');
  await deriveSoftwareRequirements({cbaRows,onProgress:progress});
  global.fetch.mockClear();
  await deriveSoftwareRequirements({cbaRows,onProgress:progress});
  expect(global.fetch.mock.calls.some(([,options])=>JSON.parse(JSON.parse(options.body).messages[1].content).task==='derive_software_requirements_from_functional_decomposition_batch')).toBe(true);
});
