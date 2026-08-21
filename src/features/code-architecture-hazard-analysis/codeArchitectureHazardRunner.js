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
  fhaGenerationMode = "standard",
  hazardGenerationMode = fhaGenerationMode,
  setProgress = () => {},
  onActivityUpdate = () => {},
  onPartialRunUpdate = () => {},
} = {}) {
  if (!Array.isArray(cbaRows) || cbaRows.length === 0) {
    throw new Error("Generate or load a code-based functional architecture before running hazard analysis.");
  }

  const input = buildCodeArchitectureHazardInput({ cbaRows, repoMeta, projectId });
  if (!input.tableRows.length) {
    throw new Error("No non-Markdown architecture rows are available for hazard analysis.");
  }
  onActivityUpdate({ step: 0, message: "Preparing code architecture hazard analysis..." });
  const sourceAuditedTableRows = await enrichHazardTableRowsWithSourceContent(input.tableRows, repoMeta);

  const id = makeCodeArchitectureHazardId("cba-hazard-run");
  const sourceRunId = id;
  const currentFolder = "CodeBasedArchitecture";
  let currentGeneratedSheets = input.sheets;
  const selectedHazardGenerationMode = hazardGenerationMode || fhaGenerationMode || "standard";
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
    hazardMethod: method,
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: method === "FHA" ? selectedHazardGenerationMode : undefined,
    operationalContext: input.operationalContext,
    contextSources: input.contextSources,
    generatedSheets,
  }, {
    projectId,
    repoMeta,
    repoId: input.repoId,
    architectureSnapshotHash: input.architectureSnapshotHash,
    hazardMethod: method,
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: method === "FHA" ? selectedHazardGenerationMode : undefined,
    operationalContext: input.operationalContext,
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

  onActivityUpdate({ step: 1, message: "Generating code architecture hazard analysis..." });
  const generatedSheetsRaw = await runLiteAIAnalysis({
    tableRows: input.tableRows,
    sheets: input.sheets,
    setFolders,
    currentFolder,
    setChatPrompt: () => {},
    setChatResponse: () => {},
    setProgress,
    hazardMethod: method,
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: selectedHazardGenerationMode,
    operationalContext: input.operationalContext,
    analysisContext: input.analysisContext,
    contextSources: input.contextSources,
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
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: method === "FHA" ? selectedHazardGenerationMode : undefined,
    operationalContext: input.operationalContext,
    contextSources: input.contextSources,
    generatedSheets,
  }, {
    projectId,
    repoMeta,
    repoId: input.repoId,
    architectureSnapshotHash: input.architectureSnapshotHash,
    hazardMethod: method,
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: method === "FHA" ? selectedHazardGenerationMode : undefined,
    operationalContext: input.operationalContext,
    contextSources: input.contextSources,
  });

  await saveCodeArchitectureHazardRun(run);
  onActivityUpdate({ step: 9, message: "Code architecture hazard analysis complete." });
  return run;
}
