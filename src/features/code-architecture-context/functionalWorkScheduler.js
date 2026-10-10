import { waitForAnalysisRetry } from './functionalAnalysisResponse';

export function checkWorkAbort(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Analysis cancelled.'), { name: 'AbortError' });
}

// Stop dispatch on fatal failure and drain workers before the caller can publish
// or start another run. Results retain input order, regardless of completion order.
export async function mapAnalysisWork(items, work, { concurrency = 4, signal } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const results = new Array(items.length);
  let cursor = 0, failure;
  try {
    await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
      while (!controller.signal.aborted && cursor < items.length) {
        const index = cursor++;
        try { results[index] = await work(items[index], index, controller.signal); }
        catch (error) { if (!failure) failure = error; stop(); }
      }
    }));
    if (failure) throw failure;
    checkWorkAbort(controller.signal);
    return results;
  } finally { signal?.removeEventListener('abort', stop); }
}

// One lane for write operations. A rejected write is visible to its caller but
// cannot leave subsequent writes detached or permanently wedged.
export function serialAnalysisWriter() {
  let tail = Promise.resolve();
  return operation => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
}

// Reserve start times, not completion times. The provider may run requests in
// parallel, but fast responses/retries cannot burst through the API rate limit.
export function createAnalysisPacer({ intervalMs = 1100, now = () => Date.now(), wait = waitForAnalysisRetry } = {}) {
  let nextStart = 0;
  return async signal => {
    checkWorkAbort(signal);
    const time = now(), start = Math.max(time, nextStart);
    nextStart = start + intervalMs;
    await wait(Math.max(0, start - time), signal);
    checkWorkAbort(signal);
  };
}
