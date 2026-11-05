import createWorker from './createWorkspaceGraphWorker';
import {migrateLegacyStorageToWorkspaceGraphIfStale as sync,withWorkspaceGraphMigrationPaused as locked,pauseBackgroundWorkspaceIndexing} from './legacyWorkspaceGraphMigrator';
jest.mock('./createWorkspaceGraphWorker',()=>({__esModule:true,default:jest.fn()}));
let worker:any;
const finished={errors:[],skippedSteps:[],sourceChangedDuringMigration:false};
beforeEach(()=>{
 localStorage.clear();Object.defineProperty(global,'Worker',{value:function(){},configurable:true});
 Object.defineProperty(navigator,'locks',{value:{request:(_name,run)=>run()},configurable:true});
 worker={terminate:jest.fn(),postMessage:jest.fn(()=>Promise.resolve().then(()=>worker.onmessage({data:{type:'done',result:{...finished}}})))};
 (createWorker as jest.Mock).mockImplementation(()=>worker);
});
afterEach(()=>{Object.defineProperty(global,'Worker',{value:undefined,configurable:true});Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});

test('worker captures current sources after queued permanent cleanup finishes',async()=>{
 localStorage.setItem('xhandle:requirements','old sources');
 let release:()=>void=()=>{};const cleanup=locked(async()=>{await new Promise<void>(resolve=>{release=resolve;});localStorage.setItem('xhandle:requirements','current sources');});
 await Promise.resolve();const job=sync({force:true});release();await cleanup;await job;
 expect(new Map(worker.postMessage.mock.calls[0][0].values).get('xhandle:requirements')).toBe('current sources');
 expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('worker transport failures terminate the worker and remain retryable',async()=>{
 worker.postMessage.mockImplementationOnce(()=>{throw Error('Synthetic worker transport failure');});
 await expect(sync({force:true})).rejects.toThrow(/transport failure/);expect(worker.terminate).toHaveBeenCalledTimes(1);
 expect((await sync({force:true})).errors).toEqual([]);expect(worker.terminate).toHaveBeenCalledTimes(2);
});

test('aborting the last waiting query terminates its worker',async()=>{
 const controller=new AbortController();worker.postMessage.mockImplementation(()=>{controller.abort();});
 await expect(sync({force:true,signal:controller.signal})).rejects.toHaveProperty('name','AbortError');
 // Cancellation first releases the caller, then tears down its shared job.
 for(let i=0;i<8;i++)await Promise.resolve();expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('a narrow cached pass cannot satisfy a broader request',async()=>{
 worker.postMessage.mockImplementationOnce(()=>Promise.resolve().then(()=>worker.onmessage({data:{type:'done',result:{...finished,deferredSteps:['indexedFeatureStores','codeIndex']}}})));
 await sync({force:true,steps:['projects']});
 expect(worker.postMessage.mock.calls[0][0].options.steps).toEqual(['projects']);
 await sync();expect(worker.postMessage).toHaveBeenCalledTimes(2);
});

test('foreground turns interrupt only background indexing and release its lock for requested data',async()=>{
 let started:()=>void=()=>{};
 const running=new Promise<void>(resolve=>{started=resolve;});
 worker.postMessage.mockImplementationOnce(()=>{started();});
 const background=sync({force:true,background:true});
 const stopped=expect(background).rejects.toHaveProperty('name','AbortError');
 await running;
 const resume=pauseBackgroundWorkspaceIndexing();
 await stopped;expect(worker.terminate).toHaveBeenCalledTimes(1);
 try{expect((await sync({steps:['projects']})).errors).toEqual([]);}finally{resume();resume();}
 expect(worker.terminate).toHaveBeenCalledTimes(2);
});

test('a scoped worker result cannot satisfy a different project or a workspace-wide request',async()=>{
 worker.postMessage.mockImplementation((message)=>Promise.resolve().then(()=>worker.onmessage({data:{type:'done',result:{...finished,projectIds:message.options.projectIds}}})));
 await sync({force:true,steps:['projects'],projectIds:['p']});
 expect(worker.postMessage.mock.calls[0][0].options.projectIds).toEqual(['p']);
 await sync({steps:['projects'],projectIds:['p']});expect(worker.postMessage).toHaveBeenCalledTimes(1);
 await sync({steps:['projects'],projectIds:['q']});expect(worker.postMessage).toHaveBeenCalledTimes(2);
 await sync({steps:['projects']});expect(worker.postMessage).toHaveBeenCalledTimes(3);
});

test('shared callers receive live progress, replay the current stage, and detach on cancellation', async()=>{
 let started:()=>void=()=>{};const running=new Promise<void>(resolve=>{started=resolve;});
 worker.postMessage.mockImplementationOnce(()=>started());
 const first=jest.fn(),second=jest.fn(),controller=new AbortController();
 const one=sync({force:true,onProgress:first});await running;
 const batch={step:'codeArchitecture',durationMs:700,complete:false,recordsPrepared:256};
 worker.onmessage({data:{type:'progress',value:batch}});
 const two=sync({force:true,onProgress:second,signal:controller.signal});
 expect(second).toHaveBeenLastCalledWith(batch);
 const rejection=expect(two).rejects.toHaveProperty('name','AbortError');controller.abort();await rejection;
 const calls=second.mock.calls.length;
 worker.onmessage({data:{type:'progress',value:{...batch,recordsPrepared:512}}});
 expect(first).toHaveBeenLastCalledWith(expect.objectContaining({recordsPrepared:512}));
 expect(second).toHaveBeenCalledTimes(calls);expect(worker.terminate).not.toHaveBeenCalled();
 worker.onmessage({data:{type:'done',result:{...finished}}});await one;
 expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('active indexing pauses for table reads, preserves its worker, and excludes paused time from timeout',async()=>{
 const {acquireForegroundStoragePriority}=require('../../lib/foregroundStoragePriority');
 jest.useFakeTimers();
 let started:()=>void=()=>{};const running=new Promise<void>(resolve=>{started=resolve;});
 worker.postMessage.mockImplementation(message=>{if(message.options)started();});
 const job=sync({force:true});await running;
 const release=acquireForegroundStoragePriority();
 try{
  expect(worker.postMessage).toHaveBeenLastCalledWith({type:'foreground-storage',busy:true});
  jest.advanceTimersByTime(310000);expect(worker.terminate).not.toHaveBeenCalled();
  release();expect(worker.postMessage).toHaveBeenLastCalledWith({type:'foreground-storage',busy:false});
  worker.onmessage({data:{type:'done',result:{...finished}}});await job;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  const calls=worker.postMessage.mock.calls.length;
  const again=acquireForegroundStoragePriority();again();expect(worker.postMessage).toHaveBeenCalledTimes(calls);
 }finally{release();jest.useRealTimers();}
});
