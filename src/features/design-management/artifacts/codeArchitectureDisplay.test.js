import { codeArchitectureDisplay } from './codeArchitectureDisplay';
import { abstractCodeArchitecture } from './codeArchitectureAbstraction';
import { architecturePages, architecturePageForElement } from './architecturePages';
import { architectureDiagram } from './architectureSources';

const path = csu => ({ subsystem: 'Control', csci: 'Application', csc: csu === 'Planner' ? 'Planning' : 'Execution', csu });
const nodes = Array.from({ length: 150 }, (_, i) => ({ id: `function-${i}`, label: `Function ${i}`, architectures: [path(i < 75 ? 'Planner' : 'Controller')] }));
const edges = Array.from({ length: 149 }, (_, i) => ({ id: `trace-${i}`, nativeId: `edge-${i}`, from: nodes[i].id, to: nodes[i + 1].id, label: 'Command' }));
const presentation = { positions: nodes.map((node, i) => [node.id, { x: i * 300, y: 100 }]), routing: {}, notes: [], comments: [] };
const diagram = level => ({ id: 'saved', workspaceType: 'code-architecture', abstraction: level, snapshot: { ...abstractCodeArchitecture({ nodes, edges }, level), codeNative: presentation } });

test('CSU uses native function identities, hierarchy and routing while bounding each view and retaining all relationships', () => {
  const saved = diagram('csu'), before = JSON.stringify(saved), pages = architecturePages(saved);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.flatMap(page => page.snapshot.edges).map(edge => edge.id).sort()).toEqual(edges.map(edge => edge.id).sort());
  const found = new Set();
  for (const page of pages) {
    expect(page.snapshot.nodes.length).toBeLessThanOrEqual(120);
    expect(page.snapshot.edges.length).toBeLessThanOrEqual(60);
    const display = codeArchitectureDisplay(page);
    expect(display.abstraction).toBe('detailed');
    expect(display.snapshot).toBe(presentation);
    for (const row of display.rows) {
      if (row.toFunction) expect(row.edgeId).toMatch(/^edge-/);
      expect(row.fromArchitecture).toEqual(nodes.find(node => node.id === row.fromNodeId).architectures[0]);
      found.add(row.fromNodeId); if (row.toNodeId) found.add(row.toNodeId);
    }
  }
  expect(found.size).toBe(nodes.length);
  for (const aggregate of saved.snapshot.nodes) {
    const page = pages[architecturePageForElement(pages, aggregate.id)];
    expect(page.snapshot.nodes.some(node => page.displayOwners[node.id] === aggregate.id)).toBe(true);
  }
  expect(JSON.stringify(saved)).toBe(before);
});

test('CSC native presentation uses compact aggregate rows with source identities and exact relationship counts', () => {
  const saved = diagram('csc');
  const display = codeArchitectureDisplay(saved);
  expect(display.abstraction).toBe('csc');
  expect(display.rows).toHaveLength(1);
  expect(display.rows[0].architectureRelationshipCount).toBe(1);
  const from = saved.snapshot.nodes.find(node => node.label === 'Planning');
  expect(display.nodeSources.get('box:csc:Control::Application::Planning')).toBe(from.id);
  expect(display.edgeSources.get('aggregate:csc:box:csc:Control::Application::Planning->box:csc:Control::Application::Execution')).toBe(saved.snapshot.edges[0].id);
  expect(display.rows[0]).not.toHaveProperty('members');
});

test('large coarse imports page original relationships at projected endpoints without losing aggregate provenance', () => {
  const saved = diagram('csc');
  const bundle = saved.snapshot.edges[0];
  bundle.relationships = Array.from({ length: 1051 }, (_, index) => ({ id: `original-${index}`, from: `implementation-${index}`, to: `other-${index}`, label: `Command ${index}` }));
  const before = JSON.stringify(saved), pages = architecturePages(saved);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every(page => page.snapshot.edges.length <= 60 && page.snapshot.nodes.length <= 120)).toBe(true);
  const originals = pages.flatMap(page => page.snapshot.edges);
  expect(originals.map(edge => edge.id)).toEqual(bundle.relationships.map(edge => edge.id));
  expect(originals.every(edge => edge.from === bundle.from && edge.to === bundle.to)).toBe(true);
  expect(pages.every(page => page.snapshot.edges.every(edge => page.displayOwners[edge.id] === bundle.id))).toBe(true);
  expect(architecturePageForElement(pages, bundle.id)).toBe(0);
  expect(architecturePageForElement(pages, 'original-1050')).toBe(pages.length - 1);
  expect(JSON.stringify(saved)).toBe(before);
});

test('duplicate code relationships remain deduplicated despite different native row offsets', () => {
  const row = { traceId: 'call', fromFunction: 'A', toFunction: 'B' };
  const result = architectureDiagram({ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo', abstraction: 'functional' }, [row, row]);
  expect(result[0].snapshot.edges).toHaveLength(1);
});

test('saved manual routes keep the native edge identity while citations keep the stable trace identity', () => {
  const row = { traceId: 'stable-call', fromFunction: 'A', toFunction: 'B' };
  const nativeId = 'e:n:A->n:B-0';
  const codeNative = { routing: { overrides: { [nativeId]: 'rectangular' } }, positions: [], notes: [], comments: [] };
  const saved = architectureDiagram({ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo', abstraction: 'functional' }, [row], { codeNative })[0];
  const display = codeArchitectureDisplay(saved);
  expect(display.rows[0].edgeId).toBe(nativeId);
  expect(display.edgeSources.get(nativeId)).toBe('stable-call');
  expect(display.snapshot.routing.overrides[nativeId]).toBe('rectangular');
});

test('functional hierarchy evidence accompanies its children in every view and containers link to their own source', () => {
  const rows = edges.map(edge => ({ traceId: edge.id, fromNodeId: edge.from, toNodeId: edge.to,
    fromFunction: edge.from, toFunction: edge.to, fromArchitecture: nodes.find(node => node.id === edge.from).architectures[0], toArchitecture: nodes.find(node => node.id === edge.to).architectures[0] }));
  const saved = architectureDiagram({ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo', abstraction: 'functional' }, rows)[0];
  const pages = architecturePages(saved);
  const seen = new Set();
  for (const page of pages) {
    expect(page.snapshot.nodes.length).toBeLessThanOrEqual(120);
    expect(page.snapshot.nodes.some(node => !node.group)).toBe(true);
    const display = codeArchitectureDisplay(page);
    for (const group of page.snapshot.nodes.filter(node => node.group)) {
      seen.add(group.id);
      expect([...display.nodeSources].some(([id, source]) => id.startsWith(`box:${group.groupType}:`) && source === group.id)).toBe(true);
    }
  }
  expect(seen).toEqual(new Set(saved.snapshot.nodes.filter(node => node.group).map(node => node.id)));
});
