// Regression coverage for the complete-project transfer review findings.
import { deriveSystemRequirements } from '../code-architecture-assurance/artifactAI';
import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { exportProjectArchive, importProjectArchive } from './projectArchive';
import { createRequirementCheckpoint } from './requirementCheckpoint';

const project={id:'p1',name:'Partial project',repos:[{id:'r1',owner:'test',repo:'source',commitSha:'abc',token:'PRIVATE'}],activeRepoId:'r1'};
function fresh() { global.indexedDB=new IDBFactory(); localStorage.clear(); }
beforeAll(()=>{global.structuredClone=value=>deserialize(serialize(value));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);




// Complete work remains reusable across transfer with every supported separator.
test.each([['and', ' and '], ['uppercase AND', ' AND '], ['carriage return', '\r'], ['comma', ', '], ['semicolon', '; '], ['line feed', '\n'], ['CRLF', '\r\n']])('complete checkpoints survive transfer with %s separators', async(label, separator)=>{
  const parents=['SWR-1','SWR-2'].join(separator);
  const softwareRequirements=[1,2].map(n=>({id:`SWR-${n}`,requirementText:`The software shall validate command channel ${n}.`}));
  const task=options=>JSON.parse(JSON.parse(options.body).messages[1].content).task;
  const response=async (url,options)=>({ok:true,json:async()=>({answer:JSON.stringify(task(options).includes('categor') && !task(options).startsWith('derive_')
    ? {categories:[{id:'CAT-1',categoryName:'Command validation',requirementIntent:'Validate command channels',parentSwRequirement:parents}]}
    : {requirements:[{id:'SYS-1',requirementText:'The system shall prevent invalid command execution.',parentSwRequirement:parents}]})})});
  global.fetch=jest.fn(response);
  const progress=jest.fn();progress.requestCheckpoint=createRequirementCheckpoint('p1','r1','system-requirements');
  const first=await deriveSystemRequirements({softwareRequirements,onProgress:progress});
  expect(first.some(row=>row.parentSwRequirement.includes('SWR-1') && row.parentSwRequirement.includes('SWR-2'))).toBe(true);
  const archive=await exportProjectArchive(project);fresh();await importProjectArchive(archive);
  global.fetch=jest.fn(response);
  const continued=jest.fn();continued.requestCheckpoint=createRequirementCheckpoint('p1','r1','system-requirements');
  const second=await deriveSystemRequirements({softwareRequirements,onProgress:continued});
  expect(second.map(row=>row.parentSwRequirement)).toEqual(first.map(row=>row.parentSwRequirement));
  expect(global.fetch).not.toHaveBeenCalled();
});
