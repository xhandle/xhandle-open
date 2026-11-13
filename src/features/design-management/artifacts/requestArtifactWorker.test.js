import createArtifactWorker from './createArtifactWorker';
import { requestArtifactWorker } from './requestArtifactWorker';
import { artifactStorageSnapshot, captureLiveSourceHash, captureLiveSources, checkedCapturedSources } from './artifactSources';
import { requestArchitectureLayout } from './requestArchitectureLayout';
import { requestHazardAnalysisAvailability } from './requestHazardAnalysisAvailability';

let workers;
const config = { projectId: 'p', workspaceType: 'code-architecture', sources: [], architectureSources: [] };
beforeEach(() => {
  workers = [];
  global.Worker = function Worker() {};
  createArtifactWorker.mockImplementation(() => {
    const worker = { postMessage: jest.fn(), terminate: jest.fn() };
    workers.push(worker); return worker;
  });
  localStorage.clear();
});
afterEach(() => { delete global.Worker; jest.useRealTimers(); });
const done = (worker, result) => worker.onmessage({ data: { result } });

test('bounds workers, cancels queued and active work, and releases capacity', async () => {
  const first = new AbortController(), queued = new AbortController();
  const a = requestArtifactWorker('source-hash', {}, { signal: first.signal });
  const b = requestArtifactWorker('source-hash', {});
  const c = requestArtifactWorker('source-hash', {}, { signal: queued.signal });
  expect(workers).toHaveLength(2);
  queued.abort(); await expect(c).rejects.toMatchObject({ name: 'AbortError' });
  first.abort(); await expect(a).rejects.toMatchObject({ name: 'AbortError' });
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  done(workers[1], 'checksum'); await expect(b).resolves.toBe('checksum');
  expect(workers).toHaveLength(2);
});
test('a failed worker is terminated and never falls back to blocking the page', async () => {
  const promise = requestArtifactWorker('sources', {});
  workers[0].onerror({ preventDefault: jest.fn() });
  await expect(promise).rejects.toThrow('Background artifact processing failed');
  expect(workers[0].terminate).toHaveBeenCalled();
});
test('hung workers time out and release their slot', async () => {
  jest.useFakeTimers();
  const promise = requestArtifactWorker('sources', {}, { timeoutMs: 100 });
  jest.advanceTimersByTime(100);
  await expect(promise).rejects.toThrow('timed out');
  expect(workers[0].terminate).toHaveBeenCalled();
});
test('freshness asks for a checksum only and passes no unrelated workspace data', async () => {
  localStorage.setItem('unrelated-private-data', 'not an artifact input');
  localStorage.setItem('xhandle:requirements', 'unselected large module');
  const promise = captureLiveSourceHash(config);
  const message = workers[0].postMessage.mock.calls[0][0];
  expect(message.operation).toBe('source-hash');
  expect(message.payload.storage).not.toHaveProperty('unrelated-private-data');
  expect(message.payload.storage).not.toHaveProperty('xhandle:requirements');
  done(workers[0], 'checksum'); await expect(promise).resolves.toBe('checksum');
});
test('rejects a snapshot when local inputs change before publication', async () => {
  const promise = captureLiveSources(config);
  done(workers[0], { entries: [], hash: 'snapshot' });
  const sources = await promise;
  expect(checkedCapturedSources(config, sources)).toBe(sources);
  localStorage.setItem('xhandle:req-projects', '[{"id":"new-folder"}]');
  expect(() => checkedCapturedSources(config, sources)).toThrow('Source inputs changed');
});
test('preserves functional presentation and deletion markers in worker inputs', () => {
  localStorage.setItem('diagram:positions:p:edge-routing:v1', 'saved routing');
  localStorage.setItem('xhandle:deleted-project:v1:functional:p', 'deleted');
  const values = artifactStorageSnapshot({ ...config, workspaceType: 'functional', architectureSources: [{ workspaceType: 'functional', projectId: 'p' }] }, localStorage);
  expect(values['diagram:positions:p:edge-routing:v1']).toBe('saved routing');
  expect(values['xhandle:deleted-project:v1:functional:p']).toBe('deleted');
});
test('layout transfers topology only, retaining the source evidence in the original snapshot', async () => {
  const diagram = { snapshot: { nodes: [{ id: 'n', label: 'CSU', members: [{ savedEvidence: 'large original evidence' }] }], edges: [{ id: 'e', from: 'n', to: 'n', label: 'Exchange '.repeat(1000) }] } };
  const promise = requestArchitectureLayout(diagram);
  expect(workers[0].postMessage.mock.calls[0][0].payload.snapshot.nodes[0]).not.toHaveProperty('members');
  expect(diagram.snapshot.nodes[0].members).toHaveLength(1);
  expect(workers[0].postMessage.mock.calls[0][0].payload.snapshot.edges[0].label).toHaveLength(241);
  expect(diagram.snapshot.edges[0].label).toHaveLength(9000);
  done(workers[0], { nodes: [], edges: [] }); await promise;
});

