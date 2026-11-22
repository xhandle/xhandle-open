import {evaluateSourceArithmetic, sourceArithmeticFacts, sourceArithmeticAnchors, validateSourceArithmetic} from './sourceArithmetic';
import {validateFastAssessment} from './fastHazardSchema';
import {resultsFirstPrompt, generateFastHazards} from './resultsFirstHazardPipeline';
import {screenFastApplicability} from './fastHazardApplicability';
import {answer} from './fastHazardTestFixtures';

jest.mock('../../components/aiAnalysisSTPA', () => ({fetchLLMResponse: () => {throw Error('Live provider calls forbidden');}}));
const code = `TELEMETRY_LEASE_S = 0.2
COMMAND_LEASE_S = 0.3

def stopping_distance(speed_mps):
    """Synthetic arithmetic envelope."""
    return speed_mps * 0.3 + speed_mps ** 2 / 2.0 + 1.0

def plan_speed(command, stopped):
    return 0.0 if stopped or command.reset_stop else command.target_mps
`;
const source = {id:'HA-1', action:'Apply torque', phrase:'Too late', from:'Control cycle', to:'Actuation',
  evidence:{code:{files:[{filePath:'monitor.py', content:code}]}},
  context:{scenario:'Closed-yard haulage', mode:'Teleoperated operation'}};
const rows = prompt => JSON.parse(prompt.split('\nRows: ')[1]);
const quiet = {onDiagnostic:()=>{}, onMetrics:()=>{}};

test.each([
  ['2 * 0.3 + 2 ** 2 / 2.0 + 1.0',3.6],
  ['1.5 × 0.3 + 1.5² / 2.0 + 1.0',2.575],
  ['-2 ** 2',-4], ['2 ** -2',0.25], ['(3 + 1) / 2',2],
  ['1 / 0',null], ['globalThis.fetch("secret")',null], ['Math.pow(2,3)',null],
  ['2; process.exit()',null], ['+'.repeat(1000)+'1',null],
])('bounded source arithmetic: %s', (expression, expected) => {
  const actual = evaluateSourceArithmetic(expression);
  if (expected === null) expect(actual).toBeNull(); else expect(actual).toBeCloseTo(expected);
});

test('extracts only pure single-return functions, preserves constants and supplies calculation anchors', () => {
  const facts = sourceArithmeticFacts(source);
  expect(facts.functions.map(value=>value.name)).toEqual(['stopping_distance']);
  expect(facts.constants).toEqual(expect.arrayContaining([expect.objectContaining({name:'TELEMETRY_LEASE_S', value:0.2})]));
  expect(sourceArithmeticAnchors([source,source]).find(value=>value.name==='stopping_distance').examples)
    .toContainEqual({input:2, result:3.6});
});

test.each([
  ['verify stopping_distance(2.0) = 1.8', 'evaluates to 3.6'],
  ['verify stopping_distance(2.0) = 2.0', 'evaluates to 3.6'],
  ['verify 1.5 × 0.3 + 1.5² / 2.0 + 1.0 = 2.625', 'equals 2.575'],
  ['verify TELEMETRY_LEASE_S = 0.3 s', 'is 0.2'],
])('rejects observed numerical contradictions before acceptance: %s', (verification, issue) => {
  expect(validateFastAssessment('STPA', {...answer('STPA','HA-1'), verification}, source, {structuralOnly:true}).join('; ')).toContain(issue);
});

test.each([
  'Verify stopping_distance(2) = 3.6 and reject clearance 2.5 m.',
  'Mock stopping_distance(2) = 1.8 to inject an underestimated envelope; verify independent trip response.',
  'Assume stopping_distance(2) = 1.8 under an injected computational fault; verify protective response.',
  'Test a proposed TELEMETRY_LEASE_S = 0.3 s separately from the existing configuration.',
  'Verify command age 0.35 s exceeds COMMAND_LEASE_S = 0.3 s.',
])('allows supported arithmetic, test stimuli and explicitly changed behavior: %s', verification => {
  expect(validateSourceArithmetic({verification},source)).toEqual([]);
});

test('ambiguous source snapshots do not become an invented single numeric oracle', () => {
  const ambiguous = {...source,evidence:{files:[code, code.replace('speed_mps * 0.3','speed_mps * 0.5')]}};
  expect(validateSourceArithmetic({verification:'Verify stopping_distance(2) = 2.0'},ambiguous)).toEqual([]);
});

