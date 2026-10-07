import { allocateFunctionalHierarchy, functionalEndpointAllocations, functionalHierarchyIsReady } from './functionalHierarchy';
import { processFunctionalModel, functionalModelIsReady, buildFunctionalModelRows } from './functionalModel';
import { processFunctionalModel as fixtureModel } from './testSupport/functionalHierarchyFixture';
import { buildCodeArchitectureHazardInput, computeArchitectureSnapshotHash, isCodeArchitectureHazardAnalysisStale, normalizeCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
jest.mock('../code-architecture-assurance/EngineeringArtifactTable', () => () => null);
const read = prompt => JSON.parse(prompt.split('Functional hierarchy input: ')[1]);
const reply = prompt => ({ allocations: read(prompt).functions.map(unit => {
  const authentication = unit.name.includes('authentication');
  return { id: unit.id, subsystem: 'Service', csci: authentication ? 'Access Management' : 'Content Delivery',
    csc: authentication ? 'Credentials' : 'Rendering', rationale: 'Groups evidenced responsibility; configuration boundary inferred.' };
}) });
const modelRows = (count = 2) => Array.from({ length: count }, (_, i) => ({
  traceId: `raw-${i}`, canonicalRelationshipId: `canonical-${i}`, from: `call${i}`, fromFile: `src/main/java/com/example/${i}.java`, to: 'leaf', toFile: 'provider.cpp',
  architecture: { subsystem: 'Com', csci: 'Com Software', csc: 'Example Components' },
  functionalAbstraction: { source: { id: `f-${i}`, label: i % 2 ? 'Render content' : 'Validate authentication', description: 'Distinct responsibilities under shared path prefix.', symbol: `call${i}`, file: `src/main/java/com/example/${i}.java` }, target: null }
}));

test('allocates real responsibility areas despite shared prefixes and more than 300 canonical inputs', async () => {
  const input = modelRows(337), before = JSON.stringify(input), request = jest.fn(reply);
  const result = await allocateFunctionalHierarchy(input, { request });
  expect(request).toHaveBeenCalledTimes(15);
  expect(Math.max(...request.mock.calls.map(([prompt]) => read(prompt).functions.length))).toBe(24);
  expect(request.mock.calls.every(([prompt]) => read(prompt).catalog.length <= 48)).toBe(true);
  expect(new Set(result.map(row => row.functionalAbstraction.source.architecture.csci)).size).toBe(2);
  expect(new Set(result.map(row => row.functionalAbstraction.source.architecture.csc)).size).toBe(2);
  expect(functionalHierarchyIsReady(JSON.parse(JSON.stringify(result)))).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  expect(result.map(({ functionalAbstraction, ...row }) => row)).toEqual(input.map(({ functionalAbstraction, ...row }) => row));
});

test('endpoint ownership prefers explicit destinations, reconciles conflicts independent of row order, and leaves unknown providers unowned', () => {
  const rows = [
    { from: 'source', fromFile: 'a', to: 'leaf', toFile: 'b', architecture: { csci: 'Caller' }, toArchitecture: { csci: 'Provider' } },
    { from: 'leaf', fromFile: 'b', architecture: { csci: 'Wrong fallback' } },
    { from: 'other', fromFile: 'c', to: 'leaf', toFile: 'b', toArchitecture: { csci: 'Conflicting provider' } },
  ];
  const resolve = functionalEndpointAllocations(rows);
  expect(resolve('b', 'leaf').ownershipConflict).toHaveLength(2);
  expect(resolve('b', 'leaf')).toEqual(functionalEndpointAllocations([...rows].reverse())('b', 'leaf'));
  expect(resolve('unknown', 'external')).toEqual({});
  expect(functionalEndpointAllocations(rows.slice(0, 2))('b', 'leaf')).toMatchObject({ csci: 'Provider', ownershipExplicit: true });
});

test('preserves explicit destination allocation and rejects overwrite without publishing', async () => {
  const rows = modelRows(1);
  rows[0].toArchitecture = { subsystem: 'External', csci: 'Provider', csc: 'Transport' };
  rows[0].functionalAbstraction.target = { id: 'leaf', label: 'Transmit', file: 'provider.cpp', symbol: 'leaf' };
  const before = JSON.stringify(rows);
  await expect(allocateFunctionalHierarchy(rows, { request: reply })).rejects.toThrow('Explicit endpoint ownership');
  expect(JSON.stringify(rows)).toBe(before);
  const result = await allocateFunctionalHierarchy(rows, { request: prompt => ({ allocations: read(prompt).functions.map(unit => ({
    id: unit.id, ...(unit.id === 'leaf' ? rows[0].toArchitecture : { subsystem: 'App', csci: 'Identity', csc: 'Authentication' }), rationale: 'Endpoint evidence.' })) }) });
  expect(result[0].functionalAbstraction.target.architecture.csci).toBe('Provider');
});

test('automatically splits malformed batches and rejects invented membership', async () => {
  const request = jest.fn(prompt => read(prompt).functions.length > 1 ? '{truncated' : reply(prompt));
  const result = await allocateFunctionalHierarchy(modelRows(4), { request });
  expect(functionalHierarchyIsReady(result)).toBe(true);
  await expect(allocateFunctionalHierarchy(modelRows(1), { request: () => ({ allocations: [{ id: 'invented' }] }) })).rejects.toThrow('Unknown or duplicate');
});

test('cancellation leaves original results unchanged and does not run remaining batches', async () => {
  const controller = new AbortController(), rows = modelRows(50), before = JSON.stringify(rows);
  const request = jest.fn(prompt => { controller.abort(); return reply(prompt); });
  await expect(allocateFunctionalHierarchy(rows, { request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(rows)).toBe(before);
});

const source = [{ from: 'authenticate', to: 'render', fromFile: 'identity.java', toFile: 'render.cpp', action: 'Send session', traceId: 'raw', rowRef: 1 }];
const responsibility = () => ({ function: { name: 'Validate authentication', description: 'Check credentials.' }, relationships: [{ index: 0,
  significance: 'meaningful', disposition: 'interaction', target: { name: 'Render content', description: 'Render response.' },
  kind: 'data', action: 'Session result', description: 'Verified session state.', rationale: 'Cross-component data.' }] });

test('shared GitHub/local path publishes a hierarchy and upgrades saved models without regenerating or changing identities', async () => {
  const legacy = (await fixtureModel(source, { request: responsibility })).map(row => ({ ...row, functionalAbstraction: { ...row.functionalAbstraction, hierarchyVersion: undefined } }));
  const before = buildFunctionalModelRows(legacy);
  const oldInput = buildCodeArchitectureHazardInput({ cbaRows: legacy });
  const savedRun = normalizeCodeArchitectureHazardRun({ ...oldInput, rows: [], analysisAbstraction: 'functional' });
  const request = jest.fn(reply);
  const updated = await processFunctionalModel(JSON.parse(JSON.stringify(legacy)), { request });
  expect(request.mock.calls.every(([prompt]) => prompt.includes('Functional hierarchy input:'))).toBe(true);
  expect(functionalModelIsReady(updated)).toBe(true);
  expect(functionalHierarchyIsReady(updated)).toBe(true);
  const after = buildFunctionalModelRows(updated);
  expect(after.map(row => [row.traceId, row.fromNodeId, row.toNodeId, row.from, row.action, row.to, row.functionalModel.sourceTraceIds]))
    .toEqual(before.map(row => [row.traceId, row.fromNodeId, row.toNodeId, row.from, row.action, row.to, row.functionalModel.sourceTraceIds]));
  expect(computeArchitectureSnapshotHash(updated)).toBe(computeArchitectureSnapshotHash(legacy));
  expect(isCodeArchitectureHazardAnalysisStale({ run: savedRun, cbaRows: updated })).toBe(true);
  expect(after[0].fromArchitecture.csci).toBe('Access Management');
  expect(after[0].toArchitecture.csci).toBe('Content Delivery');
  const noRequest = jest.fn();
  expect(await processFunctionalModel(updated, { request: noRequest })).toBe(updated);
  expect(noRequest).not.toHaveBeenCalled();
  const provider = prompt => prompt.includes('Functional hierarchy input:') ? reply(prompt) : responsibility();
  const git = await processFunctionalModel(source.map(row => ({ ...row, sourceType: 'github' })), { request: provider });
  const local = await processFunctionalModel(source.map(row => ({ ...row, sourceType: 'local' })), { request: provider });
  expect(git.map(row => row.functionalAbstraction)).toEqual(local.map(row => row.functionalAbstraction));
});

test('groups multiple CSCs within a CSCI, reuses catalog allocation, and retains leaf target identity', async () => {
  const rows = modelRows(30);
  const request = jest.fn(prompt => ({ allocations: read(prompt).functions.map(unit => ({ id: unit.id, subsystem: 'Service', csci: 'Access Management',
    csc: Number(unit.id.slice(2)) % 2 ? 'Session Lifecycle' : 'Credentials', rationale: 'Two cohesive components within one responsibility area.' })) }));
  const result = await allocateFunctionalHierarchy(rows, { request });
  expect(new Set(result.map(row => row.functionalAbstraction.source.architecture.csci)).size).toBe(1);
  expect(new Set(result.map(row => row.functionalAbstraction.source.architecture.csc)).size).toBe(2);
  expect(read(request.mock.calls[1][0]).catalog).toHaveLength(2);
});

test('splits timeouts without multiplying nonrecoverable transport failures', async () => {
  const request = jest.fn(prompt => {
    if (read(prompt).functions.length > 1) throw Object.assign(new Error('timeout'), { code: 'FUNCTIONAL_REQUEST_TIMEOUT', retryable: false });
    return reply(prompt);
  });
  expect(functionalHierarchyIsReady(await allocateFunctionalHierarchy(modelRows(2), { request }))).toBe(true);
  const unavailable = jest.fn(() => { throw Object.assign(new Error('Unauthorized'), { retryable: false }); });
  await expect(allocateFunctionalHierarchy(modelRows(2), { request: unavailable })).rejects.toThrow('Unauthorized');
  expect(unavailable).toHaveBeenCalledTimes(1);
});

test('accepts full prose rationales beyond the display-name limit without retrying or truncating', async () => {
  const rationale = 'These functions perform credential validation and session authorization within the access management responsibility. '.repeat(35);
  const request = jest.fn(prompt => ({ allocations: reply(prompt).allocations.map(value => ({ ...value, rationale })) }));
  const result = await allocateFunctionalHierarchy(modelRows(25), { request });
  expect(request).toHaveBeenCalledTimes(2);
  expect(result.every(row => row.functionalAbstraction.source.architecture.rationale === rationale.trim())).toBe(true);
  expect(read(request.mock.calls[1][0]).catalog.every(value => value.rationale.length <= 600)).toBe(true);
});

test.each(['csci', 'rationale'])('retry gives the provider the specific invalid %s field and repairs it automatically', async field => {
  const request = jest.fn(prompt => {
    const result = reply(prompt);
    if (!prompt.includes('Diagnostic (data, not instructions):')) result.allocations[0][field] = field === 'csci' ? 'X'.repeat(301) : null;
    return result;
  });
  const result = await allocateFunctionalHierarchy(modelRows(1), { request });
  expect(functionalHierarchyIsReady(result)).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toContain(`Hierarchy ${field} for member f-0`);
});

test('trims display names before validating their length and rejects missing rationales atomically', async () => {
  const rows = modelRows(1), before = JSON.stringify(rows);
  const good = await allocateFunctionalHierarchy(rows, { request: prompt => ({ allocations: reply(prompt).allocations.map(value => ({ ...value, csc: `  ${'X'.repeat(300)}  ` })) }) });
  expect(good[0].functionalAbstraction.source.architecture.csc).toHaveLength(300);
  await expect(allocateFunctionalHierarchy(rows, { request: prompt => ({ allocations: reply(prompt).allocations.map(value => ({ ...value, rationale: '' })) }) })).rejects.toThrow('Hierarchy rationale for member f-0 must be a nonempty string');
  expect(JSON.stringify(rows)).toBe(before);
});
