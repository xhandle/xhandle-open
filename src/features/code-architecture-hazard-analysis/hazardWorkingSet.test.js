import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {webcrypto} from 'crypto';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
import {streamValue} from '../code-architecture-transfer/archiveValueStream';
import {WORKING_SET,compactHazardRun,workingSetAssembler,restoreDeferredHazardFields} from './hazardWorkingSet';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,resolveCodeArchitectureHazardRun,openCodeArchitectureHazardDB,deleteCodeArchitectureHazardRuns} from './codeArchitectureHazardStore';
import {stageHazardRun,publishHazardRun} from './hazardRunChunks';
import {hazardMetadata} from './hazardSchema';
import {normalizeCodeArchitectureHazardRun} from './codeArchitectureHazardUtils';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
const fixture=()=>({id:'working',projectId:'p',repoId:'r',runState:'incomplete',validatedAssessments:2,totalAssessments:3,
 architectureRowsSnapshot:[{source:'source '.repeat(16000)}],narrativeReviewInput:{evidence:['evidence '.repeat(10000)]},
 generatedSheets:{Summary:[['ID','Hazard'],['HA-1','one'],['HA-2','two']],Other:[['value'],['unchanged']]},
 traceabilityMap:[{id:'trace-1'}],retainedUserInputs:{a:'user-owned'},
 pendingAttempt:{id:'partial',runState:'incomplete',generatedSheets:{Summary:[['ID'],['HA-3']]},architectureRowsSnapshot:['partial source'],narrativeReviewInput:null},
 arbitrary:{architectureRowsSnapshot:['NOT a deferred field']}});
