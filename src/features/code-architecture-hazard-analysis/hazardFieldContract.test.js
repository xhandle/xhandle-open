import {usableHazardInputs} from './hazardCompletionSupport';
import {assumptionHazardFallback} from './assumptionHazardFallback';
import {validateFastAssessment} from './fastHazardSchema';
import {isAcceptedApplicabilityDecision} from './hazardFieldContract';
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Reviewed timing condition'};
const cases=['Unknown: allocation absent','Unresolved: allocation absent','Pending: allocation absent','N/A: allocation absent','Not generated: allocation absent','Not applicable','Allocation to be confirmed','TBD','TBC','TODO'];
test.each(cases)('unresolved imported narrative %s cannot block method fallback',value=>{
 for(const [method,header] of [['HARA','Rating Rationale'],['FHA','Severity Rationale'],['FHA','Software Control Category Rationale']]){
  const {usable,retained}=usableHazardInputs({[header]:value},method);
  expect(usable[header]).toBeUndefined();expect(retained[header]).toBe(value);
  const result=assumptionHazardFallback(method,{...source,reviewedValues:{[header]:value}});
  expect(validateFastAssessment(method,result,source)).toEqual([]);
  expect(result.retainedUserInputs[header]).toBe(value);
 }
});
test('valid imported narrative remains a constraint',()=>{
 const value='Autonomous control of the actuator.';
 expect(usableHazardInputs({'Software Control Category Rationale':value},'FHA')).toEqual({usable:{'Software Control Category Rationale':value},retained:{}});
});
test('locked rationale does not exempt unrelated unresolved fields or changed applicability',()=>{
 const result=assumptionHazardFallback('STPA',source);
 expect(validateFastAssessment('STPA',{...result,assumptions:'Unknown: missing context'},source).length).toBeGreaterThan(0);
 expect(validateFastAssessment('STPA',{...result,applicable:'No'},source).length).toBeGreaterThan(0);
 expect(isAcceptedApplicabilityDecision({applicable:'Yes',rationale:'Needs review'})).toBe(false);
 expect(isAcceptedApplicabilityDecision({applicable:'Yes',rationale:'Command',needsEvidence:true})).toBe(false);
});

test.each([
 ['HARA','Severity',' S3 ','S3'],['HARA','Exposure','\tE4\n','E4'],['HARA','Controllability',' C3 ','C3'],
 ['FHA','Severity Category',' III ','III'],['FHA','Severity',' IV ','IV'],['FHA','Software Control Category',3,'3'],
 ['FHA','Software Control Category',' 1 ','1'],['STPA','Guide Phrase Applicable',' No ','No'],
 ['STPA','Safety Classification',' Mission/Reliability ','Mission/Reliability'],['STPA','Safety Significant',' No ','No'],
])('%s canonicalizes %s without changing its meaning or losing its original', (method,header,original,canonical)=>{
 const input={[header]:original};const {usable,retained}=usableHazardInputs(input,method);
 expect(usable).toEqual({[header]:canonical});expect(retained).toEqual(input);
 expect(input[header]).toBe(original);
 expect(usableHazardInputs(usable,method)).toEqual({usable,retained:{}});
});
