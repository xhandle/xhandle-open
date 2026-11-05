import {resolveWorkspaceReadPolicy} from './workspaceReadPolicy';
import {iterateRecordRows} from './workspaceSourcePages';
import {requestValue} from '../code-architecture-storage/chunkedRecord';

// Only bypass semantic routing when the entire request is the same simple
// overview understood by retrieval. Extra selections/files stay on that path.
export function directProjectOverviewAreas(query, {modelUserContent, contexts = [], projectId, areas = []} = {}) {
  if (modelUserContent != null && modelUserContent !== query) return null;
  if (contexts.length && !(contexts.length === 1 && contexts[0]?.file?.name === 'pasted-content.txt'
    && contexts[0]?.file?.type === 'text/plain' && !contexts[0]?.imageDataUrl && !contexts[0]?.tableMarkdown)) return null;
  if (!projectOverviewScope(query, {projectId, areas})) return null;
  return areas.length ? areas : ['projects', 'functional'];
}

// An overview is deliberately narrower than a review, comparison or question
// about a particular dataset. Those requests keep the governed detailed reads.
export function projectOverviewScope(query, {projectId, areas = []} = {}) {
  let text = String(query || '').trim();
  // Paste-as-attachment has the same content as a typed request. Only unwrap
  // the application's single plain-text paste envelope, never arbitrary files.
  text = text.replace(/^\*\*Attached file \(1\):\*\*\n\nName: pasted-content\.txt\nType: text\/plain\nSize: [^\n]+\n(?:Last modified: [^\n]+\n)?\n/, '');
  if (text.length > 500 || /\n/.test(text)) return null;
  let projects;
  try {
    projects = ['xhandle.projects', 'xhandle.codeArchitectureProjects'].flatMap(key => {
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(rows) ? rows.map(row => ({...row, projectType: key === 'xhandle.projects' ? 'project' : 'code-based-architecture'})) : [];
    });
  } catch { return null; }
  const policy = resolveWorkspaceReadPolicy({query: text, projectId, projects, areas});
  if (policy.clarification || policy.projectIds?.length !== 1) return null;
  const project = projects.find(row => String(row.id) === policy.projectIds[0]);
  if (!project?.name) return null;
  const escaped = String(project.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const target = `(?:(?:the |my |our )?(?:project )?${escaped}(?: project)?|(?:this|the current|our) project)`;
  const pattern = new RegExp(`^(?:please )?(?:(?:summari[sz]e|describe|tell me about) ${target}|(?:give me |provide )?(?:a |an )?(?:brief |short |high[- ]level )?(?:summary|overview) of ${target})[.!?]*$`, 'i');
  if (!pattern.test(text)) return null;
  // A user-selected domain restriction must not be widened to an overview.
  if (areas.length && !areas.includes('projects')) return null;
  return {projectId: String(project.id), projectType: project.projectType};
}

const fields = ['description', 'subsystem', 'from', 'fromFunction', 'fromDetails', 'action', 'controlAction', 'controlActionDetails', 'to', 'toFunction', 'toDetails'];
const projectRow = row => Object.fromEntries(fields.filter(key => typeof row?.[key] === 'string').map(key => [key, row[key].slice(0, 240)]));
function check(signal) { if (signal?.aborted) throw signal.reason || new DOMException('Overview cancelled.', 'AbortError'); }
function openSource(signal) {
  return new Promise((resolve, reject) => {
    let done = false, missing = false;
    const finish = (error, db) => {
      if (done) { db?.close(); return; }
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(db);
    };
    const abort = () => finish(signal.reason || new DOMException('Overview cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(Error('Architecture overview storage did not respond in time.')), 4000);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) { abort(); return; }
    const request = indexedDB.open('xhandle');
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    request.onerror = () => finish(missing ? null : request.error);
    request.onblocked = () => finish(Error('Architecture overview storage is blocked.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); finish(null, request.result); };
  });
}

// Read a small authoritative sample directly, without copying the complete
// analysis (including embedded source evidence) into another database first.
export async function readProjectOverviewSample(scope, {signal} = {}) {
  check(signal);
  const rows = [], sources = [];
  if (scope.projectType === 'project') {
    const raw = localStorage.getItem('xhandle.projectData') || '{}';
    // This legacy store is monolithic; do not parse an enormous workspace for
    // an overview. Metadata remains usable and coverage explains the omission.
    if (raw.length > 2 * 1024 * 1024) return {rows, sources, reason: 'Functional sample omitted because the legacy workspace exceeds the overview read budget.'};
    const data = JSON.parse(raw)?.[scope.projectId];
    const source = Array.isArray(data?.responseRows) ? data.responseRows : [];
    source.slice(0, 24).forEach((row, index) => rows.push({index, ...projectRow(row)}));
    sources.push({sourceStore: 'localStorage:xhandle.projectData', sourceKey: `xhandle.projectData.${scope.projectId}.responseRows`, sampledRows: rows.length});
    return {rows, sources};
  }
  const db = await openSource(signal);
  if (!db) return {rows, sources, reason: 'No saved architecture store is available.'};
  const abort = () => db.close();
  signal?.addEventListener('abort', abort, {once: true});
  try {
    if (!db.objectStoreNames.contains('copilot_baseline')) return {rows, sources};
    const prefix = `cba:${scope.projectId}:`;
    // Root keys precede their :$part: children. Seek past a complete root's
    // children rather than enumerating every chunk in a large saved analysis.
    let lower = prefix, open = false;
    for (let roots = 0; roots < 4 && rows.length < 24; roots++) {
      check(signal);
      const keys = await requestValue(db.transaction('copilot_baseline').objectStore('copilot_baseline').getAllKeys(IDBKeyRange.bound(lower, prefix + '\uffff', open, false), 1));
      const key = keys[0];
      if (typeof key !== 'string') break;
      const rootKey = key.split(':$part:')[0].split(':functional-work:')[0].split(':requirements-work:')[0].split(':run:')[0];
      lower = rootKey + ':\uffff'; open = true;
      if (key !== rootKey) continue;
      const raw = await requestValue(db.transaction('copilot_baseline').objectStore('copilot_baseline').get(key));
      let count = 0;
      for await (const row of iterateRecordRows(db, 'copilot_baseline', raw?.value, signal)) {
        check(signal); rows.push({index: count++, sourceKey: key, ...projectRow(row)});
        if (rows.length >= 24) break;
      }
      sources.push({sourceStore: 'indexedDB:xhandle/copilot_baseline', sourceKey: key, sampledRows: count});
    }
    return {rows, sources};
  } finally { signal?.removeEventListener('abort', abort); db.close(); }
}
