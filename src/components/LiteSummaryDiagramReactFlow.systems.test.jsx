import { requestImportedDiagramLayout } from './functionalDiagramInitialization';
import { diagramRectsOverlap, GROUP_COLLISION_CLEARANCE } from './functionalDiagramCollision';
import { buildFunctionSubsystemOwnershipMap } from './functionalDiagramNodeReconciliation';
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

test('new disconnected functions save without another edit and survive reload', async () => {
  mount(); await tick();
  act(() => container.querySelector('button[title="Add node"]').click());
  await tick(); await tick();
  const added = mockNodes.find(node => node.id.startsWith('n:new:'));
  expect(added).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(`${key}:manual:v1`)).some(node => node.id === added.id)).toBe(true);
  act(() => root.unmount()); root = createRoot(container); mount(); await tick();
  expect(mockNodes.find(node => node.id === added.id).position).toEqual(added.position);
});

test('adding functions to a selected subsystem preserves it and existing functions', async () => {
  mount(); await tick();
  const original = mockNodes.find(node => node.id === 'n:Plan');
  act(() => mockFlowProps.onSelectionChange({nodes:[mockNodes.find(node => node.id === 'g:planning')]}));
  const addNode = () => container.querySelector('button[title="Add node"]').click();
  for (let i = 0; i < 3; i++) {
    act(addNode); await tick();
  }
  const added = mockNodes.filter(node => node.id.startsWith('n:new:'));
  expect(added).toHaveLength(3);
  expect(added.every(node => node.parentNode === 'g:planning')).toBe(true);
  expect(new Set(added.map(node => JSON.stringify(node.position))).size).toBe(3);
  expect(mockNodes.find(node => node.id === original.id).position).toEqual(original.position);
  expect(mockNodes.filter(node => node.type === 'groupBox')).toHaveLength(1);
});

test('manual assignment, connection and history do not duplicate table-derived groups or reallocate peers', async () => {
  const initialRows = [{subsystem:'Planning',fromFunction:'Plan',controlAction:'Command',toFunction:'Control'},
    {subsystem:'Execution',fromFunction:'Control',controlAction:'Feedback',toFunction:'Plan'}];
  const groups = [{id:'g:auto:table:planning',label:'Planning',autoGenerated:true,position:{x:100,y:100},width:420,height:280},
    {id:'g:auto:table:execution',label:'Execution',autoGenerated:true,position:{x:600,y:100},width:420,height:280}];
  localStorage.setItem(`${key}:groups:v1`,JSON.stringify(groups));
  localStorage.setItem(key,JSON.stringify([['n:Plan',{position:{x:60,y:72},parentId:groups[0].id}],['n:Control',{position:{x:60,y:72},parentId:groups[1].id}]]));
  let latestRows;
  function Controlled() {
    const [data,setData] = React.useState(initialRows); latestRows = data;
    const categories = React.useMemo(() => ({source:'table-subsystems',categories:[...new Set(data.map(row=>row.subsystem))].filter(Boolean)
      .map(name=>({name,functions:data.filter(row=>row.subsystem===name).map(row=>row.fromFunction)}))}),[data]);
    return <Diagram rows={data} onUpdateRows={setData} autoCategories={categories} storageKey={key}/>;
  }
  act(()=>root.render(<Controlled/>)); await tick();
  act(()=>container.querySelector('button[title="Group selected nodes"]').click()); await tick();
  const manual = mockNodes.find(node=>node.type==='groupBox' && node.data.label==='Group 3');
  const geometry = () => mockNodes.map(node=>({id:node.id,parent:node.parentNode,position:node.position})).sort((a,b)=>a.id.localeCompare(b.id));
  const before = geometry();
  openGroupMenu('n:Plan'); clickText('Group 3'); await tick(); await tick();
  expect(latestRows.find(row=>row.fromFunction==='Control').subsystem).toBe('Execution');
  expect(mockNodes.filter(node=>node.data.label==='Group 3')).toHaveLength(1);
  expect(mockNodes.find(node=>node.id==='n:Plan').parentNode).toBe(manual.id);
  const after = geometry();
  act(()=>container.querySelector('button[title="Undo last diagram change"]').click()); await tick(); await tick();
  expect(geometry()).toEqual(before);
  act(()=>container.querySelector('button[title="Redo diagram change"]').click()); await tick(); await tick();
  expect(geometry()).toEqual(after);
  act(()=>mockFlowProps.onConnect({source:'n:Plan',target:'n:Control'})); await tick(); await tick();
  expect(geometry()).toEqual(after);
  expect(mockNodes.filter(node=>node.data.label==='Group 3')).toHaveLength(1);
});

