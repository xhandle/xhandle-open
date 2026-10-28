// Keep legacy scanning off the UI thread. Termination closes its IDB transaction;
// the derived index is published atomically only after complete verification.
export default function upgradeHazardTable(runId, {signal, onProgress} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Upgrade cancelled.', 'AbortError')); return; }
    const worker = new Worker(new URL('./hazardTableUpgradeWorker.js', import.meta.url));
    const finish = error => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('Upgrade cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, {once:true});
    worker.onerror = event => finish(new Error(event.message || 'Unable to upgrade saved table storage.'));
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') onProgress?.(data.progress);
      else finish(data.type === 'error' ? new Error(data.message) : undefined);
    };
    worker.postMessage({runId});
  });
}
