import {webcrypto} from 'crypto';
import {createHazardRunRegistry} from './hazardRunRegistry';
import {openDB} from 'idb';
import {saveCodeArchitectureHazardRun,getCodeArchitectureHazardRunById} from './codeArchitectureHazardStore';
jest.mock('idb',()=>{
 const openDB=jest.fn();
 const resolved=openDB.mockResolvedValue.bind(openDB);
 openDB.mockResolvedValue=db=>resolved({...db,close:jest.fn()});
 return {openDB};
});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const run=id=>({id,projectId:'p',repoId:'r',generatedSheets:{Summary:[['Function'],['A']]}});
let original;
beforeEach(()=>{Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});original=global.indexedDB;global.indexedDB={};localStorage.clear();jest.useFakeTimers();});
afterEach(()=>{global.indexedDB=original;jest.useRealTimers();jest.clearAllMocks();});
test('slow healthy save stays pending without abort or duplicate write and protects reload',async()=>{
 const gate=deferred(),abort=jest.fn(),put=jest.fn(async()=>{}),states=[];
 const transaction=jest.fn(()=>({objectStore:()=>({get:async()=>undefined,put}),done:gate.promise,abort}));openDB.mockResolvedValue({transaction});
 const saving=saveCodeArchitectureHazardRun(run('slow'),{onSaveState:s=>states.push(s.status)});await flush();
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 jest.advanceTimersByTime(6000);await flush();expect(states).toContain('slow');expect(abort).not.toHaveBeenCalled();expect(transaction).toHaveBeenCalledTimes(1);
 gate.resolve();await saving;expect(states.at(-1)).toBe('saved');
 const after=new Event('beforeunload',{cancelable:true});window.dispatchEvent(after);expect(after.defaultPrevented).toBe(false);
});
test('transient transaction failure automatically retries after retirement',async()=>{
 const error=Object.assign(new Error('temporary abort'),{name:'AbortError'});const first=deferred();let attempts=0;
 const transaction=jest.fn(()=>({objectStore:()=>({get:async()=>undefined,put:async()=>{}}),done:++attempts===1?first.promise:Promise.resolve(),abort:jest.fn()}));openDB.mockResolvedValue({transaction});
 const saving=saveCodeArchitectureHazardRun(run('retry'));await flush();first.reject(error);await flush();
 expect(transaction).toHaveBeenCalledTimes(1);jest.advanceTimersByTime(1000);await saving;expect(transaction).toHaveBeenCalledTimes(2);
});
test('permanent failure preserves actual error without retry and manual retry clears it',async()=>{
 const error=Object.assign(new Error('disk quota exceeded'),{name:'QuotaExceededError'});openDB.mockRejectedValue(error);
 await expect(saveCodeArchitectureHazardRun(run('quota'))).rejects.toBe(error);
 expect(openDB).toHaveBeenCalledTimes(1);expect(await getCodeArchitectureHazardRunById('quota')).toMatchObject({finalSaveStatus:'failed',saveFailureMessage:'disk quota exceeded'});
 openDB.mockResolvedValue({transaction:()=>({objectStore:()=>({get:async()=>undefined,put:async()=>{}}),done:Promise.resolve()})});await saveCodeArchitectureHazardRun(run('quota'));
});
test('older pending save cannot clear newer memory or overtake its write',async()=>{
 const gate=deferred(),writes=[];let count=0;
 openDB.mockResolvedValue({transaction:()=>({objectStore:name=>({get:async()=>undefined,put:async value=>{if(name==='hazardAnalysisRuns')writes.push(value.version);}}),done:++count===1?gate.promise:Promise.resolve()})});
 const a=saveCodeArchitectureHazardRun({...run('versions'),version:1});await flush();
 const b=saveCodeArchitectureHazardRun({...run('versions'),version:2});await flush();
 expect(writes).toEqual([1]);expect(await getCodeArchitectureHazardRunById('versions')).toMatchObject({version:2,finalSavePending:true});
 gate.resolve();await Promise.all([a,b]);expect(writes).toEqual([1,2]);
});
test('transient failures exhaust bounded retries and retain results',async()=>{
 const error=Object.assign(new Error('database unavailable'),{name:'UnknownError'});openDB.mockRejectedValue(error);
 const observed=saveCodeArchitectureHazardRun(run('exhausted')).catch(e=>e);await flush();jest.advanceTimersByTime(1000);await flush();jest.advanceTimersByTime(3000);
 expect(await observed).toBe(error);expect(openDB).toHaveBeenCalledTimes(3);
 expect(await getCodeArchitectureHazardRunById('exhausted')).toMatchObject({finalSavePending:true,finalSaveStatus:'failed'});
 openDB.mockResolvedValue({transaction:()=>({objectStore:()=>({get:async()=>undefined,put:async()=>{}}),done:Promise.resolve()})});await saveCodeArchitectureHazardRun(run('exhausted'));
});

