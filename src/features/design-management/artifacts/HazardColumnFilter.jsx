import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterValueSelected, toggleColumnFilter } from './hazardTableControls';

const PAGE_SIZE = 100;
export default function HazardColumnFilter({ column, anchor, options, filter, onChange, onClose }) {
  const ref = useRef(null), inputRef = useRef(null);
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(PAGE_SIZE);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 336)), top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 430)) });
    };
    place(); inputRef.current?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  useEffect(() => {
    const outside = event => { if (!ref.current?.contains(event.target) && !anchor.contains(event.target)) onClose(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [anchor, onClose]);
  const matches = options.filter(value => (value || '(blank)').toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(<div ref={ref} role="dialog" aria-label={`Filter ${column} values`} className="fixed z-[100000] flex w-80 max-w-[calc(100vw-16px)] flex-col rounded-lg border bg-white text-sm text-gray-900 shadow-xl" style={{ ...position, maxHeight: 'min(420px, calc(100vh - 16px))' }} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { onClose(); return; }
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); anchor.focus(); }
  }}>
    <div className="border-b p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><strong>{column}</strong><button type="button" aria-label={`Close ${column} filter`} onClick={() => { onClose(); anchor.focus(); }}>✕</button></div>
      <input ref={inputRef} type="search" aria-label={`Search ${column} values`} placeholder="Search values…" value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} className="w-full rounded border px-2 py-1.5" />
      <div className="mt-2 flex flex-wrap gap-3 text-xs"><button type="button" onClick={() => onChange(undefined)}>Select all</button><button type="button" onClick={() => onChange({ mode: 'include', values: [] })}>Deselect all</button>{query && <button type="button" onClick={() => onChange({ mode: 'include', values: matches })}>Select matching</button>}</div>
      <p role="status" className="mt-2 text-xs text-gray-500">{filter ? filter.mode === 'exclude' ? `All except ${filter.values.length} selected` : `${filter.values.length} selected` : 'All values selected'}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {matches.slice(0, limit).map(value => <label key={value} className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-gray-50"><input type="checkbox" className="mt-1 shrink-0" checked={filterValueSelected(filter, value)} onChange={() => onChange(toggleColumnFilter(filter, value))} /><span className="line-clamp-3 break-words" title={value || '(blank)'}>{value || '(blank)'}</span></label>)}
      {!matches.length && <p className="p-2 text-gray-500">No matching values</p>}
      {matches.length > limit && <button type="button" className="p-2 text-indigo-700" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show more values ({matches.length - limit} remaining)</button>}
    </div>
    <div className="flex items-center justify-between border-t p-3 text-xs"><button type="button" onClick={() => onChange(undefined)}>Clear column filter</button><button type="button" className="rounded border px-3 py-1" onClick={() => { onClose(); anchor.focus(); }}>Done</button></div>
  </div>, document.body);
}
