import { deriveSoftwareRequirements } from '../code-architecture-assurance/artifactAI';
import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { sha256 } from 'hash.js';
import { exportProjectArchive, importProjectArchive, encodeValue, decodeValue } from './projectArchive';
import { createRequirementCheckpoint } from './requirementCheckpoint';
import { readArchitectureCheckpoint, readCbaRowsFromIndexedDB, openCbaIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { writeRecord } from '../code-architecture-storage/chunkedRecord';
import { createCodeHazardCheckpoint } from '../code-architecture-hazard-analysis/codeHazardGenerationCheckpoint';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { saveArtifactRowsAsync, loadArtifactRowsAsync } from '../code-architecture-assurance/artifactUtils';

const project={id:'p1',name:'Partial project',repos:[{id:'r1',owner:'test',repo:'source',commitSha:'abc',token:'PRIVATE'}],activeRepoId:'r1'};
const scope='cba:p1:r1';
function fresh() { global.indexedDB=new IDBFactory(); localStorage.clear(); }
beforeAll(()=>{global.structuredClone=value=>deserialize(serialize(value));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);

test('complete project round trip retains partial architecture, functional responses, hazard and requirement continuation',async()=>{
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([project]));
  const db=await openCbaIndexedDB();
  const partial={version:1,fingerprint:'abc',scope,completedPaths:['first.cpp'],failedFiles:[{path:'next.cpp'}],rows:[{from:'First',sourceEvidence:{text:'x'.repeat(40000)}}]};
  await writeRecord(db,'copilot_baseline',`functional-decomposition-checkpoint:${scope}:abc`,partial);
  await writeRecord(db,'copilot_baseline',scope,[{from:'Existing',traceId:'original-id'}]);
  await writeRecord(db,'copilot_baseline',`${scope}:functional-work:123`,{namespace:'original',prompt:'prompt',response:{functions:[1]}});
  await writeRecord(db,'code_index','code:github:test/source:abc:first.cpp',{content:'code',symbols:['first']});
  await writeRecord(db,'copilot_baseline','cba:another:r1',[{from:'PRIVATE OTHER PROJECT'}]);
  db.close();
  const hazardScope={projectId:'p1',repoId:'r1',method:'STPA'},basis={relationship:'edge-1'};
  const checkpoint=await createCodeHazardCheckpoint(hazardScope);
  await checkpoint.write(basis,{accepted:true,hazard:'saved partial hazard'});
  await saveCodeArchitectureHazardRun({id:'run1',projectId:'p1',repoId:'r1',status:'partial',summary:[{id:'h1'}],updatedAt:'2026-10-24T00:00:00Z'});
  await saveArtifactRowsAsync('software-requirements','p1','r1',[{id:'SW-1',requirementText:'saved requirement'}]);
  const request=createRequirementCheckpoint('p1','r1','software-requirements');
  await request({prompt:'batch one'},async()=> 'accepted result',Boolean);
  localStorage.setItem('xhandle:cba-custom:p1:r1','saved settings');
  localStorage.setItem('githubToken','SECRET');
  const archive=await exportProjectArchive(project);
  expect(await archive.text()).not.toMatch(/PRIVATE|SECRET/);
  fresh();
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'other',name:'Keep me'}]));
  await importProjectArchive(archive);
  expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).map(p=>p.id)).toEqual(['other','p1']);
  expect(await readArchitectureCheckpoint(`functional-decomposition-checkpoint:${scope}:abc`)).toEqual(partial);
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{from:'Existing',traceId:'original-id'}]);
  expect(await (await createCodeHazardCheckpoint(hazardScope)).read(basis)).toEqual({accepted:true,hazard:'saved partial hazard'});
  expect((await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).status).toBe('partial');
  expect(await loadArtifactRowsAsync('software-requirements','p1','r1')).toEqual([{id:'SW-1',requirementText:'saved requirement'}]);
  const generate=jest.fn();
  expect(await createRequirementCheckpoint('p1','r1','software-requirements')({prompt:'batch one'},generate,Boolean)).toBe('accepted result');
  expect(generate).not.toHaveBeenCalled();
  expect(localStorage.getItem('githubToken')).toBeNull();
});

