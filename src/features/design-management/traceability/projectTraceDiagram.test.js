import { indexProjectTrace, projectTraceLayers, filterProjectTraceLayers, overviewTraceDiagram, objectTraceDiagram, layoutTraceDiagram, TRACE_NODE_LIMIT, TRACE_EDGE_LIMIT, TRACE_OBJECT_PAGE_SIZE } from './projectTraceDiagram';

const nodes = [{ id: 'p', type: 'systems-engineering-project', title: 'Vehicle' }, { id: 'a', type: 'artifact', title: 'Safety' }, { id: 'b', type: 'artifact', title: 'Software' },
  { id: 'a1', type: 'requirement', artifactId: 'a', title: '', description: 'The controller shall reject invalid commands.' },
  { id: 'b1', type: 'requirement', artifactId: 'b', title: '' }, { id: 'b2', type: 'requirement', artifactId: 'b', title: '' }];
const graph = { nodes, links: [{ id: 'contains', from: 'p', to: 'a', type: 'contains' }, { id: 'own-a1', from: 'a', to: 'a1', type: 'contains' },
  { id: 'dependency', from: 'b', to: 'a', type: 'uses-drafting-input' }, { id: 'citation1', from: 'b1', to: 'a1', type: 'refines' }, { id: 'citation2', from: 'b2', to: 'a1', type: 'refines' }], gaps: [{ artifactId: 'b', objectId: 'b1' }] };

test('overview aggregates recorded object links without inventing reverse or transitive relationships', () => {
  const model = overviewTraceDiagram(indexProjectTrace(graph));
  expect(model.nodes.map(node => node.id)).toEqual(['p', 'a', 'b']);
  expect(model.edges.find(edge => edge.type === 'refines')).toMatchObject({ from: 'b', to: 'a', members: ['citation1', 'citation2'] });
  expect(model.edges.find(edge => edge.type === 'uses-drafting-input')).toMatchObject({ from: 'b', to: 'a', members: ['dependency'] });
  expect(model.edges).toHaveLength(3);
  expect(model.edges.some(edge => edge.from === 'a' && edge.to === 'b')).toBe(false);
  expect(model.nodes.find(node => node.id === 'b').gapCount).toBe(1);
});

test('saved source revisions remain separate from the current artifact, and unavailable references remain visible', () => {
  const index = indexProjectTrace({ ...graph, nodes: [...nodes, { id: 'old1', type: 'source-snapshot', historical: true, artifactId: 'a', revision: 1, moduleTitle: 'Safety' }, { id: 'old2', type: 'source-snapshot', historical: true, artifactId: 'a', revision: 1, moduleTitle: 'Safety' }],
    links: [...graph.links, { id: 'old-ref1', from: 'b1', to: 'old1', type: 'refines' }, { id: 'old-ref2', from: 'b2', to: 'old2', type: 'refines' }, { id: 'missing', from: 'b1', to: 'unavailable-id', type: 'refines' }] });
  const model = overviewTraceDiagram(index), historical = model.nodes.find(node => node.historical);
  expect(historical).toMatchObject({ revision: 1, members: ['old1', 'old2'] });
  expect(model.edges.find(edge => edge.to === historical.id)).toMatchObject({ from: 'b', members: ['old-ref1', 'old-ref2'] });
  expect(model.nodes.find(node => node.id === 'unavailable-id').type).toBe('unavailable');
});

test('object view retains exact source/object identities, incoming directions and searchable requirement text', () => {
  const index = indexProjectTrace(graph), model = objectTraceDiagram(index, 'a', 'reject invalid');
  expect(model.objectCount).toBe(1);
  expect(model.nodes.find(node => node.id === 'a1').description).toContain('shall reject');
  expect(model.edges.find(edge => edge.id === 'citation1')).toMatchObject({ from: 'b1', to: 'a1' });
  expect(model.nodes.some(node => node.id === 'b1')).toBe(true);
  expect(objectTraceDiagram(index, 'a', 'unmatched').objectCount).toBe(0);
});

