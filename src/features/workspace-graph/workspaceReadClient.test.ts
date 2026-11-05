import createWorker from './createWorkspaceReadWorker';
import {executeWorkspaceReadPlan,clearWorkspaceReadCache} from './workspaceReadClient';
import {withWorkspaceGraphMigrationPaused as locked} from './workspaceGraphIndexLock';
jest.mock('./workspaceGraphDb',()=>({openWorkspaceGraphDB:async()=>({get:async()=>({token:mockGraphRevision}),close:()=>{}})}));
jest.mock('./createWorkspaceReadWorker',()=>({__esModule:true,default:jest.fn()}));
let worker:any;
let mockGraphRevision='revision';
const policy={projectIds:['p'],projects:[],types:[],query:'read'};
beforeEach(()=>{
 clearWorkspaceReadCache();localStorage.clear();Object.defineProperty(global,'Worker',{value:function(){},configurable:true});Object.defineProperty(navigator,'locks',{value:{request:(_name,run)=>run()},configurable:true});
 worker={terminate:jest.fn(),postMessage:jest.fn(()=>Promise.resolve().then(()=>worker.onmessage({data:{type:'done',results:[{count:5,coverage:{complete:true}}]}})))};(createWorker as jest.Mock).mockImplementation(()=>worker);
});
afterEach(()=>{Object.defineProperty(global,'Worker',{value:undefined,configurable:true});Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});
test('source changes during worker reads invalidate exact totals',async()=>{
 worker.postMessage.mockImplementation(()=>{localStorage.setItem('xhandle:requirements','changed');worker.onmessage({data:{type:'done',results:[{count:5,coverage:{complete:true}}]}});});
 const [result]=await executeWorkspaceReadPlan([{operation:'aggregate'}],policy);expect(result.count).toBeNull();expect(result.coverage.state).toBe('stale');expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test('cancel while waiting for an indexing lock returns immediately and never starts a late worker',async()=>{
 let release:()=>void=()=>{};const index=locked(async()=>new Promise<void>(resolve=>{release=resolve;}));await Promise.resolve();
 const controller=new AbortController(),read=executeWorkspaceReadPlan([{operation:'query'}],policy,{signal:controller.signal});controller.abort();
 await expect(read).rejects.toHaveProperty('name','AbortError');expect(createWorker).not.toHaveBeenCalled();release();await index;
 for(let i=0;i<8;i++)await Promise.resolve();expect(createWorker).not.toHaveBeenCalled();
});
test('cancelling an active worker terminates it and does not return its old results',async()=>{
 const controller=new AbortController();worker.postMessage.mockImplementation(()=>controller.abort());
 await expect(executeWorkspaceReadPlan([{operation:'query'}],policy,{signal:controller.signal})).rejects.toHaveProperty('name','AbortError');expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('complete read results reuse a bounded revision cache, and source changes invalidate it',async()=>{
 const timing=jest.fn();const first=await executeWorkspaceReadPlan([{operation:'aggregate'}],policy,{onTiming:timing});first[0].count=999;
 const second=await executeWorkspaceReadPlan([{operation:'aggregate'}],policy,{onTiming:timing});expect(second[0].count).toBe(5);expect(createWorker).toHaveBeenCalledTimes(1);expect(timing.mock.calls[1][0].cacheHit).toBe(true);
 localStorage.setItem('xhandle:requirements','new source');await executeWorkspaceReadPlan([{operation:'aggregate'}],policy);expect(createWorker).toHaveBeenCalledTimes(2);
});

test('incomplete results are not cached',async()=>{
 worker.postMessage.mockImplementation(()=>Promise.resolve().then(()=>worker.onmessage({data:{type:'done',results:[{count:null,coverage:{complete:false,state:'partial'}}]}})));
 await executeWorkspaceReadPlan([{operation:'aggregate'}],policy);await executeWorkspaceReadPlan([{operation:'aggregate'}],policy);expect(createWorker).toHaveBeenCalledTimes(2);
});

test('graph mutations and cache expiry require a fresh worker read',async()=>{
 const call=[{operation:'aggregate'}];
 await executeWorkspaceReadPlan(call,policy);
 mockGraphRevision='changed-revision';
 await executeWorkspaceReadPlan(call,policy);expect(createWorker).toHaveBeenCalledTimes(2);
 const clock=jest.spyOn(Date,'now').mockReturnValue(Date.now()+31000);
 try{await executeWorkspaceReadPlan(call,policy);expect(createWorker).toHaveBeenCalledTimes(3);}finally{clock.mockRestore();}
});

test('oversized read results are never retained in the cache',async()=>{
 worker.postMessage.mockImplementation(()=>Promise.resolve().then(()=>worker.onmessage({data:{type:'done',results:[{excerpt:'x'.repeat(110000),coverage:{complete:true}}]}})));
 await executeWorkspaceReadPlan([{operation:'aggregate'}],policy);
 await executeWorkspaceReadPlan([{operation:'aggregate'}],policy);
 expect(createWorker).toHaveBeenCalledTimes(2);
});
