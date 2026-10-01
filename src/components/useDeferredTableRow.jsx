import React, { useLayoutEffect, useRef, useState } from 'react';

const observers = new WeakMap();
function watch(element, reveal) {
  const root = element.closest('table')?.parentElement;
  if (!root || typeof IntersectionObserver === 'undefined') { reveal(); return () => {}; }
  let entry = observers.get(root);
  if (!entry) {
    const callbacks = new Map();
    const observer = new IntersectionObserver(items => items.forEach(item => {
      if (item.isIntersecting) callbacks.get(item.target)?.();
    }), { root, rootMargin: '800px 0px' });
    entry = { callbacks, observer };
    observers.set(root, entry);
  }
  entry.callbacks.set(element, reveal);
  entry.observer.observe(element);
  return () => {
    entry.observer.unobserve(element);
    entry.callbacks.delete(element);
    if (!entry.callbacks.size) { entry.observer.disconnect(); observers.delete(root); }
  };
}

export function estimateTableRowHeight(row, widths, indexes) {
  const lines = indexes.reduce((max, index) => {
    const columns = Math.max(8, Math.floor(((widths[index] || 180) - 24) / 7));
    const count = String(row[index] ?? '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
    return Math.max(max, count);
  }, 1);
  return Math.max(64, lines * 16 + 16);
}

// Mount expensive cells as rows approach the viewport. Once mounted, keep them
// mounted: scrolling cannot discard an edit, reset focus, or change row height.
// Placeholders retain IDs/refs for existing table links and model-backed Find.
export default function useDeferredTableRow({ id, index, active, bypass, height, colSpan, rowRefs, originalIndex }) {
  const [revealed, setRevealed] = useState(index < 10);
  const elementRef = useRef(null);
  const show = revealed || active || bypass;
  useLayoutEffect(() => {
    if (show || !elementRef.current) return undefined;
    const element = elementRef.current;
    const reveal = () => setRevealed(true);
    const stop = watch(element, reveal);
    element.addEventListener('xhandle:reveal-row', reveal);
    return () => { stop(); element.removeEventListener('xhandle:reveal-row', reveal); };
  }, [show]);
  useLayoutEffect(() => { if (active && !revealed) setRevealed(true); }, [active, revealed]);
  return show ? null : <tr id={id} data-deferred-row="true" aria-hidden="true"
    ref={element => {
      elementRef.current = element;
      if (element) rowRefs.current[originalIndex] = element;
      else delete rowRefs.current[originalIndex];
    }}>
    <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
  </tr>;
}
