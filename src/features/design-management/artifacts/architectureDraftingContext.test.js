import { architectureDraftingGuidance } from './architectureDraftingContext';
import { citationContext } from './artifactCitations';
import { briefGroups, needsBrief } from './generationBrief';
import { sourceBatchPlan } from './generationSourceBatches';
import { requestSection } from './artifactGeneration';
import { architectureDiagram } from './architectureSources';
jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: { 'x-ai-model': 'fixture' } }) }));

function source(level, count) {
  return { id: `component:${level}`, sourceType: 'architecture-element', workspaceType: 'code-architecture', abstraction: level, title: 'Localization', text: 'Estimates vehicle position.',
    element: { label: 'Localization', details: 'Position output deadline: 20 ms.',
      members: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, label: `implementationFunction${i}`, details: 'Implementation description. '.repeat(50), files: [`file-${i}.cpp`] })),
      internalRelationships: Array.from({ length: count }, (_, i) => ({ id: `call${i}`, row: { fromFunction: `implementationFunction${i}`, toFunction: 'internalHelper' }, label: 'Calls', details: 'Internal computation. '.repeat(50) })),
      files: Array.from({ length: count }, (_, i) => `file-${i}.cpp`),
    },
  };
}

test.each(['subsystem', 'csci', 'csc'])('%s context does not grow with its underlying implementation and preserves selected-level constraints', level => {
  const entry = source(level, 10000), manifest = { entries: [entry] };
  const context = citationContext(manifest), serialized = JSON.stringify(context.sources);
  expect(serialized.length).toBeLessThan(2000);
  expect(serialized).toContain('Position output deadline: 20 ms.');
  expect(serialized).not.toContain('implementationFunction');
  expect(serialized).not.toContain('file-9999');
  expect(context.sources[0].element.implementationElementCount).toBe(10000);
  expect(context.resolve({ objects: [{ sourceIds: ['S1'] }] }).objects[0].sourceIds).toEqual([entry.id]);
  expect(entry.element.members).toHaveLength(10000);
  expect(entry.element.internalRelationships).toHaveLength(10000);
  expect(needsBrief(manifest)).toBe(false);
  expect(sourceBatchPlan(manifest)).toBeNull();
});

test.each(['csu', 'functional'])('%s supplies more detailed but bounded examples with explicit remaining counts', level => {
  const entry = source(level, 10000), manifest = { entries: [entry] };
  const context = citationContext(manifest);
  expect(context.sources[0].element.memberExamples).toHaveLength(20);
  expect(context.sources[0].element.relationshipExamples).toHaveLength(20);
  expect(context.sources[0].element.additionalMemberCount).toBe(9980);
  expect(context.sources[0].element.additionalRelationshipCount).toBe(9980);
  expect(JSON.stringify(context.sources).length).toBeLessThan(90000);
  expect(briefGroups(manifest)).toHaveLength(1);
});

test('functional exchange context excludes repeated raw provenance while preserving the actual exchange and its classification', () => {
  const entry = { id: 'exchange', sourceType: 'architecture-element', workspaceType: 'code-architecture', abstraction: 'functional', element: { row: {
    fromFunction: 'Localize', toFunction: 'Plan', controlAction: 'Pose', controlDetails: 'Publish pose every 20 ms.', interfaceType: 'DDS topic', interfaceContract: { units: 'metres', deadlineMs: 20 },
    codeEvidence: { functions: Array(10000).fill('rawFunction') }, sourceEvidence: { files: Array(10000).fill('raw.cpp') },
    functionalModel: { kind: 'data', significance: 'material', sourceTraceIds: Array(10000).fill('raw-trace') },
  } } };
  const text = JSON.stringify(citationContext({ entries: [entry] }).sources);
  expect(text.length).toBeLessThan(2000);
  expect(text).toContain('Publish pose every 20 ms.'); expect(text).toContain('material'); expect(text).toContain('DDS topic'); expect(text).toContain('deadlineMs');
  expect(text).not.toContain('rawFunction'); expect(text).not.toContain('raw-trace');
});

test('upstream document citations keep the same abstraction boundary for nested architecture evidence', () => {
  const entry = source('csc', 10000);
  const context = citationContext({ entries: [{ id: 'upstream-object', title: 'Supported requirement', text: 'Output within 20 ms.', sourceType: 'artifact-object', architectureEvidence: [entry] }] });
  expect(JSON.stringify(context.sources).length).toBeLessThan(2500);
  expect(context.resolve({ objects: [{ sourceIds: ['S1'] }] }).objects[0].sourceIds).toEqual(['upstream-object']);
});

test('provider requests use the selected abstraction and a shorter high-level writing target', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'scope', kind: 'narrative', title: 'Scope', text: 'Estimates position.', sourceIds: ['S1'] }] }) } }] }) }));
  const config = { system: 'AV', architectureSources: [{ workspaceType: 'code-architecture', abstraction: 'csc' }] };
  await requestSection({ meta: { title: 'Design', templateId: 'system-design', config }, section: { id: 's1', title: 'Context' }, sources: { entries: [source('csc', 1000)] } });
  const body = JSON.parse(fetch.mock.calls[0][1].body), prompt = JSON.parse(body.messages[1].content);
  expect(body.max_tokens).toBe(6000);
  expect(prompt.architectureScope.levels).toEqual(['CSC']);
  expect(prompt.architectureScope.itemTarget).toBe(8);
  expect(body.messages[0].content).toContain('1–8 objects');
  expect(architectureDraftingGuidance({ architectureSources: [...config.architectureSources, { workspaceType: 'code-architecture', abstraction: 'functional' }] }).itemTarget).toBe(12);
});

test('the same repository requires far less evidence review at CSC level than Functional', () => {
  const allocation = index => ({ system: 'AV', subsystem: 'Localization', csci: 'Localizer', csc: `Component ${index % 4}`, csu: `Unit ${index}` });
  const rows = Array.from({ length: 600 }, (_, i) => ({ id: `call-${i}`, fromFunction: `Responsibility ${i}`, toFunction: `Responsibility ${(i + 1) % 600}`, fromArchitecture: allocation(i), toArchitecture: allocation((i + 1) % 600), controlAction: 'Exchange state', controlDetails: 'The saved functional exchange transfers state to the next responsibility.' }));
  const descriptor = { workspaceType: 'code-architecture', projectId: 'p', repoId: 'r', label: 'Repository' };
  const coarse = { entries: architectureDiagram({ ...descriptor, abstraction: 'csc' }, rows) };
  const detailed = { entries: architectureDiagram({ ...descriptor, abstraction: 'functional' }, rows) };
  expect(needsBrief(coarse)).toBe(false);
  expect(briefGroups(coarse)).toHaveLength(1);
  expect(briefGroups(detailed).length).toBeGreaterThan(5);
  expect(JSON.stringify(citationContext(coarse).sources).length).toBeLessThan(JSON.stringify(citationContext(detailed).sources).length / 10);
  expect(coarse.entries[0].snapshot.edges.flatMap(edge => edge.relationships)).toHaveLength(600);
});
