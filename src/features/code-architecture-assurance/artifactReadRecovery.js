import { loadArtifactRowsAsync } from './artifactUtils';

export const STORAGE_RECOVERY_MESSAGE = 'Saved data is taking longer to load. Retrying automatically; available results remain visible.';

function aborted() {
  const error = new Error('Storage read cancelled.');
  error.name = 'AbortError';
  return error;
}

export function isRecoverableArtifactRead(error) {
  return ['ArtifactStorageTimeoutError', 'AbortError', 'InvalidStateError', 'UnknownError'].includes(error?.name)
    || /storage (?:upgrade is blocked|did not respond in time)/i.test(error?.message || '');
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    const cancel = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, delay);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

// Read-only recovery belongs to the mounted view, not generation or persistence.
// One failed attempt at a time; backoff caps at 30 seconds until recovery/unmount.
export async function readArtifactRowsWithRecovery(kind, projectId, repoId, { signal, onRetry } = {}) {
  let attempt = 0;
  while (!signal?.aborted) {
    try {
      const rows = await loadArtifactRowsAsync(kind, projectId, repoId);
      if (signal?.aborted) throw aborted();
      return rows;
    } catch (error) {
      if (signal?.aborted) throw aborted();
      if (!isRecoverableArtifactRead(error)) throw error;
      onRetry?.(error);
      await waitForRetry(Math.min(30000, 2000 * (2 ** Math.min(attempt++, 4))), signal);
    }
  }
  throw aborted();
}
