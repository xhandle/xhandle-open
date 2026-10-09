import { functionalHierarchyIsReady } from '../features/code-architecture-context/functionalHierarchy';
import { ArchitectureWorkspace, ArchitectureDivider, ArchitectureTablePane, useArchitectureColumnWidths, useLatestCallback, diagramFocusView, architectureHeaderClass, architectureCellClass, architectureLinkClass } from './ArchitectureWorkspace';
import { createTableCellSelection, isSelectedTableCell, isSelectedTableRow } from '../features/collaborator-selection/activeSelectionContext';
import { FilterableHeaderCell, useColumnFilters } from './FilterableTableHeader';
import { resolveArchitectureTarget, retryDiagramFocus } from './codeArchitectureNavigation';
import VirtualTableBody from './VirtualTableBody';
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LiteSummaryDiagramReactFlowGitHub from './LiteSummaryDiagramReactFlowGitHub';
import CopyTableButton from './CopyTableButton';
import { buildFunctionalModelRows, functionalModelLabel } from '../features/code-architecture-context/functionalModel';

export function FunctionalRelationshipInspector({ selection, rows, onClose, onOpenRow, onOpenCsu }) {
  const [page, setPage] = useState(0);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const focusable = [...(dialog?.querySelectorAll('button:not(:disabled), summary') || [])];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); previous?.focus?.(); };
  }, [onClose]);
  const indices = selection.rowIndices || [];
  return <div role="dialog" aria-modal="true" aria-label="Functional relationships" className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
    <div className="max-h-full w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
      <div className="flex justify-between gap-4"><h3 className="font-semibold">{selection.label || 'Functional connection'}</h3><button ref={closeRef} onClick={onClose}>Close</button></div>
      <p className="my-2 text-sm text-slate-600">{indices.length} original relationships. Grouped operations retain their source evidence; unresolved calls do not establish runtime targets.</p>
      {indices.slice(page * 30, (page + 1) * 30).map(index => {
        const row = rows[index];
        if (!row) return null;
        return <div key={index} className="border-t py-3 text-sm">
          <div>{row.fromFunction || row.from} → {row.controlAction || row.action} → {row.toFunction || row.to}</div>
          <div className="my-1 text-xs text-slate-500">{row.fromFile} · Row {row.rowRef || index + 1}</div>
          {row.functionalAbstraction && <p className="my-2 text-slate-600">Assessment: {row.functionalAbstraction.significance} — {row.functionalAbstraction.rationale}</p>}
          <details><summary>Details</summary><p className="whitespace-pre-wrap">{row.controlDetails || row.controlActionDetails || row.fromDetails}</p></details>
          <div className="mt-2 flex gap-4">
            {onOpenRow && <button className="text-blue-600" onClick={() => onOpenRow(row, index)}>Open in table</button>}
            {onOpenCsu && <button className="text-blue-600" onClick={() => onOpenCsu(row, index)}>Show in CSU</button>}
          </div>
        </div>;
      })}
      {indices.length > 30 && <div className="mt-3 flex items-center justify-between"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(indices.length / 30)}</span><button disabled={(page + 1) * 30 >= indices.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    </div>
  </div>;
}

const columns = [
  { key: 'from', label: 'Function (From)' }, { key: 'fromDetails', label: 'Function (From) Details' },
  { key: 'action', label: 'Control Action' }, { key: 'controlActionDetails', label: 'Control Action Details' },
  { key: 'to', label: 'Function (To)' }, { key: 'toDetails', label: 'Function (To) Details' },
];
const hierarchyColumns = ['from', 'to'].flatMap(side => ['subsystem', 'csci', 'csc'].map(level => ({
  key: `${side}-${level}`, label: `${level === 'subsystem' ? 'Subsystem' : level.toUpperCase()} (${side === 'from' ? 'From' : 'To'})`,
  getValue: row => row[`${side}Architecture`]?.[level] || '',
})));
const exportColumns = [
  { label: 'Interaction ID', key: 'traceId' }, { label: 'Function (From) ID', key: 'fromNodeId' }, { label: 'Function (To) ID', key: 'toNodeId' },
  { label: 'Hazard Analysis Eligibility', key: 'hazardAnalysisEligibility' }, { label: 'Eligibility Source', key: 'hazardAnalysisEligibilitySource' }, { label: 'Eligibility Rationale', key: 'hazardAnalysisEligibilityRationale' },
  { label: 'Interaction Type', getValue: functionalModelLabel }, ...columns, ...hierarchyColumns,
  { label: 'Supporting Source Rows', getValue: row => row.functionalModel.sourceRowRefs.join(', ') },
  { label: 'Supporting Source Trace IDs', getValue: row => row.functionalModel.sourceTraceIds.join(', ') },
];

