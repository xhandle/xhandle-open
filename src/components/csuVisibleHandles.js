// Keep every connected port mounted. Unused ports are mounted on interaction
// instead of subscribing thousands of idle Handles to the viewport store.
export function withCsuVisibleHandles(nodes, edges, enabled) {
  if (!enabled) return nodes;
  const handles = new Map();
  for (const edge of edges) {
    for (const [node, handle] of [[edge.source, edge.sourceHandle], [edge.target, edge.targetHandle]]) {
      if (!handles.has(node)) handles.set(node, new Set());
      // Unspecified ports need the normal defaults; don't prune this node.
      handles.get(node).add(handle || '*');
    }
  }
  return nodes.map(node => node.type !== 'bidirectional' || handles.get(node.id)?.has('*') ? node : {
    ...node, data: { ...node.data, idleHandleIds: [...(handles.get(node.id) || [])].sort() },
  });
}