test.each([false, true])('moving a function preserves connected inferred peers (initial allocation: %s)', async allocated => {
  const initialRows = [
    {subsystem:allocated ? 'Source' : '',fromFunction:'A',controlAction:'Command B',toFunction:'B'},
    {subsystem:allocated ? 'Source' : '',fromFunction:'A',controlAction:'Command C',toFunction:'C'},
    {subsystem:'',fromFunction:'B',controlAction:'Feedback',toFunction:'A'},
  ];
  const groups = [{id:'g:target',label:'Target',position:{x:1200,y:100},width:500,height:400},
    ...(allocated ? [{id:'g:auto:table:source',label:'Source',autoGenerated:true,position:{x:100,y:100},width:900,height:400}] : [])];
  localStorage.setItem(`${key}:groups:v1`,JSON.stringify(groups));
  localStorage.setItem(key,JSON.stringify(['A','B','C'].map((name,i)=>[`n:${name}`,{
    position:{x:30+i*270,y:60},parentId:allocated ? 'g:auto:table:source' : null,groupingIntent:'automatic',
  }])));
  let latestRows = initialRows;
  function Controlled() {
    const [data,setData] = React.useState(latestRows); latestRows = data;
    const categories = React.useMemo(() => {
      const ownership = buildFunctionSubsystemOwnershipMap(data);
      return {source:'table-subsystems',categories:[...new Set(ownership.values())].map(name=>({name,
        functions:[...ownership].filter(([,subsystem])=>subsystem===name).map(([fn])=>fn.toUpperCase()),
      }))};
    },[data]);
    return <Diagram rows={data} onUpdateRows={setData} autoCategories={categories} storageKey={key}/>;
  }
  act(()=>root.render(<Controlled/>)); await tick(); await tick();
  const peers = () => mockNodes.filter(node=>['n:B','n:C'].includes(node.id))
    .map(node=>({id:node.id,parent:node.parentNode,position:node.position}));
  const before = peers();
  const edgeCount = mockEdges.length; // Reciprocal interfaces may share an aggregated edge.
  openGroupMenu('n:A'); clickText('Target'); await tick(); await tick();
  expect(mockNodes.find(node=>node.id==='n:A').parentNode).toBe('g:target');
  expect(peers()).toEqual(before);
  expect(latestRows.find(row=>row.fromFunction==='B').subsystem).toBe('');
  expect(mockEdges).toHaveLength(edgeCount);
  expect(latestRows).toHaveLength(initialRows.length);
  act(()=>container.querySelector('button[title="Undo last diagram change"]').click()); await tick(); await tick();
  expect(peers()).toEqual(before);
  act(()=>container.querySelector('button[title="Redo diagram change"]').click()); await tick(); await tick();
  expect(peers()).toEqual(before);
  act(()=>root.unmount()); root=createRoot(container);
  act(()=>root.render(<Controlled/>)); await tick(); await tick();
  expect(peers()).toEqual(before);
});

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

test('CSV replacement with retained functions builds the full hierarchy before arranging and preserves it on reopen', async () => {
  mount(); await tick();
  const importedRows = [
    { system: 'Vehicle', subsystem: 'Execution', fromFunction: 'Plan', controlAction: 'Command', toFunction: 'Control' },
    { system: 'Vehicle', subsystem: 'Planning', fromFunction: 'Control', controlAction: 'Feedback', toFunction: 'Plan' },
    { system: 'External', subsystem: 'Dispatch', fromFunction: 'Operator', controlAction: 'Request', toFunction: 'Plan' },
  ];
  const categories = { source: 'table-subsystems', categories: [
    { name: 'Execution', functions: ['Plan'] }, { name: 'Planning', functions: ['Control'] },
    { name: 'Dispatch', functions: ['Operator'] },
  ] };
  localStorage.setItem(key + ':initial-layout:v1', 'pending');
  requestImportedDiagramLayout(localStorage, key);
  // App changes the instance key only for a confirmed CSV replacement.
  act(() => root.render(<Diagram key="csv-replacement" rows={importedRows} autoCategories={categories}
    storageKey={key} cleanOnceKey="import-existing" />));
  await tick();
  expect(mockNodes.filter(node => node.data.elementType === 'system')).toHaveLength(2);
  expect(mockNodes.filter(node => node.type !== 'groupBox')).toHaveLength(3);
  for (const row of importedRows) {
    const fn = mockNodes.find(node => node.id === 'n:' + row.fromFunction);
    const parent = mockNodes.find(node => node.id === fn.parentNode);
    expect(parent.data.label).toBe(row.subsystem);
    expect(mockNodes.find(node => node.id === parent.parentNode).data.label).toBe(row.system);
  }
  const geometry = () => mockNodes.map(node => ({ id: node.id, parent: node.parentNode,
    position: node.position, width: node.style?.width, height: node.style?.height }));
  const first = geometry();
  act(() => container.querySelector('button[title="Auto arrange"]').click());
  await tick();
  expect(geometry()).toEqual(first);
  expect(localStorage.getItem(key + ':initial-layout:v1')).toBe('complete');
  act(() => root.unmount()); root = createRoot(container);
  act(() => root.render(<Diagram rows={importedRows} autoCategories={categories} storageKey={key} />));
  await tick();
  expect(geometry()).toEqual(first);
});

