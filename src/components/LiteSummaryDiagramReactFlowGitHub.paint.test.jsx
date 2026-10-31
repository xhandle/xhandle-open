import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'fs';
import { serialize, deserialize } from 'v8';
import Diagram from './LiteSummaryDiagramReactFlowGitHub';
import FunctionalDiagram from './LiteSummaryDiagramReactFlow';

// Exercise the actual CBA component, React Flow edge wrappers/marker definitions,
// and SVG edge components. Only browser geometry/observation is supplied by the
// test: jsdom has no layout engine. Real browser raster cost is measured by the
// production-App diagnostic, not inferred from these DOM checks.
const architecture = csc => ({ subsystem: 'Control', csci: 'Application', csc, csu: `${csc} unit` });
const rows = [
  { fromNodeId: 'paint-a', toNodeId: 'paint-b', edgeId: 'paint-command', fromFunction: 'Plan', toFunction: 'Control', controlAction: 'Command', fromFile: 'plan.cpp', toFile: 'control.cpp', fromArchitecture: architecture('Planning'), toArchitecture: architecture('Execution') },
  { fromNodeId: 'paint-b', toNodeId: 'paint-a', edgeId: 'paint-feedback', fromFunction: 'Control', toFunction: 'Plan', controlAction: 'Feedback', fromFile: 'control.cpp', toFile: 'plan.cpp', fromArchitecture: architecture('Execution'), toArchitecture: architecture('Planning') },
];
const storageKey = 'cba:paint-regression:fixture/repo';
const originalGlobals = { indexedDB: global.indexedDB, structuredClone: global.structuredClone, ResizeObserver: global.ResizeObserver, DOMMatrixReadOnly: window.DOMMatrixReadOnly, getBBox: SVGElement.prototype.getBBox, elementsFromPoint: document.elementsFromPoint };
let host, root, darkStyles, navigationStyles, functionalNavigationStyles;

function bounds(element) {
  const value = (property, fallback) => {
    const css = element.style?.[property] || '';
    return css.endsWith('%') ? fallback : parseFloat(css) || fallback;
  };
  const isHandle = element.classList?.contains('react-flow__handle');
  const isNode = element.classList?.contains('react-flow__node');
  const width = value('width', isHandle ? 10 : isNode ? 240 : 800);
  const height = value('height', isHandle ? 10 : isNode ? 96 : 600);
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
  localStorage.clear();
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); }
    observe(target) {
      this.targets.add(target);
      queueMicrotask(() => {
        if (this.targets.has(target)) this.callback([{ target, contentRect: bounds(target) }]);
      });
    }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  window.DOMMatrixReadOnly = class {
    constructor(transform) { this.m22 = Number(String(transform).match(/scale\(([^)]+)\)/)?.[1]) || 1; }
  };
  SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: this.textContent.length * 7, height: 14 }; };
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () { return bounds(this).width; });
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () { return bounds(this).height; });
  jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function () { return bounds(this).width; });
  jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function () { return bounds(this).height; });
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () { return bounds(this); });
  // Load the real dark edge rule rather than copying a rule that could drift.
  const css = readFileSync(require.resolve('../index.css'), 'utf8');
  const darkRule = css.match(/\.dark \.react-flow__edge-path\s*\{[^}]+\}/)?.[0];
  expect(darkRule).toBeTruthy();
  darkStyles = document.createElement('style');
  darkStyles.textContent = darkRule;
  document.head.appendChild(darkStyles);
  navigationStyles = document.createElement('style');
  navigationStyles.textContent = readFileSync(require.resolve('./csuNavigation.css'), 'utf8');
  document.head.appendChild(navigationStyles);
  functionalNavigationStyles = document.createElement('style');
  functionalNavigationStyles.textContent = readFileSync(require.resolve('./functionalViewportNavigation.css'), 'utf8');
  document.head.appendChild(functionalNavigationStyles);
  host = document.createElement('div');
  host.style.cssText = 'width:800px;height:600px';
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  darkStyles.remove();
  navigationStyles.remove();
  functionalNavigationStyles.remove();
  document.documentElement.classList.remove('dark');
  jest.restoreAllMocks();
  global.indexedDB = originalGlobals.indexedDB;
  global.structuredClone = originalGlobals.structuredClone;
  global.ResizeObserver = originalGlobals.ResizeObserver;
  window.DOMMatrixReadOnly = originalGlobals.DOMMatrixReadOnly;
  if (originalGlobals.getBBox) SVGElement.prototype.getBBox = originalGlobals.getBBox;
  else delete SVGElement.prototype.getBBox;
  if (originalGlobals.elementsFromPoint) document.elementsFromPoint = originalGlobals.elementsFromPoint;
  else delete document.elementsFromPoint;
});

