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