const read=()=>getLatestCodeArchitectureHazardRun({projectId:'p',repoId:'r'},{workingSet:true});
test('streaming working set drops only execution fields and preserves every table and partial result',async()=>{
 const run=fixture(),paths=[],assembler=workingSetAssembler(paths);
 for await(const token of streamValue(run))assembler.add(token);
 const compact=assembler.finish(),expectedPaths=[];
 expect(compact).toEqual(compactHazardRun(run,expectedPaths));expect(paths).toEqual(expectedPaths);
 expect(restoreDeferredHazardFields({...compact,[WORKING_SET]:{paths}},run)).toEqual(run);
});
test('cold indexed reads skip evidence pages; full API still returns full data',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);
 const spy=jest.spyOn(IDBObjectStore.prototype,'getAll'),get=jest.spyOn(IDBObjectStore.prototype,'get');
 let working;
 try{
  working=await read();expect(working.architectureRowsSnapshot).toBeUndefined();expect(working.generatedSheets).toEqual(run.generatedSheets);
  expect(spy.mock.instances.some(store=>store.name==='hazardRunChunks')).toBe(false);
  expect(get.mock.instances.some(store=>store.name==='hazardAnalysisRuns')).toBe(true);
  expect(get.mock.instances.filter(store=>store.name==='hazardRunChunks').length).toBeLessThan(8);
 }finally{spy.mockRestore();get.mockRestore();}
 expect(await resolveCodeArchitectureHazardRun(working)).toMatchObject(run);
 expect(await getLatestCodeArchitectureHazardRun({projectId:'p'},{reuseRun:working})).toMatchObject(run);
});
test('legacy chunked run requires explicit upgrade, then cold reads skip evidence',async()=>{
 const db=await openCodeArchitectureHazardDB(),run=fixture();
 await publishHazardRun(db,await stageHazardRun(db,run),hazardMetadata(run));
 const root=await db.get('hazardAnalysisRuns',run.id);delete root.payload.tableIndex;await db.put('hazardAnalysisRuns',root);
 await expect(read()).rejects.toHaveProperty('code','HAZARD_TABLE_UPGRADE_REQUIRED');
 await prepareHazardTableIndex(db,run.id);db.close();
 const first=await read();expect(first.architectureRowsSnapshot).toBeUndefined();
 const spy=jest.spyOn(IDBObjectStore.prototype,'getAll');
 try{expect((await read()).generatedSheets).toEqual(first.generatedSheets);expect(spy.mock.instances.some(s=>s.name==='hazardRunChunks')).toBe(false);}finally{spy.mockRestore();}
});
test('edit and normalization preserve deferred fields and later edits use the new revision',async()=>{
 const run=fixture();await saveCodeArchitectureHazardRun(run);const working=await read();
 const normalized=normalizeCodeArchitectureHazardRun(working);
 expect(normalized.architectureRowsSnapshot).toBeUndefined();expect(normalized[WORKING_SET]).toBeTruthy();
 const edited={...working,generatedSheets:{...working.generatedSheets,Summary:[['ID','Hazard'],['HA-1','edited']]}};
 await saveCodeArchitectureHazardRun(edited);
 let complete=await getCodeArchitectureHazardRunById(run.id);
 expect(complete.architectureRowsSnapshot).toEqual(run.architectureRowsSnapshot);expect(complete.narrativeReviewInput).toEqual(run.narrativeReviewInput);
 expect(complete.pendingAttempt).toEqual(run.pendingAttempt);expect(complete.generatedSheets.Summary[1][1]).toBe('edited');expect(complete[WORKING_SET]).toBeUndefined();
 await saveCodeArchitectureHazardRun({...edited,reviewStatus:'reviewed'});
 complete=await getCodeArchitectureHazardRunById(run.id);expect(complete.reviewStatus).toBe('reviewed');
 await expect(resolveCodeArchitectureHazardRun(working)).rejects.toThrow('changed');
});
test('stale and deleted working sets cannot resolve or overwrite a newer run',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const old=await read();
 await saveCodeArchitectureHazardRun({...fixture(),reviewStatus:'new'});
 await expect(resolveCodeArchitectureHazardRun(old)).rejects.toThrow('changed');
 await deleteCodeArchitectureHazardRuns({projectId:'p'});expect(await read()).toBeNull();
 await expect(resolveCodeArchitectureHazardRun(old)).rejects.toThrow('changed');
});
test('damaged derived index requires repair; cancellation never returns stale results',async()=>{
 await saveCodeArchitectureHazardRun(fixture());
 const db=await openCodeArchitectureHazardDB();
 const root=await db.get('hazardAnalysisRuns','working');root.payload.tableIndex.digest='damaged';await db.put('hazardAnalysisRuns',root);
 await expect(read()).rejects.toHaveProperty('code','HAZARD_TABLE_UPGRADE_REQUIRED');
 await prepareHazardTableIndex(db,'working');db.close();
 expect((await read()).generatedSheets).toEqual(fixture().generatedSheets);
 const controller=new AbortController();controller.abort();
 await expect(getLatestCodeArchitectureHazardRun({projectId:'p'},{workingSet:true,signal:controller.signal})).rejects.toHaveProperty('name','AbortError');
});
test('cache quota failure does not prevent authoritative save or table loading',async()=>{
 const put=IDBObjectStore.prototype.put;
 const spy=jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(value,...args){if(this.name==='roots')throw new DOMException('Full','QuotaExceededError');return put.call(this,value,...args);});
 try{await saveCodeArchitectureHazardRun(fixture());expect((await read()).generatedSheets).toEqual(fixture().generatedSheets);expect(await getCodeArchitectureHazardRunById('working')).toMatchObject(fixture());}finally{spy.mockRestore();}
});
test('rapid local edits queued from one working set retain the newest edits and all source data',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const working=await read();
 const first={...working,reviewStatus:'first'},second={...working,reviewStatus:'second'},third={...working,reviewStatus:'third'};
 await Promise.all([saveCodeArchitectureHazardRun(first),saveCodeArchitectureHazardRun(second),saveCodeArchitectureHazardRun(third)]);
 const full=await getCodeArchitectureHazardRunById('working');expect(full.reviewStatus).toBe('third');expect(full.architectureRowsSnapshot).toEqual(fixture().architectureRowsSnapshot);
});
test('publication rejects a source revision replaced after edit hydration',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const working=await read();
 const full=await resolveCodeArchitectureHazardRun(working);
 const db=await openCodeArchitectureHazardDB();
 await saveCodeArchitectureHazardRun({...fixture(),reviewStatus:'newer'});
 const staged=await stageHazardRun(db,{...full,reviewStatus:'stale'});
 await expect(publishHazardRun(db,staged,hazardMetadata(full),()=>{},undefined,working[WORKING_SET].revision)).rejects.toThrow('changed');
 expect((await getCodeArchitectureHazardRunById('working')).reviewStatus).toBe('newer');db.close();
});
test('cancelled legacy upgrade leaves original descriptor and full data intact; retry succeeds',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const db=await openCodeArchitectureHazardDB();
 const root=await db.get('hazardAnalysisRuns','working');delete root.payload.tableIndex;await db.put('hazardAnalysisRuns',root);
 const controller=new AbortController();
 await expect(prepareHazardTableIndex(db,'working',{signal:controller.signal,onProgress:()=>controller.abort()})).rejects.toBeTruthy();
 expect(await db.get('hazardAnalysisRuns','working')).toEqual(root);
 expect(await getCodeArchitectureHazardRunById('working')).toMatchObject(fixture());
 await prepareHazardTableIndex(db,'working');expect((await read()).generatedSheets).toEqual(fixture().generatedSheets);db.close();
});
test('corrupt selected source page fails closed while original source remains stored',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const db=await openCodeArchitectureHazardDB();
 const root=await db.get('hazardAnalysisRuns','working');
 const pages=await db.getAll('hazardRunChunks');const seq=root.payload.tableIndex.pages[0].sequence;
 const page=pages.find(p=>p.sequence===seq);page.tokens[0]=['null'];await db.put('hazardRunChunks',page);
 await expect(read()).rejects.toThrow('damaged');expect(await db.get('hazardAnalysisRuns','working')).toEqual(root);db.close();
});
