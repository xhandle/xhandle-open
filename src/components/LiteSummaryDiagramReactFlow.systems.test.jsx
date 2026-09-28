import { diagramRectsOverlap, GROUP_COLLISION_CLEARANCE } from './functionalDiagramCollision';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Diagram from './LiteSummaryDiagramReactFlow';

let mockFlowProps;
let mockNodes = [];
let mockEdges = [];
const mockApi = { getNodes: () => mockNodes, getEdges: () => mockEdges, getViewport: () => ({ x: 0, y: 0, zoom: 1 }), fitView: jest.fn(), project: position => position };
jest.mock('reactflow', () => {
  const React = require('react');
  const original = jest.requireActual('reactflow');
  return { ...original, __esModule: true,
    default: props => { mockFlowProps = props; return <div className="react-flow" />; },
    ReactFlowProvider: ({ children }) => children,
    useReactFlow: () => mockApi,
    useNodesInitialized: () => true,
    useNodesState: initial => {
      const [nodes, setNodes] = React.useState(initial);
      mockNodes = nodes;
      const change = React.useCallback(changes => setNodes(current => original.applyNodeChanges(changes, current)), []);
      return [nodes, setNodes, change];
    },
    useEdgesState: initial => {
      const [edges, setEdges] = React.useState(initial);
      mockEdges = edges;
      const change = React.useCallback(changes => setEdges(current => original.applyEdgeChanges(changes, current)), []);
      return [edges, setEdges, change];
    },
  };
});

const rows = [{ subsystem: 'Planning', fromFunction: 'Plan', controlAction: 'Command', toFunction: 'Control' }];
const key = 'test-system-editor';
let container, root;
const tick = async () => act(async () => { jest.advanceTimersByTime(200); await Promise.resolve(); });
const mount = () => act(() => root.render(<Diagram rows={rows} storageKey={key} />));
beforeEach(() => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem(`${key}:groups:v1`, JSON.stringify([{ id: 'g:planning', label: 'Planning', position: { x: 100, y: 100 }, width: 420, height: 280 }]));
  localStorage.setItem(key, JSON.stringify([['n:Plan', { position: { x: 30, y: 60 }, parentId: 'g:planning', groupingIntent: 'explicit' }]]));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { await Promise.resolve(); }); act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

test('adds a system through the existing toolbar, keeps a selected subsystem intact, and supports undo/redo and reload', async () => {
  mount(); await tick();
  const oldNode = mockNodes.find(node => node.id === 'n:Plan');
  expect(oldNode.parentNode).toBe('g:planning');
  act(() => mockFlowProps.onSelectionChange({ nodes: [mockNodes.find(node => node.id === 'g:planning')] }));
  act(() => container.querySelector('button[aria-label="Add system"]').click());
  await tick();
  const system = mockNodes.find(node => node.data.elementType === 'system');
  expect(system).toBeTruthy();
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBe(system.id);
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBe('g:planning');
  expect(mockEdges).toHaveLength(1);
  const undo = Array.from(container.querySelectorAll('button')).find(button => /undo/i.test(button.title));
  act(() => undo.click()); await tick();
  expect(mockNodes.some(node => node.data.elementType === 'system')).toBe(false);
  const redo = Array.from(container.querySelectorAll('button')).find(button => /redo/i.test(button.title));
  act(() => redo.click()); await tick();
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBe(system.id);
  act(() => root.unmount()); root = createRoot(container);
  mount(); await tick();
  expect(mockNodes.find(node => node.id === system.id).data.elementType).toBe('system');
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBe(system.id);
  expect(mockNodes.find(node => node.id === 'n:Plan').position).toEqual(oldNode.position);
});

const openGroupMenu = id => {
  act(() => mockFlowProps.onSelectionChange({ nodes: [mockNodes.find(node => node.id === id)] }));
  act(() => mockFlowProps.onNodeContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10 }, mockNodes.find(node => node.id === id)));
};
const clickText = text => act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text).click());

