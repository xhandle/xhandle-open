import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import HazardNarrativeReview from './HazardNarrativeReview';
import {compactReviewEntries,reviewFastHazards} from './fastHazardSemanticReview';
jest.mock('./fastHazardSemanticReview',()=>({...jest.requireActual('./fastHazardSemanticReview'),reviewFastHazards:jest.fn()}));
let container,root;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();});
const run=()=>({id:'one',runState:'complete',hazardMethod:'STPA',generatedSheets:{Summary:[['Guide Phrase Applicable'],['Yes']]},narrativeReviewInput:compactReviewEntries([{source:{id:'a',action:'Apply torque'},assessment:{id:'a',applicable:'Yes',uca:'Example'}}]),narrativeReviewContext:{}});
test('review starts only on request and findings never overwrite published results',async()=>{
 const snapshot=run(),before=JSON.stringify(snapshot),onUpdate=jest.fn();reviewFastHazards.mockResolvedValue({a:['Check the causal premise.']});
 act(()=>root.render(<HazardNarrativeReview run={snapshot} onUpdate={onUpdate}/>));
 expect(reviewFastHazards).not.toHaveBeenCalled();
 await act(async()=>{container.querySelector('button').click();});
 expect(container.textContent).toContain('Check the causal premise.');expect(JSON.stringify(snapshot)).toBe(before);
 expect(onUpdate).toHaveBeenCalledWith(snapshot,expect.objectContaining({findings:{a:['Check the causal premise.']}}));
});
test('review provider failure leaves generated rows intact',async()=>{
 const snapshot=run(),before=JSON.stringify(snapshot),onUpdate=jest.fn();reviewFastHazards.mockRejectedValue(new Error('Unavailable'));
 act(()=>root.render(<HazardNarrativeReview run={snapshot} onUpdate={onUpdate}/>));await act(async()=>{container.querySelector('button').click();});
 expect(container.textContent).toContain('Generated results are unchanged');expect(JSON.stringify(snapshot)).toBe(before);expect(onUpdate).not.toHaveBeenCalled();
});
