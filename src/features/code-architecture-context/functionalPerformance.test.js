import { processFunctionalModel, functionalModelIsReady, buildFunctionalModelRows } from './functionalModel';
import { functionalHierarchyIsReady } from './functionalHierarchy';
import { createFunctionalRequestRuntime, createValidatedFunctionalCache } from './functionalRequestRuntime';
import { mapAnalysisWork, serialAnalysisWriter, createAnalysisPacer } from './functionalWorkScheduler';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidenceMarker = 'Relationships (descriptions may be excerpts; classify only the supplied evidence): ';
const fixtures = count => Array.from({ length: count }, (_, i) => ({
  from: `caller${i}`, to: `primitive${i}`, action: 'Transform value',
  fromFile: `src/caller${i}.${['py', 'cpp', 'java', 'ts'][i % 4]}`, toFile: 'value.hpp', traceId: `source-${i}`,
  architecture: { subsystem: 'Compute', csci: 'Processing', csc: 'Transform' },
}));
function responsibility(evidence) {
  return { function: { name: `Transform ${evidence[0].from}`, description: 'Transform input values.', significance: 'implementation' },
    relationships: evidence.map(row => ({ index: row.index, significance: 'implementation', disposition: 'internal', target: null, rationale: 'Supporting primitive within the caller.' })) };
}
function reply(prompt) {
  if (prompt.includes('Caller batch: ')) return { callers: JSON.parse(prompt.split('Caller batch: ')[1]).map(item => ({ id: item.id, result: responsibility(item.relationships) })) };
  if (prompt.includes('Functional hierarchy input: ')) return { allocations: JSON.parse(prompt.split('Functional hierarchy input: ')[1]).functions.map(unit => ({
    id: unit.id, subsystem: 'Compute', csci: 'Processing', csc: 'Transform', rationale: 'Related transformation responsibilities.' })) };
  if (prompt.includes('Consolidation input: ')) return { responsibilities: JSON.parse(prompt.split('Consolidation input: ')[1]).functions.map(unit => ({ members: [unit.id], name: unit.name, description: unit.description })) };
  return responsibility(JSON.parse(prompt.split(evidenceMarker)[1]));
}
function cacheFor(store, overrides = {}) {
  return createValidatedFunctionalCache({ scope: 'project-a:repo-a', revision: 'revision-1', settings: { provider: 'test', model: 'same-model' },
    hash: async value => require('crypto').createHash('sha256').update(value).digest('hex'),
    read: async key => store.get(key), write: async (key, value) => store.set(key, JSON.parse(JSON.stringify(value))), ...overrides });
}
async function run(rows, request, options = {}) {
  const runtime = createFunctionalRequestRuntime({ request, ...options });
  try { return await processFunctionalModel(rows, { request: runtime, concurrency: 32, signal: options.signal }); }
  finally { runtime.close(); }
}

test('packed mixed-language callers preserve complete output with fewer requests and bounded network concurrency', async () => {
  const rows = fixtures(120), baselineRequest = jest.fn(reply);
  const baseline = await processFunctionalModel(rows, { request: baselineRequest });
  let active = 0, peak = 0;
  const request = jest.fn(async prompt => { active++; peak = Math.max(peak, active); await delay(2); active--; return reply(prompt); });
  const result = await run(rows, request);
  expect(result).toEqual(baseline);
  expect(buildFunctionalModelRows(result)).toEqual(buildFunctionalModelRows(baseline));
  expect(result.map(({ functionalAbstraction, ...row }) => row)).toEqual(rows);
  expect(functionalModelIsReady(result) && functionalHierarchyIsReady(result)).toBe(true);
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
  expect(request.mock.calls.length).toBeLessThan(baselineRequest.mock.calls.length / 3);
  for (const [prompt] of request.mock.calls.filter(([value]) => value.includes('Caller batch: '))) {
    const batch = JSON.parse(prompt.split('Caller batch: ')[1]);
    expect(batch.reduce((sum, caller) => sum + caller.relationships.length, 0)).toBeLessThanOrEqual(12);
  }
  console.log('Functional performance: 120 callers', { baseline: baselineRequest.mock.calls.length, packed: request.mock.calls.length, peak });
});

