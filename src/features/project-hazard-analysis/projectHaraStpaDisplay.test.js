import { annotateProjectStpaFoundation, projectHaraStpaDisplayRows, reusableProjectStpaRows } from './projectStpaFoundation';

const source = {fromFunction:'Controller',controlAction:'Brake demand',toFunction:'Actuator',guidePhrase:'Not provided',
  hazardContextId:'crossing',operationalScenario:'Crossing',operationalMode:'Driving',operatingConditions:'Wet pavement'};
const options = {stpaProfileProvenance:{effectiveContextIdentity:'synthetic-profile'}};
const headers = ['Function (From)','Control Action','Function (To)','Guide Phrase','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Losses','Hazards','Safety Requirements/Constraints','Raw Analysis Row ID'];
const stpa = annotateProjectStpaFoundation({Summary:[headers,['Controller','Brake demand','Actuator','Not provided','crossing','Crossing','Driving','Wet pavement','Injury','Failure to stop','The vehicle shall stop.','stpa-1']]},[source],options);
const target = ['Loss','Hazard','Safety Constraint','Severity','ASIL','Assessment Status','Safety Goal','Hazardous Event ID','Raw Analysis Row ID','STPA Source Row ID'];
const fallback = ['','','','','','','','','hara-1',''];
test('shows common STPA results immediately without assigning HARA outputs or changing its row identity',()=>{
  expect(projectHaraStpaDisplayRows({analysisResult:stpa},[source],target,[fallback],options)).toEqual([
    ['Injury','Failure to stop','The vehicle shall stop.','','','','','','hara-1','stpa-1'],
  ]);
  expect(stpa.Summary[0]).toContain('Losses');
  expect(fallback).toEqual(['','','','','','','','','hara-1','']);
});
test('matching source/context remains displayed after policy edits; partial foundations leave missing rows blank',()=>{
  for (const change of [{hazardContextId:'parking'},{operatingConditions:'Ice'},{controlAction:'Steering demand'}]) {
    expect(projectHaraStpaDisplayRows({analysisResult:stpa},[{...source,...change}],target,[fallback],options)).toEqual([null]);
  }
  expect(projectHaraStpaDisplayRows({analysisResult:stpa},[source],target,[fallback],{stpaProfileProvenance:{effectiveContextIdentity:'changed'}})).toEqual(
    projectHaraStpaDisplayRows({analysisResult:stpa},[source],target,[fallback],options));
  expect(projectHaraStpaDisplayRows({analysisResult:stpa},[source,{...source,controlAction:'Other'}],target,[fallback,fallback],options)[1]).toBeNull();
});
test('no STPA or ambiguous duplicate rows produce no inherited results',()=>{
  expect(projectHaraStpaDisplayRows(null,[source],target,[fallback],options)).toEqual([null]);
  const duplicate={...stpa,Summary:[...stpa.Summary,stpa.Summary[1]]};
  expect(projectHaraStpaDisplayRows({analysisResult:duplicate},[source],target,[fallback],options)).toEqual([null]);
});
test('legacy table-only snapshots remain visible without claiming they are a reusable generation foundation',()=>{
  const legacy={analysisResult:{Summary:stpa.Summary}};
  expect(projectHaraStpaDisplayRows(legacy,[source],target,[fallback],options)[0]).toEqual(
    ['Injury','Failure to stop','The vehicle shall stop.','','','','','','hara-1','stpa-1']);
  expect(reusableProjectStpaRows(legacy,[source],options)).toEqual([null]);
});
