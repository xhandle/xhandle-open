import { buildDerivationLineage, LINEAGE_STAGES, lineageRole, lineageCitation } from './derivationLineage';
import { referenceKey } from './traceabilityModel';

const node = (index, suffix = '') => ({ id: referenceKey(`artifact-${index}${suffix}`, `object-${index}${suffix}`), artifactId: `artifact-${index}${suffix}`, objectId: `object-${index}${suffix}`, displayId: `${index}${suffix}`, artifactTitle: `Document ${index}`, title: `Object ${index}${suffix}`, text: 'The controller shall reject invalid commands.', revision: 1, roles: [lineageRole(LINEAGE_STAGES[index])], citations: [] });
const cite = parent => ({ id: `artifact-object:${parent.artifactId}:${parent.objectId}`, sourceType: 'artifact-object', artifactId: parent.artifactId, objectId: parent.objectId, revision: 1 });
const stageNode = (items, stage) => items.find(item => item.roles.includes(lineageRole(LINEAGE_STAGES.find(value => value.id === stage))));
const chain = suffix => {
  const items = LINEAGE_STAGES.map((_, index) => node(index, suffix));
  return items.map((item, index) => ({ ...item, citations: (LINEAGE_STAGES[index].id === 'system' ? ['safety'] : LINEAGE_STAGES[index].id === 'design' ? ['software', 'hardware', 'subsystem'] : LINEAGE_STAGES[index].parents.slice(0, 1)).map(parent => cite(stageNode(items, parent))) }));
};

