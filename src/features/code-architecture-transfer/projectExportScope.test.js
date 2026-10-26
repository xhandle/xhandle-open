import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { openDB } from 'idb';
import { exportProjectArchive, importProjectArchive } from './projectArchive';
import { openCbaIndexedDB, readCbaRowsFromIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { writeRecord, readRecord } from '../code-architecture-storage/chunkedRecord';
import { saveArtifactRowsAsync, loadArtifactRowsAsync, storageKeyFor } from '../code-architecture-assurance/artifactUtils';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { createRequirementCheckpoint } from './requirementCheckpoint';
const project={id:'scope-project',name:'Analysis only',repos:[{id:'r1',owner:'fixture',repo:'source',repoId:'fixture/source',branch:'main',token:'DO_NOT_EXPORT',sourceIndex:'DO_NOT_EXPORT',analysisContext:{text:'Saved context',files:[]}}],report:'DO_NOT_EXPORT'};
const scope=`cba:${project.id}:r1`;
const kinds=['software-requirements','system-requirements','subsystem-requirements','design-elements'];
const fresh=()=>{global.indexedDB=new IDBFactory();localStorage.clear();};
beforeAll(()=>{global.structuredClone=value=>deserialize(serialize(value));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);

test('exports all six analyses and partial continuation, excluding broad project payloads before reading them',async()=>{
  let db=await openCbaIndexedDB();
  const rows=[{traceId:'CSU-1',from:'Current',functionalAbstraction:{functions:[{id:'F-1'}]}}];
  await writeRecord(db,'copilot_baseline',scope,rows);
  for(const suffix of [':history:old',':report',':cache:unrelated',':requirements-work:unrelated:one'])await writeRecord(db,'copilot_baseline',scope+suffix,{secret:'DO_NOT_EXPORT'});
  await writeRecord(db,'code_index','code:file:fixture/source:large.cpp',{content:'DO_NOT_EXPORT'.repeat(100000)});
  await writeRecord(db,'copilot_baseline',`${scope}:functional-work:partial`,{response:{functions:[{id:'F-2'}]}});
  await writeRecord(db,'diagram_positions','diagram:github:fixture/source:main:function-spacing-v3',{n:{x:42,y:8}});db.close();
  const excluded=['xhandle-safety-remediation','xhandle-results-review','xhandle-workspace-graph','TraceabilityDB','TraceabilityMeta','BaselinesDB','SafetyCaseEvidenceDB','xhandle-project-reports','xhandle-recovery'];
  for(const name of excluded){db=await openDB(name,1,{upgrade(d){d.createObjectStore('rows',{keyPath:'id'});}});await db.put('rows',{id:'old',projectId:project.id,secret:'DO_NOT_EXPORT'});db.close();}
  await saveCodeArchitectureHazardRun({id:'hazard',projectId:project.id,repoId:'r1',status:'partial',summary:[{id:'HA-1'}],continuation:{pending:['next']}});
  for(const kind of kinds){
    await saveArtifactRowsAsync(kind,project.id,'r1',[{id:kind,requirementText:'Saved result',traceLinks:[{targetId:'CSU-1'}]}]);
    await createRequirementCheckpoint(project.id,'r1',kind)('batch',async()=>`partial-${kind}`,Boolean);
  }
  const contextKey=`xhandle:code-architecture-hazard-contexts:v1:${project.id}:r1`;
  localStorage.setItem(contextKey,JSON.stringify({text:'Hazard operational context'}));
  localStorage.setItem(`xhandle:cba-custom:${project.id}:r1`,'DO_NOT_EXPORT');
  localStorage.setItem('xhandle:results-review:items',JSON.stringify([{projectId:project.id,secret:'DO_NOT_EXPORT'}]));
  const get=IDBObjectStore.prototype.get,open=indexedDB.open.bind(indexedDB);
  const readSpy=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){
    if(this.name==='code_index'||String(key).includes(':history:')||String(key).endsWith(':report')||String(key).includes(':cache:'))throw Error('Excluded payload was read');
    return get.call(this,key);
  });
  const openSpy=jest.spyOn(indexedDB,'open').mockImplementation((name,...args)=>{if(excluded.includes(name))throw Error('Excluded database was opened');return open(name,...args);});
  let archive;try{archive=await exportProjectArchive(project);}finally{readSpy.mockRestore();openSpy.mockRestore();}
  const text=await archive.text();expect(text).not.toContain('DO_NOT_EXPORT');expect(text).not.toContain(':history:');expect(archive.size).toBeLessThan(100000);
  fresh();await importProjectArchive(archive);
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual(rows);
  const hazard=await getLatestCodeArchitectureHazardRun({projectId:project.id,repoId:'r1'});expect(hazard.status).toBe('partial');expect(hazard.continuation.pending).toEqual(['next']);
  for(const kind of kinds){
    expect((await loadArtifactRowsAsync(kind,project.id,'r1'))[0].id).toBe(kind);
    const generate=jest.fn();expect(await createRequirementCheckpoint(project.id,'r1',kind)('batch',generate,Boolean)).toBe(`partial-${kind}`);expect(generate).not.toHaveBeenCalled();
  }
  db=await openCbaIndexedDB();expect(await readRecord(db,'diagram_positions','diagram:github:fixture/source:main:function-spacing-v3')).toEqual({n:{x:42,y:8}});db.close();
  expect(JSON.parse(localStorage.getItem(contextKey)).text).toBe('Hazard operational context');
  const saved=JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0];expect(saved.report).toBeUndefined();expect(saved.repos[0].sourceIndex).toBeUndefined();expect(saved.repos[0].analysisContext.text).toBe('Saved context');
});

