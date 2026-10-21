import { readArtifactRowsWithRecovery } from './artifactReadRecovery';
import { loadArtifactRowsAsync } from './artifactUtils';
jest.mock('./artifactUtils', () => ({ loadArtifactRowsAsync: jest.fn() }));
const timeout = () => Object.assign(new Error('storage delayed'), {name:'ArtifactStorageTimeoutError'});
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
it('continues beyond the old retry budget and eventually returns actual saved rows',async()=>{
 let attempts=0;
 loadArtifactRowsAsync.mockImplementation(async()=>{if(++attempts<=5) throw timeout();return [{id:'SYS-1'}];});
 const onRetry=jest.fn();
 const result=readArtifactRowsWithRecovery('system','project','repo',{onRetry});
 for(const delay of [2000,4000,8000,16000,30000]) {
   await Promise.resolve();await Promise.resolve();
   jest.advanceTimersByTime(delay);
 }
 await expect(result).resolves.toEqual([{id:'SYS-1'}]);
 expect(loadArtifactRowsAsync).toHaveBeenCalledTimes(6);
 expect(onRetry).toHaveBeenCalledTimes(5);
});
it('cancels retries when the view leaves',async()=>{
 loadArtifactRowsAsync.mockRejectedValue(timeout());
 const controller=new AbortController();
 const result=readArtifactRowsWithRecovery('system','project','repo',{signal:controller.signal});
 const checked=expect(result).rejects.toHaveProperty('name','AbortError');
 await Promise.resolve();await Promise.resolve();
 controller.abort();await checked;
 jest.advanceTimersByTime(60000);
 expect(loadArtifactRowsAsync).toHaveBeenCalledTimes(1);
 expect(jest.getTimerCount()).toBe(0);
});
it('does not hide damaged saved data behind endless retries',async()=>{
 loadArtifactRowsAsync.mockRejectedValue(new Error('Saved requirements are incomplete or damaged.'));
 await expect(readArtifactRowsWithRecovery('system','project','repo')).rejects.toThrow('damaged');
 expect(loadArtifactRowsAsync).toHaveBeenCalledTimes(1);
 expect(jest.getTimerCount()).toBe(0);
});