async function mount(abstraction = 'detailed', onOuterDoubleClick, options = {}) {
  const modelRows = options.rows || rows;
  const expectedEdges = options.expectedEdges ?? 2;
  await act(async () => {
    root.render(<div onDoubleClick={onOuterDoubleClick}><Diagram rows={modelRows} storageKey={options.storageKey || storageKey} architectureMode architectureAbstraction={abstraction} preserveLayoutOnMount={options.preserveLayoutOnMount} cleanOnceKey={options.cleanOnceKey} onCleanApplied={options.onCleanApplied} /></div>);
  });
  // IndexedDB and React Flow dimension observation settle asynchronously.
  for (let attempt = 0; attempt < 30 && host.querySelectorAll('.react-flow__edge-path').length !== expectedEdges; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(host.querySelectorAll('.react-flow__edge-path')).toHaveLength(expectedEdges);
}

const paths = () => [...host.querySelectorAll('.react-flow__edge-path')];
const geometry = () => [...host.querySelectorAll('.react-flow__node')].map(node => [node.dataset.id, node.style.transform]).sort();
const paint = path => ({ opacity: Number(getComputedStyle(path).opacity), strokeOpacity: Number(getComputedStyle(path).strokeOpacity) });
const color = value => {
  const channels = String(value).match(/[\d.]+/g)?.map(Number);
  return channels?.length === 3 ? [...channels, 1] : channels;
};
function marker(path, end = 'end') {
  const reference = path.getAttribute(`marker-${end}`);
  const id = reference?.replace(/^url\(['"]?#/, '').replace(/['"]?\)$/, '');
  const definition = document.getElementById(id);
  expect(definition?.tagName.toLowerCase()).toBe('marker');
  const glyph = definition.querySelector('polyline');
  expect(glyph).not.toBeNull();
  expect(color(glyph.style.fill)).toEqual(color(glyph.style.stroke));
  return color(glyph.style.fill);
}
async function click(element) {
  expect(element).not.toBeNull();
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function savePositions(positions) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('xhandle', 4);
    request.onupgradeneeded = () => {
      for (const name of ['code_index', 'copilot_baseline', 'diagram_positions']) {
        request.result.createObjectStore(name, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('diagram_positions', 'readwrite');
      transaction.objectStore('diagram_positions').put({ key: storageKey, value: Object.entries(positions) });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

function absoluteFunctionPositions() {
  // React Flow renders nested nodes at absolute coordinates; the model's
  // node.position is relative to rebuilt architecture containers.
  return Object.fromEntries([...host.querySelectorAll('.react-flow__node-bidirectional')].map(node => {
    const match = node.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    expect(match).not.toBeNull();
    return [node.dataset.id, { x: Number(match[1]), y: Number(match[2]) }];
  }));
}

test('initial CBA reopening restores saved absolute positions while explicit Arrange recomputes the hierarchy', async () => {
  const saved = { 'paint-a': { x: 1380, y: -240 }, 'paint-b': { x: -530, y: 910 } };
  await savePositions(saved);
  const onCleanApplied = jest.fn();
  const options = { preserveLayoutOnMount: true, onCleanApplied, cleanOnceKey: 'initial-reopen' };
  await mount('detailed', undefined, options);
  expect(onCleanApplied).toHaveBeenCalledWith('initial-reopen');
  expect(absoluteFunctionPositions()).toEqual(saved);
  expect(host.querySelectorAll('.react-flow__node-groupBox').length).toBeGreaterThan(0);

  await mount('detailed', undefined, { ...options, cleanOnceKey: 'clean-explicit-arrange' });
  expect(onCleanApplied).toHaveBeenCalledWith('clean-explicit-arrange');
  const arranged = absoluteFunctionPositions();
  expect(Object.keys(arranged).sort()).toEqual(Object.keys(saved).sort());
  for (const [id, position] of Object.entries(arranged)) {
    expect(position).not.toEqual(saved[id]);
    expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
  }
  expect(new Set(paths().map(path => path.closest('.react-flow__edge').dataset.testid))).toEqual(new Set(['rf__edge-paint-command', 'rf__edge-paint-feedback']));
});

test.each([['new', {}], ['partially saved', { 'paint-a': { x: 1380, y: -240 } }]])('%s CBA layouts arrange all nodes when saved position IDs are incomplete', async (_label, saved) => {
  await savePositions(saved);
  const onCleanApplied = jest.fn();
  await mount('detailed', undefined, { preserveLayoutOnMount: true, cleanOnceKey: 'initial-incomplete', onCleanApplied });
  expect(onCleanApplied).toHaveBeenCalledWith('initial-incomplete');
  const positions = absoluteFunctionPositions();
  expect(Object.keys(positions).sort()).toEqual(['paint-a', 'paint-b']);
  for (const position of Object.values(positions)) {
    expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
  }
  expect(positions['paint-a']).not.toEqual({ x: 1380, y: -240 });
  expect(positions['paint-a']).not.toEqual(positions['paint-b']);
});

test('detailed edges keep stroke and arrow alpha without route-wide opacity; selection restores full paint', async () => {
  await mount();
  const before = geometry();
  const beforePaths = paths().map(path => path.getAttribute('d'));
  for (const path of paths()) {
    expect(paint(path)).toEqual({ opacity: 1, strokeOpacity: 0.92 });
    expect(marker(path)).toEqual([45, 125, 254, 0.92]);
  }
  expect(host.textContent).toContain('Command');
  const command = () => host.querySelector('[data-testid="rf__edge-paint-command"] .react-flow__edge-path');
  await click(command());
  expect(paint(command())).toEqual({ opacity: 1, strokeOpacity: 1 });
  expect(marker(command())).toEqual([45, 125, 254, 1]);
  await click(host.querySelector('.react-flow__pane'));
  expect(paint(command())).toEqual({ opacity: 1, strokeOpacity: 0.92 });
  expect(paths().map(path => path.getAttribute('d'))).toEqual(beforePaths);
  expect(geometry()).toEqual(before);
});

test.each(['detailed', 'csc'])('%s paint alpha survives the existing dark-mode stroke override', async abstraction => {
  await mount(abstraction);
  const alpha = abstraction === 'detailed' ? 0.92 : 0.58;
  const before = paths().map(path => path.getAttribute('d'));
  document.documentElement.classList.add('dark');
  const rule = darkStyles.sheet.cssRules[0];
  expect(rule.style.getPropertyPriority('stroke')).toBe('important');
  // The alpha is independent of stroke color, so the real global important
  // color override cannot make an idle compact edge fully opaque.
  for (const path of paths()) {
    expect(paint(path)).toEqual({ opacity: 1, strokeOpacity: alpha });
    expect(path.style.strokeOpacity).toBe(String(alpha));
    expect(marker(path)).toEqual([45, 125, 254, alpha]);
  }
  expect(paths().map(path => path.getAttribute('d'))).toEqual(before);
});

test.each(['detailed', 'csc'])('%s bidirectional aggregation paints both arrowheads at the idle alpha and expands intact', async abstraction => {
  await mount(abstraction);
  const alpha = abstraction === 'detailed' ? 0.92 : 0.58;
  const before = geometry();
  const toggle = host.querySelector('button[aria-label="Toggle all bidirectional edge bundles"]');
  await click(toggle);
  expect(paths()).toHaveLength(1);
  const bundle = paths()[0];
  expect(paint(bundle)).toEqual({ opacity: 1, strokeOpacity: alpha });
  expect(marker(bundle, 'start')).toEqual([122, 55, 255, alpha]);
  expect(marker(bundle, 'end')).toEqual([122, 55, 255, alpha]);
  await click(toggle);
  expect(paths()).toHaveLength(2);
  expect(geometry()).toEqual(before);
  for (const path of paths()) expect(marker(path)).toEqual([45, 125, 254, alpha]);
});

test.each(['wrapper', 'content'])('double-clicking function %s opens its details above an underlying edge and stops at the diagram', async targetKind => {
  const onOuterDoubleClick = jest.fn();
  await mount('detailed', onOuterDoubleClick);
  const node = host.querySelector('[data-testid="rf__node-paint-a"]');
  const target = targetKind === 'content' ? node.querySelector('.x-node') : node;
  const underlyingEdge = host.querySelector('[data-testid="rf__edge-paint-command"] .react-flow__edge-path');
  document.elementsFromPoint = jest.fn(() => [target, node, underlyingEdge]);
  await act(async () => {
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }));
  });
  expect(host.querySelector('h3')?.textContent).toBe('Edit Node');
  expect(host.querySelector('input[type="text"]')?.value).toBe('Plan');
  expect(host.textContent).toContain('plan.cpp');
  expect(onOuterDoubleClick).not.toHaveBeenCalled();
});

test('double-clicking an edge still opens that edge and does not reach an outer workspace handler', async () => {
  const onOuterDoubleClick = jest.fn();
  await mount('detailed', onOuterDoubleClick);
  const edge = host.querySelector('[data-testid="rf__edge-paint-command"] .react-flow__edge-path');
  document.elementsFromPoint = jest.fn(() => [edge]);
  await act(async () => {
    edge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }));
  });
  expect(host.querySelector('h3')?.textContent).toBe('Edit Edge');
  expect(host.querySelector('input[type="text"]')?.value).toBe('Command');
  expect(onOuterDoubleClick).not.toHaveBeenCalled();
});

test('large CSU promotion and hidden labels reset on interruption, scope replacement and unmount without retaining listeners', async () => {
  const windowAdd = jest.spyOn(window, 'addEventListener');
  const windowRemove = jest.spyOn(window, 'removeEventListener');
  const documentAdd = jest.spyOn(document, 'addEventListener');
  const documentRemove = jest.spyOn(document, 'removeEventListener');
  const largeRows = Array.from({ length: 500 }, (_, index) => ({ ...rows[index % rows.length], edgeId: `paint-large-${index}`, controlAction: `Command ${index}` }));
  const options = { rows: largeRows, expectedEdges: 500 };
  await mount('detailed', undefined, options);
  const canvas = host.querySelector('.x-csu-large');
  const viewport = canvas.querySelector('.react-flow__viewport');
  const labels = canvas.querySelector('.react-flow__edgelabel-renderer');
  const before = geometry();
  const beforePaths = paths().map(path => path.getAttribute('d'));
  const resetHandlers = () => windowAdd.mock.calls
    .filter(([type, callback]) => type === 'blur'
      && windowAdd.mock.calls.some(([event, handler]) => event === 'pointercancel' && handler === callback)
      && documentAdd.mock.calls.some(([event, handler]) => event === 'visibilitychange' && handler === callback))
    .map(([, callback]) => callback);
  expect(resetHandlers()).toHaveLength(1);
  const firstHandler = resetHandlers()[0];
  const releaseListeners = () => windowAdd.mock.calls.filter(([type, , capture]) => ['mouseup', 'touchend'].includes(type) && capture === true);
  const firstReleaseListeners = releaseListeners();
  expect(firstReleaseListeners).toHaveLength(2);
  const expectIdle = () => {
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
    expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    expect(getComputedStyle(labels).visibility).not.toBe('hidden');
  };
  const markMoving = () => {
    // Trusted D3 move-start/end are covered by the production-App diagnostic.
    // Set the existing presentation boundary to isolate cancellation cleanup.
    canvas.setAttribute('data-viewport-moving', '');
    expect(getComputedStyle(viewport).willChange).toBe('transform');
    expect(getComputedStyle(labels).visibility).toBe('hidden');
  };
  expectIdle();
  for (const [target, type] of [[window, 'blur'], [window, 'pointercancel'], [document, 'visibilitychange']]) {
    markMoving();
    await act(async () => { target.dispatchEvent(new Event(type)); });
    expectIdle();
  }
  expect(geometry()).toEqual(before);
  expect(paths().map(path => path.getAttribute('d'))).toEqual(beforePaths);
  markMoving();
  await mount('detailed', undefined, { ...options, storageKey: `${storageKey}:other-repository` });
  expectIdle();
  expect(windowRemove).toHaveBeenCalledWith('blur', firstHandler);
  expect(windowRemove).toHaveBeenCalledWith('pointercancel', firstHandler);
  expect(documentRemove).toHaveBeenCalledWith('visibilitychange', firstHandler);
  for (const [type, handler, capture] of firstReleaseListeners) expect(windowRemove).toHaveBeenCalledWith(type, handler, capture);
  const lastHandler = resetHandlers().at(-1);
  expect(lastHandler).not.toBe(firstHandler);
  const lastReleaseListeners = releaseListeners().slice(-2);
  markMoving();
  await act(async () => { root.render(null); });
  expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
  expect(windowRemove).toHaveBeenCalledWith('blur', lastHandler);
  expect(windowRemove).toHaveBeenCalledWith('pointercancel', lastHandler);
  expect(documentRemove).toHaveBeenCalledWith('visibilitychange', lastHandler);
  for (const [type, handler, capture] of lastReleaseListeners) expect(windowRemove).toHaveBeenCalledWith(type, handler, capture);
});

test('small CSU diagrams retain labels and do not request the transient compositor layer', async () => {
  await mount();
  expect(host.querySelector('.x-csu-large')).toBeNull();
  const viewport = host.querySelector('.react-flow__viewport');
  const labels = host.querySelector('.react-flow__edgelabel-renderer');
  host.setAttribute('data-viewport-moving', '');
  expect(getComputedStyle(viewport).willChange).not.toBe('transform');
  expect(getComputedStyle(labels).visibility).not.toBe('hidden');
});

test('a delayed React Flow end callback cannot retire presentation during a newer held pan', async () => {
  const largeRows = Array.from({ length: 500 }, (_, index) => ({ ...rows[index % rows.length], edgeId: `paint-restart-${index}` }));
  await mount('detailed', undefined, { rows: largeRows, expectedEdges: 500 });
  // Let initial fit/resize work settle before controlling the two real D3
  // gestures. React Flow itself delays onMoveEnd by 150 ms for panOnScroll;
  // this exercises that delayed callback, not a direct mocked prop call.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  const canvas = host.querySelector('.x-csu-large');
  const pane = canvas.querySelector('.react-flow__pane');
  const viewport = canvas.querySelector('.react-flow__viewport');
  const labels = canvas.querySelector('.react-flow__edgelabel-renderer');
  const mouse = (target, type, x, y, buttons) => act(() => target.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, button: 1, buttons, clientX: x, clientY: y,
  })));
  const advance = async milliseconds => act(async () => { jest.advanceTimersByTime(milliseconds); });
  const expectMoving = () => {
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(true);
    expect(getComputedStyle(viewport).willChange).toBe('transform');
    expect(getComputedStyle(labels).visibility).toBe('hidden');
  };
  jest.useFakeTimers();
  try {
    const initialTransform = viewport.style.transform;
    mouse(pane, 'mousedown', 350, 190, 4);
    mouse(window, 'mousemove', 390, 210, 4);
    expect(viewport.style.transform).not.toBe(initialTransform);
    expectMoving();
    mouse(window, 'mouseup', 390, 210, 0);
    await advance(50);
    // The first end callback is still waiting inside React Flow here.
    const beforeRestart = viewport.style.transform;
    mouse(pane, 'mousedown', 390, 210, 4);
    mouse(window, 'mousemove', 470, 250, 4);
    expect(viewport.style.transform).not.toBe(beforeRestart);
    await advance(350);
    expectMoving();
    mouse(window, 'mouseup', 470, 250, 0);
    await advance(350);
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
    expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    expect(getComputedStyle(labels).visibility).not.toBe('hidden');
  } finally {
    mouse(window, 'mouseup', 470, 250, 0);
    jest.useRealTimers();
  }
});

