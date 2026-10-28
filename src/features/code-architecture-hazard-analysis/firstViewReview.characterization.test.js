import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {webcrypto} from 'crypto';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,openCodeArchitectureHazardDB,resolveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
beforeEach(()=>{
 global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;
 global.structuredClone=v=>deserialize(serialize(v));
 Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();
});
// Characterize gaps rather than assert an unimplemented viewport API exists.
test('a result-heavy cold view reads every source page before returning its first table',async()=>{
 const run={id:'retained-heavy',projectId:'review',repoId:'r',generatedSheets:{Summary:[['ID','Hazard'],...Array.from({length:1000},(_,i)=>['HA-'+i,'hazard '.repeat(200)])]}};
 await saveCodeArchitectureHazardRun(run);
 const db=await openCodeArchitectureHazardDB();const root=await db.get('hazardAnalysisRuns',run.id);db.close();
 expect(root.payload.count).toBeGreaterThan(50);
 expect(root.payload.tableIndex.pages).toHaveLength(root.payload.count);
 const get=jest.spyOn(IDBObjectStore.prototype,'get');
 try{
  const value=await getLatestCodeArchitectureHazardRun({projectId:'review'},{workingSet:true});
  expect(value.generatedSheets.Summary).toEqual(run.generatedSheets.Summary);
  expect(get.mock.instances.filter(store=>store.name==='hazardRunChunks')).toHaveLength(root.payload.count);
 }finally{get.mockRestore();}
});
test('a minor edit to a displayed working set still resolves all original evidence pages',async()=>{
 const run={id:'edit-heavy',projectId:'review-edit',repoId:'r',architectureRowsSnapshot:['evidence '.repeat(100000)],generatedSheets:{Summary:[['ID','Hazard'],['1','original']]}};
 await saveCodeArchitectureHazardRun(run);
 const working=await getLatestCodeArchitectureHazardRun({projectId:'review-edit'},{workingSet:true});
 working.generatedSheets.Summary[1][1]='edited';
 const getAll=jest.spyOn(IDBObjectStore.prototype,'getAll');
 try{
  const full=await resolveCodeArchitectureHazardRun(working);
  expect(full.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);
  expect(full.generatedSheets.Summary[1][1]).toBe('edited');
  expect(getAll.mock.instances.filter(store=>store.name==='hazardRunChunks').length).toBeGreaterThan(1);
 }finally{getAll.mockRestore();}
});