test('a missing caller retries independently without repeating valid siblings', async () => {
  let removedIndex;
  const request = jest.fn(prompt => {
    const result = reply(prompt);
    if (result.callers && removedIndex === undefined) {
      removedIndex = result.callers[0].result.relationships[0].index;
      result.callers.shift();
    }
    return result;
  });
  const result = await run(fixtures(12), request);
  expect(result).toHaveLength(12);
  const individual = request.mock.calls.filter(([prompt]) => !prompt.includes('Caller batch: ') && prompt.includes(evidenceMarker));
  expect(individual).toHaveLength(1);
  expect(JSON.parse(individual[0][0].split(evidenceMarker)[1]).map(row => row.index)).toEqual([removedIndex]);
});

test('packing preserves meaningful and uncertain boundaries and source-governed eligibility', async () => {
  const rows = fixtures(24).map((row, index) => ({ ...row,
    hazardAnalysisEligibility: index % 2 ? 'Include' : 'Exclude', hazardAnalysisEligibilitySource: 'analyst-override' }));
  const provider = prompt => {
    const result = reply(prompt);
    const annotate = value => {
      value.relationships?.forEach(row => {
        row.significance = row.index % 2 ? 'meaningful' : 'uncertain';
        row.disposition = 'interaction'; row.target = { name: `Deliver result ${row.index}`, description: 'Provide the requested result.' };
        row.action = 'Supply result'; row.description = 'Requested transformation output.'; row.kind = 'data';
      });
    };
    if (result.callers) result.callers.forEach(caller => annotate(caller.result)); else annotate(result);
    return result;
  };
  const baseline = await processFunctionalModel(rows, { request: provider });
  const packed = await run(rows, provider);
  expect(packed).toEqual(baseline);
  expect(buildFunctionalModelRows(packed)).toEqual(buildFunctionalModelRows(baseline));
  expect(packed.every(row => row.functionalAbstraction.disposition === 'interaction')).toBe(true);
  expect(packed.map(row => row.hazardAnalysisEligibility)).toEqual(rows.map(row => row.hazardAnalysisEligibility));
});

test('input packing respects evidence and estimated output budgets without dropping callers', async () => {
  const rows = fixtures(40).map(row => ({ ...row, fromDetails: 'e'.repeat(1800), toDetails: 't'.repeat(1800), controlDetails: 'c'.repeat(1800) }));
  const request = jest.fn(reply);
  const result = await run(rows, request, { maxChars: 24000, maxEstimatedOutputTokens: 2000 });
  expect(result).toHaveLength(40);
  expect(request.mock.calls.some(([prompt]) => prompt.includes('Caller batch: '))).toBe(true);
  for (const [prompt] of request.mock.calls.filter(([value]) => value.includes('Caller batch: '))) {
    expect(prompt.length).toBeLessThanOrEqual(24000);
    const callers = JSON.parse(prompt.split('Caller batch: ')[1]);
    expect(callers.length * 650).toBeLessThanOrEqual(2000);
    expect(callers.every(item => item.relationships.every(row => row.fromDetails.length === 1800 && row.toDetails.length === 1800))).toBe(true);
  }
});

