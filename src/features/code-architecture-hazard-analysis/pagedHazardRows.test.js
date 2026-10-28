import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {serialize,deserialize} from 'v8';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,openCodeArchitectureHazardDB,resolveCodeArchitectureHazardRun,deletePagedHazardRow} from './codeArchitectureHazardStore';
import {queryHazardRows} from './pagedHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
const fixture=()=>({id:'paged',projectId:'page',repoId:'r',runState:'complete',architectureRowsSnapshot:['evidence '.repeat(20000)],generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard','Operational Context ID'],...Array.from({length:1000},(_,i)=>['HA-'+i,`row ${i} `+'value '.repeat(100),i%2?'a':'b'])]},pendingAttempt:{runState:'incomplete',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['partial','saved partial']]}}});
const read=()=>getLatestCodeArchitectureHazardRun({projectId:'page'},{workingSet:true,paged:true});
test('cold descriptor and first page read bounded data without assembling all rows',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const get=jest.spyOn(IDBObjectStore.prototype,'get');
 try{
  const descriptor=await read();expect(descriptor[PAGED_HAZARD].total).toBe(1000);expect(descriptor.generatedSheets).toBeUndefined();expect(get.mock.instances.filter(s=>s.name==='hazardRunChunks')).toHaveLength(0);
  const page=await queryHazardRows(descriptor);expect(page.rows).toHaveLength(100);expect(page.rowIndices[99]).toBe(99);expect(page.rows[0][0]).toBe('HA-0');
  expect(get.mock.instances.filter(s=>s.name==='hazardRunChunks').length).toBeLessThan(20);
  expect((await queryHazardRows(descriptor,{offset:900})).rows[99][0]).toBe('HA-999');
 }finally{get.mockRestore();}
});
test('filter, option search, partial inspection and continuation use the complete saved source',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const match=await queryHazardRows(descriptor,{operation:'query',search:'row 999',context:'a'});expect(match.indices).toEqual([999]);
 expect((await queryHazardRows(descriptor,{indices:match.indices})).rows[0][0]).toBe('HA-999');
 expect((await queryHazardRows(descriptor,{operation:'options',column:0,optionSearch:'HA-999'})).options).toEqual(['HA-999']);
 expect((await queryHazardRows(descriptor,{partial:true})).rows[0][0]).toBe('partial');
 expect(await resolveCodeArchitectureHazardRun(descriptor)).toMatchObject(run);
});
test('streamed row deletion preserves evidence, pending results, and absolute row identity',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const descriptor=await read();await deletePagedHazardRow(descriptor,901);
 const full=await getCodeArchitectureHazardRunById(run.id);
 expect(full.generatedSheets.Summary).toEqual(run.generatedSheets.Summary.filter((_,i)=>i!==902));
 expect(full.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);expect(full.pendingAttempt).toEqual(run.pendingAttempt);
 await expect(queryHazardRows(descriptor)).rejects.toThrow('changed');
 const next=await read();expect(next[PAGED_HAZARD].total).toBe(999);
});
test('explicit legacy upgrade builds row coordinates without changing original data',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const db=await openCodeArchitectureHazardDB(),root=await db.get('hazardAnalysisRuns',run.id);delete root.payload.rowIndex;await db.put('hazardAnalysisRuns',root);
 await expect(read()).rejects.toHaveProperty('code','HAZARD_TABLE_UPGRADE_REQUIRED');await prepareHazardTableIndex(db,run.id);db.close();
 expect((await queryHazardRows(await read())).rows[0][0]).toBe('HA-0');expect(await getCodeArchitectureHazardRunById(run.id)).toMatchObject(run);
});
