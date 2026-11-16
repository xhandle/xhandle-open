import { fetchLLMResponse } from './aiAnalysisSTPA';
import { generateStandardCodeHazardAnalysisSheets } from './aiAnalysisCodeHazardStandard';
import { generateProjectHaraAnalysisSheets } from './aiAnalysisProjectHara';
import { buildEffectiveOrganizationProfileContext, createOrganizationProfileRecord } from '../features/organization-profile/organizationProfile';
jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
jest.mock('./aiAnalysisCodeHazardStandard', () => ({ generateStandardCodeHazardAnalysisSheets: jest.fn() }));

const sourceHeaders = ['Function (From)','Control Action','Function (To)','Guide Phrase','Guide Phrase Applicable','Loss','Hazard','Unsafe Control Action','Causal Scenario','Safety Constraint','Operational Scenario','Operational Mode','Operating Conditions','Raw Analysis Row ID'];
const source = ['Vehicle controller','Brake command','Brake actuator','Not providing the control action causes a hazard','Yes','Pedestrian injury','Vehicle fails to stop','Controller omits braking','Brake command lost at crossing','The vehicle shall stop at occupied crossings.','Urban pedestrian crossing','Automated driving','Wet pavement','raw-1'];
const assessment = (id='event-1') => ({id, applicabilityDecision:'Yes',safetySignificant:'Yes',safetySignificanceRationale:'Loss of braking can cause fatal pedestrian impact.',itemDefinition:'Automated braking item.',malfunction:'Loss of braking',vehicleHazard:'The vehicle enters an occupied crossing without stopping.',harmChain:'Lost braking allows crossing entry, causing fatal pedestrian impact.',evidenceBasis:'E/E malfunction',hazardOutcome:'Failure to stop at an occupied crossing',hazardMappingReview:'Supported: both concern failure to stop at a crossing.',hazardousEvent:'Automated vehicle fails to stop at an occupied crossing.',potentialHarm:'Fatal pedestrian injury.',personsAtRisk:'Pedestrians',severity:'S3',severityRationale:'A collision can fatally injure a pedestrian.',exposure:'E4',exposureRationale:'Occupied crossings are encountered frequently.',exposureEvidence:'Occupied crossings are encountered frequently.',controllability:'C3',controllabilityRationale:'No driver is present and pedestrians cannot avoid the vehicle.',safetyGoal:'The vehicle shall prevent loss of braking at occupied crossings.',safeState:'Vehicle stopped.',safeStateJustification:'Stopping prevents crossing entry and pedestrian impact.',ftti:'100 ms',fttiRationale:'Engineering estimate: the fault-to-crossing interval requires braking within 100 ms.'});
let publications;
beforeEach(() => {
  jest.clearAllMocks(); publications = [];
  generateStandardCodeHazardAnalysisSheets.mockResolvedValue({Summary:[sourceHeaders,source]});
  fetchLLMResponse.mockResolvedValue(JSON.stringify({assessments:[assessment()]}));
});
const options = () => ({ sheets:{'Functional Decomposition':[['Function (From)','Function (From) Details','Control Action','Control Action Details','Function (To)'],['Controller','Interleaved details','Brake','Torque','Actuator']]},tableRows:[{hazardDraftIdentity:'draft-context-phrase'}],itemDefinition:'Automated vehicle brake control; no human driver.',currentFolder:'Project',setFolders:async updater=>publications.push(updater({})),operationalContext:'Urban crossing, wet pavement. Occupied crossings are encountered frequently.',organizationContext:'Customer evidence governs ratings.' });
test('reuses Projects STPA mechanics then assesses HARA with context and calculates ASIL rather than trusting AI', async () => {
  fetchLLMResponse.mockResolvedValue(JSON.stringify({assessments:[{...assessment(),asil:'QM'}]}));
  const result = await generateProjectHaraAnalysisSheets(options());
  expect(generateStandardCodeHazardAnalysisSheets).toHaveBeenCalledWith(expect.objectContaining({method:'STPA',omitConsolidatedRequirement:true,sheets:options().sheets}));
  const prompt = fetchLLMResponse.mock.calls[0][0];
  expect(prompt).toContain('Unsafe Control Action'); expect(prompt).toContain('Vehicle fails to stop');
  expect(prompt).toContain('never the malfunction/failure probability'); expect(prompt).toContain('no human driver');
  const cell = name => result.Summary[1][result.Summary[0].indexOf(name)];
  expect(cell('ASIL')).toBe('ASIL D'); expect(cell('Raw Analysis Row ID')).toBe('draft-context-phrase');
  expect(result['Safety Goals'][1][2]).toMatch(/^ASIL D/); expect(publications.length).toBeGreaterThan(1);
});
test('provider/schema failure preserves the upstream hazard evidence without invented ratings', async () => {
  fetchLLMResponse.mockResolvedValue('{"assessments":[]}');
  await expect(generateProjectHaraAnalysisSheets(options())).rejects.toThrow(/Saved hazard evidence is retained/);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
  const saved = publications[0].Project.Summary;
  expect(saved[1][saved[0].indexOf('ASIL')]).toBe('Not assessed');
  expect(saved[1][saved[0].indexOf('Hazard')]).toBe('Vehicle fails to stop');
});
test('plural STPA loss, hazard, unsafe-action and constraint fields map explicitly into HARA', async () => {
  const aliases={'Loss':'Losses','Hazard':'Hazards','Unsafe Control Action':'Unsafe Control Actions','Safety Constraint':'Safety Requirements/Constraints'};
  generateStandardCodeHazardAnalysisSheets.mockResolvedValue({Summary:[sourceHeaders.map(header=>aliases[header]||header),source]});
  const result=await generateProjectHaraAnalysisSheets(options());
  const cell=name=>result.Summary[1][result.Summary[0].indexOf(name)];
  expect(cell('Unsafe Control Action')).toBe('Controller omits braking');
  expect(cell('Safety Constraint')).toBe('The vehicle shall stop at occupied crossings.');
  expect(cell('Loss')).toBe('Pedestrian injury'); expect(cell('Hazard')).toBe('Vehicle fails to stop');
  expect(cell('Assessment Gaps')).not.toContain('Controller omits braking');
});
test('reviewed non-applicable guide phrases do not request ratings', async () => {
  const no = [...source]; no[4] = 'No';
  generateStandardCodeHazardAnalysisSheets.mockResolvedValue({Summary:[sourceHeaders,no]});
  const result = await generateProjectHaraAnalysisSheets(options());
  expect(fetchLLMResponse).not.toHaveBeenCalled();
  expect(result['Safety Goals']).toHaveLength(1);
});
test('cancellation before generation makes no provider call', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(generateProjectHaraAnalysisSheets({...options(),signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(generateStandardCodeHazardAnalysisSheets).not.toHaveBeenCalled();
});
test('unknown ids fail validation and bounded retry repairs the response', async () => {
  fetchLLMResponse.mockResolvedValueOnce(JSON.stringify({assessments:[assessment('unknown')]}));
  const result = await generateProjectHaraAnalysisSheets(options());
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2); expect(result.Summary).toHaveLength(2);
});

const promptEvents = prompt => JSON.parse(prompt.match(/Events:\n(\[[\s\S]*\])/)[1]);
const truncated = () => Object.assign(new Error('Response reached its output limit.'), {name:'TruncatedResponseError',responseMetadata:{finishReason:'length'}});
const multipleEvents = count => {
  generateStandardCodeHazardAnalysisSheets.mockResolvedValue({Summary:[sourceHeaders,...Array.from({length:count},(_,index)=>source.map((value,column)=>column===sourceHeaders.indexOf('Raw Analysis Row ID')?'raw-'+(index+1):value))]});
  return {...options(),tableRows:Array.from({length:count},(_,index)=>({rawAnalysisRowId:'raw-'+(index+1)}))};
};
test('HARA requests reserve enough output for every field instead of the generic proxy default', async () => {
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify({assessments:promptEvents(prompt).map(input=>assessment(input.id))}));
  const result=await generateProjectHaraAnalysisSheets(multipleEvents(3));
  expect(fetchLLMResponse.mock.calls[0][4]).toMatchObject({maxTokens:12000,workflow:'hazard-row-generation'});
  expect(result.Summary).toHaveLength(4);
});
test('a truncated batch shrinks immediately and completes all 137 events without repeating the oversized batch', async () => {
  const sizes=[],ids=[];
  fetchLLMResponse.mockImplementation(async prompt=>{
    const inputs=promptEvents(prompt);sizes.push(inputs.length);
    if(inputs.length>1)throw truncated();
    ids.push(inputs[0].id);return JSON.stringify({assessments:[assessment(inputs[0].id)]});
  });
  const result=await generateProjectHaraAnalysisSheets(multipleEvents(137));
  expect(sizes.slice(0,4)).toEqual([3,1,1,1]);expect(sizes).toHaveLength(138);
  expect(new Set(ids).size).toBe(137);expect(result.Summary).toHaveLength(138);
  for(let index=1;index<result.Summary.length;index++){
    expect(result.Summary[index][result.Summary[0].indexOf('Raw Analysis Row ID')]).toBe('raw-'+index);
    expect(result.Summary[index][result.Summary[0].indexOf('ASIL')]).toBe('ASIL D');
  }
});
test('a truncated singleton retries automatically with a larger bounded allowance', async () => {
  fetchLLMResponse.mockRejectedValueOnce(truncated());
  const result=await generateProjectHaraAnalysisSheets(options());
  expect(fetchLLMResponse.mock.calls.map(call=>call[4].maxTokens)).toEqual([12000,16000]);
  expect(fetchLLMResponse.mock.calls[1][0]).toMatch(/concise|complete JSON/i);
  expect(result.Summary[1][result.Summary[0].indexOf('ASIL')]).toBe('ASIL D');
});
test('exhausted output recovery is bounded and preserves completed events without inventing the remaining ratings', async () => {
  fetchLLMResponse.mockImplementation(async prompt=>{
    const inputs=promptEvents(prompt);
    if(inputs.length>1||inputs[0].id==='event-2')throw truncated();
    return JSON.stringify({assessments:[assessment(inputs[0].id)]});
  });
  await expect(generateProjectHaraAnalysisSheets(multipleEvents(2))).rejects.toThrow(/Saved hazard evidence is retained/);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(4);
  const saved=publications.at(-1).Project.Summary;
  expect(saved[1][saved[0].indexOf('Severity')]).toBe('S3');
  expect(saved[2][saved[0].indexOf('Severity')]).toBe('');
  expect(saved[2][saved[0].indexOf('ASIL')]).toBe('Not assessed');
  expect(saved[2][saved[0].indexOf('Hazard')]).toBe('Vehicle fails to stop');
});
test('cancellation during output recovery stops before another request', async () => {
  const controller=new AbortController();fetchLLMResponse.mockRejectedValue(truncated());
  await expect(generateProjectHaraAnalysisSheets({...multipleEvents(3),signal:controller.signal,onProgress:progress=>{
    if(/output limit/.test(progress.message))controller.abort();
  }})).rejects.toMatchObject({name:'AbortError'});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});

