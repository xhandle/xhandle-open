import { tightenSystemSpacing, tightenSystemSubsystemSpacing } from './functionalSystemGroups';
const padding = { padX: 18, padTop: 46, padBottom: 18, minW: 320, minH: 180, nodeWidth: 180, nodeHeight: 72 };
test('closes subsystem gaps to 144 diagram units while preserving contents and system origins', () => {
  const boxes = [
    { id: 's', elementType: 'system', position: { x: 90, y: 100 }, width: 4000, height: 3000 },
    { id: 'a', parentNode: 's', position: { x: 100, y: 100 }, width: 420, height: 280 },
    { id: 'b', parentNode: 's', position: { x: 2000, y: 100 }, width: 420, height: 280 },
    { id: 'c', parentNode: 's', position: { x: 100, y: 2000 }, width: 420, height: 280 },
  ];
  const child = { id: 'f', parentNode: 'a', position: { x: 20, y: 60 } };
  const result = tightenSystemSubsystemSpacing([...boxes.map(box => ({ ...box, type: 'groupBox' })), child], boxes, padding);
  expect(result.boxes[1].position).toEqual({ x: 18, y: 46 });
  expect(result.boxes[2].position).toEqual({ x: 582, y: 46 });
  expect(result.boxes[3].position).toEqual({ x: 18, y: 470 });
  expect(result.boxes[0].position).toEqual(boxes[0].position);
  expect(result.nodes.find(node => node.id === 'f')).toBe(child);
  expect(result.boxes[0].width).toBe(1020);
  expect(result.boxes[0].height).toBe(768);
  expect(boxes[0].width).toBe(4000);
});
test('leaves diagrams without nested subsystems alone', () => {
  const nodes = [], boxes = [];
  const result = tightenSystemSubsystemSpacing(nodes, boxes, padding);
  expect(result.nodes).toBe(nodes);
  expect(result.boxes).toBe(boxes);
});

test('brings systems together without moving their contents or overlapping other canvas nodes', () => {
  const boxes = [
    { id: 'a', elementType: 'system', position: { x: 0, y: 0 }, width: 500, height: 400 },
    { id: 'b', elementType: 'system', position: { x: 5000, y: 0 }, width: 600, height: 400 },
    { id: 'sub', parentNode: 'a', position: { x: 18, y: 46 }, width: 320, height: 180 },
  ];
  const child = { id: 'f', parentNode: 'sub', position: { x: 20, y: 60 } };
  const nodes = [...boxes.map(box => ({ ...box, type: 'groupBox' })), child,
    { id: 'free', position: { x: 3000, y: 0 }, width: 180, height: 72 }];
  const result = tightenSystemSpacing(nodes, boxes, padding);
  expect(result.nodes.find(node => node.id === 'free').position.x).toBe(644);
  expect(result.boxes[1].position.x).toBe(968);
  expect(result.boxes[2]).toBe(boxes[2]);
  expect(result.nodes.find(node => node.id === 'f')).toBe(child);
  expect(tightenSystemSpacing(result.nodes, result.boxes, padding)).toEqual(result);
});
