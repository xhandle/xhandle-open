import createArtifactWorker from './createArtifactWorker';

// Bound CPU/memory use when a project prepares several documents together.
const queue = [];
let active = 0;
const abortError = () => new DOMException('Artifact processing was cancelled.', 'AbortError');
function pump() {
  while (active < 2 && queue.length) queue.shift()();
}
export function requestArtifactWorker(operation, payload, { signal, timeoutMs = 120000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    let worker, timer, started = false, finished = false;
    const hazard = operation === 'hazard-availability' || ['hazard-tracking-list', 'safety-requirements'].includes(payload?.config?.templateId);
    const timeout = () => finish(new Error(hazard ? 'Reading saved hazard analysis timed out. Saved draft work is retained; retry the source check.' : 'Background artifact processing timed out. Saved work is retained; retry or select a smaller diagram scope.'));
    const armTimeout = () => { clearTimeout(timer); timer = setTimeout(timeout, timeoutMs); };
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker?.terminate();
      if (started) active--;
      else { const index = queue.indexOf(start); if (index >= 0) queue.splice(index, 1); }
      if (error) reject(error); else resolve(result);
      pump();
    };
    const cancel = () => finish(abortError());
    const start = () => {
      started = true; active++;
      try {
        worker = createArtifactWorker();
        worker.onmessage = ({ data }) => {
          if (finished) return;
          if (data.progress) { armTimeout(); onProgress?.(data.progress); return; }
          if (data.error) finish(Object.assign(new Error(data.error.message), { name: data.error.name, code: data.error.code, artifactStage: data.error.artifactStage }));
          else finish(null, data.result);
        };
        worker.onerror = event => { event.preventDefault?.(); finish(new Error('Background artifact processing failed. Reload xHandle and retry.')); };
        worker.onmessageerror = () => finish(new Error('The background artifact result could not be read. Retry the operation.'));
        worker.postMessage({ operation, payload });
      } catch (error) { finish(error); }
    };
    if (signal?.aborted) { reject(abortError()); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    armTimeout();
    queue.push(start); pump();
  });
}
