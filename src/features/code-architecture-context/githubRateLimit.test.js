import { createGitHubRateLimitClient } from './githubRateLimit';
import { retryAnalysisOperation } from './functionalAnalysisResponse';
import { mapAnalysisWork } from './functionalWorkScheduler';

const url = 'https://api.github.com/repos/fixture/private/git/blobs/pinned';
const response = (status = 200, headers = {}, message = '') => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  json: async () => ({ message }),
});
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
beforeEach(() => { jest.useFakeTimers('modern'); jest.setSystemTime(new Date('2026-11-20T12:00:00Z')); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
async function advance(ms) { jest.advanceTimersByTime(ms); await settle(); }

test('an hour-long primary quota wait survives normal request deadlines and resumes the identical request', async () => {
  const reset = Date.now() / 1000 + 3600, onProgress = jest.fn();
  const fetch = jest.fn().mockResolvedValueOnce(response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }))
    .mockResolvedValue(response());
  const request = createGitHubRateLimitClient({ fetch, timeoutMs: 100 });
  const pending = retryAnalysisOperation(signal => request(url, { signal, headers: { Authorization: 'Bearer secret' } }, { onProgress }), { requestHandlesDeadline: true, timeoutMs: 100 });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onProgress.mock.calls[0][0]).toMatchObject({ phase: 'github-rate-limit', retryAt: reset * 1000 + 1000 });
  for (let i = 0; i < 120; i++) await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await advance(1000); await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(([target]) => target)).toEqual([url, url]);
  expect(fetch.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer secret')).toBe(true);
  expect(JSON.stringify(onProgress.mock.calls)).not.toContain('secret');
  expect(onProgress.mock.calls.at(-1)[0].phase).toBe('github-rate-limit-resumed');
});

test('workers with the same credential share a cooldown; unrelated credentials continue', async () => {
  const fetch = jest.fn().mockResolvedValueOnce(response(429, { 'retry-after': '180' })).mockResolvedValue(response());
  const request = createGitHubRateLimitClient({ fetch });
  const first = request(url, { headers: { Authorization: 'same' } }); await settle();
  const second = request(url + '-second', { headers: { Authorization: 'same' } }); await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  await request(url + '-other', { headers: { Authorization: 'other' } });
  expect(fetch).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 6; i++) await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(2);
  await advance(1000); await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('a successful last request gates the next one before it exhausts the quota', async () => {
  const reset = Date.now() / 1000 + 60;
  const fetch = jest.fn().mockResolvedValueOnce(response(200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) })).mockResolvedValue(response());
  const request = createGitHubRateLimitClient({ fetch });
  await request(url);
  const pending = request(url); await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  await advance(30000); await advance(30000); await advance(1000); await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
  [429, { 'retry-after': '120' }, ''],
  [403, { 'retry-after': '120' }, 'You have exceeded a secondary rate limit.'],
  [403, { 'retry-after': new Date('2026-11-20T12:02:00Z').toUTCString() }, 'API rate limit exceeded for user ID 123.'],
])('honors long Retry-After for status %s', async (status, headers, message) => {
  const fetch = jest.fn().mockResolvedValueOnce(response(status, headers, message)).mockResolvedValue(response());
  const request = createGitHubRateLimitClient({ fetch });
  const pending = request(url); await settle();
  for (let i = 0; i < 4; i++) await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await advance(1000); await pending; expect(fetch).toHaveBeenCalledTimes(2);
});

test('server time protects against a client clock that is an hour fast', async () => {
  const reset = Date.now() / 1000 - 3540;
  const fetch = jest.fn().mockResolvedValueOnce(response(403, { date: new Date(Date.now() - 3600000).toUTCString(), 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) })).mockResolvedValue(response());
  const request = createGitHubRateLimitClient({ fetch });
  const pending = request(url); await settle();
  await advance(30000); await advance(30000); expect(fetch).toHaveBeenCalledTimes(1);
  await advance(1000); await pending; expect(fetch).toHaveBeenCalledTimes(2);
});

