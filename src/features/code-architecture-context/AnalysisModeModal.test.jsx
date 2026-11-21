import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AnalysisModeModal from './AnalysisModeModal';
let host, root;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
test('offers explicit Replace, Append and Cancel, traps focus and supports Escape',()=>{
 const choose=jest.fn();act(()=>root.render(<AnalysisModeModal selection={{extensions:['.c','.js']}} onChoose={choose}/>));
 const dialog=host.querySelector('[role=dialog]');expect(dialog.textContent).toContain('.c, .js');
 const buttons=dialog.querySelectorAll('button');expect(document.activeElement).toBe(buttons[0]);
 act(()=>buttons[1].click());expect(choose).toHaveBeenLastCalledWith('replace');
 act(()=>buttons[2].click());expect(choose).toHaveBeenLastCalledWith('append');
 act(()=>buttons[0].click());expect(choose).toHaveBeenLastCalledWith(null);
 buttons[2].focus();act(()=>buttons[2].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe(buttons[0]);
 act(()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(choose).toHaveBeenLastCalledWith(null);
});
