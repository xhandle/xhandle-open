// Regression coverage for the complete-project transfer review findings.
import { deriveSystemRequirements } from '../code-architecture-assurance/artifactAI';
import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { openDB } from 'idb';
import { sha256 } from 'hash.js';
import { exportProjectArchive, importProjectArchive, encodeValue, decodeValue } from './projectArchive';
import { createRequirementCheckpoint } from './requirementCheckpoint';
import { readCbaRowsFromIndexedDB, prepareArchitecturePublication, recoverArchitecturePublication } from '../code-architecture-assurance/codeArchitectureStorage';

const project={id:'p1',name:'Partial project',repos:[{id:'r1',owner:'test',repo:'source',commitSha:'abc',token:'PRIVATE'}],activeRepoId:'r1'};
const scope='cba:p1:r1';
function fresh() { global.indexedDB=new IDBFactory(); localStorage.clear(); }
beforeAll(()=>{global.structuredClone=value=>deserialize(serialize(value));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);



// Regression tests exercise the production publication and derivation paths.
test('published architecture and run aliases survive transfer', async()=>{
  const checkpointKey=`functional-decomposition-checkpoint:${scope}:abc`;
  await prepareArchitecturePublication(scope,[{from:'Completed'}],{fingerprint:'abc'}, {},checkpointKey,undefined);
  await recoverArchitecturePublication(scope,checkpointKey);
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{from:'Completed'}]);
  const archive=await exportProjectArchive(project);fresh();
  await importProjectArchive(archive);
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{from:'Completed'}]);
});

test('ready-to-publish recovery with missing nested chunks fails export', async()=>{
  const checkpointKey=`functional-decomposition-checkpoint:${scope}:abc`;
  const ready=await prepareArchitecturePublication(scope,[{from:'Completed'}],{fingerprint:'abc'}, {},checkpointKey,undefined);
  const db=await openDB('xhandle');
  await db.delete('copilot_baseline',ready.rowRecord.root);db.close();
  await expect(exportProjectArchive(project)).rejects.toThrow(/missing a data chunk/);
});

test('legacy partial hazard system requirements are retried after transfer', async()=>{
  const softwareRequirements=[1,2].map(n=>({id:`SWR-SAFE-${n}`,source:'hazard-derived',requirementText:`The software shall reject invalid actuator ${n} commands.`,linkedHazards:`H-${n}`}));
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({answer:JSON.stringify({requirements:[{id:'SYS-SAFE-1',requirementText:'The system shall prevent unsafe actuator movement.',parentSwRequirement:'SWR-SAFE-1'}]})})}));
  const checkpoint=createRequirementCheckpoint('p1','r1','system-requirements');
  const progress=jest.fn();progress.requestCheckpoint=(basis,generate)=>checkpoint(basis,generate,()=>true);
  const first=await deriveSystemRequirements({softwareRequirements,onProgress:progress});
  expect(first).toHaveLength(1);
  const archive=await exportProjectArchive(project);fresh();await importProjectArchive(archive);
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({answer:JSON.stringify({requirements:[1,2].map(n=>({id:`SYS-SAFE-${n}`,requirementText:`The system shall inhibit actuator ${n} when its command is invalid.`,parentSwRequirement:`SWR-SAFE-${n}`}))})})}));
  const continued=jest.fn();continued.requestCheckpoint=createRequirementCheckpoint('p1','r1','system-requirements');
  const second=await deriveSystemRequirements({softwareRequirements,onProgress:continued});
  expect(global.fetch).toHaveBeenCalled();
  // Existing deduplication may consolidate outputs; every parent must survive.
  const parents=second.flatMap(row=>row.parentSwRequirement.split(/,\s*/));
  expect(parents).toEqual(expect.arrayContaining(['SWR-SAFE-1','SWR-SAFE-2']));
  global.fetch.mockClear();
  await deriveSystemRequirements({softwareRequirements,onProgress:continued});
  expect(global.fetch).not.toHaveBeenCalled();
});

test('ready publication resumes after transfer and local history stays local on the next export', async()=>{
  const checkpointKey=`functional-decomposition-checkpoint:${scope}:abc`;
  await prepareArchitecturePublication(scope,[{from:'First'}],{fingerprint:'abc'}, {},checkpointKey,undefined);
  const archive=await exportProjectArchive(project);fresh();await importProjectArchive(archive);
  await recoverArchitecturePublication(scope,checkpointKey);
  const next=`functional-decomposition-checkpoint:${scope}:def`;
  await prepareArchitecturePublication(scope,[{from:'Second'}],{fingerprint:'def'}, {},next,[{from:'First'}]);
  await recoverArchitecturePublication(scope,next);
  const db=await openDB('xhandle');
  const keys=await db.getAllKeys('copilot_baseline');db.close();
  const history=keys.find(key=>key.startsWith(`${scope}:history:`));
  expect(history).toBeDefined();
  expect(await readCbaRowsFromIndexedDB(history)).toEqual([{from:'First'}]);
  const second=await exportProjectArchive(project);fresh();await importProjectArchive(second);
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{from:'Second'}]);
  expect(await readCbaRowsFromIndexedDB(history)).toEqual([]);
});

test.each(['rowRecord','runRecord'])('missing nested %s is rejected on import before publishing', async field=>{
  const checkpointKey=`functional-decomposition-checkpoint:${scope}:abc`;
  const ready=await prepareArchitecturePublication(scope,[{from:'Complete'}],{fingerprint:'abc'}, {},checkpointKey,undefined);
  const archive=await exportProjectArchive(project);
  const entries=(await archive.text()).trim().split('\n').map(line=>decodeValue(JSON.parse(line)));
  const kept=entries.slice(0,-1).filter(entry=>entry.key!==ready[field].root);
  const hash=sha256(),parts=[];
  for (const entry of kept) {const line=JSON.stringify(await encodeValue(entry))+'\n';hash.update(line);parts.push(line);}
  parts.push(JSON.stringify(await encodeValue({kind:'end',count:kept.length,digest:hash.digest('hex')}))+'\n');
  fresh();
  await expect(importProjectArchive(new Blob(parts))).rejects.toThrow(/missing a data chunk/);
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});
