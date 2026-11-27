import { deriveProjectHaraDeltas, projectHaraDeltaPrompt } from './aiAnalysisProjectHaraDelta';

const input=(index=0)=>({id:`event-${index+1}`,evidence:{'Function (From)':'Controller','Control Action':`Demand ${index}`,'Function (To)':'Actuator',
  Loss:'Pedestrian injury',Hazard:'Uncontrolled vehicle motion','Unsafe Control Action':`Omitted demand ${index}`,
  'Operational Scenario':'Crossing','Operating Conditions':'Wet pavement','System Requirement':'The controller shall command stopping before the crossing.'}});
const response=rows=>JSON.stringify({assessments:rows.map(row=>({id:row.id,severity:'S3',exposure:'E4',controllability:'C3',
  safetyGoal:'The vehicle shall stop before the occupied crossing.'}))});

test('one bounded correction batch fixes explicit reasoning errors without rerunning STPA or replacing source evidence',async()=>{
 const unsafe='The controller shall not issue a braking command until the target stop is reached.';
 const source={...input(),evidence:{...input().evidence,'System Requirement':unsafe}},before=JSON.stringify(source);
 const request=jest.fn().mockResolvedValueOnce(JSON.stringify({assessments:[{id:source.id,exposure:'E2',exposureRationale:'E2 because network failure rates are low.',
  ftti:'2 seconds',fttiRationale:'FTTI is based on the 2-second freshness window.',safetyGoal:'The vehicle shall prevent unintended braking.',functionalSafetyRequirements:unsafe}]}))
  .mockImplementation(async rows=>JSON.stringify({assessments:rows.map(row=>({id:row.id,exposure:'E4',exposureRationale:'Occupied crossings are encountered frequently during intended service.',
   ftti:'1 second',fttiRationale:'At 2 m clearance and 2 m/s closing speed, fault-induced motion can cause contact within 1 second; detection plus braking must finish earlier.',
   functionalSafetyRequirements:'The vehicle shall preserve emergency braking regardless of planned-stop position.'}))}));
 const result=(await deriveProjectHaraDeltas([source],{request})).get(source.id);
 expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls[1][0][0].findings).toHaveLength(3);
 expect(result.exposure).toBe('E4');expect(result.ftti).toBe('1 second');expect(result.functionalSafetyRequirements).toContain('preserve emergency braking');
 expect(JSON.stringify(source)).toBe(before);
});
test('a failed semantic correction completes locally once, while account and cancellation errors still propagate',async()=>{
 const bad=rows=>JSON.stringify({assessments:rows.map(row=>({id:row.id,exposure:'E2',exposureRationale:'E2 because failures occur infrequently.',
  ftti:'5 seconds',fttiRationale:'FTTI is based on the 5-second freshness window.'}))});
 const request=jest.fn(async rows=>bad(rows));
 const result=(await deriveProjectHaraDeltas([input()],{request})).get('event-1');
 expect(request).toHaveBeenCalledTimes(2);expect(result.exposure).toBe('E4');expect(result.ftti).toContain('t_hazard');
 for(const error of [Object.assign(new Error('Cancelled'),{name:'AbortError'}),Object.assign(new Error('Account'),{status:401})]){
  const failed=jest.fn().mockImplementationOnce(async rows=>bad(rows)).mockRejectedValue(error);
  await expect(deriveProjectHaraDeltas([input()],{request:failed})).rejects.toBe(error);
 }
});
test('v1 per-event checkpoints complete under the new policy without repeating provider work',async()=>{
 const request=jest.fn(),generationCheckpoint={readMany:async bases=>bases.map(basis=>basis.stage==='projects-hara-delta-v1'?{assessment:{severity:'S1',exposure:'E2',controllability:'C1',safetyGoal:'The item shall prevent loss of operator assistance.'}}:null),write:async()=>{}};
 const result=await deriveProjectHaraDeltas([input()],{request,generationCheckpoint});
 expect(request).not.toHaveBeenCalled();expect(result.get('event-1').severity).toBe('S1');
});

