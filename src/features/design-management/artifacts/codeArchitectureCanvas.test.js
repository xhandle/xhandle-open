import { codeArchitectureCanvas } from './codeArchitectureCanvas';
import { nativeArchitectureState } from './nativeArchitectureSnapshot';

const path = (subsystem, csc) => ({ subsystem, csci: 'Software', csc, csu: 'Unit' });
const fixture = abstraction => ({ id: 'code', diagramHash: 'v1', abstraction, snapshot: {
  nodes: [{ id: 'a', label: 'Component', displayArchitecture: path('Planning', 'Planner') },
    { id: 'b', label: 'Component', displayArchitecture: path('Control', 'Controller') }],
  edges: [{ id: 'bundle', from: 'a', to: 'b', label: 'Commands', relationships: [{ id: 'start', label: 'Start' }, { id: 'stop', label: 'Stop' }] }],
} });

test.each(['subsystem', 'csci', 'csc', 'csu', 'functional'])('%s retains the selected projection and distinct source identities', abstraction => {
  const source = fixture(abstraction), before = JSON.stringify(source);
  const { diagram, sourceNodes, nodeSources } = codeArchitectureCanvas(source);
  const leaves = diagram.snapshot.nodes.filter(node => !node.group);
  expect(leaves).toHaveLength(2);
  expect(sourceNodes.get('a')).not.toBe(sourceNodes.get('b'));
  expect(nodeSources.get(sourceNodes.get('a'))).toBe('a');
  expect(diagram.snapshot.edges.map(edge => edge.label)).toEqual(['Start', 'Stop']);
  expect(diagram.snapshot.edges.every(edge => leaves.some(node => node.id === edge.from) && leaves.some(node => node.id === edge.to))).toBe(true);
  expect(JSON.parse(diagram.snapshot.native.storage[':edge-aggregation:v1']).aggregateAll).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});

test('existing resized layout, routing, notes and comments survive the canvas transition', () => {
  const source = fixture('csc');
  const oldId = 'box:csc:Planning::Software::Planner';
  const oldEdge = 'aggregate:csc:box:csc:Planning::Software::Planner->box:csc:Control::Software::Controller';
  source.snapshot.codeNative = { positions: [], notes: [{ id: 'note', label: 'Review', description: 'Check the interface', position: { x: 10, y: 20 } }], comments: [], routing: {} };
  source.presentation = { geometry: { [oldId]: { position: { x: 40, y: 70 }, width: 500, height: 200, parentNode: null } },
    routing: { defaultStyle: 'bezier', overrides: { [oldEdge]: 'rectangular' }, manualRoutes: { [oldEdge]: { model: 'segment-v2', axis: 'x', corridor: 600 } } },
    comments: [{ id: 'comment', targetType: 'node', targetId: oldId, text: 'Check allocation' }] };
  const { diagram, sourceNodes } = codeArchitectureCanvas(source);
  const target = sourceNodes.get('a');
  expect(diagram.snapshot.nodes.find(node => node.id === target)).toMatchObject({ position: { x: 40, y: 70 }, width: 500, height: 200 });
  const storage = diagram.snapshot.native.storage;
  expect(JSON.parse(storage[':edge-routing:v1'])).toEqual({ defaultStyle: 'bezier', overrides: { [`pair:${target}->${sourceNodes.get('b')}`]: 'rectangular' },
    manualRoutes: { [`pair:${target}->${sourceNodes.get('b')}`]: { model: 'segment-v2', axis: 'x', corridor: 600 } } });
  expect(JSON.parse(storage[':manual:v1'])[0]).toMatchObject({ id: 'note', data: { label: 'Review' } });
  expect(JSON.parse(storage[':comments:v1'])[0].targetId).toBe(target);
  const state = nativeArchitectureState({ ...diagram, presentation: { storage: { ':edge-aggregation:v1': '{"aggregateAll":false}' } } });
  expect(JSON.parse(state.storage.getItem(state.key + ':edge-aggregation:v1')).aggregateAll).toBe(false);
});

