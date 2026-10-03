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

const toolbarDrag = title => {
  const button = container.querySelector(`button[title="${title}"]`);
  expect(button.draggable).toBe(true);
  const event = new Event('dragstart', {bubbles:true,cancelable:true});
  Object.defineProperty(event,'dataTransfer',{value:{setData:jest.fn()}});
  act(()=>button.dispatchEvent(event));
  return button;
};
const toolbarDrop = position => act(()=>mockFlowProps.onDrop({
  clientX:position.x,clientY:position.y,preventDefault(){},stopPropagation(){},
}));

test.each([
  ['Add node','bidirectional'], ['Group selected nodes','groupBox'],
  ['Add system (group selected functions or subsystems)','groupBox'], ['Add note','note'],
])('toolbar drop creates one %s at the projected position without grouping selected nodes', async (title,type) => {
  mount(); await tick();
  act(()=>mockFlowProps.onSelectionChange({nodes:[mockNodes.find(node=>node.id==='n:Plan')]}));
  const geometry = () => mockNodes.map(node=>({id:node.id,parent:node.parentNode,position:node.position}));
  const before = geometry();
  const originalIds = new Set(before.map(node=>node.id));
  const canvas = container.querySelector('.react-flow');
  canvas.getBoundingClientRect = () => ({left:100,top:50});
  const originalProject = mockApi.project;
  mockApi.project = point => ({x:(point.x-40)/2,y:(point.y+20)/2});
  // Re-render to expose the changed projection function to the drop handler.
  mount(); await tick();
  try {
    toolbarDrag(title);
    toolbarDrop({x:4140,y:1630}); await tick(); await tick();
    const added = mockNodes.filter(node=>!originalIds.has(node.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({type,position:{x:2000,y:800}});
    expect(added[0].parentNode).toBeFalsy();
    expect(geometry().filter(node=>originalIds.has(node.id))).toEqual(before);
    act(()=>container.querySelector('button[title="Undo last diagram change"]').click()); await tick();
    expect(geometry()).toEqual(before);
    act(()=>container.querySelector('button[title="Redo diagram change"]').click()); await tick();
    expect(mockNodes.some(node=>node.id===added[0].id)).toBe(true);
    const saved = geometry();
    act(()=>root.unmount()); root=createRoot(container); mount(); await tick();
    expect(geometry()).toEqual(saved);
  } finally { mockApi.project = originalProject; }
});

test('toolbar drops nest new subsystems and functions at the destination, ignoring prior selection', async () => {
  mount(); await tick();
  const originalPlan = {...mockNodes.find(node=>node.id==='n:Plan')};
  act(()=>mockFlowProps.onSelectionChange({nodes:[originalPlan]}));
  toolbarDrag('Add system (group selected functions or subsystems)'); toolbarDrop({x:1000,y:1000}); await tick();
  const system = mockNodes.find(node=>node.data.elementType==='system');
  toolbarDrag('Group selected nodes'); toolbarDrop({x:1070,y:1080}); await tick();
  const subsystem = mockNodes.find(node=>node.type==='groupBox' && node.parentNode===system.id);
  expect(subsystem.position).toEqual({x:70,y:80});
  toolbarDrag('Add node'); toolbarDrop({x:1100,y:1140}); await tick();
  const added = mockNodes.find(node=>node.id.startsWith('n:new:'));
  expect(added.parentNode).toBe(subsystem.id);
  expect(added.position).toEqual({x:30,y:60});
  expect(mockNodes.find(node=>node.id===originalPlan.id)).toMatchObject({parentNode:originalPlan.parentNode,position:originalPlan.position});
});

test('cancelled toolbar drags and unrelated drops create nothing', async () => {
  mount(); await tick();
  const ids = mockNodes.map(node=>node.id);
  toolbarDrop({x:1000,y:1000}); await tick();
  expect(mockNodes.map(node=>node.id)).toEqual(ids);
  const button = toolbarDrag('Add node');
  act(()=>button.dispatchEvent(new Event('dragend',{bubbles:true})));
  toolbarDrop({x:1000,y:1000}); await tick();
  expect(mockNodes.map(node=>node.id)).toEqual(ids);
});

test('the first drop on an empty manual canvas keeps its chosen position', async () => {
  localStorage.clear();
  act(()=>root.render(<Diagram rows={[]} storageKey={key}/>)); await tick();
  expect(mockNodes).toHaveLength(0);
  toolbarDrag('Add node');
  const event = new Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperties(event,{clientX:{value:650},clientY:{value:420}});
  // The host accepts drops even before the initially empty React Flow is visible.
  act(()=>container.querySelector('.react-flow').parentElement.dispatchEvent(event));
  await tick(); await tick();
  expect(mockNodes).toHaveLength(1);
  expect(mockNodes[0].position).toEqual({x:650,y:420});
  expect(localStorage.getItem(key+':initial-layout:v1')).toBe('complete');
  act(()=>root.unmount()); root=createRoot(container);
  act(()=>root.render(<Diagram rows={[]} storageKey={key}/>)); await tick();
  expect(mockNodes[0].position).toEqual({x:650,y:420});
});

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

test('manual system resize keeps children fixed and stops at neighboring systems instead of rearranging', async () => {
  localStorage.setItem(`${key}:groups:v1`,JSON.stringify([
    {id:'g:external',elementType:'system',label:'External',position:{x:1250,y:100},width:420,height:330},
    {id:'g:vehicle',elementType:'system',label:'Vehicle',position:{x:100,y:100},width:1000,height:750},
    {id:'g:planning',label:'Planning',parentNode:'g:vehicle',position:{x:30,y:60},width:420,height:280},
  ]));
  mount(); await tick();
  const geometry = () => mockNodes.map(node=>({id:node.id,parent:node.parentNode,position:node.position,width:node.style?.width,height:node.style?.height}));
  const before = geometry();
  const system = mockNodes.find(node=>node.id==='g:vehicle');
  act(()=>system.data.onResizeStart({x:100,y:100,width:1000,height:750}));
  act(()=>system.data.onResize({x:100,y:0,width:1040,height:850})); await tick();
  act(()=>system.data.onResizeEnd({x:100,y:-100,width:1080,height:950})); await tick(); await tick();
  // The last proposal would violate the existing inter-system clearance.
  expect(mockNodes.find(node=>node.id==='g:vehicle').position).toEqual({x:100,y:0});
  expect(mockNodes.find(node=>node.id==='g:planning').position).toEqual({x:30,y:160});
  expect(mockNodes.find(node=>node.id==='n:Plan').position).toEqual({x:30,y:60});
  expect(geometry().find(node=>node.id==='g:external')).toEqual(before.find(node=>node.id==='g:external'));
  const after = geometry();
  act(()=>container.querySelector('button[title="Undo last diagram change"]').click()); await tick();
  expect(geometry()).toEqual(before);
  act(()=>container.querySelector('button[title="Redo diagram change"]').click()); await tick();
  expect(geometry()).toEqual(after);
  act(()=>root.unmount()); root=createRoot(container); mount(); await tick();
  expect(geometry()).toEqual(after);
});

test('dragging a subsystem past system boundaries follows the pointer continuously and survives reload', async () => {
  localStorage.setItem(`${key}:groups:v1`,JSON.stringify([
    {id:'g:vehicle',elementType:'system',label:'Vehicle',position:{x:100,y:100},width:1000,height:750},
    {id:'g:planning',label:'Planning',parentNode:'g:vehicle',position:{x:30,y:60},width:420,height:280},
  ]));
  mount(); await tick();
  const initial=mockNodes.find(node=>node.id==='g:planning');
  // React Flow can constrain its supplied position; the pointer must still grow the parent.
  act(()=>mockFlowProps.onNodeDragStart({clientX:150,clientY:180},initial));
  const onNodeDrag = mockFlowProps.onNodeDrag;
  for(const x of [750,770,790]) {
    act(()=>onNodeDrag({clientX:x+120,clientY:180},initial)); await tick();
    const moved=mockNodes.find(node=>node.id==='g:planning');
    expect(moved.position).toEqual({x,y:60});
    expect(mockNodes.find(node=>node.id==='g:vehicle').style.width).toBe(x+420+18);
    expect(mockNodes.find(node=>node.id==='n:Plan').position).toEqual({x:30,y:60});
  }
  act(()=>mockFlowProps.onNodeDragStop({},initial)); await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').position.x).toBe(790);
  act(()=>root.unmount()); root=createRoot(container); mount(); await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').position.x).toBe(790);
  expect(mockNodes.find(node=>node.id==='g:vehicle').style.width).toBe(1228);
});

test('shrinking a system pushes its subsystem as a unit and supports undo, redo and reload', async () => {
  localStorage.setItem(`${key}:groups:v1`,JSON.stringify([
    {id:'g:vehicle',elementType:'system',label:'Vehicle',position:{x:100,y:100},width:1000,height:750},
    {id:'g:planning',label:'Planning',parentNode:'g:vehicle',position:{x:500,y:400},width:420,height:280},
  ]));
  mount(); await tick();
  const system=mockNodes.find(node=>node.id==='g:vehicle');
  act(()=>system.data.onResizeStart({x:100,y:100,width:1000,height:750}));
  act(()=>system.data.onResizeEnd({x:100,y:100,width:700,height:500})); await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').position).toEqual({x:262,y:202});
  expect(mockNodes.find(node=>node.id==='n:Plan').position).toEqual({x:30,y:60});
  act(()=>container.querySelector('button[title="Undo last diagram change"]').click()); await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').position).toEqual({x:500,y:400});
  act(()=>container.querySelector('button[title="Redo diagram change"]').click()); await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').position).toEqual({x:262,y:202});
  act(()=>root.unmount()); root=createRoot(container); mount(); await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').position).toEqual({x:262,y:202});
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

test.each(['manual','auto','nested'])('generated %s subsystem description saves immediately, survives arrangement and reload, and supports undo', async kind => {
  const categories={source:'table-subsystems',categories:[{name:'Planning',functions:['Plan','Control']}]};
  if(kind==='auto')localStorage.removeItem(`${key}:groups:v1`);
  if(kind==='nested'){
    const groups=JSON.parse(localStorage.getItem(`${key}:groups:v1`));
    groups[0].parentNode='g:system';
    groups.push({id:'g:system',elementType:'system',label:'Vehicle',position:{x:0,y:0},width:900,height:700});
    localStorage.setItem(`${key}:groups:v1`,JSON.stringify(groups));
  }
  const render=()=>act(()=>root.render(<Diagram rows={rows} storageKey={key} autoCategories={kind==='auto'?categories:undefined}/>));
  render();await tick();
  const target=mockNodes.find(node=>node.type==='groupBox'&&node.data.label==='Planning');
  const previous=target.data.description;
  const fetch=global.fetch;
  global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:'Persisted magic description'}}]})});
  try{
    act(()=>mockFlowProps.onNodeDoubleClick({preventDefault(){},stopPropagation(){}},target));
    await act(async()=>container.querySelector('button[aria-label="Regenerate description with AI"]').click());
    clickText('Save');
    const stored=()=>JSON.parse(localStorage.getItem(`${key}:groups:v1`)).find(box=>box.id===target.id);
    // No timer advance: explicit Save must already be durable.
    expect(stored()).toMatchObject({description:'Persisted magic description',descriptionUserEdited:true});
    act(()=>container.querySelector('button[title="Undo last diagram change"]').click());await tick();
    expect(stored().description).toBe(previous);
    act(()=>container.querySelector('button[title="Redo diagram change"]').click());await tick();
    expect(stored().description).toBe('Persisted magic description');
    act(()=>container.querySelector('button[title="Auto arrange"]').click());await tick();
    expect(stored()).toMatchObject({description:'Persisted magic description',descriptionUserEdited:true});
    act(()=>root.unmount());root=createRoot(container);render();await tick();
    expect(mockNodes.find(node=>node.id===target.id).data.description).toBe('Persisted magic description');
  }finally{global.fetch=fetch;}
});

