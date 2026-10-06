import { projectFunctionalArchitecture } from './functionalArchitectureProjection';

const row = (from, to, extra = {}) => ({ from, to, fromFile: 'src/control.py', toFile: 'src/control.py', action: `Call ${to}`, architecture: { subsystem: 'Control' }, ...extra });
const unknown = { targetResolution: 'unresolved-runtime-target', supported: true };
test('accounts for all current rows while grouping local implementation operations and imports', () => {
  const rows = [row('drive', 'validate', { relationshipEvidence: { targetResolution: 'lexical-definition' } }),
    row('validate', 'validate::values.append', { relationshipEvidence: unknown }),
    row('drive', 'numpy.array', { relationshipEvidence: { targetResolution: 'import-reference' } }),
    row('drive', 'numpy.zeros', { relationshipEvidence: { targetResolution: 'import-reference' } }),
    row('drive', 'send', { toFile: 'src/transport.py' }),
    row('old', 'removed', { lineage: { status: 'historical' } })];
  const snapshot = JSON.stringify(rows);
  const graph = projectFunctionalArchitecture(rows);
  expect(graph.nodes.map(n => n.label)).toEqual(expect.arrayContaining(['drive', 'validate', 'send', 'numpy interface']));
  expect(graph.nodes.some(n => n.label.includes('append'))).toBe(false);
  expect(graph.nodes.find(n => n.label === 'validate').operations).toEqual([1]);
  expect(graph.edges.some(e => e.rowIndices.length === 2)).toBe(true);
  expect([...new Set(graph.nodes.flatMap(n => n.rowIndices))].sort()).toEqual([0, 1, 2, 3, 4]);
  expect(JSON.stringify(rows)).toBe(snapshot);
});

test.each(['py', 'cpp'])('uses the same evidence policy for %s and retains source-defined leaf functions', extension => {
  const path = `src/controller.${extension}`;
  const rows = [row('run', 'check', { fromFile: path, toFile: path, relationshipEvidence: unknown,
    sourceEvidence: { functions: [{ filePath: path, functionName: 'check' }] } }),
    row('run', 'items.append', { fromFile: path, toFile: path, relationshipEvidence: unknown })];
  const graph = projectFunctionalArchitecture(rows);
  expect(graph.nodes.map(n => n.label).sort()).toEqual(['check', 'run']);
  expect(graph.nodes.find(n => n.label === 'run').operations).toEqual([1]);
});

test('GitHub and local provenance do not affect projection identities, grouping or connections', () => {
  const rows = [row('run', 'run::state.get', { relationshipEvidence: unknown }), row('run', 'stop', { toFile: 'actuator.cpp' })];
  const github = projectFunctionalArchitecture(rows.map(r => ({ ...r, sourceType: 'github', owner: 'org', commitSha: 'abc' })));
  const local = projectFunctionalArchitecture(rows.map(r => ({ ...r, sourceType: 'local', localRootName: 'folder', snapshotId: 'xyz' })));
  expect(local).toEqual(github);
});

test('retains ambiguous/legacy boundaries, distinct names across files, recursion and rows without a target', () => {
  const rows = [row('run', 'unknown'), row('run', 'run'), row('run', ''), row('run', 'unknown', { fromFile: 'other.cpp', toFile: 'other.cpp' }),
    row('run', 'api', { toFile: 'external.hpp', relationshipEvidence: unknown })];
  const graph = projectFunctionalArchitecture(rows);
  expect(graph.nodes.filter(n => n.label === 'run')).toHaveLength(2);
  expect(graph.nodes.filter(n => n.label === 'unknown')).toHaveLength(2);
  expect(graph.nodes.some(n => n.label === 'api')).toBe(true);
  expect(new Set(graph.nodes.flatMap(n => n.rowIndices)).size).toBe(rows.length);
  expect(graph.edges.every(e => e.source !== e.target)).toBe(true);
  expect(projectFunctionalArchitecture([])).toEqual({ nodes: [], edges: [], rowCount: 0 });
});
