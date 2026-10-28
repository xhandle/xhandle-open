import 'fake-indexeddb/auto';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {serialize, deserialize} from 'v8';
import {webcrypto} from 'crypto';
import {getLatestCodeArchitectureHazardRun, saveCodeArchitectureHazardRun, deleteCodeArchitectureHazardRuns, openCodeArchitectureHazardDB} from './codeArchitectureHazardStore';
beforeEach(() => {
 global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=value=>deserialize(serialize(value));
 Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();
});
const run=(id='r')=>({id,projectId:'p',repoId:'repo',updatedAt:'2026-10-28T12:00:00Z',generatedSheets:{Summary:[['ID'],['first']]}});
test('unchanged reentry retains object identity without reading root payload', async()=>{
 await saveCodeArchitectureHazardRun(run());
 const first=await getLatestCodeArchitectureHazardRun({projectId:'p'});
 const spy=jest.spyOn(IDBObjectStore.prototype,'get');
 try {
  for(let i=0;i<100;i++)expect(await getLatestCodeArchitectureHazardRun({projectId:'p'},{reuseRun:first})).toBe(first);
  expect(spy.mock.instances.some(store=>store.name==='hazardAnalysisRuns')).toBe(false);
 }finally{spy.mockRestore();}
});
test('same-timestamp save, deletion, and different scope cannot reuse stale results', async()=>{
 await saveCodeArchitectureHazardRun(run());const first=await getLatestCodeArchitectureHazardRun({projectId:'p'});
 await saveCodeArchitectureHazardRun({...run(),generatedSheets:{Summary:[['ID'],['changed']]}});
 const second=await getLatestCodeArchitectureHazardRun({projectId:'p'},{reuseRun:first});
 expect(second).not.toBe(first);expect(second.generatedSheets.Summary[1][0]).toBe('changed');
 expect(await getLatestCodeArchitectureHazardRun({projectId:'other'},{reuseRun:second})).toBeNull();
 await deleteCodeArchitectureHazardRuns({projectId:'p'});
 expect(await getLatestCodeArchitectureHazardRun({projectId:'p'},{reuseRun:second})).toBeNull();
});
test('legacy metadata is assigned a revision without losing saved content', async()=>{
 const db=await openCodeArchitectureHazardDB();const value=run();
 await db.put('hazardAnalysisRuns',value);await db.put('runMetadata',{id:value.id,projectId:'p',repoId:'repo'});db.close();
 const first=await getLatestCodeArchitectureHazardRun({projectId:'p'});
 expect(first).toEqual(value);expect(await getLatestCodeArchitectureHazardRun({projectId:'p'},{reuseRun:first})).toBe(first);
});
test('legacy results remain readable if storage cannot persist a revision token',async()=>{
 const db=await openCodeArchitectureHazardDB();const value=run();
 await db.put('hazardAnalysisRuns',value);await db.put('runMetadata',{id:value.id,projectId:'p',repoId:'repo'});db.close();
 const original=IDBObjectStore.prototype.put;
 const spy=jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(value,...args){
  if(this.name==='runMetadata' && value.storageRevision)throw new DOMException('Full','QuotaExceededError');
  return original.call(this,value,...args);
 });
 try{
  const first=await getLatestCodeArchitectureHazardRun({projectId:'p'});expect(first).toEqual(value);
  const again=await getLatestCodeArchitectureHazardRun({projectId:'p'},{reuseRun:first});
  expect(again).toEqual(value);expect(again).not.toBe(first);
 }finally{spy.mockRestore();}
});
