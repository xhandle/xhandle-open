import { readProjectWithRecovery } from './projectReadRecovery';
const flush = async () => { for(let i=0;i<6;i++) await Promise.resolve(); };
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
it('aborts stalled attempts, retries and ignores late progress/results',async()=>{
 let late, oldOptions;
 const read=jest.fn(options=>{oldOptions=options;return new Promise(resolve=>{late=resolve;});})
  .mockImplementationOnce(options=>{oldOptions=options;return new Promise(resolve=>{late=resolve;});})
  .mockResolvedValueOnce(['recovered']);
 const progress=jest.fn(), retry=jest.fn();
 const result=readProjectWithRecovery(read,{idleMs:100,onProgress:progress,onRetry:retry});
 await flush();const first=oldOptions;
 jest.advanceTimersByTime(100);await flush();
 expect(first.signal.aborted).toBe(true);expect(retry).toHaveBeenCalledTimes(1);
 const calls=progress.mock.calls.length;first.onProgress(80);late(['obsolete']);await flush();
 expect(progress).toHaveBeenCalledTimes(calls);
 jest.advanceTimersByTime(2000);await flush();expect(await result).toEqual(['recovered']);
 expect(jest.getTimerCount()).toBe(0);
});
it('resumes an overdue read on pageshow without waiting for throttled timers',async()=>{
 const read=jest.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce('ok');
 const result=readProjectWithRecovery(read,{idleMs:100});await flush();
 jest.setSystemTime(Date.now()+1000);window.dispatchEvent(new Event('pageshow'));await flush();
 expect(await result).toBe('ok');expect(read).toHaveBeenCalledTimes(2);
});
it('cancels reads on project change and never retries after cancellation',async()=>{
 const controller=new AbortController();let inner;
 const read=jest.fn(({signal})=>{inner=signal;return new Promise(()=>{});});
 const result=readProjectWithRecovery(read,{signal:controller.signal});const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
 await flush();controller.abort();await rejected;
 expect(inner.aborted).toBe(true);
 window.dispatchEvent(new Event('pageshow'));jest.runAllTimers();expect(read).toHaveBeenCalledTimes(1);
});
it('propagates invalid data instead of retrying forever',async()=>{
 const result=readProjectWithRecovery(()=>Promise.reject(new Error('Missing chunk')));
 await expect(result).rejects.toThrow('Missing chunk');expect(jest.getTimerCount()).toBe(0);
});
it('extends the idle deadline when real read progress arrives',async()=>{
 let options, resolve;
 const read=jest.fn(o=>{options=o;return new Promise(r=>{resolve=r;});});
 const result=readProjectWithRecovery(read,{idleMs:100});await flush();
 jest.advanceTimersByTime(80);options.onProgress(20);jest.advanceTimersByTime(80);
 expect(options.signal.aborted).toBe(false);resolve('done');expect(await result).toBe('done');
});
