import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvertReportDiagram } from './ReportGraphicalDiagram';
import { generateGraphicalReportDiagram } from './generateAgenticReport';
jest.mock('./generateAgenticReport', () => ({ generateGraphicalReportDiagram: jest.fn() }));

const graph = { title: 'Vehicle control', direction: 'TB', notes: [], nodes: [{ id: 'a', label: 'QIBUS' }, { id: 'b', label: 'ATOMS DBW' }], edges: [{ from: 'a', to: 'b', label: 'Control request' }] };
let root, container;
const flush = async () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  generateGraphicalReportDiagram.mockResolvedValue(graph);
});
afterEach(() => { if (root) act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('converts only after the user clicks and passes the graph to saved-version handling', async () => {
  const saved = jest.fn().mockResolvedValue();
  act(() => root.render(<ConvertReportDiagram source="Saved ASCII diagram" onConverted={saved} />));
  expect(generateGraphicalReportDiagram).not.toHaveBeenCalled();
  act(() => container.querySelector('button').click()); await flush();
  expect(generateGraphicalReportDiagram).toHaveBeenCalledWith('Saved ASCII diagram', expect.objectContaining({ signal: expect.any(Object) }));
  expect(container.querySelector('svg[role="img"]')).toBeTruthy();
  expect(container.querySelectorAll('polyline')).toHaveLength(1);
  expect(saved).toHaveBeenCalledWith(graph);
});

test('save failures keep the rendered graph and retry saving without another AI call', async () => {
  const saved = jest.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue();
  act(() => root.render(<ConvertReportDiagram source="Saved ASCII diagram" onConverted={saved} />));
  act(() => container.querySelector('button').click()); await flush();
  expect(container.querySelector('svg')).toBeTruthy();
  expect(container.querySelector('[role="alert"]').textContent).toContain('saved report version could not be created');
  act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry').click()); await flush();
  expect(saved).toHaveBeenCalledTimes(2);
  expect(generateGraphicalReportDiagram).toHaveBeenCalledTimes(1);
});

test('unmounting cancels an outstanding conversion and does not save a late result', async () => {
  let finish;
  generateGraphicalReportDiagram.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const saved = jest.fn();
  act(() => root.render(<ConvertReportDiagram source="Saved ASCII diagram" onConverted={saved} />));
  act(() => container.querySelector('button').click()); await flush();
  const signal = generateGraphicalReportDiagram.mock.calls[0][1].signal;
  act(() => root.unmount()); root = null;
  expect(signal.aborted).toBe(true);
  await act(async () => finish(graph));
  expect(saved).not.toHaveBeenCalled();
});