test.each(['throw','swallow'])('failed group Save (%s) retains the draft and supports retry without changing the saved node', async failure => {
  mount();await tick();
  const target=mockNodes.find(node=>node.id==='g:planning');
  act(()=>mockFlowProps.onNodeDoubleClick({preventDefault(){},stopPropagation(){}},target));
  const fetch=global.fetch;
  global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:'Keep this draft'}}]})});
  const set=Storage.prototype.setItem;
  let spy;
  try{
    await act(async()=>container.querySelector('button[aria-label="Regenerate description with AI"]').click());
    spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){
      if(k===`${key}:groups:v1`){if(failure==='throw')throw new DOMException('Full','QuotaExceededError');return;}
      return set.call(this,k,v);
    });
    clickText('Save');
    expect(container.querySelector('[role="alert"]').textContent).toContain('Unable to save');
    expect(container.querySelector('textarea').value).toBe('Keep this draft');
    expect(mockNodes.find(node=>node.id===target.id).data.description).toBe(target.data.description);
    expect(JSON.parse(localStorage.getItem(`${key}:groups:v1`)).find(box=>box.id===target.id).description).toBe(target.data.description);
    spy.mockRestore();spy=null;
    clickText('Save');
    expect(container.querySelector('textarea')).toBeNull();
    expect(JSON.parse(localStorage.getItem(`${key}:groups:v1`)).find(box=>box.id===target.id).description).toBe('Keep this draft');
  }finally{spy?.mockRestore();global.fetch=fetch;}
});

