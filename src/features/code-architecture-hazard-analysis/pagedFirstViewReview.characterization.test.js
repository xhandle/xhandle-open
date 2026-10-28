import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {sha256} from 'hash.js';
import {serialize,deserialize} from 'v8';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,openCodeArchitectureHazardDB,resolveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {PAGED_HAZARD} from './hazardRowIndex';
import {queryHazardRows} from './pagedHazardRows';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
const fixture=()=>({id:'paged',projectId:'page',repoId:'r',runState:'complete',architectureRowsSnapshot:['evidence '.repeat(20000)],generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard','Operational Context ID'],...Array.from({length:1000},(_,i)=>['HA-'+i,`row ${i} `+'value '.repeat(100),i%2?'a':'b'])]},pendingAttempt:{runState:'incomplete',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['partial','saved partial']]}}});
const read=()=>getLatestCodeArchitectureHazardRun({projectId:'page'},{workingSet:true,paged:true});
// Regression coverage for the paged first-view review findings.
test('saved CSV undo and narrative review are read separately from the first page',async()=>{
 const run={...fixture(),csvImportPreviousSummary:[['Hazard'],['original']],narrativeReview:{completedAt:'2026-10-28',findings:{'HA-1':['review finding']}}};
 await saveCodeArchitectureHazardRun(run);
 const descriptor=await read();
 expect(descriptor.csvImportPreviousSummary).toBeUndefined();
 expect(descriptor.narrativeReview).toBeUndefined();
 expect(descriptor[PAGED_HAZARD].details).toEqual(expect.arrayContaining(['csvImportPreviousSummary','narrativeReview']));
 expect((await queryHazardRows(descriptor,{operation:'detail',field:'csvImportPreviousSummary'})).value).toEqual(run.csvImportPreviousSummary);
 expect((await queryHazardRows(descriptor,{operation:'detail',field:'narrativeReview'})).value).toEqual(run.narrativeReview);
 const full=await resolveCodeArchitectureHazardRun(descriptor);
 expect(full.csvImportPreviousSummary).toEqual(run.csvImportPreviousSummary);
 expect(full.narrativeReview).toEqual(run.narrativeReview);
});
test('descriptor writes are rejected and explicit resolved edits persist',async()=>{
 await saveCodeArchitectureHazardRun(fixture());
 const descriptor=await read();
 await expect(saveCodeArchitectureHazardRun({...descriptor,reviewStatus:'reviewed'})).rejects.toThrow('cannot be saved');
 await saveCodeArchitectureHazardRun({...await resolveCodeArchitectureHazardRun(descriptor),reviewStatus:'reviewed'});
 const full=await getCodeArchitectureHazardRunById(descriptor.id);
 expect(full.reviewStatus).toBe('reviewed');
});
test('large incomplete run without a Summary opens and retains partial rows after upgrade',async()=>{
 const run=fixture();delete run.generatedSheets;run.runState='incomplete';
 await saveCodeArchitectureHazardRun(run);
 expect((await read())[PAGED_HAZARD].total).toBe(0);
 const db=await openCodeArchitectureHazardDB();
 try{await prepareHazardTableIndex(db,run.id);}finally{db.close();}
 expect((await queryHazardRows(await read(),{partial:true})).rows[0][0]).toBe('partial');
 expect((await getCodeArchitectureHazardRunById(run.id)).pendingAttempt).toEqual(run.pendingAttempt);
});

test('long filter values stay searchable without being copied into option lists',async()=>{
 const run=fixture();run.generatedSheets.Summary[1][1]='long value '+ 'x'.repeat(5000);
 await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const options=await queryHazardRows(descriptor,{operation:'options',column:1});
 expect(options.truncated).toBe(true);expect(options.options.every(value=>value.length<=2048)).toBe(true);
 expect(options.options.reduce((bytes,value)=>bytes+value.length*2,0)).toBeLessThanOrEqual(256*1024);
 expect((await queryHazardRows(descriptor,{operation:'query',search:'long value'})).indices).toEqual([0]);
});
test('association query finds off-page links and preserves original row indices',async()=>{
 const run=fixture();run.generatedSheets.Summary[0].push('Architecture Row Ref');run.generatedSheets.Summary[1000].push('42');
 await saveCodeArchitectureHazardRun(run);const descriptor=await read();
 const found=await queryHazardRows(descriptor,{operation:'query',target:{type:'edge',rowRef:42}});
 expect(found.indices).toEqual([999]);expect((await queryHazardRows(descriptor,{indices:found.indices})).rowIndices).toEqual([999]);
});

test('partial row coordinates are validated before loading any saved result cells',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const descriptor=await read();const db=await openCodeArchitectureHazardDB();
 const root=await db.get('hazardAnalysisRuns',descriptor.id);root.payload.rowIndex.partial.spans[0][2]=root.payload.count;
 const {digest,...data}=root.payload.rowIndex;root.payload.rowIndex.digest=sha256().update(JSON.stringify(data)).digest('hex');
 await db.put('hazardAnalysisRuns',root);db.close();
 await expect(queryHazardRows(descriptor,{partial:true})).rejects.toThrow('coordinates');
});
test('cancelled reads do not load source rows',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const descriptor=await read(),controller=new AbortController();controller.abort();
 await expect(queryHazardRows(descriptor,{signal:controller.signal})).rejects.toHaveProperty('name','AbortError');
});
