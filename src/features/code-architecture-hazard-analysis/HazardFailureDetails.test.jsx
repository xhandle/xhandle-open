import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import HazardFailureDetails from './HazardFailureDetails';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
let host,root;
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;requestHazardRows.mockReset();
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async props=>{await act(async()=>root.render(<HazardFailureDetails {...props}/>));};
const toggle=async open=>{await act(async()=>{const details=host.querySelector('details');details.open=open;details.dispatchEvent(new Event('toggle'));});};
const saved={id:'synthetic-run',[PAGED_HAZARD]:{revision:'first',generation:'synthetic'}};
const failures=[{id:'SYN-2',action:'Apply command',phrase:'Too late',reasons:['Missing verification']}];
test('local row reasons and absent-reason guidance are visible without storage reads',async()=>{
 await render({run:{failureMessage:'Incomplete',failedAssessments:failures}});await toggle(true);
 expect(host.textContent).toContain('SYN-2 — Apply command — Too late: Missing verification');
 expect(requestHazardRows).not.toHaveBeenCalled();
 await render({run:{failureMessage:'Incomplete',failedAssessments:[]}});
 expect(host.textContent).toContain('No row-specific failure reasons were saved.');
});
test.each([false,true])('paged reasons load only when opened and use the correct attempt (partial: %s)',async partial=>{
 requestHazardRows.mockResolvedValue({value:failures});
 await render({run:saved,partial,attempt:{failureMessage:'Incomplete'}});
 expect(requestHazardRows).not.toHaveBeenCalled();await toggle(true);
 expect(requestHazardRows).toHaveBeenCalledWith(saved,expect.objectContaining({operation:'detail',field:'failedAssessments',partial}));
 expect(host.textContent).toContain('Missing verification');
});
test('read failures remain visible and can be retried',async()=>{
 requestHazardRows.mockRejectedValueOnce(Error('Saved results changed')).mockResolvedValueOnce({value:failures});
 await render({run:saved});await toggle(true);
 expect(host.querySelector('[role=alert]').textContent).toContain('Saved results changed');
 await act(async()=>host.querySelector('button').click());
 expect(host.textContent).toContain('Missing verification');expect(host.querySelector('[role=alert]')).toBeNull();
});
test('switching saved revisions aborts the old read and never displays its late reasons',async()=>{
 const pending=[];requestHazardRows.mockImplementation((run,options)=>new Promise(resolve=>pending.push({run,options,resolve})));
 await render({run:saved});await toggle(true);
 expect(host.textContent).toContain('Loading unfinished assessment details');
 const next={...saved,[PAGED_HAZARD]:{...saved[PAGED_HAZARD],revision:'second'}};
 await render({run:next});expect(pending[0].options.signal.aborted).toBe(true);
 await act(async()=>pending[0].resolve({value:failures}));expect(host.textContent).not.toContain('Missing verification');
 await act(async()=>pending[1].resolve({value:[]}));expect(host.textContent).toContain('No row-specific failure reasons were saved');
});
