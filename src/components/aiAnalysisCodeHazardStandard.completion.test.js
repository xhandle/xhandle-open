jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
import { fetchLLMResponse } from './aiAnalysisSTPA';
import { hasGeneratedHazardAssessment, requestStandardRowsWithRetries } from './aiAnalysisCodeHazardStandard';

const config = { sheetName: 'STPA', analysisName: 'STPA', fields: [['hazards','Hazards']], promptGuidance: '' };
const items = [{ id:'FD-1', from:'Estimate Pose', controlAction:'Publish pose', to:'Plan Motion', guidePhrase:'Not provided' }];
const assessed = { id:'FD-1-STPA', guidePhraseApplicable:'Yes', guidePhraseApplicabilityRationale:'Planner requires a current pose.', hazards:'Planner operates using a stale pose.' };
beforeEach(() => jest.clearAllMocks());
test('identity-only output is retried rather than accepted as completed analysis', async () => {
 fetchLLMResponse.mockResolvedValueOnce(JSON.stringify([{id:'FD-1-STPA'}])).mockResolvedValue(JSON.stringify([assessed]));
 await expect(requestStandardRowsWithRetries(config, items)).resolves.toEqual([assessed]);
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
});
test('exhausted retries reject instead of materializing blank fallback assessments', async () => {
 fetchLLMResponse.mockResolvedValue(JSON.stringify([{id:'FD-1-STPA'}]));
 await expect(requestStandardRowsWithRetries(config, items)).rejects.toThrow('Hazard analysis incomplete');
 expect(fetchLLMResponse.mock.calls.length).toBeGreaterThan(1);
});
test('an explicitly reasoned non-applicable row is valid without an invented hazard', () => {
  expect(hasGeneratedHazardAssessment({guidePhraseApplicable:'No',guidePhraseApplicabilityRationale:'This transaction has no maintained duration.'})).toBe(true);
  expect(hasGeneratedHazardAssessment({id:'FD-1',guidePhraseApplicable:'Yes'})).toBe(false);
});

test('No rows bypass AI regardless of review status while retaining their place in the completed output', async () => {
 const {runStandardHazardAnalysisStages, HAZARD_ANALYSIS_REPAIR_STAGES} = require('./aiAnalysisCodeHazardStandard');
 const original = [...HAZARD_ANALYSIS_REPAIR_STAGES];
 const stpa = {...config,rowIdSuffix:'STPA',fields:[['guidePhraseApplicable','Guide Phrase Applicable'],['guidePhraseApplicabilityRationale','Guide Phrase Applicability Rationale'],['hazards','Hazards']]};
 const reviewed = {...items[0],guidePhraseApplicable:'No',guidePhraseApplicabilityRationale:'No maintained action in this mode.',guidePhraseApplicabilityReviewStatus:'Needs Review'};
 const pending = {...items[0],id:'FD-2'};
 const stages = [];
 HAZARD_ANALYSIS_REPAIR_STAGES.splice(0,HAZARD_ANALYSIS_REPAIR_STAGES.length);
 fetchLLMResponse.mockResolvedValue(JSON.stringify([{...assessed,id:'FD-2-STPA'}]));
 try {
  const rows=await runStandardHazardAnalysisStages({config:stpa,items:[reviewed,pending],onStageComplete:({rows})=>stages.push(rows)});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(fetchLLMResponse.mock.calls[0][0]).toContain('FD-2');
  expect(fetchLLMResponse.mock.calls[0][0]).not.toContain('FD-1');
  expect(rows).toHaveLength(2);
  expect(rows[0].guidePhraseApplicable).toBe('No');
  expect(rows[0].guidePhraseApplicabilityRationale).toBe('No maintained action in this mode.');
  expect(rows[0].hazards).toMatch(/^Not applicable/);
  expect(rows[1].hazards).toBe(assessed.hazards);
  expect(stages[0]).toHaveLength(2);
 } finally {HAZARD_ANALYSIS_REPAIR_STAGES.splice(0,HAZARD_ANALYSIS_REPAIR_STAGES.length,...original);}
});

