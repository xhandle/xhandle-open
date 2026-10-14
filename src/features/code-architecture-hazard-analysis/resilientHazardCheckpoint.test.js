import {resilientHazardCheckpoint} from './resilientHazardCheckpoint';
test('write is immediate, serialized and retried without losing latest buffered value',async()=>{
 let reject;const write=jest.fn().mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;})).mockResolvedValue();
 const state=jest.fn(),cache=resilientHazardCheckpoint({write},{onStorageState:state});
 await cache.write({id:1},'first');await cache.write({id:1},'second');expect(write).toHaveBeenCalledTimes(1);
 reject(new DOMException('Aborted','AbortError'));await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect((await cache.read({id:1}))).toBe('second');
 await cache.flush();expect(write.mock.calls.at(-1)[1]).toBe('second');
 expect(state).toHaveBeenCalledWith(expect.objectContaining({unsaved:true}));
});
test('read failure falls back to memory rather than halting work',async()=>{
 const state=jest.fn(),cache=resilientHazardCheckpoint({read:async()=>{throw new Error('Storage unavailable');},write:async()=>{}},{onStorageState:state});
 expect(await cache.read({id:1})).toBeUndefined();await cache.write({id:1},'ready');expect(await cache.read({id:1})).toBe('ready');
 expect(state).toHaveBeenCalled();
});
test('an unresponsive database cannot hold the checkpoint writer indefinitely',async()=>{
 jest.useFakeTimers();
 try{
  const state=jest.fn(),cache=resilientHazardCheckpoint({write:()=>new Promise(()=>{})},{onStorageState:state});
  await cache.write({id:1},'ready');
  jest.advanceTimersByTime(1500);
  for(let i=0;i<5;i++)await Promise.resolve();
  expect(state).toHaveBeenCalledWith(expect.objectContaining({unsaved:true}));
  expect(await cache.read({id:1})).toBe('ready');
 }finally{jest.useRealTimers();}
});