test('corrects and checkpoints only the numerically inconsistent assessment; repeat run reuses accepted work', async () => {
  const data = new Map(), checkpoint = {read:async key=>data.get(JSON.stringify(key)),write:async(key,value)=>data.set(JSON.stringify(key),value)};
  const sources = [source,{...source,id:'HA-2'}].map(value=>({...value,reviewedApplicability:'Yes',reviewedRationale:'Retained command timing decision.'}));
  const request = jest.fn(async prompt=>rows(prompt).map(({id})=>({...answer('STPA',id),verification:
    id==='HA-1' && request.mock.calls.length===1 ? 'Verify stopping_distance(2) = 1.8.' : 'Verify stopping_distance(2) = 3.6.'})));
  const options = {method:'STPA',sources,context:{},checkpoint,request,...quiet};
  expect(await generateFastHazards(options)).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(2);
  expect(rows(request.mock.calls[1][0]).map(value=>value.id)).toEqual(['HA-1']);
  expect(request.mock.calls[1][0]).toContain('evaluates to 3.6');
  request.mockClear(); await generateFastHazards(options); expect(request).not.toHaveBeenCalled();
});

test('gate-only automatic exclusion requests focused evidence without overwriting an analyst exclusion', async () => {
  const gated = {...source,action:'Validate motion authority',phrase:'Providing the control action causes a hazard'};
  const request = jest.fn(async prompt=>rows(prompt).map(({id})=>({id,
    applicable:request.mock.calls.length===1?'No':'Yes', rationale:request.mock.calls.length===1?
      'Validation is a gate; providing it does not itself cause hazard.':'False acceptance governs permission to move.'})));
  const result = await screenFastApplicability({method:'STPA',sources:[gated],context:{},request});
  expect(result.get(source.id).applicable).toBe('Yes');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1].screeningMode).toBe('evidence');
  request.mockClear();
  const governed = await screenFastApplicability({method:'STPA',sources:[{...gated,reviewedApplicability:'No',reviewedRationale:'Analyst boundary decision.'}],context:{},request});
  expect(governed.get(source.id)).toMatchObject({applicable:'No',rationale:'Analyst boundary decision.'});
  expect(request).not.toHaveBeenCalled();
});

test('instantaneous predicate can retain a justified duration exclusion without another request', async () => {
  const request = jest.fn(async prompt=>rows(prompt).map(({id})=>({id,applicable:'No',rationale:'This instantaneous predicate has no maintained output or duration contract.'})));
  await screenFastApplicability({method:'STPA',sources:[{...source,phrase:'Applied too long'}],context:{},request});
  expect(request).toHaveBeenCalledTimes(1);
});
test.each(['Yes','No'])('blanket temporal exclusion consults source and can resolve to %s without forcing acceptance',async applicable=>{
  const input={...source,action:'Validate heater sensor sample',phrase:'Provided too early',context:{mode:'Automatic thermal protection'}};
  const before=JSON.stringify(input);
  const request=jest.fn(async prompt=>rows(prompt).map(({id})=>({id,applicable:request.mock.calls.length===1?'No':applicable,rationale:request.mock.calls.length===1?
    'A stateless predicate has no early-timing meaning.':applicable==='Yes'?'A cached status can precede the current sensor sample.':'No retained or cached result exists; lifetime belongs to the consumer.'})));
  const result=await screenFastApplicability({method:'STPA',sources:[input],context:{},request});
  expect(result.get(source.id).applicable).toBe(applicable);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1].screeningMode).toBe('evidence');
  expect(JSON.stringify(input)).toBe(before);
});
test('coverage in a parent does not locally exclude a modeled gate or force its acceptance',async()=>{
 const request=jest.fn(async prompt=>rows(prompt).map(({id})=>({id,applicable:request.mock.calls.length===1?'No':'Yes',rationale:request.mock.calls.length===1?'Freshness is already covered by the parent validator.':'False freshness can authorize use of stale feedback.'})));
 const result=await screenFastApplicability({method:'STPA',sources:[{...source,action:'Request sample validity'}],context:{},request});
 expect(result.get(source.id).applicable).toBe('Yes');
 expect(request.mock.calls[1][1].screeningMode).toBe('evidence');
});

test('generation receives source priority, reset/brake/interlock and test-state contracts plus numeric anchors', () => {
  const prompt = resultsFirstPrompt('STPA',[source],{organizationProfile:'Autonomous haulage examples'});
  for (const phrase of ['project scope, control authority', 'explicit reset', 'reset-cycle motion inhibition',
    'protective brake selection', 'Safe short-circuit rejection', 'rejected as replayed',
    'physical stopping time', 'increasing sequence', 'sibling guide phrases', '"result":3.6']) expect(prompt).toContain(phrase);
});
