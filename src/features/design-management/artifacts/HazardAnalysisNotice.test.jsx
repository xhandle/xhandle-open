import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import HazardAnalysisNotice, { useHazardAnalysisStatus } from './HazardAnalysisNotice';
import { requestHazardAnalysisAvailability } from './requestHazardAnalysisAvailability';

jest.mock('./requestHazardAnalysisAvailability', () => ({ requestHazardAnalysisAvailability: jest.fn() }));
let root, host, requests;
function Form({ id = 'p' }) {
  const status = useHazardAnalysisStatus([{ id, workspaceType: 'code-architecture' }], true);
  return <><HazardAnalysisNotice status={status} /><button id="create" disabled={!status.ready}>Create draft</button></>;
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; requests = [];
  requestHazardAnalysisAvailability.mockReset();
  requestHazardAnalysisAvailability.mockImplementation((owners, options) => new Promise((resolve, reject) => requests.push({ owners, options, resolve, reject })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test('a completed large analysis enables creation using the availability result', async () => {
  await act(async () => root.render(<Form />));
  expect(host.textContent).toContain('Checking saved hazard analyses');
  await act(async () => requests[0].resolve({ rows: 80000, analyses: 1 }));
  expect(host.textContent).toContain('80000 saved assessment rows');
  expect(host.querySelector('#create').disabled).toBe(false);
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'xhandle.workspaceGraph.dirty.*' })));
  await act(async () => window.dispatchEvent(new CustomEvent('xhandle:code-architecture-hazard-analysis:changed', { detail: { projectId: 'other' } })));
  expect(requests).toHaveLength(1); expect(host.querySelector('#create').disabled).toBe(false);
});

test('timeouts show a retry action and a successful retry enables creation', async () => {
  await act(async () => root.render(<Form />));
  await act(async () => requests[0].reject(new Error('Checking saved hazard analysis timed out. Retry the check.')));
  expect(host.querySelector('[role="alert"]').textContent).toContain('timed out');
  expect(host.querySelector('#create').disabled).toBe(true);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry hazard analysis check').click());
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].resolve({ rows: 250, analyses: 1 }));
  expect(host.querySelector('#create').disabled).toBe(false); expect(host.querySelector('[role="alert"]')).toBeNull();
});

test('switching source projects cancels the old check and ignores its late result', async () => {
  await act(async () => root.render(<Form />));
  await act(async () => root.render(<Form id="other" />));
  expect(requests[0].options.signal.aborted).toBe(true);
  await act(async () => requests[0].resolve({ rows: 1000, analyses: 1 }));
  expect(host.querySelector('#create').disabled).toBe(true);
  await act(async () => requests[1].resolve({ rows: 42, analyses: 1 }));
  expect(host.textContent).toContain('42 saved assessment rows'); expect(host.querySelector('#create').disabled).toBe(false);
});
