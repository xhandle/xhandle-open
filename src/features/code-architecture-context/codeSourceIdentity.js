export const isLocalCodeSource = (source = {}) => source?.sourceType === 'local';

export function codeSourceProvenance(source = {}) {
  return isLocalCodeSource(source) ? {
    sourceType: 'local',
    sourceId: source.sourceId,
    snapshotId: source.snapshotId || '',
    folderName: source.folderName || source.repoName || '',
  } : source?.evidenceVersion === 1 && source?.snapshotId ? {
    sourceType: 'github', evidenceVersion: 1, snapshotId: source.snapshotId,
  } : {};
}

export function codeSourceIndexPrefix(source = {}) {
  if (isLocalCodeSource(source)) {
    if (!source.sourceId || !source.snapshotId) return '';
    return `code:local:${source.sourceId}:${source.snapshotId}:`;
  }
  if (source?.evidenceVersion === 1 && source?.snapshotId && source?.owner && source?.repo) {
    return `code:github:${source.owner}/${source.repo}:${source.snapshotId}:`;
  }
  return source?.owner && source?.repo ? `code:file:${source.owner}/${source.repo}:` : '';
}

export function codeSourceIndexKey(source, path) {
  const prefix = codeSourceIndexPrefix(source);
  return prefix && path ? `${prefix}${path}` : '';
}

// Only portable descriptors belong in project settings and exports.
export function localCodeSourceDescriptor(source = {}) {
  if (!isLocalCodeSource(source)) return {};
  return {
    ...codeSourceProvenance(source),
    sourceType: 'local',
    repoId: `local:${source.sourceId}`,
    repoName: source.folderName || source.repoName || 'Local project',
    owner: '', repo: '', repoUrl: '', token: '', branch: '', commitSha: '',
  };
}
