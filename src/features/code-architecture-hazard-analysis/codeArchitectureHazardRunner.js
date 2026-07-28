import { runLiteAIAnalysis } from "../../components/aiAnalysisLite";
import { saveCodeArchitectureHazardRun } from "./codeArchitectureHazardStore";
import {
  buildCodeArchitectureHazardInput,
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
    generatedSheets,
  }, {
    projectId,
    repoMeta,
    repoId: input.repoId,
    architectureSnapshotHash: input.architectureSnapshotHash,
    hazardMethod: method,
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: method === "FHA" ? selectedHazardGenerationMode : undefined,
  });
  const setFolders = async (updater) => {
    const prev = { [currentFolder]: currentGeneratedSheets };
    const nextFolders = typeof updater === "function" ? await updater(prev) : prev;
    currentGeneratedSheets = nextFolders?.[currentFolder] || currentGeneratedSheets;
    const tracedSheets = ensureHazardSummaryTraceColumns(currentGeneratedSheets, input.tableRows);
    onPartialRunUpdate(buildRun(tracedSheets));
    return nextFolders;
  };

  onActivityUpdate({ step: 0, message: "Preparing code architecture hazard analysis..." });
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
  });
  const generatedSheets = ensureHazardSummaryTraceColumns(generatedSheetsRaw, input.tableRows);

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
    generatedSheets,
  }, {
    projectId,
    repoMeta,
    repoId: input.repoId,
    architectureSnapshotHash: input.architectureSnapshotHash,
    hazardMethod: method,
    hazardGenerationMode: selectedHazardGenerationMode,
    fhaGenerationMode: method === "FHA" ? selectedHazardGenerationMode : undefined,
  });

  await saveCodeArchitectureHazardRun(run);
  onActivityUpdate({ step: 9, message: "Code architecture hazard analysis complete." });
  return run;
}
