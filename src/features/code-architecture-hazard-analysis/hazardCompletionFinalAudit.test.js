import {generateFastHazards} from './resultsFirstHazardPipeline';
import {validateFastAssessment} from './fastHazardSchema';
import {usableHazardInputs} from './hazardCompletionSupport';
import {recordUserPreprocessing} from '../project-hazard-analysis/hazardUserPreprocessing';
import {answer} from './fastHazardTestFixtures';
const source={id:'HA-1',action:'Apply torque',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Accepted timing assessment'};
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};

test.each(['STPA','HARA','FHA'])('%s completes every expected row for missing, duplicate and invalid answers',async method=>{
 for(const response of ['[]','null','not JSON',JSON.stringify([answer(method,'HA-1'),answer(method,'HA-1')]),JSON.stringify([{id:'HA-1',applicable:'Yes'}])]){
  const sources=[source,{...source,id:'HA-2'},{...source,id:'HA-3',reviewedApplicability:'No'}];
  const request=jest.fn(async()=>response);
  const results=await generateFastHazards({method,sources,context:{},request,...quiet});
  expect(results.map(row=>row.id)).toEqual(sources.map(row=>row.id));
  results.forEach((row,index)=>expect(validateFastAssessment(method,row,sources[index])).toEqual([]));
  expect(results[2].applicable).toBe('No');
  expect(request.mock.calls.length).toBeLessThanOrEqual(18);
 }
});

test.each(['STPA','HARA','FHA'])('%s keeps cached accepted rows while completing provider-unavailable rows',async method=>{
 const accepted=answer(method,'HA-1');
 const sources=[source,{...source,id:'HA-2'}];
 const checkpoint={read:async key=>key.source?.id==='HA-1' && !key.stage?accepted:undefined,write:async()=>{throw new Error('Storage unavailable');}};
 const request=jest.fn(async()=>{throw Object.assign(new Error('Provider unavailable'),{status:403});});
 const results=await generateFastHazards({method,sources,context:{},checkpoint,request,...quiet});
 expect(results).toHaveLength(2);expect(results[0]).toEqual(accepted);
 expect(results[1].assessmentBasis).toContain('Assumption-based');
 expect(request).toHaveBeenCalledTimes(1);
});

test.each([['HARA','Severity',' S3 '],['FHA','Severity Category',' III ']])('%s noncanonical saved %s completes fallback with its rating preserved',async(method,header,value)=>{
 // Updating a different field retains existing saved values verbatim. Fresh CSV
 // cells are trimmed; this exercises retained legacy/noncanonical saved state.
 const saved=recordUserPreprocessing({values:{[header]:value}},['Verification'],['Inject fault and check rejection.'],['Verification']);
 expect(saved.values[header]).toBe(value);
 expect(usableHazardInputs(saved.values,method).usable[header]).toBe(value.trim());
 const request=jest.fn(async()=>{throw new Error('Provider unavailable');});
 const results=await generateFastHazards({method,sources:[{...source,reviewedValues:saved.values}],context:{},request,...quiet});
 expect(results).toHaveLength(1);
 expect(results[0].severity).toBe(value.trim());
 expect(results[0].retainedUserInputs[header]).toBe(value);
 expect(validateFastAssessment(method,results[0],source)).toEqual([]);
 expect(request).toHaveBeenCalledTimes(3);
});
