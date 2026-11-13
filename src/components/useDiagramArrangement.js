import { useCallback, useEffect, useRef, useState } from 'react';

// A small presentation-only history; no source rows or evidence are copied.
export default function useDiagramArrangement(initial, onChange) {
  const [value, setValue] = useState(initial);
  const current = useRef(value);
  const history = useRef({ past: [], future: [], checkpoint: value });
  const callback = useRef(onChange);
  callback.current = onChange;
  const timer = useRef(null);
  const gesture = useRef(false);
  const [, render] = useState(0);
  const commit = useCallback(() => {
    clearTimeout(timer.current);
    const h = history.current;
    if (h.checkpoint === current.current) return;
    h.past = [...h.past, h.checkpoint].slice(-40);
    h.future = [];
    h.checkpoint = current.current;
    render(n => n + 1);
  }, []);
  const update = useCallback((key, change) => {
    const before = current.current;
    const next = typeof change === 'function' ? change(before[key]) : change;
    if (next === before[key]) return;
    current.current = { ...before, [key]: next };
    setValue(current.current);
    callback.current?.(current.current);
    clearTimeout(timer.current);
    if (!gesture.current) timer.current = setTimeout(commit, 300);
  }, [commit]);
  const travel = useCallback(direction => {
    commit();
    const h = history.current;
    const from = direction === 'undo' ? h.past : h.future;
    const to = direction === 'undo' ? h.future : h.past;
    if (!from.length) return;
    to.push(current.current);
    current.current = from.pop();
    h.checkpoint = current.current;
    setValue(current.current);
    callback.current?.(current.current);
  }, [commit]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const beginGesture = useCallback(() => { commit(); gesture.current = true; }, [commit]);
  const endGesture = useCallback(() => { gesture.current = false; commit(); }, [commit]);
  return { value, update, undo: () => travel('undo'), redo: () => travel('redo'),
    beginGesture, endGesture,
    canUndo: history.current.past.length > 0 || history.current.checkpoint !== value,
    canRedo: history.current.future.length > 0 };
}
