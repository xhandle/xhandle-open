import { throwIfAnalysisAborted, waitForAnalysisRetry, withAnalysisRequestDeadline } from './functionalAnalysisResponse';

const header = (response, name) => response.headers?.get?.(name);
function headerDelay(response, now) {
  const serverDate = Date.parse(header(response, 'date'));
  const reference = Number.isFinite(serverDate) ? serverDate : now;
  const retry = header(response, 'retry-after');
  const retryMs = retry == null ? 0 : /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Date.parse(retry) - reference;
  const reset = Number(header(response, 'x-ratelimit-reset')) * 1000;
  // Prefer server time when available, so a client clock offset cannot cause
  // an early retry. GitHub reset timestamps are UTC epoch seconds.
  const resetMs = header(response, 'x-ratelimit-remaining') === '0' && reset > 0
    ? reset - reference : 0;
  return Math.max(0, Number.isFinite(retryMs) ? retryMs : 0, Number.isFinite(resetMs) ? resetMs : 0);
}
async function rateLimited(response) {
  if (![403, 429].includes(response.status)) return false;
  if (response.status === 429 || header(response, 'x-ratelimit-remaining') === '0') return true;
  // A generic 403 can be permissions or SSO. Only a rate-limit message should
  // turn it into a pause. Inspect a clone so normal error handling can read it.
  const body = response.clone?.() || response;
  let message = '';
  try { message = body.json ? (await body.json())?.message || '' : await body.text?.() || ''; } catch {}
  return /(?:api |secondary )?rate limit exceeded|exceeded (?:a |the )?secondary rate limit|abuse detection/i.test(message);
}

// One cooldown per host/credential, shared by workers and repository reads in
// this renderer. Credentials never enter progress, persistence or diagnostics.
export function createGitHubRateLimitClient({ fetch: performFetch = (...args) => fetch(...args), now = () => Date.now(), wait = waitForAnalysisRetry, timeoutMs } = {}) {
  const buckets = new Map();
  return async function request(url, options = {}, { onProgress, read = response => response } = {}) {
    const auth = options.headers?.get?.('Authorization') || options.headers?.Authorization || options.headers?.authorization || '';
    const key = JSON.stringify([new URL(url).origin, auth]);
    if (!buckets.has(key)) buckets.set(key, { until: 0, users: 0 });
    const bucket = buckets.get(key); bucket.users++;
    const signal = options.signal;
    let retries = 0, paused = false;
    const gate = async () => {
      while (bucket.until > now()) {
        throwIfAnalysisAborted(signal); paused = true;
        const remaining = bucket.until - now();
        onProgress?.({ phase: 'github-rate-limit', retryAt: bucket.until, waitSeconds: Math.ceil(remaining / 1000),
          message: `Paused for GitHub API rate limit. Retrying automatically at ${new Date(bucket.until).toLocaleTimeString()} (in ${Math.ceil(remaining / 60000)} min). Keep xHandle open to resume automatically.` });
        await wait(Math.min(30000, remaining), signal);
      }
      throwIfAnalysisAborted(signal);
      if (paused) {
        paused = false;
        onProgress?.({ phase: 'github-rate-limit-resumed', retryAt: null, waitSeconds: 0, message: 'GitHub rate-limit wait complete; resuming source retrieval…' });
      }
    };
    try {
      while (true) {
        await gate();
        // Only the actual network read/body decoding has a request timeout.
        // An hour-long quota wait must not consume the normal timeout/retries.
        const result = await withAnalysisRequestDeadline(async requestSignal => {
          const response = await performFetch(url, { ...options, signal: requestSignal });
          const limited = await rateLimited(response);
          return { limited, response, delay: headerDelay(response, now()), value: limited ? undefined : await read(response) };
        }, signal, timeoutMs);
        if (!result.limited) {
          // A successful last request may exhaust the budget. Hold subsequent
          // workers before their next API call instead of waiting for a 403.
          if (result.response.ok && header(result.response, 'x-ratelimit-remaining') === '0' && result.delay > 0) bucket.until = Math.max(bucket.until, now() + result.delay + 1000);
          return result.value;
        }
        retries++;
        // GitHub supplies no reset for some secondary limits. Use bounded
        // exponential backoff there; explicit future resets can span windows.
        if (!result.delay && retries > 6) throw Object.assign(new Error('GitHub continued rate limiting after six automatic waits without a usable reset time. Completed work is retained; retry later.'), {
          code: 'GITHUB_RATE_LIMIT', retryable: false,
        });
        const delay = result.delay > 0 ? result.delay + 1000 : Math.min(60000 * (2 ** (retries - 1)), 900000);
        bucket.until = Math.max(bucket.until, now() + delay);
      }
    } finally {
      bucket.users--;
      if (!bucket.users && bucket.until <= now()) buckets.delete(key);
    }
  };
}

export const githubRateLimitedRequest = createGitHubRateLimitClient();