test('pending generation blocks Save, Cancel remains available, and late responses cannot replace a reopened draft', async () => {
  mount();await tick();
  const target=mockNodes.find(node=>node.id==='g:planning');
  const open=()=>act(()=>mockFlowProps.onNodeDoubleClick({preventDefault(){},stopPropagation(){}},target));
  const fetch=global.fetch;
  let resolve;
  global.fetch=jest.fn(()=>new Promise(done=>resolve=done));
  try{
    open();
    act(()=>container.querySelector('button[aria-label="Regenerate description with AI"]').click());
    expect([...container.querySelectorAll('button')].find(button=>button.textContent==='Save').disabled).toBe(true);
    clickText('Cancel');open();
    await act(async()=>resolve({ok:true,json:async()=>({choices:[{message:{content:'Stale description'}}]})}));
    expect(container.querySelector('textarea').value).toBe(target.data.description);
    clickText('Cancel');await tick();
    expect(JSON.parse(localStorage.getItem(`${key}:groups:v1`)).find(box=>box.id===target.id).description).toBe(target.data.description);
  }finally{global.fetch=fetch;}
});

test('saved system/subsystem descriptions populate table rows and table edits return to the diagram without a synchronization loop', async () => {
  localStorage.setItem(`${key}:groups:v1`,JSON.stringify([
    {id:'g:vehicle',elementType:'system',label:'Vehicle',description:'Saved vehicle details',descriptionUserEdited:true,position:{x:0,y:0},width:900,height:700},
    {id:'g:planning',label:'Planning',description:'Saved planning details',descriptionUserEdited:true,parentNode:'g:vehicle',position:{x:50,y:80},width:750,height:400},
  ]));
  let current,update;let publications=0;
  function Controlled(){
    const [data,setData]=React.useState([{...rows[0],system:'Vehicle',fromDetails:'Plan details',toDetails:'Control details'}]);
    current=data;update=setData;
    const publish=React.useCallback(next=>{publications++;setData(next);},[]);
    return <Diagram rows={data} onUpdateRows={publish} storageKey={key}/>;
  }
  act(()=>root.render(<Controlled/>));await tick();await tick();
  expect(current[0]).toMatchObject({system:'Vehicle',systemDetails:'Saved vehicle details',subsystemDetails:'Saved planning details',fromDetails:'Plan details'});
  act(()=>update(current.map(row=>({...row,subsystemDetails:'Edited in table'}))));await tick();await tick();
  expect(mockNodes.find(node=>node.id==='g:planning').data.description).toBe('Edited in table');
  expect(current[0].subsystemDetails).toBe('Edited in table');
  expect(publications).toBeLessThan(10);
});