test('large projects keep all records indexed while paging objects and bounding layout work', () => {
  const objects = Array.from({ length: 26278 }, (_, i) => ({ id: `r${i}`, type: 'requirement', artifactId: 'a', title: `Requirement ${i}` }));
  const index = indexProjectTrace({ nodes: [...nodes.slice(0, 3), ...objects], links: objects.map(node => ({ id: `link-${node.id}`, from: node.id, to: 'b', type: 'refines' })) });
  const overview = overviewTraceDiagram(index);
  expect(overview.nodes).toHaveLength(3); expect(overview.edges[0].members).toHaveLength(26278);
  const first = objectTraceDiagram(index, 'a'), last = objectTraceDiagram(index, 'a', '', 99999);
  expect(first.objectCount).toBe(26278); expect(first.nodes.length).toBeLessThanOrEqual(TRACE_OBJECT_PAGE_SIZE + 2);
  expect(last.page).toBe(last.pageCount - 1); expect(last.nodes.some(node => node.id === 'r26277')).toBe(true);
  const fanout = indexProjectTrace({ nodes: [{ id: 'a', type: 'artifact' }, { id: 'root', type: 'requirement', artifactId: 'a' }, ...objects.map(node => ({ ...node, artifactId: 'b' }))], links: objects.map(node => ({ from: 'root', to: node.id, type: 'refines' })) });
  const bounded = objectTraceDiagram(fanout, 'a');
  expect(bounded.nodes.length).toBeLessThanOrEqual(TRACE_NODE_LIMIT); expect(bounded.edges.length).toBeLessThanOrEqual(TRACE_EDGE_LIMIT); expect(bounded.truncated).toBe(true);
  expect(fanout.nodes.size).toBe(26280);
});

test('cyclic recorded relationships produce finite positions and preserve both arrow directions', async () => {
  const model = overviewTraceDiagram(indexProjectTrace({ nodes: nodes.slice(0, 3), links: [{ from: 'a', to: 'b', type: 'refines' }, { from: 'b', to: 'a', type: 'uses-drafting-input' }] }));
  const { positions, routes } = await layoutTraceDiagram(model);
  for (const position of positions.values()) { expect(Number.isFinite(position.x)).toBe(true); expect(Number.isFinite(position.y)).toBe(true); }
  expect(routes.size).toBe(2);
  expect(model.edges).toHaveLength(2);
});

test('relationship layers filter links in both levels while preserving documents and saved traceability', () => {
  const index = indexProjectTrace(graph), layers = projectTraceLayers(index);
  expect(layers.map(layer => layer.id)).toEqual(['contains', 'uses-drafting-input', 'refines']);
  const filtered = filterProjectTraceLayers(index, ['refines']);
  expect(filtered.nodes).toBe(index.nodes); expect(filtered.objects).toBe(index.objects); expect(filtered.gaps).toBe(index.gaps);
  expect([...filtered.links.keys()]).toEqual(['citation1', 'citation2']);
  const overview = overviewTraceDiagram(filtered);
  expect(overview.nodes.map(node => node.id)).toEqual(['p', 'a', 'b']);
  expect(overview.edges).toHaveLength(1);
  expect(overview.edges[0]).toMatchObject({ type: 'refines', from: 'b', to: 'a', members: ['citation1', 'citation2'] });
  const objects = objectTraceDiagram(filtered, 'a');
  expect(objects.nodes.map(node => node.id)).toEqual(['a', 'a1', 'b1', 'b2']);
  expect(objects.edges.map(edge => edge.id)).toEqual(['citation1', 'citation2']);
  expect(index.nodes.size).toBe(6); expect(index.links.size).toBe(5);
  expect(overviewTraceDiagram(filterProjectTraceLayers(index, layers.map(layer => layer.id)))).toEqual(overviewTraceDiagram(index));
});

test('relationship filtering precedes object expansion and display limits, and deselecting all retains context', () => {
  const others = Array.from({ length: TRACE_EDGE_LIMIT + 5 }, (_, i) => ({ id: `r${i}`, type: 'requirement', artifactId: 'b' }));
  const index = indexProjectTrace({ nodes: [
    { id: 'a', type: 'artifact' }, { id: 'b', type: 'artifact' }, { id: 'root', type: 'requirement', artifactId: 'a' },
    ...others, { id: 'old', type: 'source-snapshot', historical: true, artifactId: 'b', revision: 1 },
  ], links: [...others.map(node => ({ id: `link-${node.id}`, from: 'root', to: node.id, type: 'contains' })),
    { id: 'cite', from: 'root', to: 'old', type: 'refines' }] });
  const model = objectTraceDiagram(filterProjectTraceLayers(index, ['refines']), 'a');
  expect(model.nodes.map(node => node.id)).toEqual(['a', 'root', 'old']);
  expect(model.edges[0].members).toEqual(['cite']); expect(model.truncated).toBe(false);
  const empty = overviewTraceDiagram(filterProjectTraceLayers(index, []));
  expect(empty.nodes).toHaveLength(3); expect(empty.edges).toHaveLength(0);
  expect(objectTraceDiagram(filterProjectTraceLayers(index, []), 'a').nodes.map(node => node.id)).toEqual(['a', 'root']);
  expect(projectTraceLayers(indexProjectTrace({ nodes: [], links: [] }))).toEqual([]);
});
