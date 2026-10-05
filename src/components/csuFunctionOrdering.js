// Reorder functions within the existing grid, without changing its dimensions
// or container membership. Only accept placements that shorten local calls.
export function orderCsuFunctions(nodes, edges, { columns, stepX, stepY }) {
  if (nodes.length < 3 || !edges?.length) return nodes;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const weights = nodes.map(() => new Map());
  for (const edge of edges) {
    const a = index.get(edge.source), b = index.get(edge.target);
    if (a == null || b == null || a === b) continue;
    weights[a].set(b, (weights[a].get(b) || 0) + 1);
    weights[b].set(a, (weights[b].get(a) || 0) + 1);
  }
  if (!weights.some(neighbors => neighbors.size)) return nodes;
  const distance = (a, b) => Math.abs(a % columns - b % columns) * stepX
    + Math.abs(Math.floor(a / columns) - Math.floor(b / columns)) * stepY;
  const order = nodes.map((_, i) => i);
  const slot = [...order];
  // Bound work for very large CSUs. Evaluate only costs incident to the two
  // swapped nodes, rather than rescoring all edges for every candidate.
  const windowSize = Math.min(nodes.length, 48);
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let a = 0; a < order.length; a++) {
      for (let b = a + 1; b < Math.min(order.length, a + windowSize); b++) {
        const left = order[a], right = order[b];
        let delta = 0;
        weights[left].forEach((weight, neighbor) => {
          if (neighbor !== right) delta += weight * (distance(b, slot[neighbor]) - distance(a, slot[neighbor]));
        });
        weights[right].forEach((weight, neighbor) => {
          if (neighbor !== left) delta += weight * (distance(a, slot[neighbor]) - distance(b, slot[neighbor]));
        });
        if (delta >= 0) continue;
        [order[a], order[b]] = [right, left];
        slot[left] = b;
        slot[right] = a;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return order.map(i => nodes[i]);
}