test('an all-No STPA completes without an AI request even without review status', async () => {
 const {runStandardHazardAnalysisStages} = require('./aiAnalysisCodeHazardStandard');
 const stpa = {...config,rowIdSuffix:'STPA',fields:[['guidePhraseApplicable','Guide Phrase Applicable'],['hazards','Hazards']]};
 const reviewed={...items[0],guidePhraseApplicable:'No',guidePhraseApplicabilityRationale:'Inapplicable in this context.'};
 const rows=await runStandardHazardAnalysisStages({config:stpa,items:[reviewed]});
 expect(fetchLLMResponse).not.toHaveBeenCalled();
 expect(rows[0].hazards).toMatch(/^Not applicable/);
});

test('interrupted downloads are retried and recover without canceling the run', async () => {
 fetchLLMResponse.mockRejectedValueOnce(Object.assign(new Error('download interrupted'), {name:'NetworkError'}))
   .mockResolvedValue(JSON.stringify([assessed]));
 await expect(requestStandardRowsWithRetries(config, items)).resolves.toEqual([assessed]);
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
});

test('malformed JSON is retried rather than published as an assessment', async () => {
 fetchLLMResponse.mockResolvedValueOnce('```json\n[{"id":')
   .mockResolvedValue(JSON.stringify([assessed]));
 await expect(requestStandardRowsWithRetries(config, items)).resolves.toEqual([assessed]);
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
});

test('generation checkpoints survive a later stage failure and skip completed AI batches on resume', async () => {
 const { runStandardHazardAnalysisStages } = require('./aiAnalysisCodeHazardStandard');
 const data = new Map();
 const checkpoint = {
   read: jest.fn(async key => data.get(JSON.stringify(key))),
   write: jest.fn(async (key, value) => data.set(JSON.stringify(key), value)),
 };
 fetchLLMResponse.mockResolvedValue(JSON.stringify([assessed]));
 const stopAfterGeneration = jest.fn(async () => { throw new Error('fixture stage interruption'); });
 const input = {config, items, generationCheckpoint: checkpoint, onProgress: jest.fn(), onStageComplete: stopAfterGeneration};
 await expect(runStandardHazardAnalysisStages(input)).rejects.toThrow('fixture stage interruption');
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 await expect(runStandardHazardAnalysisStages(input)).rejects.toThrow('fixture stage interruption');
 expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 await expect(runStandardHazardAnalysisStages({...input, organizationContext:'Changed policy'})).rejects.toThrow('fixture stage interruption');
 expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
});

test('a failed worker stops queued batches and settles in-flight work before rejecting', async () => {
 const {mapWithConcurrency} = require('./aiAnalysisCodeHazardStandard');
 const started = [];
 let release;
 const pending = new Promise(resolve => {release = resolve;});
 let settled = false;
 const run = mapWithConcurrency([0,1,2,3],2,async item => {
   started.push(item);
   if(item === 0) throw new Error('fixture failure');
   await pending;
   settled = true;
 });
 const result = expect(run).rejects.toThrow('fixture failure');
 await Promise.resolve();
 expect(started).toEqual([0,1]);
 release();
 await result;
 expect(settled).toBe(true);
 expect(started).toEqual([0,1]);
});

test('a repair stage that reports a recoverable failure is not cached as completed', async () => {
 const {runStandardHazardAnalysisStages, HAZARD_ANALYSIS_REPAIR_STAGES} = require('./aiAnalysisCodeHazardStandard');
 const original = [...HAZARD_ANALYSIS_REPAIR_STAGES];
 const data = new Map();
 const checkpoint = {read: async key => data.get(JSON.stringify(key)), write: jest.fn(async(key,value)=>data.set(JSON.stringify(key),value))};
 fetchLLMResponse.mockResolvedValue(JSON.stringify([assessed]));
 HAZARD_ANALYSIS_REPAIR_STAGES.splice(0, HAZARD_ANALYSIS_REPAIR_STAGES.length,
   ['fixture-repair', async (_config, rows, _items, options) => {options.onRecoverableError(new Error('provider failed'));return rows;}]);
 try {
   await runStandardHazardAnalysisStages({config,items,generationCheckpoint:checkpoint,onProgress:()=>{},onStageComplete:async()=>{}});
   expect(checkpoint.write.mock.calls.map(([basis])=>basis.stage)).toEqual(['generation']);
 } finally {HAZARD_ANALYSIS_REPAIR_STAGES.splice(0,HAZARD_ANALYSIS_REPAIR_STAGES.length,...original);}
});
