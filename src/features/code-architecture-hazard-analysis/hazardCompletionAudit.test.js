import {generateFastHazards} from './resultsFirstHazardPipeline';
import {answer} from './fastHazardTestFixtures';
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Accepted'};
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
test.each(['STPA','HARA','FHA'])('audit: %s fallback preserves locked rationale and completes',async method=>{
 const request=jest.fn(async()=>{throw new Error('Provider unavailable');});
 await expect(generateFastHazards({method,sources:[{...source,reviewedRationale:'Timing applies; needs review of the deadline.'}],context:{},request,...quiet})).resolves.toMatchObject([{applicable:'Yes',applicabilityRationale:'Timing applies; needs review of the deadline.'}]);
 expect(request).toHaveBeenCalledTimes(3);
});
test.each(['STPA','HARA','FHA'])('audit: %s telemetry exception does not override generated results',async method=>{
 const request=jest.fn(async()=>[answer(method,'HA-1')]);
 await expect(generateFastHazards({method,sources:[source],context:{},request,...quiet,onMetrics:()=>{throw new Error('Telemetry failed');}})).resolves.toHaveLength(1);
 expect(request).toHaveBeenCalledTimes(1);
});
test.each(['HARA','FHA'])('audit: %s invalid imported rating is retained separately from valid fallback',async method=>{
 const reviewedValues=method==='HARA'?{Severity:'S9'}:{'Software Control Category':'9'};
 await expect(generateFastHazards({method,sources:[{...source,reviewedValues}],context:{},request:async()=>[],...quiet})).resolves.toMatchObject([{retainedUserInputs:reviewedValues,assessmentBasis:expect.stringContaining('retained separately')}]);
});
