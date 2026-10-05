import { csuAbsolutePositions, loadCsuEdgeRouting, normalizeCsuEdgeRouting, saveCsuEdgeRouting } from './csuEdgeRouting';

beforeEach(() => localStorage.clear());

test('uses nested container positions for bundle endpoint selection even before React Flow measurements', () => {
  expect(csuAbsolutePositions([
    { id: 'function', parentNode: 'csu', position: { x: 20, y: 50 }, positionAbsolute: { x: 0, y: 0 } },
    { id: 'csc', position: { x: 500, y: 400 } },
    { id: 'csu', parentNode: 'csc', position: { x: 26, y: 58 } },
  ]).get('function')).toEqual({ x: 546, y: 508 });
});

test('round trips function and bundle routes within their diagram scope', () => {
  const state = { defaultStyle: 'bezier', overrides: { call: 'rectangular' }, manualRoutes: {
    call: { model: 'segment-v2', axis: 'x', corridor: -20, sourceOffset: 0, targetOffset: 75 },
    'bundle:a->b': { model: 'segment-v2', axis: 'y', corridor: 300 },
  } };
  saveCsuEdgeRouting('diagram:github:p1:repo', state);
  expect(loadCsuEdgeRouting('diagram:github:p1:repo')).toEqual(state);
  expect(loadCsuEdgeRouting('diagram:github:p2:repo')).toEqual({ defaultStyle: 'rectangular', overrides: {}, manualRoutes: {} });
});

test('rejects invalid persisted coordinates and recovers from malformed storage', () => {
  expect(normalizeCsuEdgeRouting({ defaultStyle: 'bad', overrides: { a: 'bad' }, manualRoutes: {
    a: { axis: 'z', corridor: Infinity, sourceOffset: null, targetOffset: -12 }, b: null,
  } })).toEqual({ defaultStyle: 'rectangular', overrides: {}, manualRoutes: { a: { model: 'segment-v2', targetOffset: -12 } } });
  localStorage.setItem('scope:csu-edge-routing', '{invalid');
  expect(loadCsuEdgeRouting('scope').manualRoutes).toEqual({});
});
