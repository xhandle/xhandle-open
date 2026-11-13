import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityProvider, ActivitiesButton, useActivityCenter } from '../../../components/activity/ActivityCenter';
import DesignGenerationActivities from './DesignGenerationActivities';
import { startGenerationRun, pauseGenerationRun } from './generationRuns';

jest.mock('lucide-react', () => ({ ChevronDown: () => null, Loader2: () => null }));
let root, host, api;
function Capture() { api = useActivityCenter(); return null; }
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<ActivityProvider><DesignGenerationActivities /><Capture /><ActivitiesButton /></ActivityProvider>));
  await act(async () => host.querySelector('button').click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const dropdown = () => document.getElementById('activities-dropdown').textContent;

test('Activities follows live location, saved work, retries and completion from the run service', async () => {
  let progress, finish, promise;
  await act(async () => { promise = startGenerationRun('activity-progress', async ({ onProgress }) => {
    progress = onProgress; return new Promise(resolve => { finish = resolve; });
  }, { title: 'Generate project: Pronto' }); });
  await act(async () => progress('Reviewing evidence…', { stage: 'reviewing', reviewGroup: 2, reviewGroups: 4, requestsMade: 3 }));
  expect(dropdown()).toContain('Reviewing shared evidence'); expect(dropdown()).toContain('Evidence group 2 of 4'); expect(dropdown()).toContain('3 AI requests this run');
  await act(async () => progress('Generating Functional requirements…', { stage: 'generating', documentTitle: 'System Specification', sectionTitle: 'Functional requirements', completedDocuments: 1, totalDocuments: 6, completedSections: 8, totalSections: 31 }));
  expect(dropdown()).toContain('Generate project: Pronto'); expect(dropdown()).toContain('System Specification · Functional requirements');
  expect(dropdown()).toContain('1 of 6 documents ready'); expect(dropdown()).toContain('8 of 31 sections saved');
  await act(async () => progress('Checking supporting references…', { stage: 'retrying', partTitle: 'Core content' }));
  expect(dropdown()).toContain('Retrying request'); expect(dropdown()).toContain('Core content');
  expect([...api.activities.values()].filter(a => a.status === 'running')).toHaveLength(1);
  await act(async () => { progress('All selected documents are ready for review.', { stage: 'complete', completedDocuments: 6, completedSections: 31, sectionTitle: null, partTitle: null }); finish(); await promise; });
  expect(dropdown()).toContain('Ready for review'); expect(dropdown()).toContain('31 of 31 sections saved');
  expect([...api.activities.values()][0].status).toBe('success');
});

test('a deliberate pause remains visible, and restarting uses a distinct activity entry', async () => {
  let promise;
  await act(async () => { promise = startGenerationRun('activity-pause', ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')))), { title: 'Generate artifact: ConOps' }); });
  const firstId = [...api.activities.keys()][0];
  await act(async () => { pauseGenerationRun('activity-pause'); await promise.catch(() => {}); });
  expect(dropdown()).toContain('Paused'); expect(dropdown()).toContain('Completed work is saved');
  let finish;
  await act(async () => { promise = startGenerationRun('activity-pause', () => new Promise(resolve => { finish = resolve; }), { title: 'Generate artifact: ConOps' }); });
  const activeId = [...api.activities.entries()].find(([, a]) => a.status === 'running')[0];
  expect(activeId).not.toBe(firstId);
  await act(async () => { finish(); await promise; });
});
