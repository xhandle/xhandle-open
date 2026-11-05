import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {serialize, deserialize} from 'v8';
import {webcrypto} from 'crypto';
import {saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {openHazardSchema, HAZARD_CHUNKS} from './hazardSchema';
import {hazardChunkKey} from './hazardRunChunks';
import * as rowIndex from './hazardRowIndex';
import {iterateRawHazardSummary} from './iterateRawHazardSummary';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(global, 'crypto', {value:webcrypto, configurable:true});
  localStorage.clear();
});
afterEach(() => jest.restoreAllMocks());
async function fixture() {
  const run = {id:'bulk',projectId:'p',repoId:'r',runState:'complete',
    architectureRowsSnapshot:'PRIVATE_EVIDENCE '.repeat(15000),
    generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],...Array.from({length:1000},(_,i)=>['H-'+i,'Unsafe condition '+i+' evidence '.repeat(20)])]}};
  await saveCodeArchitectureHazardRun(run);
  const db=await openHazardSchema();
  try {return {run,root:await db.get('hazardAnalysisRuns',run.id)};} finally {db.close();}
}
test('bulk traversal validates the row index once and preserves every raw row and order',async()=>{
  const {run,root}=await fixture();
  const validate=jest.spyOn(rowIndex,'validateHazardRowIndex');
  const rows=[];for await(const item of iterateRawHazardSummary(root))rows.push(item);
  expect(rows).toHaveLength(1000);expect(rows.map(item=>item.row)).toEqual(run.generatedSheets.Summary.slice(1));
  expect(rows[999].index).toBe(999);expect(rows[0].headers).toEqual(run.generatedSheets.Summary[0]);
  expect(validate).toHaveBeenCalledTimes(1);expect(JSON.stringify(rows)).not.toContain('PRIVATE_EVIDENCE');
});
test('damaged chunks and damaged row coordinates are rejected rather than indexed',async()=>{
  const {root}=await fixture();const db=await openHazardSchema();
  const sequence=root.payload.rowIndex.spans[0][0],key=hazardChunkKey(root.payload.generation,sequence);
  const chunk=await db.get(HAZARD_CHUNKS,key);chunk.tokens.push(['text','corrupted']);await db.put(HAZARD_CHUNKS,chunk);db.close();
  await expect(iterateRawHazardSummary(root).next()).rejects.toThrow(/damaged/);
  const broken=structuredClone(root);broken.payload.rowIndex.spans[0][0]=999999;
  const editing=await openHazardSchema();await editing.put('hazardAnalysisRuns',broken);editing.close();
  await expect(iterateRawHazardSummary(broken).next()).rejects.toThrow(/damaged|coordinates/);
});
test('a concurrent committed edit invalidates traversal before reporting complete coverage',async()=>{
  const {root}=await fixture(),iterator=iterateRawHazardSummary(root);
  expect((await iterator.next()).value.index).toBe(0);
  const db=await openHazardSchema(),metadata=await db.get('runMetadata',root.id);
  await db.put('runMetadata',{...metadata,storageRevision:'another-committed-revision'});db.close();
  await expect((async()=>{for await(const _row of iterator){/* Consume until next revision check. */}})()).rejects.toThrow(/changed/);
});
test('legacy indexed roots without a metadata record retain readable rows',async()=>{
  const {root}=await fixture(),db=await openHazardSchema();
  await db.delete('runMetadata',root.id);db.close();
  let count=0;for await(const item of iterateRawHazardSummary(root)){expect(item.row[0]).toBe('H-'+count++);}
  expect(count).toBe(1000);
});
test('cancellation and a changed generation stop the bulk read',async()=>{
  const {root}=await fixture(),controller=new AbortController(),iterator=iterateRawHazardSummary(root,{signal:controller.signal});
  await iterator.next();controller.abort();await expect(iterator.next()).rejects.toHaveProperty('name','AbortError');
  const old={...root,payload:{...root.payload,generation:'0'.repeat(32)}};
  await expect(iterateRawHazardSummary(old).next()).rejects.toThrow(/changed/);
});
