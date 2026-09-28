import { initialDiagramLayoutPending, readDiagramViewport } from './functionalDiagramInitialization';
beforeEach(() => localStorage.clear());
test('seed positions do not complete a pending first layout', () => {
  expect(initialDiagramLayoutPending(localStorage, 'new', false)).toBe(true);
  expect(initialDiagramLayoutPending(localStorage, 'new', true)).toBe(true);
  localStorage.setItem('new:initial-layout:v1', 'complete');
  expect(initialDiagramLayoutPending(localStorage, 'new', true)).toBe(false);
});
test('legacy saved layouts are preserved', () => {
  expect(initialDiagramLayoutPending(localStorage, 'old', true)).toBe(false);
});
test('restores valid viewport and rejects corrupt values', () => {
  localStorage.setItem('d:viewport:v1', JSON.stringify({ x: 123, y: -45, zoom: 0.6 }));
  expect(readDiagramViewport(localStorage, 'd')).toEqual({ x: 123, y: -45, zoom: 0.6 });
  localStorage.setItem('d:viewport:v1', '{"zoom":0}');
  expect(readDiagramViewport(localStorage, 'd')).toBeNull();
});
