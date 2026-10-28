// Regression: superseded reads must retire before another is started.
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import useHazardRunRestoration from './useHazardRunRestoration';
import {createHazardRunRegistry} from './hazardRunRegistry';
global.IS_REACT_ACT_ENVIRONMENT=true;
test('retries cancel and wait for the old read to retire',async()=>{
 const root=createRoot(document.createElement('div'));let api;
 let resolveOld;
 const read=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue(null);
 const options={projectId:'p',connectionId:'c',repoId:'r',read,registry:{current:createHazardRunRegistry()},pendingContextSave:{current:null},contextVersion:{current:0},getCurrentRun:()=>null,publish:jest.fn()};
 function Harness(){api=useHazardRunRestoration(options);return null;}
 try{
  await act(async()=>root.render(<Harness/>));
  await act(async()=>api.retry());await act(async()=>api.retry());
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async()=>resolveOld(null));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1][1].signal.aborted).toBe(false);
 }finally{await act(async()=>root.unmount());}
});
