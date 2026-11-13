import { compactSafetyRequirementMetadata, prepareSafetyRequirements, safetyRequirementCoverage } from './safetyRequirements';
import { assertConsolidatedHazardInputs, consolidatedHazardSources } from './hazardTrackingSources';
import { consolidateHazardRows, assignHazardTrackingRecordNumbers } from './consolidateHazardRows';
import { hazardIssueEvidenceHash } from './hazardIssueEvidence';
import { contentGuidance } from './artifactContentGuidance';
import { artifactStorageSnapshot } from './artifactSources';
import { artifactDocumentSize, DOCUMENT_CONTENT_LIMIT } from './artifactSize';
import { validateArtifactObjects } from './artifactRepository';

const source = (id, constraint = 'Reject expired commands.', verification = 'Fault injection') => ({ id, sourceType: 'hazard-tracking-record', recordId: id, artifactTitle: 'Mission HTL', attributes: { 'Safety Constraint': [constraint], Verification: [verification] } });
const object = (id, evidence) => ({ id, kind: 'requirement', text: 'The controller shall reject expired commands.', sourceIds: evidence.map(item => item.id), sourceEvidence: evidence });

test('repeated requirements consolidate their HTR links while preserving recorded verification methods', () => {
  const first = source('HTR-1'), second = source('HTR-2', undefined, 'Inspection');
  const [requirement] = prepareSafetyRequirements([object('first', [first]), object('second', [second])]);
  expect(requirement.kind).toBe('requirement');
  expect(requirement.sourceIds).toEqual(['HTR-1', 'HTR-2']);
  expect(requirement.attributes).toEqual({ HTR: 'HTR-1, HTR-2', 'Source Hazard Tracking List': 'Mission HTL', Verification: 'Fault injection\nInspection' });
});

test('legacy verification copies exceeding 21 million characters compact without changing requirements or evidence', () => {
  const evidence = source('HTR-1');
  evidence.attributes.Verification = Array.from({ length: 150 }, (_, index) => `Method ${index}: ${'Recorded verification criteria. '.repeat(32)}`);
  const copied = evidence.attributes.Verification.join('\n');
  const legacy = Array.from({ length: 150 }, (_, index) => ({ ...object(`safety:item-${index}`, [evidence]), title: `Requirement ${index}`, parentId: null, manual: false, text: `The controller shall reject expired commands in recorded scenario ${index}.`, attributes: { Verification: copied } }));
  expect(artifactDocumentSize(legacy).content).toBeGreaterThan(21000000);
  expect(artifactDocumentSize(legacy).content).toBeGreaterThan(DOCUMENT_CONTENT_LIMIT);
  const compacted = compactSafetyRequirementMetadata(legacy, { entries: [evidence] });
  expect(artifactDocumentSize(compacted).content).toBeLessThan(100000);
  expect(() => validateArtifactObjects({ id: 'safety', templateId: 'safety-requirements' }, compacted)).not.toThrow();
  expect(compacted.map(object => object.text)).toEqual(legacy.map(object => object.text));
  expect(compacted.every(object => object.sourceEvidence[0] === evidence)).toBe(true);
  expect(compacted[0].attributes.Verification).toBe('150 recorded verification methods — see linked HTR evidence.');
  expect(compacted[0].verificationSourceIds).toEqual([evidence.id]);
  expect(evidence.attributes.Verification.join('\n')).toBe(copied);
  expect(compactSafetyRequirementMetadata(compacted).every((object, index) => object === compacted[index])).toBe(true);
});

test('metadata compaction preserves manually edited verification wording and distinct unit case', () => {
  const evidence = source('HTR-1', undefined, 'Recorded method. '.repeat(200));
  const manual = { ...object('manual', [evidence]), manual: true, attributes: { Verification: 'User verification criteria. '.repeat(150) } };
  const custom = { ...object('custom', [evidence]), attributes: { Verification: 'A separately authored method.' } };
  expect(compactSafetyRequirementMetadata([manual, custom])).toEqual([manual, custom]);
  const requirements = prepareSafetyRequirements([{ ...object('mw', [evidence]), text: 'The device shall remain below 10 mW.' }, { ...object('MW', [evidence]), text: 'The device shall remain below 10 MW.' }]);
  expect(requirements).toHaveLength(2);
  expect(requirements.every(object => object.attributes.Verification.length < 2000)).toBe(true);
});

