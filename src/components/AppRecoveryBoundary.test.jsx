import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import AppRecoveryBoundary from './AppRecoveryBoundary';
global.IS_REACT_ACT_ENVIRONMENT=true;
test('render failure shows recovery UI and can retry without reloading or clearing storage',()=>{
 const host=document.createElement('div'),root=createRoot(host),log=jest.spyOn(console,'error').mockImplementation(()=>{});
 localStorage.setItem('recovery-sentinel','saved');let fail=true;
 const View=()=>{if(fail)throw new Error('render failed');return <p>Workspace</p>;};
 try{
  act(()=>root.render(<AppRecoveryBoundary><View /></AppRecoveryBoundary>));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(localStorage.getItem('recovery-sentinel')).toBe('saved');
  fail=false;act(()=>host.querySelector('button').click());expect(host.textContent).toBe('Workspace');
 }finally{act(()=>root.unmount());log.mockRestore();localStorage.removeItem('recovery-sentinel');}
});
