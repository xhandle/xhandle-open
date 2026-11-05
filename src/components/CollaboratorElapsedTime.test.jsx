import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import CollaboratorElapsedTime from './CollaboratorElapsedTime';
global.IS_REACT_ACT_ENVIRONMENT=true;

test('elapsed clock updates without rerendering its parent and releases its timer',()=>{
 jest.useFakeTimers();jest.setSystemTime(100000);
 const host=document.createElement('div'),root=createRoot(host);let renders=0;
 function Parent(){renders++;return <CollaboratorElapsedTime startedAt={100000}/>;}
 try{
  act(()=>root.render(<Parent/>));expect(host.textContent).toBe('0s elapsed');
  act(()=>jest.advanceTimersByTime(65000));expect(host.textContent).toBe('1m 5s elapsed');expect(renders).toBe(1);
  act(()=>root.unmount());expect(jest.getTimerCount()).toBe(0);
 }finally{jest.useRealTimers();}
});