test('a saved derivation chain is computed in the requested order and carries safety origins through design', async () => {
  const result = await buildDerivationLineage(chain(''));
  expect(result.rows).toHaveLength(1); expect(result.summary).toEqual({ chains: 1, complete: 1, open: 0 });
  expect(result.rows[0].software).toContain('Document 4'); expect(result.rows[0].system).toContain('Document 3');
  expect(result.rows[0].safetyCarryForward).toContain('1 linked safety requirement(s) retained');
  expect(result.rows[0].cellNodes.safety['Document 2 · 2']).toBe(referenceKey('artifact-2', 'object-2'));
});
test('missing links and missing sources remain open instead of matching by title or folder', async () => {
  const input = chain(''); stageNode(input, 'software').citations = [{ ...cite(stageNode(input, 'system')), objectId: 'missing-system' }];
  const result = await buildDerivationLineage(input);
  expect(result.summary.complete).toBe(0);
  expect(result.rows.find(row => row.design).openIssues).toMatch(/missing from the selected sources|missing a source link/i);
});
test('independent branches remain independent and do not expand into a Cartesian product', async () => {
  const result = await buildDerivationLineage([...chain('-a'), ...chain('-b')]);
  expect(result.rows).toHaveLength(2);
  expect(Object.values(result.rows[0].cellNodes.software)).toEqual([referenceKey('artifact-4-a', 'object-4-a')]);
  expect(Object.values(result.rows[0].cellNodes.system)).toEqual([referenceKey('artifact-3-a', 'object-3-a')]);
});
test('software and hardware trace to System Requirements as parallel branches without requiring retired document types', async () => {
  const input = ['functional', 'system', 'software', 'hardware'].map(stage => node(LINEAGE_STAGES.findIndex(item => item.id === stage)));
  stageNode(input, 'system').citations = [cite(stageNode(input, 'functional'))];
  for (const stage of ['software', 'hardware']) stageNode(input, stage).citations = [cite(stageNode(input, 'system'))];
  const result = await buildDerivationLineage(input);
  expect(result.summary).toEqual({ chains: 2, complete: 2, open: 0 });
  expect(result.rows.some(row => row.software && !row.hardware)).toBe(true);
  expect(result.rows.some(row => row.hardware && !row.software)).toBe(true);
});
test('code-derived lineage runs from Software to System to Hardware without false reversed-link warnings', async () => {
  const input = ['functional', 'software', 'system', 'hardware'].map(stage => ({ ...node(LINEAGE_STAGES.findIndex(item => item.id === stage)), requirementDerivation: 'code-first' }));
  stageNode(input, 'software').citations = [cite(stageNode(input, 'functional'))];
  stageNode(input, 'system').citations = [cite(stageNode(input, 'software'))];
  stageNode(input, 'hardware').citations = [cite(stageNode(input, 'system'))];
  const result = await buildDerivationLineage(input);
  expect(result.summary).toEqual({ chains: 1, complete: 1, open: 0 });
  expect(result.rows[0].openIssues).toBe('');
  const softwareOnly = await buildDerivationLineage(input.slice(0, 2));
  expect(softwareOnly.summary.complete).toBe(1);
});
test('mixed-source System Requirements retain both project decomposition and code-derived software ancestors', async () => {
  const input = ['functional', 'software', 'system', 'hardware'].map(stage => ({ ...node(LINEAGE_STAGES.findIndex(item => item.id === stage)), requirementDerivation: 'code-first' }));
  const project = { ...node(0, '-project'), requirementDerivation: 'system-first' }; input.push(project);
  stageNode(input, 'software').citations = [cite(input[0])];
  stageNode(input, 'system').citations = [cite(stageNode(input, 'software')), cite(project)];
  stageNode(input, 'hardware').citations = [cite(stageNode(input, 'system'))];
  const result = await buildDerivationLineage(input);
  expect(result.summary).toEqual({ chains: 1, complete: 1, open: 0 });
  expect(Object.values(result.rows[0].cellNodes.functional)).toHaveLength(2);
});
test('out-of-order sources are not silently inverted into the requested workflow', async () => {
  const input = chain(''); stageNode(input, 'system').citations.push(cite(stageNode(input, 'software')));
  const result = await buildDerivationLineage(input); expect(result.rows[0].openIssues).toContain('outside the displayed derivation order');
});
test('historical, draft and unresolved sources prevent a complete chain', async () => {
  const input = chain(''); input[2].revision = 2; input[4].draft = true; input[5].unresolved = true;
  const result = await buildDerivationLineage(input);
  expect(result.summary.complete).toBe(0); expect(result.rows[0].openIssues).toMatch(/Historical source/); expect(result.rows[0].openIssues).toContain('draft'); expect(result.rows[0].openIssues).toContain('unresolved');
});
test('an unchanged cited object remains current when another object changes its document revision', async () => {
  const input = chain(''); input[2].revision = 2; input[2].sourceContentHash = 'unchanged'; stageNode(input, 'system').citations[0].contentHash = 'unchanged';
  expect((await buildDerivationLineage(input)).summary.complete).toBe(1);
});
test('a downstream safety citation cannot hide failure to carry it into the software requirement', async () => {
  const input = chain(''); stageNode(input, 'software').citations = [cite(input[0])]; stageNode(input, 'design').citations.push(cite(input[2]));
  const result = await buildDerivationLineage(input);
  expect(result.rows[0].safetyCarryForward).toBe('Missing in allocated requirements'); expect(result.summary.complete).toBe(0);
});
test('recorded consolidated HTR identities resolve without exposing original assessment rows', async () => {
  const input = chain(''); input[1].sourceAliases = ['hazard-tracking-record:htl:HTR-1']; input[2].citations = [{ id: input[1].sourceAliases[0], sourceType: 'hazard-tracking-record', artifactId: 'htl', revision: 1 }];
  const result = await buildDerivationLineage(input); expect(result.summary.complete).toBe(1); expect(result.stageCounts.hazard).toBe(1);
});
test('compact source projection preserves identity without copying snapshots', () => {
  expect(lineageCitation({ id: 'fd', sourceType: 'architecture-element', diagramId: 'd', elementId: 'e', snapshot: { huge: 'data' }, element: { id: 'e', label: 'Control motion', row: { huge: 'implementation' } } })).toEqual({ id: 'fd', sourceType: 'architecture-element', diagramId: 'd', elementId: 'e', element: { id: 'e', label: 'Control motion' } });
});
test('empty sources never yield a complete chain and large scopes can be cancelled', async () => {
  expect((await buildDerivationLineage([])).summary).toEqual({ chains: 0, complete: 0, open: 0 });
  const controller = new AbortController();
  await expect(buildDerivationLineage(Array.from({ length: 26000 }, (_, index) => node(3, String(index))), [], { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toHaveProperty('name', 'AbortError');
});