test('a title alone cannot establish a safety requirement or verification evidence', () => {
  const evidence = source('HTR-3', 'Not specified', 'TBD');
  const [gap] = prepareSafetyRequirements([object('unsupported', [evidence])]);
  expect(gap).toMatchObject({ kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'missing-safety-constraint' });
  const gaps = safetyRequirementCoverage({ id: 'sr' }, { hash: 'h', entries: [evidence] }, { s2: [gap] });
  expect(gaps.map(item => item.title)).toEqual(['Safety constraint missing', 'Verification method missing']);
  expect(gaps.every(item => item.attributes.HTR === 'HTR-3')).toBe(true);
});

test('an omitted HTR with a recorded constraint is explicitly flagged for coverage review', () => {
  const first = source('HTR-1'), omitted = source('HTR-2');
  const gaps = safetyRequirementCoverage({ id: 'sr' }, { hash: 'h', entries: [first, omitted] }, { s2: [object('one', [first])] });
  expect(gaps).toHaveLength(1); expect(gaps[0]).toMatchObject({ title: 'Safety requirement coverage needs review', sourceIds: ['HTR-2'] });
});

test('thousands of original assessments become one concise HTR source and retain exact recorded constraints', () => {
  const rows = assignHazardTrackingRecordNumbers(Array.from({ length: 3482 }, (_, index) => ({ id: `row-${index}`, hazardTrackingRow: true, attributes: { Hazard: 'Expired command executed', Function: 'Controller', 'Safety Constraint': 'Reject commands older than 200 ms.', Verification: 'Fault injection' } })));
  const group = consolidateHazardRows(rows)[0];
  const section = { id: 'section', kind: 'section', sectionId: 's2', hazardIssueSummaries: { [group.id]: { title: 'Expired commands cause unintended motion', description: 'Expired commands may be executed after they are no longer valid. Prevent execution of stale commands.', evidenceHash: hazardIssueEvidenceHash(group) } } };
  const meta = { id: 'htl', title: 'Mission HTL', config: { projectId: 'p', workspaceType: 'functional' } };
  const captured = consolidatedHazardSources(meta, [section, ...rows], 2);
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({ recordId: 'HTR-1', revision: 2, attributes: { 'Safety Constraint': ['Reject commands older than 200 ms.'] } });
  expect(captured[0].objectIds).toHaveLength(3482);
  expect(JSON.stringify(captured[0].attributes).length).toBeLessThan(1000);
  expect(captured[0].sourceEvidence).toBeUndefined();
  expect(() => consolidatedHazardSources(meta, rows, 2)).toThrow('Finish consolidating');
});

test('drafting guidance calls for concise consolidated requirements, and safety source snapshots omit raw analyses', () => {
  expect(contentGuidance('safety-requirements')).toMatch(/Consolidate repeated constraints/);
  const getItem = jest.fn(() => null);
  const snapshot = artifactStorageSnapshot({ templateId: 'safety-requirements', projectId: 'p', workspaceType: 'functional', sources: [] }, { getItem });
  expect(snapshot).not.toHaveProperty('xhandle.projectData');
  expect(snapshot).not.toHaveProperty('xhandle:code-architecture-hazard-analysis:v1');
});

test('atomic source validation accepts the same HTRs in manifest order and rejects changed content', async () => {
  const rows = assignHazardTrackingRecordNumbers(Array.from({ length: 35 }, (_, index) => ({ id: `assessment-${index}`, hazardTrackingRow: true, attributes: { Hazard: `Unsafe command ${index}`, Function: `Controller ${index}` } })));
  const summaries = Object.fromEntries(consolidateHazardRows(rows).map(group => [group.id, { title: `Invalid output from ${group.attributes.Function}`, description: 'Invalid commands can cause unintended motion.', evidenceHash: hazardIssueEvidenceHash(group) }]));
  const objects = [{ id: 'section', kind: 'section', sectionId: 's2', hazardIssueSummaries: summaries }, ...rows];
  const meta = { id: 'htl', templateId: 'hazard-tracking-list', title: 'HTL', revision: 1, config: { projectId: 'p', workspaceType: 'functional', system: 'Mission' } };
  const entries = consolidatedHazardSources(meta, objects, 1).sort((a, b) => a.id.localeCompare(b.id));
  const tx = { objectStore: store => ({ get: async () => store === 'metadata' ? meta : store === 'revisions' ? { number: 1, objects } : null }) };
  const config = { ...meta.config, templateId: 'safety-requirements' };
  await expect(assertConsolidatedHazardInputs(tx, config, { entries })).resolves.toBeUndefined();
  await expect(assertConsolidatedHazardInputs(tx, config, { entries: entries.map((entry, index) => index ? entry : { ...entry, text: 'Replaced concern' }) })).rejects.toThrow('HTR sources changed');
});
