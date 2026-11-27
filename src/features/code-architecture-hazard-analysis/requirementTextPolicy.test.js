import {requirementTextIssues} from './requirementTextPolicy';
import {resultsFirstPrompt} from './resultsFirstHazardPipeline';
import {validateFastAssessment} from './fastHazardSchema';
import {answer} from './fastHazardTestFixtures';
import {sharedHazardCodeEvidence} from './fastHazardPipeline';
const source={id:'HA-1',action:'Apply torque',evidence:{code:'LIMIT_2 = 3.0'}};
test.each(['softwareRequirement','safetyConstraint','safetyGoal'])('rejects metrics and numerical limits in generated %s only',field=>{
  for(const text of ['The software shall respond within 0.2 s.','The software shall achieve 99% confidence.','The software shall respond within two seconds.','The software shall return a zero target.','The software shall enforce a validated processing deadline parameter.']) {
    expect(requirementTextIssues({[field]:text},source).length).toBeGreaterThan(0);
  }
  expect(requirementTextIssues({[field]:'The software shall enforce LIMIT_2 before accepting the target.',verification:'Test 2.9, 3.0 and 3.1; expect reject above 3.0.'},source)).toEqual([]);
});
test.each(['softwareRequirement','safetyConstraint','safetyGoal'])('accepts mathematical zero terminology without permitting numeric targets in %s',field=>{
 const statements=[
  'The software shall initialize the workspace with a zero-filled tensor before calculating the result.',
  'The software shall evaluate the source-defined near-zero predicate before selecting the division branch.',
  'The software shall preserve the zero-initialized buffer until the first update.',
  'The software shall reject a zero denominator before calculating the ratio.',
 ];
 for(const statement of statements)expect(requirementTextIssues({[field]:statement},source)).toEqual([]);
 for(const statement of [
  'The software shall command a zero speed target.',
  'The software shall enforce a zero latency budget.',
  'The software shall respond within zero seconds.',
 ])expect(requirementTextIssues({[field]:statement},source).length).toBeGreaterThan(0);
});
test.each(['STPA','HARA','FHA'])('%s enforces output policy while leaving evidence and verification intact',method=>{
  const original=JSON.stringify(source),row={...answer(method,'HA-1'),softwareRequirement:'The software shall reject values above 3.0 m/s.'};
  expect(validateFastAssessment(method,row,source,{structuralOnly:true}).join(' ')).toContain('numeric values');
  const prompt=resultsFirstPrompt(method,[source],{});
  expect(prompt).toContain('must not contain metrics');expect(prompt).toContain('LIMIT_2 = 3.0');expect(JSON.stringify(source)).toBe(original);
});
test('parameter names and changed source values do not change the qualitative output rule',()=>{
  for(const [name,value] of [['GATE_LIMIT',7],['ROBOT_2_BOUND',31],['LEASE_MS',85]]) {
    const renamed={...source,evidence:{code:`${name} = ${value}`}};
    expect(requirementTextIssues({softwareRequirement:`The software shall enforce ${name} when validating the request.`},renamed)).toEqual([]);
    expect(requirementTextIssues({softwareRequirement:`The software shall reject above ${value}.`},renamed)).not.toEqual([]);
  }
});
test('existing analyst input is preserved; newly generated numeric text is rejected',()=>{
  const text='The software shall reject targets above 3 m/s.';
  expect(requirementTextIssues({softwareRequirement:text},{reviewedValues:{'Software Safety Requirement':text}})).toEqual([]);
  expect(requirementTextIssues({softwareRequirement:text},source)).not.toEqual([]);
});
test('supplemental cross-helper evidence preserves original code and never truncates the row evidence',()=>{
  const file={filePath:'helpers.py',content:'LIMIT = 85\ndef permit(x): return x <= LIMIT'};
  const rows=[{codeEvidence:{files:[file,file]}}],before=JSON.stringify(rows);
  expect(sharedHazardCodeEvidence(rows)).toEqual([file]);
  expect(sharedHazardCodeEvidence(rows,{maxChars:10})).toEqual([]);
  expect(sharedHazardCodeEvidence([...rows,{codeEvidence:{files:[{...file,content:'LIMIT = 7'}]}}])).toEqual([]);
  expect(JSON.stringify(rows)).toBe(before);
});
