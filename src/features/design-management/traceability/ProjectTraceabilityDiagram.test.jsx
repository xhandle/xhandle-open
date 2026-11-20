import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectTraceabilityDiagram from './ProjectTraceabilityDiagram';

jest.mock('lucide-react', () => jest.requireActual('lucide-react/dist/cjs/lucide-react.js'));

// Use real React Flow and layout; supply geometry that jsdom cannot measure.
const original = { ResizeObserver: global.ResizeObserver, DOMMatrixReadOnly: window.DOMMatrixReadOnly, getBBox: SVGElement.prototype.getBBox };
const graph = {
  nodes: [{ id: 'p', type: 'systems-engineering-project', title: 'Vehicle' },
    { id: 'system', type: 'artifact', title: 'System requirements' }, { id: 'software', type: 'artifact', title: 'Software requirements' },
    { id: 's1', type: 'requirement', artifactId: 'system', title: 'System command' },
    { id: 'w1', type: 'requirement', artifactId: 'software', title: 'Software command' }],
  links: [{ id: 'own', from: 'p', to: 'system', type: 'contains' },
    { id: 'system-object', from: 'system', to: 's1', type: 'contains' },
    { id: 'software-object', from: 'software', to: 'w1', type: 'contains' },
    { id: 'dependency', from: 'software', to: 'system', type: 'uses-drafting-input' },
    { id: 'refines', from: 'w1', to: 's1', type: 'refines' }], gaps: [],
};
const records = [{ meta: { id: 'system', templateId: 'system-spec' } }, { meta: { id: 'software', templateId: 'software-spec' } }];
let host, root;
function bounds(element) {
  const node = element.classList?.contains('react-flow__node');
  const width = node ? 196 : 900, height = node ? 140 : 600;
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); }
    observe(target) { this.targets.add(target); queueMicrotask(() => { if (this.targets.has(target)) this.callback([{ target, contentRect: bounds(target) }]); }); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  window.DOMMatrixReadOnly = class { constructor(transform) { this.m22 = Number(String(transform).match(/scale\(([^)]+)\)/)?.[1]) || 1; } };
  SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: this.textContent.length * 7, height: 14 }; };
  for (const [prototype, property, dimension] of [[HTMLElement.prototype, 'offsetWidth', 'width'], [HTMLElement.prototype, 'offsetHeight', 'height'], [Element.prototype, 'clientWidth', 'width'], [Element.prototype, 'clientHeight', 'height']]) {
    jest.spyOn(prototype, property, 'get').mockImplementation(function () { return bounds(this)[dimension]; });
  }
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () { return bounds(this); });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks();
  global.ResizeObserver = original.ResizeObserver; window.DOMMatrixReadOnly = original.DOMMatrixReadOnly;
  if (original.getBBox) SVGElement.prototype.getBBox = original.getBBox; else delete SVGElement.prototype.getBBox;
});
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 10))); }
  throw Error(`Diagram did not settle: ${host.textContent}`);
}
async function mount() {
  await act(async () => root.render(<ProjectTraceabilityDiagram graph={graph} records={records} onOpenNode={() => {}} />));
  await until(() => host.querySelector('[data-id="system"]'));
}
const button = name => [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === name || item.textContent === name);
async function click(name) { await act(async () => button(name).click()); }
async function layer(name) {
  const input = [...host.querySelectorAll('.project-trace-layers-options label')].find(item => item.textContent === name).querySelector('input');
  await act(async () => input.click());
}
async function level(value) {
  const select = host.querySelector('select');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); });
}
test('Layers selects relationship types in both levels, clears hidden details and restores all links', async () => {
  await mount(); await click('Layers');
  expect([...host.querySelectorAll('.project-trace-layers-options label')].map(label => label.textContent)).toEqual(['Contains', 'Uses drafting input', 'Refines']);
  expect(host.querySelectorAll('.project-trace-layers-options input:checked')).toHaveLength(3);
  await layer('Refines');
  await until(() => host.querySelectorAll('.react-flow__edge').length === 2);
  expect(host.querySelectorAll('.react-flow__node')).toHaveLength(3);
  await layer('Contains');
  await until(() => host.querySelectorAll('.react-flow__edge').length === 1);
  expect(host.querySelector('.react-flow__edge').textContent).toContain('Uses drafting input');
  expect(host.querySelectorAll('.project-trace-layers-options input:checked')).toHaveLength(1);
  await level('objects');
  await until(() => host.querySelector('[data-id="s1"]'));
  expect(host.querySelector('[data-id="w1"]')).toBeNull();
  expect(host.querySelectorAll('.react-flow__edge')).toHaveLength(0);
  await layer('Refines');
  await until(() => host.querySelector('[data-id="w1"]'));
  expect(host.querySelectorAll('.react-flow__edge')).toHaveLength(1);
  await act(async () => host.querySelector('[data-id="s1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector('.project-trace-details')).not.toBeNull();
  if (button('Layers').getAttribute('aria-expanded') === 'false') await click('Layers');
  await click('Deselect all');
  await until(() => host.querySelector('[data-id="s1"]') && !host.querySelector('.react-flow__edge'));
  expect(host.textContent).toContain('No relationship layers selected'); expect(host.querySelector('.project-trace-details')).toBeNull();
  await click('Select all');
  await until(() => host.querySelector('[data-id="w1"]'));
  await act(async () => button('Select all').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(button('Layers').getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(button('Layers'));
  await level('artifacts'); await until(() => host.querySelector('[data-id="software"]'));
  expect(host.querySelectorAll('.react-flow__node')).toHaveLength(3);
  expect(host.querySelectorAll('.react-flow__edge')).toHaveLength(3);
  await click('Layers');
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  expect(button('Layers').getAttribute('aria-expanded')).toBe('false');
});

test('two-finger wheel deltas pan in both directions without zooming, while pinch still zooms', async () => {
  await mount();
  await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  const camera = () => host.querySelector('.react-flow__viewport').style.transform.match(/translate\(([-\d.e]+)px,([-\d.e]+)px\) scale\(([-\d.e]+)\)/).slice(1).map(Number);
  const before = camera();
  const wheel = async options => act(async () => {
    host.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, ...options }));
    await new Promise(resolve => setTimeout(resolve, 180));
  });
  await wheel({ deltaX: 80, deltaY: 40 });
  const panned = camera();
  expect(panned[0]).toBeLessThan(before[0]); expect(panned[1]).toBeLessThan(before[1]); expect(panned[2]).toBe(before[2]);
  await wheel({ deltaY: -40, ctrlKey: true }); expect(camera()[2]).toBeGreaterThan(panned[2]);
});
