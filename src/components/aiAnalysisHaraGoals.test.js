import { fetchLLMResponse } from './aiAnalysisSTPA';
import { consolidateProjectHaraGoals, parseHaraGoalGroups } from './aiAnalysisHaraGoals';
import { buildEffectiveOrganizationProfileContext, createOrganizationProfileRecord } from '../features/organization-profile/organizationProfile';
jest.mock('./aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
const candidates=[{id:'a',statement:'Deliver frames',outcome:'Missed emergency response',hazard:'A missed emergency delays assistance.'},{id:'b',statement:'Apply checksum',outcome:'False emergency alerts',hazard:'A false emergency alert diverts responders.'}];
const goal=(ids,statement='The emergency reporting item shall prevent missed emergency reports.')=>({statement,rationale:'A shared item-level harm-prevention objective.',memberIds:ids});
beforeEach(()=>jest.clearAllMocks());
test('rejects unknown, duplicate, missing and materially different outcome mappings',()=>{
  for(const goals of [[goal(['unknown'])],[goal(['a']),goal(['a'])],[goal(['a'])],[goal(['a','b'])]])expect(()=>parseHaraGoalGroups(JSON.stringify({goals}),candidates)).toThrow();
});
test('accepts complete separate goals and rejects implementation details and generic objectives',()=>{
  expect(parseHaraGoalGroups(JSON.stringify({goals:[goal(['a']),goal(['b'],'The emergency reporting item shall prevent false emergency alerts.')]}),candidates)).toHaveLength(2);
  expect(()=>parseHaraGoalGroups(JSON.stringify({goals:[goal(['a'],'The item shall retry every 100 ms.'),goal(['b'])]}),candidates)).toThrow();
  expect(()=>parseHaraGoalGroups(JSON.stringify({goals:[goal(['a'],'The item shall ensure safety.'),goal(['b'])]}),candidates)).toThrow();
});
const headers=['Guide Phrase Applicable','Safety Goal','Hazard Outcome','Vehicle-Level Hazard','Candidate Safety Requirements','Safety Goal Rationale','Assessment Gaps'];
const source=(statement,outcome='Missed emergency response')=>['Yes',statement,outcome,outcome,'','',''];
test('consolidates mechanism-level candidates into one justified goal while retaining each linked requirement',async()=>{
  const rows=[source('The capture function shall deliver frames at 10 Hz.'),source('The filter shall validate checksums.')];
  fetchLLMResponse.mockImplementation(async prompt=>{
    const batch=JSON.parse(prompt.split('Candidates:\n')[1]);
    return JSON.stringify({goals:[goal(batch.map(c=>c.id))]});
  });
  await consolidateProjectHaraGoals({headers,rows});
  expect(rows[0][1]).toBe(rows[1][1]);expect(rows[0][4]).toContain('10 Hz');expect(rows[1][4]).toContain('checksums');expect(rows[0][5]).toContain('harm-prevention');
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});
test('invalid catalogs use bounded retry and retain source candidates with explicit review gaps',async()=>{
  const rows=[source('The capture function shall deliver frames at 10 Hz.'),source('The filter shall validate checksums.')];
  fetchLLMResponse.mockResolvedValue('{"goals":[]}');
  await consolidateProjectHaraGoals({headers,rows});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);expect(rows.every(row=>row[1])).toBe(true);
  expect(rows[0][4]).toContain('frames');expect(rows[0][6]).toContain('original objective is retained');
});
test('durable catalog reuse avoids repeating semantic consolidation',async()=>{
  const cache=new Map(),checkpoint={read:async basis=>cache.get(basis.prompt),write:async(basis,value)=>cache.set(basis.prompt,value)};
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify({goals:[goal(JSON.parse(prompt.split('Candidates:\n')[1]).map(c=>c.id))]}));
  const makeRows=()=>[source('The capture function shall deliver frames.'),source('The filter shall validate checksums.')];
  const first=makeRows();await consolidateProjectHaraGoals({headers,rows:first,generationCheckpoint:checkpoint});
  fetchLLMResponse.mockClear();const second=makeRows();await consolidateProjectHaraGoals({headers,rows:second,generationCheckpoint:checkpoint});
  expect(fetchLLMResponse).not.toHaveBeenCalled();expect(second).toEqual(first);
});
test('goal consolidation applies the enabled full profile and override and isolates checkpoints on changes',async()=>{
  const cache=new Map(),checkpoint={read:async basis=>cache.get(basis.prompt),write:async(basis,value)=>cache.set(basis.prompt,value)};
  const profile=createOrganizationProfileRecord({enabled:true,markdown:'---\norganization: Goal fixture\nprofile_version: 1.0\nstatus: approved\n---\n# Custom Goal Policy\nORG-GOAL-POLICY: name the responsible vehicle.\n'});
  const context=buildEffectiveOrganizationProfileContext({profile,projectProfile:{mode:'inherit',overrideMarkdown:'PROJECT-GOAL-POLICY: preserve emergency response.'}});
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify({goals:[goal(JSON.parse(prompt.split('Candidates:\n')[1]).map(c=>c.id))]}));
  const run=organizationContext=>consolidateProjectHaraGoals({headers,rows:[source('The capture function shall deliver frames.'),source('The filter shall validate checksums.')],organizationContext,generationCheckpoint:checkpoint});
  await run(context);
  expect(fetchLLMResponse.mock.calls[0][0]).toContain('ORG-GOAL-POLICY');
  expect(fetchLLMResponse.mock.calls[0][0]).toContain('PROJECT-GOAL-POLICY');
  fetchLLMResponse.mockClear();await run(context);expect(fetchLLMResponse).not.toHaveBeenCalled();
  await run(context.replace('name the responsible vehicle','name the responsible item'));expect(fetchLLMResponse).toHaveBeenCalled();
  fetchLLMResponse.mockClear();await run(buildEffectiveOrganizationProfileContext({profile:{...profile,enabled:false}}));
  expect(fetchLLMResponse).toHaveBeenCalled();expect(fetchLLMResponse.mock.calls[0][0]).not.toContain('ORG-GOAL-POLICY');
});
test('large member lists do not inflate requests or prevent consolidation',async()=>{
  const rows=Array.from({length:6000},(_,i)=>source(i%2?'The filter shall validate checksums.':'The capture function shall deliver frames.'));
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify({goals:[goal(JSON.parse(prompt.split('Candidates:\n')[1]).map(c=>c.id))]}));
  await consolidateProjectHaraGoals({headers,rows});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(fetchLLMResponse.mock.calls[0][0].length).toBeLessThan(3000);
  expect(new Set(rows.map(row=>row[1])).size).toBe(1);
  expect(rows.every(row=>row[4])).toBe(true);
});
test('later passes preserve different emergency outcomes even if the first candidate has neutral wording',()=>{
  const catalog=[{id:'a',statement:'Report a service interruption',outcome:'Service interruption',hazard:'Unavailable reporting',outcomeKinds:['missed-emergency']},candidates[1]];
  expect(()=>parseHaraGoalGroups(JSON.stringify({goals:[goal(['a','b'])]}),catalog)).toThrow(/cannot be consolidated/);
});
