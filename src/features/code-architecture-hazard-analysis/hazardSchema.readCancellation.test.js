import {openHazardSchema} from './hazardSchema';
import {openDB} from 'idb';
jest.mock('idb',()=>({openDB:jest.fn()}));
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>{jest.useRealTimers();jest.clearAllMocks();});
test.each(['abort','timeout'])('late database connections close after %s',async kind=>{
 let resolve;openDB.mockReturnValue(new Promise(r=>{resolve=r;}));
 const controller=new AbortController();const pending=openHazardSchema({signal:controller.signal,timeoutMs:20});
 const rejected=expect(pending).rejects.toThrow(kind==='abort'?'cancelled':'timed out');
 if(kind==='abort')controller.abort();else jest.advanceTimersByTime(20);
 await rejected;const db={close:jest.fn()};resolve(db);await Promise.resolve();expect(db.close).toHaveBeenCalledTimes(1);
 expect(jest.getTimerCount()).toBe(0);
});
