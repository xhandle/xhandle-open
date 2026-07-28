import React, { useEffect, useMemo, useState } from "react";
import { FunctionalDecompositionTable } from "../../components/generateFunctionalDecompositionFromGitHub";
import {
  ARTIFACT_KINDS,
  EngineeringArtifactPanel,
  TraceabilityMatrixPanel,
} from "../code-architecture-assurance";
import {
  architectureLabelFromRef,
  architectureRefToFocusTarget,
  artifactKindForLinkType,
  functionalRowIndexForTraceValue,
  normalizeFunctionalRowRef,
  splitIds,
} from "../code-architecture-assurance/artifactUtils";
import { CodeArchitectureHazardPanel } from "../code-architecture-hazard-analysis";
import { ResultsReviewProvider } from "../results-review";
import { SafetyRemediationPanel } from "../safety-remediation";
import { REVIEW_ANALYSIS_SECTIONS } from "./codeArchitectureReviewExport";

function repoMetaFromPackage(reviewPackage, context = null) {
  const repo = context?.repo || reviewPackage?.activeRepo || {};
  const repoMeta = context?.repoMeta || {};
  return {
    owner: repoMeta.owner || repo.owner || "",
    repo: repoMeta.repo || repo.repo || "",
    repoId: repoMeta.repoId || repo.repoId || repo.repoName || repo.id || "",
    repoName: repoMeta.repoName || repo.repoName || repo.repoId || repo.id || "",
    repoUrl: repoMeta.repoUrl || repo.repoUrl || "",
    branch: repoMeta.branch || repo.branch || "main",
    commitSha: repoMeta.commitSha || repo.commitSha || "",
  };
}

function artifactCollectionsFromPackage(reviewPackage, context = null) {
  const artifacts = context?.assuranceArtifacts || reviewPackage?.data?.assuranceArtifacts || {};
  const softwareRows = artifacts[ARTIFACT_KINDS.SOFTWARE] || artifacts.softwareRequirements || [];
  const systemRows = artifacts[ARTIFACT_KINDS.SYSTEM] || artifacts.systemRequirements || [];
  const subsystemRows = artifacts[ARTIFACT_KINDS.SUBSYSTEM] || artifacts.subsystemRequirements || [];
  const designRows = artifacts[ARTIFACT_KINDS.DESIGN] || artifacts.designElements || [];
  return {
    softwareRows,
    systemRows,
    subsystemRows,
    designRows,
    softwareRequirements: softwareRows,
    systemRequirements: systemRows,
    subsystemRequirements: subsystemRows,
    designElements: designRows,
  };
}

function remediationFromPackage(reviewPackage, context = null) {
  return context?.safetyRemediation || reviewPackage?.data?.safetyRemediation || null;
}

function remediationHasData(remediation) {
  if (!remediation || typeof remediation !== "object") return false;
  return [
    remediation.safetyFindings,
    remediation.patchProposals,
    remediation.reviewDecisions,
    remediation.summaryArtifacts,
    remediation.verificationRuns,
    remediation.safetyRemediationEvidence,
  ].some((rows) => Array.isArray(rows) && rows.length > 0);
}

