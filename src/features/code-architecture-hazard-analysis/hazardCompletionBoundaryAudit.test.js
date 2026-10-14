jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
jest.mock('./codeHazardGenerationCheckpoint',()=>({createCodeHazardCheckpoint:jest.fn()}));
jest.mock('./codeArchitectureHazardStore',()=>({saveCodeArchitectureHazardRun:jest.fn()}));
import {fetchLLMResponse} from '../../components/aiAnalysisSTPA';
import {saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {runCodeArchitectureHazardAnalysis} from './codeArchitectureHazardRunner';
import {generateFastHazards} from './resultsFirstHazardPipeline';
import {usableHazardInputs} from './hazardCompletionSupport';
import {recordUserPreprocessing} from '../project-hazard-analysis/hazardUserPreprocessing';
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Reviewed timing condition'};
const base={projectId:'audit-project',repoMeta:{repoId:'audit-repo'},cbaRows:[{from:'Planner',action:'Apply torque',to:'Actuator',traceId:'functional-1',rowRef:1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}]};
beforeEach(()=>{jest.clearAllMocks();localStorage.clear();saveCodeArchitectureHazardRun.mockResolvedValue(undefined);});
test.each(['STPA','HARA','FHA'])('audit v2: %s publishes accepted screening decisions without reinterpreting their rationale',async method=>{
 const rationale='Not a command; downstream timing is to be confirmed.';
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>({id,applicable:'No',rationale}))));
 const publish=jest.fn();
 const run=await runCodeArchitectureHazardAnalysis({...base,method,onPartialRunUpdate:publish});
 expect(run.runState).toBe('complete');
 const [headers,...rows]=run.generatedSheets.Summary;
 expect(rows).toHaveLength(7);
 for(const row of rows){
  expect(row[headers.indexOf('Guide Phrase Applicable')]).toBe('No');
  expect(row[headers.indexOf('Guide Phrase Applicability Rationale')]).toBe(rationale);
 }
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 expect(publish).toHaveBeenCalled();
 expect(saveCodeArchitectureHazardRun).toHaveBeenCalled();
});
test.each([
 ['HARA','Rating Rationale'],
 ['FHA','Severity Rationale'],
 ['FHA','Software Control Category Rationale'],
])('audit v2: %s retains unresolved %s separately and completes fallback',async(method,header)=>{
 const value='Unknown: operating allocation was not supplied.';
 const imported=recordUserPreprocessing(null,[header],[value],[header]);
 expect(imported.values[header]).toBe(value);
 expect(usableHazardInputs(imported.values,method)).toMatchObject({usable:{},retained:{[header]:value}});
 const request=jest.fn(async()=>{throw new Error('Provider unavailable');});
 const results=await generateFastHazards({method,sources:[{...source,reviewedValues:imported.values}],context:{},request,...quiet});
 expect(results).toHaveLength(1);
 expect(results[0].retainedUserInputs[header]).toBe(value);
 expect(results[0].assessmentBasis).toContain('Assumption-based');
 expect(request).toHaveBeenCalledTimes(3);
});

test.each(['STPA','HARA','FHA'])('%s preserves screened Yes through fallback and checkpoint resume',async method=>{
 const rationale='Command timing applies; downstream timing is to be confirmed.';
 const unreviewed={...source,reviewedApplicability:undefined,reviewedRationale:undefined};
 const entries=new Map();
 const checkpoint={read:async key=>entries.get(JSON.stringify(key)),write:async(key,value)=>entries.set(JSON.stringify(key),value)};
 const applicabilityRequest=jest.fn(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>({id,applicable:'Yes',rationale}))));
 const request=jest.fn(async()=>{throw new Error('Provider unavailable');});
 const args={method,sources:[unreviewed],context:{},checkpoint,request,applicabilityRequest,...quiet};
 const result=await generateFastHazards(args);
 expect(result[0]).toMatchObject({applicable:'Yes',applicabilityRationale:rationale});
 request.mockClear();applicabilityRequest.mockClear();
 const resumed=await generateFastHazards(args);
 expect(resumed[0]).toMatchObject({applicable:'Yes',applicabilityRationale:rationale});
 expect(request).not.toHaveBeenCalled();expect(applicabilityRequest).not.toHaveBeenCalled();
});
