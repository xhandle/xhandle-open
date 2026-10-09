// Preserve order and metadata for untouched repositories; replace reused IDs.
export function mergeImportedCodeArchitectureRepos(existing = [], imported = []) {
  return [...new Map([...(existing || []), ...imported].map(repo => [repo.id, repo])).values()];
}
