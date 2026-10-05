import { orderCsuFunctions } from './csuFunctionOrdering';

const grid = { columns: 4, stepX: 456, stepY: 258 };
const nodes = Array.from({ length: 16 }, (_, i) => ({ id: `f${i}` }));
const cost = (ordered, edges) => {
  const slots = new Map(ordered.map((node, i) => [node.id, i]));
  return edges.reduce((sum, { source, target }) => {
    const a = slots.get(source), b = slots.get(target);
    if (a == null || b == null) return sum;
    return sum + Math.abs(a % grid.columns - b % grid.columns) * grid.stepX
      + Math.abs(Math.floor(a / grid.columns) - Math.floor(b / grid.columns)) * grid.stepY;
  }, 0);
};

test('shortens local calls without changing membership or the fixed grid footprint', () => {
  const edges = [{ source: 'f0', target: 'f15' }, { source: 'f1', target: 'f14' }, { source: 'f0', target: 'f14' }];
  const original = [...nodes];
  const result = orderCsuFunctions(nodes, edges, grid);
  expect(cost(result, edges)).toBeLessThan(cost(nodes, edges));
  expect(new Set(result)).toEqual(new Set(nodes));
  expect(nodes).toEqual(original);
  expect(result.length).toBe(nodes.length);
  expect(orderCsuFunctions(nodes, [...edges].reverse(), grid)).toEqual(result);
});

test('preserves isolated nodes and ignores external and self connections', () => {
  expect(orderCsuFunctions(nodes, [], grid)).toBe(nodes);
  expect(orderCsuFunctions(nodes, [{ source: 'external', target: 'f0' }, { source: 'f1', target: 'f1' }], grid)).toBe(nodes);
});

test('never increases local call distance for cycles and parallel calls', () => {
  const edges = nodes.flatMap((node, i) => [
    { source: node.id, target: nodes[(i + 7) % nodes.length].id },
    { source: node.id, target: nodes[(i + 7) % nodes.length].id },
    { source: node.id, target: nodes[(i + 3) % nodes.length].id },
  ]);
  const result = orderCsuFunctions(nodes, edges, grid);
  expect(cost(result, edges)).toBeLessThanOrEqual(cost(nodes, edges));
  expect(new Set(result)).toEqual(new Set(nodes));
});
