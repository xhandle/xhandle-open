import { withAnalysisRequestDeadline } from './functionalAnalysisResponse';

// A health response proves backend reachability, not provider health. Keep slow
// provider requests bounded rather than assuming every timeout means offline.
export async function probeFunctionalConnectivity(url, { signal, fetchImpl = fetch, timeoutMs = 5000, isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false } = {}) {
  check(signal);
  if (isOffline()) return true;
  try {
    await withAnalysisRequestDeadline(async requestSignal => {
      const response = await fetchImpl(url, { signal: requestSignal, cache: 'no-store' });
      await response.body?.cancel();
    }, signal, timeoutMs);
    return false;
  } catch (error) {
    check(signal);
    if (error instanceof TypeError || error.code === 'FUNCTIONAL_REQUEST_TIMEOUT') return true;
    throw error;
  }
}

// HTTP failures retain their classification through all semantic processing stages.
export const FUNCTIONAL_RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
export function backendConnectionError(error) {
  return Object.assign(new Error(error?.message || 'Unable to connect to the xHandle backend.'), { cause: error, code: 'FUNCTIONAL_BACKEND_UNAVAILABLE', retryable: true, connectivity: true });
}
export function functionalHttpError(status, detail = '', payload = {}) {
  return Object.assign(new Error(`HTTP ${status}${detail ? `: ${detail}` : ''}`), {
    status, code: typeof payload?.code === 'string' ? payload.code : 'FUNCTIONAL_HTTP_ERROR',
    retryable: FUNCTIONAL_RETRY_STATUSES.has(status),
    connectivity: status === 503 && payload?.code === 'AI_PROVIDER_UNAVAILABLE',
  });
}
export function isFunctionalTransportError(error) {
  return typeof error?.retryable === 'boolean' || error instanceof TypeError;
}
function check(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Analysis cancelled.'), { name: 'AbortError' });
}
export function waitForConnectivityRetry(ms, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Analysis cancelled.'), { name: 'AbortError' })); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
// Waiting is OUTSIDE request deadlines and content retry budgets. Only explicitly
// identified connectivity failures wait indefinitely; auth, validation and generic
// server failures keep their bounded recovery policy. The real request probes
// recovery (navigator.onLine cannot tell whether the backend/provider is reachable).
export async function withFunctionalConnectivityRecovery(operation, {
  signal, onStatus = () => {}, wait = waitForConnectivityRetry, probeConnectivity, maxTimeoutAttempts = 3,
} = {}) {
  let failures = 0;
  let timeouts = 0;
  for (;;) {
    check(signal);
    try {
      const result = await operation();
      check(signal);
      if (failures) onStatus('Connection recovered; continuing analysis…');
      return result;
    } catch (error) {
      check(signal);
      let recoveryError = error;
      if (error?.code === 'FUNCTIONAL_REQUEST_TIMEOUT') {
        const disconnected = probeConnectivity ? await probeConnectivity(signal) : false;
        check(signal);
        if (disconnected) recoveryError = backendConnectionError(error);
        else {
          if (++timeouts >= maxTimeoutAttempts) throw error;
          onStatus('The analysis request timed out; retrying the same work…');
          await wait(Math.min(30000, 2000 * timeouts), signal);
          continue;
        }
      }
      if (!recoveryError?.connectivity) throw recoveryError;
      const delay = Math.min(30000, 2000 * (2 ** Math.min(failures++, 4)));
      const destination = recoveryError.code === 'FUNCTIONAL_BACKEND_UNAVAILABLE' ? 'xHandle backend' : 'AI provider';
      onStatus(`Waiting for connection to ${destination}; analysis will resume automatically. Retrying in ${delay / 1000}s.`);
      await wait(delay, signal);
    }
  }
}
