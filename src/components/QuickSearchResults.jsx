import React, { useLayoutEffect, useRef, useState } from 'react';

// Fixed, compact rows bound DOM work even for a full diagram with thousands of
// elements. Keep the active item mounted for aria-activedescendant as you scroll.
export default function QuickSearchResults({ rows, active, browse, onChoose, resetKey }) {
  const ref = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(360);
  const rowHeight = browse ? 44 : 64;
  useLayoutEffect(() => {
    const list = ref.current;
    const measure = () => {
      const next = list.clientHeight || 360;
      setHeight(previous => previous === next ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(list);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useLayoutEffect(() => {
    ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);
  useLayoutEffect(() => {
    const list = ref.current;
    const top = active * rowHeight, bottom = top + rowHeight;
    const available = list.clientHeight || height;
    const next = top < list.scrollTop ? top : bottom > list.scrollTop + available ? bottom - available : list.scrollTop;
    if (list.scrollTop !== next) { list.scrollTop = next; setScrollTop(next); }
  }, [active, rowHeight, height, resetKey]);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const last = Math.min(rows.length, first + Math.ceil(height / rowHeight) + 9);
  const indexes = Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index);
  if (rows[active] && !indexes.includes(active)) indexes.push(active);
  indexes.sort((a, b) => a - b);
  return <ul ref={ref} id="quick-search-results" role={browse ? 'tree' : 'listbox'}
    aria-label={browse ? 'Diagram navigator' : 'Search results'}
    className="relative overflow-auto" style={{ height: Math.min(360, rows.length * rowHeight), maxHeight: '45vh' }}
    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
    <li role="presentation" aria-hidden="true" style={{ height: rows.length * rowHeight, pointerEvents: 'none' }} />
    {indexes.map(index => {
      const entry = rows[index];
      const detail = entry.navigator?.context || entry.text || entry.navigator?.identity || '';
      return <li key={entry.id} id={`quick-search-result-${index}`}
        role={browse ? 'treeitem' : 'option'} aria-selected={index === active}
        aria-level={browse ? entry.group ? 1 : 2 : undefined}
        aria-expanded={entry.group ? entry.expanded : undefined}
        aria-posinset={browse ? entry.position : index + 1} aria-setsize={browse ? entry.size : rows.length}
        onMouseDown={event => event.preventDefault()} onClick={() => onChoose(entry, index)}
        title={[entry.label, detail, entry.navigator?.identity].filter(Boolean).join('\n')}
        style={{ position: 'absolute', top: index * rowHeight, height: rowHeight, left: 0, right: 0 }}
        className={`cursor-pointer overflow-hidden rounded px-3 py-1.5 ${browse && !entry.group ? 'ml-4' : ''} ${index === active ? 'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100' : 'hover:bg-gray-50 dark:hover:bg-zinc-800'}`}>
        {entry.group ? <div className="flex h-full items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true">{entry.expanded ? '▾' : '▸'}</span>{entry.label}
          <span className="ml-auto text-xs font-normal text-gray-500">{entry.entries.length}</span>
        </div> : <>
          <div className="truncate text-sm font-medium">{!browse && <span className="text-xs text-gray-500">{entry.navigator?.group || entry.kind} · </span>}{entry.label}</div>
          <div className={`text-xs text-gray-500 ${browse ? 'truncate' : 'line-clamp-2'}`}>{String(detail).slice(0, 600)}</div>
        </>}
      </li>;
    })}
  </ul>;
}
