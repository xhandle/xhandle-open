import HazardRestorationNotice from './HazardRestorationNotice';
import TablePreparationProgress from '../code-architecture-assurance/TablePreparationProgress';
import HazardNarrativeReview from './HazardNarrativeReview';
import HazardRunRecoveryNotice from './HazardRunRecoveryNotice';
import { SHOW_TABLE_REVIEW_NOTICES } from "../../components/tablePresentation";
import { fillNotApplicableHazardSummary } from '../project-hazard-analysis/hazardNotApplicableCells';
import { buildFunctionalModelRows, functionalModelIsReady } from '../code-architecture-context/functionalModel';
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
import { effectiveCodeArchitectureHazardRows, isCodeArchitectureHazardAnalysisStale } from "./codeArchitectureHazardUtils";
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

export function PreparedCodeArchitectureHazardPanel({
  preparedView,
  tablePage,
  cbaRows = [],
  latestRun,
  restoration,
  draftRun,
  draftLoading=false, draftProgress=0, draftError=null, onRetryDraft,
  diagram,
  splitView = false,
  onSplitViewChange,
  onImportSummary,
  method,
  onMethodChange,
  onRunAnalysis,
  onRetrySave,
  onNarrativeReviewUpdate,
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
  onRowFocusResolved,
  onOpenArchitectureTarget,
  onClearContents,
  onDeleteSummaryRow,
  onCollaboratorSelectionChange,
  collaboratorSelection,
  importInputRef,
  reviewMode = false,
  organizationContext,
}) {
  const summarySheet = useMemo(() => preparedView?.summarySheet || fillNotApplicableHazardSummary(ensureHazardAnalysisRowIds(
    latestRun?.generatedSheets?.Summary || draftRun?.generatedSheets?.Summary || []
  )), [latestRun?.generatedSheets?.Summary, draftRun?.generatedSheets?.Summary, preparedView]);
  const unresolvedApplicabilityCount = useMemo(() => {
    const header = summarySheet[0] || [];
    const valueIndex = header.indexOf('Guide Phrase Applicable');
    const originIndex = header.indexOf('Guide Phrase Applicability Origin');
    return summarySheet.slice(1).filter(row => row[valueIndex] === 'Needs Review' && row[originIndex] === 'Automatic screening').length;
  }, [summarySheet]);
  const functionalTraceIds = useMemo(() => preparedView?.functionalTraceIds || (functionalModelIsReady(cbaRows)
    ? new Set(buildFunctionalModelRows(cbaRows).map(row => row.traceId)) : new Set()), [cbaRows, preparedView]);
  const csvInputRef = useRef(null);
  const visibleSummaryRef = useRef(null);
  const [csvIssues, setCsvIssues] = useState([]);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [importStatus, setImportStatus] = useState("");
  const handleVisibleSummary = useCallback((sheet) => {
    visibleSummaryRef.current = { sheet, source: summarySheet, context: selectedOperationalContextId };
  }, [summarySheet, selectedOperationalContextId]);
  const exportCsv = () => {
    if(tablePage){tablePage.exportCsv();return;}
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
    setPendingImport(null);
    setImportStatus('Reading and validating CSV…');
    try {
      const source = tablePage ? await tablePage.loadSummary() : summarySheet;
      const plan = planHazardAnalysisCsvImport(source, await file.text());
      if (plan.errors.length) {
        setCsvIssues(plan.errors);
        setImportStatus(`Import blocked: ${plan.errors[0]}`);
        return;
      }
      if (!plan.changedRowCount) {
        setImportStatus('Every row already matches. Nothing was changed.');
        return;
      }
      setPendingImport({plan, source, view:summarySheet, run: latestRun});
      setImportStatus('CSV validated. Review the changes below and apply the import.');
    } catch (error) { setImportStatus(`Import failed: ${error.message || 'The file could not be read.'}`); }
    finally { setImporting(false); }
  };
  const applyPendingImport = async () => {
    if (!pendingImport || importing || isRunning || reviewMode) return;
    if (pendingImport.view !== summarySheet || pendingImport.run !== latestRun) {
      setPendingImport(null);
      setImportStatus('The analysis changed. Select the CSV again to review it against the current table.');
      return;
    }
    setImporting(true);
    setImportStatus('Saving CSV updates…');
    try {
      const {plan, source, run} = pendingImport;
      await onImportSummary(applyHazardAnalysisCsvImport(source, plan.updates), run);
      setPendingImport(null);
      setImportStatus(`Imported updates to ${plan.changedRowCount} rows.${plan.conflicts.length ? ` ${plan.conflicts.length} classification/significance conflicts need review.` : ''}`);
    } catch (error) { setImportStatus(`Import failed: ${error.message || 'Updates could not be saved.'}`); }
    finally { setImporting(false); }
  };
  const hasSummary = tablePage ? tablePage.unfilteredTotal > 0 : Array.isArray(summarySheet) && summarySheet.length >= 2;
  const [showSummary, setShowSummary] = useState(hasSummary);
  const [allGroupsCollapsed, setAllGroupsCollapsed] = useState(false);
  const [collapseAllRequest, setCollapseAllRequest] = useState({ version: 0, collapsed: false });
  const effectiveContexts = useMemo(
    () => getEffectiveHazardOperationalContexts(operationalContexts),
    [operationalContexts],
  );
  const eligibilitySummary = useMemo(
    () => preparedView?.eligibilitySummary || summarizeCodeArchitectureHazardEligibility(effectiveCodeArchitectureHazardRows(cbaRows)),
    [cbaRows, preparedView],
  );
  const isStale = useMemo(
    () => typeof preparedView?.isStale === "boolean" ? preparedView.isStale : latestRun ? isCodeArchitectureHazardAnalysisStale({
      run: latestRun,
      organizationContext,
      cbaRows,
      operationalContexts,
      selectedOperationalContextId,
    }) : false,
    [latestRun, cbaRows, operationalContexts, selectedOperationalContextId, organizationContext, preparedView]
  );
  const summaryCount = tablePage?.unfilteredTotal ?? Math.max(0, (Array.isArray(summarySheet) ? summarySheet.length : 1) - 1);
  const statusMessage = isStale ? "Architecture, operational context or organization guidance changed since this run. Re-run before generating new remediation findings." : tablePage ? `${summaryCount} saved rows. Scroll to explore the complete table.` : latestRun?.runState === 'incomplete' ? 'Incomplete analysis; validated rows are available for inspection. Continue to finish.' : latestRun
    ? isStale
      ? "Architecture, operational context or organization guidance changed since this run. Re-run before generating new remediation findings."
      : `Latest ${latestRun.hazardMethod || "hazard"} run has ${summaryCount} summary row${summaryCount === 1 ? "" : "s"}.`
    : "Run hazard analysis first for grounded remediation recommendations.";
  const statusTone = latestRun && latestRun.runState !== 'incomplete' && !isStale ? "success" : "default";

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

  const restorationNotice = <HazardRestorationNotice restoration={restoration} latestRun={latestRun} isRunning={isRunning} showLoading={!latestRun} />;
  const upgradingSavedResults = !isRunning && restoration?.status === 'upgrading';
  const showDraftPreparation = draftLoading && !isRunning && !upgradingSavedResults;
  // Do not present a draft or generation controls as an absent saved analysis
  // until the authoritative read has completed successfully.
  if (!latestRun && !isRunning && restoration && ['loading', 'failed', 'upgrade-required', 'upgrading'].includes(restoration.status)) {
    return <div className="flex h-full min-h-0 flex-col">{restorationNotice}</div>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="border-b bg-slate-50 px-3 py-2 text-sm">
      {(preparedView?.functionalReady ?? functionalModelIsReady(cbaRows))
        ? 'New hazard analyses use the processed Functional model. Existing runs retain their original inputs.'
        : 'No current Functional model. Generate it in Architecture Diagram → Functional to analyze responsibilities instead of detailed calls.'}
    </div>
    {restorationNotice}
    {importStatus && <div role="status" className="shrink-0 border border-slate-200 bg-slate-50 p-3 text-sm">{importStatus}</div>}
    {pendingImport && <div className="shrink-0 border border-blue-200 bg-blue-50 p-3 text-sm">
      <p className="whitespace-pre-line">{describeHazardCsvPlan(pendingImport.plan)}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="rounded bg-blue-600 px-3 py-2 text-white" disabled={importing || isRunning || reviewMode} onClick={applyPendingImport}>Apply CSV import</button>
        <button type="button" className="rounded border px-3 py-2" disabled={importing} onClick={() => {setPendingImport(null); setImportStatus('CSV import canceled. No changes were saved.');}}>Cancel import</button>
      </div>
    </div>}
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
              icon={<Sparkles size={17} />}
              label={latestRun ? "Continue hazard analysis" : "Run hazard analysis"}
              collapsed={toolbarCollapsed}
              tone="primary"
              onClick={() => onRunAnalysis?.(method)}
              disabled={isRunning || importing || eligibilitySummary.include === 0}
            />
          )}
          {latestRun && !isRunning && !reviewMode && (
            <ProjectTabToolbarButton icon={<Sparkles size={17} />} label="Regenerate hazard analysis"
              collapsed={toolbarCollapsed} onClick={() => onRunAnalysis?.(method, {regenerate: true})}
              disabled={importing || eligibilitySummary.include === 0} />
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
            <input ref={element => { csvInputRef.current = element; if (importInputRef) importInputRef.current = element; }} type="file" accept=".csv,text/csv" className="hidden"
              disabled={!hasSummary || isRunning || importing || !onImportSummary}
              aria-label="Import code architecture hazard CSV"
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; importCsv(file); }} />
            {(latestRun?.csvImportPreviousSummary || tablePage?.hasCsvUndo) && <ProjectTabToolbarButton
              icon={<RotateCcw size={17} />} label="Undo CSV import" collapsed={toolbarCollapsed}
              disabled={isRunning || importing}
              onClick={async () => {
                if (!window.confirm('Restore the hazard table from before the last CSV import?')) return;
                setImporting(true);
                try { await onImportSummary(tablePage ? await tablePage.loadUndo() : latestRun.csvImportPreviousSummary, latestRun, true); }
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
        {tablePage?.controls}
        {!tablePage?.partial && <HazardNarrativeReview key={latestRun?.id} run={latestRun} onUpdate={onNarrativeReviewUpdate} disabled={isRunning} />}
        {showDraftPreparation && <TablePreparationProgress label="Preparing hazard analysis" progress={draftProgress} />}
        {draftError && <div role="alert" className="p-3">Unable to prepare hazard table: {draftError} <button onClick={onRetryDraft}>Retry preparation</button></div>}
        <HazardRunRecoveryNotice run={latestRun} onExport={tablePage ? tablePage.exportCsv : downloadSummaryCsv} onRetrySave={onRetrySave} isRunning={isRunning} />
        {!isRunning && progress?.error && !latestRun?.pendingAttempt && latestRun?.runState !== 'incomplete' && <div role="alert" className="m-3 text-red-700">{progress.message}</div>}
        {SHOW_TABLE_REVIEW_NOTICES && latestRun?.userPreprocessingConflicts?.length > 0 && <details className="m-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
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
            {isRunning && <TablePreparationProgress label={progress?.message || "Running code architecture hazard analysis"} />}
            {SHOW_TABLE_REVIEW_NOTICES && unresolvedApplicabilityCount > 0 && (
              <div role="status" className="text-sm text-amber-800">
                {unresolvedApplicabilityCount} guide-phrase decisions need review. Hazard generation was deferred for these rows; applicable rows were analyzed.
              </div>
            )}
            {!latestRun && hasSummary && <div className="text-sm text-slate-600">Incomplete hazard analysis draft. Export these rows, complete them externally, then import the CSV results.</div>}
            {showSummary && (
              <CodeArchitectureHazardSummaryTable
                suppressLoadingIndicator={showDraftPreparation || upgradingSavedResults || isRunning}
                summarySheet={summarySheet}
                remotePage={tablePage}
                hazardMethod={latestRun?.hazardMethod || method}
                className="min-h-0 flex-1"
                reviewItems={reviewItems}
                reviewByRow={reviewByRow}
                reviewDrawerOptions={reviewDrawerOptions}
                showReview={Boolean(latestRun)}
                onVisibleSummaryChange={handleVisibleSummary}
                highlightedRowIndex={highlightedRowIndex}
                focusRequestKey={forceSummaryOpenKey}
                onRowFocusResolved={onRowFocusResolved}
                onSelectedOperationalContextChange={onSelectedOperationalContextChange}
                storageKey={`code-architecture-hazard-summary:${latestRun?.repoId || "repo"}:${latestRun?.id || "latest"}`}
                onOpenArchitectureTarget={onOpenArchitectureTarget}
                functionalTraceIds={functionalTraceIds}
                onDeleteRow={reviewMode || !latestRun ? undefined : onDeleteSummaryRow}
                onCollaboratorSelectionChange={onCollaboratorSelectionChange}
                collaboratorSelection={collaboratorSelection}
                selectedOperationalContextId={selectedOperationalContextId}
                collapseAllRequest={collapseAllRequest}
                onGroupStateChange={handleGroupStateChange}
                readOnly={reviewMode}
              />
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
            {eligibilitySummary.include === 0
              ? `No eligible interfaces are available: ${eligibilitySummary.exclude} excluded and ${eligibilitySummary.needsReview} need review. Open Architecture Diagram → Table to review Hazard Analysis Eligibility and its rationale, or generate the Functional model. Adding a scenario does not change eligibility.`
              : 'Run the code architecture hazard analysis to populate reviewable results.'}
          </div>
        )}
      </div>
    </div>
      )}
    />
    </div>
  );
}

export { default } from './SavedHazardPanelLoader';
