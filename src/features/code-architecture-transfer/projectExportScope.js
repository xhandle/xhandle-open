// New exports are analysis packages, not project-wide storage backups.
// Keep this separate from the broader ownership rules used by legacy imports.
export const EXPORT_DATABASES = ['xhandle', 'xhandle-code-architecture-assurance', 'xhandle-code-architecture-hazard-analysis'];
export const EXPORT_FALLBACKS = ['xhandle:code-architecture-hazard-analysis:v1'];
const kinds = ['software-requirements', 'system-requirements', 'subsystem-requirements', 'design-elements'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));

export function analysisProjectMetadata(project) {
  return {
    ...pick(project, ['id', 'name', 'activeRepoId', 'createdAt', 'updatedAt']),
    folderId: null,
    repos: (project.repos || []).map(repo => pick(repo, [
      'id', 'owner', 'repo', 'repoId', 'repoName', 'repoUrl', 'branch', 'commitSha',
      'sourceType', 'sourceId', 'snapshotId', 'evidenceVersion', 'folderName',
      'selectedExtensions', 'analysisContext', 'operationalContext', 'contextSources',
      'filesFound', 'createdAt', 'updatedAt', 'lastAnalyzedAt',
    ])),
  };
}

export function projectExportScope(project, ownership) {
  // Older projects use the repository identity/name where newer ones use its
  // generated ID. Match the same aliases used by the architecture reader.
  const repoIds = [...new Set((project.repos || []).flatMap(repo => [repo.id, repo.repoId, repo.repoName]).filter(Boolean))];
  const scopes = repoIds.map(id => `cba:${project.id}:${id}`);
  const metadata = repoIds.map(id => `cbaMeta:${project.id}:${id}`);
  const artifacts = repoIds.flatMap(id => kinds.map(kind => `xhandle:cba-${kind}:${project.id}:${id}`));
  const contexts = repoIds.map(id => `xhandle:code-architecture-hazard-contexts:v1:${encodeURIComponent(project.id)}:${encodeURIComponent(id)}`);
  const layouts = (project.repos || []).flatMap(repo => [repo.id, repo.repoId, repo.repoName, repo.owner && repo.repo && `${repo.owner}/${repo.repo}`]
    .filter(Boolean).flatMap(id => { const key = `diagram:github:${id}:${repo.branch || 'main'}`; return [key, `${key}:function-spacing-v3`]; }));
  const architecture = key => metadata.includes(key) || scopes.some(scope =>
    key === scope || key === `${scope}:metadata` || key === `${scope}:run` || key.startsWith(`${scope}:run:`) ||
    key.startsWith(`functional-decomposition-checkpoint:${scope}:`) || key.startsWith(`${scope}:functional-work:`) ||
    kinds.some(kind => key.startsWith(`${scope}:requirements-work:${kind}:`)));
  const stores = {
    xhandle: ['copilot_baseline', 'diagram_positions'],
    'xhandle-code-architecture-assurance': ['artifactRows'],
    'xhandle-code-architecture-hazard-analysis': ['hazardAnalysisRuns', 'generationCheckpoints', 'hazardRunChunks'],
  };
  return {
    store: (db, store) => (stores[db] || []).includes(store),
    mayOwnKey: (db, store, key) => {
      if (typeof key !== 'string') return false;
      if (db === 'xhandle') return store === 'copilot_baseline' ? architecture(key) : layouts.includes(key);
      if (db === 'xhandle-code-architecture-assurance') return artifacts.includes(key);
      return true; // Hazard IDs are opaque; ownership is checked on their metadata.
    },
    owns: ownership.owns,
    local: key => scopes.includes(key) || metadata.includes(key) || artifacts.includes(key) || contexts.includes(key),
  };
}
