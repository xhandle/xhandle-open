// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
jest.mock('./fastHazardSemanticReview',()=>({createReviewBatchPolicy:()=>({rows:24,chars:60000,successes:0,epoch:0}),reviewFastHazards:async ({entries})=>Object.fromEntries(entries.map(({source})=>[source.id,[]]))}));
import {validateFastAssessment} from './fastHazardSchema';
import {generateReviewedFastHazards as generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';
import {fastHazardSheets} from './fastHazardRunner';

test.each(['STPA','HARA','FHA'])('%s rejects embedded placeholders but accepts testable configured boundaries',method=>{
  const source={id:'a',action:'Apply torque'};
  for(const field of ['softwareRequirement','verification']){
    for(const marker of ['TBD','TBC','TODO','to be determined','Needs Review']){
      const row={...answer(method,'a'),[field]:`The software shall enforce a timeout of ${marker} seconds.`};
      expect(validateFastAssessment(method,row,source).length).toBeGreaterThan(0);
    }
  }
  const row={...answer(method,'a'),softwareRequirement:'The software shall require a positive maximum-duration configuration before starting the command and reject startup if it is absent.',verification:'With configured duration T, inject completion before T and a stall beyond T; verify normal completion and timeout rejection respectively.'};
  expect(validateFastAssessment(method,row,source)).toEqual([]);
});

test.each(['STPA','HARA','FHA'])('%s binds to action and requires real source text for source-supported causation',method=>{
  const source={id:'a',action:'Apply torque',evidence:{code:{content:'if (torque > limit) return reject();'}}};
  expect(validateFastAssessment(method,{...answer(method,'a'),assessedAction:'Run simulation'},source)).toEqual(expect.arrayContaining([expect.stringContaining('assessedAction')]));
  const row={...answer(method,'a'),causalBasis:'Source-supported',causalEvidence:'The supplied code rejects excess torque.',evidenceQuote:'if (torque > limit) return reject();'};
  expect(validateFastAssessment(method,row,source)).toEqual([]);
  expect(validateFastAssessment(method,{...row,evidenceQuote:'The code has no validation or guards.'},source)).toEqual(expect.arrayContaining([expect.stringContaining('evidenceQuote')]));
  expect(validateFastAssessment(method,row,{...source,evidence:{}}).length).toBeGreaterThan(0);
});

test('hypothetical STPA causes must not be presented as established implementation defects',()=>{
  expect(validateFastAssessment('STPA',{...answer('STPA','a'),causalFactor:'The script has no timeout.'},{id:'a'})).toEqual(expect.arrayContaining([expect.stringContaining('hypothetical fault')]));
});

test('only the row with an embedded requirement placeholder is corrected',async()=>{
  const request=jest.fn(async prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>{
    const row=answer('STPA',id);
    return id==='a' && request.mock.calls.length===1 ? {...row,softwareRequirement:'The software shall enforce a limit of TBD seconds.'} : row;
  }));
  const rows=await generateFastHazards({method:'STPA',sources:[{id:'a',action:'Apply torque'},{id:'b',action:'Apply torque'}],context:{},request});
  expect(rows).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(request.mock.calls[1][0].split('\nRows: ')[1]).map(row=>row.id)).toEqual(['a']);
});

test('inherited unresolved metadata is identified honestly without changing the architecture input',()=>{
  const source={controlAction:'Apply torque',lifecyclePhase:'Needs Review',interfaceType:'Needs Review',traceability:{}};
  const sheet=fastHazardSheets('STPA',{tableRows:[source],sheets:{'Functional Decomposition':[]}},[answer('STPA','a')]).Summary;
  const cell=header=>sheet[1][sheet[0].indexOf(header)];
  expect(cell('Lifecycle Phase')).toBe('Not specified in source architecture');
  expect(cell('Interface Type')).toBe('Not specified in source architecture');
  expect(cell('Causal Assessment Basis')).toBe('Hypothesis');
  expect(cell('Assessed Control Action')).toBe('Apply torque');
  expect(source.lifecyclePhase).toBe('Needs Review');
});

