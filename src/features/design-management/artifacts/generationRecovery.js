export const pauseError = () => new DOMException('Generation paused.', 'AbortError');
export function generationError(code, message, retryAfterMs = 0) {
  const error = new Error(message); error.code = code; error.retryAfterMs = retryAfterMs; return error;
}
export function retryAfterDelay(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
export function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(pauseError()); return; }
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(pauseError()); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export function transportFailure(response) {
  const status = response.status;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return generationError('TRANSIENT_PROVIDER', 'The AI service is temporarily unavailable. Completed work is saved. Resume when the service is available.', retryAfterDelay(response.headers?.get?.('Retry-After')));
  if (status === 401 || status === 403) return generationError('PROVIDER_AUTH', 'The AI provider could not authorize this request. Check your AI provider credentials. Completed work is saved.');
  return generationError('PROVIDER_REQUEST', `The AI provider rejected the request (${status}). Check the selected model and provider settings. Completed work is saved.`);
}
