import { processFunctionalModel } from './testSupport/functionalHierarchyFixture';
import { functionalModelIsReady, buildFunctionalModelRows } from './functionalModel';
import { buildCodeArchitectureHazardInput, isCodeArchitectureHazardAnalysisStale, normalizeCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
jest.mock('../code-architecture-assurance/EngineeringArtifactTable', () => () => null);
const input = [
  { from: 'plan', to: 'list.append', action: 'Call append', fromFile: 'planner.py', toFile: 'planner.py', traceId: 'raw-1', rowRef: 1, relationshipEvidence: { targetResolution: 'unresolved-runtime-target' } },
  { from: 'plan', to: 'publish', action: 'Call publish', fromFile: 'planner.py', toFile: 'output.cpp', traceId: 'raw-2', rowRef: 2 },
  { from: 'publish', to: 'write', action: 'Write command', fromFile: 'output.cpp', toFile: 'transport.hpp', traceId: 'raw-3', rowRef: 3 },
].map(row => ({ ...row, architecture: { subsystem: 'Motion', csci: 'Planner', csc: 'Control', csu: row.from }, hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'user', lifecyclePhase: 'Runtime' }));
const request = async prompt => {
  if (prompt.includes('Consolidation input: ')) {
    const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
    return { responsibilities: functions.map(fn => ({ members: [fn.id], name: fn.name, description: fn.description })) };
  }
  const evidence = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
  return { function: { name: evidence[0].from === 'plan' ? 'Plan Motion' : 'Publish Command', description: 'Responsibility grounded in source.', significance: 'implementation' }, relationships: evidence.map(row => ({ index: row.index,
    significance: (row.sourceDefinedTarget || row.crossFile) ? 'meaningful' : 'implementation', disposition: (row.sourceDefinedTarget || row.crossFile) ? 'interaction' : 'internal', target: (row.sourceDefinedTarget || row.crossFile) ? { name: 'Transmit Command', description: 'Publish the requested command.' } : null,
    action: (row.sourceDefinedTarget || row.crossFile) ? 'Motion command' : '', kind: 'control', description: 'Requested vehicle motion information.', rationale: 'Based on supplied interaction evidence.' })) };
};

test('processes every row without changing detailed results, with source traceability and purpose names', async () => {
  const snapshot = JSON.stringify(input);
  const result = await processFunctionalModel(input, { request });
  expect(JSON.stringify(input)).toBe(snapshot);
  expect(result.map(({ functionalAbstraction, ...rest }) => rest)).toEqual(input);
  expect(functionalModelIsReady(JSON.parse(JSON.stringify(result)))).toBe(true);
  const model = buildFunctionalModelRows(result);
  expect(model).toHaveLength(3);
  expect(model.find(row => row.from === 'Plan Motion' && !row.functionalModel.internal).to).toBe('Publish Command');
  expect([...new Set(model.flatMap(row => row.functionalModel.sourceTraceIds))].sort()).toEqual(['raw-1', 'raw-2', 'raw-3']);
  expect(model.filter(row => row.functionalModel.internal)).toHaveLength(1);
});

test('same processing for GitHub and local, independent of extension and repository names', async () => {
  const github = await processFunctionalModel(input.map(row => ({ ...row, sourceType: 'github' })), { request });
  const local = await processFunctionalModel(input.map(row => ({ ...row, sourceType: 'local' })), { request });
  expect(local.map(row => row.functionalAbstraction)).toEqual(github.map(row => row.functionalAbstraction));
});

test('preserves known and cross-file boundaries when the model calls them internal without repeated requests', async () => {
  const bad = jest.fn(async prompt => { const value = await request(prompt); value.relationships?.forEach(row => { row.disposition = 'internal'; row.target = null; row.action = ''; }); return value; });
  const result = await processFunctionalModel(input, { request: bad });
  expect(bad).toHaveBeenCalledTimes(3);
  expect(functionalModelIsReady(result)).toBe(true);
  expect(result[0].functionalAbstraction.disposition).toBe('internal');
  for (const index of [1, 2]) {
    expect(result[index].functionalAbstraction).toMatchObject({ disposition: 'interaction', kind: 'unknown', boundaryPreserved: true });
    expect(result[index].functionalAbstraction.target.file).toBe(input[index].toFile);
  }
  const model = buildFunctionalModelRows(result);
  expect(model.flatMap(row => row.functionalModel.boundaryReviewSourceIndices).sort()).toEqual([1, 2]);
  expect([...new Set(model.flatMap(row => row.functionalModel.sourceTraceIds))].sort()).toEqual(['raw-1', 'raw-2', 'raw-3']);
  expect(buildCodeArchitectureHazardInput({ cbaRows: result }).sourceTableRows).toHaveLength(2);
  expect(functionalModelIsReady(JSON.parse(JSON.stringify(result)))).toBe(true);
});

test('incomplete response cannot publish', async () => {
  await expect(processFunctionalModel(input, { request: async () => ({ function: { name: 'X', description: 'Y' }, relationships: [] }) })).rejects.toThrow('coverage');
});

test('subdivides incomplete batches automatically and cancels without publishing partial mappings', async () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ ...input[0], to: `primitive${i}`, traceId: `r-${i}` }));
  let largest = 0;
  const split = async prompt => {
    const data = await request(prompt);
    largest = Math.max(largest, data.relationships.length);
    if (data.relationships.length > 3) throw new Error('Output too large');
    return data;
  };
  const result = await processFunctionalModel(rows, { request: split });
  expect(largest).toBeLessThanOrEqual(12);
  expect(result.every(row => row.functionalAbstraction)).toBe(true);
  const controller = new AbortController(); controller.abort();
  await expect(processFunctionalModel(input, { request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});

test('input changes invalidate the model; duplicate names remain file scoped', async () => {
  const result = await processFunctionalModel([...input, { ...input[0], fromFile: 'other.py', toFile: 'other.py', traceId: 'raw-4' }], { request });
  expect(new Set(result.filter(row => row.from === 'plan').map(row => row.functionalAbstraction.source.id)).size).toBe(2);
  expect(functionalModelIsReady(result.map((row, i) => i ? row : { ...row, action: 'Changed' }))).toBe(false);
});

test('hazard expansion uses functional interactions and preserves raw snapshot semantics for older runs', async () => {
  const result = await processFunctionalModel(input, { request });
  const baseline = buildCodeArchitectureHazardInput({ cbaRows: input });
  const functional = buildCodeArchitectureHazardInput({ cbaRows: result });
  expect(functional.analysisAbstraction).toBe('functional');
  expect(functional.sourceTableRows).toHaveLength(2);
  expect(functional.tableRows).toHaveLength(14);
  expect(functional.sourceTableRows[0].traceability.functionalSourceTraceIds.length).toBeGreaterThanOrEqual(1);
  expect(functional.architectureSnapshotHash).toBe(baseline.architectureSnapshotHash);
  const run = normalizeCodeArchitectureHazardRun(functional);
  expect(run.analysisAbstraction).toBe('functional');
  expect(isCodeArchitectureHazardAnalysisStale({ run, cbaRows: result })).toBe(false);
  const changed = result.map((row, index) => index ? row : { ...row, fromDetails: 'changed purpose' });
  expect(isCodeArchitectureHazardAnalysisStale({ run, cbaRows: changed })).toBe(true);
  expect(isCodeArchitectureHazardAnalysisStale({ run: normalizeCodeArchitectureHazardRun(baseline), cbaRows: result })).toBe(false);
});

test('consolidates cohesive implementation functions while retaining every source row', async () => {
  const rows = [
    { ...input[0], from: 'prepare', to: 'assemble', action: 'Pass values', traceId: 'cohesive-1' },
    { ...input[0], from: 'assemble', to: 'items.append', traceId: 'cohesive-2' },
  ];
  const merge = async prompt => {
    if (prompt.includes('Consolidation input: ')) {
      const data = JSON.parse(prompt.split('Consolidation input: ')[1]);
      return { responsibilities: [{ members: data.functions.map(fn => fn.id), name: 'Prepare Control Input', description: 'Prepare and assemble input values.' }] };
    }
    const data = await request(prompt);
    return { ...data, relationships: data.relationships.map(row => ({ ...row, kind: 'data', significance: 'implementation' })) };
  };
  const processed = await processFunctionalModel(rows, { request: merge });
  const model = buildFunctionalModelRows(processed);
  expect(new Set(model.map(row => row.fromNodeId)).size).toBe(1);
  expect(model.every(row => row.functionalModel.internal)).toBe(true);
  expect([...new Set(model.flatMap(row => row.functionalModel.sourceTraceIds))].sort()).toEqual(['cohesive-1', 'cohesive-2']);
});

test('grouped hazard links resolve to supporting calls and remain linked in downstream traceability', async () => {
  const { resolveArchitectureTarget } = require('../../components/codeArchitectureNavigation');
  const { functionalRowIndexForTraceValue } = require('../code-architecture-assurance/artifactUtils');
  const processed = await processFunctionalModel(input, { request });
  const row = buildFunctionalModelRows(processed).find(row => !row.functionalModel.internal);
  const index = row.functionalModel.sourceIndices[0];
  expect(functionalRowIndexForTraceValue(processed, row.traceId)).toBe(index);
  expect(resolveArchitectureTarget({ traceId: row.traceId, type: 'edge' }, processed).row.traceId).toBe(processed[index].traceId);
  const { buildTraceabilityRows } = require('../code-architecture-assurance/TraceabilityMatrixPanel');
  const chains = buildTraceabilityRows({ cbaRows: processed,
    softwareRows: [{ id: 'SWR-1', sourceTraceId: row.traceId }],
    systemRows: [{ id: 'SYS-1', parentSwRequirement: 'SWR-1' }],
    subsystemRows: [{ id: 'SUB-1', parentSystemRequirement: 'SYS-1' }],
    designRows: [{ id: 'DES-1', parentRequirement: 'SUB-1' }] });
  row.functionalModel.sourceTraceIds.forEach(trace => {
    expect(chains.some(chain => chain.sourceArchitectureRefs.some(ref => ref.traceId === trace) && chain.softwareRequirement === 'SWR-1'
      && chain.systemRequirement === 'SYS-1' && chain.subsystemRequirement === 'SUB-1'
      && chain.designElement === 'DES-1')).toBe(true);
  });
  expect(functionalRowIndexForTraceValue(processed.slice(1), row.traceId)).toBe(-1);
});

test('semantic description changes invalidate functional hazard runs without changing detailed snapshots', async () => {
  const result = await processFunctionalModel(input, { request });
  const run = normalizeCodeArchitectureHazardRun(buildCodeArchitectureHazardInput({ cbaRows: result }));
  const changed = result.map(row => ({ ...row, functionalAbstraction: { ...row.functionalAbstraction,
    interactionDescription: 'Revised engineering interpretation of this interaction.' } }));
  expect(functionalModelIsReady(changed)).toBe(true);
  expect(isCodeArchitectureHazardAnalysisStale({ run, cbaRows: changed })).toBe(true);
});

const speedFixture = Array.from({ length: 24 }, (_, index) => ({
  ...input[0], from: `step_${index}`, to: 'items.append',
  fromFile: `component${Math.floor(index / 4)}.cpp`, toFile: `component${Math.floor(index / 4)}.cpp`, traceId: `speed-${index}`,
}));
const speedResponse = async prompt => {
  if (prompt.includes('Consolidation input: ')) {
    const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
    return { responsibilities: functions.map(fn => ({ members: [fn.id], name: fn.name, description: fn.description })) };
  }
  return request(prompt);
};

test('bounded parallel processing matches sequential output despite reverse completion order', async () => {
  let active = 0, peak = 0;
  const completed = [];
  const delayed = async (prompt, signal) => {
    active++; peak = Math.max(peak, active);
    const data = prompt.includes('Consolidation input: ') ? null : JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
    await new Promise(resolve => setTimeout(resolve, data ? 4 - (data[0].index % 4) : 2));
    expect(signal.aborted).toBe(false);
    active--;
    if (data) completed.push(data[0].index);
    return speedResponse(prompt);
  };
  const sequential = await processFunctionalModel(speedFixture, { request: speedResponse, concurrency: 1 });
  const progress = [];
  const parallel = await processFunctionalModel(speedFixture, { request: delayed, concurrency: 99, onProgress: value => progress.push(value.completed) });
  expect(peak).toBe(4);
  expect(completed).not.toEqual([...completed].sort((a, b) => a - b));
  expect(parallel).toEqual(sequential);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
});

test('reuses a current model with zero requests and explicit regeneration bypasses reuse', async () => {
  const ready = await processFunctionalModel(input, { request });
  const spy = jest.fn(request);
  expect(await processFunctionalModel(ready, { request: spy })).toBe(ready);
  expect(spy).not.toHaveBeenCalled();
  const older = ready.map(row => ({ ...row, functionalAbstraction: { ...row.functionalAbstraction, version: 2 } }));
  expect(functionalModelIsReady(older)).toBe(false);
  expect(functionalModelIsReady(await processFunctionalModel(older, { request: spy }))).toBe(true);
  spy.mockClear();
  await processFunctionalModel(ready, { request: spy, force: true });
  expect(spy).toHaveBeenCalled();
});

test.each(['cancel', 'fatal'])('stops queued work and aborts active requests on %s without changing inputs', async mode => {
  const controller = new AbortController();
  const signals = [];
  let fail;
  const pending = processFunctionalModel(speedFixture, { signal: controller.signal, request: (_prompt, signal) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      if (!fail) fail = () => reject(Object.assign(new Error('Provider authentication failed'), { retryable: false }));
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true });
    });
  } });
  const assertion = expect(pending).rejects.toThrow(mode === 'fatal' ? 'authentication' : /cancel/i);
  expect(signals).toHaveLength(4);
  if (mode === 'cancel') controller.abort(); else fail();
  await assertion;
  expect(signals).toHaveLength(4);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(speedFixture.every(row => !row.functionalAbstraction)).toBe(true);
});

