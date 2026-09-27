import { fillNotApplicableHazardSummary } from '../project-hazard-analysis/hazardNotApplicableCells';
import FunctionalDiagramWorkspace from '../../components/FunctionalDiagramWorkspace';
import { filterCodeArchitectureHazardRowsByContext } from './codeArchitectureHazardGrouping';
import HazardCsvIssuesModal from '../project-hazard-analysis/HazardCsvIssuesModal';
import { ensureHazardAnalysisRowIds } from '../project-hazard-analysis/classificationResolutionStatus';
import { applyHazardAnalysisCsvImport, planHazardAnalysisCsvImport, describeHazardCsvPlan } from '../project-hazard-analysis/hazardAnalysisCsv';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsDown,
  ChevronsUp,
  Download,
  PanelLeftOpen,
  Upload,
  RotateCcw,
  Loader2,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ProjectTabSideToolbar, {
  ProjectTabToolbarButton,
  ProjectTabToolbarField,
  ProjectTabToolbarSection,
  ProjectTabToolbarStatus,
} from "../../components/ProjectTabSideToolbar";
import {
  getEffectiveHazardOperationalContexts,
  getHazardOperationalContextLabel,
} from "../project-hazard-analysis/hazardOperationalContexts";
import {
  CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS,
} from "./codeArchitectureHazardTypes";
import { isCodeArchitectureHazardAnalysisStale } from "./codeArchitectureHazardUtils";
import { summarizeCodeArchitectureHazardEligibility } from "./codeArchitectureHazardEligibility";
import CodeArchitectureHazardSummaryTable from "./CodeArchitectureHazardSummaryTable";

