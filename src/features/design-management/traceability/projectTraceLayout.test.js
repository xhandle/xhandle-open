import { layoutTraceDiagram, TRACE_ITEM_WIDTH, TRACE_ITEM_HEIGHT, TRACE_ICON_LEFT, TRACE_ICON_RIGHT, TRACE_ICON_Y, traceRoutePath } from './projectTraceLayout';

const rect = position => ({ ...position, width: TRACE_ITEM_WIDTH, height: TRACE_ITEM_HEIGHT });
const overlaps = (a, b) => a.x < b.x + b.width - .01 && b.x < a.x + a.width - .01 && a.y < b.y + b.height - .01 && b.y < a.y + a.height - .01;
// Recursive convex-hull subdivision checks the entire cubic, including the
// interior of the bend rather than only its endpoints or control points.
function curveHitsRect(curve, rectangle, depth = 0) {
  const xs = curve.map(p => p.x), ys = curve.map(p => p.y);
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  if (!overlaps({ ...bounds, width: bounds.width + .01, height: bounds.height + .01 }, rectangle)) return false;
  if (depth === 18 || Math.max(bounds.width, bounds.height) < .05) return true;
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const [a, b, c, d] = curve, ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd);
  return curveHitsRect([a, ab, abc, center], rectangle, depth + 1) || curveHitsRect([center, bcd, cd, d], rectangle, depth + 1);
}
function expectClearLayout(model, layout) {
  const nodes = [...layout.positions].map(([id, position]) => ({ id, ...rect(position) }));
  for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) expect({ a: a.id, b: b.id, overlaps: overlaps(a, b) }).toMatchObject({ overlaps: false });
  for (const edge of model.edges) {
    const route = layout.routes.get(edge.id);
    for (const point of route.points) {
      expect(point.x).toBeGreaterThanOrEqual(layout.bounds.x); expect(point.x).toBeLessThanOrEqual(layout.bounds.x + layout.bounds.width);
      expect(point.y).toBeGreaterThanOrEqual(layout.bounds.y); expect(point.y).toBeLessThanOrEqual(layout.bounds.y + layout.bounds.height);
    }
    expect(route.points[0]).toEqual({ x: layout.positions.get(edge.from).x + TRACE_ICON_RIGHT, y: layout.positions.get(edge.from).y + TRACE_ICON_Y });
    expect(route.points.at(-1)).toEqual({ x: layout.positions.get(edge.to).x + TRACE_ICON_LEFT, y: layout.positions.get(edge.to).y + TRACE_ICON_Y });
    const obstacles = nodes.flatMap(node => [
      { id: node.id, kind: 'icon', x: node.x + 72, y: node.y + 6, width: 52, height: 52 },
      { id: node.id, kind: 'title', x: node.x + 4, y: node.y + 64, width: 188, height: 34 },
      { id: node.id, kind: 'type and badge', x: node.x + 4, y: node.y + 101, width: 188, height: 33 },
    ]);
    const collisions = [];
    for (let i = 1; i < route.points.length; i += 3) {
      const curve = route.points.slice(i - 1, i + 3);
      for (const obstacle of obstacles) if (curveHitsRect(curve, obstacle)) collisions.push({ edge: edge.id, node: obstacle.id, kind: obstacle.kind });
    }
    expect(collisions).toEqual([]);
    expect(traceRoutePath(route.points)).not.toContain('L ');
    const label = { x: route.label.x - route.label.width / 2, y: route.label.y - route.label.height / 2, width: route.label.width, height: route.label.height };
    for (const node of nodes) expect({ edge: edge.id, node: node.id, labelObstructed: overlaps(label, node) }).toMatchObject({ labelObstructed: false });
    expect(traceRoutePath(route.points)).not.toMatch(/NaN|undefined|Infinity/);
  }
}

test('routes project cross-links, parallel relationships, cycles and self-loops outside icons and their labels', async () => {
  const model = { nodes: ['project', 'system', 'operations', 'functional', 'code', 'sourceA', 'sourceB', 'isolated'].map(id => ({ id })),
    edges: [['project', 'system'], ['project', 'operations'], ['project', 'code'], ['system', 'functional'], ['system', 'operations'], ['operations', 'functional'],
      ['functional', 'sourceA'], ['code', 'sourceB'], ['system', 'sourceA'], ['system', 'sourceA'], ['functional', 'system'], ['code', 'code']]
      .map(([from, to], i) => ({ id: `edge-${i}`, from, to, label: i < 3 ? 'Contains' : 'Uses drafting input · 240' })) };
  expectClearLayout(model, await layoutTraceDiagram(model));
});

test('the maximum displayed graph keeps routes clear of all item and text rectangles', async () => {
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `node-${i}` }));
  const edges = [];
  for (let i = 0; i < 240; i++) edges.push({ id: `edge-${i}`, from: nodes[i % 80].id, to: nodes[(i * 7 + 1) % 80].id, label: i % 2 ? 'Refines · 26278' : 'Uses drafting input' });
  const model = { nodes, edges };
  expectClearLayout(model, await layoutTraceDiagram(model));
}, 20000);

test('an empty trace view has an empty layout', async () => {
  const layout = await layoutTraceDiagram({ nodes: [], edges: [] });
  expect(layout.positions.size).toBe(0); expect(layout.routes.size).toBe(0);
});

test('spline control points are rendered as cubic curves without rectangular line segments', () => {
  const path = traceRoutePath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 80, y: 80 }]);
  expect(path).toBe('M 0 0 C 40 0 40 80 80 80');
  expect(traceRoutePath([])).toBe('');
  expect(() => traceRoutePath([{ x: 0, y: 0 }, { x: 40, y: 0 }])).toThrow('control points');
});

test('unobstructed parallel connections use separate broad curves instead of local corner rounding', async () => {
  const model = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'input', from: 'a', to: 'b', label: 'Uses drafting input' }, { id: 'refines', from: 'a', to: 'b', label: 'Refines' }] };
  const layout = await layoutTraceDiagram(model);
  expectClearLayout(model, layout);
  const [a, b] = [...layout.routes.values()];
  expect(a.points).toHaveLength(4); expect(b.points).toHaveLength(4);
  expect(a.points[1].y).not.toBe(b.points[1].y);
});

test('project ownership and containment paths sweep around the outside without rectangular rails', async () => {
  const model = { nodes: ['project', 'system-architecture', 'system-spec', 'operations', 'functional-architecture', 'code-project', 'functional-project'].map(id => ({ id })),
    edges: [
      ['project', 'code-project', 'Derived from project'], ['project', 'functional-project', 'Derived from project'],
      ['project', 'system-architecture', 'Contains'], ['project', 'system-spec', 'Contains'], ['project', 'operations', 'Contains'], ['project', 'functional-architecture', 'Contains'],
      ['system-architecture', 'code-project', 'Derived from project'], ['system-spec', 'functional-project', 'Derived from project'],
      ['operations', 'functional-project', 'Derived from project'], ['functional-architecture', 'functional-project', 'Derived from project'],
      ['system-spec', 'operations', 'Uses drafting input'], ['system-spec', 'functional-architecture', 'Uses drafting input'], ['operations', 'functional-architecture', 'Uses drafting input'],
    ].map(([from, to, label], i) => ({ id: `outer-${i}`, from, to, label })) };
  const layout = await layoutTraceDiagram(model);
  expectClearLayout(model, layout);
  expect([...layout.routes.values()].filter(route => route.routing === 'sweep').length).toBeGreaterThan(0);
  for (const route of layout.routes.values()) expect(route.points.length).toBeLessThanOrEqual(7);
});
