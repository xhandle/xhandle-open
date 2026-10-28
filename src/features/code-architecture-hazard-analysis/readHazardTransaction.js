// Own the transaction so cancellation retires queued reads, not just their caller.
export async function readHazardTransaction(db, storeName, read, {signal, readTimeoutMs = 10000, mode = 'readonly'} = {}) {
  const cancelled = () => new DOMException('Hazard loading cancelled.', 'AbortError');
  if (signal?.aborted) throw cancelled();
  const tx = db.transaction(storeName, mode);
  const retired = tx.done;
  retired.catch(() => {});
  let rejectStop, stopped;
  const interruption = new Promise((_, reject) => { rejectStop = reject; });
  const stop = error => {
    if (stopped) return;
    stopped = error;
    try { tx.abort(); } catch {}
    rejectStop(error);
  };
  const abort = () => stop(cancelled());
  const timer = setTimeout(() => stop(new Error('Reading saved hazard storage timed out. Retry loading.')), readTimeoutMs);
  signal?.addEventListener('abort', abort, {once: true});
  try {
    if (signal?.aborted) abort();
    const value = await Promise.race([Promise.resolve().then(() => {
      if (stopped) throw stopped;
      return read(tx.objectStore(storeName));
    }), interruption]);
    await retired;
    if (stopped) throw stopped;
    return value;
  } catch (error) {
    try { tx.abort(); } catch {}
    await retired.catch(() => {});
    throw stopped || error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