test('terminal consolidation errors are not retried or converted into successful partial processing', async () => {
  let calls = 0;
  const provider = async prompt => {
    if (prompt.includes('Consolidation input: ')) {
      calls++;
      throw Object.assign(new Error('Provider unavailable'), { retryable: false });
    }
    return speedResponse(prompt);
  };
  await expect(processFunctionalModel(speedFixture, { request: provider, concurrency: 1 })).rejects.toThrow('Provider unavailable');
  expect(calls).toBe(1);
});

test('exhausted provider rate-limit retries do not explode into smaller evidence requests', async () => {
  const provider = jest.fn(async () => { throw Object.assign(new Error('HTTP 429'), { retryable: true, retryAfterMs: 3000 }); });
  await expect(processFunctionalModel(speedFixture, { request: provider, concurrency: 1 })).rejects.toThrow('HTTP 429');
  expect(provider).toHaveBeenCalledTimes(1);
});

const timeout = () => Object.assign(new Error('The analysis request timed out.'), { code: 'FUNCTIONAL_REQUEST_TIMEOUT', retryable: true });

test('accepts surrounding whitespace and enclosing JSON fences in both stages', async () => {
  const result = await processFunctionalModel(input, { request: async prompt => `\n  \`\`\`json\n${JSON.stringify(await request(prompt))}\n\`\`\`  \n` });
  expect(functionalModelIsReady(result)).toBe(true);
});

