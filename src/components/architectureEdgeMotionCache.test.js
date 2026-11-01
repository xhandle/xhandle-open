import { cameraBounds, alignImageBounds, imageFitsCamera, localPaintReference, createArchitectureEdgeMotionCache, vectorMarkupForBounds, EDGE_IMAGE_LIMITS, EDGE_IMAGE_ACTIVE } from './architectureEdgeMotionCache';

test('overview crops align to device pixels without clipping native geometry', () => {
  const source = { x: -94.0003, y: -86.0001, width: 12541.005, height: 4192 };
  const camera = cameraBounds([200.17, 30.11, .0820707], 1131, 652);
  const image = alignImageBounds(source, camera, .0820707, 2), scale = .0820707 * 2;
  expect(image.bounds.x).toBeLessThanOrEqual(source.x);
  expect(image.bounds.y).toBeLessThanOrEqual(source.y);
  expect(image.bounds.x + image.bounds.width).toBeGreaterThanOrEqual(source.x + source.width);
  expect(image.bounds.y + image.bounds.height).toBeGreaterThanOrEqual(source.y + source.height);
  expect((image.bounds.x - camera.x) * scale).toBeCloseTo(Math.round((image.bounds.x - camera.x) * scale), 8);
  expect(image.bounds.width * scale).toBeCloseTo(image.width, 8);
  expect(image.bounds.height * scale).toBeCloseTo(image.height, 8);
});

test('cached crops preserve crossing paths and paint order, excluding only wholly offscreen paint', () => {
  const entries = [
    { bounds: { x: -1000, y: 30, width: 3000, height: 20 }, markup: '<path id="crossing" />' },
    { bounds: { x: 500, y: 500, width: 20, height: 20 }, markup: '<path id="outside" />' },
    { bounds: { x: 10, y: 10, width: 20, height: 20 }, markup: '<path id="near" />' },
  ];
  expect(vectorMarkupForBounds({ definitions: '<defs/>', prefix: '<g>', entries }, { x: 0, y: 0, width: 100, height: 100 }))
    .toBe('<defs/><g><path id="crossing" /><path id="near" /></g>');
});

test('coverage includes a crossing connection even when its endpoints are offscreen', () => {
  const image = { bounds: { x: 10, y: 10, width: 200, height: 200 }, scene: { x: -5000, y: 50, width: 10000, height: 20 } };
  expect(imageFitsCamera(image, { x: 30, y: 30, width: 100, height: 100 }, 1, 2)).toBe(true);
  expect(imageFitsCamera(image, { x: 190, y: 30, width: 100, height: 100 }, 1, 2)).toBe(false);
  // Blank camera space beyond the graph does not require painting more pixels.
  expect(imageFitsCamera(image, { x: 30, y: -1000, width: 100, height: 1020 }, 1, 2)).toBe(true);
  expect(cameraBounds([10, 20, .5], 100, 200)).toEqual({ x: -20, y: -40, width: 200, height: 400 });
});

