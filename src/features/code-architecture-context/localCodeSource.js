import { digestBytes, digestText } from './codeSourceAcquisition';
import { openDB } from 'idb';
import { localCodeSourceDescriptor } from './codeSourceIdentity';

const sessions = new Map();
const EXCLUDED_DIR = /(^|\/)(node_modules|\.git|\.svn|\.hg|\.next|dist|build|target|coverage|venv|\.venv|site-packages|__pycache__|vendor|third_party|thirdparty|external|dependencies|deps)(\/|$)/i;
const SECRET = /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|id_rsa|id_ed25519|[^/]*\.(pem|key|p12|pfx))$/i;
const TEXT_FILE = /(?:\.(?:mjs|cjs|js|jsx|ts|tsx|py|c|cc|cp|cpp|cxx|h|hh|hpp|hxx|ipp|inl|tpp|go|rs|java|cs|swift|m|mm|scala|ino|kt|kts|rb|php|sh|bash|zsh|md|rst|txt|yaml|yml|json|toml|xml|msg|srv|action|proto|idl|ini|cfg|cmake)$|(?:^|\/)(?:README|Dockerfile|Makefile|CMakeLists\.txt|Jenkinsfile)$)/i;

export function normalizeLocalPath(value) {
  const path = String(value || '').replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('Invalid project-relative file path.');
  }
  return path;
}

export function localFileExclusion(path, size = 0) {
  if (EXCLUDED_DIR.test(path)) return 'dependency/generated directory';
  if (SECRET.test(path)) return 'credential/configuration secret';
  if (!TEXT_FILE.test(path)) return 'unsupported or binary file type';
  return '';
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError');
}

export async function hashLocalText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function handlesDB() {
  return openDB('xhandle_local_source_handles', 1, {
    upgrade(db) { db.createObjectStore('handles'); },
  });
}

async function saveHandle(id, handle) {
  const db = await handlesDB();
  try { await db.put('handles', handle, id); } finally { db.close(); }
}

async function readHandle(id) {
  const db = await handlesDB();
  try { return await db.get('handles', id); } finally { db.close(); }
}

export function registerLocalFolder({ files, handle, sourceId, folderName, rememberHandle = true }) {
  const id = sourceId || crypto.randomUUID();
  const name = folderName || handle?.name || files?.[0]?.webkitRelativePath?.split('/')[0];
  if (!name) throw new Error('Select a project folder containing source files.');
  sessions.set(id, { files: files ? Array.from(files) : null, handle, folderName: name });
  // A failed handle save still leaves a valid session; reload offers reconnect.
  if (handle && rememberHandle) saveHandle(id, handle).catch(() => {});
  return localCodeSourceDescriptor({ sourceType: 'local', sourceId: id, folderName: name });
}

export async function connectLocalFolder(input) {
  const previous = input.sourceId ? sessions.get(input.sourceId) : null;
  const source = registerLocalFolder({ ...input, rememberHandle: false });
  try {
    const scan = await scanLocalFolder(source);
    if (input.handle) saveHandle(source.sourceId, input.handle).catch(() => {});
    return { source, scan };
  } catch (error) {
    if (previous) sessions.set(source.sourceId, previous);
    else sessions.delete(source.sourceId);
    throw error;
  }
}

export async function chooseLocalFolder(sourceId) {
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  return connectLocalFolder({ handle, sourceId });
}

export async function getLocalFolderSession(source) {
  if (sessions.has(source.sourceId)) return sessions.get(source.sourceId);
  const handle = await readHandle(source.sourceId).catch(() => null);
  if (handle && await handle.queryPermission({ mode: 'read' }).catch(() => 'denied') === 'granted') {
    const session = { handle, folderName: handle.name };
    sessions.set(source.sourceId, session);
    return session;
  }
  throw new Error('Reconnect this local project folder in repository configuration before analyzing. Saved results are still available.');
}

