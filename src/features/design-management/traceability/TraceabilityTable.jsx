import React, { useMemo, useState, useEffect } from 'react';
import ColumnValueFilter from '../../requirements/components/ColumnValueFilter';
import { filterValueSelected } from '../../requirements/components/columnValueFilters';

export default function TraceabilityTable({ rows, columns, onOpen, onExclude, identity = '', focusRowId }) {
  const [filters, setFilters] = useState({}), [open, setOpen] = useState(null), [page, setPage] = useState(0), [widths, setWidths] = useState({});
  useEffect(() => { setFilters({}); setPage(0); setOpen(null); }, [identity]);
  useEffect(() => { if (focusRowId) { setFilters({}); setPage(Math.max(0, Math.floor(rows.findIndex(row => row.id === focusRowId) / 100))); const timer = setTimeout(() => { const element = [...document.querySelectorAll('.trace-table [data-design-object-id]')].find(node => node.dataset.designObjectId === focusRowId); element?.scrollIntoView?.({ block: 'center', inline: 'nearest' }); element?.classList.add('xhandle-search-hit'); }, 0); return () => clearTimeout(timer); } }, [focusRowId, rows]);
  const filtered = useMemo(() => rows.filter(row => columns.every(column => filterValueSelected(filters[column], String(row[column] ?? '')))), [rows, columns, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / 100)), currentPage = Math.min(page, pages - 1);
  const resize = (event, column) => {
    event.preventDefault(); const start = event.clientX, width = widths[column] || 240;
    const move = event => setWidths(previous => ({ ...previous, [column]: Math.max(100, Math.min(1400, width + event.clientX - start)) }));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };
  return <div className="trace-table">
    <div className="trace-actions"><span role="status">{filtered.length} of {rows.length} rows · Page {currentPage + 1} of {pages}</span><button disabled={!Object.values(filters).some(Boolean)} onClick={() => { setFilters({}); setPage(0); }}>Clear filters</button><button onClick={() => setWidths({})}>Reset column widths</button><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous page</button><button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next page</button></div>
    <div className="trace-table-scroll"><table style={{ width: columns.reduce((width, column) => width + (widths[column] || 240), 0), tableLayout: 'fixed' }}><thead><tr>{columns.map(column => <th key={column} style={{ width: widths[column] || 240 }}><button aria-label={`Filter ${column}`} aria-expanded={open?.column === column} onClick={event => setOpen({ column, anchor: event.currentTarget })}>{column} {filters[column] ? '●' : '▾'}</button><span role="separator" aria-label={`Resize ${column}`} tabIndex={0} aria-orientation="vertical" onPointerDown={event => resize(event, column)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setWidths(previous => ({ ...previous, [column]: Math.max(100, (previous[column] || 240) + (event.key === 'ArrowLeft' ? -20 : 20)) })); } }} /></th>)}</tr></thead><tbody>{filtered.slice(currentPage * 100, currentPage * 100 + 100).map(row => <tr key={row.id} data-design-object-id={row.id}>{columns.map((column, index) => <td key={column}>{index === 0 && onOpen && row.artifactId ? <button className="trace-object-link" onClick={() => onOpen(row)}>{String(row[column] ?? '')}</button> : String(row[column] ?? '')}{column === 'Finding' && row.nodeId && onExclude && <button onClick={() => onExclude(row)}>{row.Status === 'Excluded' ? 'Review exclusion' : 'Exclude with rationale'}</button>}</td>)}</tr>)}</tbody></table>{!filtered.length && <p>No matching rows.</p>}</div>
    {open && <ColumnValueFilter key={open.column} column={open.column} anchor={open.anchor} options={[...new Set(rows.map(row => String(row[open.column] ?? '')))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))} filter={filters[open.column]} onChange={filter => { setFilters(previous => ({ ...previous, [open.column]: filter })); setPage(0); }} onClose={() => setOpen(null)} />}
  </div>;
}