export function functionalTableCsv(rows) {
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [exportColumns.map(column => column.label), ...rows.map(row => exportColumns.map(column =>
    column.getValue ? column.getValue(row) : row[column.key]))]
    .map(cells => cells.map(escape).join(',')).join('\r\n');
}

const FunctionalCanvas = React.memo(LiteSummaryDiagramReactFlowGitHub);

export default forwardRef(function FunctionalArchitectureDiagram({ rows, storageKey, repoName, height, abstractionHeader, splitPercent: controlledPercent, onSplitPercentChange, projectId, collaboratorSelection, onCollaboratorSelectionChange,
  onOpenRow, onOpenCsu, reviewMode, ready, progress, error, onProcess, onCancel, viewMode, onViewModeChange, onExportCsvChange, focusTarget, onFocusTargetHandled }, ref) {
  const modelRows = useMemo(() => buildFunctionalModelRows(rows), [rows]);
  const hierarchyReady = useMemo(() => functionalHierarchyIsReady(rows), [rows]);
  const diagramRef = useRef(null);
  const workspaceRef = useRef(null);
  const [localPercent, setLocalPercent] = useState(50);
  const splitPercent = controlledPercent ?? localPercent;
  const setSplitPercent = onSplitPercentChange || setLocalPercent;
  const [canvasToolsTarget, setCanvasToolsTarget] = useState(null);
  const [queuedFocus, setQueuedFocus] = useState(null);
  const [navigationNotice, setNavigationNotice] = useState('');
  const [highlightedRow, setHighlightedRow] = useState(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const tableColumns = useMemo(() => [
    { key: 'type', label: 'Type', getValue: functionalModelLabel },
    ...columns,
    { key: 'evidence', label: 'Evidence', getValue: row => `${row.functionalModel.sourceIndices.length} source rows` },
    ...hierarchyColumns,
  ].map(column => ({ ...column, id: column.key,
    defaultWidth: column.key.includes('Details') ? (column.key === 'controlActionDetails' ? 440 : 420) : column.key === 'action' ? 240 : 220,
    minWidth: column.key.includes('Details') ? 240 : column.key === 'action' ? 160 : 150,
  })), []);
  const getCell = useCallback((row, index) => {
    const column = tableColumns[index];
    return column.getValue ? column.getValue(row) : row[column.key];
  }, [tableColumns]);
  const filters = useColumnFilters(modelRows, getCell);
  const visibleRows = filters.filteredRows;
  const attachDiagram = useCallback(value => {
    diagramRef.current = value;
    if (typeof ref === 'function') ref(value); else if (ref) ref.current = value;
  }, [ref]);
  useEffect(() => { setQueuedFocus(null); setHighlightedRow(null); setNavigationNotice(''); }, [storageKey, modelRows]);
  const virtualKey = useCallback(row => row.traceId, []);
  const searchText = useCallback(row => tableColumns.map(column => column.getValue ? column.getValue(row) : row[column.key] || '').join(' · '), [tableColumns]);
  const [selection, setSelection] = useState(null);
  const [internalView, setInternalView] = useState('architecture');
  const view = viewMode || internalView;
  const setView = useCallback(value => { setInternalView(value); onViewModeChange?.(value); }, [onViewModeChange]);
  const [columnWidths, resizeColumn] = useArchitectureColumnWidths(tableColumns, `functional-table-widths-v1:${storageKey}`, `${storageKey}:${view}`, !reviewMode);
  const openDiagram = (row, mode) => {
    const target = resolveArchitectureTarget({ traceId: row.traceId, mode: mode === 'action' ? 'edge' : mode, type: mode === 'action' ? 'edge' : 'node' }, modelRows);
    if (!target) { setNavigationNotice('The linked item is no longer available.'); return; }
    setNavigationNotice(''); setHighlightedRow(row.traceId);
    setQueuedFocus(target); setView(diagramFocusView(view));
  };
  const focusHandledRef = useRef(onFocusTargetHandled);
  focusHandledRef.current = onFocusTargetHandled;
  useEffect(() => {
    if (!focusTarget || !ready) return;
    const target = resolveArchitectureTarget(focusTarget, modelRows);
    if (!target) return;
    setNavigationNotice('');
    setQueuedFocus({ ...target, externalRequest: focusTarget });
    setView(diagramFocusView(view));
  }, [focusTarget, modelRows, ready, setView, view]);
  useEffect(() => {
    if (!queuedFocus || view === 'table') return;
    return retryDiagramFocus(() => diagramRef.current, queuedFocus, () => {
      setQueuedFocus(null);
      if (queuedFocus.externalRequest) focusHandledRef.current?.(queuedFocus.externalRequest);
    });
  }, [queuedFocus, view, storageKey, modelRows]);
  useEffect(() => { if (view === 'table') setQueuedFocus(null); }, [view]);
  const closeInspector = useCallback(() => setSelection(null), []);
  const inspect = useCallback(row => setSelection({ label: `${row.from} → ${row.action}`, rowIndices: row.functionalModel.sourceIndices }), []);
  const rowById = useMemo(() => new Map(modelRows.map((row, index) => [row.traceId, { row, index }])), [modelRows]);
  const inspectTarget = useLatestCallback(target => {
    const row = target.traceId ? rowById.get(target.traceId)?.row : modelRows[target.rowIndex];
    if (!row) { setNavigationNotice('The linked row is no longer available.'); return; }
    if (!visibleRows.some(item => item.traceId === row.traceId)) filters.clearAllFilters();
    setHighlightedRow(row.traceId); setRevealRequest(value => value + 1);
    setView(view === 'split' ? 'split' : 'table');
  });
  const hierarchyRevision = useMemo(() => {
    let hash = 2166136261;
    for (const row of modelRows) for (const char of JSON.stringify([row.fromArchitecture, row.toArchitecture])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }, [modelRows]);
  const layoutKey = useMemo(() => `initial-functional-${hierarchyRevision}-${modelRows.map(row => row.traceId).join('|')}`, [modelRows, hierarchyRevision]);
  const selectCell = (row, columnIndex) => {
    if (reviewMode) return;
    const selection = createTableCellSelection({ tableId: 'code-architecture-functional-model', tableLabel: 'Functional model', projectId,
      rowId: row.traceId, rowIndex: rowById.get(row.traceId)?.index,
      headers: [...tableColumns.map(column => column.label), 'Supporting Source Rows', 'Supporting Source Trace IDs'],
      row: [...tableColumns.map((_, index) => getCell(row, index)), row.functionalModel.sourceRowRefs.join(', '), row.functionalModel.sourceTraceIds.join(', ')], columnIndex });
    onCollaboratorSelectionChange?.(selection);
  };
  const exportCsv = useCallback(() => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', functionalTableCsv(visibleRows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    const name = String(repoName || 'code-architecture').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'code-architecture';
    link.href = url;
    link.download = `${name}-functional-view-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Allow Safari to start the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [visibleRows, repoName]);
  useEffect(() => {
    onExportCsvChange?.(ready ? exportCsv : null);
    return () => onExportCsvChange?.(null);
  }, [ready, view, exportCsv, onExportCsvChange]);
  return <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
    {!ready && <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
      <p>Process the detailed CSU results into functional responsibilities and meaningful interactions.</p>
      {onProcess && <button className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50" disabled={!!progress || !rows.length} onClick={onProcess}>Generate functional model</button>}
      {progress && <><span role="status">{progress}</span><button onClick={onCancel}>Cancel</button></>}
      {error && <p role="alert" className="w-full text-red-700">{error}</p>}
    </div>}
    {ready && !hierarchyReady && onProcess && <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
      <button className="rounded border px-3 py-1 text-blue-600" disabled={!!progress} onClick={onProcess}>Update CSCI/CSC hierarchy</button>
      {progress && <><span role="status">{progress}</span><button onClick={onCancel}>Cancel</button></>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>}
    {!ready && abstractionHeader}
    {ready && <ArchitectureWorkspace ref={workspaceRef} view={view}>
    {view !== 'table' && <section aria-label="Functional model diagram" className="relative flex min-h-0 min-w-0 flex-col" style={{ flexBasis: view === 'split' ? `${splitPercent}%` : '100%' }}>{abstractionHeader}<div className="flex min-h-0 flex-1">
      {!reviewMode && <aside aria-label="Code architecture tools sidebar" className="shrink-0 min-h-0 border-r bg-white"><div ref={setCanvasToolsTarget} className="h-full" /></aside>}
      <div className="relative min-h-0 min-w-0 flex-1 p-3"><FunctionalCanvas
      key={`functional-v4:${storageKey}:${hierarchyRevision}`}
      ref={attachDiagram}
      rows={modelRows}
      storageKey={`functional-v4:${storageKey}:${hierarchyRevision}`}
      height={height}
      architectureMode
      architectureAbstraction="detailed"
      functionalPresentation
      cleanOnceKey={layoutKey}
      preserveLayoutOnMount
      allowLayoutChanges={!reviewMode}
      reviewMode
      canvasToolsTarget={canvasToolsTarget}
      onOpenFunctionalRow={inspectTarget}
    /></div></div></section>}
    <ArchitectureDivider view={view} scope={storageKey} workspaceRef={workspaceRef} percent={splitPercent} onChange={setSplitPercent} onFit={() => diagramRef.current?.fitViewToDiagram?.()} />
    {view !== 'architecture' && <ArchitectureTablePane label="Functional model table" basis={view === 'split' ? `${100 - splitPercent}%` : '100%'} toolbar={<>
        <span role="status" className="mr-auto text-sm text-slate-600">{visibleRows.length} of {modelRows.length} rows match filters</span>
        {navigationNotice && <span role="status">{navigationNotice}</span>}
        <button className="text-sm text-blue-600" onClick={filters.clearAllFilters}>Clear filters</button>
        <CopyTableButton label="Copy functional model" columns={exportColumns} rows={visibleRows} />
      </>}>
      <table className="table-fixed text-left" style={{ minWidth: tableColumns.reduce((sum, column) => sum + columnWidths[column.id], 0) }}>
        <colgroup>{tableColumns.map((column, index) => <col key={column.key} style={{ width: columnWidths[column.id] }} />)}</colgroup>
        <thead><tr>{tableColumns.map((column, index) => <FilterableHeaderCell key={column.key} label={column.label} index={index} className={architectureHeaderClass} style={{ width: columnWidths[column.id] }} filterState={filters} onResizeStart={resizeColumn} />)}</tr></thead>
        <VirtualTableBody items={visibleRows} getKey={virtualKey} columns={tableColumns.length} searchText={searchText} label="Functional model" revealKey={highlightedRow} requestKey={revealRequest}>{(row, index) => <tr key={row.traceId} aria-selected={isSelectedTableRow(collaboratorSelection, 'code-architecture-functional-model', row.traceId)} className={`cursor-pointer ${isSelectedTableRow(collaboratorSelection, 'code-architecture-functional-model', row.traceId) ? 'bg-indigo-50 ring-2 ring-indigo-400 ring-inset' : highlightedRow === row.traceId ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : index % 2 ? 'bg-slate-50/60 hover:bg-slate-100' : 'bg-white hover:bg-slate-50'}`}>
          {tableColumns.map((column, columnIndex) => <td key={column.key} onClick={() => selectCell(row, columnIndex)} className={`${architectureCellClass} whitespace-pre-wrap break-words ${isSelectedTableCell(collaboratorSelection, 'code-architecture-functional-model', row.traceId, columnIndex) ? 'bg-indigo-100 ring-2 ring-indigo-500 ring-inset' : ''}`}>
            {column.key === 'evidence' ? <button className="text-blue-600" onClick={() => inspect(row)}>{getCell(row, columnIndex)}</button> : <div className="flex items-start gap-1"><span className="min-w-0 flex-1">{getCell(row, columnIndex)}</span>{['from', 'action', 'to'].includes(column.key) && !(row.functionalModel.internal && column.key !== 'from') && <button className={architectureLinkClass} aria-label={`Show ${column.label} in diagram: ${row[column.key]}`} title="Show in diagram" onClick={event => { event.stopPropagation(); openDiagram(row, column.key); }}>↗</button>}</div>}
          </td>)}
        </tr>}</VirtualTableBody>
      </table>
      {!visibleRows.length && <p className="p-4 text-slate-500">No rows match the selected filters.</p>}
    </ArchitectureTablePane>}

    </ArchitectureWorkspace>}

    {selection && <FunctionalRelationshipInspector key={selection.label} selection={selection} rows={rows} onClose={closeInspector} onOpenRow={onOpenRow} onOpenCsu={onOpenCsu} />}
  </div>;
});
