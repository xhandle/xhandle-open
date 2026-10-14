import 'fake-indexeddb/auto';
import {openDB} from 'idb';
import {webcrypto} from 'crypto';
import {TextEncoder} from 'util';
import {serialize,deserialize} from 'v8';
import {createCodeHazardCheckpoint} from './codeHazardGenerationCheckpoint';
import {openCodeArchitectureHazardDB} from './codeArchitectureHazardStore';
jest.mock('./codeArchitectureHazardStore',()=>({openCodeArchitectureHazardDB:jest.fn()}));

test('bulk checkpoint I/O preserves individual-key compatibility, scope and cancellation',async()=>{
  const priorCrypto=global.crypto, priorEncoder=global.TextEncoder, priorClone=global.structuredClone;
  global.structuredClone=value=>deserialize(serialize(value));
  Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});
  global.TextEncoder=TextEncoder;
  const db=await openDB('checkpoint-bulk-test',1,{upgrade(database){database.createObjectStore('generationCheckpoints',{keyPath:'id'}).createIndex('scope','scope');}});
  openCodeArchitectureHazardDB.mockResolvedValue(db);
  try {
    const scope={projectId:'a',repoId:'r'}, bases=[{row:1},{row:2}];
    const checkpoint=await createCodeHazardCheckpoint(scope);
    await checkpoint.write(bases[0],{applicable:'Yes'});
    expect(await checkpoint.readMany(bases)).toEqual([{applicable:'Yes'},undefined]);
    await checkpoint.writeMany(bases.map((basis,index)=>({basis,value:{index}})));
    expect(await checkpoint.read(bases[1])).toEqual({index:1});
    const reloaded=await createCodeHazardCheckpoint(scope);
    expect(await reloaded.readMany([{row:1},{row:2}])).toEqual([{index:0},{index:1}]);
    const isolated=await createCodeHazardCheckpoint({...scope,projectId:'b'});
    expect(await isolated.readMany(bases)).toEqual([undefined,undefined]);
    const controller=new AbortController();
    const cancelled=await createCodeHazardCheckpoint(scope,{signal:controller.signal});controller.abort();
    await expect(cancelled.writeMany([{basis:bases[0],value:'wrong'}])).rejects.toHaveProperty('name','AbortError');
    expect(await reloaded.read(bases[0])).toEqual({index:0});
  } finally {
    db.close();
    Object.defineProperty(global,'crypto',{value:priorCrypto,configurable:true});global.TextEncoder=priorEncoder;global.structuredClone=priorClone;
  }
});

// Reproduce request rejection plus a separate tx.done rejection, including a
// synchronous second-request failure. Jest fails on unhandled rejections.
describe('checkpoint transaction failures',()=>{
 let priorCrypto,priorEncoder;
 beforeEach(()=>{
  priorCrypto=global.crypto;priorEncoder=global.TextEncoder;
  Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});global.TextEncoder=TextEncoder;
  jest.spyOn(console,'warn').mockImplementation(()=>{});
 });
 afterEach(()=>{
  Object.defineProperty(global,'crypto',{value:priorCrypto,configurable:true});global.TextEncoder=priorEncoder;jest.restoreAllMocks();
 });
 function failingTransaction(error,controller){
  let rejectDone,rejectFirst,count=0;
  const done=new Promise((_resolve,reject)=>{rejectDone=reject;});
  const first=new Promise((_resolve,reject)=>{rejectFirst=reject;});
  const invoke=()=>{
   if(++count===1)return first;
   controller?.abort();
   rejectFirst(new DOMException('Request aborted','AbortError'));
   rejectDone(new DOMException('Transaction aborted','AbortError'));
   throw error;
  };
  return {done,store:{get:invoke,put:invoke},abort:()=>{rejectDone(new DOMException('aborted','AbortError'));}};
 }
 test.each(['readMany','writeMany'])('%s retries a transient transaction failure once and observes all rejections',async operation=>{
  const native=new DOMException('inactive','TransactionInactiveError');
  const good={done:Promise.resolve(),store:{get:async id=>({value:id}),put:jest.fn(async()=>{})}};
  const db={transaction:jest.fn().mockReturnValueOnce(failingTransaction(native)).mockReturnValue(good)};
  openCodeArchitectureHazardDB.mockResolvedValue(db);
  const cache=await createCodeHazardCheckpoint({projectId:'recover'});
  const bases=[{row:1},{row:2}];
  const result=await cache[operation](operation==='readMany'?bases:bases.map(basis=>({basis,value:'saved'})));
  expect(db.transaction).toHaveBeenCalledTimes(2);
  if(operation==='readMany')expect(result).toHaveLength(2);
  else expect(good.store.put).toHaveBeenCalledTimes(2);
 });
 test('persistent aborts stop after one retry and preserve the original cause',async()=>{
  const native=Object.freeze(new DOMException('inactive','TransactionInactiveError'));
  const db={transaction:jest.fn(()=>failingTransaction(native))};openCodeArchitectureHazardDB.mockResolvedValue(db);
  const cache=await createCodeHazardCheckpoint({projectId:'bounded'});
  await expect(cache.writeMany([{basis:{row:1},value:1},{basis:{row:2},value:2}])).rejects.toBe(native);
  expect(db.transaction).toHaveBeenCalledTimes(2);
 });
 test('quota errors are propagated without retry',async()=>{
  const native=new DOMException('full','QuotaExceededError');
  const db={transaction:jest.fn(()=>failingTransaction(native))};openCodeArchitectureHazardDB.mockResolvedValue(db);
  const cache=await createCodeHazardCheckpoint({projectId:'quota'});
  await expect(cache.readMany([{row:1},{row:2}])).rejects.toBe(native);
  expect(db.transaction).toHaveBeenCalledTimes(1);
 });
 test('user cancellation during a failed transaction is never retried',async()=>{
  const controller=new AbortController();
  const db={transaction:jest.fn(()=>failingTransaction(new DOMException('inactive','TransactionInactiveError'),controller))};
  openCodeArchitectureHazardDB.mockResolvedValue(db);
  const cache=await createCodeHazardCheckpoint({projectId:'cancel'},{signal:controller.signal});
  await expect(cache.readMany([{row:1},{row:2}])).rejects.toHaveProperty('name','AbortError');
  expect(db.transaction).toHaveBeenCalledTimes(1);
 });
});