test('STPA requires explicit artifacts and exports linked IDs without substituting causal factors',()=>{
  const assessment=answer('STPA','HA-7');
  for(const field of ['uca','loss','hazard','causalScenario','safetyConstraint']){
    expect(validateFastAssessment('STPA',{...assessment,[field]:''},{id:'HA-7'}).length).toBeGreaterThan(0);
  }
  const input={tableRows:[{controlAction:'Apply torque',traceability:{}}],sheets:{'Functional Decomposition':[]}};
  const sheet=fastHazardSheets('STPA',input,[assessment]).Summary;
  const cell=header=>sheet[1][sheet[0].indexOf(header)];
  expect(cell('Unsafe Control Action')).toBe(assessment.uca);
  expect(cell('Loss')).toBe(assessment.loss);
  expect(cell('Hazard')).toBe(assessment.hazard);
  expect(cell('Causal Scenario')).toBe(assessment.causalScenario);
  expect(cell('Causal Factor')).toBe(assessment.causalFactor);
  expect(cell('Safety Constraint')).toBe(assessment.safetyConstraint);
  expect(cell('Hazard → Loss ID')).toBe(cell('Loss ID'));
  expect(cell('UCA → Hazard ID')).toBe(cell('Hazard ID'));
  expect(cell('Causal Scenario → UCA ID')).toBe(cell('UCA ID'));
  expect(cell('Safety Constraint → UCA ID')).toBe(cell('UCA ID'));
  expect(sheet[0]).not.toContain('Malfunctioning Behavior');
});

test.each(['STPA','HARA','FHA'])('%s rejects unsupported overlap and accepts explicitly evidenced concurrency',method=>{
  const quote='subprocess.run(elaborate); subprocess.run(simulate)';
  const source={id:'a',evidence:{code:quote}};
  const row={...answer(method,'a'),executionDependency:'Overlap',executionEvidenceQuote:quote};
  expect(validateFastAssessment(method,row,source)).toEqual(expect.arrayContaining([expect.stringContaining('missing exit-status')]));
  expect(validateFastAssessment(method,{...row,executionDependency:'None'},source)).toEqual([]);
  const asyncQuote='subprocess.Popen(elaborate) # background execution';
  expect(validateFastAssessment(method,{...row,executionEvidenceQuote:asyncQuote},{...source,evidence:{code:asyncQuote}})).toEqual([]);
  expect(validateFastAssessment(method,{...row,executionEvidenceQuote:asyncQuote},source).length).toBeGreaterThan(0);
});

test.each(['STPA','HARA','FHA'])('%s respects unattended context without excluding automated viewer consequences',method=>{
  const context={conditions:'Unattended verification run with no engineer interaction.'};
  const source={id:'a',context};
  const row={...answer(method,'a'),operatorDependency:'Interactive operator',operatorContextQuote:context.conditions};
  expect(validateFastAssessment(method,row,source)).toEqual(expect.arrayContaining([expect.stringContaining('conflicts with')]));
  expect(validateFastAssessment(method,{...row,operatorDependency:'None',operatorContextQuote:''},source)).toEqual([]);
  const attended='An engineer interacts with the waveform viewer during this scenario.';
  expect(validateFastAssessment(method,{...row,operatorContextQuote:attended},{...source,context:{conditions:attended}})).toEqual([]);
  expect(validateFastAssessment(method,{...row,operatorContextQuote:attended},{...source,context:{}}).length).toBeGreaterThan(0);
});

test('unsupported execution premise retries only the affected row with corrective feedback',async()=>{
  const request=jest.fn(async prompt=>JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>({
    ...answer('STPA',id),
    ...(id==='a' && request.mock.calls.length===1 ? {executionDependency:'Overlap',executionEvidenceQuote:'No exit-status check is present.'} : {}),
  })));
  const rows=await generateFastHazards({method:'STPA',sources:[{id:'a',evidence:{code:'No exit-status check is present.'}},{id:'b'}],context:{},request});
  expect(rows).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(2);
  const retry=JSON.parse(request.mock.calls[1][0].split('\nRows: ')[1]);
  expect(retry.map(row=>row.id)).toEqual(['a']);
  expect(retry[0].corrections.issues.join(' ')).toContain('missing exit-status');
});
