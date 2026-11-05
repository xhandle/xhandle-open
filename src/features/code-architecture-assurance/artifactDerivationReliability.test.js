import { deriveFunctionalSoftwareRequirements, deriveSoftwareRequirements, deriveSystemRequirements, deriveSubsystemRequirements, deriveDesignElements, finalDeduplicateArtifactRows } from './artifactAI';
jest.mock('../../components/backendConfig', () => ({ backendURL:'https://synthetic.invalid', buildAIAuthOpts:()=>({headers:{}}) }));

const definitions = [
  ['software', deriveFunctionalSoftwareRequirements, 'cbaRows'],
  ['system', deriveSystemRequirements, 'softwareRequirements'],
  ['subsystem', deriveSubsystemRequirements, 'systemRequirements'],
  ['design', deriveDesignElements, 'subsystemRequirements'],
];
function input(kind, size, counter = {reads:0}) {
  return Array.from({length:size}, (_, i) => {
    const row = kind === 'software' ? {from:'sensor',to:'monitor',action:'observe',fromFile:'sensor.cpp',toFile:'monitor.cpp'}
      : {requirementText:'The software shall validate observation channel ' + i, source:'functional-derived'};
    Object.defineProperty(row, kind === 'software' ? 'traceId' : 'id', {enumerable:true,get(){counter.reads++;return 'source-' + i;}});
    return row;
  });
}
let nextId;
function successfulResponse(options) {
  const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
  const key = ['functionalDecomposition','sourceRequirements','draftCategories','softwareRequirementCategories','systemRequirementCategories','subsystemRequirementCategories','candidateSystemRequirements','candidateSubsystemRequirements','candidateDesignElements'].find(k => Array.isArray(payload[k]));
  const responseKey = Object.keys(payload.schema)[0], template = payload.schema[responseKey][0];
  const parent = Object.keys(template).find(k => /^parent/.test(k));
  const rows = (payload[key] || []).map(row => {
    const n = ++nextId, parents = row[parent] || row.id;
    if (responseKey === 'categories') return {id:'CAT-'+n,categoryName:'Observation '+n,categoryDescription:'Observe independent channel '+n,requirementIntent:'observe independent channel '+n,[parent]:parents};
    if (responseKey === 'designElements') return {id:'DES-'+n,designElementName:'Observer'+n,description:'The observer coordinates independently timed channel '+n,[parent]:parents};
    return {id:'REQ-'+n,requirementText:'The system shall reject stale measurements for independent channel '+n,sourceTraceId:row.traceId,[parent]:parents};
  });
  return {ok:true,json:async()=>({answer:JSON.stringify({[responseKey]:rows})})};
}
beforeEach(() => {
  nextId = 0;
  jest.spyOn(console,'info').mockImplementation(()=>{});
  jest.spyOn(console,'warn').mockImplementation(()=>{});
  global.fetch = jest.fn(async (_url, options) => successfulResponse(options));
});
afterEach(() => jest.restoreAllMocks());

test.each(definitions)('%s console diagnostics retain only bounded batch metadata', async (kind, derive, key) => {
  await derive({[key]:input(kind,12)});
  expect(console.info).toHaveBeenCalled();
  for (const [label, details] of console.info.mock.calls) {
    expect(label.length).toBeLessThan(250);
    expect(Object.keys(details).every(key => ['rowCount', 'promptChars', 'responseChars'].includes(key))).toBe(true);
    expect(Object.values(details).every(value => typeof value === 'number')).toBe(true);
  }
});

test.each(definitions)('%s reuses source indexes as input grows by 50 percent', async (kind, derive, key) => {
  const reads = [];
  for (const count of [100,150]) {
    const counter = {reads:0}, result = await derive({[key]:input(kind,count,counter)});
    expect(result.length).toBeGreaterThan(0);
    reads.push(counter.reads);
  }
  expect(reads[1] / reads[0]).toBeLessThan(1.65);
});

test.each(definitions.slice(1))('%s reports failed AI passes and labels locally synthesized output', async (kind, derive, key) => {
  global.fetch.mockResolvedValue({ok:false,status:400,text:async()=>'Synthetic provider rejection'});
  const result = await derive({[key]:input(kind,6)});
  expect(result.length).toBeGreaterThan(0);
  expect(result.every(row => /fallback|code-derived/.test(row.source))).toBe(true);
  expect(result.derivationReport.failedBatches).toBeGreaterThan(0);
  expect(result.derivationReport.fallbackRows).toBe(result.length);
  expect(result.derivationReport.failures[0]).toContain('Synthetic provider rejection');
});

test.each(definitions.slice(1))('%s treats empty successful responses as incomplete derivation', async (kind, derive, key) => {
  global.fetch.mockResolvedValue({ok:true,json:async()=>({answer:'{"requirements":[],"categories":[],"designElements":[]}'})});
  const result = await derive({[key]:input(kind,6)});
  expect(result.length).toBeGreaterThan(0);
  expect(result.derivationReport.failedBatches).toBeGreaterThan(0);
  expect(result.every(row=>row.source.includes('fallback'))).toBe(true);
});

