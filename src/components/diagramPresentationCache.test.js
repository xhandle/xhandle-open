import { createPresentationCache, clearEdgeSelection, indexNodesByParent } from './diagramPresentationCache';

test('selection changes retain all unaffected node and edge presentation identities', () => {
  const nodes = [{ id: 'a', parentNode: 'system' }, { id: 'b', parentNode: 'subsystem' }];
  const present = createPresentationCache((node, selected) => ({ ...node, data: { selected } }));
  const before = nodes.map(node => present(node, false));
  const after = nodes.map(node => present(node, node.id === 'a'));
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(present({ ...nodes[1] }, false)).not.toBe(before[1]);
  const edges = [{ id: 'ab' }, { id: 'bc', selected: true }];
  const cleared = clearEdgeSelection(edges);
  expect(cleared[0]).toBe(edges[0]);
  expect(cleared[1].selected).toBe(false);
  expect(clearEdgeSelection(cleared)).toBe(cleared);
  expect(indexNodesByParent(nodes).get('subsystem')).toEqual([nodes[1]]);
});
