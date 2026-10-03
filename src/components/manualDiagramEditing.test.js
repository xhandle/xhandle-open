import { expandManualAncestorsForDrag, manualDropTarget, reparentManualElements, resizeManualContainer, rowsWithManualSubsystem } from './manualDiagramEditing';
import { absoluteElementPosition } from './functionalSystemGroups';
const padding = { padX: 18, padTop: 46, padBottom: 18, w: 420, h: 280, minW: 320, minH: 180, nodeWidth: 240, nodeHeight: 96 };
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

test('manual container resize preserves all descendant positions and rejects rearrangement proposals', () => {
  const system = { id:'sys',elementType:'system',position:{x:100,y:100},width:1000,height:750 };
  const subsystem = { id:'sub',parentNode:'sys',position:{x:30,y:60},width:420,height:280 };
  const external = { id:'ext',elementType:'system',position:{x:1250,y:100},width:420,height:330 };
  const boxes = [external,system,subsystem];
  const nodes = [...boxes.map(box=>({...box,type:'groupBox'})),
    {id:'fn',parentNode:'sub',position:{x:30,y:60}}, {id:'direct',parentNode:'sys',position:{x:600,y:100}}];
  const resize = dimensions => resizeManualContainer(nodes,boxes,'sys',dimensions,padding);
  const result = resize({x:50,y:0,width:1090,height:850});
  expect(result).toBeTruthy();
  for (const node of nodes.filter(node=>node.id!=='sys')) {
    expect(absoluteElementPosition(result.nodes.find(item=>item.id===node.id),result.nodes)).toEqual(absoluteElementPosition(node,nodes));
  }
  expect(resize({x:100,y:100,width:1100,height:750})).toBeNull(); // Neighbor clearance.
  const shrunk = resize({x:100,y:100,width:500,height:400});
  expect(shrunk.nodes.find(node=>node.id==='direct').position.x).toBe(242);
  const pushed = resize({x:100,y:200,width:1000,height:650});
  expect(pushed.boxes.find(box=>box.id==='sub').position.y).toBe(46);
  expect(pushed.nodes.find(node=>node.id==='fn').position).toEqual({x:30,y:60});
  expect(resize({x:100,y:100,width:400,height:300})).toBeNull(); // Too small for subsystem itself.
  expect(resizeManualContainer(nodes,boxes,'sub',{x:30,y:60,width:1150,height:280},padding)).toBeNull(); // Ancestor would collide.
});


test.each([
  [{x:920,y:260}, {x:100,y:100}, 1258, 600],
  [{x:220,y:700}, {x:100,y:100}, 900, 898],
  [{x:80,y:260}, {x:62,y:100}, 938, 600],
  [{x:220,y:120}, {x:100,y:74}, 900, 626],
])('subsystem drag expands a system continuously at %j while siblings stay fixed', (desired, position, width, height) => {
  const boxes = [
    {id:'sys',elementType:'system',position:{x:100,y:100},width:900,height:600},
    {id:'sub',parentNode:'sys',position:{x:120,y:160},width:420,height:280},
    {id:'sibling',parentNode:'sys',position:{x:600,y:80},width:250,height:200},
  ];
  const nodes = [...boxes.map(box=>({...box,type:'groupBox'})),{id:'fn',parentNode:'sub',position:{x:30,y:60}}];
  const result=expandManualAncestorsForDrag(nodes,boxes,'sub',desired,padding);
  expect(result.boxes.find(box=>box.id==='sys')).toMatchObject({position,width,height});
  expect(absoluteElementPosition(result.nodes.find(node=>node.id==='sub'),result.nodes)).toEqual(desired);
  expect(absoluteElementPosition(result.nodes.find(node=>node.id==='sibling'),result.nodes)).toEqual({x:700,y:180});
  expect(result.nodes.find(node=>node.id==='fn').position).toEqual({x:30,y:60});
  const next=expandManualAncestorsForDrag(result.nodes,result.boxes,'sub',{x:desired.x+1,y:desired.y+1},padding);
  expect(absoluteElementPosition(next.nodes.find(node=>node.id==='sub'),next.nodes)).toEqual({x:desired.x+1,y:desired.y+1});
});

test('function dragging expands nested subsystem and system left/top without moving sibling contents', () => {
  const boxes=[{id:'sys',elementType:'system',position:{x:100,y:100},width:900,height:600},
    {id:'sub',parentNode:'sys',position:{x:18,y:46},width:420,height:280}];
  const nodes=[...boxes.map(box=>({...box,type:'groupBox'})),
    {id:'fn',parentNode:'sub',position:{x:30,y:60}}, {id:'peer',parentNode:'sub',position:{x:100,y:120}}];
  const result=expandManualAncestorsForDrag(nodes,boxes,'fn',{x:80,y:100},padding);
  expect(absoluteElementPosition(result.nodes.find(node=>node.id==='fn'),result.nodes)).toEqual({x:80,y:100});
  expect(absoluteElementPosition(result.nodes.find(node=>node.id==='peer'),result.nodes)).toEqual({x:218,y:266});
  expect(result.boxes.find(box=>box.id==='sub').position).toEqual({x:18,y:46});
});
