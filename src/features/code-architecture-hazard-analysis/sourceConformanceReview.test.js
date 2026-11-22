import {enforceSourceConformance} from './sourceConformanceReview';
const sources=Object.freeze([Object.freeze({id:'A',action:'Inhibit heater'}),Object.freeze({id:'B',action:'Hold isolation'}),Object.freeze({id:'C',action:'Read status'})]);
const context={sourceBehaviorEvidence:[{fact:'A retained trip keeps isolation asserted.',quote:'return state.trip_latched',filePath:'thermal.py'}]};
const makeCache=()=>{const values=new Map();return {readMany:async bases=>bases.map(basis=>values.get(JSON.stringify(basis))),write:async(basis,value)=>values.set(JSON.stringify(basis),value)};};
const makeResults=()=>new Map([['A',{id:'A',applicable:'Yes',verification:'Verify inhibited output.'}],['B',{id:'B',applicable:'Yes',verification:'Expect release on retained trip.'}],['C',{id:'C',applicable:'No'}]]);
test('corrects only failed generated results, preserves source/exclusions, and rechecks before publication',async()=>{
  const results=makeResults(),checkpoint=makeCache(),before=JSON.stringify(sources),a=results.get('A'),excluded=results.get('C');
  const review=jest.fn(async entries=>Object.fromEntries(entries.map(({source,assessment})=>[source.id,assessment.verification.includes('Expect release')?['Expected release contradicts retained trip.']:[]])));
  const correct=jest.fn(async entries=>{expect(entries.map(entry=>entry.source.id)).toEqual(['B']);results.set('B',{...entries[0].assessment,verification:'Verify isolation remains asserted while trip is latched.'});});
  await enforceSourceConformance({method:'STPA',sources,context,results,checkpoint,review,correct});
  expect(review.mock.calls[0][1].sourceConformanceOnly).toBe(true);
  expect(context.sourceConformanceOnly).toBeUndefined();
  expect(review.mock.calls.map(([entries])=>entries.map(entry=>entry.source.id))).toEqual([['A','B'],['B']]);
  expect(results.get('A')).toBe(a);expect(results.get('C')).toBe(excluded);expect(JSON.stringify(sources)).toBe(before);
  await enforceSourceConformance({method:'STPA',sources,context,results,checkpoint,review,correct});
  expect(review).toHaveBeenCalledTimes(2);expect(correct).toHaveBeenCalledTimes(1);
});
test('an unavailable consistency review never authorizes publication',async()=>{
  await expect(enforceSourceConformance({method:'STPA',sources,context,results:makeResults(),checkpoint:makeCache(),review:async()=>({}),correct:jest.fn()})).rejects.toMatchObject({sourceConformanceFindings:[{id:'A',issues:['Source conformance review unavailable.']}]});
});
test('unchanged failed correction remains incomplete; it is not rerolled until accepted',async()=>{
  await expect(enforceSourceConformance({method:'STPA',sources,context,results:makeResults(),checkpoint:makeCache(),review:async entries=>Object.fromEntries(entries.map(({source})=>[source.id,['Concrete source contradiction.']])),correct:async()=>{}})).rejects.toMatchObject({sourceConformanceFindings:[{id:'A',issues:['Concrete source contradiction.']},{id:'B',issues:['Concrete source contradiction.']}]});
});
test.each(['HARA','FHA'])('preserves the existing %s path',async method=>{
  const review=jest.fn();await enforceSourceConformance({method,sources,context,results:makeResults(),review});expect(review).not.toHaveBeenCalled();
});
test('shared requirement contracts are output evidence and invalidate sibling review caches when corrected',async()=>{
  const results=makeResults(),checkpoint=makeCache(),before=JSON.stringify(context);
  results.set('A',{...results.get('A'),softwareRequirement:'The software shall retain isolation while the trip is latched.'});
  results.set('B',{...results.get('B'),softwareRequirement:'The software shall clear isolation while the trip is latched.'});
  const review=jest.fn(async(entries,reviewContext)=>{
    expect(reviewContext.generatedRequirementContracts).toHaveLength(2);
    return Object.fromEntries(entries.map(({source})=>[source.id,source.id==='B' && reviewContext.generatedRequirementContracts.find(row=>row.id==='B').softwareRequirement.includes('clear')?['B conflicts with A retained-isolation contract.']:[]]));
  });
  const correct=jest.fn(async(entries,reviewContext)=>{
    expect(entries.map(entry=>entry.source.id)).toEqual(['B']);
    expect(reviewContext.generatedRequirementContracts.find(row=>row.id==='A').softwareRequirement).toContain('retain isolation');
    results.set('B',{...results.get('B'),softwareRequirement:'The software shall retain isolation while the trip is latched.'});
  });
  await enforceSourceConformance({method:'STPA',sources,context,results,checkpoint,review,correct});
  expect(review.mock.calls.map(([entries])=>entries.map(entry=>entry.source.id))).toEqual([['A','B'],['A','B']]);
  expect(JSON.stringify(context)).toBe(before);
});
test('a dependency-propagated sibling issue receives a third correction and still needs a clean final review',async()=>{
 const related=[{id:'A',action:'Retain isolation'},{id:'B',action:'Retain isolation'}];
 const results=new Map(related.map(source=>[source.id,{id:source.id,applicable:'Yes',uca:'Initial case '+source.id}]));
 let phase=0;
 const review=jest.fn(async entries=>Object.fromEntries(entries.map(({source})=>[source.id,phase<3 && source.id===(phase===1?'B':'A')?['Conflicting related-case condition.']:[]])));
 const correct=jest.fn(async entries=>{phase++;for(const {source} of entries)results.set(source.id,{...results.get(source.id),uca:'Corrected related condition '+phase});});
 await enforceSourceConformance({method:'STPA',sources:related,context,results,checkpoint:makeCache(),review,correct});
 expect(correct).toHaveBeenCalledTimes(3);expect(review).toHaveBeenCalledTimes(4);expect(phase).toBe(3);
});