test('permission and authentication errors do not start a rate-limit wait', async () => {
  for (const status of [401, 403, 404]) {
    const fetch = jest.fn().mockResolvedValue(response(status, {}, 'Resource not accessible by personal access token.'));
    const onProgress = jest.fn(), request = createGitHubRateLimitClient({ fetch });
    expect((await request(url, {}, { onProgress })).status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(1); expect(onProgress).not.toHaveBeenCalled();
  }
});

test('a secondary limit without headers backs off and stops after six waits', async () => {
  let now = 1000;
  const wait = jest.fn(async ms => { now += ms; });
  const fetch = jest.fn().mockResolvedValue(response(403, {}, 'You have exceeded a secondary rate limit.'));
  const request = createGitHubRateLimitClient({ fetch, now: () => now, wait });
  await expect(request(url)).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMIT', retryable: false });
  expect(fetch).toHaveBeenCalledTimes(7);
  expect(wait.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBe(60000 + 120000 + 240000 + 480000 + 900000 + 900000);
});

test('Stop analysis interrupts an hour-long wait immediately and prevents another request', async () => {
  const controller = new AbortController(), onProgress = jest.fn();
  const fetch = jest.fn().mockResolvedValue(response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.now() / 1000 + 3600) }));
  const request = createGitHubRateLimitClient({ fetch });
  const pending = request(url, { signal: controller.signal }, { onProgress });
  const rejected = expect(pending).rejects.toThrow(/Stopped|cancelled/);
  await settle(); controller.abort(new Error('Stopped')); await rejected;
  await advance(3601000); expect(fetch).toHaveBeenCalledTimes(1);
});

test('actual stalled network reads still time out and abort their request signal', async () => {
  let signal;
  const fetch = jest.fn((target, options) => { signal = options.signal; return new Promise(() => {}); });
  const request = createGitHubRateLimitClient({ fetch, timeoutMs: 100 });
  const pending = request(url), rejected = expect(pending).rejects.toMatchObject({ code: 'FUNCTIONAL_REQUEST_TIMEOUT' });
  await settle(); await advance(100); await rejected; expect(signal.aborted).toBe(true);
});

test('a new explicit quota reset can pause the same request again without exhausting transient retries', async () => {
  let now = Date.now();
  const fetch = jest.fn(async () => fetch.mock.calls.length < 3
    ? response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 3600000) / 1000) }) : response());
  const request = createGitHubRateLimitClient({ fetch, now: () => now, wait: async ms => { now += ms; } });
  await request(url);
  expect(fetch.mock.calls.map(([target]) => target)).toEqual([url, url, url]);
  expect(now - Date.parse('2026-11-20T12:00:00Z')).toBe(7202000);
});

test('6000 files can cross multiple 5000-request quota windows without restarting completed reads', async () => {
  let now = Date.now(), allowance = 5000, pauses = 0;
  const fetched = [];
  const fetch = jest.fn(async target => {
    fetched.push(target); allowance--;
    return response(200, allowance === 0 ? { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 3600000) / 1000) } : {});
  });
  const wait = async ms => { now += ms; };
  const request = createGitHubRateLimitClient({ fetch, now: () => now, wait });
  const onProgress = update => { if (update.phase === 'github-rate-limit-resumed') { allowance = 5000; pauses++; } };
  const paths = Array.from({ length: 6000 }, (_, i) => `${url}/${i}`);
  // Both source-manifest and analysis passes use the same shared gate.
  for (let pass = 0; pass < 2; pass++) {
    const result = await mapAnalysisWork(paths, target => request(target, {}, { onProgress }), { concurrency: 4 });
    expect(result).toHaveLength(6000);
  }
  expect(fetch).toHaveBeenCalledTimes(12000);
  expect(new Set(fetched).size).toBe(6000);
  expect(pauses).toBeGreaterThanOrEqual(2);
  expect(now - Date.parse('2026-11-20T12:00:00Z')).toBeGreaterThanOrEqual(7200000);
}, 15000);
