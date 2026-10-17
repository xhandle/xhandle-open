import {waitForHazardSave} from './waitForHazardSave';
test('deadline leaves the single underlying writer alive and observes late rejection',async()=>{
 jest.useFakeTimers();
 try{
  let reject;const operation=new Promise((_,r)=>{reject=r;});
  const result=waitForHazardSave(operation).catch(error=>error);
  jest.advanceTimersByTime(1500);
  expect((await result).message).toContain('pending');
  reject(new Error('late failure'));await Promise.resolve();
 }finally{jest.useRealTimers();}
});
test('cancellation stops waiting without waiting for storage',async()=>{
 const controller=new AbortController();
 const result=waitForHazardSave(new Promise(()=>{}),{signal:controller.signal}).catch(error=>error);
 controller.abort();expect((await result).name).toBe('AbortError');
});
