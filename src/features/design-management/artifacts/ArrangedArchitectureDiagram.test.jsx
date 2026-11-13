import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import ArrangedArchitectureDiagram from './ArrangedArchitectureDiagram';
import { loadArchitecturePresentation, saveArchitecturePresentation } from './architecturePresentation';

let mockCanvasProps;
let mockMounts = 0;
jest.mock('./NativeCodeArchitectureDiagram', () => {
  const React = require('react');
  return React.forwardRef((props, ref) => {
    mockCanvasProps = props;
    React.useEffect(() => { mockMounts += 1; }, []);
    React.useImperativeHandle(ref, () => ({ flushPresentation() {} }));
    return <div>Canvas</div>;
  });
});
jest.mock('./NativeArchitectureDiagram', () => () => null);
jest.mock('./architecturePresentation', () => ({ loadArchitecturePresentation: jest.fn(), saveArchitecturePresentation: jest.fn() }));

let root, host, ref;
const diagram = { id: 'diagram', diagramHash: 'snapshot', workspaceType: 'code-architecture', snapshot: { nodes: [{ id: 'one', position: { x: 24, y: 60 } }] } };
const saved = {
  geometry: { one: { position: { x: 999, y: 999 } } }, routing: { mode: 'bezier' },
  storage: { '': { one: { position: { x: 999, y: 999 } } }, ':groups:v1': [{ id: 'group' }], ':element-sizes:v1': { one: { width: 999 } }, ':edge-routing:v1': { mode: 'bezier' }, ':comments:v1': ['Keep this comment'], ':manual:v1': ['Keep this note'], ':edge-aggregation:v1': { aggregateAll: false } },
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockMounts = 0;
  loadArchitecturePresentation.mockResolvedValue(saved);
  saveArchitecturePresentation.mockResolvedValue();
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host); ref = createRef();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.clearAllMocks(); });
const mount = () => act(async () => root.render(<ArrangedArchitectureDiagram ref={ref} artifactId="artifact" diagram={diagram} />));

test('opening preserves manual arrangements; explicit restore clears geometry but retains notes and preferences', async () => {
  await mount();
  expect(mockCanvasProps.diagram.presentation).toEqual(saved);
  expect(saveArchitecturePresentation).not.toHaveBeenCalled();
  const oldChange = mockCanvasProps.onPresentationChange;
  await act(async () => ref.current.restoreSourceLayout());
  const restored = { storage: { ':comments:v1': ['Keep this comment'], ':manual:v1': ['Keep this note'], ':edge-aggregation:v1': { aggregateAll: false } } };
  expect(saveArchitecturePresentation).toHaveBeenLastCalledWith('artifact', diagram, restored);
  expect(mockCanvasProps.diagram.presentation).toEqual(restored);
  expect(mockMounts).toBe(2);
  expect(diagram.snapshot.nodes[0].position).toEqual({ x: 24, y: 60 });
  await act(async () => { oldChange(saved); await ref.current.flush(); });
  expect(saveArchitecturePresentation).toHaveBeenCalledTimes(1);
});

test('restore flushes unsaved notes before resetting the layout', async () => {
  await mount();
  const changed = { ...saved, storage: { ...saved.storage, ':comments:v1': ['New comment'] } };
  await act(async () => { mockCanvasProps.onPresentationChange(changed); await ref.current.restoreSourceLayout(); });
  expect(saveArchitecturePresentation.mock.calls[0][2]).toEqual(changed);
  expect(saveArchitecturePresentation.mock.calls[1][2].storage[':comments:v1']).toEqual(['New comment']);
  expect(saveArchitecturePresentation.mock.calls[1][2].storage['']).toBeUndefined();
});

test('a failed restore retains the arrangement and can be retried', async () => {
  await mount();
  saveArchitecturePresentation.mockRejectedValueOnce(new Error('Storage unavailable'));
  await act(async () => { await expect(ref.current.restoreSourceLayout()).rejects.toThrow('Storage unavailable'); });
  expect(mockCanvasProps.diagram.presentation).toEqual(saved);
  expect(mockMounts).toBe(1);
  expect(host.textContent).toContain('Could not restore source layout');
  await act(async () => ref.current.restoreSourceLayout());
  expect(mockMounts).toBe(2);
  expect(host.textContent).toContain('Source layout restored');
});
