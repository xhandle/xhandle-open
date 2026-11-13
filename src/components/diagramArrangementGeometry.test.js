import { arrangedNodes, absolutePosition, changeArrangement, reparentArrangement, arrangeInGroups } from './diagramArrangementGeometry';

const fixture = () => [
  { id: 'system', type: 'groupBox', position: { x: 100, y: 100 }, width: 500, height: 400 },
  { id: 'component', type: 'groupBox', parentNode: 'system', extent: 'parent', position: { x: 30, y: 50 }, width: 300, height: 200 },
  { id: 'unit', parentNode: 'component', extent: 'parent', position: { x: 20, y: 50 }, width: 120, height: 60 },
  { id: 'other', parentNode: 'system', position: { x: 350, y: 80 }, width: 120, height: 60 },
];

test('moving or resizing a child grows its ancestors without mutating the source', () => {
  const nodes = fixture(), original = JSON.stringify(nodes);
  const geometry = changeArrangement(nodes, {}, [{ id: 'unit', position: { x: 400, y: 300 }, width: 200, height: 100 }]);
  const displayed = arrangedNodes(nodes, geometry);
  expect(displayed.find(n => n.id === 'component')).toMatchObject({ width: 616, height: 416, extent: undefined });
  expect(displayed.find(n => n.id === 'system')).toMatchObject({ width: 662, height: 482 });
  expect(JSON.stringify(nodes)).toBe(original);
});

test('expanding left and above preserves absolute positions of siblings', () => {
  const nodes = fixture();
  const geometry = changeArrangement(nodes, {}, [{ id: 'unit', position: { x: -50, y: -20 } }]);
  const displayed = arrangedNodes(nodes, geometry);
  expect(absolutePosition(displayed.find(n => n.id === 'unit'), displayed)).toEqual({ x: 80, y: 130 });
  expect(absolutePosition(displayed.find(n => n.id === 'other'), displayed)).toEqual({ x: 450, y: 180 });
});

test('ungrouping selected parents and children moves the parent only and keeps absolute positions', () => {
  const nodes = fixture();
  const geometry = reparentArrangement(nodes, {}, ['component', 'unit']);
  const displayed = arrangedNodes(nodes, geometry);
  expect(displayed.find(n => n.id === 'component').parentNode).toBeUndefined();
  expect(displayed.find(n => n.id === 'unit').parentNode).toBe('component');
  expect(absolutePosition(displayed.find(n => n.id === 'unit'), displayed)).toEqual({ x: 150, y: 200 });
  expect(reparentArrangement(nodes, {}, ['system'], 'component')).toEqual({});
});

test('reparenting survives serialization and preserves element identity and location', () => {
  const nodes = fixture();
  const geometry = JSON.parse(JSON.stringify(reparentArrangement(nodes, {}, ['unit'], 'system')));
  const displayed = arrangedNodes(nodes, geometry);
  expect(displayed.find(n => n.id === 'unit').parentNode).toBe('system');
  expect(absolutePosition(displayed.find(n => n.id === 'unit'), displayed)).toEqual({ x: 150, y: 200 });
  expect(displayed.map(n => n.id).sort()).toEqual(nodes.map(n => n.id).sort());
});

test('auto arrange separates siblings, retains membership and fits nested groups', () => {
  const nodes = fixture();
  const geometry = arrangeInGroups(nodes, { other: { position: { x: 30, y: 50 } } });
  const displayed = arrangedNodes(nodes, geometry);
  const component = displayed.find(n => n.id === 'component'), other = displayed.find(n => n.id === 'other');
  expect(other.position.x).toBeGreaterThan(component.position.x + component.width);
  expect(displayed.find(n => n.id === 'unit').parentNode).toBe('component');
});