test('a failed consolidation preserves AI-authored first-pass provenance and reports partial completion', async () => {
  global.fetch.mockImplementation(async (_url, options) => {
    const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    if (payload.task === 'consolidate_system_requirements_to_higher_abstraction') return {ok:false,status:400,text:async()=>'Consolidation rejected'};
    return successfulResponse(options);
  });
  const result = await deriveSystemRequirements({softwareRequirements:input('system',12)});
  expect(result.derivationReport.failedBatches).toBeGreaterThan(0);
  expect(result.some(row => row.source === 'ai-generated' && row.derivationStatus === 'partial')).toBe(true);
});

test('hazard safety parents survive provider failure with explicit fallback provenance', async () => {
  global.fetch.mockResolvedValue({ok:false,status:400,text:async()=>'Provider rejected'});
  const result = await deriveSystemRequirements({softwareRequirements:[{id:'SWR-SAFE-001',source:'hazard-derived',requirementText:'The software shall prevent unsafe launch.',linkedHazards:'HZ-001'}]});
  expect(result).toHaveLength(1);
  expect(result[0].parentSwRequirement).toContain('SWR-SAFE-001');
  expect(result[0].linkedHazards).toContain('HZ-001');
  expect(result[0].source).toContain('fallback');
  expect(result.derivationReport.failedBatches).toBeGreaterThan(0);
});

test('paged hazard import keeps absolute row identities and rejects incomplete input before AI', async () => {
  const headers = ['Hazard','Software Safety Requirement','Safety Significant'];
  const hazardAnalysis = {id:'hazards',hazardMethod:'STPA',async *readSummaryBatches(){
    yield {headers,offset:0,rows:[['hazard 1','Prevent unsafe launch','Yes'],['excluded','Excluded','No']]};
    yield {headers,offset:2,rows:[['hazard 3','Reject stale command','Yes']]};
  }};
  const result = await deriveSoftwareRequirements({cbaRows:input('software',1),hazardAnalysis});
  expect(result.filter(row=>row.source==='hazard-derived').map(row=>row.hazardSummaryRef)).toEqual(['HZ-001','HZ-003']);
  expect(result.derivationReport).toMatchObject({hazardRows:3,excludedSafetyRows:1,importedSafetyRows:2});
  global.fetch.mockClear();
  await expect(deriveSoftwareRequirements({cbaRows:input('software',1),hazardAnalysis:{...hazardAnalysis,finalSavePending:true}})).rejects.toThrow('Complete and save');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('paged legacy record summaries retain absolute safety row identities', async () => {
  const hazardAnalysis = {id:'legacy', async *readSummaryBatches(){
    yield {records:true,offset:0,rows:[{Hazard:'One','Safety Requirement':'Prevent unsafe launch'}]};
    yield {records:true,offset:1,rows:[{Hazard:'Two','Safety Requirement':'Reject stale command'}]};
  }};
  const result = await deriveSoftwareRequirements({cbaRows:input('software',1),hazardAnalysis});
  expect(result.filter(row=>row.source==='hazard-derived').map(row=>row.hazardSummaryRef)).toEqual(['HZ-001','HZ-002']);
});

test('deduplication retains trace coverage, first-match order, and the minimum row count', async () => {
  const rows = [
    {id:'a',requirementText:'The system shall reject stale observations.',parentSwRequirement:'one'},
    {id:'b',requirementText:'The system shall route valid commands.',parentSwRequirement:'two'},
    {id:'c',requirementText:'The system shall reject stale observations.',parentSwRequirement:'three'},
    {id:'d',requirementText:'The system shall reject stale observations.',parentSwRequirement:'four'},
  ];
  const merged = await finalDeduplicateArtifactRows(rows,'system-requirements',2);
  expect(merged.map(row=>row.id)).toEqual(['a','b']);
  expect(merged[0].parentSwRequirement).toBe('one, three, four');
  const limited = await finalDeduplicateArtifactRows(rows,'system-requirements',3);
  expect(limited.map(row=>row.id)).toEqual(['a','b','d']);
});

test.each([1,50,180])('indexed fuzzy deduplication matches greedy Jaccard semantics with a %s-row floor', async minimum => {
  const rows = Array.from({length:200}, (_,i) => {
    const group = Math.floor(i/5), variant = i%5;
    const words = Array.from({length:30},(_,j)=>`family${group}term${j}`);
    if (variant) words[29] = `variant${variant}`;
    if (variant===4) words[28] = 'different';
    return {id:'row-'+i,requirementText:words.join(' '),parentSwRequirement:'parent-'+i};
  });
  // A deliberately simple reference scan validates the indexed implementation,
  // including fuzzy threshold boundaries and greedy ordering after the floor.
  const expected = [];
  rows.forEach((row,i) => {
    const words = new Set(row.requirementText.split(' '));
    const match = expected.findIndex(candidate => {
      const left = new Set(candidate.requirementText.split(' '));
      const intersection = [...words].filter(word=>left.has(word)).length;
      return intersection/(words.size+left.size-intersection)>=0.92;
    });
    if (match>=0 && expected.length+rows.length-i-1>=minimum) expected[match] = {...expected[match],parentSwRequirement:expected[match].parentSwRequirement+', '+row.parentSwRequirement};
    else expected.push(row);
  });
  const actual = await finalDeduplicateArtifactRows(rows,'system-requirements',minimum);
  expect(actual.map(row=>[row.id,row.parentSwRequirement])).toEqual(expected.map(row=>[row.id,row.parentSwRequirement]));
});
