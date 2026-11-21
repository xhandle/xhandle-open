import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import useHazardDraft from './useHazardDraft';
import createWorker from './createHazardDraftWorker';
jest.mock('./createHazardDraftWorker',()=>jest.fn());
global.IS_REACT_ACT_ENVIRONMENT=true;
test('worker prepares asynchronously, reuses one cached revision, and ignores obsolete responses',()=>{
 const workers=[];createWorker.mockImplementation(()=>{const w={postMessage:jest.fn(),terminate:jest.fn()};workers.push(w);return w;});
 const host=document.createElement('div'),root=createRoot(host);let result;
 function Probe({enabled,input}){result=useHazardDraft(enabled,input);return <p>{result.loading?'Loading':result.run?.id||result.error||'Idle'}</p>;}
 const one={options:{projectId:'one'},headers:[]},two={options:{projectId:'two'},headers:[]};
 const render=(enabled,input)=>act(()=>root.render(<Probe enabled={enabled} input={input}/>));
 try{
  render(false,one);expect(workers).toHaveLength(0);
  render(true,one);expect(host.textContent).toBe('Loading');expect(workers[0].postMessage).toHaveBeenCalledWith(one);
  expect(result.progress).toBe(0);
  act(()=>workers[0].onmessage({data:{type:'progress',progress:42}}));expect(result.progress).toBe(42);expect(result.run).toBeNull();expect(workers[0].terminate).not.toHaveBeenCalled();
  act(()=>workers[0].onmessage({data:{type:'progress',progress:20}}));expect(result.progress).toBe(42);
  act(()=>workers[0].onmessage({data:{run:{id:'draft-one'}}}));expect(result.progress).toBe(100);expect(result.run.id).toBe('draft-one');
  render(false,one);render(true,one);expect(workers).toHaveLength(1);expect(result.run.id).toBe('draft-one');
  render(true,two);expect(result.run).toBeNull();expect(workers).toHaveLength(2);
  render(false,two);act(()=>workers[1].onmessage({data:{run:{id:'stale'}}}));render(true,two);expect(result.run).toBeNull();expect(workers).toHaveLength(3);
  act(()=>workers[2].onmessage({data:{error:'preparation failed'}}));expect(result.error).toBe('preparation failed');
  act(()=>result.retry());expect(workers).toHaveLength(4);
 }finally{act(()=>root.unmount());}
});

test('failed worker script loads stay retryable and never escape as global runtime errors',()=>{
 const workers=[];createWorker.mockImplementation(()=>{const worker={postMessage:jest.fn(),terminate:jest.fn()};workers.push(worker);return worker;});
 const host=document.createElement('div'),root=createRoot(host);let result;
 const input={options:{projectId:'worker-network-failure'},headers:[]};
 function Probe(){result=useHazardDraft(true,input);return <p>{result.loading?'Loading':result.error||result.run?.id}</p>;}
 const error=()=>new ErrorEvent('error',{cancelable:true,message:"Failed to execute 'importScripts': worker chunk failed to load."});
 try{
  act(()=>root.render(<Probe/>));
  act(()=>workers[0].onmessage({data:{type:'progress',progress:30}}));
  const activeError=error();act(()=>workers[0].onerror(activeError));
  expect(activeError.defaultPrevented).toBe(true);
  expect(result.loading).toBe(false);expect(result.run).toBeNull();
  expect(host.textContent).toContain('worker chunk failed to load');
  expect(workers[0].terminate).toHaveBeenCalled();
  // An already queued response cannot replace the failure with stale success.
  act(()=>workers[0].onmessage({data:{run:{id:'stale'}}}));
  expect(result.run).toBeNull();
  act(()=>result.retry());expect(workers).toHaveLength(2);expect(result.loading).toBe(true);
  const lateError=error();act(()=>workers[0].onerror(lateError));
  expect(lateError.defaultPrevented).toBe(true);expect(result.error).toBeUndefined();
  act(()=>workers[1].onmessage({data:{run:{id:'recovered'}}}));
  expect(result.run.id).toBe('recovered');expect(result.loading).toBe(false);
  const afterSuccess=error();act(()=>workers[1].onerror(afterSuccess));
  expect(afterSuccess.defaultPrevented).toBe(true);expect(result.run.id).toBe('recovered');
  act(()=>root.unmount());
  const afterUnmount=error();workers[1].onerror(afterUnmount);
  expect(afterUnmount.defaultPrevented).toBe(true);
 }finally{if(host.querySelector('p'))act(()=>root.unmount());}
});

test('worker startup failures expose a retry instead of leaving preparation running',()=>{
 createWorker.mockImplementationOnce(()=>{throw Error('Worker unavailable');}).mockImplementation(()=>({postMessage:jest.fn(),terminate:jest.fn()}));
 const host=document.createElement('div'),root=createRoot(host);let result;
 const input={options:{projectId:'worker-start-failure'},headers:[]};
 function Probe(){result=useHazardDraft(true,input);return null;}
 try{
  act(()=>root.render(<Probe/>));expect(result.loading).toBe(false);expect(result.error).toBe('Worker unavailable');
  act(()=>result.retry());expect(result.loading).toBe(true);expect(result.error).toBeUndefined();
 }finally{act(()=>root.unmount());}
});
