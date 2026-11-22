import RenameReportDialog from './RenameReportDialog';
import React, { useEffect, useRef, useState } from 'react';
import { GENERATED_REPORT_CHANGED, deleteGeneratedReport, listGeneratedReports, renameGeneratedReport,
  preserveLegacyGeneratedReport, readGeneratedReport } from '../features/project-hazard-analysis/generatedReportStorage';

export function useReportLibrary({ projectId, ready, legacyReport, legacyDiagramImage, onOpen, requestedId = '' }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const scope = useRef(projectId);
  scope.current = projectId;
  const openCallback = useRef(onOpen); openCallback.current = onOpen;
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const listener = (event) => { if (String(event.detail?.projectId) === String(projectId)) refresh(); };
    window.addEventListener(GENERATED_REPORT_CHANGED, listener);
    return () => window.removeEventListener(GENERATED_REPORT_CHANGED, listener);
  }, [projectId]);
  const legacyText = legacyReport?.report ?? legacyReport?.markdown ?? legacyReport?.text ?? legacyReport?.content ?? '';
  const selectedId = legacyReport?.libraryId;
  const selection = useRef(legacyReport); selection.current = legacyReport;
  const loaded = legacyReport?.libraryLoaded;
  useEffect(() => {
    let cancelled = false;
    setItems([]); setError('');
    if (!ready || projectId == null) { setBusy(false); return; }
    setBusy(true);
    (async () => {
      let migrationFailed = false;
      if (legacyText && (!selectedId || !loaded) && (legacyReport.projectId == null || String(legacyReport.projectId) === String(projectId))) {
        try { const migrated = await preserveLegacyGeneratedReport(projectId, !legacyReport.libraryId && legacyDiagramImage
          ? { ...legacyReport, functionalDiagramImage: legacyReport.functionalDiagramImage || legacyDiagramImage }
          : legacyReport);
          if (migrated?.deleted && !cancelled) openCallback.current(null);
        }
        catch {
          migrationFailed = true;
          if (!cancelled) setError('The current report could not be added to the library. Keep it open and export it before closing.');
        }
      }
      const rows = await listGeneratedReports(projectId);
      if (cancelled) return;
      setItems(rows);
      const target = requestedId ? rows.find((row) => row.id === requestedId) : rows.find((row) => row.id === selectedId) || rows[0];
      if (requestedId && !target) {
        setError('This saved report is no longer available.');
        return;
      }
      if (!migrationFailed && target && (!selectedId || !loaded || target.id !== selectedId)) {
        const report = await readGeneratedReport(projectId, target.id);
        if (!cancelled && report) openCallback.current(report);
      } else if (!target && selectedId && !cancelled) {
        openCallback.current(null);
      }
    })().catch(() => { if (!cancelled) setError('Saved reports could not be loaded. Keep any unsaved report open and retry.'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // Only the compact selection and legacy text drive migration, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ready, revision, selectedId, legacyText, loaded, legacyDiagramImage, requestedId]);

  const open = async (id) => {
    const requestedProject = projectId;
    try {
      const report = await readGeneratedReport(requestedProject, id);
      if (scope.current !== requestedProject) return;
      if (!report) throw new Error('Missing report');
      setError(''); openCallback.current(report);
    } catch { if (scope.current === requestedProject) setError('This saved report could not be opened. Retry loading the library.'); }
  };
  const rename = async (id, title) => {
    const requestedProject = projectId;
    try {
      const renamed = await renameGeneratedReport(requestedProject, id, title);
      if (!renamed) throw new Error('Missing report');
      if (scope.current !== requestedProject) return false;
      setError('');
      if (selection.current?.libraryId === id && selection.current.libraryLoaded) openCallback.current({ ...selection.current, title: renamed.title });
      refresh(); return true;
    } catch (error) {
      if (scope.current === requestedProject) setError('The report could not be renamed. Retry saving.');
      throw error;
    }
  };
  const remove = async (id) => {
    const requestedProject = projectId;
    try {
      await deleteGeneratedReport(requestedProject, id);
      if (scope.current !== requestedProject) return;
      if (selectedId === id) openCallback.current(null);
      refresh();
    } catch { if (scope.current === requestedProject) setError('The report could not be deleted. Please retry.'); }
  };
  return { items, busy, error, refresh, open, remove, rename, selectedId, projectId };
}

export default function ReportLibrary({ library, fitViewport = false, compact = false, selectedTitle }) {
  const [query, setQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  useEffect(() => { setRenameTarget(null); }, [library.projectId]);
  const matches = library.items.filter((item) => `${item.title} ${item.reportType}`.toLowerCase().includes(query.toLowerCase()));
  if (compact) {
    const selected = library.items.find(item => item.id === library.selectedId);
    const titleCounts = new Map();
    library.items.forEach(item => titleCounts.set(item.title, (titleCounts.get(item.title) || 0) + 1));
    const optionTitle = item => `${item.title}${titleCounts.get(item.title) > 1 ? ` — ${new Date(item.createdAt).toLocaleString()}` : ''}${item.status === 'draft' ? ' (Incomplete draft)' : ''}`;
    const selectedMissing = library.selectedId && !matches.some(item => item.id === library.selectedId);
    return <div className="report-library-compact" aria-label="Report selection">
      <label>Report
        <select aria-label="Saved report" value={library.selectedId || ''} onChange={event => { if (event.target.value) library.open(event.target.value); }} disabled={library.busy && !library.items.length}>
          {!library.selectedId && <option value="">{library.busy ? 'Loading reports…' : 'Choose a report'}</option>}
          {selectedMissing && <option value={library.selectedId}>{selected ? optionTitle(selected) : selectedTitle || 'Current report'}</option>}
          {matches.map(item => <option key={item.id} value={item.id}>{optionTitle(item)}</option>)}
        </select>
      </label>
      {library.items.length > 1 && <input type="search" aria-label="Search saved reports" placeholder="Search reports" value={query} onChange={event => setQuery(event.target.value)} />}
      {library.error && <p role="alert">{library.error}</p>}
    </div>;
  }
  return <section className="mb-4 shrink-0 rounded-xl border border-gray-200 bg-white p-3" aria-label="Saved reports">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold">Saved reports <span className="text-gray-500">({library.items.length})</span></h2>
      <input className="min-w-0 rounded border px-2 py-1 text-sm" aria-label="Search saved reports" placeholder="Search saved reports" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" className="text-sm text-blue-700" onClick={library.refresh} disabled={library.busy}>Refresh</button>
    </div>
    {library.error && <p role="alert" className="mt-2 text-sm text-red-700">{library.error}</p>}
    <div className="mt-2 max-h-44 overflow-y-auto" style={fitViewport ? { maxHeight: 'min(11rem, 8vh)' } : undefined}>
      {matches.map((item) => <div key={item.id} className="flex items-center gap-3 border-t py-2 text-sm">
        <button type="button" aria-pressed={library.selectedId === item.id} className="min-w-0 flex-1 truncate text-left text-blue-700" onClick={() => library.open(item.id)} title={item.title}>{item.title}</button>
        {item.status === 'draft' && <span className="text-amber-700">Incomplete draft</span>}
        <time className="shrink-0 text-xs text-gray-500" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
        <button type="button" className="text-xs text-gray-500" aria-label={`Rename ${item.title}`} onClick={() => setRenameTarget(item)}>Rename</button>
        <button type="button" className="text-xs text-gray-500" aria-label={`Delete ${item.title}`} onClick={() => { if (window.confirm(`Delete this saved report: ${item.title}?`)) library.remove(item.id); }}>Delete</button>
      </div>)}
      {!matches.length && <p className="py-2 text-xs text-gray-500">{library.busy ? 'Loading saved reports…' : 'Generated reports will be saved here.'}</p>}
    </div>
    {renameTarget && <RenameReportDialog report={renameTarget} onRename={library.rename} onClose={() => setRenameTarget(null)} />}
  </section>;
}
