import { openCbaIndexedDB, readFirstCbaRowsFromIndexedDB } from './codeArchitectureStorage';
import { rawRecord, hydrateRecord } from '../code-architecture-storage/chunkedRecord';
const original=global.indexedDB;
afterEach(()=>{global.indexedDB=original;});
it('rejects an abandoned open and closes its late connection',async()=>{
 const request={};global.indexedDB={open:()=>request};
 const controller=new AbortController();const opened=openCbaIndexedDB({signal:controller.signal});
 const check=expect(opened).rejects.toMatchObject({name:'AbortError'});controller.abort();await check;
 request.result={close:jest.fn()};request.onsuccess();expect(request.result.close).toHaveBeenCalledTimes(1);
});
it('aborts a stalled raw-record transaction',async()=>{
 const request={},tx={abort:jest.fn(),objectStore:()=>({get:()=>request})};
 const controller=new AbortController();const read=rawRecord({transaction:()=>tx},'store','key',{signal:controller.signal});
 const check=expect(read).rejects.toMatchObject({name:'AbortError'});controller.abort();await check;expect(tx.abort).toHaveBeenCalledTimes(1);
});
it('aborts chunk reads and rejects hydration',async()=>{
 const tx={objectStore:()=>({get:()=>({})})};tx.abort=jest.fn(()=>tx.onabort());
 const controller=new AbortController();const read=hydrateRecord({transaction:()=>tx},'store',{format:'xhandle-json-tree-v1',root:'part'},{signal:controller.signal});
 const check=expect(read).rejects.toMatchObject({name:'AbortError'});
 await Promise.resolve();controller.abort();await check;expect(tx.abort).toHaveBeenCalledTimes(1);
});
it('closes the project connection when a stalled record read is cancelled',async()=>{
 const request={};global.indexedDB={open:()=>request};
 const tx={abort:jest.fn(),objectStore:()=>({get:()=>({})})};
 const db={transaction:()=>tx,close:jest.fn()};
 const controller=new AbortController();const read=readFirstCbaRowsFromIndexedDB(['scope'],{signal:controller.signal});
 const check=expect(read).rejects.toMatchObject({name:'AbortError'});
 request.result=db;request.onsuccess();await Promise.resolve();controller.abort();await check;expect(db.close).toHaveBeenCalled();
});
