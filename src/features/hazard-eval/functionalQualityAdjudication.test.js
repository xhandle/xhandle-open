import {applyQualityAdjudication,qualityAdjudicationPrompt} from './functionalQualityAdjudication';
const sources=[{id:'A',evidence:{code:'def protect(): return protective_output'}}];
const assessments=[{id:'A',verification:'Expect a protective output.',softwareRequirement:'The software shall protect the vehicle.'}];
const finding={severity:'major',dimension:'verification',field:'verification',claim:'Expect a protective output.',evidence:'return protective_output',reason:'Alleges the output should permit motion.',fix:'Change the expected output.'};
const original={id:'A',scores:{grounding:9,applicability:9,causality:9,requirements:9,verification:7},support:[{quote:'return protective_output'}],findings:[finding]};
const audit={id:'A',scores:{...original.scores,verification:9},support:original.support,decisions:[{index:0,upheld:false,claim:finding.claim,evidence:finding.evidence,reason:'The supplied implementation returns the protective output exactly as expected.'}],newFindings:[],scoreReasons:{verification:'The source return statement directly supports this expected output.'}};
const apply=(verdict=original,review=audit)=>applyQualityAdjudication({verdicts:[verdict],audits:[review],sources,assessments,facts:[]})[0];
test('evidence audit preserves the first-pass record and explains a withdrawn allegation',()=>{
  const before=JSON.stringify(original),result=apply();
  expect(result.scores.verification).toBe(9);
  expect(result.findings).toEqual([]);
  expect(result.firstPassScores).toEqual(original.scores);
  expect(result.adjudication.firstPassFindings).toEqual(original.findings);
  expect(JSON.stringify(original)).toBe(before);
});
test('disputing a critical finding cannot clear its blocking status or score ceiling',()=>{
  const result=apply({...original,findings:[{...finding,severity:'critical'}]});
  expect(result.findings[0].severity).toBe('critical');
  expect(result.scores.verification).toBe(4);
  expect(result.adjudication.disputedCriticals).toEqual([0]);
});
test('an upheld major issue retains its allegation and score ceiling',()=>{
  const result=apply(original,{...audit,decisions:[{...audit.decisions[0],upheld:true}]});
  expect(result.findings[0].reason).toBe(finding.reason);
  expect(result.scores.verification).toBe(7);
});
test.each([
  {...audit,id:'invented'},
  {...audit,decisions:[]},
  {...audit,decisions:[audit.decisions[0],audit.decisions[0]]},
  {...audit,scoreReasons:{}},
  {...audit,decisions:[{...audit.decisions[0],reason:'fine'}]},
  {...audit,decisions:[{...audit.decisions[0],evidence:'fabricated evidence statement'}]},
  {...audit,decisions:[{...audit.decisions[0],claim:'invented assessment text'}]},
])('audit rejects missing identity, justification or genuine evidence',review=>expect(()=>apply(original,review)).toThrow());
test('new critical findings remain blocking',()=>{
  const result=apply(original,{...audit,newFindings:[{...finding,severity:'critical'}]});
  expect(result.findings[0].severity).toBe('critical');expect(result.scores.verification).toBe(4);
});
test('audit prompt uses the fixed rubric and permits downward corrections',()=>{
  const prompt=qualityAdjudicationPrompt({verdicts:[original],sources,assessments,facts:[]});
  expect(prompt).toContain('Scores may rise, fall or stay the same');
  expect(prompt).toContain('A critical finding caps the affected dimension at 4');
  expect(prompt).toContain('Existing critical findings remain blocking');
});