test('edge colors match arrowheads and survive routing, auto arrange, undo/redo, and reload', async () => {
  mount(); await tick();
  const open = () => act(() => mockFlowProps.onEdgeDoubleClick({ preventDefault() {}, stopPropagation() {} }, mockFlowProps.edges[0]));
  const stroke = () => mockFlowProps.edges[0].style.stroke;
  const original = stroke();
  open();
  act(() => container.querySelector('button[aria-label="Choose color #7A37FF"]').click());
  clickText('Cancel');
  expect(stroke()).toBe(original);
  open();
  const picker = container.querySelector('input[aria-label="Custom color"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(picker, '#123456');
    picker.dispatchEvent(new Event('input', { bubbles: true }));
  });
  clickText('Save'); await tick();
  expect(stroke()).toBe('#123456');
  expect(mockFlowProps.edges[0].markerEnd.color).toBe('#123456');
  const clickTitle = title => act(() => container.querySelector(`button[title="${title}"]`).click());
  clickTitle('Undo last diagram change'); await tick();
  expect(stroke()).toBe(original);
  clickTitle('Redo diagram change'); await tick();
  expect(stroke()).toBe('#123456');
  clickTitle('Set all edges to Bezier routing'); await tick();
  expect(stroke()).toBe('#123456');
  clickTitle('Auto arrange'); await tick();
  expect(stroke()).toBe('#123456');
  clickTitle('Clean layout and restore default rectangular bidirectional routing'); await tick();
  expect(stroke()).toBe('#123456');
  act(() => root.unmount()); root = createRoot(container);
  mount(); await tick();
  expect(stroke()).toBe('#123456');
  expect(mockFlowProps.edges[0].markerEnd.color).toBe('#123456');
});

