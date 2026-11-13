import { consolidateSafetyIssues, requestSafetyIssueConsolidation, validateSafetyIssues } from './safetyIssueGeneration';
import { buildSafetyIssuePrompt } from './safetyIssuePrompt';
import { fixtureSafetyIssues } from './testHelpers/safetyIssueFixtures';

jest.mock('../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: { 'x-ai-model': 'fixture-model' } }) }));
const row = (index, fn = 'Map geometry', hazard = 'Incorrect map projection corrupts the route') => ({ sourceIndex: index, cells: { 'Function (From)': fn, 'Control Action': 'Route geometry', 'Function (To)': 'Planner', Hazard: hazard, 'Guide Phrase': 'Incorrect', 'Safety Classification': 'Safety — Direct' } });
const families = [{ familyId: 'original-family', sourceIndexes: [1], rows: [row(1)] }];
const meaningful = { title: 'Invalid route planning from incorrect map geometry', description: 'Incorrect map projection and route geometry can produce an invalid planned path. The linked map interpretation and planning evidence require a common correctness strategy.', sourceFamilyIds: ['family-1'], likelihood: 3, severity: 4 };

test('the shared Projects request supplies the original clustering rules and retains meaningful AI prose for a single family', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ issues: [meaningful] }) } }] }) }));
  const issues = await consolidateSafetyIssues([row(1)], { projectName: 'Localization', request: requestSafetyIssueConsolidation });
  expect(issues).toHaveLength(1); expect(issues[0].title).toBe(meaningful.title); expect(issues[0].description).toBe(meaningful.description);
  expect(issues[0].sourceIndexes).toEqual([1]);
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.xhandleWorkflow).toBe('safety-issue-consolidation'); expect(payload.model).toBe('fixture-model');
  expect(payload.messages[1].content).toContain('You—not deterministic application code—must decide the semantic issue boundaries');
  expect(payload.messages[1].content).toContain('same control strategy, requirement set, design change, or verification campaign');
  expect(payload.messages[1].content).toContain('common ownership, shared loss');
  expect(buildSafetyIssuePrompt({ families, projectName: 'Localization' })).toContain('Do not mirror the hazard worksheet structure');
});

test.each(['Unsafe behavior across 143 functional interfaces', 'Unsafe system behavior involving every planner', 'Consolidated Safety Issue'])('rejects a generic title: %s', title => {
  expect(() => validateSafetyIssues({ issues: [{ ...meaningful, title, sourceFamilyIds: ['original-family'] }] }, families)).toThrow(/bookkeeping/);
});

test('rejects missing, repeated and unknown source references', () => {
  for (const sourceFamilyIds of [[], ['unknown']]) expect(() => validateSafetyIssues({ issues: [{ ...meaningful, sourceFamilyIds }] }, families)).toThrow();
  expect(() => validateSafetyIssues({ issues: [{ ...meaningful, sourceFamilyIds: ['original-family'] }, { ...meaningful, title: 'Independent route control failure', sourceFamilyIds: ['original-family'] }] }, families)).toThrow();
});

test('large shared generation checkpoints complete source coverage and resumes without repeating completed batches', async () => {
  const rows = Array.from({ length: 70 }, (_, index) => row(index + 1, `Capability ${index}`, `Unsafe result ${index}`));
  let state, calls = 0;
  const request = jest.fn(async args => { calls++; if (calls === 2) throw new Error('Provider interruption'); return fixtureSafetyIssues(args); });
  await expect(consolidateSafetyIssues(rows, { request, checkpoint: async value => { state = value; } })).rejects.toThrow('Provider interruption');
  const savedBatch = request.mock.calls[0][0].families.map(family => family.familyId);
  request.mockImplementation(fixtureSafetyIssues); request.mockClear();
  const issues = await consolidateSafetyIssues(rows, { request, saved: state, checkpoint: async value => { state = value; } });
  expect(issues.flatMap(issue => issue.sourceIndexes).sort((a, b) => a - b)).toEqual(rows.map(item => item.sourceIndex));
  expect(request.mock.calls[0][0].families.map(family => family.familyId)).not.toEqual(savedBatch);
  expect(issues.every(issue => !/^Unsafe behavior across/.test(issue.title))).toBe(true);
});

test('generic titles are corrected before they can replace an issue, with completed evidence retained', async () => {
  const request = jest.fn(async args => args.correction ? [{ ...meaningful, sourceFamilyIds: args.families.map(family => family.familyId) }] : [{ ...meaningful, title: 'Unsafe behavior across 143 functional interfaces', sourceFamilyIds: args.families.map(family => family.familyId) }]);
  const issues = await consolidateSafetyIssues([row(1)], { request });
  expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[1][0].correction).toBe(true);
  expect(issues[0].title).toBe(meaningful.title); expect(issues[0].sourceIndexes).toEqual([1]);
});

test('partially valid responses save accepted issues and repair only unresolved evidence', async () => {
  let saved;
  const request = jest.fn(async ({ families: supplied }) => {
    if (request.mock.calls.length === 1) return fixtureSafetyIssues({ families: supplied.slice(0, 1) });
    return fixtureSafetyIssues({ families: supplied });
  });
  const rows = [row(1, 'Map interpretation'), row(2, 'Remote command delivery')];
  const issues = await consolidateSafetyIssues(rows, { request, checkpoint: async state => { saved = state; } });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0].families.map(item => item.familyId)).toEqual(['family-2:part-0']);
  expect(issues.flatMap(item => item.sourceIndexes).sort()).toEqual([1, 2]);
  expect(Object.values(saved.rounds[0].completed).flat()).toHaveLength(2);
});

test('the actual request repairs a single remaining family with prose-only output after bad references', async () => {
  let calls = 0;
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body), fixed = body.messages.some(message => message.content.includes('Do not return IDs, sourceFamilyIds'));
    const title = calls++ ? 'Loss of remote vehicle command delivery' : meaningful.title;
    const content = calls === 1 ? { issues: [{ ...meaningful, title, sourceFamilyIds: ['family-1'] }] } : fixed ? { title, description: meaningful.description } : { issues: [{ ...meaningful, title, sourceFamilyIds: ['family-999'] }] };
    return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) };
  });
  const issues = await consolidateSafetyIssues([row(1, 'Map'), row(2, 'Remote delivery')], { request: requestSafetyIssueConsolidation });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(issues.map(item => item.title)).toEqual([meaningful.title, 'Loss of remote vehicle command delivery']);
  expect(issues.flatMap(item => item.sourceIndexes).sort()).toEqual([1, 2]);
  const correction = JSON.parse(fetch.mock.calls[1][1].body);
  const evidence = JSON.parse(correction.messages[1].content.split('Safety hazard evidence, grouped only to reduce transport size (the grouping does not decide issue boundaries):\n')[1].split('\n\nReturn strict JSON')[0]);
  expect(evidence).toHaveLength(1); expect(evidence[0].rows[0].cells['Function (From)']).toBe('Remote delivery');
});
