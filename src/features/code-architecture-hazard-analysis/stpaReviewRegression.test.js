import {generateFastHazards} from './resultsFirstHazardPipeline';
import {validateFastAssessment} from './fastHazardSchema';
import {syntheticStpaCases} from './stpaSyntheticFixtures';

jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:()=>{throw new Error('Live provider calls are forbidden in this regression suite');}}));
const quiet={onDiagnostic:()=>{},onMetrics:()=>{}};
const rows=prompt=>JSON.parse(prompt.split('\nRows: ')[1]);
const memory=()=>{
  const data=new Map();
  return {data,read:async key=>data.get(JSON.stringify(key)),write:async(key,value)=>data.set(JSON.stringify(key),value)};
};

test('Retry reconsiders cached pending evidence once, without repeating completed assessments',async()=>{
  const cases=syntheticStpaCases().slice(0,2),checkpoint=memory();
  const sources=cases.map(item=>item.source);
  const applicabilityRequest=jest.fn(async prompt=>rows(prompt).map(({id})=>id===sources[0].id
    ? {id,needsEvidence:true,rationale:'Reconcile the controller operating condition with the supplied control contract.'}
    : {id,applicable:'Yes',rationale:'Actuator command in the stated operating context.'}));
  const request=jest.fn(async prompt=>rows(prompt).map(({id})=>cases.find(item=>item.source.id===id).assessment));
  const options={method:'STPA',sources,context:{},checkpoint,applicabilityRequest,request,...quiet};
  await expect(generateFastHazards(options)).rejects.toMatchObject({partialResults:[expect.objectContaining({id:sources[1].id})]});
  expect(applicabilityRequest).toHaveBeenCalledTimes(2);
  request.mockClear();applicabilityRequest.mockClear();
  // A still-unresolved retry is bounded to one focused evidence request.
  await expect(generateFastHazards(options)).rejects.toMatchObject({code:'COMPACT_HAZARD_INCOMPLETE'});
  expect(applicabilityRequest).toHaveBeenCalledTimes(1);
  expect(applicabilityRequest.mock.calls[0][1].screeningMode).toBe('evidence');
  expect(request).not.toHaveBeenCalled();
  applicabilityRequest.mockClear();
  applicabilityRequest.mockImplementation(async prompt=>rows(prompt).map(({id})=>({id,applicable:'Yes',rationale:'The supplied control contract establishes this command.'})));
  expect(await generateFastHazards(options)).toHaveLength(2);
  expect(applicabilityRequest).toHaveBeenCalledTimes(1);
  expect(rows(applicabilityRequest.mock.calls[0][0]).map(row=>row.id)).toEqual([sources[0].id]);
  expect(rows(request.mock.calls[0][0]).map(row=>row.id)).toEqual([sources[0].id]);
  expect(request).toHaveBeenCalledTimes(1);
});

test('failure drains already accepted checkpoints before the runner releases storage',async()=>{
  const cases=syntheticStpaCases().slice(0,2),checkpoint=memory(),write=checkpoint.write;
  checkpoint.write=async(key,value)=>{await new Promise(resolve=>setTimeout(resolve,10));return write(key,value);};
  const sources=cases.map(item=>({...item.source,reviewedApplicability:'Yes',reviewedRationale:'Retained command decision.'}));
  const request=async prompt=>rows(prompt).map(({id})=>id===sources[0].id?cases[0].assessment:{id,applicable:'Yes'});
  const checkpointController=new AbortController();
  await expect(generateFastHazards({method:'STPA',sources,context:{},checkpoint,checkpointSignal:checkpointController.signal,request,...quiet})).rejects.toMatchObject({partialResults:[expect.objectContaining({id:sources[0].id})]});
  checkpointController.abort();
  expect([...checkpoint.data.values()].some(value=>value.id===sources[0].id && value.uca===cases[0].assessment.uca)).toBe(true);
});

