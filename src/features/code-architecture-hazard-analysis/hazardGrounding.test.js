import {compactHazardSources,generateFastHazards} from './fastHazardPipeline';
import {HAZARD_GROUNDING_RULES} from './hazardGroundingRules';
import {answer} from './fastHazardTestFixtures';

const payload=p=>({interfaces:JSON.parse(p.split('\nInterfaces: ')[1].split('\nRows: ')[0]),rows:JSON.parse(p.split('\nRows: ')[1])});
const definitions=[
 {controlAction:'Evaluate testbench',toFunction:'Elaborate CLOCK_TB',controlDetails:'ghdl -e CLOCK_TB; elaboration only',guidePhrase:'Applied too long'},
 {controlAction:'View waveform',toFunction:'Display waveform',controlDetails:'Viewer launch; blocking behavior is not established',guidePhrase:'Not provided'},
 {controlAction:'Issue pump command',toFunction:'Pump controller',controlDetails:'Command acknowledgement is distinct from completion of the pumping cycle',guidePhrase:'Too late'},
].map(row=>({...row,fromFunction:'Controller',operationalScenario:'Unattended batch',operatingConditions:'No engineer interaction during the run',guidePhraseApplicable:'Yes',guidePhraseApplicabilityReviewStatus:'AI assessed',guidePhraseApplicabilityRationale:'Old unreviewed rationale credits an interactive engineer'}));

test.each(['STPA','HARA','FHA'])('%s screens and generates against the same action/context evidence without a blocking review',async method=>{
 const sources=compactHazardSources(definitions),reviewRequest=jest.fn();
 const applicabilityRequest=jest.fn(async p=>{
  expect(p).not.toContain(HAZARD_GROUNDING_RULES);
  expect(p).toContain('Do not invent concurrency or an interactive operator');
  const {interfaces,rows}=payload(p);
  expect(interfaces[0]).toMatchObject({action:'Evaluate testbench',to:'Elaborate CLOCK_TB',details:['ghdl -e CLOCK_TB; elaboration only']});
  expect(interfaces[2].details[0]).toContain('distinct from completion');
  expect(interfaces.every(x=>x.context.conditions==='No engineer interaction during the run')).toBe(true);
  expect(p).not.toContain('Old unreviewed rationale');
  return rows.map(({id})=>({id,applicable:id==='HA-2'?'No':'Yes',rationale:id==='HA-2'?'No interactive review is required in this context.':'If the assessed operation blocks, its completion can be delayed.'}));
 });
 const request=jest.fn(async p=>{
  expect(p).toContain(HAZARD_GROUNDING_RULES);
  const {interfaces,rows}=payload(p);
  expect(rows.map(x=>x.id)).toEqual(['HA-1','HA-3']);
  expect(rows.every(x=>x.rationale.startsWith('If the assessed operation'))).toBe(true);
  expect(p).not.toContain('Old unreviewed rationale');
  return rows.map(row=>({...answer(method,row.id),assessedAction:interfaces[row.interface].action}));
 });
 const result=await generateFastHazards({method,sources,context:{organizationProfile:'Customer terminology'},applicabilityRequest,request,reviewRequest,onDiagnostic:()=>{},onMetrics:()=>{}});
 expect(applicabilityRequest).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1);expect(reviewRequest).not.toHaveBeenCalled();
 expect(result[1].applicable).toBe('No');
 expect(result[0].applicabilityRationale).toBe('If the assessed operation blocks, its completion can be delayed.');
});

test.each([['Yes','Reviewed'],['No','AI assessed'],['No','Reviewed']])('preserves governed %s rationale with status %s',async(value,status)=>{
 const sources=compactHazardSources([{...definitions[0],guidePhraseApplicable:value,guidePhraseApplicabilityReviewStatus:status,guidePhraseApplicabilityRationale:'Explicit retained decision'}]);
 const screen=jest.fn(),request=jest.fn(async()=>[{...answer('STPA','HA-1'),assessedAction:'Evaluate testbench'}]);
 const result=await generateFastHazards({method:'STPA',sources,context:{},applicabilityRequest:screen,request,onDiagnostic:()=>{},onMetrics:()=>{}});
 expect(result[0].applicable).toBe(value);expect(result[0].applicabilityRationale).toBe('Explicit retained decision');expect(screen).not.toHaveBeenCalled();
 expect(request).toHaveBeenCalledTimes(value==='Yes'?1:0);
});