export async function scanLocalFolder(source, { signal } = {}) {
  const session = await getLocalFolderSession(source);
  const entries = [];
  const skipped = [];
  let visited = 0;
  let bytes = 0;
  const add = (path, file, getFile) => {
    checkAbort(signal);
    visited++;
    path = normalizeLocalPath(path);
    const reason = localFileExclusion(path, file.size);
    if (reason) { skipped.push({ path, reason }); return; }
    bytes += file.size;
    entries.push({ path, name: file.name, size: file.size, lastModified: file.lastModified, getFile });
  };
  if (session.handle) {
    const visit = async (directory, prefix = '') => {
      for await (const [name, entry] of directory.entries()) {
        checkAbort(signal);
        const path = normalizeLocalPath(`${prefix}${name}`);
        if (entry.kind === 'directory') {
          if (EXCLUDED_DIR.test(`${path}/`)) { skipped.push({ path, reason: 'dependency/generated directory' }); continue; }
          visited++;
          await visit(entry, `${path}/`);
        } else {
          const file = await entry.getFile();
          add(path, file, () => entry.getFile());
          if (visited % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    };
    await visit(session.handle);
  } else {
    const excludedDirectories = new Set();
    for (const file of session.files || []) {
      checkAbort(signal);
      const relative = normalizeLocalPath(file.webkitRelativePath);
      const path = relative.slice(relative.indexOf('/') + 1);
      const excluded = EXCLUDED_DIR.exec(path);
      if (excluded) {
        const directory = path.slice(0, excluded.index + excluded[0].length).replace(/\/$/, '');
        if (!excludedDirectories.has(directory)) skipped.push({ path: directory, reason: 'dependency/generated directory' });
        excludedDirectories.add(directory);
        continue;
      }
      add(path, file, async () => file);
      if (visited % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  if (!entries.length) throw new Error('No supported source or context files were found in this folder.');
  return { entries, skipped, bytes, folderName: session.folderName };
}

async function readEntry(entry, signal) {
  checkAbort(signal);
  const file = await entry.getFile();
  const bytes = typeof file.arrayBuffer === 'function' ? new Uint8Array(await file.arrayBuffer()) : null;
  const text = bytes ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : await file.text();
  checkAbort(signal);
  if (text.includes('\0')) throw new Error(`Binary content is not supported: ${entry.path}`);
  return { content: text, contentDigest: bytes ? await digestBytes(bytes) : null, textDigest: await digestText(text), size: file.size, decoding: 'utf8-fatal-v1' };
}

// Hash one file at a time; retain file references/metadata, not the full source tree.
export async function createLocalSourceProvider(source, { signal, onProgress } = {}) {
  const scan = await scanLocalFolder(source, { signal });
  const files = [];
  const entries = new Map();
  for (const entry of scan.entries) {
    let content;
    try { content = (await readEntry(entry, signal)).content; } catch (error) {
      if (error.message.startsWith('Binary content')) { scan.skipped.push({ path: entry.path, reason: 'binary content' }); continue; }
      throw error;
    }
    const sha = await hashLocalText(content);
    files.push({ path: entry.path, name: entry.name, size: entry.size, sha });
    entries.set(entry.path, { ...entry, sha });
    onProgress?.({ phase: 'scan', message: `Preparing local source: ${entry.path}`, completedFiles: files.length, totalFiles: scan.entries.length });
  }
  if (!files.length) throw new Error('No readable text source files were found.');
  const snapshotId = await hashLocalText(files.map(file => `${file.path}:${file.sha}`).join('\n'));
  return {
    source: { ...source, snapshotId },
    skipped: scan.skipped,
    async listFiles() { return files; },
    async readText({ path, signal: readSignal }) {
      const entry = entries.get(path);
      if (!entry) throw new Error(`File is not in the selected local snapshot: ${path}`);
      const read = await readEntry(entry, readSignal || signal);
      const { content } = read;
      if (await hashLocalText(content) !== entry.sha) throw new Error(`Local file changed during analysis: ${path}. Reconnect or analyze again.`);
      return { ok: true, ...read };
    },
  };
}