test('existing group menu adds and removes functions from a system, preserving connections through reload', async () => {
  mount(); await tick();
  act(() => container.querySelector('button[aria-label="Add system"]').click()); await tick();
  const system = mockNodes.find(node => node.data.elementType === 'system');
  openGroupMenu('n:Plan'); clickText('System 1 (System)'); await tick();
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBe(system.id);
  expect(mockEdges).toHaveLength(1);
  act(() => root.unmount()); root = createRoot(container); mount(); await tick();
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBe(system.id);
  openGroupMenu('n:Plan'); clickText('Remove From Group'); await tick();
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBeUndefined();
  act(() => root.unmount()); root = createRoot(container); mount(); await tick();
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBeUndefined();
  expect(mockEdges).toHaveLength(1);
});

test('resize and delete preserve nested subsystem children, including after reload', async () => {
  mount(); await tick();
  act(() => mockFlowProps.onSelectionChange({ nodes: [mockNodes.find(node => node.id === 'g:planning')] }));
  act(() => container.querySelector('button[aria-label="Add system"]').click()); await tick();
  const system = mockNodes.find(node => node.data.elementType === 'system');
  act(() => system.data.onResizeStart({ x: system.position.x, y: system.position.y, width: system.style.width, height: system.style.height }));
  act(() => system.data.onResizeEnd({ x: 0, y: 0, width: 800, height: 600 })); await tick();
  const box = JSON.parse(localStorage.getItem(`${key}:groups:v1`)).find(item => item.id === system.id);
  expect(box.width).toBeGreaterThanOrEqual(800);
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBe('g:planning');
  act(() => mockFlowProps.onNodesChange([{ id: system.id, type: 'remove' }])); await tick();
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBeUndefined();
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBe('g:planning');
  act(() => root.unmount()); root = createRoot(container); mount(); await tick();
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBeUndefined();
  expect(mockNodes.find(node => node.id === 'n:Plan').parentNode).toBe('g:planning');
});


test('System table values and diagram memberships stay synchronized in both directions', async () => {
  let updateRows;
  let currentRows;
  function ControlledDiagram() {
    const [data, setData] = React.useState(rows);
    currentRows = data;
    updateRows = setData;
    return <Diagram rows={data} onUpdateRows={setData} storageKey={key} />;
  }
  act(() => root.render(<ControlledDiagram />)); await tick();
  act(() => mockFlowProps.onSelectionChange({ nodes: [mockNodes.find(node => node.id === 'g:planning')] }));
  act(() => container.querySelector('button[aria-label="Add system"]').click()); await tick();
  expect(currentRows[0].system).toBe('System 1');
  act(() => updateRows(currentRows.map(row => ({ ...row, system: 'Vehicle' })))); await tick();
  const vehicle = mockNodes.find(node => node.data.label === 'Vehicle' && node.data.elementType === 'system');
  expect(vehicle).toBeTruthy();
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBe(vehicle.id);
  openGroupMenu('g:planning'); clickText('Remove From Group'); await tick();
  expect(currentRows[0].system).toBe('');
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBeUndefined();
});

test('backfills existing diagram systems into legacy table rows', async () => {
  const groups = JSON.parse(localStorage.getItem(`${key}:groups:v1`));
  groups[0].parentNode = 'g:vehicle';
  groups.push({ id: 'g:vehicle', elementType: 'system', label: 'Vehicle', position: { x: 0, y: 0 }, width: 800, height: 600 });
  localStorage.setItem(`${key}:groups:v1`, JSON.stringify(groups));
  let currentRows;
  function ControlledDiagram() {
    const [data, setData] = React.useState(rows);
    currentRows = data;
    return <Diagram rows={data} onUpdateRows={setData} storageKey={key} />;
  }
  act(() => root.render(<ControlledDiagram />)); await tick();
  expect(currentRows[0].system).toBe('Vehicle');
  expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBe('g:vehicle');
});