test('corruption/truncation is rejected before destination records change',async()=>{
  const archive=await exportProjectArchive(project); fresh();
  const broken=new Blob([(await archive.text()).replace('Partial project','Changed project')]);
  await expect(importProjectArchive(broken)).rejects.toThrow(/checksum/);
  await expect(importProjectArchive(archive.slice(0,archive.size-25))).rejects.toThrow(/incomplete/i);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});
test('same project import never overwrites local results',async()=>{
  const archive=await exportProjectArchive(project);
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([project]));
  await expect(importProjectArchive(archive)).rejects.toThrow(/already exists/);
});
test('legacy broad archives still reject conflicting shared source indexes',async()=>{
  let db=await openCbaIndexedDB();await writeRecord(db,'code_index','code:file:test/source:a.cpp',{content:'original'});db.close();
  const current=await exportProjectArchive(project);
  const entries=(await current.text()).trim().split('\n').map(line=>decodeValue(JSON.parse(line)));entries.pop();
  entries.push({kind:'record',db:'xhandle',store:'code_index',key:'code:file:test/source:a.cpp',value:{key:'code:file:test/source:a.cpp',value:{content:'original'}}});
  const lines=await Promise.all(entries.map(async entry=>JSON.stringify(await encodeValue(entry))+'\n'));
  const hash=sha256();lines.forEach(line=>hash.update(line));
  lines.push(JSON.stringify(await encodeValue({kind:'end',count:entries.length,digest:hash.digest('hex')}))+'\n');
  const archive=new Blob(lines);fresh();
  db=await openCbaIndexedDB();await writeRecord(db,'code_index','code:file:test/source:a.cpp',{content:'different'});db.close();
  await expect(importProjectArchive(archive)).rejects.toThrow(/different data/);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});
test('cancellation during writes rolls back and does not publish project',async()=>{
  const db=await openCbaIndexedDB();await writeRecord(db,'copilot_baseline',scope,[{from:'saved'}]);db.close();
  const archive=await exportProjectArchive(project);fresh();
  const controller=new AbortController();
  await expect(importProjectArchive(archive,{signal:controller.signal,onProgress:message=>{if(message.startsWith('Importing'))controller.abort();}})).rejects.toThrow(/cancelled/);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});
test('structured values and reserved property names survive without pollution',async()=>{
  const value={a:new Map([['key',new Set([1,2])]]),b:new Uint16Array([1,400]),c:new Date('2026-01-01'),d:undefined,e:new Blob(['text'])};
  const copy=decodeValue(await encodeValue(value));
  expect(copy.a).toEqual(value.a);expect(copy.b).toEqual(value.b);expect(copy.c).toEqual(value.c);expect(copy.d).toBeUndefined();expect(await copy.e.text()).toBe('text');
  expect(Object.getPrototypeOf(decodeValue(await encodeValue(JSON.parse('{"__proto__":{"polluted":true}}'))))).toBe(Object.prototype);
  expect({}.polluted).toBeUndefined();
});
test('requirement batches reuse successes but retry failures and changed inputs',async()=>{
  const checkpoint=createRequirementCheckpoint('p1','r1','system-requirements');
  await expect(checkpoint('first',async()=>{throw new Error('offline');},Boolean)).rejects.toThrow('offline');
  const generate=jest.fn(async()=>'success');
  expect(await checkpoint('first',generate,Boolean)).toBe('success');
  expect(await checkpoint('first',generate,Boolean)).toBe('success');expect(generate).toHaveBeenCalledTimes(1);
  await checkpoint('changed',generate,Boolean);expect(generate).toHaveBeenCalledTimes(2);
});

test('a failed local settings write rolls back database inserts and leaves other projects intact',async()=>{
  const db=await openCbaIndexedDB();await writeRecord(db,'copilot_baseline',scope,[{from:'saved'}]);db.close();
  localStorage.setItem('cbaMeta:p1:r1','metadata');
  const archive=await exportProjectArchive(project);fresh();
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'other'}]));
  const original=Storage.prototype.setItem;
  const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key==='cbaMeta:p1:r1')throw new DOMException('Storage full','QuotaExceededError');return original.call(this,key,value);});
  await expect(importProjectArchive(archive)).rejects.toThrow('Storage full');spy.mockRestore();
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([]);
  expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))).toEqual([{id:'other'}]);
});

