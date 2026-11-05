// Cooperative scheduling only: no records or row bodies are retained here.
// The renderer forwards its priority state to indexing workers. They pause at
// transaction boundaries, leaving authoritative table reads free to finish.
let readers = 0;
let remoteBusy = false;
const listeners = new Set();
export const isForegroundStorageBusy = () => readers > 0 || remoteBusy;
const notify = () => { for (const listener of listeners) listener(isForegroundStorageBusy()); };
export function acquireForegroundStoragePriority() {
  readers++; notify();
  let released = false;
  return () => { if (!released) { released = true; readers--; notify(); } };
}
export function setRemoteForegroundStorageBusy(value) {
  remoteBusy = Boolean(value); notify();
}
export function subscribeForegroundStoragePriority(listener) {
  listeners.add(listener); listener(isForegroundStorageBusy());
  return () => listeners.delete(listener);
}
export function waitForForegroundStorage(signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Indexing cancelled.', 'AbortError'));
  if (!isForegroundStorageBusy()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { listeners.delete(changed); signal?.removeEventListener('abort', abort); };
    const changed = busy => { if (!busy) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(signal.reason || new DOMException('Indexing cancelled.', 'AbortError')); };
    listeners.add(changed); signal?.addEventListener('abort', abort, {once:true});
  });
}
