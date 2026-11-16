import { hazardRequirementOwners, projectHazardRequirements, mergeHazardRequirementSources, includeRecordedSafetyRequirements, inheritRequirementSafety, requirementSafetyCoverage } from './requirementSafety';
import { organizeAtomicSafetyRequirements } from './atomicSafetyRequirements';
import { artifactRequirementRows } from './artifactRequirementsAdapter';

const provenance = { projectId: 'p', workspaceType: 'functional', analysisId: 'analysis', sourceRowId: 'row-1' };
const statement = 'The controller shall reject motion commands older than 100 ms.';
const source = () => projectHazardRequirements({ 'System Requirement': statement, 'Safety Significant': 'Yes', ASIL: 'D' }, provenance)[0];
test('Projects safety enters System and code safety enters Software, including mixed owners', () => {
  const ownerProjects = [{ id: 'p', workspaceType: 'functional' }, { id: 'c', workspaceType: 'code-architecture' }];
  const config = { ownerProjects, architectureSources: [{ projectId: 'c', workspaceType: 'code-architecture' }] };
  expect(hazardRequirementOwners({ ...config, templateId: 'system-spec' })).toEqual([ownerProjects[0]]);
  expect(hazardRequirementOwners({ ...config, templateId: 'software-spec' })).toEqual([ownerProjects[1]]);
  expect(hazardRequirementOwners({ ...config, templateId: 'hardware-spec' })).toEqual([]);
  expect(hazardRequirementOwners({ ...config, architectureSources: [{ projectId: 'p', workspaceType: 'functional' }], templateId: 'software-spec' })).toEqual([]);
});
test('minimal projection keeps distinct safety obligations, deduplicates repeats and excludes non-applicable and non-safety rows', () => {
  const cells = { 'System Requirement': statement, 'Safety Constraint': 'The controller shall inhibit motion after detecting a stale command.', 'Safety Requirements/Constraints': statement, 'Safety Significant': 'Yes', ASIL: 'D', 'Internal evidence': 'unused' };
  const projected = projectHazardRequirements(cells, provenance);
  expect(projected).toHaveLength(2); expect(JSON.stringify(projected)).not.toContain('Internal evidence');
  const merged = mergeHazardRequirementSources([...projected, ...projectHazardRequirements(cells, { ...provenance, sourceRowId: 'row-2' })]);
  expect(merged).toHaveLength(2); expect(merged[0].hazardReferences.map(ref => ref.sourceRowId)).toEqual(['row-1', 'row-2']);
  expect(projectHazardRequirements({ ...cells, 'Guide Phrase Applicable': 'No' }, provenance)).toEqual([]);
  expect(projectHazardRequirements({ ...cells, 'Safety Significant': 'No', 'Safety Classification': 'Mission/Reliability' }, provenance)).toEqual([]);
  expect(projectHazardRequirements({ 'Safety Constraint': 'Prevent unintended motion.' }, provenance)[0]).toMatchObject({ kind: 'constraint', attributes: { 'Safety Significant': 'Yes' } });
});
test('recorded requirements survive model omission; repeated text is linked without mutating the original object', () => {
  const entry = source(), manifest = { entries: [entry] };
  expect(includeRecordedSafetyRequirements([], manifest, 'spec', 's1')).toEqual([]);
  const added = includeRecordedSafetyRequirements([], manifest, 'spec', 's2');
  expect(added[0]).toMatchObject({ text: statement, sourceIds: [entry.id], recordedSafetyRequirement: true });
  const model = { id: 'model', kind: 'requirement', text: statement, sourceIds: ['diagram'] };
  expect(includeRecordedSafetyRequirements([model], manifest, 'spec', 's2')[0].sourceIds).toEqual(['diagram', entry.id]);
  expect(model.sourceIds).toEqual(['diagram']);
});
test('atomic children inherit safety metadata and every subsequent derived requirement retains exact parent and origin references', () => {
  const entry = { ...source(), text: `${statement} The controller shall publish a stale-command fault.` };
  const children = inheritRequirementSafety(organizeAtomicSafetyRequirements(includeRecordedSafetyRequirements([], { entries: [entry] }, 'system', 's2')), [entry]).filter(object => object.kind === 'requirement');
  expect(children).toHaveLength(2);
  for (const child of children) expect(child.attributes).toMatchObject({ 'Safety Significant': 'Yes', 'Source ASIL': 'D', 'Safety Source IDs': [entry.id] });
  const parent = { ...children[0], id: 'artifact-object:system:r1' };
  const derived = inheritRequirementSafety([{ id: 'software', kind: 'requirement', sourceIds: [parent.id], attributes: { 'Safety Significant': 'No' } }], [parent])[0];
  expect(derived.attributes).toMatchObject({ 'Safety Significant': 'Yes', 'Safety Source IDs': [parent.id, entry.id], 'Source ASIL': 'D' });
  const next = inheritRequirementSafety([{ id: 'next', kind: 'requirement', sourceIds: ['artifact-object:software:r1'] }], [{ ...derived, id: 'artifact-object:software:r1' }])[0];
  expect(next.attributes['Safety Source IDs']).toEqual(['artifact-object:software:r1', parent.id, entry.id]);
  const projected = artifactRequirementRows({ id: 'spec' }, {}, [next], { entries: [] });
  expect(projected.rows[0].attributes['Safety Significant']).toBe('Yes');
});
test('missing safety allocation is a traceable gap, never an invented hardware requirement or silent omission', () => {
  const entry = { ...source(), sourceType: 'artifact-object' };
  const gaps = requirementSafetyCoverage({ entries: [entry] }, { s2: [{ kind: 'narrative', sourceIds: [entry.id] }] }, 'hardware');
  expect(gaps).toHaveLength(1); expect(gaps[0]).toMatchObject({ kind: 'gap', evidenceIssue: 'unresolved-safety-allocation', sourceIds: [entry.id] });
  expect(requirementSafetyCoverage({ entries: [entry] }, { s6: gaps }, 'hardware')).toEqual([]);
});
test('uncertain significance stays uncertain and string lineage does not split into individual characters', () => {
  const parent = { id: 'p', attributes: { 'Safety Significant': 'Needs review', 'Safety Source IDs': 'original-id', 'Source ASIL': 'D; B' } };
  const result = inheritRequirementSafety([{ kind: 'requirement', sourceIds: ['p'] }], [parent])[0];
  expect(result.attributes).toEqual({ 'Safety Significant': 'Needs review', 'Safety Source IDs': ['p', 'original-id'], 'Source ASIL': 'B; D' });
  expect(inheritRequirementSafety([{ kind: 'requirement', sourceIds: [] }], [])[0].attributes).toBeUndefined();
  expect(requirementSafetyCoverage({ entries: [] }, { s2: [] }, 'spec')).toEqual([]);
});
