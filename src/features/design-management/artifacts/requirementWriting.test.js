import { completeRequirementSentence, requirementWritingIssues, REQUIREMENT_WRITING_GUIDANCE } from './requirementWriting';
import { organizeAtomicSafetyRequirements } from './atomicSafetyRequirements';
import { artifactObjectText } from './artifactModel';

const topic = { id: 'safety:topic', sectionId: 's2', kind: 'requirement', parentId: null, title: 'Virtual wall marker constraints', sourceIds: ['HTR-source'], sourceEvidence: [{ id: 'HTR-source', recordId: 'HTR-7' }], attributes: { HTR: 'HTR-7' } };
const markerParagraph = 'The system shall build the yellow slow-down virtual wall marker array only when the speed-restriction input is true and the placement pose covariance is within 0.5 m²; otherwise no marker shall be built, and a no-marker status shall be published. The dead line marker array shall be generated within 20 ms; a result completed after that limit shall be flagged as stale rather than presented as current.';

test('the marker example retains the complete alternative condition in each child and does not leak it into the next sentence', () => {
  const objects = organizeAtomicSafetyRequirements([{ ...topic, text: markerParagraph }]);
  const children = objects.filter(object => object.parentId === topic.id);
  expect(children).toHaveLength(5);
  expect(objects[0].requirementSourceText).toBe(markerParagraph);
  expect(children[1].text).toBe('If NOT (the speed-restriction input is true and the placement pose covariance is within 0.5 m²), the system shall not build a marker.');
  expect(children[2].text).toBe('If NOT (the speed-restriction input is true and the placement pose covariance is within 0.5 m²), the system shall publish a no-marker status.');
  expect(children[3].text).toBe('The system shall generate the dead line marker array within 20 ms.');
  expect(children[4]).toMatchObject({ kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'requirement-writing' });
  expect(artifactObjectText(children[4])).toContain('Replace references to neighboring statements');
  expect(children.every(object => object.sourceIds[0] === 'HTR-source' && object.attributes.HTR === 'HTR-7')).toBe(true);
  expect(organizeAtomicSafetyRequirements(objects)).toEqual(objects);
});

test('old saved children keep their identities while dependent wording is repaired or explicitly flagged', () => {
  const raw = ['The system shall build the yellow slow-down virtual wall marker array only when the speed-restriction input is true and the placement pose covariance is within a validated limit.', 'otherwise no marker shall be built.', 'a no-marker status shall be published.', 'The dead line marker array shall be generated within a validated latency limit.', 'a result completed after that limit shall be flagged as stale rather than presented as current.'];
  const children = raw.map((text, index) => ({ ...topic, id: `safety:child-${index}`, title: text, text, parentId: topic.id, requirementGroupId: topic.id, order: index, atomicRequirement: true }));
  const objects = organizeAtomicSafetyRequirements([{ ...topic, kind: 'section', text: '', requirementGroup: true }, ...children]);
  expect(objects.slice(1).map(object => object.id)).toEqual(children.map(object => object.id));
  expect(objects[2].text).toMatch(/^If NOT \(.+\), the system shall not build a marker\.$/);
  expect(objects[3].requirementWritingIssues.join(' ')).toContain('Confirm the explicit condition');
  expect(objects[4].text).not.toContain('If NOT');
  expect(objects.slice(1).every(object => object.kind === 'gap' && object.proposedKind === 'requirement')).toBe(true);
  expect(organizeAtomicSafetyRequirements(objects)).toEqual(objects);
});

test('standalone checks catch fragments, cross-row references, vague limits and bundled obligations without inventing missing facts', () => {
  for (const text of ['Otherwise no marker shall be built.', 'It shall report this condition.', 'The controller shall generate output within a validated latency limit.', 'A result completed after that limit shall be flagged as stale.', 'The controller shall stop and shall log the fault.', 'The controller shall reject expired commands and report rejection.', 'The controller shall.']) expect(requirementWritingIssues(text).length).toBeGreaterThan(0);
  expect(requirementWritingIssues('If command age exceeds 20 ms, the controller shall reject the command.')).toEqual([]);
  expect(requirementWritingIssues('The controller shall reject the command when input quality is invalid and report age exceeds 20 ms.')).toEqual([]);
  expect(completeRequirementSentence('otherwise no marker shall be built.')).toBe('Otherwise no marker shall be built.');
  expect(REQUIREMENT_WRITING_GUIDANCE).toContain('INCOSE');
  expect(REQUIREMENT_WRITING_GUIDANCE).toContain('one sentence');
});

test('an otherwise branch with a shared subject keeps its negative condition on each action', () => {
  const objects = organizeAtomicSafetyRequirements([{ ...topic, text: 'If command age exceeds 20 ms, the controller shall reject the command; otherwise the controller shall accept the command and shall log acceptance.' }]);
  const children = objects.filter(object => object.parentId === topic.id);
  expect(children.map(object => object.text)).toEqual(['If command age exceeds 20 ms, the controller shall reject the command.', 'If NOT (command age exceeds 20 ms), the controller shall accept the command.', 'If NOT (command age exceeds 20 ms), the controller shall log acceptance.']);
  expect(children.every(object => object.kind === 'requirement')).toBe(true);
});
