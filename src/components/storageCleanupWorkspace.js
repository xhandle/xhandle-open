import { ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY } from './storageWorkspaceVisibility';

// Only deleting decomposition roots removes workspace entries. Deleting a
// checkpoint, metadata, or layout must not remove its parent project.
export function reconcileStorageCleanup(item, keys, storage = localStorage) {
  const isArchitecture = item.dbName === 'xhandle' && item.storeName === 'copilot_baseline';
  if (item.kind === 'localStorage' && (keys || item.keys || []).includes(ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY)) {
    // Keep an empty registry so startup does not recreate a legacy project.
    storage.setItem(ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY, '[]');
    return;
  }
  if (!isArchitecture) return;
  const projects = JSON.parse(storage.getItem(ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY) || '[]');
  if (!Array.isArray(projects)) throw new Error('Could not read the workspace project list.');
  const removedRoots = new Set((keys || []).filter(key => typeof key === 'string' && /^cba:[^:]+:[^:]+$/.test(key)));
  const next = keys === null ? [] : projects.flatMap(project => {
    const repos = (project.repos || []).filter(repo => !removedRoots.has(`cba:${project.id}:${repo.id}`));
    if (repos.length === (project.repos || []).length) return [project];
    if (!repos.length) return [];
    return [{...project, repos, activeRepoId: repos.some(repo => repo.id === project.activeRepoId) ? project.activeRepoId : repos[0].id}];
  });
  storage.setItem(ACTIVE_CODE_ARCHITECTURE_PROJECTS_KEY, JSON.stringify(next));
}
