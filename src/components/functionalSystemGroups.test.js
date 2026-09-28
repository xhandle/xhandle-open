import { diagramRectsOverlap, GROUP_COLLISION_CLEARANCE } from './functionalDiagramCollision';
import { reconcileTableSystems, separateSystemGroups, absoluteElementPosition, applyGroupGeometry, canContainElement, detachDeletedSystemParents, isSystemGroup, reparentSystemElements, resizeSystemElements } from './functionalSystemGroups';
import { resolveGeneratedNodePlacement } from './functionalDiagramNodeReconciliation';
import { cloneDiagramNodeForHistory, diagramHistoryComparable } from './LiteSummaryDiagramReactFlow';

const padding = { w: 420, h: 280, minW: 320, minH: 180, padX: 18, padTop: 46, padBottom: 18, nodeWidth: 180, nodeHeight: 72 };
const fixture = () => {
  const boxes = [
    { id: 'g:sub', label: 'Subsystem', position: { x: 150, y: 180 }, width: 420, height: 280 },
    { id: 'g:sys', elementType: 'system', label: 'System', position: { x: 50, y: 50 }, width: 420, height: 280 },
    { id: 'g:other', elementType: 'system', label: 'Other', position: { x: -100, y: -100 }, width: 420, height: 280 },
  ];
  return { boxes, nodes: [...boxes.map(box => ({ ...box, type: 'groupBox', data: { label: box.label, elementType: box.elementType } })),
    { id: 'n:A', type: 'bidirectional', parentNode: 'g:sub', position: { x: 30, y: 60 }, data: { label: 'A' } },
    { id: 'n:B', type: 'bidirectional', position: { x: 600, y: 300 }, data: { label: 'B' } },
  ] };
};
const nest = () => { const { nodes, boxes } = fixture(); return reparentSystemElements(nodes, boxes, ['g:sub', 'n:A', 'n:B'], 'g:sys', padding); };

test('legacy groups remain subsystems; systems accept functions and subsystems but cannot be nested', () => {
  const { nodes, boxes } = fixture();
  expect(isSystemGroup(boxes[0])).toBe(false);
  expect(canContainElement(boxes[1], nodes[0], boxes)).toBe(true);
  expect(canContainElement(boxes[1], nodes[3], boxes)).toBe(true);
  expect(canContainElement(boxes[0], nodes[1], boxes)).toBe(false);
  expect(canContainElement(boxes[1], nodes[2], boxes)).toBe(false);
  expect(canContainElement(boxes[1], nodes[1], boxes)).toBe(false);
});

test('adding a selected subsystem and its functions preserves their nesting and canvas coordinates', () => {
  const before = fixture();
  const result = nest();
  const fn = result.nodes.find(node => node.id === 'n:A');
  expect(fn.parentNode).toBe('g:sub');
  for (const node of result.nodes) expect(absoluteElementPosition(node, result.nodes)).toEqual(absoluteElementPosition(before.nodes.find(old => old.id === node.id), before.nodes));
  expect(result.nodes.findIndex(node => node.id === 'g:sys')).toBeLessThan(result.nodes.findIndex(node => node.id === 'g:sub'));
  expect(result.boxes.find(box => box.id === 'g:sys').width).toBeGreaterThan(700);
});

test('moving a system moves all descendants, removing a subsystem preserves its functions and coordinates', () => {
  const result = nest();
  const moved = result.nodes.map(node => node.id === 'g:sys' ? { ...node, position: { x: 100, y: 150 } } : node);
  expect(absoluteElementPosition(moved.find(node => node.id === 'n:A'), moved)).toEqual({ x: 230, y: 340 });
  const detached = reparentSystemElements(result.nodes, result.boxes, ['g:sub', 'n:A'], null, padding);
  expect(detached.nodes.find(node => node.id === 'g:sub').parentNode).toBeUndefined();
  expect(detached.nodes.find(node => node.id === 'n:A').parentNode).toBe('g:sub');
  expect(absoluteElementPosition(detached.nodes.find(node => node.id === 'n:A'), detached.nodes)).toEqual({ x: 180, y: 240 });
});

test('reparenting a subsystem between systems leaves its functions connected to the same parent', () => {
  const result = nest();
  const moved = reparentSystemElements(result.nodes, result.boxes, ['g:sub'], 'g:other', padding);
  expect(moved.nodes.find(node => node.id === 'n:A').parentNode).toBe('g:sub');
  expect(absoluteElementPosition(moved.nodes.find(node => node.id === 'n:A'), moved.nodes)).toEqual({ x: 180, y: 240 });
});

test('resizing a system fits its subsystem bounds and keeps descendants in place', () => {
  const result = nest();
  const resized = resizeSystemElements(result.nodes, result.boxes, 'g:sys', { x: 0, y: 0, width: 320, height: 180 }, padding);
  expect(absoluteElementPosition(resized.nodes.find(node => node.id === 'n:A'), resized.nodes)).toEqual({ x: 180, y: 240 });
  const system = resized.boxes.find(box => box.id === 'g:sys');
  const sub = resized.boxes.find(box => box.id === 'g:sub');
  expect(system.width).toBeGreaterThanOrEqual(sub.position.x + sub.width + padding.padX);
  expect(system.height).toBeGreaterThanOrEqual(sub.position.y + sub.height + padding.padBottom);
});

