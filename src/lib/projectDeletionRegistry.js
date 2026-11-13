// Small, durable deletion markers separate immediate removal from disk cleanup.
// Keep completed markers so stale indexes cannot resurrect deleted projects.
export const PROJECT_DELETION_PREFIX = 'xhandle:deleted-project:v1:';
export const PROJECT_DELETIONS_CHANGED = 'xhandle:project-deletions-changed';
const keyFor = project => `${PROJECT_DELETION_PREFIX}${encodeURIComponent(project.workspaceType)}:${encodeURIComponent(String(project.id))}`;

export function readProjectDeletion(project, storage = localStorage) {
  const raw = storage.getItem(keyFor(project));
  return raw == null ? null : JSON.parse(raw);
}

export function writeProjectDeletion(record, storage = localStorage) {
  storage.setItem(keyFor(record), JSON.stringify(record));
}

export function listProjectDeletions(storage = localStorage) {
  const records = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PROJECT_DELETION_PREFIX)) records.push(JSON.parse(storage.getItem(key)));
  }
  return records;
}

export function isProjectDeletionRequested(project, storage = localStorage) {
  return !!readProjectDeletion(project, storage);
}

export function notifyProjectDeletionsChanged() {
  window.dispatchEvent(new Event(PROJECT_DELETIONS_CHANGED));
}

export function deletedProjectIds() {
  if (typeof localStorage === 'undefined') return new Set();
  // An explicit restore/import can make an identity active again. Cleanup
  // independently refuses that identity; keep its active data visible too.
  const active = new Set(['xhandle.projects', 'xhandle.codeArchitectureProjects'].flatMap(key =>
    JSON.parse(localStorage.getItem(key) || '[]').map(project => String(project.id))));
  return new Set(listProjectDeletions().map(project => String(project.id)).filter(id => !active.has(id)));
}