test('96 distinct completed STPA assessments need eight compact requests, at most two concurrently, with no individual repair calls',async()=>{
 let running=0,peak=0;
 const request=jest.fn(async rows=>{running++;peak=Math.max(peak,running);await Promise.resolve();running--;return response(rows);});
 const inputs=Array.from({length:96},(_,index)=>input(index)),result=await deriveProjectHaraDeltas(inputs,{request});
 expect(request).toHaveBeenCalledTimes(8);expect(peak).toBe(2);expect(result.size).toBe(96);
 for(const assessment of result.values()){
  expect(assessment.functionalSafetyRequirements).toBe(input().evidence['System Requirement']);
  expect(assessment.safeState).toBeTruthy();expect(assessment.ftti).toBeTruthy();
 }
 expect(inputs[0].evidence.Hazard).toBe('Uncontrolled vehicle motion');
 const prompt=projectHaraDeltaPrompt([input()],'Synthetic context','Synthetic item');
 expect(prompt).toContain('Do not repeat STPA');expect(prompt).not.toContain('applicabilityDecision');
 expect(prompt).not.toContain('safeStateEvidence');expect(prompt).not.toContain('hazardMappingReview');
});
test('semantically exact duplicates share derivation but retain their individual IDs; different conditions remain distinct',async()=>{
 const request=jest.fn(async rows=>response(rows));
 const result=await deriveProjectHaraDeltas([input(),{...input(),id:'second'}, {...input(),id:'ice',evidence:{...input().evidence,'Operating Conditions':'Ice'}}],{request});
 expect(request.mock.calls[0][0]).toHaveLength(2);expect([...result.keys()]).toEqual(['event-1','second','ice']);
 expect(result.get('second').id).toBe('second');
});
test('partial or malformed response completes useful drafts without any semantic repair calls',async()=>{
 for(const answer of ['{"assessments":[]}','not JSON']){
  const request=jest.fn(async()=>answer),result=await deriveProjectHaraDeltas([input(),input(1)],{request});
  expect(request).toHaveBeenCalledTimes(1);expect(result.size).toBe(2);
  expect(result.get('event-1').safetyGoal).toContain('shall');
 }
});
test('new per-event checkpoints survive changed batch composition and event IDs',async()=>{
 const records=new Map(),generationCheckpoint={readMany:async bases=>bases.map(basis=>records.get(JSON.stringify(basis))),write:async(basis,value)=>records.set(JSON.stringify(basis),value)};
 const request=jest.fn(async rows=>response(rows));
 await deriveProjectHaraDeltas([input(),input(1)],{request,generationCheckpoint});request.mockClear();
 const result=await deriveProjectHaraDeltas([{...input(1),id:'reordered'}],{request,generationCheckpoint});
 expect(request).not.toHaveBeenCalled();expect(result.get('reordered').severity).toBe('S3');
});
test('saved legacy derivations are retained and only the remaining events require a request',async()=>{
 const request=jest.fn(async rows=>response(rows));
 const result=await deriveProjectHaraDeltas([input(),input(1)],{request,prior:new Map([['event-1',{severity:'S1',exposure:'E2',controllability:'C1',safetyGoal:'The vehicle shall preserve the saved goal.'}]])});
 expect(request.mock.calls[0][0].map(row=>row.id)).toEqual(['event-2']);expect(result.get('event-1').severity).toBe('S1');
});
test('truncated transport output is recovered in smaller batches while account, cancellation and storage failures remain visible',async()=>{
 const truncated=Object.assign(new Error('Output cut off'),{name:'TruncatedResponseError'});
 const request=jest.fn().mockRejectedValueOnce(truncated).mockImplementation(async rows=>response(rows));
 const result=await deriveProjectHaraDeltas(Array.from({length:12},(_,i)=>input(i)),{request});
 expect(result.size).toBe(12);expect(request.mock.calls.map(([rows])=>rows.length)).toEqual([12,6,6]);
 for(const error of [Object.assign(new Error('Stopped'),{name:'AbortError'}),Object.assign(new Error('Account'),{status:401})]){
  await expect(deriveProjectHaraDeltas([input()],{request:async()=>{throw error;}})).rejects.toBe(error);
 }
 await expect(deriveProjectHaraDeltas([input()],{request:async rows=>response(rows),generationCheckpoint:{read:async()=>null,write:async()=>{throw Error('Storage unavailable');}}})).rejects.toThrow('Storage unavailable');
});