test('zoom and device-pixel-ratio cannot grow a cache beyond its raster budget', () => {
  const bounds = { x: 0, y: 0, width: 4000, height: 4000 }, image = { bounds, scene: bounds };
  expect(imageFitsCamera(image, bounds, 1, 1)).toBe(true);
  expect(imageFitsCamera(image, bounds, 1, 2)).toBe(false);
  expect(imageFitsCamera(image, bounds, 3, 1)).toBe(false);
  expect(EDGE_IMAGE_LIMITS.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
});

test('marker references preserve punctuation in React Flow marker IDs', () => {
  expect(localPaintReference('url("http://localhost/#color=rgba(45, 125, 254, 0.92)&type=arrowclosed")')).toBe('url("#color=rgba(45, 125, 254, 0.92)&type=arrowclosed")');
  expect(localPaintReference('url(#marker)')).toBe('url("#marker")');
  expect(localPaintReference('url("http://localhost/#")')).toBe('none');
  expect(localPaintReference("url('#')")).toBe('none');
  expect(() => localPaintReference('url(https://external.invalid/image)')).toThrow();
});

describe('optional motion image lifecycle', () => {
  let host, svg, group, path, store, current, subscribers, cleanup, oldURL, oldRevoke, oldBBox;
  const tick = async (ms = 1) => { jest.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); };
  const load = async () => {
    for (let i = 0; i < 10 && !host.querySelector('.x-edge-motion-image'); i++) await tick();
    const image = host.querySelector('.x-edge-motion-image'); expect(image).not.toBeNull();
    image.dispatchEvent(new Event('load')); await tick(); return image;
  };
  const move = async transform => { current = { ...current, transform }; subscribers.forEach(listener => listener(current)); await tick(); };
  beforeEach(() => {
    jest.useFakeTimers();
    oldURL = URL.createObjectURL; oldRevoke = URL.revokeObjectURL; oldBBox = SVGElement.prototype.getBBox;
    URL.createObjectURL = jest.fn(() => `blob:test-${URL.createObjectURL.mock.calls.length}`);
    URL.revokeObjectURL = jest.fn();
    SVGElement.prototype.getBBox = () => ({ x: -1000, y: 20, width: 3000, height: 40 });
    host = document.createElement('div'); host.className = 'x-csu-large x-architecture-motion';
    host.innerHTML = '<svg class="react-flow__edges"><g><g class="react-flow__edge selectable"><path class="react-flow__edge-path" d="M -1000,30 L 2000,30" style="fill:none;stroke:blue;stroke-width:2"/><path class="react-flow__edge-interaction" d="M -1000,30 L 2000,30" stroke-opacity="0"/></g></g></svg>';
    document.body.append(host); svg = host.querySelector('svg'); group = svg.querySelector('g'); path = group.querySelector('path');
    current = { transform: [0, 0, 1], width: 100, height: 100 }; subscribers = new Set();
    store = { getState: () => current, subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); } };
    cleanup = createArchitectureEdgeMotionCache(host, store, { delay: 1 });
  });
  afterEach(() => {
    cleanup(); host.remove(); jest.useRealTimers(); jest.restoreAllMocks();
    URL.createObjectURL = oldURL; URL.revokeObjectURL = oldRevoke; SVGElement.prototype.getBBox = oldBBox;
    document.documentElement.classList.remove('dark');
  });
  test('uses decoded paint only during motion, with exact native path retained', async () => {
    await load();
    expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
    host.setAttribute('data-viewport-moving', ''); await tick();
    expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(true);
    expect(path.getAttribute('d')).toBe('M -1000,30 L 2000,30');
    expect(group.querySelector('.react-flow__edge-interaction')).not.toBeNull();
    host.removeAttribute('data-viewport-moving'); await tick();
    expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
  });
  test('shared image paint preserves distinct colors, geometry and native interaction targets', async () => {
    const edge = group.firstElementChild;
    edge.setAttribute('aria-label', 'Connection description stays on the interactive diagram');
    edge.setAttribute('role', 'group');
    edge.setAttribute('data-id', 'native-connection-id');
    group.appendChild(edge.cloneNode(true));
    const different = edge.cloneNode(true);
    different.querySelector('.react-flow__edge-path').style.stroke = 'red';
    group.appendChild(different);
    const before = group.outerHTML;
    await load();
    const blob = URL.createObjectURL.mock.calls.at(-1)[0];
    // FileReader runs independently of the cache's synthetic timer schedule.
    jest.useRealTimers();
    const xml = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob);
    });
    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelectorAll('style')).toHaveLength(1);
    const sheet = document.createElement('style');
    sheet.textContent = parsed.querySelector('style').textContent;
    document.head.appendChild(sheet);
    try {
      const paints = new Map([...sheet.sheet.cssRules].map(rule => [rule.selectorText, rule.style]));
      const cached = [...parsed.querySelectorAll('g > g > path')];
      expect(cached).toHaveLength(3);
      expect(cached.map(node => node.getAttribute('d'))).toEqual(Array(3).fill(path.getAttribute('d')));
      expect(cached[0].getAttribute('class')).toBe(cached[1].getAttribute('class'));
      expect(cached[0].getAttribute('class')).not.toBe(cached[2].getAttribute('class'));
      expect(cached.map(node => paints.get(`.${node.getAttribute('class')}`).stroke)).toEqual(['blue', 'blue', 'red']);
      expect(parsed.querySelector('g').querySelectorAll('[style]')).toHaveLength(0);
      expect(parsed.querySelectorAll('[aria-label],[role],[data-id]')).toHaveLength(0);
      expect(group.outerHTML).toBe(before);
      expect(group.querySelectorAll('.react-flow__edge-interaction')).toHaveLength(3);
    } finally { sheet.remove(); }
  });
  test('aggregate animated highlights stay native and caching recovers when animation ends', async () => {
    host.classList.remove('x-csu-large');
    path.style.animationName = 'dashdraw';
    for (let i = 0; i < 8; i++) await tick();
    expect(host.getAttribute('data-edge-image-fallback')).toBe('Animated edge paint stays native');
    expect(host.querySelector('.x-edge-motion-image')).toBeNull();
    expect(path.isConnected).toBe(true);
    path.style.animationName = 'none'; await tick();
    await load();
    expect(host.hasAttribute('data-edge-image-fallback')).toBe(false);
  });
  test('detailed highlights retain their existing paused-during-motion behavior', async () => {
    path.style.animationName = 'dashdraw';
    await load();
    expect(host.hasAttribute('data-edge-image-fallback')).toBe(false);
  });
  test('immediately falls back when camera leaves cached coverage or exceeds pixel limits', async () => {
    await load(); host.setAttribute('data-viewport-moving', ''); await tick();
    await move([-800, 0, 1]); expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
    await move([0, 0, 1]); expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(true);
    await move([0, 0, 100]); expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
  });
  test.each(['geometry', 'theme', 'print', 'keyboard', 'pointer'])('%s changes restore native paint', async reason => {
    await load(); host.setAttribute('data-viewport-moving', ''); await tick();
    if (reason === 'geometry') path.setAttribute('d', 'M 1,1 L 200,200');
    if (reason === 'theme') document.documentElement.classList.add('dark');
    if (reason === 'print') window.dispatchEvent(new Event('beforeprint'));
    if (reason === 'keyboard') path.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    if (reason === 'pointer') path.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    await tick(); expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
  });
  test('failed decode leaves the native scene available and releases resources', async () => {
    for (let i = 0; i < 10 && !host.querySelector('.x-edge-motion-image'); i++) await tick();
    host.querySelector('.x-edge-motion-image').dispatchEvent(new Event('error')); await tick();
    expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false); expect(host.querySelector('.x-edge-motion-image')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    await tick(10000); expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  test('prepares new coverage during a long gesture without hiding uncovered native edges', async () => {
    const original = await load(); host.setAttribute('data-viewport-moving', ''); await tick();
    await move([-800, 0, 1]); expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
    await tick(40);
    const next = [...host.querySelectorAll('.x-edge-motion-image')].find(image => image !== original);
    expect(next).toBeTruthy();
    expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
    next.dispatchEvent(new Event('load')); await tick();
    expect(svg.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(true);
    expect(original.isConnected).toBe(false);
    expect(host.querySelectorAll('.x-edge-motion-image')).toHaveLength(1);
  });
  test('retains one overview for zooming back out and releases both images on disposal', async () => {
    current = { ...current, width: 4000, height: 1000 };
    subscribers.forEach(listener => listener(current));
    const overview = await load(); host.setAttribute('data-viewport-moving', ''); await tick();
    await move([0, 0, 10]); await tick(40);
    const crop = [...host.querySelectorAll('.x-edge-motion-image')].find(image => image !== overview);
    expect(crop).toBeTruthy(); crop.dispatchEvent(new Event('load')); await tick();
    expect(host.querySelectorAll('.x-edge-motion-image')).toHaveLength(2);
    expect(crop.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(true);
    await move([0, 0, 1]);
    expect(overview.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(true);
    expect(crop.hasAttribute(EDGE_IMAGE_ACTIVE)).toBe(false);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    cleanup(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  test('unmount cancels a pending decode and unsubscribes without retaining an image', async () => {
    for (let i = 0; i < 10 && !host.querySelector('.x-edge-motion-image'); i++) await tick();
    cleanup(); await tick();
    expect(host.querySelector('.x-edge-motion-image')).toBeNull(); expect(subscribers.size).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