test('repairs saved system overlaps and maintains clearance after dragging and resizing', async () => {
  const groups = JSON.parse(localStorage.getItem(`${key}:groups:v1`));
  groups[0].parentNode = 'g:system-a';
  groups.push(
    { id: 'g:system-a', elementType: 'system', label: 'A system', position: { x: 0, y: 0 }, width: 800, height: 600 },
    { id: 'g:system-b', elementType: 'system', label: 'B system', position: { x: 200, y: 200 }, width: 800, height: 600 },
  );
  localStorage.setItem(`${key}:groups:v1`, JSON.stringify(groups));
  const expectClear = () => {
    const saved = JSON.parse(localStorage.getItem(`${key}:groups:v1`)).filter(box => box.elementType === 'system');
    expect(saved).toHaveLength(2);
    const rect = box => ({ ...box.position, width: box.width, height: box.height });
    expect(diagramRectsOverlap(rect(saved[0]), rect(saved[1]), GROUP_COLLISION_CLEARANCE)).toBe(false);
    expect(mockNodes.find(node => node.id === 'g:planning').parentNode).toBe('g:system-a');
    expect(mockNodes.find(node => node.id === 'n:Plan').position).toEqual({ x: 30, y: 60 });
    expect(mockEdges).toHaveLength(1);
  };
  mount(); await tick(); expectClear();
  const second = mockNodes.find(node => node.id === 'g:system-b');
  act(() => mockFlowProps.onNodeDragStart({}, second));
  act(() => mockFlowProps.onNodesChange([{ type: 'position', id: second.id, position: { x: 0, y: 0 } }]));
  act(() => mockFlowProps.onNodeDragStop({}, { ...second, position: { x: 0, y: 0 } }));
  await tick(); expectClear();
  const first = mockNodes.find(node => node.id === 'g:system-a');
  act(() => first.data.onResizeStart({ x: 0, y: 0, width: 800, height: 600 }));
  act(() => first.data.onResizeEnd({ x: 0, y: 0, width: 3000, height: 3000 }));
  await tick(); expectClear();
  act(() => root.unmount()); root = createRoot(container); mount(); await tick(); expectClear();
});

test('builds imported systems, subsystems and functions together without remounting', async () => {
  localStorage.clear();
  const importedRows = [
    { system: 'Vehicle', subsystem: 'Planning', fromFunction: 'Plan', controlAction: 'Command', toFunction: 'Control' },
    { system: 'Vehicle', subsystem: 'Execution', fromFunction: 'Control', controlAction: 'Feedback', toFunction: 'Plan' },
  ];
  const autoCategories = { source: 'table-subsystems', categories: [
    { name: 'Planning', functions: ['Plan'] },
    { name: 'Execution', functions: ['Control'] },
  ] };
  act(() => root.render(<Diagram rows={importedRows} autoCategories={autoCategories} storageKey={key} />));
  await tick();
  const system = mockNodes.find(node => node.data.elementType === 'system');
  expect(system).toBeTruthy();
  expect(system.style.width).toBeGreaterThan(0);
  for (const label of ['Planning', 'Execution']) {
    const subsystem = mockNodes.find(node => node.type === 'groupBox' && node.data.label === label);
    expect(subsystem.parentNode).toBe(system.id);
    expect(mockNodes.indexOf(system)).toBeLessThan(mockNodes.indexOf(subsystem));
    const fn = mockNodes.find(node => node.parentNode === subsystem.id);
    expect(fn).toBeTruthy();
    expect(mockNodes.indexOf(subsystem)).toBeLessThan(mockNodes.indexOf(fn));
  }
  expect(mockEdges.flatMap(edge => edge.data.rowIndexes)).toEqual([0, 1]);
});

test('blank subsystem allocations render functions directly in their respective systems', async () => {
  localStorage.clear();
  const importedRows = [
    { system: 'External', subsystem: '', fromFunction: 'Operator', controlAction: 'Input', toFunction: 'Qibus' },
    { system: 'Qibus', subsystem: '', fromFunction: 'Qibus', controlAction: 'Request', toFunction: 'DBW' },
    { system: 'DBW', subsystem: '', fromFunction: 'DBW', controlAction: 'Feedback', toFunction: 'Qibus' },
  ];
  act(() => root.render(<Diagram rows={importedRows} autoCategories={{ source: 'table-subsystems', categories: [] }} storageKey={key} />));
  await tick();
  expect(mockNodes.filter(node => node.type === 'groupBox')).toHaveLength(3);
  importedRows.forEach(row => {
    const system = mockNodes.find(node => node.type === 'groupBox' && node.data.label === row.system);
    expect(system.data.elementType).toBe('system');
    expect(mockNodes.find(node => node.id === 'n:' + row.fromFunction).parentNode).toBe(system.id);
  });
});