test('forwards loading progress without completing or releasing the worker early', async () => {
  const progress = jest.fn();
  const promise = requestArtifactWorker('project-overview', { id: 'p' }, { onProgress: progress });
  workers[0].onmessage({ data: { progress: { percent: 50, stage: 'Reading document summaries' } } });
  expect(progress).toHaveBeenCalledWith({ percent: 50, stage: 'Reading document summaries' });
  expect(workers[0].terminate).not.toHaveBeenCalled();
  done(workers[0], { program: { id: 'p' }, records: [] });
  await expect(promise).resolves.toMatchObject({ program: { id: 'p' } });
  workers[0].onmessage({ data: { progress: { percent: 100 } } });
  expect(progress).toHaveBeenCalledTimes(1);
});

test('hazard availability requests counts in the background without transferring unrelated module data', async () => {
  localStorage.setItem('xhandle:requirements', 'large unselected requirements');
  localStorage.setItem('xhandle.projectData', 'large unrelated functional-project data');
  const promise = requestHazardAnalysisAvailability([{ id: 'p', workspaceType: 'code-architecture' }]);
  const message = workers[0].postMessage.mock.calls[0][0];
  expect(message.operation).toBe('hazard-availability');
  expect(message.payload.storage).not.toHaveProperty('xhandle:requirements');
  expect(message.payload.storage).not.toHaveProperty('xhandle.projectData');
  done(workers[0], { rows: 100000, analyses: 1 });
  await expect(promise).resolves.toEqual({ rows: 100000, analyses: 1 });
});

test('a stalled availability check times out, cancels its worker and can be retried', async () => {
  jest.useFakeTimers();
  const owners = [{ id: 'p', workspaceType: 'code-architecture' }];
  const promise = requestHazardAnalysisAvailability(owners, { timeoutMs: 100 });
  jest.advanceTimersByTime(100);
  await expect(promise).rejects.toThrow('Checking saved hazard analysis timed out');
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  const retry = requestHazardAnalysisAvailability(owners);
  done(workers[1], { rows: 300, analyses: 1 });
  await expect(retry).resolves.toEqual({ rows: 300, analyses: 1 });
});

test('source row progress keeps an active hazard read alive while a stalled read still times out', async () => {
  jest.useFakeTimers();
  const progress = jest.fn();
  const promise = requestArtifactWorker('source-hash', { config: { templateId: 'hazard-tracking-list' } }, { timeoutMs: 100, onProgress: progress });
  jest.advanceTimersByTime(80);
  workers[0].onmessage({ data: { progress: { completed: 100, total: 26278 } } });
  jest.advanceTimersByTime(80); expect(workers[0].terminate).not.toHaveBeenCalled();
  done(workers[0], 'hash'); await expect(promise).resolves.toBe('hash');
  const stalled = requestArtifactWorker('source-hash', { config: { templateId: 'hazard-tracking-list' } }, { timeoutMs: 100 });
  jest.advanceTimersByTime(100);
  await expect(stalled).rejects.toThrow('Reading saved hazard analysis timed out');
});
