import { inspectStorageStore } from './inspectStorageStore';
function fixture() {
  const request = {};
  const store = { count: jest.fn(() => request), openCursor: () => { throw new Error('Payload access forbidden'); } };
  const tx = { objectStore: () => store, abort: jest.fn() };
  return { request, tx, store, db: { transaction: jest.fn(() => tx), close: jest.fn() } };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('counts without reading or sizing records, and leaves byte totals unknown', async () => {
  const f = fixture(); const result = inspectStorageStore(f.db, 'rows');
  f.request.result = 10000; f.request.onsuccess(); f.tx.oncomplete();
  expect(await result).toEqual({count:10000,bytes:null,error:''});
  expect(f.db.transaction).toHaveBeenCalledWith('rows','readonly');
  expect(f.store.count).toHaveBeenCalledTimes(1);
  expect(f.db.close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
test.each(['timeout','cancel'])('%s aborts the transaction and ignores late events', async kind => {
  const f=fixture(), controller=new AbortController();
  const result=inspectStorageStore(f.db,'rows',{signal:controller.signal});
  if(kind==='timeout') jest.advanceTimersByTime(5000); else controller.abort();
  f.request.result=500; f.request.onsuccess();f.tx.oncomplete();
  expect(await result).toMatchObject({count:null,bytes:null,error:expect.any(String)});
  expect((await result).error).toBeTruthy();
  expect(f.tx.abort).toHaveBeenCalledTimes(1);
  expect(f.db.close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
test('already cancelled scans do not start a transaction', async () => {
  const f=fixture(),controller=new AbortController();controller.abort();
  expect((await inspectStorageStore(f.db,'rows',{signal:controller.signal})).error).toBeTruthy();
  expect(f.db.transaction).not.toHaveBeenCalled();
});
test('failed counts are unavailable rather than a successful empty store',async()=>{
  const f=fixture();const result=inspectStorageStore(f.db,'rows');f.request.onerror();
  expect(await result).toMatchObject({count:null,error:expect.any(String)});
  expect((await result).error).toBeTruthy();
});
