import {assumptionHazardFallback} from './assumptionHazardFallback';
import {validateFastAssessment,deriveFastAsil,deriveFastSwci} from './fastHazardSchema';
import {generateFastHazards} from './resultsFirstHazardPipeline';
const source={id:'HA-1',from:'Controller',action:'Apply torque',to:'Actuator',phrase:'Too late',context:{scenario:'Unattended'},reviewedApplicability:'Yes',reviewedRationale:'Accepted timing decision'};
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
test.each(['STPA','HARA','FHA'])('%s fallback is structurally valid and explicitly assumption-based',method=>{
 const value=assumptionHazardFallback(method,source);
 expect(validateFastAssessment(method,value,source)).toEqual([]);
 expect(value.applicabilityRationale).toBe(source.reviewedRationale);
 expect(value.assessmentBasis).toContain('no source-supported defect or verified safety rating');
 expect(value.assumptions).toContain('assessment premises');
 expect(value.executionDependency).toBe('None');
 expect(value.operatorDependency).toBe('None');
 expect(value.causalBasis).toBe('Hypothesis');
 if(method==='HARA')expect(deriveFastAsil(value.severity,value.exposure,value.controllability)).toBe('ASIL D');
 if(method==='FHA')expect(deriveFastSwci(value.severity,value.scc)).toBe('SwCI 1');
});
test.each(['STPA','HARA','FHA'])('%s excludes reviewed No and preserves reviewed mission classification',method=>{
 const excluded=assumptionHazardFallback(method,{...source,reviewedApplicability:'No'});
 expect(excluded.applicable).toBe('No');expect(excluded.uca).toBeUndefined();
 const mission=assumptionHazardFallback(method,{...source,reviewedValues:{'Safety Classification':'Mission/Reliability'}});
 expect(mission.classification).toBe('Mission/Reliability');
 expect(mission.assumptions).toContain('mission output');
});
test('contradictory governed decisions are never silently replaced',()=>{
 expect(assumptionHazardFallback('STPA',{...source,reviewedValues:{'Safety Classification':'Safety — Direct','Safety Significant':'No'}})).toMatchObject({classification:'Safety — Direct',retainedUserInputs:{'Safety Significant':'No'}});
});
test.each(['STPA','HARA','FHA'])('%s truncation and checkpoint failure still yield exportable memory assessments',async method=>{
 const request=jest.fn(async()=>{throw Object.assign(new Error('Output truncated'),{name:'TruncatedResponseError'});});
 const onStorageState=jest.fn(),checkpoint={read:async()=>undefined,write:async()=>{throw new DOMException('Storage aborted','AbortError');}};
 const result=await generateFastHazards({method,sources:[source],context:{},request,checkpoint,onStorageState,...quiet});
 expect(result).toHaveLength(1);expect(result[0].assessmentBasis).toContain('Assumption-based');
 expect(validateFastAssessment(method,result[0],source)).toEqual([]);
 expect(request.mock.calls.length).toBeLessThanOrEqual(9);
 expect(onStorageState).toHaveBeenCalledWith(expect.objectContaining({unsaved:true}));
});
test('programming errors still surface rather than being reported as successful analysis',async()=>{
 await expect(generateFastHazards({method:'STPA',sources:[source],context:{},request:async()=>{throw new ReferenceError('broken implementation');},...quiet})).rejects.toThrow('broken implementation');
});
test('reviewed rating overrides keep their corresponding premise rather than the default rationale',()=>{
 const hara=assumptionHazardFallback('HARA',{...source,reviewedValues:{Severity:'S1',Exposure:'E2',Controllability:'C1'}});
 expect(hara.ratingRationale).toContain('S1');expect(hara.ratingRationale).not.toContain('S3');
 expect(deriveFastAsil(hara.severity,hara.exposure,hara.controllability)).toBe('QM');
 const fha=assumptionHazardFallback('FHA',{...source,reviewedValues:{'Severity Category':'III','Software Control Category':'3'}});
 expect(fha.severityRationale).toContain('III');expect(fha.sccRationale).toContain('3');
 expect(deriveFastSwci(fha.severity,fha.scc)).toBe('SwCI 4');
});
