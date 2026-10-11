import { isCodeArchitectureHazardAnalysisStale } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
import { getLatestCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';

export async function resolveSoftwareHazardSource({ projectId, repo = {}, current = null, cbaRows, organizationContext }) {
  const ids = [...new Set([repo.repoId, repo.repoName, repo.id].filter(Boolean))];
  if (!projectId || !ids.length) return current;
  const saved = await Promise.all(ids.map(repoId => getLatestCodeArchitectureHazardRun({ projectId, repoId })));
  const candidates = [...saved, current].filter(run => run && (!run.projectId || run.projectId === projectId) && (!run.repoId || ids.includes(run.repoId)));
  const selected = candidates.sort((a,b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))[0] || null;
  if (organizationContext !== undefined && isCodeArchitectureHazardAnalysisStale({ run: selected, cbaRows: cbaRows || [], organizationContext })) {
    throw new Error("The latest hazard analysis uses outdated architecture or organization guidance. Update the hazard analysis before deriving software requirements.");
  }
  if (cbaRows && /^(HARA|FHA)$/i.test(selected?.hazardMethod || '') &&
      isCodeArchitectureHazardAnalysisStale({ run: selected, cbaRows, organizationContext })) {
    throw new Error(`The latest ${selected.hazardMethod} analysis uses an older architecture. Update that hazard analysis before deriving software requirements.`);
  }
  return selected;
}
