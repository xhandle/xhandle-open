import { briefGroups, briefSources, mapBriefSources, resolveBriefCitations, deduplicateFacts } from './generationBrief';
import { citationContext } from './artifactCitations';
import { reviewCitationMap } from './hazardEvidenceParts';
import { semanticHash } from './artifactModel';

test('multiple evidence review rounds retain exact original citations and unresolved status', () => {
  const facts = [
    { kind: 'requirement', title: 'Timing', text: 'Deadline: 20 ms.', sourceIds: ['original-node', 'original-edge'] },
    { kind: 'gap', title: 'Load', text: 'Maximum load is unspecified.', sourceIds: ['original-node'] },
  ];
  const first = briefSources(facts), firstMap = mapBriefSources(first, facts);
  const provider = { objects: [
    { ...facts[0], sourceIds: ['S1'] }, { ...facts[1], kind: 'requirement', sourceIds: ['S2'] },
  ] };
  const reviewed = resolveBriefCitations(citationContext(first).resolve(provider), firstMap);
  expect(reviewed.objects).toEqual(facts);
  const second = briefSources(reviewed.objects), secondMap = mapBriefSources(second, reviewed.objects);
  const draft = resolveBriefCitations(citationContext(second).resolve(provider), secondMap);
  expect(draft.objects).toEqual(facts);
  expect(JSON.stringify(draft)).not.toContain('brief:');
  expect(provider.objects[1].kind).toBe('requirement');
});

test('only exact duplicate claims with the same evidence are consolidated', () => {
  const fact = { kind: 'requirement', title: 'Timing', text: 'Deadline: 20 ms.', sourceIds: ['node', 'edge'] };
  const distinct = [{ ...fact, text: 'Deadline: 30 ms.' }, { ...fact, sourceIds: ['other-node'] }, { ...fact, evidenceIssue: 'unresolved-upstream' }];
  expect(deduplicateFacts([fact, { ...fact, sourceIds: ['edge', 'node'] }, ...distinct])).toEqual([fact, ...distinct]);
});

test('unknown and malformed citations remain invalid instead of being guessed or removed', () => {
  const sources = briefSources([{ kind: 'narrative', title: 'Known', text: 'Known.', sourceIds: ['original'] }]);
  const map = mapBriefSources(sources, [{ sourceIds: ['original'] }]);
  const response = { objects: [{ sourceIds: ['invented'] }, { sourceIds: 'bad' }] };
  expect(resolveBriefCitations(response, map)).toEqual(response);
});

test('oversized consolidated HTRs are reviewed in bounded lossless pieces with original citations', () => {
  const source = { id: 'htr:source:HTR-1', sourceType: 'hazard-tracking-record', recordId: 'HTR-1', title: 'HTR-1 — Invalid control output', text: 'Prevent invalid control commands from causing unintended motion.', attributes: {
    HTR: 'HTR-1', 'Safety Constraint': Array.from({ length: 1200 }, (_, index) => `Constraint ${index}: preserve commands with the exact recorded acceptance criteria. "Quoted" details \\ paths and emoji 🛑 must survive.\n${'Condition '.repeat(25)}`), Verification: ['Fault injection'],
  } };
  const manifest = { entries: [source] }, original = semanticHash(manifest);
  const groups = briefGroups(manifest), pieces = groups.flat();
  expect(groups.length).toBeGreaterThan(1);
  expect(pieces.every(part => part.reviewSourceId === source.id)).toBe(true);
  expect(new Set(pieces.map(part => part.id)).size).toBe(pieces.length);
  for (const group of groups) {
    const context = citationContext({ entries: group });
    expect(JSON.stringify(context.sources).length).toBeLessThanOrEqual(90000);
    const resolved = resolveBriefCitations(context.resolve({ objects: [{ sourceIds: context.sources.map(source => source.id) }] }), reviewCitationMap(group));
    expect(resolved.objects[0].sourceIds).toEqual([source.id]);
  }
  const { id, ...projection } = citationContext(manifest).sources[0];
  expect(JSON.parse(pieces.map(part => part.content.fragment).join(''))).toEqual(projection);
  expect(semanticHash(manifest)).toBe(original);
  const facts = [{ kind: 'requirement', title: 'Reject invalid commands', text: 'Reject commands outside the recorded acceptance criteria.', sourceIds: [source.id] }];
  const brief = briefSources(facts);
  expect(resolveBriefCitations(citationContext(brief).resolve({ objects: [{ sourceIds: ['S1'] }] }), mapBriefSources(brief, facts)).objects[0].sourceIds).toEqual([source.id]);
});

test('evidence pieces cannot collide with existing source identities or guess unknown citations', () => {
  const source = { id: 'original', sourceType: 'hazard-tracking-record', title: 'HTR-1', text: 'Concern', attributes: { 'Safety Constraint': 'Long value 🛑 '.repeat(15000) } };
  const existing = { id: 'htr-review-part:original:1', title: 'Another saved source', text: 'Known.' };
  const groups = briefGroups({ entries: [source, existing] }), pieces = groups.flat().filter(entry => entry.reviewSourceId);
  expect(pieces.some(entry => entry.id === existing.id)).toBe(false);
  const map = reviewCitationMap(pieces);
  expect(resolveBriefCitations({ objects: [{ sourceIds: ['unknown-piece'] }] }, map).objects[0].sourceIds).toEqual(['unknown-piece']);
});
