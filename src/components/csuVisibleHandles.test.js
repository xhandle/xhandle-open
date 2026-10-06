import { withCsuVisibleHandles } from './csuVisibleHandles';
const nodes = [{ id: 'a', type: 'bidirectional', data: { label: 'A' } }, { id: 'b', type: 'bidirectional' }, { id: 'box', type: 'groupBox' }];
test('preserves all connected endpoints, deduplicates ports and leaves input untouched', () => {
  const edges = [{ source: 'a', sourceHandle: 'right-source-2', target: 'b', targetHandle: 'left-target-1' }, { source: 'a', sourceHandle: 'right-source-2', target: 'a', targetHandle: 'top-target-0' }];
  const result = withCsuVisibleHandles(nodes, edges, true);
  expect(result[0].data.idleHandleIds).toEqual(['right-source-2', 'top-target-0']);
  expect(result[1].data.idleHandleIds).toEqual(['left-target-1']);
  expect(result[2]).toBe(nodes[2]);
  expect(nodes[0].data).toEqual({ label: 'A' });
});
test('keeps defaults for unspecified handles and leaves small diagrams unchanged', () => {
  expect(withCsuVisibleHandles(nodes, [], false)).toBe(nodes);
  const result = withCsuVisibleHandles(nodes, [{ source: 'a', target: 'b' }], true);
  expect(result[0]).toBe(nodes[0]);
  expect(result[1]).toBe(nodes[1]);
  expect(withCsuVisibleHandles(nodes, [], true)[0].data.idleHandleIds).toEqual([]);
});
