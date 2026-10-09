import { screenCodeHazardApplicability } from './codeHazardApplicabilityScreening';
import { createCodeHazardCheckpoint } from './codeHazardGenerationCheckpoint';
import { getStoredActiveAIProvider, getStoredAIProviderModelPreference, getStoredAIProviderEffortPreference } from '../../lib/aiProviderConfig';
import { functionalModelIsReady } from '../code-architecture-context/functionalModel';
import { fillNotApplicableHazardSummary } from '../project-hazard-analysis/hazardNotApplicableCells';
import { prepareCodeHazardPreprocessing, reconcileCodeHazardPreprocessing } from './codeArchitectureHazardPreprocessing';
import { ensureHazardAnalysisRowIds } from '../project-hazard-analysis/classificationResolutionStatus';
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
  previousRun = null,
  regenerate = false,
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
  const checkCancelled = () => { if (signal?.aborted) throw new DOMException('Hazard analysis cancelled.', 'AbortError'); };
  checkCancelled();
  if (!Array.isArray(cbaRows) || cbaRows.length === 0) {
    throw new Error("Generate or load a code-based functional architecture before running hazard analysis.");
  }

  if (!functionalModelIsReady(cbaRows) && (cbaRows.some(row => row.functionalAbstraction) || repoMeta.functionalProcessingError)) {
    throw new Error('Generate an up-to-date Functional model before running hazard analysis. The existing functional model is incomplete or stale.');
  }
  let input = prepareCodeHazardPreprocessing(buildCodeArchitectureHazardInput({
    cbaRows,
    repoMeta,
    projectId,
    method,
    operationalContexts,
    selectedOperationalContextId,
  }), previousRun);
  if (!input.tableRows.length) {
    throw new Error("No Code-Based Architecture rows are marked Include for hazard analysis. Review or override the eligibility classifications in the functional decomposition table.");
  }
  const eligibilityMessage = `${input.analysisAbstraction} model: ${input.eligibilitySummary.include} included, ${input.eligibilitySummary.exclude} excluded, ${input.eligibilitySummary.needsReview} need review`;
  onActivityUpdate({ step: 0, message: `Preparing code architecture hazard analysis (${eligibilityMessage})...` });
  const sourceAuditedTableRows = await enrichHazardTableRowsWithSourceContent(
    input.sourceTableRows || input.tableRows,
    repoMeta,
  );

  const modelContext = {
    provider: getStoredActiveAIProvider(),
    model: getStoredAIProviderModelPreference(getStoredActiveAIProvider(), {includeDefault: true}),
    effort: getStoredAIProviderEffortPreference(getStoredActiveAIProvider()),
  };
  const generationCheckpoint = await createCodeHazardCheckpoint({
    projectId, repoId: input.repoId, method,
    ...modelContext,
    preprocessing: previousRun?.userPreprocessing || null,
  }, {regenerate, signal, onProgress: setProgress});
  if (['STPA-Textbook', 'STPA_TEXTBOOK', 'STPA_TEXTBOOK_APPROACH'].includes(method)) {
    input = await screenCodeHazardApplicability(input, {sourceRows: sourceAuditedTableRows,
      checkpoint: generationCheckpoint, modelContext, signal, onProgress: setProgress});
    const counts = input.applicabilityScreening.counts;
    setProgress({phase: 'hazard-generation', message: `Applicability screened: ${counts.yes} applicable, ${counts.no} excluded, ${counts.unresolved} need review. Generating applicable hazards...`});
  }

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
    analysisAbstraction: input.analysisAbstraction,
    functionalModelSnapshotHash: input.functionalModelSnapshotHash,
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
    applicabilityScreening: input.applicabilityScreening || null,
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
    checkCancelled();
    const prev = { [currentFolder]: currentGeneratedSheets };
    const nextFolders = typeof updater === "function" ? await updater(prev) : prev;
    checkCancelled();
    currentGeneratedSheets = nextFolders?.[currentFolder] || currentGeneratedSheets;
    const reviewedSheets = ensureHazardSummaryEvidenceColumns(
      ensureHazardSummaryTraceColumns(currentGeneratedSheets, sourceAuditedTableRows),
      sourceAuditedTableRows
    );
    // Intermediate sheets can omit assessed rows or identity columns. Keep the
    // authoritative imported table visible until the final preservation pass
    // succeeds. Progress reporting continues independently of table updates.
    if (!input.tableRows.some(row => row.userPreprocessing)) {
      onPartialRunUpdate(buildRun(reviewedSheets));
    }
    return nextFolders;
  };

  onActivityUpdate({ step: 1, message: `Generating code architecture hazard analysis from ${input.eligibilitySummary.include} eligible interface${input.eligibilitySummary.include === 1 ? "" : "s"}...` });
  const generatedSheetsRaw = await runLiteAIAnalysis({
    generationCheckpoint,
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
  checkCancelled();
  const summary = generatedSheetsRaw?.Summary;
  const resultColumns = (Array.isArray(summary?.[0]) ? summary[0] : []).map(value => String(value).trim().toLowerCase());
  const assessmentColumns = resultColumns.map((name, index) =>
    /^(hazards?|loss(?:es)?|unsafe control actions?|failure mode|what.if scenario|causal (?:factor|scenario)s?|mitigation strateg(?:y|ies)|security loss|unacceptable security condition|vulnerable control action|security control)$/.test(name) ? index : -1).filter(index => index >= 0);
  const applicabilityColumn = resultColumns.indexOf('guide phrase applicable');
  const incomplete = !Array.isArray(summary) || summary.length < 2 || summary.slice(1).some(row =>
    !Array.isArray(row) || (!assessmentColumns.some(index => String(row[index] || '').trim()) &&
    String(row[applicabilityColumn] || '').trim().toLowerCase() !== 'no'));
  if (incomplete) throw new Error('Hazard analysis did not produce completed assessment rows. Previous saved results were preserved; check the generation error before retrying.');
  let generatedSheets = ensureHazardSummaryEvidenceColumns(
    ensureHazardSummaryTraceColumns(generatedSheetsRaw, sourceAuditedTableRows),
    sourceAuditedTableRows
  );

  const hasPreprocessing = input.tableRows.some(row => row.userPreprocessing);
  if (hasPreprocessing && generatedSheets.Summary) generatedSheets = { ...generatedSheets, Summary: ensureHazardAnalysisRowIds(generatedSheets.Summary) };
  const reconciled = reconcileCodeHazardPreprocessing(generatedSheets, input.tableRows);
  generatedSheets = { ...reconciled.sheets, Summary: fillNotApplicableHazardSummary(reconciled.sheets.Summary) };
  if (hasPreprocessing && input.tableRows.some(row => row.userPreprocessing && !reconciled.ownership[row.userPreprocessingId])) {
    throw new Error('Generated results could not be matched uniquely to the user assessments. The prior saved run remains available.');
  }
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
    analysisAbstraction: input.analysisAbstraction,
    functionalModelSnapshotHash: input.functionalModelSnapshotHash,
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
    applicabilityScreening: input.applicabilityScreening || null,
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

  if (hasPreprocessing) {
    run.userPreprocessing = { ...previousRun?.userPreprocessing, ...reconciled.ownership };
    run.userPreprocessingConflicts = reconciled.conflicts;
  }
  checkCancelled();
  await saveCodeArchitectureHazardRun(run);
  // Cleanup must not turn an already-published result into a failed run.
  try { await generationCheckpoint?.prune(); } catch (error) { console.warn('[hazard-checkpoint] Cleanup deferred', error); }
  onActivityUpdate({ step: 9, message: input.applicabilityScreening?.counts.unresolved ? `Applicable rows analyzed; ${input.applicabilityScreening.counts.unresolved} guide-phrase decisions need review.` : "Code architecture hazard analysis complete." });
  return run;
}
