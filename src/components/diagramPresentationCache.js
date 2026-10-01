// Cache by immutable source object plus the small presentation state. Unchanged
// nodes/edges retain their data/style identity across selection changes.
export function createPresentationCache(decorate) {
  const cache = new WeakMap();
  return (source, key) => {
    const previous = cache.get(source);
    if (previous?.key === key) return previous.value;
    const value = decorate(source, key);
    cache.set(source, { key, value });
    return value;
  };
}

export function clearEdgeSelection(edges) {
  return edges.some(edge => edge.selected)
    ? edges.map(edge => edge.selected ? { ...edge, selected: false } : edge)
    : edges;
}

export function indexNodesByParent(nodes) {
  const index = new Map();
  nodes.forEach(node => {
    const siblings = index.get(node.parentNode) || [];
    siblings.push(node);
    index.set(node.parentNode, siblings);
  });
  return index;
}
