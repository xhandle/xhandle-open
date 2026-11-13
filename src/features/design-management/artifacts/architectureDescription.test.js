import { architectureDescription, architectureEditableSections } from './architectureDescription';
import { artifactMarkdown } from './artifactExport';

const meta = { id: 'architecture', title: 'Vehicle architecture', templateId: 'architecture', config: { system: 'Vehicle', architectureKind: 'code-based' } };
const diagram = { id: 'diagram', title: 'Vehicle implementation', sourceType: 'architecture-diagram', workspaceType: 'code-architecture', abstraction: 'csc', snapshot: {
  nodes: [{ id: 'a', label: 'Controller', details: 'Coordinates vehicle commands.', displayArchitecture: { subsystem: 'Control' } }, { id: 'b', label: 'Actuator', displayArchitecture: { subsystem: 'Control' } }],
  edges: [{ id: 'e', from: 'a', to: 'b', label: 'Command', details: 'Requests actuator motion.' }],
} };
const manifest = { entries: [diagram, ...diagram.snapshot.nodes.map(node => ({ id: `source:${node.id}`, sourceType: 'architecture-element', diagramId: diagram.id, elementId: node.id, title: node.label })), { id: 'source:e', sourceType: 'architecture-element', diagramId: diagram.id, elementId: 'e', title: 'Command' }] };

test('architecture prose describes saved scope, structure and interactions with exact element references', () => {
  const sections = architectureDescription(meta, manifest);
  const text = sections.flatMap(section => section.paragraphs.map(p => p.text)).join('\n');
  expect(text).toContain('at CSC');
  expect(text).toContain('Control contains 2 elements');
  expect(text).toContain('Coordinates vehicle commands.');
  expect(text).toContain('from Controller to Actuator, labeled “Command”');
  expect(sections.flatMap(section => section.paragraphs.flatMap(p => p.references))).toContainEqual({ sourceId: 'source:e', diagramId: 'diagram', elementId: 'e', title: 'Command' });
});

test('large decompositions stay bounded and never traverse lower-level members', () => {
  const nodes = Array.from({ length: 10000 }, (_, i) => ({ id: `n${i}`, label: `Component ${i}`, displayArchitecture: { subsystem: `Subsystem ${i % 10}` }, get members() { throw new Error('Lower-level decomposition must not be expanded'); } }));
  const edges = Array.from({ length: 20000 }, (_, i) => ({ id: `e${i}`, from: 'n0', to: 'n1', label: `Connection ${i}`, get relationships() { throw new Error('Underlying relationships must not be expanded'); } }));
  const sections = architectureDescription(meta, { entries: [{ ...diagram, snapshot: { nodes, edges } }] });
  const text = sections.flatMap(section => section.paragraphs.map(p => p.text)).join('\n');
  expect(text.length).toBeLessThan(10000);
  expect(text).toContain('10000 elements');
  expect(text).toContain('2 additional groupings');
  expect(text).toContain('remaining 19992 relationships');
});

test('existing snapshots produce prose in exports without regenerating or replacing saved objects', () => {
  const revision = { number: 1, sources: manifest, objects: [{ id: 'manual', title: 'Design decision', kind: 'decision', manual: true, text: 'Retain the command interface.', sourceIds: ['source:e'] }] };
  const before = JSON.stringify(revision);
  const markdown = artifactMarkdown(meta, revision, { diagram: 'data:image/png;base64,fixture' });
  expect(markdown).toContain('## Purpose and scope');
  expect(markdown).toContain('## Interfaces and interactions');
  expect(markdown).toContain('Retain the command interface.');
  expect(markdown).toContain('Sources: Command');
  expect(JSON.stringify(revision)).toBe(before);
});


test('edited architecture prose is exported once without changing the source snapshot', () => {
  const section = architectureEditableSections(meta, manifest)[0];
  const objects = [{ ...section.object, title: 'Reviewed scope', manual: true }, { ...section.paragraphs[0].object, text: 'Curated architecture description.', manual: true }];
  const before = JSON.stringify(manifest);
  const markdown = artifactMarkdown(meta, { number: 1, sources: manifest, objects });
  expect(markdown).toContain('## Reviewed scope');
  expect(markdown.split('Curated architecture description.')).toHaveLength(2);
  expect(markdown).not.toContain(section.paragraphs[0].text);
  expect(JSON.stringify(manifest)).toBe(before);
});