test('durable HARA batches bound full-workbook publications and reuse every saved assessment', async () => {
  const saved = new Map();
  const generationCheckpoint = { read: jest.fn(async key => saved.get(JSON.stringify(key))), write: jest.fn(async (key, value) => saved.set(JSON.stringify(key), value)) };
  const input = multipleEvents(1026);
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify({ assessments: promptEvents(prompt).map(input => assessment(input.id)) }));
  const first = await generateProjectHaraAnalysisSheets({ ...input, generationCheckpoint });
  expect(first.Summary).toHaveLength(1027);
  expect(publications.length).toBeLessThanOrEqual(4);
  expect(generationCheckpoint.write).toHaveBeenCalledTimes(342);
  fetchLLMResponse.mockClear();
  const resumed = await generateProjectHaraAnalysisSheets({ ...input, generationCheckpoint });
  expect(fetchLLMResponse).not.toHaveBeenCalled();
  expect(resumed).toEqual(first);
});

test('cancelling a checkpointed HARA batch flushes completed ratings before propagating abort', async () => {
  const controller = new AbortController();
  const generationCheckpoint = { read: async () => null, write: async () => {} };
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify({ assessments: promptEvents(prompt).map(input => assessment(input.id)) }));
  await expect(generateProjectHaraAnalysisSheets({ ...multipleEvents(9), generationCheckpoint, signal: controller.signal,
    onProgress: patch => { if (/events 4/.test(patch.message)) controller.abort(); },
  })).rejects.toMatchObject({ name: 'AbortError' });
  const [headers, ...rows] = publications.at(-1).Project.Summary;
  expect(rows.slice(0, 3).every(row => row[headers.indexOf('Severity')] === 'S3')).toBe(true);
  expect(rows.slice(3).every(row => !row[headers.indexOf('Severity')])).toBe(true);
});

