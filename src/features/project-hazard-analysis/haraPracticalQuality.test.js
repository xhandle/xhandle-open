import { completeProjectHaraAssessment } from './haraCompletionPolicy';
import { practicalHaraDecisionIssues } from './haraPracticalQuality';
import { unsafeBrakingGate } from './haraAssessmentQuality';
import { refreshProjectHaraSheets, PROJECT_HARA_HEADERS } from './projectHara';

const input={id:'event-1',evidence:{'Control Action':'Brake request','Function (From)':'Motion controller','Function (To)':'Brake actuator',
  Hazard:'Unintended braking','Operational Scenario':'Curb-side pickup','Operating Conditions':'Pedestrians nearby'}};
const gate='The brake controller shall not issue a braking command until the vehicle is within 1 m of the target stop and an operator command is current.';

test('unsafe inherited braking gates are adapted only in the HARA draft while the source is preserved',()=>{
  const source={...input,evidence:{...input.evidence,'System Requirement':gate}},before=JSON.stringify(source);
  const result=completeProjectHaraAssessment({safetyGoal:gate,safeState:gate,functionalSafetyRequirements:gate},source);
  expect(JSON.stringify(source)).toBe(before);
  expect(result.functionalSafetyRequirements).toContain('preserve emergency braking');
  expect(result.functionalSafetyRequirements).not.toContain('shall not issue');
  expect(result.safeState).toContain('controllable deceleration');
  expect(result.safetyGoal).toBe('The vehicle shall prevent unintended braking while preserving emergency stopping capability.');
  expect(practicalHaraDecisionIssues(result)).toEqual([]);
});
test.each([
  'The vehicle shall inhibit non-emergency planned braking until the target stop is reached.',
  'The vehicle shall stop when an obstacle is detected.',
  'The vehicle shall not issue a planned-stop braking command until the position is valid.',
  'Emergency braking overrides all gates and remains available.',
])('preserves legitimate braking and planned-stop constraints: %s',text=>{
  expect(unsafeBrakingGate(text)).toBe(false);
  expect(completeProjectHaraAssessment({functionalSafetyRequirements:text},input).functionalSafetyRequirements).toBe(text);
});
test('failure-conditioned exposure is replaced with an operating-frequency assumption and a coherent class',()=>{
  const result=completeProjectHaraAssessment({exposure:'E2',exposureRationale:'E2 because command delivery failures occur infrequently.'},input);
  expect(result.exposure).toBe('E3');expect(result.exposureRationale).toContain('Assume Curb-side pickup occurs regularly');
  expect(practicalHaraDecisionIssues(result)).toEqual([]);
  const valid='Over intended service, extended maintenance occupies less than one percent of operating time.';
  expect(completeProjectHaraAssessment({exposure:'E2',exposureRationale:valid},input)).toMatchObject({exposure:'E2',exposureRationale:valid});
});
test('circular freshness FTTI becomes a fault-to-hazard bound with the old number retained only as candidate timing',()=>{
  const result=completeProjectHaraAssessment({ftti:'3 seconds',fttiRationale:'FTTI is based on the 3-second freshness window.'},input);
  expect(result.ftti).toContain('t_hazard');expect(result.fttiRationale).toContain('relative closing speed');expect(result.candidateTiming).toBe('3 seconds');
  const valid={ftti:'1 second',fttiRationale:'Fault occurrence can cause collision after 1 second at 2 m clearance and 2 m/s closing speed; detection plus braking must complete earlier.'};
  expect(completeProjectHaraAssessment(valid,input)).toMatchObject(valid);
});
test('mechanisms remain linked requirements while the completed goal names a shared hazardous state',()=>{
  const mechanism='The controller shall validate each timestamp and reject commands with stale data.';
  const result=completeProjectHaraAssessment({safetyGoal:mechanism,functionalSafetyRequirements:'The vehicle shall stop before contact.'},input);
  expect(result.safetyGoal).toContain('Unintended braking');expect(result.safetyGoal).not.toContain('timestamp');
  expect(result.functionalSafetyRequirements).toContain(mechanism);
});
test('practical display/export preserves completion policy without modifying decisions or resurrecting strict findings',()=>{
  const headers=[...new Set([...PROJECT_HARA_HEADERS,'Operational Scenario','Raw Analysis Row ID'])];
  const row=(id,exposure)=>headers.map(h=>({'Raw Analysis Row ID':id,'Guide Phrase Applicable':'Yes',Severity:'S3',Exposure:exposure,Controllability:'C3','Operational Scenario':'Urban service','Safety Goal':'The vehicle shall prevent unintended movement.','Assessment Status':'Inconsistent exposure','HARA Review Findings':'EXPOSURE_CONFLICT: old warning'}[h]||''));
  const original={Summary:[headers,row('a','E2'),row('b','E3')]},before=JSON.stringify(original);
  const display=refreshProjectHaraSheets(original,{practical:true}),exported=refreshProjectHaraSheets(display);
  expect(JSON.stringify(original)).toBe(before);
  expect(exported.haraCompletionPolicy).toBe('projects-hara-practical-v1');
  for(const r of exported.Summary.slice(1)){
    expect(r[headers.indexOf('Assessment Status')]).toBe('Complete');expect(r[headers.indexOf('HARA Review Findings')]).toBe('');
  }
  expect(exported.Summary.slice(1).map(r=>r[headers.indexOf('Exposure')])).toEqual(['E2','E3']);
  expect(exported.Summary.slice(1).map(r=>r[headers.indexOf('ASIL')])).toEqual(['ASIL B','ASIL C']);
  expect(exported['Safety Goals'][1][2]).toBe('ASIL C');
});
