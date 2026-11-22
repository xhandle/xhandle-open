import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReportDocumentLayout from './ReportDocumentLayout';

jest.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }));

let container, root, width, resize;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
const content = <article><h1>Safety report</h1><h2>Scope</h2><h3><strong>Verification</strong> evidence</h3><h2>Scope</h2><pre>{'# Not a heading'}</pre></article>;
const render = (key = 'first', children = content) => act(() => root.render(<ReportDocumentLayout documentKey={key}>{children}</ReportDocumentLayout>));
const reader = () => container.querySelector('[aria-label="Report document"]');
const nav = () => container.querySelector('[aria-label="Report contents"]');
const toggle = () => container.querySelector('button');
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; width = 800;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const pane = this.closest('.report-document-reader');
    const top = /^H[1-6]$/.test(this.tagName) && pane ? 120 + [...pane.querySelectorAll('h1,h2,h3,h4,h5,h6')].indexOf(this) * 200 : 100;
    return { width: this.classList.contains('report-document-layout') ? width : 500, height: 300, top, bottom: top + 300, left: 0, right: width };
  });
  global.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); delete global.ResizeObserver; delete global.IS_REACT_ACT_ENVIRONMENT; });

test('uses rendered headings in order, with hierarchy, full labels and unique duplicate targets', () => {
  render();
  const links = [...nav().querySelectorAll('a')];
  expect(links.map(a => a.textContent)).toEqual(['Safety report', 'Scope', 'Verification evidence', 'Scope']);
  expect(new Set(links.map(a => a.hash)).size).toBe(4);
  expect(links[2].style.paddingInlineStart).toBe('32px');
  expect(links[0].getAttribute('aria-current')).toBe('location');
});

test('navigates and focuses only its document without changing the workspace route', () => {
  render();
  const pane = reader(), target = pane.querySelector('h3'), hash = location.hash;
  pane.scrollTop = 20; target.getBoundingClientRect = () => ({ top: 600 });
  const link = [...nav().querySelectorAll('a')][2];
  act(() => link.click());
  expect(pane.scrollTop).toBe(500);
  expect(location.hash).toBe(hash);
  expect(document.activeElement).toBe(target);
  expect(link.getAttribute('aria-current')).toBe('location');
});

test('collapses, restores and dismisses the outline from the keyboard', () => {
  render(); const target = toggle().getAttribute('aria-controls');
  expect(nav().id).toBe(target);
  act(() => toggle().click()); expect(nav().hidden).toBe(true);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  act(() => toggle().click()); expect(nav().hidden).toBe(false);
  act(() => nav().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(nav().hidden).toBe(true); expect(document.activeElement).toBe(toggle());
});

test('uses the available panel width to default to a compact overlay, then closes it after navigation', () => {
  width = 420; render();
  expect(nav().hidden).toBe(true);
  act(() => toggle().click()); expect(nav().hidden).toBe(false);
  act(() => nav().querySelector('a').click()); expect(nav().hidden).toBe(true);
  width = 800; act(() => resize());
  expect(nav().hidden).toBe(false);
  expect(container.firstChild.dataset.compact).toBe('false');
});

test('updates the active section during document scrolling', async () => {
  render(); const pane = reader(), headings = [...pane.querySelectorAll('h1,h2,h3')];
  headings.forEach((heading, index) => { heading.getBoundingClientRect = () => ({ top: 70 + index * 120 - pane.scrollTop }); });
  act(() => { pane.scrollTop = 250; pane.dispatchEvent(new Event('scroll')); }); await flush();
  expect([...nav().querySelectorAll('a')][2].getAttribute('aria-current')).toBe('location');
});

test('refreshes heading references after a renderer replaces nodes, retaining its scroll position', async () => {
  render(); const pane = reader(); pane.scrollTop = 220;
  render('first', <article><h1>Safety report</h1><h2>Scope</h2><h3>Verification evidence</h3><h2>Scope</h2></article>);
  await flush();
  expect(pane.scrollTop).toBe(220);
  const target = pane.querySelector('h3'); target.getBoundingClientRect = () => ({ top: 300 });
  act(() => [...nav().querySelectorAll('a')][2].click());
  expect(document.activeElement).toBe(target);
});

test('selecting another report resets the reader and replaces its outline', () => {
  render(); reader().scrollTop = 500;
  render('second', <article><h1>Another report</h1><h2>Other section</h2></article>);
  expect(reader().scrollTop).toBe(0);
  expect([...nav().querySelectorAll('a')].map(a => a.textContent)).toEqual(['Another report', 'Other section']);
});

test('keeps simultaneous report viewers and authored duplicate IDs isolated', () => {
  act(() => root.render(<><ReportDocumentLayout documentKey="a"><h1>Report A</h1><h2 id="same">First</h2><h2 id="same">Second</h2></ReportDocumentLayout><ReportDocumentLayout documentKey="b"><h1>Report B</h1></ReportDocumentLayout></>));
  const generated = [...container.querySelectorAll('h1')].map(h => h.id);
  expect(new Set(generated).size).toBe(2);
  const first = container.querySelector('.report-document-reader');
  expect(new Set([...first.querySelectorAll('[id]')].map(h => h.id)).size).toBe(3);
});

test('shows a useful empty outline for a report with no headings', () => {
  render('plain', <p>Plain report text.</p>);
  expect(nav().textContent).toContain('No sections in this report.');
  expect(nav().querySelectorAll('a')).toHaveLength(0);
});

test('a section click resolves newly replaced headings before the observer animation frame', () => {
 render();
 const link=[...nav().querySelectorAll('a')][2];
 render('first',<article key="replacement"><h1>Safety report</h1><h2>Scope</h2><h3>Verification evidence</h3><h2>Scope</h2></article>);
 const target=reader().querySelector('h3');
 act(()=>link.click());
 expect(document.activeElement).toBe(target);
 expect(target.id).toBe(link.hash.slice(1));
 expect(reader().scrollTop).toBeGreaterThan(0);
});
