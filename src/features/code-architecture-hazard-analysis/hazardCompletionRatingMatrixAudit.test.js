import {assumptionHazardFallback} from './assumptionHazardFallback';
import {validateFastAssessment,deriveFastAsil,deriveFastSwci} from './fastHazardSchema';
const source={id:'HA-1',action:'Apply torque',to:'Actuator',phrase:'Too late',reviewedApplicability:'Yes',reviewedRationale:'Reviewed timing assessment'};
const classifications=['Safety — Direct','Safety — Related','Mission/Reliability'];
test('every supported HARA rating combination completes under every supported classification',()=>{
 let count=0;
 for(const severity of ['S0','S1','S2','S3'])for(const exposure of ['E0','E1','E2','E3','E4'])for(const controllability of ['C0','C1','C2','C3'])for(const classification of classifications){
  const reviewedValues={Severity:` ${severity} `,Exposure:` ${exposure} `,Controllability:` ${controllability} `,'Safety Classification':classification};
  const result=assumptionHazardFallback('HARA',{...source,reviewedValues});
  expect(validateFastAssessment('HARA',result,{...source,reviewedValues})).toEqual([]);
  expect(result).toMatchObject({severity,exposure,controllability,classification});
  expect(deriveFastAsil(result.severity,result.exposure,result.controllability)).toBeTruthy();count++;
 }
 expect(count).toBe(240);
});
test('every supported FHA rating combination completes under every supported classification',()=>{
 let count=0;
 for(const severity of ['I','II','III','IV'])for(const scc of [1,2,3,4,5])for(const classification of classifications){
  const reviewedValues={'Severity Category':` ${severity} `,'Software Control Category':scc,'Safety Classification':classification};
  const result=assumptionHazardFallback('FHA',{...source,reviewedValues});
  expect(validateFastAssessment('FHA',result,{...source,reviewedValues})).toEqual([]);
  expect(result).toMatchObject({severity,scc:String(scc),classification});
  expect(deriveFastSwci(result.severity,result.scc)).toBeTruthy();count++;
 }
 expect(count).toBe(60);
});
