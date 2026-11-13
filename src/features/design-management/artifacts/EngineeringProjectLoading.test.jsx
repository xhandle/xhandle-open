import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EngineeringProjectEditor from './EngineeringProjectEditor';
import { requestProjectLoad } from './requestProjectLoad';
import { ARTIFACT_CHANGED } from './artifactRepository';
jest.mock('./requestProjectLoad', () => ({ requestProjectLoad: jest.fn() }));
jest.mock('lucide-react', () => new Proxy({}, { get: (_, key) => key === '__esModule' ? true : () => null }));
let root, host, pending;
const project = id => ({ program: { id, title: id, state: 'draft', config: { system: 'Vehicle' }, ownerProjects: [], members: [] }, records: [] });
const click = text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text).click());
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); pending = [];
  requestProjectLoad.mockImplementation((id, options) => new Promise((resolve, reject) => pending.push({ id, options, resolve, reject })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.clearAllMocks(); jest.useRealTimers(); });
test('shows the existing spinning logo and real 0–100 stage progress, and defers trace loading', async () => {
  await act(async () => root.render(<EngineeringProjectEditor id="Pronto" />));
  expect(host.querySelector('.xhandle-working-mark img')).not.toBeNull();
  expect(host.querySelector('[role=progressbar]').getAttribute('aria-valuenow')).toBe('0');
  await act(async () => pending[0].options.onProgress({ percent: 52, stage: 'Read 2 of 4 document summaries' }));
  expect(host.textContent).toContain('52%'); expect(host.textContent).toContain('Read 2 of 4');
  await act(async () => pending[0].options.onProgress({ percent: 100, stage: 'Project ready' }));
  expect(host.textContent).toContain('100%');
  await act(async () => pending[0].resolve(project('Pronto')));
  expect(host.querySelector('.artifact-header').textContent).toContain('Pronto'); expect(pending).toHaveLength(1);
  await click('Traceability'); expect(pending).toHaveLength(2); expect(pending[1].options.trace).toBe(true);
  expect(host.querySelector('[role=progressbar]')).not.toBeNull();
  await act(async () => pending[1].resolve({ nodes: [], links: [], gaps: [] }));
  expect(host.textContent).toContain('0 nodes · 0 links');
});
test('project switches cancel old work and ignore late progress/results', async () => {
  await act(async () => root.render(<EngineeringProjectEditor id="Old" />));
  await act(async () => root.render(<EngineeringProjectEditor id="New" />));
  expect(pending[0].options.signal.aborted).toBe(true);
  await act(async () => { pending[0].options.onProgress({ percent: 90, stage: 'Old' }); pending[0].resolve(project('Old')); });
  expect(host.querySelector('[role=progressbar]').getAttribute('aria-valuenow')).toBe('0');
  await act(async () => pending[1].resolve(project('New')));
  expect(host.querySelector('.artifact-header').textContent).toContain('New');
});
test('storage failure stops the spinner and exposes a working retry', async () => {
  await act(async () => root.render(<EngineeringProjectEditor id="Pronto" />));
  await act(async () => pending[0].reject(new Error('Storage unavailable')));
  expect(host.querySelector('[role=progressbar]')).toBeNull(); expect(host.textContent).toContain('Storage unavailable');
  await click('Retry loading project');
  await act(async () => pending[1].resolve(project('Pronto')));
  expect(host.querySelector('.artifact-header')).not.toBeNull();
});
test('checkpoint event bursts coalesce and do not hide the loaded overview', async () => {
  jest.useFakeTimers();
  await act(async () => root.render(<EngineeringProjectEditor id="Pronto" />));
  await act(async () => pending[0].resolve(project('Pronto')));
  await act(async () => { for (let i = 0; i < 10; i++) window.dispatchEvent(new Event(ARTIFACT_CHANGED)); jest.advanceTimersByTime(75); });
  expect(pending).toHaveLength(2); expect(host.querySelector('.artifact-header')).not.toBeNull();
  await act(async () => pending[1].resolve(project('Pronto')));
  expect(pending).toHaveLength(2);
});
