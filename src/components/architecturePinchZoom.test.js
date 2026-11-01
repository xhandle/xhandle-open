import { createArchitecturePinchZoom, PINCH_ANIMATING } from './architecturePinchZoom';

class Camera {
  constructor(x = 0, y = 0, k = .05) { Object.assign(this, { x, y, k }); }
  translate(x, y) { return new Camera(this.x + x * this.k, this.y + y * this.k, this.k); }
  scale(k) { return new Camera(this.x, this.y, this.k * k); }
}
let host, renderer, camera, state, cleanup, frames, listeners, time, writes;
const advance = (ms = 16.7) => {
  time += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time));
};
const settle = () => { for (let i = 0; frames.size && i < 20; i++) advance(); expect(frames.size).toBe(0); };
const pinch = (factor, x = 300, y = 200, options = {}) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -Math.log2(factor) / .02, clientX: x, clientY: y, ...options });
  renderer.dispatchEvent(event); return event;
};
const publish = next => { camera = next; state = { ...state, transform: [next.x, next.y, next.k] }; listeners.forEach(listener => listener(state)); };
beforeEach(() => {
  frames = new Map(); listeners = new Set(); time = 0; writes = []; let id = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => frames.delete(key));
  host = document.createElement('div'); renderer = document.createElement('div'); host.append(renderer); document.body.append(host);
  renderer.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
  camera = new Camera();
  const selection = { node: () => renderer, property: () => camera };
  let extent = () => [[0, 0], [800, 600]];
  state = { transform: [camera.x, camera.y, camera.k], d3Selection: selection, d3Zoom: {
    wheelDelta: () => event => -event.deltaY * .02, scaleExtent: () => [.02, 1.8],
    extent: value => { if (value !== undefined) extent = typeof value === 'function' ? value : () => value; return extent; }, translateExtent: () => [[-Infinity, -Infinity], [Infinity, Infinity]],
    constrain: () => value => value,
    transform: (_selection, next, anchor, event) => { state.d3Zoom.extent().call(renderer); writes.push({ camera: next, anchor, event }); publish(next); },
  } };
  cleanup = createArchitecturePinchZoom(host, { getState: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } });
});
afterEach(() => { cleanup(); host.remove(); jest.restoreAllMocks(); });

test('a large overview pinch paints intermediate scales with a fixed cursor anchor', () => {
  const original = camera, anchor = [290, 180];
  expect(pinch(1.8).defaultPrevented).toBe(true);
  expect(host.hasAttribute(PINCH_ANIMATING)).toBe(true);
  advance(); expect(camera.k).toBeGreaterThan(original.k); expect(camera.k).toBeLessThan(original.k * 1.8);
  settle(); expect(writes.length).toBeGreaterThanOrEqual(5); expect(camera.k).toBeCloseTo(original.k * 1.8, 12);
  expect(host.hasAttribute(PINCH_ANIMATING)).toBe(false);
  for (const { camera: next } of writes) {
    expect((anchor[0] - original.x) / original.k * next.k + next.x).toBeCloseTo(anchor[0], 10);
    expect((anchor[1] - original.y) / original.k * next.k + next.y).toBeCloseTo(anchor[1], 10);
  }
});
test('a stalled first frame does not skip all intermediate scales', () => {
  pinch(2); advance(500); expect(camera.k).toBeLessThan(.1);
  advance(500); expect(camera.k).toBeLessThan(.1); settle(); expect(camera.k).toBeCloseTo(.1, 12);
});
test('animation reuses the measured viewport and restores the native extent accessor', () => {
  const extent = jest.fn(() => [[0, 0], [800, 600]]); state.d3Zoom.extent(extent);
  pinch(2); settle();
  expect(extent).toHaveBeenCalledTimes(1); expect(state.d3Zoom.extent()).toBe(extent);
});
test('small inputs coalesce into one frame without losing their total scale', () => {
  pinch(1.01); pinch(1.01); pinch(1.01);
  expect(frames.size).toBe(1); advance(); expect(frames.size).toBe(0);
  expect(writes).toHaveLength(1); expect(camera.k).toBeCloseTo(.05 * 1.01 ** 3, 12);
});
test('accumulated small inputs that would visibly jump are smoothed', () => {
  for (let i = 0; i < 10; i++) pinch(1.02);
  advance(); expect(camera.k).toBeLessThan(.05 * 1.02 ** 10); settle(); expect(camera.k).toBeCloseTo(.05 * 1.02 ** 10, 12);
});
test('reversing an unfinished pinch retains every delta and returns to the original camera', () => {
  const original = camera; pinch(2); advance(); pinch(.5); settle();
  expect(camera.k).toBeCloseTo(original.k, 12); expect(camera.x).toBeCloseTo(original.x, 10); expect(camera.y).toBeCloseTo(original.y, 10);
});
test('changing the cursor between inputs preserves the requested final camera', () => {
  pinch(2, 300, 200); advance(); pinch(1.2, 400, 300); settle();
  expect(camera.k).toBeCloseTo(.12, 12);
  expect(camera.x).toBeCloseTo(390 - (390 + 290) * 1.2, 10);
  expect(camera.y).toBeCloseTo(280 - (280 + 180) * 1.2, 10);
});
test('zoom clamps to the existing limits', () => {
  pinch(.1); settle(); expect(camera.k).toBe(.02);
  pinch(1000); settle(); expect(camera.k).toBe(1.8);
});
test.each(['pan', 'pointer', 'keyboard', 'external', 'dispose'])('%s cancels pending zoom without moving afterward', reason => {
  pinch(2); advance(); const before = camera;
  if (reason === 'pan') expect(pinch(1.1, 300, 200, { ctrlKey: false }).defaultPrevented).toBe(false);
  if (reason === 'pointer') renderer.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  if (reason === 'keyboard') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  if (reason === 'external') publish(new Camera(25, 30, 1));
  if (reason === 'dispose') cleanup();
  advance(500); expect(camera).toEqual(reason === 'external' ? new Camera(25, 30, 1) : before); expect(frames.size).toBe(0);
  expect(host.hasAttribute(PINCH_ANIMATING)).toBe(false);
});
test.each(['blur', 'resize', 'visibilitychange', 'container-resize'])('%s preserves queued pinch deltas through a reversal', reason => {
  const original = camera; pinch(2); advance();
  if (reason === 'container-resize') { state = { ...state, width: 810, height: 610 }; listeners.forEach(listener => listener(state)); }
  else if (reason === 'visibilitychange') document.dispatchEvent(new Event(reason));
  else window.dispatchEvent(new Event(reason));
  pinch(.5); settle();
  expect(camera.k).toBeCloseTo(original.k, 12); expect(camera.x).toBeCloseTo(original.x, 10); expect(camera.y).toBeCloseTo(original.y, 10);
  expect(host.hasAttribute(PINCH_ANIMATING)).toBe(false);
});
test('close zoom and nowheel controls retain native handling', () => {
  publish(new Camera(0, 0, 1)); expect(pinch(1.2).defaultPrevented).toBe(false); expect(frames.size).toBe(0);
  publish(new Camera()); renderer.className = 'nowheel'; expect(pinch(1.2).defaultPrevented).toBe(false); expect(frames.size).toBe(0);
});
test('respects reduced-motion preference', () => {
  cleanup(); const old = window.matchMedia; window.matchMedia = () => ({ matches: true });
  try {
    cleanup = createArchitecturePinchZoom(host, { getState: () => state, subscribe: () => () => {} });
    pinch(2); advance(); expect(camera.k).toBe(.1); expect(frames.size).toBe(0);
  } finally { window.matchMedia = old; }
});
