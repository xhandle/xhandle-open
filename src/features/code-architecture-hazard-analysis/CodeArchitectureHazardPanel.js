import React, { useEffect, useMemo, useState } from "react";
import {
  CODE_ARCHITECTURE_HAZARD_GENERATION_MODE_OPTIONS,
  CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS,
} from "./codeArchitectureHazardTypes";
import { isCodeArchitectureHazardAnalysisStale } from "./codeArchitectureHazardUtils";
import CodeArchitectureHazardSummaryTable from "./CodeArchitectureHazardSummaryTable";

export default function CodeArchitectureHazardPanel({
  cbaRows = [],
  latestRun,
  method,
  onMethodChange,
  hazardGenerationMode = "standard",
  onHazardGenerationModeChange,
  onRunAnalysis,
  isRunning = false,
  progress,
  reviewItems = [],
  reviewByRow,
  reviewDrawerOptions,
  forceSummaryOpenKey,
  highlightedRowIndex,
  onOpenArchitectureTarget,
  onClearContents,
  onDeleteSummaryRow,
  reviewMode = false,
}) {
  const summarySheet = latestRun?.generatedSheets?.Summary;
  const hasSummary = Array.isArray(summarySheet) && summarySheet.length >= 2;
  const [showSummary, setShowSummary] = useState(hasSummary);
  const isStale = useMemo(
    () => latestRun ? isCodeArchitectureHazardAnalysisStale({ run: latestRun, cbaRows }) : false,
    [latestRun, cbaRows]
  );
  const summaryCount = Math.max(0, (Array.isArray(summarySheet) ? summarySheet.length : 1) - 1);
  const statusMessage = latestRun
    ? isStale
      ? "Architecture changed since this run. Re-run before generating new remediation findings."
      : `Latest ${latestRun.hazardMethod || "hazard"} run has ${summaryCount} summary row${summaryCount === 1 ? "" : "s"}.`
    : "Run hazard analysis first for grounded remediation recommendations.";
  const statusClass = latestRun && !isStale ? "text-emerald-700" : "text-amber-700";

  useEffect(() => {
    if (forceSummaryOpenKey) setShowSummary(true);
  }, [forceSummaryOpenKey]);

  useEffect(() => {
    if (hasSummary) setShowSummary(true);
  }, [hasSummary, latestRun?.id]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-[260px] flex-1">
          <div className="text-sm font-semibold text-slate-900">Code Architecture Hazard Analysis</div>
          <div className="text-xs text-slate-500 md:inline">
            Run STPA, FMEA, or What-If on this code-based functional architecture before generating remediation findings.
          </div>
          {!isRunning && (
            <div className={`mt-1 text-xs font-medium ${statusClass}`}>
              {statusMessage}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={method}
            onChange={(event) => onMethodChange?.(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            disabled={isRunning || reviewMode}
          >
            {CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {["STPA-Textbook", "FMEA-Textbook", "WhatIf-Textbook", "HARA", "FHA"].includes(method) && (
            <select
              value={hazardGenerationMode}
              onChange={(event) => onHazardGenerationModeChange?.(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              disabled={isRunning || reviewMode}
              aria-label="Hazard analysis generation mode"
            >
              {CODE_ARCHITECTURE_HAZARD_GENERATION_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.description}
                </option>
              ))}
            </select>
          )}
          {!reviewMode && (
            <button
              type="button"
              onClick={() => onRunAnalysis?.(method, { hazardGenerationMode })}
              disabled={isRunning || !cbaRows.length}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isRunning ? "Running..." : "Run Hazard Analysis"}
            </button>
          )}
          {latestRun && (
            <button
              type="button"
              onClick={() => setShowSummary((value) => !value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {showSummary ? "Hide Summary" : "View Summary"}
            </button>
          )}
          {!reviewMode && (
            <button
              type="button"
              onClick={onClearContents}
              disabled={isRunning || !latestRun}
              className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Contents
            </button>
          )}
        </div>
      </div>
      {(isRunning || showSummary) && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden border-t border-slate-200 px-4 py-3">
          {isRunning && (
            <div className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {progress?.message || "Running code architecture hazard analysis..."}
            </div>
          )}
          {showSummary && (
            <CodeArchitectureHazardSummaryTable
              summarySheet={summarySheet}
              className="min-h-0 flex-1"
              reviewItems={reviewItems}
              reviewByRow={reviewByRow}
              reviewDrawerOptions={reviewDrawerOptions}
              showReview
              highlightedRowIndex={highlightedRowIndex}
              storageKey={`code-architecture-hazard-summary:${latestRun?.repoId || "repo"}:${latestRun?.id || "latest"}`}
              onOpenArchitectureTarget={onOpenArchitectureTarget}
              onDeleteRow={reviewMode ? undefined : onDeleteSummaryRow}
              readOnly={reviewMode}
            />
          )}
        </div>
      )}
    </div>
  );
}
