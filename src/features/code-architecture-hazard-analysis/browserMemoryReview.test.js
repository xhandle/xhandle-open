/* global globalThis */
import {createHazardEvidenceChunker} from './hazardEvidenceChunking';
import {resultsFirstPrompt} from './resultsFirstHazardPipeline';
import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';

// Synthetic review probes. No browser databases or provider calls are used.
test('large planning retains fixed-size identities instead of full evidence payload keys',()=>{
  const original=Map.prototype.set;
  const keys=[];
  const spy=jest.spyOn(Map.prototype,'set').mockImplementation(function(key,value){
    if(typeof key==='string' && (key.startsWith('{"dictionary":') || /^[a-f0-9]{64}$/.test(key)) && typeof value==='number')keys.push(key.length);
    return original.call(this,key,value);
  });
  try{
    const chunker=createHazardEvidenceChunker({request:()=>{throw new Error('No provider calls allowed');}});
    for(let i=0;i<202;i++)chunker.plan(resultsFirstPrompt('STPA',[{
      id:`HA-${i}`,action:`Action ${i}`,phrase:'Too late',evidence:'x'.repeat(128000),
    }],{}),{maxTokens:14000,inputByteLimit:1000});
    const retainedKeyCharacters=keys.reduce((sum,size)=>sum+size,0);
    expect(keys).toHaveLength(202);
    expect(retainedKeyCharacters).toBe(202*64);
    console.info('MEMORY_REVIEW_PLAN',JSON.stringify({uniqueInputs:keys.length,retainedKeyCharacters}));
  }finally{spy.mockRestore();}
});

test('reused checkpoint bases avoid repeated full evidence serialization',async()=>{
  const cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const encoderDescriptor=Object.getOwnPropertyDescriptor(globalThis,'TextEncoder');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:require('crypto').webcrypto});
  Object.defineProperty(globalThis,'TextEncoder',{configurable:true,value:require('util').TextEncoder});
  const evidence='x'.repeat(128000),original=JSON.stringify;
  let serializations=0,serializedCharacters=0;
  const spy=jest.spyOn(JSON,'stringify').mockImplementation((value,...args)=>{
    const result=original(value,...args);
    if(value?.source?.evidence===evidence){serializations++;serializedCharacters+=result.length;}
    return result;
  });
  try{
    const cache=resilientHazardCheckpoint({readMany:async bases=>bases.map(()=>undefined),writeMany:async()=>{}});
    const bases=Array.from({length:48},(_,i)=>({source:{id:`HA-${i}`,evidence}}));
    await cache.readMany(bases);
    await cache.writeMany(bases.map((basis,i)=>({basis,value:{id:`HA-${i}`}})));
    await cache.flush();
    expect(serializations).toBe(48);
    expect(serializedCharacters).toBeLessThan(6200000);
    console.info('MEMORY_REVIEW_CHECKPOINT',original({rows:48,serializations,serializedCharacters,cryptoDigestEnabled:Boolean(globalThis.crypto?.subtle)}));
  }finally{
    spy.mockRestore();
    if(cryptoDescriptor)Object.defineProperty(globalThis,'crypto',cryptoDescriptor);else delete globalThis.crypto;
    if(encoderDescriptor)Object.defineProperty(globalThis,'TextEncoder',encoderDescriptor);else delete globalThis.TextEncoder;
  }
});

test('stalled storage bounds the queue, then resumes without dropping results',async()=>{
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const persisted=[];
  const cache=resilientHazardCheckpoint({writeMany:async entries=>{await blocked;persisted.push(...entries);}},{maxPendingEntries:8,maxPendingBytes:20000});
  let completed=0;
  const producer=(async()=>{
    for(let id=0;id<300;id++){await cache.write({id,evidence:'x'.repeat(1000)},{accepted:true});completed++;}
  })();
  await new Promise(resolve=>setTimeout(resolve,30));
  expect(completed).toBeLessThanOrEqual(8);
  expect(cache.memoryStats().pendingBytes).toBeLessThanOrEqual(20000);
  release();await producer;await cache.flush();
  expect(persisted.map(e=>e.basis.id)).toEqual(Array.from({length:300},(_,i)=>i));
  expect(cache.memoryStats().pending).toBe(0);
});