test.each(['system-nested', 'system-direct', 'subsystem'])('description generation uses the correct level for %s', async kind => {
  mount(); await tick();
  let target = mockNodes.find(node => node.id === 'g:planning');
  if (kind !== 'subsystem') {
    const selected = kind === 'system-nested' ? [target] : mockNodes.filter(node => node.type !== 'groupBox');
    act(() => mockFlowProps.onSelectionChange({ nodes: selected }));
    act(() => container.querySelector('button[aria-label="Add system"]').click()); await tick();
    target = mockNodes.find(node => node.data.elementType === 'system');
  }
  const before = mockNodes.map(node => ({id:node.id,parent:node.parentNode,position:node.position}));
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ok:true,json:async () => ({choices:[{message:{content:'Generated architecture description.'}}]})});
  try {
    act(() => mockFlowProps.onNodeDoubleClick({preventDefault(){},stopPropagation(){}},target));
    await act(async () => { container.querySelector('button[aria-label="Regenerate description with AI"]').click(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const prompt = body.messages[1].content;
    const context = JSON.parse(prompt.slice(prompt.indexOf('\n')+1));
    expect(context.memberFunctions).toEqual(expect.arrayContaining(['Plan','Control']));
    expect(context.functionalRows).toEqual(rows);
    if (kind === 'subsystem') {
      expect(prompt).toContain('functional subsystem group node');
      expect(context.subsystem).toBe('Planning');
      expect(context.system).toBeUndefined();
    } else {
      expect(prompt).toContain('functional system node');
      expect(context.system).toBe(target.data.label);
      expect(context.subsystem).toBeUndefined();
      expect(context.memberSubsystems).toEqual(kind === 'system-nested' ? ['Planning'] : []);
      expect(body.messages[0].content).toContain('Describe this item at the system level');
    }
    expect(container.querySelector('textarea').value).toBe('Generated architecture description.');
    expect(mockNodes.map(node => ({id:node.id,parent:node.parentNode,position:node.position}))).toEqual(before);
  } finally { global.fetch = originalFetch; }
});

test('system modal inherits nested function hazards, mission results and safety issues', async () => {
  const hazardSummary = [
    ['Function (From)', 'Control Action', 'Function (To)', 'Safety Classification', 'Hazard'],
    ['Plan', 'Command', 'Control', 'Safety — Direct', 'Unsafe motion'],
    ['Control', 'Status', 'Plan', 'Mission/Reliability', 'Service delay'],
    ['Unrelated', 'Other', 'Elsewhere', 'Safety — Direct', 'Unrelated hazard'],
    ['Plan', 'Command', 'Control', 'Not Applicable', 'Excluded result'],
    ['Plan', 'Command', 'Control', 'Needs Review', 'Unresolved result'],
  ];
  act(() => root.render(<Diagram rows={rows} storageKey={key}
    hazardSummary={hazardSummary}
    riskRegister={[{ id: 'risk-1', title: 'Inherited safety issue', sourceIndexes: [1], likelihood: 3, severity: 3 }]} />));
  await tick();
  act(() => mockFlowProps.onSelectionChange({ nodes: [mockNodes.find(node => node.id === 'g:planning')] }));
  act(() => container.querySelector('button[aria-label="Add system"]').click());
  await tick();
  const system = mockNodes.find(node => node.data.elementType === 'system');
  act(() => mockFlowProps.onNodeDoubleClick({ preventDefault() {}, stopPropagation() {} }, system));
  const sections = Array.from(container.querySelectorAll('details'));
  const section = title => sections.find(el => el.querySelector('summary')?.textContent.includes(title));
  expect(section('Safety Hazards').textContent).toContain('1 result');
  expect(section('Safety Hazards').textContent).toContain('Unsafe motion');
  expect(section('Mission/Reliability Issues').textContent).toContain('Service delay');
  expect(section('Associated Safety Issues').textContent).toContain('1 issue');
  expect(container.textContent).not.toContain('Unrelated hazard');
  expect(container.textContent).not.toContain('Excluded result');
  expect(container.textContent).not.toContain('Unresolved result');
  expect(section('Safety Hazards').open).toBe(false);
});

test('quick search indexes diagram nodes and connections and focuses without rearranging', async () => {
  mount(); await tick();
  const host = container.querySelector('.project-functional-diagram');
  host.getClientRects = () => [{ width: 800, height: 600 }];
  const entries = [];
  act(() => window.dispatchEvent(new CustomEvent('xhandle:quick-search-collect', { detail: { entries } })));
  const entry = entries.find(item => item.label === 'Plan');
  expect(entry).toBeTruthy();
  expect(entries.some(item => item.kind === 'Diagram connection')).toBe(true);
  const positions = mockNodes.map(node => ({ id: node.id, position: node.position }));
  act(() => entry.activate());
  expect(mockApi.fitView).toHaveBeenCalledWith(expect.objectContaining({
    nodes: [expect.objectContaining({ id: 'n:Plan' })],
  }));
  expect(mockNodes.find(node => node.id === 'n:Plan').selected).toBe(true);
  expect(mockNodes.map(node => ({ id: node.id, position: node.position }))).toEqual(positions);
});

test('node selection retains unrelated presentation objects and does not reload stored positions', async () => {
  mount(); await tick();
  const before = mockFlowProps.nodes.find(node => node.id === 'n:Control');
  const edges = mockFlowProps.edges;
  const read = jest.spyOn(Storage.prototype, 'getItem'); read.mockClear();
  act(() => {
    mockFlowProps.onNodeClick();
    mockFlowProps.onSelectionChange({ nodes: [mockNodes.find(node => node.id === 'n:Plan')] });
  });
  expect(mockFlowProps.nodes.find(node => node.id === 'n:Control')).toBe(before);
  expect(mockFlowProps.edges).toBe(edges);
  expect(read.mock.calls.filter(([storedKey]) => storedKey === key)).toHaveLength(0);
  read.mockRestore();
});

test.each([false, true])('separates stacked health-monitoring functions on %s initial arrangement or Auto arrange', async initial => {
  const names = ['Monitor Qibus Runtime Health', 'Publish Qibus Health State', 'Evaluate Qibus Runtime Readiness'];
  const healthRows = names.map((name, i) => ({ system: 'Qibus', subsystem: 'Qibus Health Monitoring',
    fromFunction: name, controlAction: 'Health ' + i, toFunction: names[(i + 1) % names.length] }));
  const boxes = [
    { id: 'g:system:qibus', elementType: 'system', label: 'Qibus', position: { x: 20, y: 20 }, width: 500, height: 350 },
    { id: 'g:health', label: 'Qibus Health Monitoring', parentNode: 'g:system:qibus', position: { x: 18, y: 46 }, width: 420, height: 280 },
  ];
  localStorage.setItem(key + ':groups:v1', JSON.stringify(boxes));
  localStorage.setItem(key, JSON.stringify(names.map(name => ['n:' + name,
    { position: { x: 18, y: 46 }, parentId: 'g:health', groupingIntent: 'explicit' }])));
  localStorage.setItem(key + ':initial-layout:v1', initial ? 'pending' : 'complete');
  act(() => root.render(<Diagram rows={healthRows} storageKey={key} />));
  await tick();
  if (!initial) {
    act(() => container.querySelector('button[title="Auto arrange"]').click());
    await tick();
  }
  const functions = mockNodes.filter(node => node.parentNode === 'g:health');
  expect(functions).toHaveLength(3);
  const subsystem = mockNodes.find(node => node.id === 'g:health');
  functions.forEach((node, i) => {
    expect(node.position.x + 250).toBeLessThanOrEqual(subsystem.style.width);
    expect(node.position.y + 72).toBeLessThanOrEqual(subsystem.style.height);
    functions.slice(i + 1).forEach(other => expect(diagramRectsOverlap(
      { ...node.position, width: 250, height: 72 }, { ...other.position, width: 250, height: 72 }, 0)).toBe(false));
  });
  const geometry = () => mockNodes.map(node => ({ id: node.id, position: node.position, parent: node.parentNode, style: node.style }));
  const arranged = geometry();
  act(() => container.querySelector('button[title="Auto arrange"]').click()); await tick();
  expect(geometry()).toEqual(arranged);
  act(() => root.unmount()); root = createRoot(container);
  act(() => root.render(<Diagram rows={healthRows} storageKey={key} />)); await tick();
  expect(geometry()).toEqual(arranged);
});
