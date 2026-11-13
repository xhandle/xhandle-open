import { readHazardAnalysisAvailability } from './hazardAnalysisSources';
import { requestArtifactWorker } from './requestArtifactWorker';

export async function requestHazardAnalysisAvailability(owners, { signal, storage = localStorage, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const cancelled = () => new DOMException('Hazard check cancelled.', 'AbortError');
  if (signal?.aborted) throw cancelled();
  signal?.addEventListener('abort', abort, { once: true });
  let timer, stop;
  const interrupted = new Promise((_, reject) => { stop = reject; });
  const onAbort = () => stop(cancelled());
  controller.signal.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => {
    stop(new Error('Checking saved hazard analysis timed out. Your completed analysis has not been changed. Retry the check.'));
    controller.abort();
  }, timeoutMs);
  try {
    const keys = new Set();
    if (owners.some(owner => owner.workspaceType === 'functional')) { keys.add('xhandle.projects'); keys.add('xhandle.projectData'); }
    if (owners.some(owner => owner.workspaceType === 'code-architecture')) { keys.add('xhandle.codeArchitectureProjects'); keys.add('xhandle:code-architecture-hazard-analysis:v1'); }
    const inputs = Object.fromEntries([...keys].map(key => [key, storage.getItem(key)]));
    const check = typeof Worker === 'undefined' ? readHazardAnalysisAvailability(owners, storage, { signal: controller.signal })
      : requestArtifactWorker('hazard-availability', { owners, storage: inputs }, { signal: controller.signal, timeoutMs: timeoutMs + 1000 });
    return await Promise.race([check, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
