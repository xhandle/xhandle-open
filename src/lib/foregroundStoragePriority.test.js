import {acquireForegroundStoragePriority as acquire,isForegroundStorageBusy as busy,waitForForegroundStorage as wait,setRemoteForegroundStorageBusy as remote} from './foregroundStoragePriority';
test('overlapping table reads release indexing only after the last read finishes',async()=>{
 const a=acquire(),b=acquire();let resumed=false;
 const job=wait().then(()=>{resumed=true;});
 a();a();await Promise.resolve();expect(resumed).toBe(false);expect(busy()).toBe(true);
 b();await job;expect(resumed).toBe(true);expect(busy()).toBe(false);
});
test('worker pause state and aborted waiters are cleaned up without polling',async()=>{
 remote(true);const controller=new AbortController(),job=wait(controller.signal);
 const rejected=expect(job).rejects.toHaveProperty('name','AbortError');controller.abort();await rejected;
 remote(false);await wait();expect(busy()).toBe(false);
});
