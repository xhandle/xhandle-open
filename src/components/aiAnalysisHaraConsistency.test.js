import { fetchLLMResponse } from './aiAnalysisSTPA';
import { buildEffectiveOrganizationProfileContext, createOrganizationProfileRecord } from '../features/organization-profile/organizationProfile';
import { reconcileProjectHaraExposure } from './aiAnalysisHaraConsistency';
jest.mock('./aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
const headers=['Guide Phrase Applicable','Operational Situation','Operational Scenario','Operational Mode','Operating Conditions','Exposure','Exposure Rationale','Exposure Evidence','Assessment Assumptions','Assessment Basis','Severity','Controllability'];
const makeRows=()=>[['Yes','Passenger emergency in siren noise','','Emergency','Siren','E2','The active-call situation is infrequent.','','','','S3','C3'],['Yes','Passenger emergency in siren noise','','Emergency','Siren','E3','The active-call situation is foreseeable.','','','','S2','C2']];
beforeEach(()=>jest.clearAllMocks());
test('one engineering exposure decision resolves equivalent situations without changing injury or controllability',async()=>{
  fetchLLMResponse.mockResolvedValue(JSON.stringify({id:'situation-1',exposure:'E2',rationale:'Active emergency calls coinciding with siren noise occupy a small proportion of intended service time.',assumptions:'A low proportion of service time is assumed in the absence of fleet frequency records.',evidence:'Engineering judgment'}));
  const rows=makeRows();await reconcileProjectHaraExposure({headers,rows});
  expect(rows.every(row=>row[5]==='E2')).toBe(true);expect(rows[0][10]).toBe('S3');expect(rows[1][10]).toBe('S2');expect(rows[1][11]).toBe('C2');
  expect(rows.every(row=>row[9]==='Engineering judgment')).toBe(true);expect(rows[0][8]).toContain('assumed');
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});
test('failure probability cannot be used to reconcile exposure and bounded retry repairs it',async()=>{
  fetchLLMResponse.mockResolvedValueOnce(JSON.stringify({id:'situation-1',exposure:'E3',rationale:'Exposure is high because network failure rates are high.'})).mockResolvedValueOnce(JSON.stringify({id:'situation-1',exposure:'E2',rationale:'The combined operating situation occupies a low fraction of service time.',assumptions:'Low service-time exposure estimate.',evidence:'Engineering judgment'}));
  const rows=makeRows();await reconcileProjectHaraExposure({headers,rows});expect(rows[0][5]).toBe('E2');expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
});
test('consistent exposure needs no extra provider call',async()=>{
  const rows=makeRows();rows[1][5]='E2';await reconcileProjectHaraExposure({headers,rows});expect(fetchLLMResponse).not.toHaveBeenCalled();
});
test('exposure reconciliation applies enabled custom profile guidance and overrides with context-sensitive reuse',async()=>{
  const profile=createOrganizationProfileRecord({enabled:true,markdown:'---\norganization: Exposure fixture\nprofile_version: 1.0\nstatus: approved\n---\n# Fleet Frequency Evidence\nORG-EXPOSURE-POLICY: use operational frequency evidence.\n'});
  const context=buildEffectiveOrganizationProfileContext({profile,projectProfile:{mode:'inherit',overrideMarkdown:'PROJECT-EXPOSURE-POLICY: active-call frequency records govern.'}});
  const cache=new Map(),checkpoint={read:async basis=>cache.get(basis.prompt),write:async(basis,value)=>cache.set(basis.prompt,value)};
  fetchLLMResponse.mockResolvedValue(JSON.stringify({id:'situation-1',exposure:'E2',rationale:'Active calls occupy a low share of service time.',evidence:'Fleet frequency records'}));
  const run=organizationContext=>reconcileProjectHaraExposure({headers,rows:makeRows(),organizationContext,generationCheckpoint:checkpoint});
  await run(context);
  expect(fetchLLMResponse.mock.calls[0][0]).toContain('ORG-EXPOSURE-POLICY');
  expect(fetchLLMResponse.mock.calls[0][0]).toContain('PROJECT-EXPOSURE-POLICY');
  fetchLLMResponse.mockClear();await run(context);expect(fetchLLMResponse).not.toHaveBeenCalled();
  await run(context.replace('active-call frequency','updated crossing frequency'));expect(fetchLLMResponse).toHaveBeenCalled();
  fetchLLMResponse.mockClear();await run(buildEffectiveOrganizationProfileContext({profile,projectProfile:{mode:'disabled'}}));
  expect(fetchLLMResponse).toHaveBeenCalled();expect(fetchLLMResponse.mock.calls[0][0]).not.toContain('ORG-EXPOSURE-POLICY');
});
test('distinct operating situations within one intentionally selected scenario retain separate exposures',async()=>{
  const rows=makeRows();rows.forEach(row=>{row[2]='Urban robotaxi service';});
  rows[0][1]='Routine passenger conversation';rows[1][1]='An occupant requires emergency assistance';
  await reconcileProjectHaraExposure({headers,rows});
  expect(fetchLLMResponse).not.toHaveBeenCalled();expect(rows.map(row=>row[5])).toEqual(['E2','E3']);
});
test('an invalid response cannot silently overwrite existing exposure decisions',async()=>{
  fetchLLMResponse.mockResolvedValue('{"id":"unknown","exposure":"E4","rationale":"Highest class"}');
  const rows=makeRows();await expect(reconcileProjectHaraExposure({headers,rows})).rejects.toThrow(/could not be completed/);
  expect(rows.map(row=>row[5])).toEqual(['E2','E3']);expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
});
test('large conflicting situations read every distinct argument through bounded saved decisions',async()=>{
  const rows=Array.from({length:320},(_,i)=>{
    const row=[...makeRows()[i%2]];row[6]=`Operational frequency record ${i}: ${'The situation occupies a small part of service time. '.repeat(10)}`;return row;
  });
  const covered=new Set(),cache=new Map();
  const checkpoint={read:async basis=>cache.get(basis.prompt),write:async(basis,value)=>cache.set(basis.prompt,value)};
  fetchLLMResponse.mockImplementation(async prompt=>{
    expect(prompt.length).toBeLessThan(54000);
    const input=JSON.parse(prompt.split('Situation:\n')[1]);
    for(const decision of input.decisions){const match=decision.rationale.match(/Operational frequency record (\d+):/);if(match)covered.add(Number(match[1]));}
    return JSON.stringify({id:input.id,exposure:'E2',rationale:'The operational situation occupies a small fraction of intended service time.',assumptions:'Low duration share based on the supplied frequency arguments.',evidence:'Engineering judgment'});
  });
  await reconcileProjectHaraExposure({headers,rows,generationCheckpoint:checkpoint});
  expect(covered.size).toBe(320);expect(rows.every(row=>row[5]==='E2')).toBe(true);expect(cache.size).toBeGreaterThan(1);
});
