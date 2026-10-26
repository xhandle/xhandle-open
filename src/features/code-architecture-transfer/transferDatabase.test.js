import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB, unwrap } from 'idb';
import { openTransferDatabase, readTransferTransaction } from './transferDatabase';

beforeEach(()=>{global.indexedDB=new IDBFactory();});
afterEach(()=>jest.restoreAllMocks());
const seed=()=>openDB('storage',1,{upgrade(db){db.createObjectStore('records');}});

test('a stalled read-only open retries, and a late connection is closed',async()=>{
  const original=await seed();original.close();
  const stalled={},open=jest.spyOn(indexedDB,'open').mockImplementationOnce(()=>stalled),progress=[];
  const db=await openTransferDatabase('storage',{existingOnly:true,timeoutMs:10,onProgress:m=>progress.push(m)});
  expect(open).toHaveBeenCalledTimes(2);expect(progress.some(m=>m.includes('retry 2'))).toBe(true);
  const late=unwrap(await openDB('storage')),close=jest.spyOn(late,'close');
  stalled.result=late;stalled.onsuccess();expect(close).toHaveBeenCalledTimes(1);
  db.close();
});
test('cancel stops a pending open immediately and prevents late upgrades',async()=>{
  const pending={transaction:{abort:jest.fn()}},open=jest.spyOn(indexedDB,'open').mockReturnValue(pending);
  const controller=new AbortController(),upgrade=jest.fn();
  const operation=openTransferDatabase('storage',{signal:controller.signal,version:1,upgrade});
  const rejected=expect(operation).rejects.toThrow(/cancelled/);controller.abort();await rejected;
  pending.onupgradeneeded({oldVersion:0,newVersion:1});
  expect(upgrade).not.toHaveBeenCalled();expect(pending.transaction.abort).toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1);
});
test('permanent unavailable storage stops after a bounded number of attempts',async()=>{
  const open=jest.spyOn(indexedDB,'open').mockImplementation(()=>({}));
  await expect(openTransferDatabase('storage',{existingOnly:true,timeoutMs:5})).rejects.toThrow(/Restart xHandle/);
  expect(open).toHaveBeenCalledTimes(3);
});
test('missing databases are not created by export',async()=>{
  expect(await openTransferDatabase('missing',{existingOnly:true})).toBeUndefined();
  expect(await indexedDB.databases()).toEqual([]);
});
test('blocked schema upgrades stop and cannot run after the caller has failed',async()=>{
  const blocker=await seed(),upgrade=jest.fn();
  await expect(openTransferDatabase('storage',{version:2,upgrade})).rejects.toThrow(/blocked/);
  blocker.close();
  const current=await openDB('storage');expect(current.version).toBe(1);expect(upgrade).not.toHaveBeenCalled();current.close();
});
test('successful connections release on a later schema change',async()=>{
  const original=await seed();original.close();
  const current=await openTransferDatabase('storage',{existingOnly:true});
  const next=await openDB('storage',2);expect(next.version).toBe(2);
  expect(()=>current.transaction('records')).toThrow();next.close();
});
test('a stalled storage read times out and aborts its transaction',async()=>{
  const tx={store:{},done:new Promise(()=>{}),abort:jest.fn()},db={name:'storage',transaction:()=>tx};
  await expect(readTransferTransaction(db,'records',()=>new Promise(()=>{}),{timeoutMs:5})).rejects.toThrow(/Reading saved project storage timed out/);
  expect(tx.abort).toHaveBeenCalledTimes(1);
});