function downloadSummaryCsv(summarySheet, repoName = "code_architecture") {
  if (!Array.isArray(summarySheet) || !Array.isArray(summarySheet[0]) || summarySheet.length < 2) return;
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = summarySheet.map((row) => row.map(escapeCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = String(repoName || "code_architecture").replace(/[^a-z0-9._-]+/gi, "_");
  anchor.href = url;
  anchor.download = `${safeName}_hazard_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function CodeArchitectureHazardPanel({
  cbaRows = [],
  latestRun,
  draftRun,
  diagram,
  splitView = false,
  onSplitViewChange,
  onImportSummary,
  method,
  onMethodChange,
  onRunAnalysis,
  onCancelAnalysis,
  isRunning = false,
  progress,
  operationalContexts = [],
  selectedOperationalContextId = "all",
  onSelectedOperationalContextChange,
  onManageOperationalContexts,
  toolbarCollapsed = false,
  onToolbarCollapsedChange,
  reviewItems = [],
  reviewByRow,
  reviewDrawerOptions,
  forceSummaryOpenKey,
  highlightedRowIndex,
  onOpenArchitectureTarget,
  onClearContents,
  onDeleteSummaryRow,
  onCollaboratorSelectionChange,
  reviewMode = false,
}) {
  const summarySheet = useMemo(() => fillNotApplicableHazardSummary(ensureHazardAnalysisRowIds(
    latestRun?.generatedSheets?.Summary || draftRun?.generatedSheets?.Summary || []
  )), [latestRun, draftRun]);
  const csvInputRef = useRef(null);
  const visibleSummaryRef = useRef(null);
  const [csvIssues, setCsvIssues] = useState([]);
  const [importing, setImporting] = useState(false);
  const handleVisibleSummary = useCallback((sheet) => {
    visibleSummaryRef.current = { sheet, source: summarySheet, context: selectedOperationalContextId };
  }, [summarySheet, selectedOperationalContextId]);
  const exportCsv = () => {
    const visible = visibleSummaryRef.current;
    const sheet = visible?.source === summarySheet && visible?.context === selectedOperationalContextId
      ? visible.sheet
      : [summarySheet[0], ...filterCodeArchitectureHazardRowsByContext(summarySheet[0],
        summarySheet.slice(1).map(row => ({ row })), selectedOperationalContextId).map(({ row }) => row)];
    downloadSummaryCsv(sheet, latestRun?.repoName || draftRun?.repoName);
  };
  const importCsv = async (file) => {
    if (!file || isRunning || importing || reviewMode) return;
    setImporting(true);
    try {
      const plan = planHazardAnalysisCsvImport(summarySheet, await file.text());
      if (plan.errors.length) { setCsvIssues(plan.errors); return; }
      if (!plan.changedRowCount) { window.alert('Every row already matches. Nothing was changed.'); return; }
      if (!window.confirm(describeHazardCsvPlan(plan))) return;
      await onImportSummary(applyHazardAnalysisCsvImport(summarySheet, plan.updates), latestRun);
      window.alert(`Imported updates to ${plan.changedRowCount} rows.${plan.conflicts.length ? ` ${plan.conflicts.length} classification/significance conflicts need review.` : ''}`);
    } catch (error) { setCsvIssues([error.message || 'Import could not be saved.']); }
    finally { setImporting(false); }
  };
  const hasSummary = Array.isArray(summarySheet) && summarySheet.length >= 2;
  const [showSummary, setShowSummary] = useState(hasSummary);
  const [allGroupsCollapsed, setAllGroupsCollapsed] = useState(false);
  const [collapseAllRequest, setCollapseAllRequest] = useState({ version: 0, collapsed: false });
  const effectiveContexts = useMemo(
    () => getEffectiveHazardOperationalContexts(operationalContexts),
    [operationalContexts],
  );
  const eligibilitySummary = useMemo(
    () => summarizeCodeArchitectureHazardEligibility(cbaRows),
    [cbaRows],
  );
  const isStale = useMemo(
    () => latestRun ? isCodeArchitectureHazardAnalysisStale({
      run: latestRun,
      cbaRows,
      operationalContexts,
      selectedOperationalContextId,
    }) : false,
    [latestRun, cbaRows, operationalContexts, selectedOperationalContextId]
  );
  const summaryCount = Math.max(0, (Array.isArray(summarySheet) ? summarySheet.length : 1) - 1);
  const statusMessage = latestRun
    ? isStale
      ? "Architecture changed since this run. Re-run before generating new remediation findings."
      : `Latest ${latestRun.hazardMethod || "hazard"} run has ${summaryCount} summary row${summaryCount === 1 ? "" : "s"}.`
    : "Run hazard analysis first for grounded remediation recommendations.";
  const statusTone = latestRun && !isStale ? "success" : "default";

  useEffect(() => {
    if (forceSummaryOpenKey) setShowSummary(true);
  }, [forceSummaryOpenKey]);

  useEffect(() => {
    if (hasSummary) setShowSummary(true);
    setAllGroupsCollapsed(false);
    setCollapseAllRequest((current) => ({ version: current.version + 1, collapsed: false }));
  }, [hasSummary, latestRun?.id]);

  const toggleAllGroups = () => {
    const collapsed = !allGroupsCollapsed;
    setAllGroupsCollapsed(collapsed);
    setCollapseAllRequest((current) => ({ version: current.version + 1, collapsed }));
  };
  const handleGroupStateChange = useCallback(({ allCollapsed }) => {
    setAllGroupsCollapsed(allCollapsed);
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
    <FunctionalDiagramWorkspace
      showControls={false}
      viewMode={splitView ? 'split' : 'table'}
      tableLabel="Code architecture hazard analysis table"
      onDiagramResize={() => window.dispatchEvent(new Event('resize'))}
      diagram={splitView ? diagram : null}
      table={(
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <HazardCsvIssuesModal issues={csvIssues} onClose={() => setCsvIssues([])} />
      <ProjectTabSideToolbar
        label="Code Architecture Hazard Analysis tools"
        collapsed={toolbarCollapsed}
        onCollapsedChange={onToolbarCollapsedChange}
        className="h-full rounded-none border-0 border-r border-slate-200"
      >
        <ProjectTabToolbarSection title="Analysis setup" collapsed={toolbarCollapsed}>
          {toolbarCollapsed && (
            <ProjectTabToolbarButton
              icon={<Settings size={17} />}
              label="Show analysis setup"
              collapsed
              onClick={() => onToolbarCollapsedChange?.(false)}
            />
          )}
          <ProjectTabToolbarField label="Method" collapsed={toolbarCollapsed}>
            <select
              value={method}
              onChange={(event) => onMethodChange?.(event.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700"
              disabled={isRunning || importing || reviewMode}
            >
              {CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </ProjectTabToolbarField>
          <ProjectTabToolbarField label="Operational context" collapsed={toolbarCollapsed}>
            <select
              value={selectedOperationalContextId}
              onChange={(event) => onSelectedOperationalContextChange?.(event.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
              disabled={isRunning || importing || reviewMode}
              title="Filter results and scope the next analysis run to an operational scenario and mode"
            >
              <option value="all">All contexts ({effectiveContexts.length})</option>
              {effectiveContexts.map((context) => (
                <option key={context.id} value={context.id}>{getHazardOperationalContextLabel(context)}</option>
              ))}
            </select>
          </ProjectTabToolbarField>
          <ProjectTabToolbarButton
            icon={<Settings size={16} />}
            label="Manage contexts"
            collapsed={toolbarCollapsed}
            onClick={onManageOperationalContexts}
            disabled={isRunning || importing || reviewMode}
          />
        </ProjectTabToolbarSection>

        <ProjectTabToolbarSection title="Actions" collapsed={toolbarCollapsed}>
          <ProjectTabToolbarStatus
            collapsed={toolbarCollapsed}
            tone={eligibilitySummary.needsReview > 0 ? "warning" : "success"}
            title={`${eligibilitySummary.include} included, ${eligibilitySummary.exclude} excluded, ${eligibilitySummary.needsReview} need review`}
          >
            {eligibilitySummary.include} included · {eligibilitySummary.exclude} excluded · {eligibilitySummary.needsReview} need review
            {eligibilitySummary.needsReview > 0 ? " (unresolved rows will not be analyzed)" : ""}
          </ProjectTabToolbarStatus>
          {!reviewMode && (
            <ProjectTabToolbarButton
              icon={isRunning ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
              label={isRunning ? "Running hazard analysis…" : (latestRun ? "Regenerate hazard analysis" : "Run hazard analysis")}
              collapsed={toolbarCollapsed}
              tone="primary"
              onClick={() => onRunAnalysis?.(method)}
              disabled={isRunning || importing || eligibilitySummary.include === 0}
            />
          )}
          {isRunning && !reviewMode && (
            <ProjectTabToolbarButton
              icon={<X size={17} />}
              label="Stop analysis"
              collapsed={toolbarCollapsed}
              tone="danger"
              onClick={onCancelAnalysis}
            />
          )}
          {isRunning && (
            <ProjectTabToolbarStatus
              collapsed={toolbarCollapsed}
              tone="info"
              icon={<Loader2 size={15} className="animate-spin" />}
              title={progress?.message || "Running code architecture hazard analysis…"}
            >
              {progress?.message || "Running code architecture hazard analysis…"}
            </ProjectTabToolbarStatus>
          )}
          {diagram && <ProjectTabToolbarButton
            icon={<PanelLeftOpen size={17} />}
            label={splitView ? "Table only" : "Split view"}
            collapsed={toolbarCollapsed}
            onClick={() => onSplitViewChange?.(!splitView)}
            title={splitView ? "Show only the hazard table" : "Show the code architecture diagram beside the hazard table"}
          />}
          <ProjectTabToolbarButton
            icon={<Download size={17} />}
            label="Export CSV"
            collapsed={toolbarCollapsed}
            tone="success"
            onClick={exportCsv}
            disabled={!hasSummary}
          />
          {!reviewMode && <>
            <ProjectTabToolbarButton
              icon={<Upload size={17} />} label="Import CSV…" collapsed={toolbarCollapsed}
              tone="success" onClick={() => csvInputRef.current?.click()}
              disabled={!hasSummary || isRunning || importing || !onImportSummary}
            />
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden"
              aria-label="Import code architecture hazard CSV"
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; importCsv(file); }} />
            {latestRun?.csvImportPreviousSummary && <ProjectTabToolbarButton
              icon={<RotateCcw size={17} />} label="Undo CSV import" collapsed={toolbarCollapsed}
              disabled={isRunning || importing}
              onClick={async () => {
                if (!window.confirm('Restore the hazard table from before the last CSV import?')) return;
                setImporting(true);
                try { await onImportSummary(latestRun.csvImportPreviousSummary, latestRun, true); }
                catch (error) { setCsvIssues([error.message]); }
                finally { setImporting(false); }
              }}
            />}
          </>}
          <ProjectTabToolbarButton
            icon={allGroupsCollapsed ? <ChevronsDown size={17} /> : <ChevronsUp size={17} />}
            label={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
            collapsed={toolbarCollapsed}
            onClick={toggleAllGroups}
            disabled={!hasSummary}
          />
          {latestRun && (
            <ProjectTabToolbarButton
              icon={showSummary ? <ChevronsUp size={17} /> : <ChevronsDown size={17} />}
              label={showSummary ? "Hide results" : "Show results"}
              collapsed={toolbarCollapsed}
              onClick={() => setShowSummary((value) => !value)}
            />
          )}
          {!reviewMode && (
            <ProjectTabToolbarButton
              icon={<Trash2 size={17} />}
              label="Clear analysis…"
              collapsed={toolbarCollapsed}
              tone="danger"
              onClick={onClearContents}
              disabled={isRunning || importing || !latestRun}
            />
          )}
          {!isRunning && (
            <ProjectTabToolbarStatus collapsed={toolbarCollapsed} tone={statusTone} title={statusMessage}>
              {statusMessage}
            </ProjectTabToolbarStatus>
          )}
        </ProjectTabToolbarSection>
      </ProjectTabSideToolbar>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {latestRun?.userPreprocessingConflicts?.length > 0 && <details className="m-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <summary>User preprocessing needs review ({latestRun.userPreprocessingConflicts.length})</summary>
          {latestRun.userPreprocessingConflicts.map((message, index) => <p key={index}>{message}</p>)}
        </details>}
        {operationalContexts.length === 0 && !reviewMode && (
          <button
            type="button"
            onClick={onManageOperationalContexts}
            className="m-3 mb-0 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100"
          >
            <span><strong>Generic operational context.</strong> Add scenarios and modes to generate context-specific hazards.</span>
            <span className="shrink-0 font-semibold text-amber-800">Add context</span>
          </button>
        )}
        {(isRunning || showSummary) ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
            {isRunning && (
              <div className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                {progress?.message || "Running code architecture hazard analysis..."}
              </div>
            )}
            {!latestRun && hasSummary && <div className="text-sm text-slate-600">Incomplete hazard analysis draft. Export these rows, complete them externally, then import the CSV results.</div>}
            {showSummary && (
              <CodeArchitectureHazardSummaryTable
                summarySheet={summarySheet}
                className="min-h-0 flex-1"
                reviewItems={reviewItems}
                reviewByRow={reviewByRow}
                reviewDrawerOptions={reviewDrawerOptions}
                showReview={Boolean(latestRun)}
                onVisibleSummaryChange={handleVisibleSummary}
                highlightedRowIndex={highlightedRowIndex}
                storageKey={`code-architecture-hazard-summary:${latestRun?.repoId || "repo"}:${latestRun?.id || "latest"}`}
                onOpenArchitectureTarget={onOpenArchitectureTarget}
                onDeleteRow={reviewMode || !latestRun ? undefined : onDeleteSummaryRow}
                onCollaboratorSelectionChange={onCollaboratorSelectionChange}
                selectedOperationalContextId={selectedOperationalContextId}
                collapseAllRequest={collapseAllRequest}
                onGroupStateChange={handleGroupStateChange}
                readOnly={reviewMode}
              />
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
            Run the code architecture hazard analysis to populate reviewable results.
          </div>
        )}
      </div>
    </div>
      )}
    />
    </div>
  );
}
