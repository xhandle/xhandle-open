import { nowISO, sanitizeFilename } from "./safetyRemediationUtils";

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function safeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function localRepoMeta() {
  if (typeof localStorage === "undefined") return {};
  const owner = localStorage.getItem("repoOwner") || "";
  const repo = localStorage.getItem("repoName") || "";
  return {
    repoId: owner && repo ? `${owner}/${repo}` : repo || null,
    repoName: owner && repo ? `${owner}/${repo}` : repo || null,
    repoUrl: owner && repo ? `https://github.com/${owner}/${repo}` : null,
  };
}

function collectEvidenceRefs(finding = {}, hazardAnalysis = {}) {
  const refs = Array.isArray(finding.affectedCodeRefs) ? [...finding.affectedCodeRefs] : [];
  (hazardAnalysis.traceabilityMap || []).forEach((link) => {
    (link.codeEvidence?.files || []).forEach((file) => refs.push(file));
    (link.codeEvidence?.sourceFunctions || []).forEach((fn) => refs.push(fn));
    (link.sourceEvidence?.functions || []).forEach((fn) => refs.push(fn));
  });
  return refs;
}

function deriveBranch(finding, hazardAnalysis, repoMeta) {
  const refs = collectEvidenceRefs(finding, hazardAnalysis);
  return firstValue(
    ...refs.map((ref) => ref.branch),
    hazardAnalysis?.branch,
    repoMeta?.branch,
    "main"
  );
}

function deriveCommitSha(finding, hazardAnalysis) {
  const refs = collectEvidenceRefs(finding, hazardAnalysis);
  return firstValue(
    ...refs.map((ref) => ref.commitSha),
    hazardAnalysis?.commitSha,
    hazardAnalysis?.baseCommitSha,
    hazardAnalysis?.analyzedCommitSha
  );
}

export function buildPatchProposalHandoff({
  project = null,
  projectId = "",
  repoMeta = {},
  finding = null,
  patchProposal = null,
  codeArchitectureHazardAnalysis = null,
  reviewDecisions = [],
} = {}) {
  const localMeta = localRepoMeta();
  const repoId = firstValue(repoMeta.repoId, repoMeta.repoName, finding?.repoId, patchProposal?.repoId, localMeta.repoId);
  const repoName = firstValue(repoMeta.repoName, repoId, localMeta.repoName);
  const repoUrl = firstValue(repoMeta.repoUrl, localMeta.repoUrl);
  const branch = deriveBranch(finding || {}, codeArchitectureHazardAnalysis || {}, repoMeta || {});
  const commitSha = deriveCommitSha(finding || {}, codeArchitectureHazardAnalysis || {});
  const approvedDecision = (reviewDecisions || []).find((decision) =>
    [finding?.id, patchProposal?.id].includes(decision.targetId) &&
    ["approve", "approve_with_changes"].includes(decision.decision)
  );

  return {
    schemaVersion: 1,
    source: "xHandle",
    type: "PatchProposalHandoff",
    projectId: firstValue(projectId, project?.id),
    repoId,
    repoName,
    repoUrl,
    expectedRemoteUrl: repoUrl,
    expectedBranch: branch,
    baseCommitSha: commitSha,
    analyzedCommitSha: commitSha,
    analyzedAt: firstValue(codeArchitectureHazardAnalysis?.createdAt, codeArchitectureHazardAnalysis?.updatedAt),
    pullRequestUrl: firstValue(finding?.pullRequestUrl, patchProposal?.pullRequestUrl),
    pullRequestNumber: safeNumber(firstValue(finding?.pullRequestNumber, patchProposal?.pullRequestNumber)),
    architectureSnapshotId: firstValue(codeArchitectureHazardAnalysis?.architectureModelId, finding?.architectureSnapshotHash),
    architectureHash: firstValue(codeArchitectureHazardAnalysis?.architectureSnapshotHash, finding?.architectureSnapshotHash),
    hazardAnalysisRunId: firstValue(finding?.hazardAnalysisRunId, codeArchitectureHazardAnalysis?.id),
    hazardAnalysisMethod: firstValue(finding?.hazardAnalysisMethod, codeArchitectureHazardAnalysis?.hazardMethod),
    safetyFindingId: finding?.id || null,
    safetyFindingTitle: finding?.title || null,
    hazardId: finding?.hazardId || null,
    hazard: finding?.hazard || null,
    causalFactorId: finding?.causalFactorId || null,
    causalFactor: finding?.causalFactor || null,
    architectureElementId: finding?.architectureElementId || null,
    architectureElementLabel: finding?.architectureElementLabel || null,
    affectedCodeRefs: Array.isArray(finding?.affectedCodeRefs) ? finding.affectedCodeRefs : [],
    patchProposalId: patchProposal?.id || null,
    patchSummary: patchProposal?.summary || null,
    unifiedDiff: patchProposal?.unifiedDiff || "",
    filesChanged: Array.isArray(patchProposal?.filesChanged) ? patchProposal.filesChanged : [],
    safetyRationale: patchProposal?.safetyRationale || null,
    testRecommendations: Array.isArray(patchProposal?.testRecommendations) ? patchProposal.testRecommendations : [],
    reviewDecisionId: approvedDecision?.id || null,
    generatedAt: firstValue(patchProposal?.createdAt, nowISO()),
  };
}

export function handoffFilename(patchProposal = {}) {
  return `${sanitizeFilename(patchProposal.id || patchProposal.title || "xhandle-patch-proposal")}.xhandle-patch.json`;
}

export function handoffToJson(handoff) {
  return JSON.stringify(handoff, null, 2);
}
