import createHazardStorageWorker from './createHazardStorageWorker';
import { requestHazardStorage } from './hazardStorageClient';

let worker;
beforeEach(() => {
  jest.useFakeTimers();
  worker = { postMessage: jest.fn(), terminate: jest.fn() };
  createHazardStorageWorker.mockReturnValue(worker);
});
afterEach(() => { if (worker.onerror) worker.onerror({ message: 'Test shutdown' }); jest.useRealTimers(); });

test('one context worker correlates concurrent results and forwards backup notifications', async () => {
  const event = jest.fn(); window.addEventListener('xhandle:backup-data-changed', event);
  try {
    const first = requestHazardStorage('saveHazardAnalysis', ['p', {}]);
    const second = requestHazardStorage('loadProjectHazardAnalysisRecord', ['p']);
    const [a, b] = worker.postMessage.mock.calls.map(([data]) => data);
    worker.onmessage({ data: { id: b.id, result: { revision: 2 } } });
    worker.onmessage({ data: { event: 'xhandle:backup-data-changed', detail: { key: 'p' } } });
    worker.onmessage({ data: { id: a.id, result: { outcome: 'ok' } } });
    expect(await first).toEqual({ outcome: 'ok' }); expect(await second).toEqual({ revision: 2 });
    expect(event.mock.calls[0][0].detail.key).toBe('p');
  } finally { window.removeEventListener('xhandle:backup-data-changed', event); }
});

test('bounded requests reject overload and a crash rejects writes without replay', async () => {
  const writes = Array.from({ length: 64 }, () => requestHazardStorage('saveHazardAnalysis', ['p', {}]).catch(error => error));
  await expect(requestHazardStorage('saveHazardAnalysis', ['p', {}])).rejects.toThrow('busy');
  expect(worker.postMessage).toHaveBeenCalledTimes(64);
  worker.onerror({ message: 'Renderer worker crashed' });
  expect((await Promise.all(writes)).every(error => error.message.includes('crashed'))).toBe(true);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).toHaveBeenCalledTimes(64);
});

test('an unresponsive worker releases callers after its bounded deadline', async () => {
  const write = requestHazardStorage('saveHazardAnalysis', ['p', {}]);
  const rejected = expect(write).rejects.toThrow('timed out');
  jest.advanceTimersByTime(120000); await rejected;
  expect(worker.terminate).toHaveBeenCalled();
});
