import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {useArtifactReview} from './useArtifactReview';
import {ARTIFACT_DEFINITIONS,ARTIFACT_KINDS} from './artifactDefinitions';
import {normalizeReviewItem} from '../results-review/reviewUtils';
let mockReview;
jest.mock('../results-review/ResultsReviewProvider',()=>({useResultsReview:()=>mockReview}));
jest.mock('../results-review/reviewUtils',()=>({...jest.requireActual('../results-review/reviewUtils'),normalizeReviewItem:jest.fn(jest.requireActual('../results-review/reviewUtils').normalizeReviewItem)}));
global.IS_REACT_ACT_ENVIRONMENT=true;
const definition=ARTIFACT_DEFINITIONS[ARTIFACT_KINDS.SYSTEM];
const rows=Array.from({length:120},(_,i)=>({id:`R-${i}`}));
function Probe({setRows}) {useArtifactReview({rows,columns:definition.columns,definition,projectId:'p',repoId:'r',setRows});return null;}
it('normalizes only each registration batch despite review-context updates and ignores other scopes',async()=>{
 jest.useFakeTimers();normalizeReviewItem.mockClear();normalizeReviewItem.mockImplementation(jest.requireActual('../results-review/reviewUtils').normalizeReviewItem);
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);const setRows=jest.fn();
 const createReviewItems=jest.fn(async batch=>{mockReview={...mockReview,reviewItems:[...mockReview.reviewItems,...batch]};});
 mockReview={reviewItems:[],createReviewItems};
 try {
  act(()=>root.render(<Probe setRows={setRows}/>));expect(normalizeReviewItem).not.toHaveBeenCalled();
  await act(async()=>jest.advanceTimersToNextTimer());expect(normalizeReviewItem).toHaveBeenCalledTimes(50);
  act(()=>root.render(<Probe setRows={setRows}/>));
  await act(async()=>jest.advanceTimersToNextTimer());expect(normalizeReviewItem).toHaveBeenCalledTimes(100);
  act(()=>root.render(<Probe setRows={setRows}/>));
  await act(async()=>jest.advanceTimersToNextTimer());expect(normalizeReviewItem).toHaveBeenCalledTimes(120);
  act(()=>root.render(<Probe setRows={setRows}/>));
  await act(async()=>jest.runAllTimers());expect(createReviewItems).toHaveBeenCalledTimes(3);
  const foreign={...mockReview.reviewItems[0],artifactId:'code-architecture-system-requirements:other:r:row:R-0'};
  act(()=>window.dispatchEvent(new CustomEvent('xhandle:results-review:item-updated',{detail:{reviewItem:foreign}})));
  expect(setRows).not.toHaveBeenCalled();
 } finally {act(()=>root.unmount());host.remove();jest.useRealTimers();}
});
it('does not register over an existing reviewed row',async()=>{
 jest.useFakeTimers();normalizeReviewItem.mockImplementation(jest.requireActual('../results-review/reviewUtils').normalizeReviewItem);
 const {createReviewId}=jest.requireActual('../results-review/reviewUtils');
 const artifactIdRoot=`code-architecture-${definition.key}:p:r`;
 const id=createReviewId(`${definition.artifactType}:p:r`,definition.artifactType,artifactIdRoot,'row','R-0');
 const reviewed={id,artifactId:`${artifactIdRoot}:row:R-0`,artifactType:definition.artifactType,status:'approved',traceLinks:[]};
 mockReview={reviewItems:[reviewed],createReviewItems:jest.fn(async()=>[])};
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try {
  act(()=>root.render(<Probe setRows={()=>{}}/>));
  for(let i=0;i<3;i++) await act(async()=>jest.advanceTimersToNextTimer());
  expect(mockReview.createReviewItems.mock.calls.flatMap(call=>call[0])).toHaveLength(119);
  expect(mockReview.createReviewItems.mock.calls.flatMap(call=>call[0]).some(item=>item.id===id)).toBe(false);
  expect(reviewed.status).toBe('approved');
 } finally {act(()=>root.unmount());host.remove();jest.useRealTimers();}
});
