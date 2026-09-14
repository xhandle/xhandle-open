import { runLiteAIAnalysis } from "../../components/aiAnalysisLite";
import { saveCodeArchitectureHazardRun } from "./codeArchitectureHazardStore";
import { enrichHazardTableRowsWithSourceContent } from "./codeArchitectureHazardSourceAudit";
import {
  buildCodeArchitectureHazardInput,
  ensureHazardSummaryEvidenceColumns,
  ensureHazardSummaryTraceColumns,
  makeCodeArchitectureHazardId,
  normalizeCodeArchitectureHazardRun,
  normalizeRepoId,
} from "./codeArchitectureHazardUtils";

export async function runCodeArchitectureHazardAnalysis({
  cbaRows = [],
  method = "STPA-Textbook",
  repoMeta = {},
  projectId = "",
  operationalContexts = [],
  selectedOperationalContextId = "all",
  organizationContext = "",
  organizationProfileProvenance = null,
  setProgress = () => {},
  onActivityUpdate = () => {},
  onPartialRunUpdate = () => {},
  signal = null,
} = {}) {
  if (!Array.isArray(cbaRows) || cbaRows.length === 0) {
    throw new Error("Generate or load a code-based functional architecture before running hazard analysis.");
  }

  const input = buildCodeArchitectureHazardInput({
    cbaRows,
    repoMeta,
    projectId,
    method,
    operationalContexts,
    selectedOperationalContextId,
  });
  if (!input.tableRows.length) {
    throw new Error("No Code-Based Architecture rows are marked Include for hazard analysis. Review or override the eligibility classifications in the functional decomposition table.");
  }
  const eligibilityMessage = `${input.eligibilitySummary.include} included, ${input.eligibilitySummary.exclude} excluded, ${input.eligibilitySummary.needsReview} need review`;
  onActivityUpdate({ step: 0, message: `Preparing code architecture hazard analysis (${eligibilityMessage})...` });
  const sourceAuditedTableRows = await enrichHazardTableRowsWithSourceContent(
    input.sourceTableRows || input.tableRows,
    repoMeta,
  );

  const id = makeCodeArchitectureHazardId("cba-hazard-run");
  const sourceRunId = id;
  const currentFolder = "CodeBasedArchitecture";
  let currentGeneratedSheets = input.sheets;
  const buildRun = (generatedSheets) => normalizeCodeArchitectureHazardRun({
    id,
    sourceRunId,
    projectId,
    repoId: input.repoId,
    repoName: repoMeta.repoName || normalizeRepoId(repoMeta),
    repoUrl: repoMeta.repoUrl || "",
    repoPath: repoMeta.repoPath || "",
    branch: repoMeta.branch || "",
    architectureModelId: `${input.repoId || "repo"}:${input.architectureSnapshotHash}`,
    architectureSnapshotHash: input.architectureSnapshotHash,
    architectureRowsSnapshot: input.architectureRowsSnapshot,
    traceabilityMap: input.traceabilityMap,
    hazardEligibilitySummary: input.eligibilitySummary,
    excludedArchitectureRows: input.excludedArchitectureRows,
    needsReviewArchitectureRows: input.needsReviewArchitectureRows,
    hazardMethod: method,
    hazardGenerationMode: "standard",
    fhaGenerationMode: method === "FHA" ? "standard" : undefined,
    operationalContext: input.operationalContext,
    operationalContexts: input.configuredOperationalContexts,
    analysisOperationalContexts: input.analysisOperationalContexts,
    selectedOperationalContextId: input.selectedOperationalContextId,
    organizationProfileProvenance,
    contextSources: input.contextSources,
    generatedSheets,
  }, {
    projectId,
    repoMeta,
    repoId: input.repoId,
    architectureSnapshotHash: input.architectureSnapshotHash,
    hazardMethod: method,
    hazardGenerationMode: "standard",
    fhaGenerationMode: method === "FHA" ? "standard" : undefined,
    operationalContext: input.operationalContext,
    operationalContexts: input.configuredOperationalContexts,
    analysisOperationalContexts: input.analysisOperationalContexts,
    selectedOperationalContextId: input.selectedOperationalContextId,
    organizationProfileProvenance,
    contextSources: input.contextSources,
  });
  const setFolders = async (updater) => {
    const prev = { [currentFolder]: currentGeneratedSheets };
    const nextFolders = typeof updater === "function" ? await updater(prev) : prev;
    currentGeneratedSheets = nextFolders?.[currentFolder] || currentGeneratedSheets;
    const reviewedSheets = ensureHazardSummaryEvidenceColumns(
      ensureHazardSummaryTraceColumns(currentGeneratedSheets, sourceAuditedTableRows),
      sourceAuditedTableRows
    );
    onPartialRunUpdate(buildRun(reviewedSheets));
    return nextFolders;
  };

  onActivityUpdate({ step: 1, message: `Generating code architecture hazard analysis from ${input.eligibilitySummary.include} eligible interface${input.eligibilitySummary.include === 1 ? "" : "s"}...` });
  const generatedSheetsRaw = await runLiteAIAnalysis({
    tableRows: input.tableRows,
    sheets: input.sheets,
    setFolders,
    currentFolder,
    setChatPrompt: () => {},
    setChatResponse: () => {},
    setProgress,
    hazardMethod: method,
    hazardGenerationMode: "standard",
    fhaGenerationMode: "standard",
    operationalContext: input.operationalContext,
    organizationContext,
    analysisContext: input.analysisContext,
    contextSources: input.contextSources,
    signal,
  });
  const generatedSheets = ensureHazardSummaryEvidenceColumns(
    ensureHazardSummaryTraceColumns(generatedSheetsRaw, sourceAuditedTableRows),
    sourceAuditedTableRows
  );

  const run = normalizeCodeArchitectureHazardRun({
    id,
    sourceRunId,
    projectId,
    repoId: input.repoId,
    repoName: repoMeta.repoName || normalizeRepoId(repoMeta),
    repoUrl: repoMeta.repoUrl || "",
    repoPath: repoMeta.repoPath || "",
    branch: repoMeta.branch || "",
    architectureModelId: `${input.repoId || "repo"}:${input.architectureSnapshotHash}`,
    architectureSnapshotHash: input.architectureSnapshotHash,
    architectureRowsSnapshot: input.architectureRowsSnapshot,
    traceabilityMap: input.traceabilityMap,
    hazardMethod: method,
    hazardGenerationMode: "standard",
    fhaGenerationMode: method === "FHA" ? "standard" : undefined,
    operationalContext: input.operationalContext,
    operationalContexts: input.configuredOperationalContexts,
    analysisOperationalContexts: input.analysisOperationalContexts,
    selectedOperationalContextId: input.selectedOperationalContextId,
    organizationProfileProvenance,
    contextSources: input.contextSources,
    generatedSheets,
  }, {
    projectId,
    repoMeta,
    repoId: input.repoId,
    architectureSnapshotHash: input.architectureSnapshotHash,
    hazardMethod: method,
    hazardGenerationMode: "standard",
    fhaGenerationMode: method === "FHA" ? "standard" : undefined,
    operationalContext: input.operationalContext,
    operationalContexts: input.configuredOperationalContexts,
    analysisOperationalContexts: input.analysisOperationalContexts,
    selectedOperationalContextId: input.selectedOperationalContextId,
    organizationProfileProvenance,
    contextSources: input.contextSources,
  });

  await saveCodeArchitectureHazardRun(run);
  onActivityUpdate({ step: 9, message: "Code architecture hazard analysis complete." });
  return run;
}