test('corrects malformed singleton JSON with bounded retries and retains all source rows', async () => {
  let failures = 0;
  const provider = jest.fn(async prompt => {
    const response = await request(prompt);
    if (response.relationships?.[0].index === 2 && failures++ < 2) return '{"function":';
    return JSON.stringify(response);
  });
  const result = await processFunctionalModel(input, { request: provider, concurrency: 1 });
  expect(functionalModelIsReady(result)).toBe(true);
  expect(result.map(({ functionalAbstraction, ...rest }) => rest)).toEqual(input);
  expect(provider.mock.calls.filter(([prompt]) => prompt.startsWith('The previous response could not be validated.'))).toHaveLength(2);
});

test('persistent malformed singleton JSON never publishes fabricated or partial mappings', async () => {
  const provider = jest.fn(async () => '{"function":');
  await expect(processFunctionalModel([input[0]], { request: provider })).rejects.toThrow('could not validate source row 1');
  expect(provider).toHaveBeenCalledTimes(3);
  expect(input[0].functionalAbstraction).toBeUndefined();
});

test('recovers timed-out relationship batches without repeating completed source work', async () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ ...input[0], to: `primitive${i}`, traceId: `timeout-${i}` }));
  const completed = [];
  const sizes = [];
  const result = await processFunctionalModel(rows, { request: async prompt => {
    const response = await request(prompt);
    sizes.push(response.relationships.length);
    if (response.relationships.length > 3) throw timeout();
    completed.push(...response.relationships.map(row => row.index));
    return response;
  } });
  expect(sizes).toEqual([12, 6, 3, 3, 6, 3, 3, 3]);
  expect(completed).toEqual(rows.map((_, index) => index));
  expect(functionalModelIsReady(result)).toBe(true);
  expect(result.map(({ functionalAbstraction, ...rest }) => rest)).toEqual(rows);
});

