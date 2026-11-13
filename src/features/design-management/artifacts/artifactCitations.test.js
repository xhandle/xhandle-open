import { citationContext, unresolvedCitationGaps } from './artifactCitations';
import { validateSection, artifactObjectText } from './artifactModel';
const entry = { id: 'module:folder/module:long-id', title: 'Operational need', attributes: { Description: 'Retain commands' } };
test('short references resolve only within the request and never change saved evidence', () => {
  const manifest = { entries: [entry, { id: 'project:owner', sourceType: 'project' }] };
  const before = JSON.stringify(manifest), context = citationContext(manifest);
  expect(context.sources.map(source => source.id)).toEqual(['S1']);
  expect(context.resolve({ objects: [{ sourceIds: ['S1', 'invented'] }] }).objects[0].sourceIds).toEqual([entry.id, 'invented']);
  expect(JSON.stringify(manifest)).toBe(before);
  expect(citationContext({ entries: [{ ...entry, id: 'different-source' }] }).resolve({ objects: [{ sourceIds: ['S1'] }] }).objects[0].sourceIds).toEqual(['different-source']);
});
test('nested evidence cannot be mistaken for additional citable sources', () => {
  const context = citationContext({ entries: [{ ...entry, artifactId: 'private-artifact', upstreamSourceIds: ['not-top-level'], architectureEvidence: [{ id: 'nested-source', diagramId: 'private-diagram', title: 'Control', text: 'Sends a command', element: { label: 'Control', files: ['controller.cpp'] } }] }] });
  const text = JSON.stringify(context.sources); expect(text).not.toContain('nested-source'); expect(text).not.toContain('private-artifact'); expect(text).not.toContain('not-top-level'); expect(text).toContain('controller.cpp'); expect(text).toContain('Sends a command');
});
test('alias names cannot collide with canonical IDs', () => {
  const context = citationContext({ entries: [{ ...entry, id: 'S2' }, entry] });
  expect(context.sources.map(source => source.id)).toEqual(['SS1', 'SS2']);
  expect(context.resolve({ objects: [{ sourceIds: ['SS1', 'SS2'] }] }).objects[0].sourceIds).toEqual(['S2', entry.id]);
});
test('unresolved references produce explicit gaps, retain legitimate links, and do not invent support', () => {
  const response = { objects: [{ key: 'claim', kind: 'requirement', title: 'Timing', text: 'Timing is 10 ms.', sourceIds: [entry.id, 'bad'] }] };
  const allowed = new Set([entry.id]); const recovery = unresolvedCitationGaps(response, allowed);
  const object = validateSection(recovery.response, { id: 's1', title: 'Scope' }, 'artifact', allowed)[1]; Object.assign(object, recovery.issues.get(object.key));
  expect(object).toMatchObject({ kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'unknown-citation', sourceIds: [entry.id], unresolvedCitationCount: 1 });
  expect(artifactObjectText(object)).toContain('Unverified generated text:'); expect(response.objects[0].kind).toBe('requirement');
});
test('citation recovery never repairs malformed source lists or invalid content', () => {
  const allowed = new Set();
  for (const sourceIds of ['bad', [{ id: 'bad' }], Array(101).fill('bad')]) {
    const recovery = unresolvedCitationGaps({ objects: [{ key: 'x', kind: 'requirement', title: 'Claim', text: 'Text', sourceIds }] }, allowed);
    expect(() => validateSection(recovery.response, { id: 's1' }, 'a', allowed)).toThrow('invalid supporting-reference list');
  }
});
