import {IDBFactory} from 'fake-indexeddb';
import {startWorkspaceStorageSession} from './workspaceStorageSession';
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
let stop;
afterEach(()=>{stop?.();stop=null;jest.restoreAllMocks();jest.useRealTimers();});
test('retains one connection without transactions and releases for upgrade and deletion',async()=>{
 const factory=new IDBFactory();const seed=await requestResult(factory.open('xhandle',4));seed.close();
 const open=jest.spyOn(factory,'open');
 let connected;
 open.mockImplementation((...args)=>{const request=IDBFactory.prototype.open.apply(factory,args);request.addEventListener('success',()=>{connected=request.result;});return request;});
 stop=startWorkspaceStorageSession({factory,retryMs:0});
 await new Promise(resolve=>open.mock.results[0].value.addEventListener('success',resolve));
 const transaction=jest.spyOn(connected,'transaction');
 for(let i=0;i<20;i++)window.dispatchEvent(new Event('pointerdown'));
 expect(open).toHaveBeenCalledTimes(1);expect(transaction).not.toHaveBeenCalled();
 const upgrade=await requestResult(factory.open('xhandle',5));upgrade.close();
 window.dispatchEvent(new Event('pointerdown'));
 await new Promise(resolve=>open.mock.results[2].value.addEventListener('success',resolve));
 await requestResult(factory.deleteDatabase('xhandle'));
 stop();expect(await factory.databases()).toEqual([]);
});
test('does not create a missing database and retries only after cooldown and interaction',async()=>{
 const factory=new IDBFactory(),open=jest.spyOn(factory,'open');
 stop=startWorkspaceStorageSession({factory});
 await new Promise(resolve=>open.mock.results[0].value.addEventListener('error',resolve));
 expect(await factory.databases()).toEqual([]);
 window.dispatchEvent(new Event('pointerdown'));expect(open).toHaveBeenCalledTimes(1);
 stop();window.dispatchEvent(new Event('pointerdown'));expect(open).toHaveBeenCalledTimes(1);
});
test('closes a late successful open after cleanup, including StrictMode replacement',()=>{
 const requests=[],factory={open:jest.fn(()=>{const request={};requests.push(request);return request;})};
 stop=startWorkspaceStorageSession({factory});stop();
 stop=startWorkspaceStorageSession({factory});
 const old={close:jest.fn()},current={close:jest.fn()};requests[0].result=old;requests[0].onsuccess();requests[1].result=current;requests[1].onsuccess();
 expect(old.close).toHaveBeenCalledTimes(1);expect(current.close).not.toHaveBeenCalled();
 stop();expect(current.close).toHaveBeenCalledTimes(1);
});
test('releases after background grace and reopens on foreground, without polling',()=>{
 jest.useFakeTimers();let visibility='visible';jest.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility);
 const db={close:jest.fn()},request={result:db},factory={open:jest.fn(()=>request)};
 stop=startWorkspaceStorageSession({factory,backgroundMs:100});request.onsuccess();
 visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));jest.advanceTimersByTime(99);expect(db.close).not.toHaveBeenCalled();
 jest.advanceTimersByTime(1);expect(db.close).toHaveBeenCalledTimes(1);
 visibility='visible';document.dispatchEvent(new Event('visibilitychange'));expect(factory.open).toHaveBeenCalledTimes(2);
});