test('every queued save resolves only after its own revision commits',async()=>{
 const opening=deferred(),first=deferred(),second=deferred(),writes=[];let count=0;
 openDB.mockReturnValue(opening.promise);
 const db={close:jest.fn(),transaction:()=>({objectStore:name=>({get:async()=>undefined,put:async value=>{if(name==='hazardAnalysisRuns')writes.push(value.version);}}),done:++count===1?first.promise:second.promise})};
 let aDone=false,bDone=false;
 const a=saveCodeArchitectureHazardRun({...run('truthful'),version:1}).then(()=>{aDone=true;});await flush();
 const b=saveCodeArchitectureHazardRun({...run('truthful'),version:2}).then(()=>{bDone=true;});opening.resolve(db);await flush();
 expect(writes).toEqual([1]);expect(aDone).toBe(false);first.resolve();await a;await flush();
 expect(writes).toEqual([1,2]);expect(bDone).toBe(false);
 expect(await getCodeArchitectureHazardRunById('truthful')).toMatchObject({version:2,finalSavePending:true});
 second.resolve();await b;
});

test.each(['saved','failed'])('stopped run receives terminal %s storage state independently of generation',async outcome=>{
 const registry=createHazardRunRegistry(),record=registry.start('p:r'),writing=deferred();
 const value=run(`stopped-${outcome}`);record.run={...value,finalSavePending:true,finalSaveStatus:'saving'};
 const other=registry.start('other');other.run={...run('different'),finalSavePending:true};
 const listener=event=>registry.reconcileSave(event.detail.run);
 window.addEventListener('xhandle:hazard-save-state',listener);
 openDB.mockResolvedValue({transaction:()=>({objectStore:()=>({get:async()=>undefined,put:async()=>{}}),done:writing.promise,abort:()=>{}})});
 try{
  const result=saveCodeArchitectureHazardRun(value).catch(e=>e);await flush();registry.stop('p:r');registry.finish('p:r',record);
  if(outcome==='saved')writing.resolve();else writing.reject(Object.assign(new Error('quota'),{name:'QuotaExceededError'}));
  await result;
  if(outcome==='saved')expect(registry.get('p:r')).toBeUndefined();
  else expect(registry.get('p:r').run).toMatchObject({finalSaveStatus:'failed',saveFailureMessage:'quota'});
  expect(registry.get('other')).toBe(other);
 }finally{
  window.removeEventListener('xhandle:hazard-save-state',listener);registry.close();
  if(outcome==='failed'){openDB.mockResolvedValue({transaction:()=>({objectStore:()=>({get:async()=>undefined,put:async()=>{}}),done:Promise.resolve()})});await saveCodeArchitectureHazardRun(value);}
 }
});

test.each(['callback','event'])('synchronous %s enqueues newer revision after the current save',async kind=>{
 const first=deferred(),second=deferred(),writes=[];let count=0,newer;
 const value=run(`nested-${kind}`);
 openDB.mockResolvedValue({transaction:()=>({objectStore:name=>({get:async()=>undefined,put:async record=>{if(name==='hazardAnalysisRuns')writes.push(record.version);}}),done:++count===1?first.promise:second.promise})});
 const enqueue=()=>{if(!newer)newer=saveCodeArchitectureHazardRun({...value,version:2});};
 const listener=event=>{if(event.detail.run.id===value.id && event.detail.run.version===1 && event.detail.run.finalSaveStatus==='saving')enqueue();};
 if(kind==='event')window.addEventListener('xhandle:hazard-save-state',listener);
 try{
  const older=saveCodeArchitectureHazardRun({...value,version:1},kind==='callback'?{onSaveState:({status})=>{if(status==='saving')enqueue();}}:{});
  await flush();expect(writes).toEqual([1]);
  expect(await getCodeArchitectureHazardRunById(value.id)).toMatchObject({version:2,finalSavePending:true});
  first.resolve();await older;await flush();expect(writes).toEqual([1,2]);
  expect(await getCodeArchitectureHazardRunById(value.id)).toMatchObject({version:2,finalSavePending:true});
  second.resolve();await newer;
 }finally{window.removeEventListener('xhandle:hazard-save-state',listener);}
});