test('absent optional analyses remain absent and export makes no provider requests',async()=>{
  const db=await openCbaIndexedDB();await writeRecord(db,'copilot_baseline',scope,[{from:'CSU'}]);db.close();
  const fetch=jest.spyOn(global,'fetch').mockImplementation(()=>{throw Error('Export must not generate results');});
  let archive;try{archive=await exportProjectArchive(project);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
  expect(await archive.text()).not.toContain('hazardAnalysisRuns');expect(await archive.text()).not.toContain('artifactRows');
  fresh();await importProjectArchive(archive);
  expect((await indexedDB.databases()).map(d=>d.name)).toEqual(['xhandle']);
});

test('only referenced requirement chunks are exported; missing chunks fail instead of losing results',async()=>{
  const key=storageKeyFor('software-requirements',project.id,'r1');
  const db=await openDB('xhandle-code-architecture-assurance',1,{upgrade(d){d.createObjectStore('artifactRows',{keyPath:'key'});}});
  await db.put('artifactRows',{key,chunked:true,chunkKeys:[`${key}:chunk:0`],rowCount:1,rows:[]});
  await db.put('artifactRows',{key:`${key}:chunk:0`,parentKey:key,rows:[{id:'SW-1'}]});
  await db.put('artifactRows',{key:`${key}:chunk:old`,parentKey:key,rows:[{id:'DO_NOT_EXPORT'}]});
  const archive=await exportProjectArchive(project);expect(await archive.text()).not.toContain('DO_NOT_EXPORT');
  await db.delete('artifactRows',`${key}:chunk:0`);
  await expect(exportProjectArchive(project)).rejects.toThrow(/missing a data chunk/);db.close();
  fresh();await importProjectArchive(archive);expect(await loadArtifactRowsAsync('software-requirements',project.id,'r1')).toEqual([{id:'SW-1'}]);
});

test('legacy repository aliases retain saved architecture and generated requirements',async()=>{
  const legacy=`cba:${project.id}:fixture/source`;
  const db=await openCbaIndexedDB();await writeRecord(db,'copilot_baseline',legacy,[{from:'Legacy'}]);db.close();
  await saveArtifactRowsAsync('design-elements',project.id,'fixture/source',[{id:'DESIGN-legacy'}]);
  const archive=await exportProjectArchive(project);fresh();await importProjectArchive(archive);
  expect(await readCbaRowsFromIndexedDB(legacy)).toEqual([{from:'Legacy'}]);
  expect((await loadArtifactRowsAsync('design-elements',project.id,'fixture/source'))[0].id).toBe('DESIGN-legacy');
});

test('category selection excludes unselected results and checkpoints before database reads',async()=>{
 let db=await openCbaIndexedDB();await writeRecord(db,'copilot_baseline',scope,[{from:'saved architecture'}]);db.close();
 await saveCodeArchitectureHazardRun({id:'hazard',projectId:project.id,repoId:'r1',summary:[{id:'excluded hazard'}]});
 for(const kind of kinds){await saveArtifactRowsAsync(kind,project.id,'r1',[{id:kind}]);await createRequirementCheckpoint(project.id,'r1',kind)('batch',async()=>`checkpoint-${kind}`,Boolean);}
 const original=indexedDB.open.bind(indexedDB);
 const spy=jest.spyOn(indexedDB,'open').mockImplementation((name,...args)=>{if(name==='xhandle-code-architecture-hazard-analysis')throw Error('Unselected hazards were read');return original(name,...args);});
 let archive;try{archive=await exportProjectArchive(project,{categories:['software-requirements']});}finally{spy.mockRestore();}
 const text=await archive.text();expect(text.includes('checkpoint-system-requirements')).toBe(false);
 fresh();await importProjectArchive(archive);
 expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{from:'saved architecture'}]);
 expect(await loadArtifactRowsAsync('software-requirements',project.id,'r1')).toEqual([{id:'software-requirements'}]);
 expect(await loadArtifactRowsAsync('system-requirements',project.id,'r1')).toEqual([]);
 expect(await getLatestCodeArchitectureHazardRun({projectId:project.id,repoId:'r1'})).toBeNull();
 const generate=jest.fn();expect(await createRequirementCheckpoint(project.id,'r1','software-requirements')('batch',generate,Boolean)).toBe('checkpoint-software-requirements');expect(generate).not.toHaveBeenCalled();
});
test('invalid category rejects export and architecture-only selection is supported',async()=>{
 await expect(exportProjectArchive(project,{categories:['unknown']})).rejects.toThrow(/category/);
 const file=await exportProjectArchive(project,{categories:[]});fresh();await importProjectArchive(file);
 expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].id).toBe(project.id);
});