test('generation repairs unsound risk arguments and returns a complete decision rather than withheld results',async()=>{
  fetchLLMResponse.mockResolvedValueOnce(JSON.stringify({assessments:[{...assessment(),severity:'S2',severityRationale:'Death is not certain if fallback mechanisms activate.',exposure:'E3',exposureEvidence:'',exposureRationale:'Exposure is medium because dispatch receipt failures are common.',controllability:'C3',controllabilityRationale:'Passengers cannot detect or repair an internal audio fault.',safeState:'Activate undocumented cellular fallback.',ftti:'200 ms',fttiRationale:'Covers 2 consecutive frames.'}]}));
  const result=await generateProjectHaraAnalysisSheets(options()),cell=name=>result.Summary[1][result.Summary[0].indexOf(name)];
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);expect(fetchLLMResponse.mock.calls[1][0]).toContain('EXPOSURE_FAILURE_BASIS');
  expect(cell('Severity')).toBe('S3');expect(cell('Exposure')).toBe('E4');expect(cell('Controllability')).toBe('C3');expect(cell('ASIL')).toBe('ASIL D');
  expect(cell('Safe State')).toBe('Vehicle stopped.');expect(cell('Fault Tolerant Time Interval')).toBe('100 ms');
  expect(cell('Assessment Status')).toBe('Complete');expect(cell('Assessment Basis')).toBe('Engineering judgment');
  expect(cell('Assessment Assumptions')).toContain('engineering estimate');
  expect(result['HARA Coverage'][3][1]).toBe('Scenario-specific HARA for the selected operational scenario.');
});
test('an evidence-absence exclusion is reviewed rather than treated as established non-applicability',async()=>{
  const headers=[...sourceHeaders,'Guide Phrase Applicability Rationale'],no=[...source,'No interface evidence was provided.'];no[4]='No';
  generateStandardCodeHazardAnalysisSheets.mockResolvedValue({Summary:[headers,no]});
  const result=await generateProjectHaraAnalysisSheets(options()),get=name=>result.Summary[1][result.Summary[0].indexOf(name)];
  expect(fetchLLMResponse).toHaveBeenCalled();expect(get('Guide Phrase Applicable')).toBe('Yes');
  expect(get('Assessment Status')).toBe('Complete');
});
test('substantive verification procedures on excluded rows survive as linked review candidates',async()=>{
  const no=[...source];no[4]='No';
  generateStandardCodeHazardAnalysisSheets.mockResolvedValue({Summary:[[...sourceHeaders,'Verification Method'],[...no,'Inject dropped audio frames and measure emergency response.']]});
  const result=await generateProjectHaraAnalysisSheets(options()),get=name=>result.Summary[1][result.Summary[0].indexOf(name)];
  expect(fetchLLMResponse).not.toHaveBeenCalled();expect(get('Excluded Candidate Verification')).toContain('Inject dropped audio');
  expect(get('HARA Review Findings')).toContain('EXCLUDED_VERIFICATION');expect(get('ASIL')).toBe('Not applicable');
});
test('generation consolidates per-function goal mechanisms while preserving candidate requirements and event links',async()=>{
  fetchLLMResponse.mockImplementation(async prompt=>{
    if(prompt.startsWith('Consolidate these HARA')){
      const candidates=JSON.parse(prompt.split('Candidates:\n')[1]);
      return JSON.stringify({goals:[{statement:'The vehicle shall prevent loss of braking at occupied crossings.',rationale:'These functions contribute to the same vehicle-level stopping objective.',memberIds:candidates.map(candidate=>candidate.id)}]});
    }
    return JSON.stringify({assessments:promptEvents(prompt).map(input=>({...assessment(input.id),safetyGoal:`The ${input.id} function shall deliver frames at 10 Hz.`}))});
  });
  const result=await generateProjectHaraAnalysisSheets(multipleEvents(6)),column=name=>result.Summary[0].indexOf(name);
  expect(new Set(result.Summary.slice(1).map(row=>row[column('Safety Goal ID')])).size).toBe(1);
  expect(result['Safety Goals']).toHaveLength(2);expect(result['Safety Goals'][1][3].split('; ')).toHaveLength(6);
  expect(result.Summary.slice(1).every(row=>row[column('Candidate Safety Requirements')].includes('10 Hz'))).toBe(true);
});


