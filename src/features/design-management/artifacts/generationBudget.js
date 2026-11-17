import { pauseError } from './generationRecovery';
export const PROJECT_REQUEST_LIMIT = 120;
export const GENERATION_TIME_LIMIT = 15 * 60 * 1000;
export function createGenerationBudget(signal, { requestLimit = PROJECT_REQUEST_LIMIT, timeLimit = GENERATION_TIME_LIMIT } = {}) {
  const controller = new AbortController();
  let deadline = Date.now() + timeLimit;
  let requests = 0, limitedRequests = 0, failure = null, finiteDepth = 0, remainingTime = 0, closed = false;
  const stop = () => controller.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
  const fail = message => { failure = new Error(message); failure.code = 'GENERATION_BUDGET'; controller.abort(); };
  const expire = () => { if (!finiteDepth && !controller.signal.aborted) fail('Generation reached its 15-minute run budget. Completed evidence reviews and sections are saved. Resume to continue from them; xHandle has stopped sending requests.'); };
  let timer = setTimeout(expire, timeLimit);
  return {
    signal: controller.signal,
    error: () => failure,
    count: () => requests,
    // A fixed, checkpointed document plan or source catalog has a natural end.
    // Its work must not pause at an arbitrary document request/deadline
    // threshold. The caller's cancellation and individual request deadlines
    // still govern every comparison, including when a project shares this budget.
    async runFiniteWork(work) {
      if (controller.signal.aborted) throw failure || pauseError();
      if (!finiteDepth) {
        if (Date.now() >= deadline) expire();
        if (controller.signal.aborted) throw failure || pauseError();
        remainingTime = deadline - Date.now(); clearTimeout(timer);
      }
      finiteDepth++;
      try { return await work(); }
      finally {
        finiteDepth--;
        if (!finiteDepth && !closed && !controller.signal.aborted) {
          deadline = Date.now() + remainingTime;
          timer = setTimeout(expire, remainingTime);
        }
      }
    },
    async request(fn, args) {
      if (controller.signal.aborted) throw failure || pauseError();
      // A background tab can delay timers. Never dispatch another request after
      // its deadline even when the timer callback has not run yet.
      if (!finiteDepth && Date.now() >= deadline) expire();
      if (!finiteDepth && limitedRequests >= requestLimit && !failure) fail(`Generation reached its ${requestLimit}-request run budget. Completed evidence reviews and sections are saved. Resume to continue from them.`);
      if (controller.signal.aborted) throw failure || pauseError();
      requests++;
      if (!finiteDepth) limitedRequests++;
      return new Promise((resolve, reject) => {
        const abort = () => reject(failure || pauseError());
        controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw failure || pauseError();
          return fn({ ...args, signal: controller.signal });
        }).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
    },
    close() { closed = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); },
  };
}
