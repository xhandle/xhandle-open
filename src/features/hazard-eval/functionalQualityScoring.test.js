import {gradeFunctionalQuality,QUALITY_WEIGHTS} from './functionalQualityScoring';
import {functionalQualityJudgePrompt,validateJudgeEvidence} from './functionalQualityJudge';

const sources=[{id:'A',action:'Apply stop',evidence:{code:'return 0.0 if command.reset_stop else command.target_mps'}}];
const assessments=[{id:'A',applicable:'Yes',softwareRequirement:'The software shall return zero target during explicit reset.',verification:'Issue reset; verify target is zero.'}];
const expectedCoverage=[{id:'reset',critical:true}];
const verdict={id:'A',scores:{grounding:9.5,applicability:9.5,causality:9.5,requirements:9.5,verification:9.5},
  support:[{quote:'return 0.0 if command.reset_stop else command.target_mps',source:'code'}],findings:[]};
const base={sources,assessments,verdicts:[verdict],expectedCoverage,coverageChecks:[{id:'reset',covered:true,rowIds:['A'],reason:'The reset guard and its test are explicitly assessed.'}]};

test('fixed weights sum to one and an evidence-complete high score passes',()=>{
  expect(Object.values(QUALITY_WEIGHTS).reduce((a,b)=>a+b,0)).toBeCloseTo(1);
  expect(gradeFunctionalQuality(base)).toMatchObject({passed:true,score:9.525});
  expect(validateJudgeEvidence({...base,facts:[]})).toEqual([]);
});
test.each([
  {verdicts:[]},
  {verdicts:[verdict,verdict]},
  {coverageChecks:[]},
  {coverageChecks:[{id:'reset',covered:false,rowIds:[],reason:'Not assessed.'}]},
  {localErrors:['Source contract violated.']},
  {assessments:[]},
])('missing data and hard failures cannot produce a passing average: %j',patch=>{
  expect(gradeFunctionalQuality({...base,...patch}).passed).toBe(false);
});
test('critical finding fails even with inflated numerical scores',()=>{
  const issue={severity:'critical',dimension:'requirements',field:'softwareRequirement',claim:'zero target',evidence:'return 0.0 if command.reset_stop',reason:'Counterexample',fix:'Correct reset output.'};
  expect(gradeFunctionalQuality({...base,verdicts:[{...verdict,findings:[issue]}]}).passed).toBe(false);
  expect(validateJudgeEvidence({...base,verdicts:[{...verdict,findings:[issue]}],facts:[]}).join(' ')).toContain('score ignores critical');
});
test('a weak dimension cannot hide behind a high average',()=>{
  expect(gradeFunctionalQuality({...base,verdicts:[{...verdict,scores:{...verdict.scores,verification:7.5}}]}).passed).toBe(false);
});
test('all-No output cannot claim coverage or high quality',()=>{
  expect(gradeFunctionalQuality({...base,assessments:[{id:'A',applicable:'No'}]}).passed).toBe(false);
});
test('judge evidence must be real and offending claims must appear in that row',()=>{
  expect(validateJudgeEvidence({...base,verdicts:[{...verdict,support:[{quote:'Invented source phrase absent from supplied evidence.'}]}],facts:[]}).join(' ')).toContain('fabricated');
  const finding={severity:'minor',dimension:'verification',field:'verification',claim:'Never present',evidence:'return 0.0 if command.reset_stop',reason:'Mismatch',fix:'Correct the claim.'};
  expect(validateJudgeEvidence({...base,verdicts:[{...verdict,findings:[finding]}],facts:[]}).join(' ')).toContain('not traceable');
});
test('fact prose can start with a capital while case-sensitive source identifiers remain exact',()=>{
  const prose={...verdict,support:[{quote:'At 2 m/s it is 3.6 m.',source:'benchmark fact'}]};
  expect(validateJudgeEvidence({...base,verdicts:[prose],facts:['At 1 m/s it is smaller; at 2 m/s it is 3.6 m.']})).toEqual([]);
  const code={...verdict,support:[{quote:'RETURN 0.0 IF COMMAND.RESET_STOP ELSE COMMAND.TARGET_MPS',source:'code'}]};
  expect(validateJudgeEvidence({...base,verdicts:[code],facts:[]}).join(' ')).toContain('fabricated');
});
test('grader rubric asks for exact citations and checks safe-state regressions independently',()=>{
  const prompt=functionalQualityJudgePrompt({...base,facts:['Reset requires zero target.']});
  expect(prompt).toContain('Do not repair');expect(prompt).toContain('Never invent a quote');
  expect(prompt).toContain('Do not demand motion on reset');expect(prompt).toContain('Read sibling results');
});
test('a cross-field inconsistency can cite another real assessment field while external support remains mandatory',()=>{
  const issue={severity:'major',dimension:'verification',field:'verification',claim:'Issue reset',evidence:assessments[0].softwareRequirement,reason:'The verification does not exercise this stated requirement.',fix:'Test the required trigger and output.'};
  const row={...verdict,scores:{...verdict.scores,verification:7},findings:[issue]};
  expect(validateJudgeEvidence({...base,verdicts:[row],facts:[]})).toEqual([]);
  expect(validateJudgeEvidence({...base,verdicts:[{...row,support:[{quote:issue.evidence,source:'assessment'}]}],facts:[]}).join(' ')).toContain('fabricated');
  expect(validateJudgeEvidence({...base,verdicts:[{...row,findings:[{...issue,dimension:'grounding'}],scores:{...row.scores,grounding:7}}],facts:[]}).join(' ')).toContain('not traceable');
  expect(validateJudgeEvidence({...base,verdicts:[{...row,findings:[{...issue,evidence:'Invented requirement absent from all inputs.'}]}],facts:[]}).join(' ')).toContain('not traceable');
});
test('the supplied project context is external evidence; a fabricated context is not',()=>{
  const contextual=[{...sources[0],context:{mode:'Teleoperated operation'}}];
  expect(validateJudgeEvidence({...base,sources:contextual,verdicts:[{...verdict,support:[{quote:'Teleoperated operation',source:'Operational mode'}]}],facts:[]})).toEqual([]);
  expect(validateJudgeEvidence({...base,sources:contextual,verdicts:[{...verdict,support:[{quote:'Fully autonomous operation',source:'Operational mode'}]}],facts:[]}).join(' ')).toContain('fabricated');
});
