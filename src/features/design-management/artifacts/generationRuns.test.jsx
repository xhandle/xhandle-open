import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { startGenerationRun, generationRunState, pauseGenerationRun, useGenerationRun } from './generationRuns';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function Monitor({ id }) { const state = useGenerationRun(id); return <p>{state.running ? state.progress : state.error || 'Finished'}</p>; }
afterEach(() => jest.restoreAllMocks());
test('navigation does not abort work and a remounted editor observes the same run', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host), pending = deferred(); let signal;
  let run;
  await act(async () => {
    root.render(<Monitor id="navigation" />);
    run = startGenerationRun('navigation', async options => { signal = options.signal; options.onProgress('Generating section two'); return pending.promise; });
  });
  expect(host.textContent).toBe('Generating section two');
  await act(async () => root.render(<p>Another view</p>)); expect(signal.aborted).toBe(false);
  await act(async () => root.render(<Monitor id="navigation" />)); expect(host.textContent).toBe('Generating section two');
  await act(async () => { pending.resolve('complete'); await run; }); expect(host.textContent).toBe('Finished');
  await act(async () => root.unmount());
});
test('duplicate starts share one request lifetime and deliberate Pause remains effective', async () => {
  const work = jest.fn(async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')))));
  const first = startGenerationRun('duplicate', work), second = startGenerationRun('duplicate', work);
  expect(first).toBe(second); await Promise.resolve(); pauseGenerationRun('duplicate');
  await expect(first).rejects.toMatchObject({ name: 'AbortError' }); expect(work).toHaveBeenCalledTimes(1);
  expect(generationRunState('duplicate')).toMatchObject({ running: false, error: 'Paused. Completed work is saved.' });
});
test('an occupied cross-tab generation lock prevents a second paid request', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: jest.fn(async (_name, _options, callback) => callback(null)) } });
  const work = jest.fn();
  try {
    await expect(startGenerationRun('another-tab', work)).rejects.toThrow('another tab'); expect(work).not.toHaveBeenCalled();
  } finally { delete navigator.locks; }
});
