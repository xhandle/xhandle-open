import requestHazardRows from './requestHazardRows';
import createWorker from './createHazardRowsWorker';
import {PAGED_HAZARD} from './hazardRowIndex';
jest.mock('./createHazardRowsWorker',()=>jest.fn());
let operations,failValidation,bytes;
const run=(id,revision=1)=>({id,projectId:'p',repoId:'r',[PAGED_HAZARD]:{generation:id,revision}});
beforeEach(()=>{
 operations=[];failValidation=false;bytes=1024;
 createWorker.mockImplementation(()=>{
  const worker={terminate:jest.fn(),postMessage:({options})=>{
   operations.push(options.operation);
   Promise.resolve().then(()=>worker.onmessage({data:failValidation&&options.operation==='validate'?{type:'error',message:'Saved results changed.'}:{type:'result',result:options.operation==='validate'?{valid:true}:{headers:['Hazard'],groups:[],indices:[0],total:1,metadataBytes:bytes,optionIndex:{columns:[{options:['saved value'],truncated:false}],metadataBytes:256}}}}));
  }};return worker;
 });
});
test('reuses outlines only after saved revision validation and rebuilds on changed revision',async()=>{
 const first=await requestHazardRows(run('reuse'),{operation:'layout'});
 expect(await requestHazardRows(run('reuse'),{operation:'layout'})).toEqual(first);
 expect(operations).toEqual(['layout','validate']);
 await requestHazardRows(run('reuse',2),{operation:'layout'});expect(operations[2]).toBe('layout');
 failValidation=true;await expect(requestHazardRows(run('reuse',2),{operation:'layout'})).rejects.toThrow('changed');
 failValidation=false;await requestHazardRows(run('reuse',2),{operation:'layout'});expect(operations.at(-1)).toBe('layout');
});
test('bounds total retained metadata and does not cache searched or oversized layouts',async()=>{
 bytes=5*1024*1024;
 await requestHazardRows(run('budget1'),{operation:'layout'});await requestHazardRows(run('budget2'),{operation:'layout'});
 await requestHazardRows(run('budget1'),{operation:'layout'});expect(operations).toEqual(['layout','layout','layout']);
 bytes=9*1024*1024;
 for(let i=0;i<2;i++)await requestHazardRows(run('large'),{operation:'layout'});
 for(let i=0;i<2;i++)await requestHazardRows(run('search'),{operation:'layout',search:'private text'});
 expect(operations.every(op=>op==='layout')).toBe(true);
});
test('cancelled cache hits never resolve and terminate validation workers',async()=>{
 await requestHazardRows(run('abort'),{operation:'layout'});
 const controller=new AbortController();
 const result=requestHazardRows(run('abort'),{operation:'layout',signal:controller.signal});controller.abort();
 await expect(result).rejects.toMatchObject({name:'AbortError'});
 expect(createWorker.mock.results.at(-1).value.terminate).toHaveBeenCalled();
});

test('many large project outlines evict old entries and every worker terminates',async()=>{
 bytes=6*1024*1024;
 for(let i=0;i<24;i++)await requestHazardRows(run('stress-'+i),{operation:'layout'});
 await requestHazardRows(run('stress-23'),{operation:'layout'});
 expect(operations.at(-1)).toBe('validate');
 await requestHazardRows(run('stress-0'),{operation:'layout'});
 expect(operations.at(-1)).toBe('layout');
 expect(createWorker.mock.results.every(result=>result.value.terminate.mock.calls.length===1)).toBe(true);
});
test('many tiny outlines are still bounded by entry count',async()=>{
 bytes=128;
 for(let i=0;i<10;i++)await requestHazardRows(run('tiny-'+i),{operation:'layout'});
 await requestHazardRows(run('tiny-9'),{operation:'layout'});
 await requestHazardRows(run('tiny-8'),{operation:'layout'});
 await requestHazardRows(run('tiny-7'),{operation:'layout'});
 expect(operations.slice(-3)).toEqual(['validate','validate','layout']);
});

test('active worker failures reject, while late cancelled errors do not escape globally',async()=>{
 createWorker.mockImplementation(()=>({terminate:jest.fn(),postMessage:jest.fn()}));
 const active=requestHazardRows(run('failure'),{operation:'page'});
 const rejected=expect(active).rejects.toThrow('chunk unavailable');
 const error={message:'chunk unavailable',preventDefault:jest.fn()};
 createWorker.mock.results.at(-1).value.onerror(error);await rejected;
 expect(error.preventDefault).toHaveBeenCalledTimes(1);
 const controller=new AbortController(),cancelled=requestHazardRows(run('late'),{operation:'page',signal:controller.signal});
 const aborted=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
 const worker=createWorker.mock.results.at(-1).value;controller.abort();await aborted;
 worker.onerror(error);expect(error.preventDefault).toHaveBeenCalledTimes(2);expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test('table priority is released on successful, failed, aborted and unstartable workers',async()=>{
 const {isForegroundStorageBusy}=require('../../lib/foregroundStoragePriority');
 const job=requestHazardRows(run('priority'),{operation:'layout'});
 expect(isForegroundStorageBusy()).toBe(true);await job;expect(isForegroundStorageBusy()).toBe(false);
 createWorker.mockImplementation(()=>{throw Error('Unavailable worker');});
 await expect(requestHazardRows(run('bootstrap'),{})).rejects.toThrow('Unavailable');expect(isForegroundStorageBusy()).toBe(false);
 createWorker.mockImplementation(()=>({terminate:jest.fn(),postMessage:jest.fn()}));
 const controller=new AbortController(),pending=requestHazardRows(run('priority-abort'),{signal:controller.signal});
 const rejected=expect(pending).rejects.toHaveProperty('name','AbortError');controller.abort();await rejected;expect(isForegroundStorageBusy()).toBe(false);
 const failed=requestHazardRows(run('priority-error'),{}),error=expect(failed).rejects.toThrow('Read failed');
 createWorker.mock.results.at(-1).value.onerror({message:'Read failed'});await error;expect(isForegroundStorageBusy()).toBe(false);
});
