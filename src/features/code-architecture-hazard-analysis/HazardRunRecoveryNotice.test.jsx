import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
let container,root;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();});
const render=node=>act(()=>root.render(node));
const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
import HazardRunRecoveryNotice from './HazardRunRecoveryNotice';
jest.mock('./CodeArchitectureHazardSummaryTable',()=>()=> <div>Validated partial table</div>);
const partial={id:'partial',runState:'incomplete',validatedAssessments:6,totalAssessments:7,
  generatedSheets:{Summary:[['Function'],['Control']]},failureMessage:'Validation failed',
  failedAssessments:[{id:'HA-1',action:'Analyze source',phrase:'Too late',reasons:['Missing verification']}]};
test('failure remains visible with previous completed results and partial export',()=>{
  const onExport=jest.fn();
  render(<HazardRunRecoveryNotice run={{id:'complete',repoName:'test',pendingAttempt:partial}} onExport={onExport} />);
  expect(container.querySelector('[role=alert]').textContent).toContain('6 of 7');
  expect(container.textContent).toContain('previous completed analysis');
  expect(container.textContent).toContain('HA-1 — Analyze source — Too late: Missing verification');
  act(()=>button('Export validated partial results').click());
  expect(onExport).toHaveBeenCalledWith(partial.generatedSheets.Summary,'test-incomplete');
});
test('unsaved recovery offers retry-save and reports errors without hiding results',async()=>{
  const run={...partial,finalSavePending:true},onRetrySave=jest.fn().mockRejectedValue(new Error('Storage unavailable'));
  render(<HazardRunRecoveryNotice run={run} onExport={jest.fn()} onRetrySave={onRetrySave} />);
  await act(async()=>{button('Retry save').click();});
  expect(container.textContent).toContain('Storage unavailable');
  expect(onRetrySave).toHaveBeenCalledWith(run);
  expect(button('Export validated partial results')).toBeTruthy();
});