test('coloring a bidirectional bundle colors both arrowheads and its expanded edges', async () => {
  const pairRows = [...rows, { fromFunction: 'Control', controlAction: 'Feedback', toFunction: 'Plan' }];
  act(() => root.render(<Diagram rows={pairRows} storageKey={key} />)); await tick();
  expect(mockFlowProps.edges).toHaveLength(1);
  act(() => mockFlowProps.onEdgeDoubleClick({ preventDefault() {}, stopPropagation() {} }, mockFlowProps.edges[0]));
  act(() => container.querySelector('button[aria-label="Choose color #7A37FF"]').click());
  // Pick a color different from the default purple bundle.
  const buttons = container.querySelectorAll('button[aria-label^="Choose color"]');
  act(() => buttons[2].click());
  const chosen = buttons[2].getAttribute('aria-label').replace('Choose color ', '');
  clickText('Save'); await tick();
  expect(mockFlowProps.edges[0].style.stroke).toBe(chosen);
  expect(mockFlowProps.edges[0].markerStart.color).toBe(chosen);
  expect(mockFlowProps.edges[0].markerEnd.color).toBe(chosen);
  act(() => container.querySelector('button[title="Expand all bidirectional bundles"]').click()); await tick();
  expect(mockFlowProps.edges).toHaveLength(2);
  mockFlowProps.edges.forEach(edge => {
    expect(edge.style.stroke).toBe(chosen);
    expect(edge.markerEnd.color).toBe(chosen);
  });
});
