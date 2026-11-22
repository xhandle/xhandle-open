import {applyQualityCitationRepairs,qualityCitationDiagnostics} from './functionalQualityCitationRepair';
const verdict={id:'A',scores:{verification:4},support:[{quote:'paraphrase'}],findings:[{severity:'critical',dimension:'verification',field:'verification',claim:'paraphrase',evidence:'paraphrase',reason:'Concrete wrong output.',fix:'Correct expected output.'}]};
test('citation correction preserves all judgments and original evidence for audit',()=>{
  const original=JSON.stringify(verdict);
  const [result]=applyQualityCitationRepairs([verdict],[{id:'A',support:[{quote:'return protective_output',source:'guard.py'}],findings:[{index:0,claim:'expect release',evidence:'return protective_output'}]}]);
  expect(result.scores).toEqual(verdict.scores);
  expect(result.findings[0]).toMatchObject({severity:'critical',reason:verdict.findings[0].reason,fix:verdict.findings[0].fix,claim:'expect release'});
  expect(JSON.stringify(verdict)).toBe(original);
});
test.each([
  [{id:'A',scores:{verification:10}}],
  [{id:'A',findings:[{index:0,severity:'minor'}]}],
  [{id:'UNKNOWN',support:[]}],
  [{id:'A'},{id:'A'}],
  [{id:'A',findings:[{index:1,claim:'missing'}]}],
])('citation repairs cannot alter scores/severity or invent/remove findings',repairs=>{
  expect(()=>applyQualityCitationRepairs([verdict],repairs)).toThrow();
});
test('diagnostics protect an exact claim from replacement while repairing fabricated evidence',()=>{
  const row={...verdict,support:[{quote:'return protective_output'}],findings:[{...verdict.findings[0],claim:'expect release'}]};
  const diagnostics=qualityCitationDiagnostics({verdicts:[row],sources:[{id:'A',evidence:{code:'return protective_output'}}],assessments:[{id:'A',verification:'Test and expect release'}],facts:[]});
  expect(diagnostics[0].findings[0]).toMatchObject({claimValid:true,evidenceValid:false});
  const [result]=applyQualityCitationRepairs([row],[{id:'A',support:[],findings:[{index:0,claim:'Test rewrite',evidence:'return protective_output'}]}],diagnostics);
  expect(result.findings[0].claim).toBe('expect release');
  expect(result.findings[0].evidence).toBe('return protective_output');
  expect(result.support).toEqual(row.support);
});
test('diagnostics distinguish external-only evidence from permitted internal-consistency evidence',()=>{
  const args={sources:[{id:'A',evidence:{code:'return protective_output'}}],assessments:[{id:'A',verification:'expect release',assumptions:'The caller waits for this guard.'}],facts:[]};
  const diagnostics=qualityCitationDiagnostics({...args,verdicts:[{...verdict,findings:[{...verdict.findings[0],dimension:'applicability',evidence:'The caller waits for this guard.'}]}]});
  expect(diagnostics[0].findings[0].evidencePolicy).toContain('External source/fact REQUIRED');
  expect(diagnostics[0].findings[0].evidenceValid).toBe(false);
});
