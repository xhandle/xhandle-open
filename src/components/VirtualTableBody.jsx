import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { registerTableSearchProvider } from './quickSearchUtils';

const lowerBound = (offsets, value) => {
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (offsets[mid] <= value) lo = mid; else hi = mid - 1; }
  return lo;
};
// Native table semantics, measured row heights, bounded mounted rows. The model
// remains complete for search, copy and export. Active editors remain mounted.
export default function VirtualTableBody({ items, getKey, children, columns, revealKey, requestKey, onReveal, searchText, label = 'Table', estimate = 120 }) {
  const body = useRef(null), scroll = useRef(null), heights = useRef(new Map()), nodes = useRef(new Map());
  const observer = useRef(null), pending = useRef(null), handled = useRef(null), searchJump = useRef(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [measurement, setMeasurement] = useState(0), [active, setActive] = useState(null), [jump, setJump] = useState(null);
  const virtual = items.length > 100;
  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const positions = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  // Measurement is an explicit revision for the measured-height ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offsets = useMemo(() => { const result = [0]; keys.forEach(key => result.push(result[result.length - 1] + (heights.current.get(key) || estimate))); return result; }, [keys, estimate, measurement]);
  useEffect(() => {
    const table = body.current?.closest('table');
    table?.setAttribute('aria-rowcount', String(items.length + 1));
    table?.setAttribute('aria-colcount', String(columns));
  }, [items.length, columns]);
  const update = useCallback(() => {
    const element = scroll.current;
    if (!element || !body.current) return;
    const top = Math.max(0, element.getBoundingClientRect().top - body.current.getBoundingClientRect().top);
    setViewport(previous => previous.top === top && previous.height === element.clientHeight ? previous : { top, height: element.clientHeight || 800 });
  }, []);
  useLayoutEffect(() => {
    let element = body.current?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) element = element.parentElement;
    scroll.current = element || body.current?.parentElement?.parentElement;
    const container = scroll.current;
    let frame;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; update(); }); };
    container?.addEventListener('scroll', schedule, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (container) resize?.observe(container);
    update();
    return () => { container?.removeEventListener('scroll', schedule); resize?.disconnect(); cancelAnimationFrame(frame); };
  }, [update]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver !== 'function') return;
    let frame;
    observer.current = new ResizeObserver(entries => {
      let changed = false;
      entries.forEach(entry => {
        const key = entry.target.dataset.virtualKey;
        const height = entry.target.getBoundingClientRect().height;
        if (height > 0 && Math.abs((heights.current.get(key) || estimate) - height) > 1) { heights.current.set(key, height); changed = true; }
      });
      if (changed && !frame) frame = requestAnimationFrame(() => { frame = null; setMeasurement(value => value + 1); });
    });
    nodes.current.forEach(node => observer.current.observe(node));
    return () => { observer.current?.disconnect(); observer.current = null; cancelAnimationFrame(frame); };
  }, [estimate]);
  useEffect(() => {
    const retained = new Set(keys);
    heights.current.forEach((_, key) => { if (!retained.has(key)) heights.current.delete(key); });
  }, [keys]);
  const reveal = useCallback((key, token) => {
    const index = positions.get(String(key));
    if (index == null) return;
    pending.current = { key: String(key), token };
    setJump(String(key));
    const container = scroll.current;
    if (container && body.current) {
      const origin = body.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTop = Math.max(0, origin + offsets[index] - container.clientHeight / 2);
      update();
    }
  }, [positions, offsets, update]);
  useLayoutEffect(() => {
    if (revealKey == null || revealKey === '') { handled.current = null; return; }
    const token = `${requestKey ?? ''}:${revealKey}`;
    if (handled.current !== token) reveal(String(revealKey), token);
  }, [revealKey, requestKey, reveal]);
  useLayoutEffect(() => {
    const request = pending.current;
    const node = request && nodes.current.get(request.key);
    if (!node) return;
    const frame = requestAnimationFrame(() => {
      if (!node.isConnected) return;
      node.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
      handled.current = request.token; pending.current = null;
      if (searchJump.current === request.token) {
        node.classList.add('xhandle-search-hit'); node.focus?.({ preventScroll: true }); searchJump.current = null;
      } else onReveal?.(requestKey);
      update(); setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    const table = body.current?.closest('table');
    if (!table || !searchText) return;
    return registerTableSearchProvider(table, () => items.map((item, index) => ({
      id: `${label}:${keys[index]}`, kind: 'Table row', label, text: searchText(item),
      activate() { const token = `search:${performance.now()}`; searchJump.current = token; reveal(keys[index], token); },
    })));
  }, [items, keys, label, searchText, reveal]);
  const start = virtual ? Math.max(0, lowerBound(offsets, viewport.top) - 5) : 0;
  const end = virtual ? Math.min(items.length, lowerBound(offsets, viewport.top + viewport.height) + 7) : items.length;
  const visible = new Set(Array.from({ length: end - start }, (_, i) => i + start));
  for (const key of [active, jump]) if (positions.has(key)) visible.add(positions.get(key));
  const result = []; let cursor = 0;
  const spacer = (from, to) => { if (to > from) result.push(<tr key={`space-${from}`} aria-hidden="true"><td colSpan={columns} style={{ height: offsets[to] - offsets[from], padding: 0, border: 0 }} /></tr>); };
  [...visible].sort((a, b) => a - b).forEach(index => {
    spacer(cursor, index);
    const key = keys[index], row = children(items[index], index), originalRef = row.ref;
    result.push(React.cloneElement(row, { key, 'data-virtual-key': key, 'aria-rowindex': index + 2, tabIndex: -1,
      ref: node => {
        const previous = nodes.current.get(key);
        if (previous) observer.current?.unobserve(previous);
        if (node) { nodes.current.set(key, node); observer.current?.observe(node); } else nodes.current.delete(key);
        if (typeof originalRef === 'function') originalRef(node); else if (originalRef) originalRef.current = node;
      },
      onFocusCapture: () => setActive(key),
      onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(null); },
    })); cursor = index + 1;
  });
  spacer(cursor, items.length);
  return <tbody ref={body}>{result}</tbody>;
}
