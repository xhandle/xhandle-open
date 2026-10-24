import {preferredHazardFailure,canDeferHazardFailure,canCompleteHazardWithAssumptions} from './hazardDeferredFailures';

test('priority preserves original error identity and cause in both arrival orders',()=>{
 const cause=new Error('Missing saved data');
 const errors=[
  new Error('Budget exhausted'),
  new ReferenceError('Programming failure'),
  Object.freeze(Object.assign(new Error('Storage unavailable'),{code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE',cause})),
  Object.freeze(new DOMException('Cancelled','AbortError')),
 ];
 for(let low=0;low<errors.length;low++)for(let high=low+1;high<errors.length;high++){
  expect(preferredHazardFailure(errors[low],errors[high])).toBe(errors[high]);
  expect(preferredHazardFailure(errors[high],errors[low])).toBe(errors[high]);
 }
 expect(errors[2].cause).toBe(cause);
 expect(canDeferHazardFailure(errors[2])).toBe(false);
 expect(preferredHazardFailure(undefined,errors[2])).toBe(errors[2]);
 expect(preferredHazardFailure(errors[0],new Error('Later failure'))).toBe(errors[0]);
});


test.each([401,402,403,404,429])('provider status %s remains fallback eligible but never outranks programming failures',status=>{
 const providers=[Object.assign(new Error('Denied'),{status}),Object.assign(new Error('Denied'),{response:{status}}),new Error(`LLM proxy error (${status}): denied`)];
 for(const provider of providers){
  expect(canCompleteHazardWithAssumptions(provider)).toBe(true);
  expect(canCompleteHazardWithAssumptions(provider,{aborted:true})).toBe(false);
  for(const ErrorType of [ReferenceError,RangeError,TypeError]){
   const fatal=Object.assign(new ErrorType('Missing dependency'),{status});
   expect(canCompleteHazardWithAssumptions(fatal)).toBe(false);
   expect(preferredHazardFailure(provider,fatal)).toBe(fatal);
   expect(preferredHazardFailure(fatal,provider)).toBe(fatal);
  }
 }
});

test('storage and cancellation remain fatal even with provider-status metadata',()=>{
 for(const error of [Object.assign(new Error('Missing evidence'),{code:'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE',status:403}),Object.assign(new DOMException('Stopped','AbortError'),{status:403})]){
  expect(canCompleteHazardWithAssumptions(error)).toBe(false);
 }
});
