import { backendConnectionError, functionalHttpError, withFunctionalConnectivityRecovery, waitForConnectivityRetry, probeFunctionalConnectivity } from './functionalTransportRecovery';
import { analyzeFunctionalSourceChunk, withAnalysisRequestDeadline } from './functionalAnalysisResponse';

test('stalled request and stalled health probe recover without consuming source retries', async () => {
  const state = {}; let calls = 0;
  const header = '| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  const request = jest.fn(() => withFunctionalConnectivityRecovery(() => withAnalysisRequestDeadline(() => ++calls < 5 ? new Promise(() => {}) : header, undefined, 1), {
    probeConnectivity: signal => probeFunctionalConnectivity('/api/health', { signal, isOffline: () => false, fetchImpl: () => new Promise(() => {}), timeoutMs: 1 }),
    wait: async () => {},
  }));
  await expect(analyzeFunctionalSourceChunk({ content: 'x'.repeat(4096), state, request, requestHandlesDeadline: true })).resolves.toEqual([]);
  expect(calls).toBe(5); expect(state.requests).toBe(1); expect(state.splits).toEqual({});
});

test('reachable slow service is bounded and does not split source', async () => {
  const state = {}, operation = jest.fn(() => withAnalysisRequestDeadline(() => new Promise(() => {}), undefined, 1));
  await expect(analyzeFunctionalSourceChunk({ content: 'x'.repeat(4096), state, requestHandlesDeadline: true,
    request: () => withFunctionalConnectivityRecovery(operation, { probeConnectivity: async () => false, wait: async () => {} }),
  })).rejects.toMatchObject({ code: 'FUNCTIONAL_REQUEST_TIMEOUT' });
  expect(operation).toHaveBeenCalledTimes(3); expect(state.splits).toEqual({});
});

test('cancel interrupts a stalled health probe', async () => {
  const controller = new AbortController();
  const pending = probeFunctionalConnectivity('/api/health', { signal: controller.signal, isOffline: () => false, fetchImpl: () => new Promise(() => {}) });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
});

test('HTTP response means reachable and offline state avoids probing', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ status: 503 });
  await expect(probeFunctionalConnectivity('/api/health', { fetchImpl, isOffline: () => false })).resolves.toBe(false);
  await expect(probeFunctionalConnectivity('/api/health', { fetchImpl, isOffline: () => true })).resolves.toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each([520, 521, 522, 523, 524, 529, 500, 503])('HTTP %s is retryable but does not wait indefinitely', status => {
  expect(functionalHttpError(status)).toMatchObject({ retryable: true, connectivity: false });
});
test.each([400, 401, 403, 404, 413])('HTTP %s requires attention rather than automatic connectivity recovery', async status => {
  const error = functionalHttpError(status);
  const operation = jest.fn().mockRejectedValue(error), wait = jest.fn();
  await expect(withFunctionalConnectivityRecovery(operation, { wait })).rejects.toBe(error);
  expect(operation).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
});
test('waits across an hour-long outage, caps probe frequency, and reuses the original operation', async () => {
  let elapsed = 0;
  const operation = jest.fn(async () => {
    if (elapsed < 3600000) throw backendConnectionError(new TypeError('Failed to fetch'));
    return 'validated response';
  });
  const wait = jest.fn(async ms => { elapsed += ms; });
  const onStatus = jest.fn();
  await expect(withFunctionalConnectivityRecovery(operation, { wait, onStatus })).resolves.toBe('validated response');
  expect(elapsed).toBeGreaterThanOrEqual(3600000);
  expect(Math.max(...wait.mock.calls.map(([ms]) => ms))).toBe(30000);
  expect(onStatus.mock.calls[0][0]).toContain('xHandle backend');
});
test('provider connectivity is distinct from local backend failure', async () => {
  const operation = jest.fn().mockRejectedValueOnce(functionalHttpError(503, '', { code: 'AI_PROVIDER_UNAVAILABLE' })).mockResolvedValue('ok');
  const onStatus = jest.fn();
  await withFunctionalConnectivityRecovery(operation, { wait: async () => {}, onStatus });
  expect(onStatus.mock.calls[0][0]).toContain('AI provider');
});
test('cancel interrupts an outage immediately and does not send another request', async () => {
  jest.useFakeTimers();
  try {
    const controller = new AbortController();
    const operation = jest.fn().mockRejectedValue(backendConnectionError(new TypeError('offline')));
    const pending = withFunctionalConnectivityRecovery(operation, { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await rejection;
    expect(operation).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
test('a chunk connectivity wait does not exhaust its content budget or split source', async () => {
  const table = '| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| A | a.py | A | Call | Call B | B | a.py | B |';
  const state = {}; let probes = 0;
  const request = jest.fn(() => withFunctionalConnectivityRecovery(async () => {
    if (++probes < 10) throw backendConnectionError(new TypeError('offline'));
    return table;
  }, { wait: async () => {} }));
  await expect(analyzeFunctionalSourceChunk({ content: 'x'.repeat(2000), request, state, requestHandlesDeadline: true })).resolves.toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(1); expect(state.requests).toBe(1); expect(state.splits).toEqual({});
});
test('abort before waiting is honored', async () => {
  const controller = new AbortController(); controller.abort();
  expect(() => waitForConnectivityRetry(30000, controller.signal)).toThrow();
});

test('520 retries the same source without splitting and preserves accepted checkpoint data', async () => {
  const response = '| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  const state = {};
  const request = jest.fn().mockRejectedValueOnce(functionalHttpError(520)).mockResolvedValue(response);
  const wait = jest.fn(async () => {}), onCheckpoint = jest.fn();
  const args = { content: 'x'.repeat(4096), state, request, wait, onCheckpoint };
  await analyzeFunctionalSourceChunk(args);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.map(([source]) => source)).toEqual([args.content, args.content]);
  expect(state.splits).toEqual({}); expect(onCheckpoint).toHaveBeenCalledTimes(1);
  await analyzeFunctionalSourceChunk(args);
  expect(request).toHaveBeenCalledTimes(2);
});

test('an exhausted 520 remains retryable for file recovery without splitting', async () => {
  const state = {}, request = jest.fn().mockRejectedValue(functionalHttpError(520));
  await expect(analyzeFunctionalSourceChunk({ content: 'x'.repeat(4096), state, request, wait: async () => {} }))
    .rejects.toMatchObject({ status: 520, retryable: true, connectivity: false });
  expect(request).toHaveBeenCalledTimes(3); expect(state.splits).toEqual({});
});
