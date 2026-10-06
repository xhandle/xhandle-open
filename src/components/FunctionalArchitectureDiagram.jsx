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
  { key: 'action', label: 'Interaction' }, { key: 'controlActionDetails', label: 'Interaction Details' },
  { key: 'to', label: 'Function (To)' }, { key: 'toDetails', label: 'Function (To) Details' },
];

export default forwardRef(function FunctionalArchitectureDiagram({ rows, storageKey, height, canvasToolsTarget,
  onOpenRow, onOpenCsu, reviewMode, ready, progress, error, onProcess, onCancel }, ref) {
  const modelRows = useMemo(() => buildFunctionalModelRows(rows), [rows]);
  const [selection, setSelection] = useState(null);
  const [table, setTable] = useState(false);
  const closeInspector = useCallback(() => setSelection(null), []);
  const inspect = useCallback(row => setSelection({ label: `${row.from} → ${row.action}`, rowIndices: row.functionalModel.sourceIndices }), []);
  const inspectTarget = useCallback(target => {
    const row = modelRows.find(row => row.traceId === target.traceId) || modelRows[Number(target.rowIndex)];
    if (row) inspect(row);
  }, [modelRows, inspect]);
  const functions = new Set(modelRows.flatMap(row => [row.fromNodeId, row.toNodeId]));
  const interactions = modelRows.filter(row => !row.functionalModel.internal);
  return <div className="relative flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
      {ready ? <>
        <span>{functions.size} functional responsibilities · {interactions.length} interactions · {rows.length} supporting source rows</span>
        <button className="text-blue-600" onClick={() => setTable(value => !value)}>{table ? 'Diagram' : 'Functional table'}</button>
        {onProcess && <button disabled={!!progress} onClick={onProcess}>Regenerate functional model</button>}
        <span className="text-xs text-slate-500">AI-derived · Review before hazard analysis</span>
      </> : <>
        <p>Process the detailed CSU results into functional responsibilities and meaningful interactions.</p>
        {onProcess && <button className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50" disabled={!!progress || !rows.length} onClick={onProcess}>Generate functional model</button>}
      </>}
      {progress && <><span role="status">{progress}</span><button onClick={onCancel}>Cancel</button></>}
      {error && <p role="alert" className="w-full text-red-700">{error}</p>}
    </div>
    {ready && (table ? <div className="relative min-h-0 overflow-auto">
      <div className="sticky right-0 top-0 flex justify-end bg-white p-2"><CopyTableButton label="Copy functional model" columns={[{ label: 'Interaction Type', getValue: functionalModelLabel }, ...columns, { label: 'Supporting Source Rows', getValue: row => row.functionalModel.sourceRowRefs.join(', ') }]} rows={modelRows} /></div>
      <table className="w-full text-left text-sm"><thead><tr><th>Type</th>{columns.map(column => <th key={column.key} className="p-3">{column.label}</th>)}<th>Evidence</th></tr></thead>
        <tbody>{modelRows.map(row => <tr key={row.traceId} className="border-t"><td className="p-3">{functionalModelLabel(row)}</td>{columns.map(column => <td key={column.key} className="p-3">{row[column.key]}</td>)}<td className="p-3"><button className="text-blue-600" onClick={() => inspect(row)}>{row.functionalModel.sourceIndices.length} source rows</button></td></tr>)}</tbody>
      </table>
    </div> : <LiteSummaryDiagramReactFlowGitHub
      key={`functional-v2:${storageKey}`}
      ref={ref}
      rows={modelRows}
      storageKey={`functional-v2:${storageKey}`}
      height={height}
      architectureMode
      architectureAbstraction="detailed"
      functionalPresentation
      cleanOnceKey={`initial-functional-${modelRows.map(row => row.traceId).join("|")}`}
      preserveLayoutOnMount
      allowLayoutChanges={!reviewMode}
      reviewMode
      canvasToolsTarget={canvasToolsTarget}
      onOpenFunctionalRow={inspectTarget}
    />)}
    {ready && !table && <button className="absolute bottom-3 left-3 z-10 rounded border bg-white px-3 py-2 text-sm" onClick={() => setSelection({ label: 'Functional model source coverage', rowIndices: rows.map((_, index) => index) })}>Inspect supporting calls</button>}
    {selection && <FunctionalRelationshipInspector key={selection.label} selection={selection} rows={rows} onClose={closeInspector} onOpenRow={onOpenRow} onOpenCsu={onOpenCsu} />}
  </div>;
});
