import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';

export const architectureHeaderClass = 'sticky top-0 z-10 bg-indigo-50 text-slate-700 font-semibold text-[13px] uppercase tracking-wide border-b border-slate-200 px-3 py-2';
export const architectureCellClass = 'border-b border-slate-100 px-3 py-2 align-top text-[13px] text-slate-800';
export const architectureLinkClass = 'shrink-0 rounded p-1 text-[#2D7DFE] hover:bg-blue-100 hover:text-[#1E61D6]';
export const diagramFocusView = view => view === 'split' ? 'split' : 'architecture';
export function useLatestCallback(fn) {
  const latest = useRef(fn); latest.current = fn;
  return useCallback((...args) => latest.current?.(...args), []);
}
export const ArchitectureWorkspace = forwardRef(function ArchitectureWorkspace({ view, children, ...props }, ref) {
  return <div ref={ref} {...props} className={`flex min-h-0 min-w-0 flex-1 ${view === 'split' ? 'flex-col md:flex-row' : 'flex-col'}`}>{children}</div>;
});
export function ArchitectureTablePane({ label, basis, toolbar, children }) {
  return <section aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ flexBasis: basis }}>
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-slate-100 bg-white px-3 py-2">{toolbar}</div>
    <div className="min-h-0 flex-1 overflow-auto">{children}</div>
  </section>;
}

// One frame at a time; cleanup also flushes the final coordinate before fitting.
export function useFrameDrag(scope) {
  const cancel = useRef(null);
  const finishFrame = useRef(null);
  useEffect(() => () => { cancel.current?.(false); if (finishFrame.current != null) cancelAnimationFrame(finishFrame.current); }, [scope]);
  return useCallback((event, move, finish, kind = 'pointer') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); cancel.current?.(false);
    if (finishFrame.current != null) cancelAnimationFrame(finishFrame.current);
    const previousCursor = document.body.style.cursor, previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    let frame = null, coordinate = null, ended = false;
    const flush = () => { frame = null; if (coordinate != null) { move(coordinate); coordinate = null; } };
    const onMove = e => { coordinate = e.clientX; if (frame == null) frame = requestAnimationFrame(flush); };
    const end = (fit = true) => {
      if (ended) return; ended = true;
      if (frame != null) cancelAnimationFrame(frame);
      if (fit) flush();
      window.removeEventListener(`${kind}move`, onMove);
      window.removeEventListener(`${kind}up`, onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('blur', onCancel);
      document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelect;
      cancel.current = null;
      if (fit) finishFrame.current = requestAnimationFrame(() => { finishFrame.current = null; finish?.(); });
    };
    const onUp = () => end(true), onCancel = () => end(false);
    cancel.current = end;
    window.addEventListener(`${kind}move`, onMove); window.addEventListener(`${kind}up`, onUp);
    window.addEventListener('pointercancel', onCancel); window.addEventListener('lostpointercapture', onCancel); window.addEventListener('blur', onCancel);
  }, []);
}
export function ArchitectureDivider({ view, scope, workspaceRef, percent, onChange, onFit }) {
  const drag = useFrameDrag(`${scope}:${view}`);
  const fit = useLatestCallback(onFit);
  const keyboardFrame = useRef(null);
  useEffect(() => () => { if (keyboardFrame.current != null) cancelAnimationFrame(keyboardFrame.current); }, [scope, view]);
  if (view !== 'split') return null;
  const clamp = value => Math.min(75, Math.max(25, value));
  return <div role="separator" aria-label="Resize code architecture diagram and functional table panes" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(percent)} tabIndex={0}
    className="group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D7DFE] md:flex" style={{ touchAction: 'none' }}
    onPointerDown={event => drag(event, x => { const bounds = workspaceRef.current?.getBoundingClientRect(); if (bounds?.width) onChange(clamp((x - bounds.left) / bounds.width * 100)); }, fit)}
    onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); onChange(clamp(percent + (event.key === 'ArrowRight' ? 5 : -5))); if (keyboardFrame.current != null) cancelAnimationFrame(keyboardFrame.current); keyboardFrame.current = requestAnimationFrame(fit); }}>
    <span className="w-px bg-slate-200 transition-colors group-hover:bg-[#2D7DFE]" />
  </div>;
}
export function useArchitectureColumnWidths(columns, storageKey, scope = storageKey, persist = true) {
  const read = useCallback(() => {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    return Object.fromEntries(columns.map(column => [column.id, Number.isFinite(saved[column.id]) ? Math.max(column.minWidth, saved[column.id]) : column.defaultWidth]));
  }, [columns, storageKey]);
  const [state, setState] = useState(() => ({ key: storageKey, widths: read() }));
  const widths = state.key === storageKey ? state.widths : read();
  useEffect(() => { setState({ key: storageKey, widths: read() }); }, [read, storageKey]);
  const pendingWidths = useRef(state); pendingWidths.current = state;
  useEffect(() => {
    if (!persist || state.key !== storageKey) return;
    const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(state.widths)); } catch {} }, 120);
    return () => clearTimeout(timer);
  }, [state, storageKey, persist]);
  useEffect(() => () => {
    if (persist && pendingWidths.current.key === storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(pendingWidths.current.widths)); } catch {}
    }
  }, [storageKey, persist]);
  const drag = useFrameDrag(scope);
  const resize = useCallback((event, index) => {
    const column = columns[index], start = event.clientX, width = widths[column.id];
    drag(event, x => setState(previous => ({ key: storageKey, widths: { ...(previous.key === storageKey ? previous.widths : read()), [column.id]: Math.max(column.minWidth, width + x - start) } })), null, 'mouse');
  }, [columns, widths, drag, storageKey, read]);
  return [widths, resize];
}
