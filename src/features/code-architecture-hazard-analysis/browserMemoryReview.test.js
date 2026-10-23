/* global globalThis */
import {createHazardEvidenceChunker} from './hazardEvidenceChunking';
import {resultsFirstPrompt} from './resultsFirstHazardPipeline';
import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';

// Synthetic review probes. No browser databases or provider calls are used.
test('review: planning retains one full serialized payload key per unique oversized input',()=>{
  const original=Map.prototype.set;
  const keys=[];
  const spy=jest.spyOn(Map.prototype,'set').mockImplementation(function(key,value){
    if(typeof key==='string' && key.startsWith('{"dictionary":') && typeof value==='number')keys.push(key.length);
    return original.call(this,key,value);
  });
  try{
    const chunker=createHazardEvidenceChunker({request:()=>{throw new Error('No provider calls allowed');}});
    for(let i=0;i<202;i++)chunker.plan(resultsFirstPrompt('STPA',[{
      id:`HA-${i}`,action:`Action ${i}`,phrase:'Too late',evidence:'x'.repeat(128000),
    }],{}),{maxTokens:14000,inputByteLimit:1000});
    const retainedKeyCharacters=keys.reduce((sum,size)=>sum+size,0);
    expect(keys).toHaveLength(202);
    expect(retainedKeyCharacters).toBeGreaterThan(25000000);
    console.info('MEMORY_REVIEW_PLAN',JSON.stringify({uniqueInputs:keys.length,retainedKeyCharacters}));
  }finally{spy.mockRestore();}
});

test('review: fresh checkpoint basis objects repeatedly serialize shared evidence',async()=>{
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
    await cache.readMany(Array.from({length:48},(_,i)=>({source:{id:`HA-${i}`,evidence}})));
    await cache.writeMany(Array.from({length:48},(_,i)=>({basis:{source:{id:`HA-${i}`,evidence}},value:{id:`HA-${i}`}})));
    await cache.flush();
    expect(serializations).toBe(96);
    expect(serializedCharacters).toBeGreaterThan(12000000);
    console.info('MEMORY_REVIEW_CHECKPOINT',original({rows:48,serializations,serializedCharacters,cryptoDigestEnabled:Boolean(globalThis.crypto?.subtle)}));
  }finally{
    spy.mockRestore();
    if(cryptoDescriptor)Object.defineProperty(globalThis,'crypto',cryptoDescriptor);else delete globalThis.crypto;
    if(encoderDescriptor)Object.defineProperty(globalThis,'TextEncoder',encoderDescriptor);else delete globalThis.TextEncoder;
  }
});

test('review: stalled checkpoint storage retains dirty entries beyond the clean-cache limit',async()=>{
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const cache=resilientHazardCheckpoint({writeMany:()=>blocked},{maxCleanEntries:96,flushMs:1,slowMs:60000});
  try{
    for(let offset=0;offset<300;offset+=48)await cache.writeMany(Array.from({length:Math.min(48,300-offset)},(_,i)=>({basis:{id:offset+i,evidence:'x'.repeat(1000)},value:{accepted:true}})));
    const status=await cache.flush();
    expect(status).toEqual({unsaved:true,pending:300});
    console.info('MEMORY_REVIEW_DIRTY',JSON.stringify({maxCleanEntries:96,pending:status.pending}));
  }finally{release();await cache.flush();}
});
