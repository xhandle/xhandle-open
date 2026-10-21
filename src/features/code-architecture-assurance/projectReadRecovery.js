// Read-only recovery: each attempt owns its connection/transactions via signal.
export function readProjectWithRecovery(read, { signal, onProgress, onRetry, idleMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false, active = null, timer, retryTimer, failures = 0, lastActivity = Date.now();
    const cancelled = () => signal?.reason || new DOMException('Project load cancelled.', 'AbortError');
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(retryTimer);
      signal?.removeEventListener('abort', stop);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
    const finish = (error, result) => {
      if (done) return;
      done = true; cleanup(); active?.abort(); active = null;
      if (error) reject(error); else resolve(result);
    };
    const stop = () => finish(cancelled());
    const transient = error => ['AbortError','InvalidStateError','UnknownError','ProjectReadTimeoutError'].includes(error?.name)
      || /Storage upgrade blocked/i.test(error?.message || '');
    const fail = (owner, error) => {
      if (done || active !== owner) return;
      active = null; clearTimeout(timer); owner.abort(error);
      if (!transient(error)) { finish(error); return; }
      onRetry?.(error);
      retryTimer = setTimeout(start, Math.min(30000, 2000 * 2 ** Math.min(failures++, 4)));
    };
    const expire = () => {
      if (!active) return;
      const error = new Error('Saved project storage stopped responding.');
      error.name = 'ProjectReadTimeoutError';
      fail(active, error);
    };
    const resume = () => {
      if (document.visibilityState === 'hidden' || done) return;
      if (active && Date.now() - lastActivity >= idleMs) expire();
      if (!active) { clearTimeout(retryTimer); start(); }
    };
    function start() {
      if (done || active) return;
      if (signal?.aborted) { stop(); return; }
      const owner = new AbortController(); active = owner;
      const progress = value => {
        if (done || active !== owner) return;
        lastActivity = Date.now(); clearTimeout(timer); timer = setTimeout(expire, idleMs);
        onProgress?.(value);
      };
      progress(0);
      Promise.resolve().then(() => read({ signal: owner.signal, onProgress: progress }))
        .then(result => { if (!done && active === owner) finish(null, result); }, error => fail(owner, error));
    }
    signal?.addEventListener('abort', stop, { once: true });
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    start();
  });
}