test('first render waits for nested systems and matches a subsequent Auto arrange', async () => {
  localStorage.clear();
  const importedRows = [
    { system: 'Vehicle', subsystem: 'Planning', fromFunction: 'Plan', controlAction: 'Command', toFunction: 'Control' },
    { system: 'Vehicle', subsystem: 'Execution', fromFunction: 'Control', controlAction: 'Feedback', toFunction: 'Plan' },
  ];
  const autoCategories = { source: 'table-subsystems', categories: [
    { name: 'Planning', functions: ['Plan'] }, { name: 'Execution', functions: ['Control'] },
  ] };
  const consumed = jest.fn();
  act(() => root.render(<Diagram rows={importedRows} autoCategories={autoCategories} storageKey={key}
    cleanOnceKey="import-1" onCleanApplied={consumed} />));
  await tick();
  const geometry = () => mockNodes.map(node => ({ id: node.id, parent: node.parentNode,
    position: node.position, width: node.style?.width, height: node.style?.height }));
  const initial = geometry();
  expect(consumed).toHaveBeenCalledTimes(1);
  act(() => container.querySelector('button[title="Auto arrange"]').click());
  await tick();
  expect(geometry()).toEqual(initial);
});

test('a new clean notification never rearranges a previously saved layout', async () => {
  const onCleanApplied = jest.fn();
  act(() => root.render(<Diagram rows={rows} storageKey={key} cleanOnceKey="reopened" onCleanApplied={onCleanApplied} />));
  await tick();
  expect(mockNodes.find(node => node.id === 'g:planning').position).toEqual({ x: 100, y: 100 });
  expect(mockNodes.find(node => node.id === 'n:Plan').position).toEqual({ x: 30, y: 60 });
  expect(onCleanApplied).toHaveBeenCalledWith('reopened');
  const before = mockNodes.map(node => ({ id: node.id, position: node.position, parentNode: node.parentNode }));
  act(() => root.render(<Diagram rows={rows} storageKey={key} cleanOnceKey="another-notification" onCleanApplied={onCleanApplied} />));
  await tick();
  expect(mockNodes.map(node => ({ id: node.id, position: node.position, parentNode: node.parentNode }))).toEqual(before);
});

test('browser size measurements cannot overwrite saved container geometry', async () => {
  mount(); await tick();
  const before = mockNodes.find(node => node.id === 'g:planning').style;
  act(() => mockFlowProps.onNodesChange([
    { id: 'g:planning', type: 'dimensions', dimensions: { width: 2000, height: 3000 } },
  ]));
  await tick();
  expect(mockNodes.find(node => node.id === 'g:planning').style).toEqual(before);
});

test('a new CSV diagram replaces the completed starter layout and arranges once', async () => {
  mount(); await tick();
  localStorage.setItem(key + ':initial-layout:v1', 'pending');
  const importedRows = [
    { system: 'Vehicle', subsystem: 'One', fromFunction: 'A', controlAction: 'Send', toFunction: 'B' },
    { system: 'Vehicle', subsystem: 'Two', fromFunction: 'B', controlAction: 'Reply', toFunction: 'A' },
  ];
  const categories = { source: 'table-subsystems', categories: [
    { name: 'One', functions: ['A'] }, { name: 'Two', functions: ['B'] },
  ] };
  act(() => root.render(<Diagram rows={importedRows} autoCategories={categories} storageKey={key} cleanOnceKey="import-replacement" />));
  await tick();
  const geometry = () => mockNodes.map(node => ({ id: node.id, position: node.position, style: node.style, parentNode: node.parentNode }));
  const initial = geometry();
  act(() => container.querySelector('button[title="Auto arrange"]').click());
  await tick();
  expect(geometry()).toEqual(initial);
  expect(localStorage.getItem(key + ':initial-layout:v1')).toBe('complete');
});
