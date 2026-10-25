import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {webcrypto} from 'crypto';
import {openDB} from 'idb';
import {stageHazardRun,hydrateHazardRun,HAZARD_CHUNKS,isChunkedHazardRun} from './hazardRunChunks';
import {saveCodeArchitectureHazardRun,deleteCodeArchitectureHazardRuns,openCodeArchitectureHazardDB,getCodeArchitectureHazardRunById} from './codeArchitectureHazardStore';
beforeAll(()=>{global.structuredClone=v=>deserialize(serialize(v));global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(()=>{global.indexedDB=new IDBFactory();localStorage.clear();});
const large=id=>({id,projectId:'p',repoId:'r',status:'partial',summary:[{evidence:'x'.repeat(200000)}]});
test('large saves publish a descriptor, hydrate exactly and delete all revisions by run ID',async()=>{
 await saveCodeArchitectureHazardRun(large('one'));await saveCodeArchitectureHazardRun({...large('one'),revision:2});await saveCodeArchitectureHazardRun(large('two'));
 const db=await openCodeArchitectureHazardDB(),stored=await db.get('hazardAnalysisRuns','one');expect(isChunkedHazardRun(stored)).toBe(true);expect(JSON.stringify(stored).length).toBeLessThan(1000);
 expect((await getCodeArchitectureHazardRunById('one')).summary).toEqual(large('one').summary);
 expect(await deleteCodeArchitectureHazardRuns({id:'one'})).toBe(1);
 expect((await db.getAllFromIndex(HAZARD_CHUNKS,'runId','one')).length).toBe(0);expect((await getCodeArchitectureHazardRunById('two')).summary).toEqual(large('two').summary);db.close();
});
test('staging cancellation removes incomplete chunks without publishing a run',async()=>{
 const db=await openCodeArchitectureHazardDB();let count=0;
 await expect(stageHazardRun(db,large('one'),()=>{if(++count===4)throw Error('cancelled');})).rejects.toThrow('cancelled');
 expect(await db.count(HAZARD_CHUNKS)).toBe(0);expect(await db.count('hazardAnalysisRuns')).toBe(0);db.close();
});
test('damaged saved chunks fail clearly rather than returning truncated partial results',async()=>{
 const db=await openCodeArchitectureHazardDB(),root=await stageHazardRun(db,large('one'));
 await db.put('hazardAnalysisRuns',root);
 const parts=await db.getAll(HAZARD_CHUNKS);await db.delete(HAZARD_CHUNKS,parts[0].id);
 await expect(hydrateHazardRun(db,root)).rejects.toThrow(/missing or damaged/);db.close();
});
test('version-three legacy runs stay readable after schema upgrade',async()=>{
 const old=await openDB('xhandle-code-architecture-hazard-analysis',3,{upgrade(db){const runs=db.createObjectStore('hazardAnalysisRuns',{keyPath:'id'});runs.createIndex('projectId','projectId');}});await old.put('hazardAnalysisRuns',large('old'));old.close();
 expect((await getCodeArchitectureHazardRunById('old')).summary).toEqual(large('old').summary);
});

test('reader snapshot finishes before replacement reclaims its generation',async()=>{
 const {publishHazardRun}=require('./hazardRunChunks');
 const {hazardMetadata}=require('./hazardSchema');
 await saveCodeArchitectureHazardRun({...large('shared'),revision:'old'});
 const db=await openCodeArchitectureHazardDB(),old=await db.get('hazardAnalysisRuns','shared');
 const next=await stageHazardRun(db,{...large('shared'),revision:'new'});let writing;
 const reader={transaction:(...args)=>{
  const tx=db.transaction(...args);
  return {done:tx.done,abort:()=>tx.abort(),objectStore:name=>{
   const store=tx.objectStore(name);
   return {get:async key=>{const value=await store.get(key);if(name===HAZARD_CHUNKS && !writing)writing=publishHazardRun(db,next,hazardMetadata(next));return value;}};
  }};
 }};
 expect((await hydrateHazardRun(reader,old)).revision).toBe('old');await writing;
 expect((await getCodeArchitectureHazardRunById('shared')).revision).toBe('new');
 expect((await db.getAll(HAZARD_CHUNKS)).every(p=>p.generation===next.payload.generation)).toBe(true);db.close();
});
test('staging leases protect active writers and abandoned generations are reclaimed',async()=>{
 const {publishHazardRun}=require('./hazardRunChunks');const {HAZARD_STAGING,hazardMetadata}=require('./hazardSchema');
 const db=await openCodeArchitectureHazardDB(),first=await stageHazardRun(db,large('shared')),second=await stageHazardRun(db,large('shared'));
 expect(await db.count(HAZARD_CHUNKS)).toBe(first.payload.count+second.payload.count);
 const lease=await db.get(HAZARD_STAGING,first.payload.generation);await db.put(HAZARD_STAGING,{...lease,touched:0});
 const third=await stageHazardRun(db,large('shared'));
 expect(await db.count(HAZARD_CHUNKS)).toBe(second.payload.count+third.payload.count);
 await expect(publishHazardRun(db,first,hazardMetadata(first))).rejects.toThrow(/staging expired/);
 await publishHazardRun(db,second,hazardMetadata(second));await publishHazardRun(db,third,hazardMetadata(third));
 expect(await db.count(HAZARD_CHUNKS)).toBe(third.payload.count);expect(await db.count(HAZARD_STAGING)).toBe(0);db.close();
});
test('failed publication preserves the prior generation, and a small replacement reclaims it',async()=>{
 const {publishHazardRun,removeHazardGeneration}=require('./hazardRunChunks');const {hazardMetadata}=require('./hazardSchema');
 await saveCodeArchitectureHazardRun(large('same'));const db=await openCodeArchitectureHazardDB(),old=await db.get('hazardAnalysisRuns','same');
 const next=await stageHazardRun(db,{...large('same'),revision:2});
 await expect(publishHazardRun(db,next,hazardMetadata(next),()=>{throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});})).rejects.toThrow('quota');
 expect(await db.get('hazardAnalysisRuns','same')).toEqual(old);expect((await hydrateHazardRun(db,old)).summary).toEqual(large('same').summary);
 await removeHazardGeneration(db,next.payload.generation);await saveCodeArchitectureHazardRun({id:'same',projectId:'p',repoId:'r',summary:[]});
 expect(await db.count(HAZARD_CHUNKS)).toBe(0);db.close();
});
test('clear revokes an unpublished staged generation',async()=>{
 const {publishHazardRun}=require('./hazardRunChunks');const {hazardMetadata,HAZARD_STAGING}=require('./hazardSchema');
 const db=await openCodeArchitectureHazardDB(),staged=await stageHazardRun(db,large('not-published'));
 await deleteCodeArchitectureHazardRuns({projectId:'p'});
 expect(await db.count(HAZARD_CHUNKS)).toBe(0);expect(await db.count(HAZARD_STAGING)).toBe(0);
 await expect(publishHazardRun(db,staged,hazardMetadata(staged))).rejects.toThrow(/staging expired/);db.close();
});

test('fallback publication cannot overwrite a newer save committed during staging',async()=>{
 const {publishHazardRun}=require('./hazardRunChunks');const {hazardMetadata,HAZARD_STAGING}=require('./hazardSchema');
 const db=await openCodeArchitectureHazardDB();
 const fallback=await stageHazardRun(db,{...large('race'),updatedAt:'2026-10-24T00:00:00Z'});
 const newer={...large('race'),updatedAt:'2026-10-25T00:00:00Z',revision:'new'};
 const staged=await stageHazardRun(db,newer);await publishHazardRun(db,staged,hazardMetadata(staged));
 await publishHazardRun(db,fallback,hazardMetadata(fallback),()=>{},undefined);
 expect(await hydrateHazardRun(db,staged)).toEqual(newer);
 expect(await db.count(HAZARD_CHUNKS)).toBe(staged.payload.count);
 expect(await db.count(HAZARD_STAGING)).toBe(0);db.close();
});