test('recovers consolidation timeouts through smaller validated groups', async () => {
  const sizes = [];
  let relationshipCalls = 0;
  const result = await processFunctionalModel(speedFixture, { concurrency: 1, request: async prompt => {
    if (prompt.includes('Consolidation input: ')) {
      const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
      sizes.push(functions.length);
      if (functions.length > 3) throw timeout();
    } else relationshipCalls++;
    return speedResponse(prompt);
  } });
  expect(sizes).toEqual([24, 12, 6, 3, 3, 6, 3, 3, 12, 6, 3, 3, 6, 3, 3]);
  expect(relationshipCalls).toBe(24);
  expect(functionalModelIsReady(result)).toBe(true);
  expect(result).toHaveLength(speedFixture.length);
});

test('retries a transient singleton timeout and bounds persistent timeout recovery', async () => {
  const provider = jest.fn().mockRejectedValueOnce(timeout()).mockImplementation(request);
  expect(functionalModelIsReady(await processFunctionalModel([input[0]], { request: provider }))).toBe(true);
  expect(provider).toHaveBeenCalledTimes(2);
  const unavailable = jest.fn(async () => { throw timeout(); });
  await expect(processFunctionalModel([input[0]], { request: unavailable })).rejects.toThrow('timed out');
  expect(unavailable).toHaveBeenCalledTimes(2);
  expect(input[0].functionalAbstraction).toBeUndefined();
});

