import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HAZARD_TRACKING_DERIVED_COLUMNS, HAZARD_TRACKING_TABLE_COLUMNS, projectHazardTrackingFields } from './hazardTrackingFields';
import { consolidateHazardRows, hazardGroupValues } from './consolidateHazardRows';
import { outsideSafetyScope } from './actionableHazardFamilies';
import { columnWidth, filterHazardGroups, hazardColumnOptions } from './hazardTableControls';
import HazardColumnFilter from './HazardColumnFilter';

const PAGE_SIZE = 100;
function CellText({ column, value }) {
  return column === 'Actionable Safety Issue Title' ? <strong className="font-semibold">{value || '—'}</strong> : value || '—';
}
function AssessmentRow({ row, group, selectedId, selectedIds, onSelect, onEdit, disabled, detail = false }) {
  const attributes = projectHazardTrackingFields(row.attributes);
  const selected = selectedId === row.id || !!selectedIds?.has(row.id);
  return <tr data-artifact-object-id={row.id} tabIndex={0} aria-selected={selected} className={`border-b align-top ${selected ? 'bg-blue-50' : detail ? 'bg-gray-50' : 'hover:bg-gray-50'}`} onClick={event => onSelect(row.id, event)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(row.id, event); } }}>
    {HAZARD_TRACKING_TABLE_COLUMNS.map(column => <td key={column} data-object-field={HAZARD_TRACKING_DERIVED_COLUMNS.includes(column) ? undefined : column} className="max-w-md whitespace-pre-wrap break-words px-3 py-2" onDoubleClick={event => { event.stopPropagation(); if (!disabled && !HAZARD_TRACKING_DERIVED_COLUMNS.includes(column)) onEdit(row, column); }}><CellText column={column} value={HAZARD_TRACKING_DERIVED_COLUMNS.includes(column) ? hazardGroupValues(group, column)[0] : attributes[column]} /></td>)}
  </tr>;
}
function HazardGroup({ group, ...props }) {
  const selectedIndex = group.rows.findIndex(row => row.id === props.selectedId);
  const [expanded, setExpanded] = useState(selectedIndex >= 0);
  const [page, setPage] = useState(() => Math.floor(Math.max(0, selectedIndex) / PAGE_SIZE) + 1);
  useEffect(() => { if (selectedIndex >= 0) { setExpanded(true); setPage(Math.floor(selectedIndex / PAGE_SIZE) + 1); } }, [selectedIndex, props.selectedId]);
  if (group.rows.length === 1 && !group.summary) return <AssessmentRow row={group.rows[0]} group={group} {...props} />;
  const totalPages = Math.ceil(group.rows.length / PAGE_SIZE), current = Math.min(page, totalPages), start = (current - 1) * PAGE_SIZE;
  const label = group.summary || group.values?.Hazard[0] || group.attributes.Hazard || 'Hazard';
  return <>
    <tr className="border-b bg-white align-top" data-hazard-group={group.id}>
      {HAZARD_TRACKING_TABLE_COLUMNS.map(column => <td key={column} className="max-w-md whitespace-pre-wrap break-words px-3 py-2" onDoubleClick={() => setExpanded(true)}>
        {column === 'Hazard' && <button type="button" className="mb-2 block text-left font-medium text-indigo-700" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label} (${group.rows.length} assessments)`} onClick={() => setExpanded(value => !value)}>{expanded ? '▾' : '▸'} {group.rows.length} assessments</button>}
        {hazardGroupValues(group, column).slice(0, 3).map((value, index) => <p key={index} className={index ? 'mt-2' : ''}><CellText column={column} value={value} /></p>)}
        {hazardGroupValues(group, column).length > 3 && <button type="button" className="mt-2 text-indigo-700" onClick={() => setExpanded(true)}>{hazardGroupValues(group, column).length - 3} more {hazardGroupValues(group, column).length === 4 ? 'value' : 'values'} — expand assessments</button>}
      </td>)}
    </tr>
    {expanded && <>
      <tr className="bg-indigo-50"><td colSpan={HAZARD_TRACKING_TABLE_COLUMNS.length} className="px-3 py-2"><div className="flex flex-wrap items-center gap-3"><span>Original assessments {start + 1}–{Math.min(start + PAGE_SIZE, group.rows.length)} of {group.rows.length}. Double-click a cell to edit that assessment.</span><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous assessments</button><span>Page {current} of {totalPages}</span><button type="button" disabled={current === totalPages} onClick={() => setPage(current + 1)}>Next assessments</button></div></td></tr>
      {group.rows.slice(start, start + PAGE_SIZE).map(row => <AssessmentRow key={row.id} row={row} group={group} detail {...props} />)}
    </>}
  </>;
}
export default function HazardTrackingTable({ rows, selectedId, selectedIds, onSelect, onEdit, disabled, artifactId = 'default' }) {
  const [other, setOther] = useState(false);
  const excluded = useMemo(() => rows.filter(row => !row.deleted && outsideSafetyScope(row)), [rows]);
  const allGroups = useMemo(() => other ? consolidateHazardRows(excluded, { includeExcluded: true }).map(group => ({ ...group, recordId: '—', issueTitle: '—', issueBody: '—', issueDescription: '—' })) : consolidateHazardRows(rows), [rows, excluded, other]);
  const [filters, setFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const closeFilter = useCallback(() => setOpenFilter(null), []);
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const storageKey = `xhandle.htl.columns:${artifactId}`;
  const [widths, setWidths] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; } });
  const dragCleanup = useRef(null), tableRef = useRef(null);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch {} }, [storageKey, widths]);
  useEffect(() => () => dragCleanup.current?.(), []);
  const resize = (event, column) => {
    event.preventDefault(); dragCleanup.current?.();
    const start = event.clientX, width = columnWidth(widths[column] || (column === 'HTR' ? 150 : 300));
    const move = event => setWidths(current => ({ ...current, [column]: columnWidth(width + event.clientX - start) }));
    const finish = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', finish); dragCleanup.current = null; };
    dragCleanup.current = finish; window.addEventListener('mousemove', move); window.addEventListener('mouseup', finish);
  };
  const groups = useMemo(() => filterHazardGroups(allGroups, filters), [allGroups, filters]);
  const filterOptions = useMemo(() => openFilter ? hazardColumnOptions(allGroups, openFilter.column) : [], [allGroups, openFilter]);
  const setColumnFilter = (column, filter) => { setFilters(current => { const next = { ...current }; if (filter) next[column] = filter; else delete next[column]; return next; }); setPage(1); };
  const assessmentCount = useMemo(() => allGroups.reduce((count, group) => count + group.rows.length, 0), [allGroups]);
  const pendingCount = useMemo(() => allGroups.filter(group => group.actionable && !group.safetyIssue).length, [allGroups]);
  const [page, setPage] = useState(() => Math.floor(Math.max(0, groups.findIndex(group => group.rows.some(row => row.id === selectedId))) / PAGE_SIZE) + 1);
  useEffect(() => {
    if (!selectedId) return;
    const index = allGroups.findIndex(group => group.rows.some(row => row.id === selectedId));
    if (index < 0) {
      const row = rows.find(row => row.id === selectedId);
      if (row) setOther(outsideSafetyScope(row));
      return;
    }
    const visible = filterHazardGroups(allGroups, filtersRef.current);
    const filteredIndex = visible.findIndex(group => group.rows.some(row => row.id === selectedId));
    if (filteredIndex < 0) setFilters({});
    setPage(Math.floor((filteredIndex < 0 ? index : filteredIndex) / PAGE_SIZE) + 1);
    const timer = setTimeout(() => {
      const node = [...(tableRef.current?.querySelectorAll('[data-artifact-object-id]') || [])].find(node => node.dataset.artifactObjectId === selectedId);
      if (node) { node.scrollIntoView?.({ block: 'center', inline: 'nearest' }); node.classList.add('xhandle-search-hit'); node.focus({ preventScroll: true }); }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedId, allGroups, rows]);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE)), current = Math.min(page, totalPages), start = (current - 1) * PAGE_SIZE;
  return <div className="requirements-table-panel flex min-h-0 flex-1 flex-col rounded-xl border bg-white">
    <div className="shrink-0 border-b px-3 py-2 text-sm"><p>{allGroups.length} hazard {allGroups.length === 1 ? 'entry' : 'entries'} from {assessmentCount} assessment {assessmentCount === 1 ? 'row' : 'rows'}. {other ? 'Other assessments are retained for review without HTRs.' : 'Scenarios and unsafe-action variants are consolidated into actionable concerns; expand a hazard to inspect its original assessments.'}</p>
      {!!excluded.length && <p className="mt-1">{excluded.length} other assessments are not applicable or outside the Projects safety-issue scope. <button className="text-indigo-700" onClick={() => { setOther(value => !value); setFilters({}); setPage(1); }}>{other ? 'Show hazard tracking records' : 'Review other assessments'}</button></p>}
      {!other && pendingCount > 0 && <p className="mt-1 text-amber-800">{pendingCount} preliminary {pendingCount === 1 ? 'group is' : 'groups are'} awaiting generated safety issue summaries. Generate or resume consolidation to finish.</p>}
      <div className="mt-2 flex flex-wrap gap-3">{Object.values(filters).some(Boolean) && <button onClick={() => { setFilters({}); setPage(1); }}>Clear filters</button>}<button onClick={() => setWidths({})}>Reset column widths</button><span className="text-gray-500">Click a column header to select filter values. Filters apply across all records. Drag column edges to resize.</span></div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-2 text-sm">
      <p role="status">{groups.length ? `Rows ${start + 1}–${Math.min(start + PAGE_SIZE, groups.length)} of ${groups.length}` : 'No assessment rows'}</p>
      <div className="flex items-center gap-2"><button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous page</button>
        <label>Page <input aria-label="Hazard tracking page" type="number" min={1} max={totalPages} value={current} className="w-20 rounded border px-2 py-1" onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= totalPages) setPage(value); }} /> of {totalPages}</label>
        <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={current >= totalPages} onClick={() => setPage(current + 1)}>Next page</button></div>
    </div>
    <div className="requirements-table-scroll min-h-0 flex-1 overflow-auto"><table ref={tableRef} className="text-left text-sm" style={{ tableLayout: 'fixed', width: HAZARD_TRACKING_TABLE_COLUMNS.reduce((sum, column) => sum + columnWidth(widths[column] || (column === 'HTR' ? 150 : 300)), 0) }} aria-label="Hazard tracking assessments">
      <colgroup>{HAZARD_TRACKING_TABLE_COLUMNS.map(column => <col key={column} style={{ width: columnWidth(widths[column] || (column === 'HTR' ? 150 : 300)) }} />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-gray-50"><tr>{HAZARD_TRACKING_TABLE_COLUMNS.map(column => <th key={column} title={column === 'HTR' ? 'Hazard Tracking Record' : undefined} className="relative border-b px-3 py-2 font-medium"><button type="button" aria-label={`Filter ${column}`} aria-haspopup="dialog" aria-expanded={openFilter?.column === column} onClick={event => { const anchor = event.currentTarget; setOpenFilter(current => current?.column === column ? null : { column, anchor }); }} className={`flex w-full items-start justify-between gap-2 text-left ${filters[column] ? 'text-indigo-700' : ''}`}><span>{column}</span><span aria-hidden="true">{filters[column] ? '● ' : ''}▾</span></button><span role="separator" aria-label={`Resize ${column} column`} aria-orientation="vertical" aria-valuenow={columnWidth(widths[column] || (column === 'HTR' ? 150 : 300))} aria-valuemin={100} aria-valuemax={1200} tabIndex={0} onMouseDown={event => resize(event, column)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setWidths(current => ({ ...current, [column]: columnWidth((current[column] || (column === 'HTR' ? 150 : 300)) + (event.key === 'ArrowLeft' ? -20 : 20)) })); } }} className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-gray-300 hover:bg-indigo-200" /></th>)}</tr>
      </thead>
      <tbody>{groups.slice(start, start + PAGE_SIZE).map(group => <HazardGroup key={group.id} group={group} selectedId={selectedId} selectedIds={selectedIds} onSelect={onSelect} onEdit={onEdit} disabled={disabled} />)}</tbody>
    </table></div>
    {openFilter && <HazardColumnFilter key={openFilter.column} column={openFilter.column} anchor={openFilter.anchor} options={filterOptions} filter={filters[openFilter.column]} onChange={filter => setColumnFilter(openFilter.column, filter)} onClose={closeFilter} />}
  </div>;
}
