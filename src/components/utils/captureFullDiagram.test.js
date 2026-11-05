import { toPng } from 'html-to-image';
import { captureFullDiagram, diagramCaptureGeometry, fullDiagramBounds,
  REPORT_CAPTURE_MAX_PIXELS, REPORT_CAPTURE_MAX_SIDE } from './captureFullDiagram';

jest.mock('html-to-image', () => ({ toPng: jest.fn(async () => 'data:image/png;base64,fixture') }));

const rect = (x, y, width, height) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height });
function fixture(zoom = 2, panX = 100, panY = 60) {
  const host = document.createElement('div');
  host.innerHTML = '<div class="react-flow"><div class="react-flow__viewport" style="transform: translate(100px, 60px) scale(2)"><div class="react-flow__node"></div><div class="react-flow__node"></div><svg><path class="react-flow__edge-path"></path></svg><div class="react-flow__edgelabel-renderer"><div>Label</div></div></div></div>';
  const viewport = host.querySelector('.react-flow__viewport');
  viewport.getBoundingClientRect = () => rect(panX, panY, 300 * zoom, 200 * zoom);
  const worldRects = [rect(-500, -300, 100, 80), rect(1500, 1000, 100, 80), rect(-600, -400, 2300, 1600), rect(1800, 900, 100, 60)];
  [...viewport.querySelectorAll('.react-flow__node, .react-flow__edge-path, .react-flow__edgelabel-renderer > *')].forEach((element, index) => {
    const r = worldRects[index];
    element.getBoundingClientRect = () => rect(panX + r.left * zoom, panY + r.top * zoom, r.width * zoom, r.height * zoom);
  });
  return { host, viewport, flow: host.querySelector('.react-flow') };
}

beforeEach(() => {
  jest.clearAllMocks();
  toPng.mockResolvedValue('data:image/png;base64,fixture');
});

test.each([[2, 100, 60], [0.15, -5000, 2000], [1, 0, 0]])('full bounds include offscreen nodes, edge bends, and labels independently of pan/zoom', (zoom, x, y) => {
  const { viewport } = fixture(zoom, x, y);
  const bounds = fullDiagramBounds(viewport, zoom);
  expect(bounds.x).toBeCloseTo(-600);
  expect(bounds.y).toBeCloseTo(-400);
  expect(bounds.width).toBeCloseTo(2500);
  expect(bounds.height).toBeCloseTo(1600);
});

test('captures the scene clone at full bounds without changing the live viewport', async () => {
  const { host, flow, viewport } = fixture();
  const before = host.outerHTML;
  await expect(captureFullDiagram(flow, 2)).resolves.toBe('data:image/png;base64,fixture');
  expect(toPng).toHaveBeenCalledWith(viewport, expect.objectContaining({
    width: 2580, height: 1680, pixelRatio: 1,
    style: expect.objectContaining({ transform: 'translate(640px, 440px) scale(1)', transformOrigin: '0 0' }),
  }));
  expect(host.outerHTML).toBe(before);
  const options = toPng.mock.calls[0][1];
  expect(options.filter({ classList: { contains: (name) => name === 'react-flow__selection' } })).toBe(false);
});

test.each([[100000, 100000], [1000000, 100], [200, 1000000], [4999, 4444]])('bounds the raster for a %s by %s graph and fits every side after integer rounding', (width, height) => {
  const bounds = { x: -200, y: -100, width, height };
  const result = diagramCaptureGeometry(bounds);
  expect(result.width).toBeLessThanOrEqual(REPORT_CAPTURE_MAX_SIDE);
  expect(result.height).toBeLessThanOrEqual(REPORT_CAPTURE_MAX_SIDE);
  expect(result.width * result.height).toBeLessThanOrEqual(REPORT_CAPTURE_MAX_PIXELS);
  const [, tx, ty, scale] = result.transform.match(/translate\((.*)px, (.*)px\) scale\((.*)\)/).map(Number);
  expect(bounds.x * scale + tx).toBeGreaterThanOrEqual(0);
  expect(bounds.y * scale + ty).toBeGreaterThanOrEqual(0);
  expect((bounds.x + bounds.width) * scale + tx).toBeLessThanOrEqual(result.width);
  expect((bounds.y + bounds.height) * scale + ty).toBeLessThanOrEqual(result.height);
});

test('returns no image for an empty, missing, or invalid scene rather than a clipped viewport screenshot', async () => {
  expect(fullDiagramBounds(null, 1)).toBeNull();
  const empty = document.createElement('div');
  expect(fullDiagramBounds(empty, 0)).toBeNull();
  expect(fullDiagramBounds(empty, 1)).toBeNull();
  await expect(captureFullDiagram(empty, 1)).resolves.toBeNull();
  expect(toPng).not.toHaveBeenCalled();
});

test('ignores unmeasured hidden elements and still includes horizontal or vertical edges', () => {
  const { viewport } = fixture();
  viewport.querySelector('.react-flow__node').getBoundingClientRect = () => rect(0, 0, 0, 0);
  viewport.querySelector('path').getBoundingClientRect = () => rect(-1500, 200, 0, 2000);
  const bounds = fullDiagramBounds(viewport, 2);
  expect(bounds.x).toBe(-800);
  expect(bounds.width).toBe(2700);
});
