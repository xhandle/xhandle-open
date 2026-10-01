import { manualDropTarget, reparentManualElements, rowsWithManualSubsystem } from './manualDiagramEditing';
const padding = { padX: 18, padTop: 46, padBottom: 18, w: 420, h: 280, nodeWidth: 240, nodeHeight: 96 };
const box = { id: 'g:manual', position: { x: 500, y: 300 }, width: 420, height: 280 };

test('manual ownership changes only outgoing rows; incoming source ownership is preserved', () => {
  const rows = [{ fromFunction: 'A', toFunction: 'B', subsystem: 'Source' }, { fromFunction: 'B', toFunction: 'A', subsystem: 'Destination' }];
  const next = rowsWithManualSubsystem(rows, ['n:A'], 'Manual');
  expect(next[0].subsystem).toBe('Manual');
  expect(next[1]).toBe(rows[1]);
  expect(rowsWithManualSubsystem(rows, ['n:Receiver only'], 'Manual')).toBe(rows);
});

test('grouping a selection preserves offsets, keeps siblings fixed, and expands only required bounds', () => {
  const nodes = [
    { id: box.id, type: 'groupBox', position: box.position },
    { id: 'n:A', position: { x: 20, y: 30 } },
    { id: 'n:B', position: { x: 350, y: 80 } },
    { id: 'n:Sibling', parentNode: box.id, position: { x: 18, y: 46 } },
  ];
  const next = reparentManualElements(nodes, [box], ['n:A', 'n:B'], box.id, padding);
  const [a,b] = ['n:A', 'n:B'].map(id => next.nodes.find(node => node.id === id));
  expect(a.parentNode).toBe(box.id);
  expect(b.position.x - a.position.x).toBe(330);
  expect(b.position.y - a.position.y).toBe(50);
  expect(next.nodes.find(node => node.id === 'n:Sibling')).toBe(nodes[3]);
  expect(a.position.y).toBeGreaterThan(46 + 96);
  expect(next.boxes[0].width).toBeGreaterThan(box.width);
});

test('drop targets prefer the nested subsystem, and reject subsystem-inside-subsystem', () => {
  const system = { id: 'g:system', elementType: 'system', position: { x: 100, y: 100 }, width: 900, height: 800 };
  const subsystem = { ...box, parentNode: system.id, position: { x: 40, y: 60 } };
  const boxes = [system, subsystem];
  expect(manualDropTarget({x: 170, y: 190}, [{id:'n:A'}], boxes)).toBe(subsystem);
  expect(manualDropTarget({x: 170, y: 190}, [{...subsystem, type:'groupBox'}], boxes)).toBe(system);
  expect(manualDropTarget({x: 20, y: 20}, [{id:'n:A'}], boxes)).toBeNull();
});

test('detaching a nested child preserves its absolute canvas position', () => {
  const system = { id: 'g:system', elementType: 'system', position: { x: 100, y: 200 }, width: 900, height: 800 };
  const subsystem = { ...box, parentNode: system.id };
  const nodes = [{...system,type:'groupBox'}, {...subsystem,type:'groupBox'}, {id:'n:A',parentNode:box.id,position:{x:30,y:60}}];
  const next = reparentManualElements(nodes, [system,subsystem], ['n:A'], null, padding);
  expect(next.nodes.find(node => node.id === 'n:A')).toMatchObject({parentNode:undefined,position:{x:630,y:560}});
});