test('Stop during a retry of pending evidence does not publish a late response',async()=>{
  const {source}=syntheticStpaCases()[0],checkpoint=memory(),controller=new AbortController();
  const pending=async prompt=>rows(prompt).map(({id})=>({id,needsEvidence:true,rationale:'Resolve the operating condition.'}));
  const options={method:'STPA',sources:[source],context:{},checkpoint,...quiet};
  await expect(generateFastHazards({...options,applicabilityRequest:pending})).rejects.toMatchObject({code:'COMPACT_HAZARD_INCOMPLETE'});
  const applicabilityRequest=jest.fn(async prompt=>{controller.abort();return rows(prompt).map(({id})=>({id,applicable:'No',rationale:'Not meaningful.'}));});
  await expect(generateFastHazards({...options,signal:controller.signal,applicabilityRequest})).rejects.toMatchObject({name:'AbortError',partialResults:[]});
  expect(applicabilityRequest).toHaveBeenCalledTimes(1);
  expect([...checkpoint.data.values()].some(value=>value.applicable==='No')).toBe(false);
});

test('empty optional premise cells remain valid after sheet and CSV roundtrips',()=>{
  const {source,assessment}=syntheticStpaCases()[0];
  expect(validateFastAssessment('STPA',{...assessment,executionDependency:'',operatorDependency:''},source,{structuralOnly:true})).toEqual([]);
});

test('compact validation accepts actual cited concurrency and operator context',()=>{
  const {source,assessment}=syntheticStpaCases()[0];
  const executionEvidenceQuote='Promise.all([sampleSensors(), updateActuators()]);';
  const operatorContextQuote='The test engineer interacts with the controller console during the maintenance test.';
  expect(validateFastAssessment('STPA',{...assessment,executionDependency:'Overlap',executionEvidenceQuote,operatorDependency:'Interactive operator',operatorContextQuote},
    {...source,evidence:{code:executionEvidenceQuote},context:{scenario:operatorContextQuote}},{structuralOnly:true})).toEqual([]);
});

test.each([
  {hazard:'Unknown obstacle position prevents the controller from selecting a collision-free stopping trajectory.'},
  {causalScenario:'Pending brake commands remain queued until after the stopping deadline.'},
  {verification:'Observe brake response after suppressing a command; confirm the fallback stops the vehicle within the validated stopping distance.'},
])('valid technical language is not mistaken for an unfinished assessment: %j',patch=>{
  const {source,assessment}=syntheticStpaCases()[0];
  expect(validateFastAssessment('STPA',{...assessment,...patch},source,{structuralOnly:true})).toEqual([]);
});

test.each([
  [{executionDependency:'Overlap',executionEvidenceQuote:'No exit-status check is present.'},{evidence:'No exit-status check is present.'},'Overlap requires'],
  [{operatorDependency:'Interactive operator',operatorContextQuote:'Unattended batch with no engineer interaction.'},{context:{conditions:'Unattended batch with no engineer interaction.'}},'conflicts with'],
])('compact acceptance and checkpoint reuse reject unsupported supplied causal premises', (patch,sourcePatch,issue)=>{
  const {source,assessment}=syntheticStpaCases()[0];
  expect(validateFastAssessment('STPA',{...assessment,...patch},{...source,...sourcePatch},{structuralOnly:true})).toEqual(expect.arrayContaining([expect.stringContaining(issue)]));
});

test('compact generation corrects only the row with an unsupported execution premise',async()=>{
  const cases=syntheticStpaCases().slice(0,2);
  const sources=cases.map(item=>({...item.source,reviewedApplicability:'Yes',reviewedRationale:'Retained command decision.'}));
  const request=jest.fn(async prompt=>rows(prompt).map(({id})=>({
    ...cases.find(item=>item.source.id===id).assessment,
    ...(id===sources[0].id && request.mock.calls.length===1?{executionDependency:'Overlap',executionEvidenceQuote:'No exit-status check is present.'}:{}),
  })));
  const result=await generateFastHazards({method:'STPA',sources,context:{},request,...quiet});
  expect(result).toHaveLength(2);expect(request).toHaveBeenCalledTimes(2);
  expect(rows(request.mock.calls[1][0])).toEqual([expect.objectContaining({id:sources[0].id,corrections:expect.arrayContaining([expect.stringContaining('Overlap requires')])})]);
});