test('persistent consolidation timeout does not publish an unvalidated fallback', async () => {
  let calls = 0;
  await expect(processFunctionalModel(input, { request: async prompt => {
    if (prompt.includes('Consolidation input: ')) { calls++; throw timeout(); }
    return request(prompt);
  } })).rejects.toThrow('timed out');
  expect(calls).toBe(2);
});

test('cancellation during timeout recovery does not start another request', async () => {
  const controller = new AbortController();
  const provider = jest.fn(async () => { controller.abort(); throw timeout(); });
  await expect(processFunctionalModel(input, { request: provider, signal: controller.signal, concurrency: 1 })).rejects.toThrow(/cancel/i);
  expect(provider).toHaveBeenCalledTimes(1);
});

test('synthetic latency benchmark preserves request count and complete output', async () => {
  const measurements = [];
  for (const concurrency of [1, 4]) {
    let calls = 0;
    const start = Date.now();
    const result = await processFunctionalModel(speedFixture, { concurrency, request: async prompt => {
      calls++; await new Promise(resolve => setTimeout(resolve, 20)); return speedResponse(prompt);
    } });
    expect(functionalModelIsReady(result)).toBe(true);
    measurements.push({ concurrency, requests: calls, milliseconds: Date.now() - start });
  }
  expect(measurements[0].requests).toBe(measurements[1].requests);
  console.info('Functional generation latency fixture (20ms/request):', JSON.stringify(measurements));
});

test('raises cross-file implementation steps to a component capability with complete source evidence', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...input[0], from: `step${i}`, to: i < 7 ? `step${i + 1}` : 'write',
    fromFile: `step${i}.cpp`, toFile: i < 7 ? `step${i + 1}.cpp` : 'io.cpp', traceId: `step-${i}` }));
  const merged = async prompt => {
    if (prompt.includes('Consolidation input: ')) {
      const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
      expect(functions).toHaveLength(8);
      return { responsibilities: [{ members: functions.map(fn => fn.id), name: 'Prepare Navigation Output', description: 'Prepare, transform and assemble navigation output.' }] };
    }
    const response = await request(prompt);
    response.relationships.forEach(row => { row.kind = 'data'; row.significance = row.index < 7 ? 'implementation' : 'meaningful'; });
    return response;
  };
  const result = await processFunctionalModel(rows, { request: merged });
  const model = buildFunctionalModelRows(result);
  expect(model).toHaveLength(2); // one internal evidence row and one external interaction
  expect(new Set(model.map(row => row.from))).toEqual(new Set(['Prepare Navigation Output']));
  expect(model.every(row => row.fromFile === '')).toBe(true); // no misleading single-file ownership
  expect([...new Set(model.flatMap(row => row.functionalModel.sourceTraceIds))].sort()).toEqual(rows.map(row => row.traceId).sort());
  expect(model.find(row => row.functionalModel.internal).functionalModel.sourceIndices).toHaveLength(7);
  expect(buildCodeArchitectureHazardInput({ cbaRows: result }).sourceTableRows).toHaveLength(1);
});

