import { getLatestCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';

export async function resolveSoftwareHazardSource({ projectId, repo = {}, current = null }) {
  const ids = [...new Set([repo.repoId, repo.repoName, repo.id].filter(Boolean))];
  if (!projectId || !ids.length) return current;
  const saved = await Promise.all(ids.map(repoId => getLatestCodeArchitectureHazardRun({ projectId, repoId })));
  const candidates = [...saved, current].filter(run => run && (!run.projectId || run.projectId === projectId) && (!run.repoId || ids.includes(run.repoId)));
  return candidates.sort((a,b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))[0] || null;
}
