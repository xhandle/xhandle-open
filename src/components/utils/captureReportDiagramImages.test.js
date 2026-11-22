import { captureReportDiagramImages } from './captureReportDiagramImages';
import { captureFullDiagram } from './captureFullDiagram';
jest.mock('./captureFullDiagram', () => ({ captureFullDiagram: jest.fn() }));

let flow;
beforeEach(() => {
  document.documentElement.classList.add('dark');
  flow = document.createElement('div'); flow.className = 'react-flow';
  flow.innerHTML = '<div class="react-flow__viewport" style="transform:translate(10px,20px) scale(0.5)"><div class="react-flow__node" style="background:#e04090">Saved node</div></div>';
  document.body.append(flow);
  captureFullDiagram.mockReset().mockImplementation(async scene => `data:image/png;base64,${scene.ownerDocument.documentElement.classList.contains('dark') ? 'ZGFyaw==' : 'bGlnaHQ='}`);
});
afterEach(() => { flow.remove(); document.documentElement.classList.remove('dark'); });

test('captures both appearances from one inert clone without modifying the live graph, theme or preference', async () => {
  const before = flow.outerHTML, preference = localStorage.getItem('xhandle.darkMode');
  const result = await captureReportDiagramImages(flow, .5);
  expect(result).toEqual({ light: 'data:image/png;base64,bGlnaHQ=', dark: 'data:image/png;base64,ZGFyaw==' });
  expect(captureFullDiagram).toHaveBeenCalledTimes(2);
  const scene = captureFullDiagram.mock.calls[0][0];
  expect(captureFullDiagram.mock.calls[1][0]).toBe(scene);
  expect(scene.querySelector('.react-flow__node').style.backgroundColor).toBe('rgb(224, 64, 144)');
  expect(flow.outerHTML).toBe(before);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('xhandle.darkMode')).toBe(preference);
  expect(document.querySelector('iframe[title="Report diagram capture"]')).toBeNull();
});

test('always removes the isolated document after a capture failure', async () => {
  captureFullDiagram.mockRejectedValueOnce(new Error('capture failed'));
  await expect(captureReportDiagramImages(flow, .5)).rejects.toThrow('capture failed');
  expect(document.querySelector('iframe[title="Report diagram capture"]')).toBeNull();
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('does not publish an unstyled image pair when a capture stylesheet fails', async () => {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/missing-capture.css'; document.head.append(link);
  try {
    const pending = captureReportDiagramImages(flow, 1);
    const doc = document.querySelector('iframe[title="Report diagram capture"]').contentDocument;
    doc.querySelector('link').dispatchEvent(new doc.defaultView.Event('error'));
    await expect(pending).rejects.toThrow('styles could not be loaded');
    expect(captureFullDiagram).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[title="Report diagram capture"]')).toBeNull();
  } finally { link.remove(); }
});

test('returns no pair for an empty scene or incomplete raster capture', async () => {
  await expect(captureReportDiagramImages(null, 1)).resolves.toBeNull();
  captureFullDiagram.mockResolvedValueOnce(null);
  await expect(captureReportDiagramImages(flow, 1)).resolves.toBeNull();
});