async function mountFunctionalNavigation(key, edgeCount) {
  localStorage.setItem(key, JSON.stringify([
    ['n:Plan', { position: { x: 100, y: 100 } }],
    ['n:Control', { position: { x: 500, y: 100 } }],
  ]));
  localStorage.setItem(`${key}:initial-layout:v1`, 'complete');
  localStorage.setItem(`${key}:viewport:v1`, JSON.stringify({ x: 25, y: 30, zoom: 0.8 }));
  localStorage.setItem(`${key}:edge-aggregation:v1`, JSON.stringify({ aggregateAll: false, aggregateBidirectionalAll: false }));
  const modelRows = Array.from({ length: edgeCount }, (_, index) => ({ ...rows[0], controlAction: `Command ${index}` }));
  await act(async () => { root.render(<FunctionalDiagram rows={modelRows} storageKey={key} />); });
  for (let attempt = 0; attempt < 30 && paths().length !== edgeCount; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(paths()).toHaveLength(edgeCount);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
}

const panMouse = (target, type, x, y, buttons) => act(() => target.dispatchEvent(new MouseEvent(type, {
  bubbles: true, cancelable: true, view: window, button: 1, buttons, clientX: x, clientY: y,
})));
const viewportWheel = (target, ctrlKey, deltaY = -20) => act(() => target.dispatchEvent(new WheelEvent('wheel', {
  bubbles: true, cancelable: true, view: window, clientX: 390, clientY: 210, deltaY, ctrlKey,
})));
const advancePanTimers = async milliseconds => act(async () => { jest.advanceTimersByTime(milliseconds); });
function renderedViewport(viewport) {
  const match = viewport.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/);
  expect(match).not.toBeNull();
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

test.each([
  ['Functional', 'minimum', 0.1, 10000],
  ['Functional', 'maximum', 1.8, -10000],
  ['CBA', 'minimum', 0.02, 10000],
  ['CBA', 'maximum', 1.8, -10000],
])('%s no-op wheel at the %s zoom limit restores idle presentation', async (kind, _limit, zoom, deltaY) => {
  if (kind === 'Functional') {
    await mountFunctionalNavigation('diagram:paint-regression:zoom-bound', 500);
  } else {
    const modelRows = Array.from({ length: 500 }, (_, index) => ({ ...rows[index % rows.length], edgeId: `paint-bound-${index}` }));
    await mount('detailed', undefined, { rows: modelRows, expectedEdges: 500 });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  }
  const canvas = host.querySelector(kind === 'Functional' ? '.project-functional-diagram' : '.x-csu-large');
  const pane = canvas.querySelector('.react-flow__pane');
  const viewport = canvas.querySelector('.react-flow__viewport');
  const labels = canvas.querySelector('.react-flow__edgelabel-renderer');
  const expectIdle = () => {
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
    expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    expect(getComputedStyle(labels).visibility).not.toBe('hidden');
  };
  jest.useFakeTimers();
  try {
    expect(renderedViewport(viewport).zoom).not.toBe(zoom);
    viewportWheel(pane, true, deltaY);
    expect(renderedViewport(viewport).zoom).toBe(zoom);
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(true);
    expect(getComputedStyle(viewport).willChange).toBe('transform');
    await advancePanTimers(350);
    expectIdle();
    const atLimit = renderedViewport(viewport);
    // D3 still emits start/zoom/end at this limit. React Flow suppresses
    // onMoveEnd when the resulting transform is unchanged.
    viewportWheel(pane, true, deltaY);
    expect(renderedViewport(viewport)).toEqual(atLimit);
    await advancePanTimers(350);
    expectIdle();
  } finally {
    jest.useRealTimers();
  }
});

test.each(['Functional', 'CBA'])('%s no-motion mouse release restores idle presentation without timing out a held press', async kind => {
  if (kind === 'Functional') {
    await mountFunctionalNavigation('diagram:paint-regression:stationary-mouse', 500);
  } else {
    const modelRows = Array.from({ length: 500 }, (_, index) => ({ ...rows[index % rows.length], edgeId: `paint-stationary-${index}` }));
    await mount('detailed', undefined, { rows: modelRows, expectedEdges: 500 });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  }
  const canvas = host.querySelector(kind === 'Functional' ? '.project-functional-diagram' : '.x-csu-large');
  const viewport = canvas.querySelector('.react-flow__viewport');
  const before = renderedViewport(viewport);
  jest.useFakeTimers();
  try {
    panMouse(canvas.querySelector('.react-flow__pane'), 'mousedown', 390, 210, 4);
    await advancePanTimers(350);
    expect(renderedViewport(viewport)).toEqual(before);
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(kind === 'CBA');
    panMouse(window, 'mouseup', 390, 210, 0);
    await advancePanTimers(350);
    expect(renderedViewport(viewport)).toEqual(before);
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
    expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    expect(getComputedStyle(canvas.querySelector('.react-flow__edgelabel-renderer')).visibility).not.toBe('hidden');
  } finally {
    panMouse(window, 'mouseup', 390, 210, 0);
    jest.useRealTimers();
  }
});

test('small functional diagrams pan, zoom and persist the viewport without transient promotion', async () => {
  const key = 'diagram:paint-regression:small-navigation';
  await mountFunctionalNavigation(key, 1);
  const canvas = host.querySelector('.project-functional-diagram');
  const viewport = canvas.querySelector('.react-flow__viewport');
  const initial = renderedViewport(viewport);
  jest.useFakeTimers();
  try {
    panMouse(canvas.querySelector('.react-flow__pane'), 'mousedown', 350, 190, 4);
    panMouse(window, 'mousemove', 390, 210, 4);
    expect(renderedViewport(viewport)).not.toEqual(initial);
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
    expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    panMouse(window, 'mouseup', 390, 210, 0);
    await advancePanTimers(350);
    const beforeZoom = renderedViewport(viewport);
    viewportWheel(canvas.querySelector('.react-flow__pane'), true);
    expect(renderedViewport(viewport).zoom).not.toBe(beforeZoom.zoom);
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
    expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    await advancePanTimers(350);
    expect(JSON.parse(localStorage.getItem(`${key}:viewport:v1`))).toEqual(renderedViewport(viewport));
  } finally {
    panMouse(window, 'mouseup', 390, 210, 0);
    jest.useRealTimers();
  }
});

test('large functional promotion follows scaling only, survives late D3 ends and cleans up without changing viewport saving', async () => {
  const windowAdd = jest.spyOn(window, 'addEventListener');
  const windowRemove = jest.spyOn(window, 'removeEventListener');
  const documentAdd = jest.spyOn(document, 'addEventListener');
  const documentRemove = jest.spyOn(document, 'removeEventListener');
  const key = 'diagram:paint-regression:large-navigation';
  await mountFunctionalNavigation(key, 500);
  const canvas = host.querySelector('.project-functional-diagram');
  const setAttribute = jest.spyOn(canvas, 'setAttribute');
  const removeAttribute = jest.spyOn(canvas, 'removeAttribute');
  const promotionCalls = spy => spy.mock.calls.filter(([name]) => name === 'data-viewport-moving').length;
  const pane = canvas.querySelector('.react-flow__pane');
  const viewport = canvas.querySelector('.react-flow__viewport');
  const labels = canvas.querySelector('.react-flow__edgelabel-renderer');
  const beforeGeometry = geometry();
  const beforePaths = paths().map(path => path.getAttribute('d'));
  const handlesBefore = canvas.querySelectorAll('.react-flow__handle').length;
  const resetHandlers = () => windowAdd.mock.calls
    .filter(([type, callback]) => type === 'blur'
      && windowAdd.mock.calls.some(([event, handler]) => event === 'pointercancel' && handler === callback)
      && documentAdd.mock.calls.some(([event, handler]) => event === 'visibilitychange' && handler === callback))
    .map(([, callback]) => callback);
  expect(resetHandlers()).toHaveLength(1);
  const resetHandler = resetHandlers()[0];
  const releaseListeners = () => windowAdd.mock.calls.filter(([type, , capture]) => ['mouseup', 'touchend'].includes(type) && capture === true);
  const firstReleaseListeners = releaseListeners();
  expect(firstReleaseListeners).toHaveLength(2);
  const expectPresentation = moving => {
    expect(canvas.hasAttribute('data-viewport-moving')).toBe(moving);
    if (moving) expect(getComputedStyle(viewport).willChange).toBe('transform');
    else expect(getComputedStyle(viewport).willChange).not.toBe('transform');
    expect(getComputedStyle(labels).visibility).not.toBe('hidden');
    expect(canvas.querySelectorAll('.react-flow__handle')).toHaveLength(handlesBefore);
  };
  expectPresentation(false);
  jest.useFakeTimers();
  try {
    const initial = renderedViewport(viewport);
    panMouse(pane, 'mousedown', 350, 190, 4);
    panMouse(window, 'mousemove', 390, 210, 4);
    expect(renderedViewport(viewport)).not.toEqual(initial);
    expect(renderedViewport(viewport).zoom).toBe(initial.zoom);
    expectPresentation(false);
    panMouse(window, 'mouseup', 390, 210, 0);
    await advancePanTimers(350);
    const beforeScroll = renderedViewport(viewport);
    viewportWheel(pane, false);
    expect(renderedViewport(viewport)).not.toEqual(beforeScroll);
    expect(renderedViewport(viewport).zoom).toBe(beforeScroll.zoom);
    expectPresentation(false);
    await advancePanTimers(350);
    viewportWheel(pane, true);
    expect(renderedViewport(viewport).zoom).not.toBe(beforeScroll.zoom);
    expectPresentation(true);
    expect(promotionCalls(setAttribute)).toBe(1);
    const removalsBeforePinchSequence = promotionCalls(removeAttribute);
    // panOnScroll makes every ctrl-wheel a separate scaleTo start/end. The
    // layer must survive those starts, rather than being recreated per input.
    for (const deltaY of [20, -20]) {
      await advancePanTimers(20);
      const previousZoom = renderedViewport(viewport).zoom;
      viewportWheel(pane, true, deltaY);
      expect(renderedViewport(viewport).zoom).not.toBe(previousZoom);
      expectPresentation(true);
      expect(promotionCalls(setAttribute)).toBe(1);
      expect(promotionCalls(removeAttribute)).toBe(removalsBeforePinchSequence);
    }
    await advancePanTimers(50);
    const beforeRestart = renderedViewport(viewport);
    panMouse(pane, 'mousedown', 390, 210, 4);
    // A pan starting before the zoom's delayed end must remove its hint now.
    expectPresentation(false);
    panMouse(window, 'mousemove', 470, 250, 4);
    expect(renderedViewport(viewport)).not.toEqual(beforeRestart);
    expect(renderedViewport(viewport).zoom).toBe(beforeRestart.zoom);
    expectPresentation(false);
    // Scale during the new held D3 gesture. Unlike standalone ctrl-wheel,
    // which starts/ends synchronously, this remains active across the old end.
    viewportWheel(pane, true);
    expect(renderedViewport(viewport).zoom).not.toBe(beforeRestart.zoom);
    expectPresentation(true);
    // React Flow's first 150 ms end callback arrives during the held second
    // gesture; it must not schedule retirement of the newer scaling layer.
    await advancePanTimers(350);
    expectPresentation(true);
    panMouse(window, 'mouseup', 470, 250, 0);
    await advancePanTimers(350);
    expectPresentation(false);
    expect(JSON.parse(localStorage.getItem(`${key}:viewport:v1`))).toEqual(renderedViewport(viewport));
    for (const [target, type] of [[window, 'blur'], [window, 'pointercancel'], [document, 'visibilitychange']]) {
      viewportWheel(pane, true);
      expectPresentation(true);
      await act(async () => { target.dispatchEvent(new Event(type)); });
      expectPresentation(false);
      await advancePanTimers(350);
      expectPresentation(false);
    }
  } finally {
    panMouse(window, 'mouseup', 470, 250, 0);
    jest.useRealTimers();
  }
  expect(geometry()).toEqual(beforeGeometry);
  expect(paths().map(path => path.getAttribute('d'))).toEqual(beforePaths);
  canvas.setAttribute('data-viewport-moving', '');
  await mountFunctionalNavigation(`${key}:next-project`, 500);
  expectPresentation(false);
  expect(windowRemove).toHaveBeenCalledWith('blur', resetHandler);
  expect(windowRemove).toHaveBeenCalledWith('pointercancel', resetHandler);
  expect(documentRemove).toHaveBeenCalledWith('visibilitychange', resetHandler);
  for (const [type, handler, capture] of firstReleaseListeners) expect(windowRemove).toHaveBeenCalledWith(type, handler, capture);
  const currentHandler = resetHandlers().at(-1);
  const lastReleaseListeners = releaseListeners().slice(-2);
  const releaseRemovalCounts = lastReleaseListeners.map(([type, handler, capture]) => windowRemove.mock.calls.filter(call => call[0] === type && call[1] === handler && call[2] === capture).length);
  const removalsBefore = windowRemove.mock.calls.filter(([type, handler]) => type === 'blur' && handler === currentHandler).length;
  canvas.setAttribute('data-viewport-moving', '');
  await act(async () => { root.render(null); });
  expect(canvas.hasAttribute('data-viewport-moving')).toBe(false);
  expect(windowRemove.mock.calls.filter(([type, handler]) => type === 'blur' && handler === currentHandler)).toHaveLength(removalsBefore + 1);
  expect(windowRemove).toHaveBeenCalledWith('pointercancel', currentHandler);
  expect(documentRemove).toHaveBeenCalledWith('visibilitychange', currentHandler);
  lastReleaseListeners.forEach(([type, handler, capture], index) => {
    expect(windowRemove.mock.calls.filter(call => call[0] === type && call[1] === handler && call[2] === capture)).toHaveLength(releaseRemovalCounts[index] + 1);
  });
});

test.each([
  ['default', null, [45, 125, 254, 0.92]],
  ['custom hex', '#123456', [18, 52, 86, 0.92]],
  ['existing alpha', 'rgba(18,52,86,0.4)', [18, 52, 86, 0.4]],
])('functional diagram preserves %s edge paint, selection, dark alpha and geometry', async (_name, savedColor, expectedMarker) => {
  const key = 'diagram:paint-regression:functional';
  const edgeId = 'e:n:Plan->n:Control-0';
  const functionalRows = [rows[0]];
  localStorage.setItem(key, JSON.stringify([
    ['n:Plan', { position: { x: 100, y: 100 } }],
    ['n:Control', { position: { x: 500, y: 100 } }],
  ]));
  localStorage.setItem(`${key}:initial-layout:v1`, 'complete');
  if (savedColor) localStorage.setItem(`${key}:edge-routing:v1`, JSON.stringify({ defaultStyle: 'rectangular', colors: { [edgeId]: savedColor } }));
  await act(async () => { root.render(<FunctionalDiagram rows={functionalRows} storageKey={key} />); });
  for (let attempt = 0; attempt < 30 && paths().length !== 1; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(paths()).toHaveLength(1);
  const before = geometry();
  const beforePath = paths()[0].getAttribute('d');
  const usesFallback = savedColor?.startsWith('rgba');
  document.documentElement.classList.add('dark');
  if (usesFallback) {
    // Unknown/custom alpha remains on the existing paint path rather than
    // being reparsed, compounded or applied again to a custom marker.
    expect(paths()[0].style.opacity).toBe('0.92');
    expect(paths()[0].style.strokeOpacity).toBe('');
    expect(color(paths()[0].style.stroke)).toEqual(expectedMarker);
  } else {
    expect(paint(paths()[0])).toEqual({ opacity: 1, strokeOpacity: 0.92 });
  }
  expect(marker(paths()[0])).toEqual(expectedMarker);
  expect(host.textContent).toContain('Command');
  await click(paths()[0]);
  expect(paths()[0].style.opacity).toBe('1');
  if (!usesFallback) expect(paint(paths()[0])).toEqual({ opacity: 1, strokeOpacity: 1 });
  expect(marker(paths()[0])).toEqual(usesFallback ? expectedMarker : [...expectedMarker.slice(0, 3), 1]);
  await click(host.querySelector('.react-flow__pane'));
  expect(marker(paths()[0])).toEqual(expectedMarker);
  expect(paths()[0].getAttribute('d')).toBe(beforePath);
  expect(geometry()).toEqual(before);
  if (savedColor) expect(JSON.parse(localStorage.getItem(`${key}:edge-routing:v1`)).colors[edgeId]).toBe(savedColor);
});

test('functional undo and redo retain base custom paint without compounding idle alpha', async () => {
  const key = 'diagram:paint-regression:history';
  const edgeId = 'e:n:Plan->n:Control-0';
  const functionalRows = [rows[0]];
  localStorage.setItem(key, JSON.stringify([
    ['n:Plan', { position: { x: 100, y: 100 } }],
    ['n:Control', { position: { x: 500, y: 100 } }],
  ]));
  localStorage.setItem(`${key}:initial-layout:v1`, 'complete');
  localStorage.setItem(`${key}:edge-routing:v1`, JSON.stringify({ defaultStyle: 'rectangular', colors: { [edgeId]: '#123456' } }));
  await act(async () => { root.render(<FunctionalDiagram rows={functionalRows} storageKey={key} />); });
  for (let attempt = 0; attempt < 30 && paths().length !== 1; attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(paths()).toHaveLength(1);
  const initialGeometry = geometry();
  const initialPath = paths()[0].getAttribute('d');
  const assertPaint = alpha => {
    expect(paint(paths()[0])).toEqual({ opacity: 1, strokeOpacity: alpha });
    expect(marker(paths()[0])).toEqual([18, 52, 86, alpha]);
    expect(paths()[0].getAttribute('d')).toBe(initialPath);
    expect(JSON.parse(localStorage.getItem(`${key}:edge-routing:v1`)).colors[edgeId]).toBe('#123456');
  };
  assertPaint(0.92);
  // A real edit checkpoints React Flow's currently presented idle edges.
  await click(host.querySelector('button[title="Add note"]'));
  expect(host.querySelectorAll('.react-flow__node-note')).toHaveLength(1);
  for (let round = 0; round < 2; round += 1) {
    await click(paths()[0]);
    assertPaint(1);
    await click(host.querySelector('button[title="Undo last diagram change"]'));
    expect(host.querySelectorAll('.react-flow__node-note')).toHaveLength(0);
    expect(geometry()).toEqual(initialGeometry);
    assertPaint(0.92);
    await click(host.querySelector('button[title="Redo diagram change"]'));
    expect(host.querySelectorAll('.react-flow__node-note')).toHaveLength(1);
    assertPaint(0.92);
  }
});
