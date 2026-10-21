import {loadArtifactRowsAsync} from './artifactUtils';
const original=global.indexedDB;
beforeEach(()=>{jest.useFakeTimers();localStorage.clear();global.indexedDB={open:jest.fn(()=>({}))};});
afterEach(()=>{global.indexedDB=original;jest.useRealTimers();});
async function tick(){jest.advanceTimersByTime(5000);await Promise.resolve();await Promise.resolve();}
it('coalesces reads, bounds timeout retries, and allows a new retry after failure',async()=>{
 const reads=Array.from({length:6},()=>loadArtifactRowsAsync('system-requirements','timeout-recovery','repo'));
 const results=Promise.allSettled(reads);
 expect(new Set(reads).size).toBe(1);
 expect(indexedDB.open).toHaveBeenCalledTimes(1);
 await tick();await tick();await tick();
 const settled=await results;
 expect(indexedDB.open).toHaveBeenCalledTimes(3);
 expect(settled.every(r=>r.status==='rejected' && r.reason.name==='ArtifactStorageTimeoutError')).toBe(true);
 expect(settled[0].reason.message).not.toContain('Close other');
 const retry=loadArtifactRowsAsync('system-requirements','timeout-recovery','repo');
 const checked=expect(retry).rejects.toThrow('did not respond');
 await tick();await tick();await tick();await checked;
 expect(indexedDB.open).toHaveBeenCalledTimes(6);
});
it('recovers after a delayed open and closes the late abandoned connection',async()=>{
 const requests=[];indexedDB.open.mockImplementation(()=>{const request={};requests.push(request);return request;});
 const result=loadArtifactRowsAsync('system-requirements','late-recovery','repo');
 await tick();
 const get={};
 const db={objectStoreNames:{contains:()=>true},close:jest.fn(),transaction:()=>({objectStore:()=>({get:()=>get})})};
 requests[1].result=db;requests[1].onsuccess();
 await Promise.resolve();await Promise.resolve();
 get.result={rows:[{id:'SYS-1'}],revision:1};get.onsuccess();
 await expect(result).resolves.toEqual([{id:'SYS-1'}]);
 expect(db.close).toHaveBeenCalled();
 const late={close:jest.fn()};requests[0].result=late;requests[0].onsuccess();
 expect(late.close).toHaveBeenCalledTimes(1);
});
