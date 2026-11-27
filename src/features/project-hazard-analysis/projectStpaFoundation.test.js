import { annotateProjectStpaFoundation,projectStpaSources,reusableProjectStpaRows,resolveProjectStpaFoundation,
  reconcileStpaFoundationDrafts,stpaSourceKey,mergeProjectStpaFoundations } from './projectStpaFoundation';

const source={ 'Function (From)':'Controller','Function (From) Details':'Controls motion','Control Action':'Brake demand',
  'Control Action Details':'Requested deceleration','Function (To)':'Actuator','Function (To) Details':'Applies braking',
  'Guide Phrase':'Not provided','Operational Context ID':'crossing','Operational Scenario':'Occupied crossing',
  'Operational Mode':'Driving','Operating Conditions':'Wet surface','Context Assumptions':'Remote operator available' };
const options={stpaProfileProvenance:{effectiveContextIdentity:'original-policy'},operationalContext:'Original global context'};
function fixture(input=source){
  const fields={...input,'Raw Analysis Row ID':'synthetic-row','Guide Phrase Applicable':'Yes',
    'Guide Phrase Applicability Rationale':'Braking is required at the occupied crossing.',
    Loss:'Pedestrian injury',Hazard:'Vehicle enters an occupied crossing',
    'Unsafe Control Action':'Braking is omitted at an occupied crossing.',
    'Causal Scenario':'Missing feedback prevents the controller from recognizing the occupied crossing.',
    'Causal Factor':'Missing crossing feedback','Safety Constraint':'The vehicle shall stop before an occupied crossing.',
    'System Requirement':'The controller shall command braking before crossing entry.',
    'Verification Method':'Inject missing crossing feedback and measure the vehicle response.',
    'Safety Classification':'Safety — Direct','Safety Significance Rationale':'Crossing entry causes pedestrian impact.'};
  const summaryHeaders=Object.keys(fields),fdHeaders=Object.keys(input);
  const analysisResult=annotateProjectStpaFoundation({Summary:[summaryHeaders,Object.values(fields)],
    'Functional Decomposition':[fdHeaders,Object.values(input)]},[input],options);
  return {analysisResult,draftHazardRowsByIndex:{one:{row:analysisResult.Summary[1],generated:true,
    organizationProfileProvenance:options.stpaProfileProvenance,userPreprocessing:{values:{'Guide Phrase Applicable':'Yes'}}}}};
}
const changedProfile={...options,stpaProfileProvenance:{effectiveContextIdentity:'updated-policy'},organizationContext:'Revised policy'};
const run=(record,input=source,extra={})=>resolveProjectStpaFoundation({...changedProfile,
  sheets:{'Functional Decomposition':[Object.keys(input),Object.values(input)]},stpaFoundationRecord:record,...extra});

test('policy changes reuse completed STPA without rewriting its original calibration or analyst ownership',async()=>{
  const saved=fixture(),before=JSON.stringify(saved),generate=jest.fn();
  const result=await run(saved,source,{generate});
  expect(generate).not.toHaveBeenCalled();expect(result.Summary).toEqual(saved.analysisResult.Summary);
  expect(result.stpaFoundationBasis.entries).toEqual(saved.analysisResult.stpaFoundationBasis.entries);
  expect(result.stpaFoundationBasis.profileIdentities).toEqual(saved.analysisResult.stpaFoundationBasis.profileIdentities);
  expect(reconcileStpaFoundationDrafts(saved,result).one).toBe(saved.draftHazardRowsByIndex.one);
  expect(JSON.stringify(saved)).toBe(before);
});

test('version-1 records migrate from saved functional inputs and retain original provenance',async()=>{
  const saved=fixture();delete saved.analysisResult.stpaFoundationBasis.sourceEntries;
  delete saved.analysisResult.stpaFoundationBasis.profileIdentities;saved.analysisResult.stpaFoundationBasis.version=1;
  const generate=jest.fn(),result=await run(saved,source,{generate}),key=stpaSourceKey(source);
  expect(generate).not.toHaveBeenCalled();expect(result.stpaFoundationBasis.version).toBe(2);
  expect(result.stpaFoundationBasis.profileIdentities[key]).toBe('original-policy');
  expect(result.stpaFoundationBasis.entries[key]).toBe(saved.analysisResult.stpaFoundationBasis.entries[key]);
  expect(reusableProjectStpaRows({analysisResult:result},[source],changedProfile)[0]).toBeTruthy();
});

test('legacy records without basis reuse explicit saved source/context without inventing profile provenance',async()=>{
  const saved=fixture();delete saved.analysisResult.stpaFoundationBasis;saved.draftHazardRowsByIndex={};
  const generate=jest.fn(),result=await run(saved,source,{generate}),key=stpaSourceKey(source);
  expect(generate).not.toHaveBeenCalled();expect(result.stpaFoundationBasis.profileIdentities[key]).toBeNull();
  expect(result.stpaFoundationBasis.entries[key]).toBeUndefined();
  expect(reusableProjectStpaRows({analysisResult:result},[source],changedProfile)[0]).toBeTruthy();
});

test.each(Object.keys(source))('a changed functional/context input still prevents reuse: %s',field=>{
  expect(reusableProjectStpaRows(fixture(),[{...source,[field]:source[field]+' changed'}],changedProfile)).toEqual([null]);
});

test('global operational context remains part of compatibility when no scenario is stored on the row',()=>{
  const input={...source,'Operational Scenario':''},saved=fixture(input);
  expect(reusableProjectStpaRows(saved,[input],changedProfile)[0]).toBeTruthy();
  expect(reusableProjectStpaRows(saved,[input],{...changedProfile,operationalContext:'Changed global context'})).toEqual([null]);
  delete saved.analysisResult.stpaFoundationBasis.sourceEntries;
  expect(reusableProjectStpaRows(saved,[input],changedProfile)[0]).toBeTruthy();
  expect(reusableProjectStpaRows(saved,[input],{...changedProfile,operationalContext:'Changed global context'})).toEqual([null]);
});

test('missing source compatibility or ambiguous saved rows do not authorize reuse',()=>{
  const saved=fixture();delete saved.analysisResult.stpaFoundationBasis;delete saved.analysisResult['Functional Decomposition'];
  expect(reusableProjectStpaRows(saved,[source],changedProfile)).toEqual([null]);
  const ambiguous=fixture();ambiguous.analysisResult.Summary.push(ambiguous.analysisResult.Summary[1]);
  expect(reusableProjectStpaRows(ambiguous,[source],changedProfile)).toEqual([null]);
});

test('mixed foundations retain source hashes and profile origins across a merge and cold serialization',()=>{
  const first=fixture().analysisResult,other={...source,'Control Action':'Steering demand'};
  const second=annotateProjectStpaFoundation(fixture(other).analysisResult,[other],changedProfile);
  const merged=JSON.parse(JSON.stringify(mergeProjectStpaFoundations(first,second)));
  expect(projectStpaSources(merged)).toHaveLength(2);
  expect(reusableProjectStpaRows({analysisResult:merged},[source,other],changedProfile).every(Boolean)).toBe(true);
  expect(merged.stpaFoundationBasis.profileIdentities[stpaSourceKey(source)]).toBe('original-policy');
  expect(merged.stpaFoundationBasis.profileIdentities[stpaSourceKey(other)]).toBe('updated-policy');
});