test('higher-level consolidation cannot absorb protected control or unknown boundaries', async () => {
  const provider = async prompt => {
    if (!prompt.includes('Consolidation input: ')) return request(prompt);
    const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
    return { responsibilities: [{ members: functions.map(fn => fn.id), name: 'Incorrect merger', description: 'Merge all behavior.' }] };
  };
  const result = await processFunctionalModel(input, { request: provider });
  expect(new Set(result.map(row => row.functionalAbstraction.source.id)).size).toBe(2);
  expect(buildFunctionalModelRows(result).filter(row => !row.functionalModel.internal)).toHaveLength(2);
});

// Semantic fixtures deliberately reuse the same call syntax for different behavior.
const semanticRequest = async prompt => {
  if (prompt.includes('Consolidation input: ')) return request(prompt);
  const evidence = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
  return {
    function: { name: 'Manage Operation', description: 'Use observed state to manage operation.', significance: 'meaningful' },
    relationships: evidence.map(row => {
      const assessment = JSON.parse(row.details);
      return { index: row.index, ...assessment,
        target: { name: assessment.purpose, description: assessment.effect },
        action: assessment.effect, description: assessment.effect, rationale: assessment.effect };
    }),
  };
};
const semantics = [
  ['implementation', 'unknown', 'Assemble working values', 'Temporary buffer layout only; no independent decision or output.'],
  ['meaningful', 'data', 'Estimate State', 'Estimate determines the permitted control request.'],
  ['meaningful', 'service', 'Validate Limits', 'Validation rejects requests exceeding allowed limits.'],
  ['meaningful', 'feedback', 'Report Health', 'Health information determines whether execution may continue.'],
  ['meaningful', 'control', 'Inhibit Execution', 'Fault detection inhibits execution pending recovery.'],
  ['uncertain', 'unknown', 'Exchange State', 'Available evidence does not establish the effect on operational decisions.'],
  ['implementation', 'service', 'Prepare Runtime Context', 'Create a temporary formatting context used only for representation.'],
  ['meaningful', 'data', 'Transform Command', 'Coordinate conversion materially changes the executed direction.'],
];
const semanticRows = semantics.map(([significance, kind, purpose, effect], index) => ({
  ...input[0], from: 'process', to: 'helper', fromFile: 'component.ext', toFile: `helpers/${index}.ext`,
  traceId: `semantic-${index}`, rowRef: index + 1,
  relationshipEvidence: { targetResolution: 'lexical-definition' },
  hazardAnalysisEligibility: 'Exclude', hazardAnalysisEligibilitySource: 'deterministic',
  controlActionDetails: JSON.stringify({ significance, kind, purpose, effect, disposition: significance === 'implementation' ? 'internal' : 'interaction' }),
}));

test('semantic significance controls abstraction independently of kind, source resolution and identical call names', async () => {
  const processed = await processFunctionalModel(semanticRows, { request: semanticRequest });
  expect(processed.map(row => row.functionalAbstraction.significance)).toEqual(semantics.map(row => row[0]));
  expect(processed.filter(row => row.functionalAbstraction.disposition === 'internal').map(row => row.traceId)).toEqual(['semantic-0', 'semantic-6']);
  const model = buildFunctionalModelRows(processed);
  expect(model.filter(row => !row.functionalModel.internal)).toHaveLength(6);
  const hazard = buildCodeArchitectureHazardInput({ cbaRows: processed });
  expect(hazard.sourceTableRows).toHaveLength(6);
  hazard.sourceTableRows.forEach(row => {
    expect(row.traceability.functionalSourceTraceIds).toEqual(expect.arrayContaining(['semantic-0', 'semantic-6']));
  });
  expect(processed.map(({ functionalAbstraction, ...row }) => row)).toEqual(semanticRows);
});

test('meaningful internal validation and uncertain same-file calls cannot be hidden by disposition', async () => {
  const provider = async prompt => {
    const data = await semanticRequest(prompt);
    data.relationships.forEach(row => { row.disposition = 'internal'; row.target = null; });
    return data;
  };
  const result = await processFunctionalModel(semanticRows.map(row => ({ ...row, toFile: row.fromFile, relationshipEvidence: { targetResolution: 'unresolved-runtime-target' } })), { request: provider });
  expect(result.filter(row => row.functionalAbstraction.boundaryPreserved)).toHaveLength(6);
  expect(buildFunctionalModelRows(result).filter(row => !row.functionalModel.internal)).toHaveLength(6);
});