test.each([['subsystem', 128], ['csci', 120], ['csc', 104]])('%s uses compact source bounds rather than full decomposition measurements', (abstraction, height) => {
  const { diagram } = codeArchitectureCanvas(fixture(abstraction));
  for (const node of diagram.snapshot.nodes.filter(node => !node.group)) {
    expect(node.height).toBe(height);
    expect(node.width).toBeLessThanOrEqual(520);
  }
  const byId = new Map(diagram.snapshot.nodes.map(node => [node.id, node]));
  for (const node of diagram.snapshot.nodes.filter(node => node.parentId)) {
    const parent = byId.get(node.parentId);
    expect(node.position.x + node.width).toBeLessThanOrEqual(parent.width);
    expect(node.position.y + node.height).toBeLessThanOrEqual(parent.height);
  }
});

test('repairs saved full-decomposition sizes while preserving manual sizes and positions', () => {
  const source = fixture('csc');
  const initial = codeArchitectureCanvas(source).diagram.snapshot.native.storage;
  const ids = Object.keys(JSON.parse(initial[':element-sizes:v1']));
  source.presentation = { storage: { ...initial,
    ':element-sizes:v1': JSON.stringify({ [ids[0]]: { width: 320, height: 236 }, [ids[1]]: { width: 550, height: 240 } }),
  } };
  const repaired = codeArchitectureCanvas(source).diagram.presentation.storage;
  expect(JSON.parse(repaired[':element-sizes:v1'])[ids[0]]).toEqual(JSON.parse(initial[':element-sizes:v1'])[ids[0]]);
  expect(JSON.parse(repaired[':element-sizes:v1'])[ids[1]]).toEqual({ width: 550, height: 240 });
  expect(repaired['']).toBe(initial['']);
});

test('repairs flattened legacy placements without overwriting explicit moves or presentation settings', () => {
  const source = fixture('csc');
  const initial = codeArchitectureCanvas(source).diagram.snapshot.native.storage;
  const placements = JSON.parse(initial['']);
  const leaves = placements.filter(([id]) => id.startsWith('n:'));
  const [brokenId, original] = leaves[0];
  const [manualId] = leaves[1];
  const manual = { position: { x: 900, y: 800 }, parentId: null, groupingIntent: 'explicit' };
  source.presentation = { storage: { ...initial,
    '': JSON.stringify(placements.map(([id, placement]) => [id, id === brokenId
      ? { position: { x: 8000, y: 9000 }, parentId: null, groupingIntent: 'automatic' }
      : id === manualId ? manual : placement])),
    ':groups:v1': JSON.stringify(JSON.parse(initial[':groups:v1']).map(group => ({ ...group, width: 40, height: 40 }))),
    ':element-sizes:v1': JSON.stringify({ [manualId]: { width: 550, height: 240 } }),
    ':edge-aggregation:v1': '{"aggregateAll":false}',
  } };
  const before = JSON.stringify(source);
  const repaired = codeArchitectureCanvas(source).diagram;
  const state = nativeArchitectureState(repaired);
  const positions = new Map(JSON.parse(state.storage.getItem(state.key)));
  expect(positions.get(brokenId)).toEqual(original);
  expect(positions.get(manualId)).toEqual(manual);
  const parent = JSON.parse(state.storage.getItem(state.key + ':groups:v1')).find(group => group.id === original.parentId);
  expect(parent.width).toBeGreaterThan(40);
  expect(parent.height).toBeGreaterThan(40);
  expect(JSON.parse(state.storage.getItem(state.key + ':element-sizes:v1'))).toEqual({
    ...JSON.parse(initial[':element-sizes:v1']), [manualId]: { width: 550, height: 240 },
  });
  expect(state.storage.getItem(state.key + ':edge-aggregation:v1')).toBe('{"aggregateAll":false}');
  expect(JSON.stringify(source)).toBe(before);
  expect(codeArchitectureCanvas({ ...source, presentation: repaired.presentation }).diagram.presentation).toEqual(repaired.presentation);
});
