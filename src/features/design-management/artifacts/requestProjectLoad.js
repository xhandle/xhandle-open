import { requestArtifactWorker } from './requestArtifactWorker';
import { readProjectOverview, readProjectTrace } from './engineeringProjectLoading';

export function requestProjectLoad(id, { trace = false, sourceNodeId, draft, signal, onProgress } = {}) {
  if (typeof Worker !== 'undefined') return requestArtifactWorker(trace ? 'project-trace' : 'project-overview', { id, sourceNodeId, draft }, { signal, onProgress });
  // Non-browser environments exercise the identical storage/projection code.
  return trace ? readProjectTrace(id, onProgress, sourceNodeId, draft) : readProjectOverview(id, onProgress);
}