test('invalid semantic output is not checkpointed; valid caller siblings survive a later hierarchy failure and resume', async () => {
  const rows = fixtures(30), store = new Map();
  const failed = jest.fn(prompt => {
    if (prompt.includes('Functional hierarchy input: ')) throw Object.assign(new Error('Provider unavailable'), { retryable: true });
    return reply(prompt);
  });
  await expect(run(rows, failed, { cache: cacheFor(store) })).rejects.toThrow('Provider unavailable');
  expect(store.size).toBeGreaterThan(0);
  const resumed = jest.fn(reply);
  const result = await run(rows, resumed, { cache: cacheFor(store) });
  expect(functionalHierarchyIsReady(result)).toBe(true);
  expect(resumed.mock.calls.every(([prompt]) => prompt.includes('Functional hierarchy input: '))).toBe(true);
  const again = jest.fn(reply);
  await run(rows, again, { cache: cacheFor(store) });
  expect(again).not.toHaveBeenCalled();

  const invalidStore = new Map();
  await expect(run(fixtures(1), () => ({ function: { name: 'X', description: 'Y' }, relationships: [] }), { cache: cacheFor(invalidStore) })).rejects.toThrow('coverage');
  expect(invalidStore.size).toBe(0);
});

test.each([
  { scope: 'project-b:repo-a' }, { revision: 'revision-2' }, { settings: { provider: 'test', model: 'different-model' } },
  { settings: { provider: '', model: '' } },
])('checkpoints cannot leak between projects, inputs, or models: %j', async overrides => {
  const store = new Map();
  await cacheFor(store).accept('same prompt', { result: 1 });
  expect(await cacheFor(store, overrides).get('same prompt')).toBeUndefined();
  expect(await cacheFor(store).get('changed prompt')).toBeUndefined();
});

test('storage failure does not fabricate readiness or prevent validated in-memory completion', async () => {
  const event = jest.fn();
  const cache = cacheFor(new Map(), { write: async () => { throw new Error('quota'); }, onEvent: event });
  const result = await run(fixtures(3), reply, { cache });
  expect(functionalHierarchyIsReady(result)).toBe(true);
  expect(event).toHaveBeenCalledWith({ type: 'checkpoint-write-failed' });
});

test('source workers finish out of order but assemble in order and enforce the bound', async () => {
  let active = 0, peak = 0;
  const result = await mapAnalysisWork([8, 2, 6, 1, 3], async value => {
    active++; peak = Math.max(peak, active); await delay(value); active--; return value;
  }, { concurrency: 3 });
  expect(result).toEqual([8, 2, 6, 1, 3]); expect(peak).toBe(3); expect(active).toBe(0);
});

test('fatal source failure stops dispatch and drains other workers before rejecting', async () => {
  const started = [], settled = [];
  await expect(mapAnalysisWork([0, 1, 2, 3, 4], async value => {
    started.push(value);
    if (!value) throw new Error('fatal');
    await delay(10); settled.push(value);
  }, { concurrency: 2 })).rejects.toThrow('fatal');
  expect(started).toEqual([0, 1]); expect(settled).toEqual([1]);
});

test('cancellation drains Functional requests and prevents subsequent stage requests', async () => {
  const controller = new AbortController();
  let active = 0;
  const request = jest.fn(async prompt => {
    active++; controller.abort(); await delay(3); active--; return reply(prompt);
  });
  await expect(run(fixtures(60), request, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(active).toBe(0);
  expect(request.mock.calls.every(([prompt]) => !prompt.includes('Consolidation input: ') && !prompt.includes('Functional hierarchy input: '))).toBe(true);
});

test('checkpoint writes serialize and a failed write does not strand the queue', async () => {
  const write = serialAnalysisWriter(), events = [];
  const first = write(async () => { events.push('start'); await delay(2); events.push('end'); throw new Error('quota'); });
  const second = write(async () => { events.push('next'); });
  await expect(first).rejects.toThrow('quota'); await second;
  expect(events).toEqual(['start', 'end', 'next']);
});

test('rate pacing reserves separate starts for parallel requests and retries', async () => {
  const waits = [], pacer = createAnalysisPacer({ intervalMs: 1100, now: () => 100, wait: async ms => waits.push(ms) });
  await Promise.all([pacer(), pacer(), pacer()]);
  expect(waits).toEqual([0, 1100, 2200]);
  const controller = new AbortController(); controller.abort();
  await expect(pacer(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