test('unchecking continue bypasses cached requirements without deleting saved checkpoints',async()=>{
  await createRequirementCheckpoint('p1','r1','design')('prompt',async()=>'old',Boolean);
  const generate=jest.fn(async()=>'new');
  expect(await createRequirementCheckpoint('p1','r1','design',{reuse:false})('prompt',generate,Boolean)).toBe('new');
  expect(generate).toHaveBeenCalledTimes(1);
});

test('actual software derivation reuses imported model responses without another provider call',async()=>{
  const cbaRows=[{traceId:'FD-1',from:'commandHandler',action:'Validate commands',to:'actuator',fromFile:'control.cpp'}];
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({answer:JSON.stringify({requirements:[{id:'SWR-001',requirementText:'The software shall validate incoming commands before execution.',sourceTraceId:'FD-1'}]})})}));
  const onProgress=jest.fn();onProgress.requestCheckpoint=createRequirementCheckpoint('p1','r1','software-requirements');
  const first=await deriveSoftwareRequirements({cbaRows,onProgress});
  expect(global.fetch).toHaveBeenCalled();
  const archive=await exportProjectArchive(project);fresh();await importProjectArchive(archive);
  global.fetch=jest.fn(async()=>{throw new Error('Provider must not be called for completed batch');});
  const continued=jest.fn();continued.requestCheckpoint=createRequirementCheckpoint('p1','r1','software-requirements');
  const second=await deriveSoftwareRequirements({cbaRows,onProgress:continued});
  expect(global.fetch).not.toHaveBeenCalled();
  expect(second.map(row=>row.requirementText)).toEqual(first.map(row=>row.requirementText));
});

test('large partial hazard records export and import under a bounded stringify budget',async()=>{
  const run={id:'large-run',projectId:'p1',repoId:'r1',status:'partial',summary:[{id:'h1',evidence:'evidence\\"\n'.repeat(160000)}],updatedAt:'2026-10-24T00:00:00Z'};
  await saveCodeArchitectureHazardRun(run);
  const stringify=JSON.stringify;
  const spy=jest.spyOn(JSON,'stringify').mockImplementation((...args)=>{
    const result=stringify(...args);
    if(result?.length>131072)throw new RangeError('Invalid string length');
    return result;
  });
  try {
    expect(()=>JSON.stringify(run)).toThrow('Invalid string length');
    const archive=await exportProjectArchive(project);
    expect(await archive.text()).toContain('stream-start');
    fresh();await importProjectArchive(archive);
    const restored=await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'});
    expect(restored.status).toBe('partial');expect(restored.summary).toEqual(run.summary);
    // The conflict checks must also compare large values without a whole-record string.
    localStorage.removeItem('xhandle.codeArchitectureProjects');
    await importProjectArchive(archive);
    localStorage.removeItem('xhandle.codeArchitectureProjects');
    await saveCodeArchitectureHazardRun({...run,summary:[{id:'changed'}]});
    await expect(importProjectArchive(archive)).rejects.toThrow(/different data/);
  } finally {spy.mockRestore();}
},30000);

test('large export cancellation preserves source and truncated framed import never publishes',async()=>{
  await saveCodeArchitectureHazardRun({id:'large-run',projectId:'p1',repoId:'r1',status:'partial',summary:[{evidence:'x'.repeat(300000)}]});
  const controller=new AbortController();
  await expect(exportProjectArchive(project,{signal:controller.signal,onProgress:message=>{if(message.includes('MB raw data'))controller.abort();}})).rejects.toThrow(/cancelled/);
  expect((await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).status).toBe('partial');
  const archive=await exportProjectArchive(project);
  fresh();await expect(importProjectArchive(archive.slice(0,Math.floor(archive.size/2)))).rejects.toThrow();
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});

 test('legacy version 1 exports remain importable',async()=>{
  const archive=await exportProjectArchive(project);
  const entries=(await archive.text()).trim().split('\n').map(line=>decodeValue(JSON.parse(line)));
  entries[0].version=1;entries.pop();
  const lines=await Promise.all(entries.map(async entry=>JSON.stringify(await encodeValue(entry))+'\n'));
  const hash=sha256();lines.forEach(line=>hash.update(line));
  lines.push(JSON.stringify(await encodeValue({kind:'end',count:entries.length,digest:hash.digest('hex')}))+'\n');
  fresh();await importProjectArchive(new Blob(lines));
  expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].id).toBe('p1');
 });