test.each([true,false])('Projects HARA uses effective profile enabled=%s in both STPA and risk assessment',async enabled=>{
  const profile=createOrganizationProfileRecord({enabled,markdown:'---\norganization: HARA fixture\nprofile_version: 1.0\nstatus: approved\n---\n# Custom Injury Evidence\nORG-HARA-POLICY: use crossing injury evidence.\n'});
  const organizationContext=buildEffectiveOrganizationProfileContext({profile,projectProfile:{mode:'inherit',overrideMarkdown:'PROJECT-HARA-POLICY: preserve pedestrian harm chains.'}});
  const result=await generateProjectHaraAnalysisSheets({...options(),organizationContext});
  expect(generateStandardCodeHazardAnalysisSheets).toHaveBeenCalledWith(expect.objectContaining({organizationContext}));
  for(const [prompt] of fetchLLMResponse.mock.calls){
    if(enabled){expect(prompt).toContain('ORG-HARA-POLICY');expect(prompt).toContain('PROJECT-HARA-POLICY');}
    else{expect(prompt).not.toContain('ORG-HARA-POLICY');expect(prompt).not.toContain('PROJECT-HARA-POLICY');}
  }
  expect(result.Summary[1][result.Summary[0].indexOf('ASIL')]).toBe('ASIL D');
});
