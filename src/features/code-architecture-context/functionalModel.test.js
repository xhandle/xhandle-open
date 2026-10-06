import { processFunctionalModel, functionalModelIsReady, buildFunctionalModelRows } from './functionalModel';
import { buildCodeArchitectureHazardInput, isCodeArchitectureHazardAnalysisStale, normalizeCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
jest.mock('../code-architecture-assurance/EngineeringArtifactTable', () => () => null);
const input = [
  { from: 'plan', to: 'list.append', action: 'Call append', fromFile: 'planner.py', toFile: 'planner.py', traceId: 'raw-1', rowRef: 1, relationshipEvidence: { targetResolution: 'unresolved-runtime-target' } },
  { from: 'plan', to: 'publish', action: 'Call publish', fromFile: 'planner.py', toFile: 'output.cpp', traceId: 'raw-2', rowRef: 2 },
  { from: 'publish', to: 'write', action: 'Write command', fromFile: 'output.cpp', toFile: 'transport.hpp', traceId: 'raw-3', rowRef: 3 },
].map(row => ({ ...row, architecture: { subsystem: 'Motion', csci: 'Planner', csc: 'Control', csu: row.from }, hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'user', lifecyclePhase: 'Runtime' }));
const request = async prompt => {
  const evidence = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
  return { function: { name: evidence[0].from === 'plan' ? 'Plan Motion' : 'Publish Command', description: 'Responsibility grounded in source.' }, relationships: evidence.map(row => ({ index: row.index,
    disposition: row.mustPreserveBoundary ? 'interaction' : 'internal', target: row.mustPreserveBoundary ? { name: 'Transmit Command', description: 'Publish the requested command.' } : null,
    action: row.mustPreserveBoundary ? 'Motion command' : '', kind: 'control', description: 'Requested vehicle motion information.', rationale: 'Based on supplied interaction evidence.' })) };
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
  expect(model.flatMap(row => row.functionalModel.sourceTraceIds).sort()).toEqual(['raw-1', 'raw-2', 'raw-3']);
  expect(model.filter(row => row.functionalModel.internal)).toHaveLength(1);
});

test('same processing for GitHub and local, independent of extension and repository names', async () => {
  const github = await processFunctionalModel(input.map(row => ({ ...row, sourceType: 'github' })), { request });
  const local = await processFunctionalModel(input.map(row => ({ ...row, sourceType: 'local' })), { request });
  expect(local.map(row => row.functionalAbstraction)).toEqual(github.map(row => row.functionalAbstraction));
});

test('never collapses known or cross-file boundaries; incomplete response cannot publish', async () => {
  const bad = async prompt => { const value = await request(prompt); value.relationships.forEach(row => { row.disposition = 'internal'; }); return value; };
  await expect(processFunctionalModel(input, { request: bad })).rejects.toThrow('boundary');
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
  expect(functional.sourceTableRows[0].traceability.functionalSourceTraceIds.length).toBe(1);
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
    return { ...data, relationships: data.relationships.map(row => ({ ...row, kind: 'data' })) };
  };
  const processed = await processFunctionalModel(rows, { request: merge });
  const model = buildFunctionalModelRows(processed);
  expect(new Set(model.map(row => row.fromNodeId)).size).toBe(1);
  expect(model.every(row => row.functionalModel.internal)).toBe(true);
  expect(model.flatMap(row => row.functionalModel.sourceTraceIds).sort()).toEqual(['cohesive-1', 'cohesive-2']);
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
    expect(chains.some(chain => chain.functionalTraceId === trace && chain.softwareRequirement === 'SWR-1'
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