test('deleting a system unparents its contents without deleting descendants', () => {
  const result = nest();
  const deleted = detachDeletedSystemParents(result.nodes, result.boxes, new Set(['g:sys']));
  expect(deleted.nodes).toHaveLength(result.nodes.length - 1);
  expect(deleted.boxes.find(box => box.id === 'g:sub').parentNode).toBeUndefined();
  expect(deleted.nodes.find(node => node.id === 'n:A').parentNode).toBe('g:sub');
  expect(absoluteElementPosition(deleted.nodes.find(node => node.id === 'n:A'), deleted.nodes)).toEqual({ x: 180, y: 240 });
});

test('saved groups and history retain type, hierarchy, and local positions', () => {
  const result = nest();
  const snapshot = { groupBoxes: result.boxes, nodes: result.nodes.map(cloneDiagramNodeForHistory) };
  const loaded = JSON.parse(JSON.stringify(snapshot));
  expect(diagramHistoryComparable(snapshot)).toEqual(diagramHistoryComparable(loaded));
  expect(loaded.groupBoxes.find(box => box.id === 'g:sub').parentNode).toBe('g:sys');
  expect(loaded.nodes.find(node => node.id === 'g:sys').data.elementType).toBe('system');
  const graph = applyGroupGeometry(loaded.nodes, loaded.groupBoxes);
  expect(absoluteElementPosition(graph.find(node => node.id === 'n:A'), graph)).toEqual({ x: 180, y: 240 });
});

test('reconciliation across nested parents uses absolute origins and respects explicit system membership', () => {
  const result = nest();
  const groupById = new Map(result.boxes.map(box => [box.id, box]));
  const placement = resolveGeneratedNodePlacement({ saved: { position: { x: 30, y: 60 }, parentId: 'g:sub' }, expectedGroup: groupById.get('g:other'), groupById });
  expect(placement.position).toEqual({ x: 280, y: 340 });
  expect(resolveGeneratedNodePlacement({ saved: { position: { x: 550, y: 250 }, parentId: 'g:sys', groupingIntent: 'explicit' }, expectedGroup: groupById.get('g:sub'), groupById }).parentId).toBe('g:sys');
});


describe('system collision clearance', () => {
  const rect = box => ({ ...box.position, width: box.width, height: box.height });
  test('separates full variable-size bounds including containment and cascading collisions', () => {
    const boxes = [
      { id: 'a', elementType: 'system', position: { x: -200, y: -100 }, width: 3000, height: 1800 },
      { id: 'b', elementType: 'system', position: { x: 10, y: 10 }, width: 700, height: 4000 },
      { id: 'c', elementType: 'system', position: { x: 10, y: 10 }, width: 1800, height: 800 },
      { id: 'sub', parentNode: 'b', position: { x: 40, y: 80 }, width: 600, height: 400 },
    ];
    const output = separateSystemGroups(boxes);
    const systems = output.filter(isSystemGroup);
    systems.forEach((a, index) => systems.slice(index + 1).forEach(b => expect(diagramRectsOverlap(rect(a), rect(b), GROUP_COLLISION_CLEARANCE)).toBe(false)));
    expect(output[0]).toBe(boxes[0]);
    expect(output[3]).toBe(boxes[3]);
    expect(separateSystemGroups(output)).toBe(output);
  });
  test('keeps separated systems and legacy diagrams completely unchanged', () => {
    const boxes = [
      { id: 'a', elementType: 'system', position: { x: 0, y: 0 }, width: 500, height: 400 },
      { id: 'b', elementType: 'system', position: { x: 1000, y: 0 }, width: 500, height: 400 },
    ];
    expect(separateSystemGroups(boxes)).toBe(boxes);
    const legacy = fixture().boxes.filter(box => !isSystemGroup(box));
    expect(separateSystemGroups(legacy)).toBe(legacy);
  });
  test('moves descendants with the system without changing local positions or ownership', () => {
    const { nodes, boxes } = nest();
    const separated = separateSystemGroups(boxes);
    const rendered = applyGroupGeometry(nodes, separated);
    const fn = rendered.find(node => node.id === 'n:A');
    expect(fn).toBe(nodes.find(node => node.id === 'n:A'));
    expect(rendered.find(node => node.id === 'g:sub').parentNode).toBe('g:sys');
    expect(absoluteElementPosition(fn, rendered)).toEqual(absoluteElementPosition(nodes.find(node => node.id === 'n:A'), nodes));
  });
});

test('direct system imports do not stack functions when local coordinates are clamped', () => {
  const rows = ['A', 'B', 'C'].map(fromFunction => ({ fromFunction, subsystem: '', system: 'Vehicle' }));
  const nodes = rows.map((row, i) => ({ id: row.fromFunction, data: { label: row.fromFunction }, position: { x: 0, y: 300 - i * 100 } }));
  const result = reconcileTableSystems(rows, nodes, [], padding);
  result.nodes.filter(node => node.type !== 'groupBox').forEach((node, i, functions) => {
    functions.slice(i + 1).forEach(other => {
      expect(diagramRectsOverlap(
        { ...node.position, width: 180, height: 72 },
        { ...other.position, width: 180, height: 72 }, 0)).toBe(false);
    });
  });
});
