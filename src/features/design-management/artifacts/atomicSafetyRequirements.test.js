import { organizeAtomicSafetyRequirements, splitShallStatements } from './atomicSafetyRequirements';
import { computeNumbering } from '../../requirements/components/RequirementsViews';
jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));

const paragraph = 'The system shall register base-addition callbacks on all three velocity arrays before any array is populated, and shall not return a trajectory to downstream planning until the stairstep velocity and heading-rate interpolators are established by builder defaults. Builder defaults shall be applied once as the first step of trajectory construction, before any base or interpolator configuration. Every base addition on the three velocity arrays shall be propagated to dependent state before that state is used for planning, and only base additions defined as valid for the trajectory shall be propagated. The same registration-to-base-addition ordering shall be applied to all three arrays to ensure uniform propagation coverage.';
const root = { id: 'a:s1', sectionId: 's1', kind: 'section', title: 'Safety requirements', text: '', sourceIds: [] };
const topic = { id: 'a:topic', sectionId: 's1', parentId: root.id, title: 'Velocity array callbacks and trajectory initialization synchronization', text: paragraph, kind: 'requirement', sourceIds: ['HTR-source'], sourceEvidence: [{ id: 'HTR-source', recordId: 'HTR-1' }], attributes: { HTR: 'HTR-1' }, status: 'Proposed', manual: false };

test('the grouped velocity-array example becomes six independent child requirements', () => {
  const objects = organizeAtomicSafetyRequirements([root, topic]);
  const parent = objects.find(object => object.id === topic.id), children = objects.filter(object => object.parentId === topic.id);
  expect(parent).toMatchObject({ title: topic.title, kind: 'section', requirementGroup: true, text: '' });
  expect(children).toHaveLength(6);
  expect(children[0].text).toBe('The system shall register base-addition callbacks on all three velocity arrays before any array is populated.');
  expect(children[1].text).toBe('The system shall not return a trajectory to downstream planning until the stairstep velocity and heading-rate interpolators are established by builder defaults.');
  expect(children[4].text).toBe('The system shall propagate only base additions defined as valid for the trajectory.');
  for (const child of children) {
    expect(child.kind === 'requirement' || child.proposedKind === 'requirement').toBe(true); expect(child.text.match(/\bshall\b/gi)).toHaveLength(1);
    expect(child.sourceIds).toEqual(topic.sourceIds); expect(child.sourceEvidence).toEqual(topic.sourceEvidence);
    expect(child.attributes.HTR).toBe('HTR-1'); expect(child.sectionId).toBe('s1');
  }
  const numbering = computeNumbering(objects);
  expect(numbering.get(parent.id)).toBe('1.1'); expect(numbering.get(children[0].id)).toBe('1.1.1');
  expect(organizeAtomicSafetyRequirements(objects)).toEqual(objects);
  expect(topic.text).toBe(paragraph);
});

test('shared conditions, decimal thresholds and method names survive splitting', () => {
  const text = 'If validation fails, the controller shall reject commands older than 0.5 ms and shall prevent rebuild() or compute() calls. The builder shall preserve source.orientation state.';
  const { requirements } = splitShallStatements(text);
  expect(requirements).toEqual(['If validation fails, the controller shall reject commands older than 0.5 ms.', 'If validation fails, the controller shall prevent rebuild() or compute() calls.', 'The builder shall preserve source.orientation state.']);
  expect(splitShallStatements('If check(a, b) fails, the controller shall stop, and diagnostics shall log the fault and shall notify the operator.').requirements).toEqual(['If check(a, b) fails, the controller shall stop.', 'If check(a, b) fails, diagnostics shall log the fault.', 'If check(a, b) fails, diagnostics shall notify the operator.']);
  expect(splitShallStatements('The controller shall call validate(a; b) and shall log the result.').requirements).toEqual(['The controller shall call validate(a; b).', 'The controller shall log the result.']);
});

test('non-normative context remains on the topic and alternatives are not converted into simultaneous obligations', () => {
  const text = 'This topic covers command validation. The controller shall accept the command or shall reject it. The controller shall log the result.';
  const result = organizeAtomicSafetyRequirements([{ ...topic, text }]);
  expect(result[0].text).toBe('This topic covers command validation.');
  expect(result[1].text).toBe('The controller shall accept the command or shall reject it.');
  expect(result[2].text).toBe('The controller shall log the result.');
  expect(organizeAtomicSafetyRequirements(result)).toEqual(result);
});

test('unsupported and manually edited proposals retain their evidence status, wording and traceability', () => {
  const gap = { ...topic, manual: true, kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'unresolved-upstream', attributes: { HTR: 'HTR-1', Description: 'User topic summary.' }, text: 'The controller shall reject invalid commands. The controller shall log rejection.' };
  const result = organizeAtomicSafetyRequirements([gap]);
  expect(result[0].attributes.Description).toBe('User topic summary.');
  for (const child of result.slice(1)) {
    expect(child).toMatchObject({ kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'unresolved-upstream', manual: true });
    expect(child.attributes).not.toHaveProperty('Description');
  }
});