function firstArchitectureFocusTarget(row = {}, value = "") {
  const refs = Array.isArray(row?.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  const rawValue = String(value || "").trim();
  const targetValue = normalizeFunctionalRowRef(rawValue);
  const ref = refs.find((candidate) => {
    if (architectureLabelFromRef(candidate) === rawValue) return true;
    const fields = [
      candidate.traceId,
      candidate.rowRef,
      Number.isFinite(Number(candidate.rowIndex)) ? Number(candidate.rowIndex) + 1 : "",
      candidate.edgeId,
      candidate.fromNodeId,
      candidate.toNodeId,
      candidate.fromFunction,
      candidate.controlAction,
      candidate.toFunction,
    ].map((item) => String(item || "").trim()).filter(Boolean);
    const normalizedFields = fields.map(normalizeFunctionalRowRef).filter(Boolean);
    return fields.includes(rawValue) ||
      fields.includes(targetValue) ||
      normalizedFields.includes(targetValue) ||
      fields.some((field) => rawValue && rawValue.includes(field));
  }) || refs[0] || null;
  return ref ? architectureRefToFocusTarget(ref) : null;
}

function hazardRowIndexForValue(hazardRun, value = "") {
  const target = String(value || "").trim();
  const summary = Array.isArray(hazardRun?.generatedSheets?.Summary)
    ? hazardRun.generatedSheets.Summary
    : [];
  const rows = summary.slice(1);
  return rows.findIndex((row, index) => {
    const values = [
      row?.hazardRowRef,
      row?.id,
      row?.rowRef,
      `hazard-row-${index + 1}`,
      `HZ-${String(index + 1).padStart(3, "0")}`,
      String(index + 1),
    ].map((item) => String(item || "").trim());
    return values.includes(target);
  });
}

function buildReviewContexts(reviewPackage) {
  const repositories = Array.isArray(reviewPackage?.data?.repositories)
    ? reviewPackage.data.repositories
    : [];
  if (repositories.length) {
    return repositories.map((entry, index) => {
      const repo = entry.repo || {};
      const project = entry.project || reviewPackage.project || {};
      const label = entry.label || [
        project.name,
        repo.repoName || repo.repoId || repo.id,
      ].filter(Boolean).join(" - ") || `Review scope ${index + 1}`;
      return {
        ...entry,
        id: entry.id || `${repo.id || "repo"}:${index}`,
        label,
        project,
        repo,
        cbaRows: entry.cbaRows || [],
        hazardRun: entry.hazardRun || null,
        safetyRemediation: entry.safetyRemediation || null,
      };
    });
  }
  return [{
    id: "active",
    type: "project",
    label: [
      reviewPackage?.project?.name,
      reviewPackage?.activeRepo?.repoName || reviewPackage?.activeRepo?.repoId,
    ].filter(Boolean).join(" - ") || "Review scope",
    project: reviewPackage?.project || {},
    repo: reviewPackage?.activeRepo || {},
    repoMeta: reviewPackage?.repoMeta || {},
    cbaRows: reviewPackage?.data?.cbaRows || [],
    diagramPositions: reviewPackage?.data?.diagramPositions || null,
    assuranceArtifacts: reviewPackage?.data?.assuranceArtifacts || {},
    hazardRun: reviewPackage?.data?.hazardRun || null,
    safetyRemediation: reviewPackage?.data?.safetyRemediation || null,
  }];
}

function ReviewWorkspace({ reviewPackage }) {
  const [activeTab, setActiveTab] = useState(reviewPackage?.uiState?.activeWorkspaceTab || "architecture");
  const reviewContexts = useMemo(() => buildReviewContexts(reviewPackage), [reviewPackage]);
  const [activeContextId, setActiveContextId] = useState(reviewContexts[0]?.id || "active");
  const [hazardTab, setHazardTab] = useState(reviewPackage?.uiState?.hazardRemediationTab || "hazard-analysis");
  const [pendingDiagramTarget, setPendingDiagramTarget] = useState(null);
  const [functionalTableOpenKey, setFunctionalTableOpenKey] = useState(null);
  const [highlightedFunctionalRowIndex, setHighlightedFunctionalRowIndex] = useState(null);
  const [hazardSummaryOpenKey, setHazardSummaryOpenKey] = useState(null);
  const [highlightedHazardRowIndex, setHighlightedHazardRowIndex] = useState(null);
  const [artifactFocusTarget, setArtifactFocusTarget] = useState(null);
  const activeContext = useMemo(
    () => reviewContexts.find((entry) => entry.id === activeContextId) || reviewContexts[0] || {},
    [activeContextId, reviewContexts]
  );
  const isCrossRepoContext = activeContext.type === "cross-repo";
  const project = activeContext.project || reviewPackage.project;
  const repo = activeContext.repo || reviewPackage.activeRepo;
  const cbaRows = activeContext.cbaRows || reviewPackage.data?.cbaRows || [];
  const hazardRun = activeContext.hazardRun || reviewPackage.data?.hazardRun || null;
  const repoMeta = useMemo(() => repoMetaFromPackage(reviewPackage, activeContext), [activeContext, reviewPackage]);
  const artifacts = useMemo(() => artifactCollectionsFromPackage(reviewPackage, activeContext), [activeContext, reviewPackage]);
  const safetyRemediation = useMemo(() => remediationFromPackage(reviewPackage, activeContext), [activeContext, reviewPackage]);
  const includedAnalysis = reviewPackage?.uiState?.includedAnalysis || null;
  const hasHazard = Array.isArray(hazardRun?.generatedSheets?.Summary) && hazardRun.generatedSheets.Summary.length > 1;
  const hasSafetyRemediation = remediationHasData(safetyRemediation);
  const hasSoftware = artifacts.softwareRows.length > 0;
  const hasSystem = artifacts.systemRows.length > 0;
  const hasSubsystem = artifacts.subsystemRows.length > 0;
  const hasDesign = artifacts.designRows.length > 0;
  const hasTraceability = hasSoftware || hasSystem || hasSubsystem || hasDesign;
  const sectionIncluded = (section, hasData) => (
    includedAnalysis
      ? Boolean(includedAnalysis[section] && hasData)
      : hasData
  );
  const showHazard = sectionIncluded(REVIEW_ANALYSIS_SECTIONS.HAZARD, hasHazard || hasSafetyRemediation);
  const showSoftware = sectionIncluded(REVIEW_ANALYSIS_SECTIONS.SOFTWARE, hasSoftware);
  const showSystem = sectionIncluded(REVIEW_ANALYSIS_SECTIONS.SYSTEM, hasSystem);
  const showSubsystem = sectionIncluded(REVIEW_ANALYSIS_SECTIONS.SUBSYSTEM, hasSubsystem);
  const showDesign = sectionIncluded(REVIEW_ANALYSIS_SECTIONS.DESIGN, hasDesign);
  const showTraceability = sectionIncluded(REVIEW_ANALYSIS_SECTIONS.TRACEABILITY, hasTraceability);
  const diagramArtifacts = useMemo(() => ({
    softwareRows: showSoftware ? artifacts.softwareRows : [],
    systemRows: showSystem ? artifacts.systemRows : [],
    subsystemRows: showSubsystem ? artifacts.subsystemRows : [],
    designRows: showDesign ? artifacts.designRows : [],
    softwareRequirements: showSoftware ? artifacts.softwareRequirements : [],
    systemRequirements: showSystem ? artifacts.systemRequirements : [],
    subsystemRequirements: showSubsystem ? artifacts.subsystemRequirements : [],
    designElements: showDesign ? artifacts.designElements : [],
  }), [artifacts, showDesign, showSoftware, showSubsystem, showSystem]);
  const visibleTabKeys = useMemo(() => [
    "architecture",
    ...(showHazard ? ["safety"] : []),
    ...(showSoftware ? [ARTIFACT_KINDS.SOFTWARE] : []),
    ...(showSystem ? [ARTIFACT_KINDS.SYSTEM] : []),
    ...(showSubsystem ? [ARTIFACT_KINDS.SUBSYSTEM] : []),
    ...(showDesign ? [ARTIFACT_KINDS.DESIGN] : []),
    ...(showTraceability ? ["traceability-matrix"] : []),
  ], [showDesign, showHazard, showSoftware, showSubsystem, showSystem, showTraceability]);
  const activeSafetySubtab = hasSafetyRemediation && (!hasHazard || hazardTab === "remediation")
    ? "remediation"
    : "hazard-analysis";
  const functionalReviewItems = useMemo(
    () => (reviewPackage.data?.reviewItems || []).filter((item) => String(item.artifactType || "").includes("functional")),
    [reviewPackage]
  );
  const hazardReviewItems = useMemo(
    () => (reviewPackage.data?.reviewItems || []).filter((item) => String(item.artifactType || "").includes("hazard")),
    [reviewPackage]
  );

  useEffect(() => {
    if (!visibleTabKeys.includes(activeTab)) setActiveTab("architecture");
  }, [activeTab, visibleTabKeys]);

  useEffect(() => {
    if (activeTab !== "safety") return;
    if (hazardTab === "hazard-analysis" && !hasHazard && hasSafetyRemediation) {
      setHazardTab("remediation");
    }
    if (hazardTab === "remediation" && !hasSafetyRemediation && hasHazard) {
      setHazardTab("hazard-analysis");
    }
  }, [activeTab, hazardTab, hasHazard, hasSafetyRemediation]);

  useEffect(() => {
    if (!reviewContexts.some((entry) => entry.id === activeContextId)) {
      setActiveContextId(reviewContexts[0]?.id || "active");
    }
  }, [activeContextId, reviewContexts]);

  const tabButton = (tab, label) => (
    <button
      key={tab}
      type="button"
      onClick={() => setActiveTab(tab)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
        activeTab === tab ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );

  const openFunctionalRow = (target) => {
    const rowIndex = Number(
      typeof target === "object" && target !== null
        ? target.rowIndex ?? target.sourceIndex
        : target
    );
    if (!Number.isFinite(rowIndex) || rowIndex < 0) return;
    setActiveTab("architecture");
    setFunctionalTableOpenKey(`open-${Date.now()}`);
    setHighlightedFunctionalRowIndex(rowIndex);
    setTimeout(() => {
      setHighlightedFunctionalRowIndex((current) => (current === rowIndex ? null : current));
    }, 2600);
  };

  const openHazardRow = (rowIndex) => {
    if (!showHazard) return;
    const targetIndex = Number(rowIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) return;
    setActiveTab("safety");
    setHazardTab("hazard-analysis");
    setHazardSummaryOpenKey(`open-${Date.now()}`);
    setHighlightedHazardRowIndex(targetIndex);
    setTimeout(() => {
      setHighlightedHazardRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
  };

  const openArtifactRow = (tab, rowIds) => {
    if (!visibleTabKeys.includes(tab)) return;
    const ids = (Array.isArray(rowIds) ? rowIds : [rowIds]).map((id) => String(id || "").trim()).filter(Boolean);
    if (!tab || !ids.length) return;
    setActiveTab(tab);
    const focus = { tab, rowIds: ids, key: Date.now() };
    setArtifactFocusTarget(focus);
  };

  const handleArtifactFocusResolved = React.useCallback(() => {
    setTimeout(() => {
      setArtifactFocusTarget(null);
    }, 2600);
  }, []);

  const openTraceLink = ({ linkType, value, row } = {}) => {
    const artifactKind = artifactKindForLinkType(linkType);
    if (artifactKind) {
      openArtifactRow(artifactKind, splitIds(value));
      return;
    }

    if (linkType === "functional-row") {
      const rowIndex = functionalRowIndexForTraceValue(cbaRows, value || row?.functionalTraceId);
      if (rowIndex >= 0) openFunctionalRow(rowIndex);
      return;
    }

    if (linkType === "architecture-source") {
      const focusTarget = firstArchitectureFocusTarget(row, value);
      if (focusTarget) {
        const rowIndex = Number(focusTarget.rowIndex);
        if (Number.isFinite(rowIndex) && rowIndex >= 0) {
          setFunctionalTableOpenKey(`open-${Date.now()}`);
          setHighlightedFunctionalRowIndex(rowIndex);
          setTimeout(() => {
            setHighlightedFunctionalRowIndex((current) => (current === rowIndex ? null : current));
          }, 2600);
        }
        setPendingDiagramTarget(focusTarget);
        setActiveTab("architecture");
      }
      return;
    }

    if (linkType === "hazard-row") {
      const rowIndex = hazardRowIndexForValue(hazardRun, value);
      if (rowIndex >= 0) openHazardRow(rowIndex);
    }
  };

  return (
    <div className="fixed inset-0 flex bg-white">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden px-3 py-2 md:px-5 lg:px-7">
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">Code architecture project</p>
              <h1 className="text-xl font-semibold text-gray-900">{project?.name || "Code-Based Architecture"}</h1>
              <p className="text-xs text-gray-500">{repo?.repoName || repo?.repoId || "Packaged repository"}</p>
            </div>
            {reviewContexts.length > 1 ? (
              <label className="min-w-[260px] text-xs font-semibold text-slate-500">
                Review scope
                <select
                  value={activeContext.id || ""}
                  onChange={(event) => setActiveContextId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  {reviewContexts.map((context) => (
                    <option key={context.id} value={context.id}>{context.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1.5">
              {tabButton("architecture", "Architecture Diagram")}
              {showHazard && tabButton("safety", "Hazard & Remediation")}
              {showSoftware && tabButton(ARTIFACT_KINDS.SOFTWARE, "Software Requirements")}
              {showSystem && tabButton(ARTIFACT_KINDS.SYSTEM, "System Requirements")}
              {showSubsystem && tabButton(ARTIFACT_KINDS.SUBSYSTEM, "Subsystem Requirements")}
              {showDesign && tabButton(ARTIFACT_KINDS.DESIGN, "System / Subsystem Design")}
              {showTraceability && tabButton("traceability-matrix", "Traceability Matrix")}
            </div>

            {activeTab === "architecture" ? (
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-white p-3">
                <FunctionalDecompositionTable
                  key={`architecture:${activeContext.id}`}
                  data={cbaRows}
                  repoMeta={repoMeta}
                  reviewItems={functionalReviewItems}
                  hazardSummary={showHazard ? hazardRun?.generatedSheets?.Summary : null}
                  assuranceArtifacts={diagramArtifacts}
	                  focusTarget={pendingDiagramTarget}
	                  onFocusTargetHandled={() => setPendingDiagramTarget(null)}
	                  forceTableOpenKey={functionalTableOpenKey}
	                  highlightedRowIndex={highlightedFunctionalRowIndex}
	                  onOpenFunctionalRow={openFunctionalRow}
	                  onOpenHazardRow={openHazardRow}
	                  onOpenAssuranceArtifactRow={openArtifactRow}
                  architectureLevelLabels={isCrossRepoContext ? {
                    architecture: "Architecture",
                    subsystem: "System Element",
                    csci: "Subsystem",
                    csc: "CSCI",
                    csu: "CSC",
                    detailed: "CSU",
                  } : null}
                  architectureLevels={isCrossRepoContext ? [
                    ["subsystem", "System Element"],
                    ["csci", "Subsystem"],
                    ["csc", "CSCI"],
                    ["csu", "CSC"],
                    ["detailed", "CSU"],
                  ] : null}
	                  reviewMode
	                />
              </div>
            ) : activeTab === ARTIFACT_KINDS.SOFTWARE && showSoftware ? (
              <EngineeringArtifactPanel
                key={`${ARTIFACT_KINDS.SOFTWARE}:${activeContext.id}`}
                kind={ARTIFACT_KINDS.SOFTWARE}
                cbaRows={cbaRows}
                project={project}
                repo={repo}
                hazardAnalysis={hazardRun}
	                initialRows={artifacts.softwareRows}
	                initialArtifactCollections={artifacts}
	                focusTarget={artifactFocusTarget}
                  onFocusResolved={handleArtifactFocusResolved}
                  onOpenTrace={openTraceLink}
	                reviewMode
	              />
            ) : activeTab === ARTIFACT_KINDS.SYSTEM && showSystem ? (
              <EngineeringArtifactPanel
                key={`${ARTIFACT_KINDS.SYSTEM}:${activeContext.id}`}
                kind={ARTIFACT_KINDS.SYSTEM}
                cbaRows={cbaRows}
                sourceRows={artifacts.softwareRows}
                project={project}
                repo={repo}
	                initialRows={artifacts.systemRows}
	                initialArtifactCollections={artifacts}
	                focusTarget={artifactFocusTarget}
                  onFocusResolved={handleArtifactFocusResolved}
                  onOpenTrace={openTraceLink}
	                reviewMode
	              />
            ) : activeTab === ARTIFACT_KINDS.SUBSYSTEM && showSubsystem ? (
              <EngineeringArtifactPanel
                key={`${ARTIFACT_KINDS.SUBSYSTEM}:${activeContext.id}`}
                kind={ARTIFACT_KINDS.SUBSYSTEM}
                cbaRows={cbaRows}
                sourceRows={artifacts.systemRows}
                project={project}
                repo={repo}
	                initialRows={artifacts.subsystemRows}
	                initialArtifactCollections={artifacts}
	                focusTarget={artifactFocusTarget}
                  onFocusResolved={handleArtifactFocusResolved}
                  onOpenTrace={openTraceLink}
	                reviewMode
	              />
            ) : activeTab === ARTIFACT_KINDS.DESIGN && showDesign ? (
              <EngineeringArtifactPanel
                key={`${ARTIFACT_KINDS.DESIGN}:${activeContext.id}`}
                kind={ARTIFACT_KINDS.DESIGN}
                cbaRows={cbaRows}
                sourceRows={artifacts.subsystemRows}
                project={project}
                repo={repo}
	                initialRows={artifacts.designRows}
	                initialArtifactCollections={artifacts}
	                focusTarget={artifactFocusTarget}
                  onFocusResolved={handleArtifactFocusResolved}
                  onOpenTrace={openTraceLink}
	                reviewMode
	              />
            ) : activeTab === "traceability-matrix" && showTraceability ? (
              <TraceabilityMatrixPanel
                key={`traceability:${activeContext.id}`}
                cbaRows={cbaRows}
                project={project}
                repo={repo}
                initialArtifacts={artifacts}
                onOpenTrace={openTraceLink}
              />
            ) : activeTab === "safety" && showHazard ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1.5">
                  {[
                    ...(hasHazard ? ["hazard-analysis"] : []),
                    ...(hasSafetyRemediation ? ["remediation"] : []),
                  ].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setHazardTab(tab)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                        activeSafetySubtab === tab ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {tab === "hazard-analysis" ? "Code Architecture Hazard Analysis" : "Safety Remediation"}
                    </button>
                  ))}
                </div>
                {activeSafetySubtab === "hazard-analysis" && hasHazard ? (
                  <CodeArchitectureHazardPanel
                    key={`hazard:${activeContext.id}`}
                    cbaRows={cbaRows}
                    latestRun={hazardRun}
                    method={hazardRun?.hazardMethod || "STPA-Textbook"}
                    hazardGenerationMode={hazardRun?.hazardGenerationMode || "standard"}
	                    reviewItems={hazardReviewItems}
	                    forceSummaryOpenKey={hazardSummaryOpenKey}
	                    highlightedRowIndex={highlightedHazardRowIndex}
	                    onOpenArchitectureTarget={(target) => {
                        const rowIndex = Number(target?.rowIndex);
                        if (Number.isFinite(rowIndex) && rowIndex >= 0) {
                          setFunctionalTableOpenKey(`open-${Date.now()}`);
                          setHighlightedFunctionalRowIndex(rowIndex);
                          setTimeout(() => {
                            setHighlightedFunctionalRowIndex((current) => (current === rowIndex ? null : current));
                          }, 2600);
                        }
	                      setPendingDiagramTarget(target);
	                      setActiveTab("architecture");
                    }}
                    reviewMode
                  />
                ) : (
                  <SafetyRemediationPanel
                    key={`remediation:${activeContext.id}`}
                    project={project}
                    projectId={project?.id}
                    cbaRows={cbaRows}
                    hazardSummarySheet={hazardRun?.generatedSheets?.Summary || []}
                    codeArchitectureHazardAnalysis={hazardRun}
                    repoMeta={repoMeta}
                    initialState={safetyRemediation}
                    onOpenHazardSummaryRow={openHazardRow}
                    reviewMode
                    compact
                  />
                )}
              </div>
            ) : (
              <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                Select an included review section above.
              </div>
            )}
          </div>
        </main>
    </div>
  );
}

export default function ReviewPackageApp({ reviewPackage }) {
  if (!reviewPackage) {
    return (
      <div className="grid h-screen place-items-center bg-white p-6 text-sm text-slate-600">
        No review package data was found.
      </div>
    );
  }

  return (
    <ResultsReviewProvider readOnly initialReviewItems={reviewPackage.data?.reviewItems || []}>
      <ReviewWorkspace reviewPackage={reviewPackage} />
    </ResultsReviewProvider>
  );
}
