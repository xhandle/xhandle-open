import {saveSafetyCaseEvidenceAttachments as save} from './safetyCaseAttachments';
let previous,tx;
beforeEach(()=>{
 tx=undefined;
 previous=Object.getOwnPropertyDescriptor(window,'indexedDB');
 const db={transaction:()=>{const request={};tx={objectStore:()=>({put:()=>{Promise.resolve().then(()=>request.onsuccess?.());return request;}})};return tx;},close:jest.fn()};
 Object.defineProperty(window,'indexedDB',{configurable:true,value:{open:()=>{const request={};Promise.resolve().then(()=>{request.result=db;request.onsuccess();});return request;}}});
});
afterEach(()=>{if(previous)Object.defineProperty(window,'indexedDB',previous);else delete window.indexedDB;jest.restoreAllMocks();});
async function untilTransaction(){for(let i=0;i<10&&!tx;i++)await new Promise(resolve=>setTimeout(resolve,5));}
test('file evidence is not reported saved before the transaction commits',async()=>{
 let resolved=false;const pending=save([new File(['evidence'],'log.txt')]).then(value=>{resolved=true;return value;});
 await untilTransaction();await Promise.resolve();expect(tx).toBeDefined();expect(resolved).toBe(false);
 tx.oncomplete();expect((await pending)[0].title).toBe('log.txt');
});
test('an aborted attachment transaction rejects even after request success',async()=>{
 const pending=save([new File(['evidence'],'log.txt')]);
 const assertion=expect(pending).rejects.toThrow('aborted');
 await untilTransaction();tx.onabort();await assertion;
});
