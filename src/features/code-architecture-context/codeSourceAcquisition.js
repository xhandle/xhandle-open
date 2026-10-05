/* global globalThis */
import { retryAfterMilliseconds } from './functionalAnalysisResponse';
// Acquisition has no UI/storage side effects. All reads stay on one resolved revision.
export const SOURCE_FILE_LIMIT = 350000;
export const compareSourcePaths = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const enc = value => encodeURIComponent(value);
const base = (owner, repo) => `https://api.github.com/repos/${enc(owner)}/${enc(repo)}`;
const headers = token => ({ Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
export async function digestBytes(bytes, algorithm = 'SHA-256') {
  const hash = await globalThis.crypto.subtle.digest(algorithm, bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export const digestText = text => digestBytes(new TextEncoder().encode(text));
export async function gitBlobDigest(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header); blob.set(bytes, header.length);
  return digestBytes(blob, 'SHA-1');
}
async function json(url, token, signal) {
  const response = await fetch(url, { headers: headers(token), signal });
  if (!response.ok) throw Object.assign(new Error(`GitHub source request failed (${response.status}). The selected revision was not changed.`), {retryable:[408,429,500,502,503,504].includes(response.status),retryAfterMs:retryAfterMilliseconds(response.headers?.get?.("Retry-After"))});
  return response.json();
}
export async function resolveGitHubRevision(owner, repo, token, ref, signal) {
  const result = await json(`${base(owner, repo)}/commits/${enc(ref)}`, token, signal);
  if (!/^[a-f0-9]{40}$/i.test(result?.sha || '')) throw new Error('GitHub did not resolve an immutable commit. Previous results were preserved.');
  return result.sha;
}
export async function listGitHubSnapshot(owner, repo, token, revision, signal) {
  if (!/^[a-f0-9]{40}$/i.test(revision || '')) throw new Error('An immutable GitHub commit is required.');
  const result = await json(`${base(owner, repo)}/git/trees/${enc(revision)}?recursive=1`, token, signal);
  if (result.truncated) throw new Error('GitHub returned an incomplete file tree. Analysis was not started; select a smaller source scope. Previous results were preserved.');
  if (!Array.isArray(result.tree)) throw new Error('GitHub returned an invalid file inventory.');
  return result.tree.filter(entry => entry.type === 'blob' || entry.type === 'commit').map(entry => ({
    path: entry.path, name: entry.path.split('/').pop(), sha: entry.sha, size: entry.size || 0,
    entryKind: entry.mode === '120000' ? 'symlink' : entry.type === 'commit' ? 'submodule' : 'file',
    mode: entry.mode,
  })).sort((a, b) => compareSourcePaths(a.path, b.path));
}
function base64Bytes(value) {
  const binary = atob(value.replace(/\s/g, ''));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
export async function readGitHubSnapshotFile({ owner, repo, token, ref, sha, path, signal }) {
  if (!/^[a-f0-9]{40}$/i.test(ref || '')) throw new Error('An immutable GitHub commit is required to read source.');
  const candidates = [];
  if (sha) candidates.push(async () => {
    const result = await json(`${base(owner, repo)}/git/blobs/${enc(sha)}`, token, signal);
    if (result.encoding !== 'base64' || typeof result.content !== 'string') throw new Error('GitHub blob content unavailable.');
    return base64Bytes(result.content);
  });
  const encodedPath = path.split('/').map(enc).join('/');
  candidates.push(async () => {
    const result = await json(`${base(owner, repo)}/contents/${encodedPath}?ref=${enc(ref)}`, token, signal);
    if (result.encoding !== 'base64' || typeof result.content !== 'string') throw new Error('GitHub file content unavailable.');
    return base64Bytes(result.content);
  });
  // Public raw fallback is pinned to the same commit; never send credentials to another host.
  candidates.push(async () => {
    const response = await fetch(`https://raw.githubusercontent.com/${enc(owner)}/${enc(repo)}/${enc(ref)}/${encodedPath}`, { signal });
    if (!response.ok) throw Object.assign(new Error(`GitHub raw source unavailable (${response.status}).`), {retryable:[408,429,500,502,503,504].includes(response.status),retryAfterMs:retryAfterMilliseconds(response.headers?.get?.("Retry-After"))});
    if (Number(response.headers?.get('content-length')) > SOURCE_FILE_LIMIT) throw new Error('Source file exceeds size limit.');
    return new Uint8Array(await response.arrayBuffer());
  });
  let lastError;
  for (const read of candidates) {
    if (signal?.aborted) throw new Error('Source read cancelled.');
    try {
      const bytes = await read();
      if (bytes.length > SOURCE_FILE_LIMIT) throw new Error('Source file exceeds size limit.');
      if (sha && await gitBlobDigest(bytes) !== sha) throw new Error('Source content does not match the pinned GitHub inventory.');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (content.includes('\0')) throw new Error('Binary source content is unsupported.');
      return { ok: true, content, contentDigest: await digestBytes(bytes), textDigest: await digestText(content), size: bytes.length, decoding: 'utf8-fatal-v1' };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error(`Unable to read pinned source ${path}.`);
}
