import {generateFastHazards,resultsFirstPrompt} from './resultsFirstHazardPipeline';
import {answer} from './fastHazardTestFixtures';
jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:()=>{throw Error('Live calls forbidden');}}));
const bad='A late check accepts the request before rejection.';
const good='A late synchronous check delays downstream arbitration and protective output.';
const context={sharedSourceCorpus:[{filePath:'gate.py',content:'def gate(sequence, last_sequence):\n    return sequence > last_sequence\n'},
 {filePath:'caller.py',content:'def caller(sequence, state):\n    return gate(sequence, state.last_sequence)\n'}]};
const parse=(prompt,label)=>JSON.parse(prompt.split('\n'+label+': ')[1].split('\n')[0]);
function runtime(source) {
 const values=new Map(),checkpoint={readMany:async bases=>bases.map(basis=>values.get(JSON.stringify(basis))),write:async(basis,value)=>values.set(JSON.stringify(basis),value)};
 const calls=[];
 const request=jest.fn(async(prompt,options)=>{
  if(options.workflow==='hazard-evidence-extraction')return [{filePath:'gate.py',fact:'The gate requires a strictly increasing sequence.',quote:'return sequence > last_sequence'}];
  if(options.workflow==='hazard-semantic-review')return parse(prompt,'Assessments').map(({source,assessment})=>({id:source.id,issues:assessment.applicabilityRationale===bad?['applicabilityRationale contradicts the synchronous source order.']:[]}));
  const rows=parse(prompt,'Rows');calls.push(rows);
  return rows.map(row=>({...answer('STPA',row.id),applicabilityRationale:row.corrections?good:bad}));
 });
 return {request,calls,options:{method:'STPA',sources:[source],context,checkpoint,request,applicabilityRequest:async()=>[{id:source.id,applicable:'Yes',rationale:bad}],onDiagnostic:()=>{},onMetrics:()=>{}}};
}
test('source correction can repair an automatic explanation without changing its decision or source',async()=>{
 const source=Object.freeze({id:'A',action:'Apply torque',phrase:'Too late'}),before=JSON.stringify(source),r=runtime(source);
 const [result]=await generateFastHazards(r.options);
 expect(result).toMatchObject({applicable:'Yes',applicabilityRationale:good});
 expect(r.calls).toHaveLength(2);expect(r.calls[1][0].rationaleCorrectionAllowed).toBe(true);
 expect(JSON.stringify(source)).toBe(before);
});
test('a user-reviewed explanation remains governed, even when a model tries to rewrite it',async()=>{
 const source=Object.freeze({id:'A',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:bad}),r=runtime(source);
 await expect(generateFastHazards(r.options)).rejects.toMatchObject({code:'COMPACT_HAZARD_INCOMPLETE',partialResults:[]});
 expect(r.calls.slice(1).every(rows=>rows[0].rationaleCorrectionAllowed===undefined)).toBe(true);
 expect(source.reviewedRationale).toBe(bad);
});
test('the correction exception never changes an applicability value or grants permission on user inputs',()=>{
 const feedback={A:{allowAutomaticRationaleCorrection:true}};
 const auto=parse(resultsFirstPrompt('STPA',[{id:'A',action:'Apply torque',screenedApplicability:'Yes',screenedRationale:bad}],context,feedback),'Rows')[0];
 const manual=parse(resultsFirstPrompt('STPA',[{id:'A',action:'Apply torque',reviewedApplicability:'Yes',reviewedRationale:bad}],context,feedback),'Rows')[0];
 expect(auto).toMatchObject({applicable:'Yes',rationaleCorrectionAllowed:true});
 expect(manual.applicable).toBe('Yes');expect(manual.rationaleCorrectionAllowed).toBeUndefined();
});
