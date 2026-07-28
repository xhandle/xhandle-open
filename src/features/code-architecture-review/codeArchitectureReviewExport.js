import { ARTIFACT_KINDS } from "../code-architecture-assurance/artifactDefinitions";

export const CODE_ARCHITECTURE_REVIEW_PACKAGE_SCHEMA_VERSION = 1;
export const CODE_ARCHITECTURE_REVIEW_PACKAGE_TYPE = "code-based-architecture-review-package";

export const REVIEW_ANALYSIS_SECTIONS = {
  HAZARD: "hazard-remediation",
  SOFTWARE: ARTIFACT_KINDS.SOFTWARE,
  SYSTEM: ARTIFACT_KINDS.SYSTEM,
  SUBSYSTEM: ARTIFACT_KINDS.SUBSYSTEM,
  DESIGN: ARTIFACT_KINDS.DESIGN,
  TRACEABILITY: "traceability-matrix",
};

function sanitizeRepo(repo = {}) {
  const { token, accessToken, authToken, password, ...safeRepo } = repo || {};
  return safeRepo;
}

function filenameBase(value = "code-architecture-review") {
  return String(value || "code-architecture-review")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "code-architecture-review";
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeTargets({ project, folder, repo, repos, cbaRows, reviewTargets }) {
  if (Array.isArray(reviewTargets) && reviewTargets.length) return reviewTargets;
  const targetRepos = (Array.isArray(repos) && repos.length ? repos : [repo]).filter(Boolean);
  return targetRepos.map((targetRepo) => ({
    type: "project",
    project: project || {},
    folder: folder || null,
    repo: targetRepo,
    activeRepo: repo,
    cbaRows,
  }));
}

export async function collectCodeArchitectureReviewPackage({
  project = {},
  folder = null,
  repo = null,
  repos = null,
  cbaRows = [],
  hazardRun = null,
  reviewTargets = null,
  appDisplayName = "",
  appName = "",
  includedAnalysis = null,
  assuranceArtifacts = null,
  safetyRemediation = null,
  diagramPositions = null,
  reviewItems = [],
  uiState = {},
} = {}) {
  const targets = normalizeTargets({ project, folder, repo, repos, cbaRows, reviewTargets });
  const repoPackages = targets.map((target, index) => {
    const safeRepo = sanitizeRepo(target.repo || target.activeRepo || repo || {});
    const rows = Array.isArray(target.cbaRows) ? target.cbaRows : [];
    return {
      id: safeRepo.id || safeRepo.repoId || safeRepo.repoName || `repository-${index + 1}`,
      type: target.type || "project",
      label: safeRepo.repoName || safeRepo.repoId || target.project?.name || `Repository ${index + 1}`,
      project: target.project || project || {},
      folder: target.folder || null,
      repo: safeRepo,
      repoMeta: target.repoMeta || safeRepo,
      cbaRows: rows,
      diagramPositions: target.diagramPositions || diagramPositions || null,
      assuranceArtifacts: target.assuranceArtifacts || assuranceArtifacts || {},
      safetyRemediation: target.safetyRemediation || safetyRemediation || null,
      hazardRun: target.hazardRun || hazardRun || null,
    };
  }).filter((entry) => Array.isArray(entry.cbaRows) && entry.cbaRows.length);

  if (!repoPackages.length) {
    throw new Error("Analyze at least one Code-Based Architecture project before exporting a review package.");
  }

  const activeRepoPackage = repoPackages[0];
  const displayName = String(appDisplayName || appName || "").trim() || "xHandle Code Architecture Review";
  return {
    schemaVersion: CODE_ARCHITECTURE_REVIEW_PACKAGE_SCHEMA_VERSION,
    type: CODE_ARCHITECTURE_REVIEW_PACKAGE_TYPE,
    artifactType: CODE_ARCHITECTURE_REVIEW_PACKAGE_TYPE,
    exportedAt: new Date().toISOString(),
    reviewMode: true,
    appDisplayName: displayName,
    appName: displayName,
    project: {
      ...(activeRepoPackage.project || project || {}),
      repos: ((activeRepoPackage.project || project || {}).repos || []).map(sanitizeRepo),
    },
    folder: activeRepoPackage.folder || folder,
    activeRepo: activeRepoPackage.repo,
    repoMeta: activeRepoPackage.repoMeta,
    storage: {},
    data: {
      cbaRows: activeRepoPackage.cbaRows,
      diagramPositions: activeRepoPackage.diagramPositions,
      assuranceArtifacts: activeRepoPackage.assuranceArtifacts,
      safetyRemediation: activeRepoPackage.safetyRemediation,
      hazardRun: activeRepoPackage.hazardRun,
      reviewItems: Array.isArray(reviewItems) ? reviewItems : [],
      repositories: repoPackages,
    },
    uiState: {
      activeWorkspaceTab: "architecture",
      hazardRemediationTab: "hazard-analysis",
      includedAnalysis: includedAnalysis || null,
      ...uiState,
    },
  };
}

export async function chooseCodeArchitectureReviewDestination(defaultDirectory = "") {
  return { cancelled: true, path: defaultDirectory || "" };
}

export function downloadCodeArchitectureReviewPackage(reviewPackage) {
  downloadJson(reviewPackage, `${filenameBase(reviewPackage?.appDisplayName || reviewPackage?.appName)}-review-package.json`);
  return reviewPackage;
}

export async function downloadCodeArchitectureReviewApp(reviewPackage) {
  return downloadCodeArchitectureReviewPackage(reviewPackage);
}

export function configuredReviewPackagerUrl() {
  return "";
}

export function isHostedCodeArchitectureReviewPackagerConfigured() {
  return false;
}

export function codeArchitectureReviewPackagingTarget() {
  return { mode: "local-json", url: "" };
}

export default collectCodeArchitectureReviewPackage;