test('missing significance is uncertain even for an unresolved same-file primitive-looking call', async () => {
  const result = await processFunctionalModel([input[0]], { request: async prompt => {
    const data = await request(prompt); delete data.relationships[0].significance; return data;
  } });
  expect(result[0].functionalAbstraction).toMatchObject({ significance: 'uncertain', disposition: 'interaction', boundaryPreserved: true });
});

test('distinct meaningful responsibilities cannot be merged even without a connecting control edge', async () => {
  const rows = semanticRows.slice(0, 2).map((row, index) => ({ ...row, from: `responsibility${index}` }));
  const result = await processFunctionalModel(rows, { request: async prompt => {
    if (!prompt.includes('Consolidation input: ')) return semanticRequest(prompt);
    const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
    return { responsibilities: [{ members: functions.map(fn => fn.id), name: 'Perform subsystem processing', description: 'Everything.' }] };
  } });
  expect(new Set(result.map(row => row.functionalAbstraction.source.id)).size).toBe(2);
});

test('semantic outcomes are independent of ingestion, filenames and language extensions', async () => {
  const first = await processFunctionalModel(semanticRows, { request: semanticRequest });
  for (const extension of ['cpp', 'py', 'rs', 'js']) {
    const rows = semanticRows.map(row => ({ ...row, sourceType: 'local', fromFile: `other/project/main.${extension}`, toFile: `other/${row.rowRef}.${extension}` }));
    const result = await processFunctionalModel(rows, { request: semanticRequest });
    expect(result.map(row => [row.functionalAbstraction.significance, row.functionalAbstraction.kind, row.functionalAbstraction.action]))
      .toEqual(first.map(row => [row.functionalAbstraction.significance, row.functionalAbstraction.kind, row.functionalAbstraction.action]));
  }
});

test('explicit analyst scope exclusions survive functional semantic assessment', async () => {
  const rows = semanticRows.slice(1, 2).map(row => ({ ...row, hazardAnalysisEligibilitySource: 'analyst-override', hazardAnalysisEligibilityRationale: 'Outside approved operational scope.' }));
  const result = await processFunctionalModel(rows, { request: semanticRequest });
  expect(buildFunctionalModelRows(result)[0]).toMatchObject({ hazardAnalysisEligibility: 'Exclude', hazardAnalysisEligibilitySource: 'analyst-override', hazardAnalysisEligibilityRationale: 'Outside approved operational scope.' });
});

test.each(['data', 'service', 'unknown'])('consolidation preserves a meaningful %s link between supporting implementation units', async kind => {
  const provider = async prompt => {
    if (!prompt.includes('Consolidation input: ')) {
      const response = await request(prompt);
      response.relationships.forEach(row => { row.kind = kind; });
      return response;
    }
    const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
    return { responsibilities: [{ members: functions.map(fn => fn.id), name: 'Process Everything', description: 'An invalid merge of independent interactions.' }] };
  };
  const result = await processFunctionalModel(input, { request: provider });
  expect(new Set(result.map(row => row.functionalAbstraction.source.id)).size).toBe(2);
  expect(buildFunctionalModelRows(result).filter(row => !row.functionalModel.internal)).toHaveLength(2);
});

test('immutable adopted revisions share derived rows and trace lookup; edits invalidate them', async () => {
  const { immutableFunctionalRows, functionalSourceIndex } = require('./functionalModel');
  const rows = immutableFunctionalRows(await processFunctionalModel(input, { request }));
  const first = buildFunctionalModelRows(rows);
  expect(buildFunctionalModelRows(rows)).toBe(first);
  expect(functionalModelIsReady(rows)).toBe(true);
  first.forEach(row => expect(functionalSourceIndex(rows, row.traceId)).toBe(row.functionalModel.sourceIndices[0]));
  expect(Object.isFrozen(rows[0].functionalAbstraction)).toBe(true);
  const edited = immutableFunctionalRows(rows.map((row, i) => i ? row : { ...row, fromDetails: 'Changed source responsibility' }));
  expect(functionalModelIsReady(edited)).toBe(false);
  expect(buildFunctionalModelRows(edited)).toEqual([]);
  const mutable = JSON.parse(JSON.stringify(rows));
  expect(functionalModelIsReady(mutable)).toBe(true);
  mutable[0].architecture.csc = 'Changed allocation';
  expect(functionalModelIsReady(mutable)).toBe(false);
});
