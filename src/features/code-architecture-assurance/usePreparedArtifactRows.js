import { useEffect, useMemo, useRef, useState } from 'react';
import { enrichRowForDisplay, rowIdentity } from './artifactUtils';

// Both display enrichment and the first virtual layout are prepared in batches.
function* prepareRows(rows, previous) {
  const prepared = [], ids = [], counts = new Map(), byRow = new Map();
  const keys = [], keyByItem = new Map(), positions = new Map(), offsets = [0];
  const total = rows.length * 2;
  for (let i = 0; i < rows.length; i++) {
    const row = previous?.get(rows[i]) || enrichRowForDisplay(rows[i]);
    const item = { row, rowIndex: i }, id = rowIdentity(row, i);
    prepared.push(item); ids.push(id); byRow.set(rows[i], row);
    counts.set(id, (counts.get(id) || 0) + 1);
    if ((i + 1) % 100 === 0) yield Math.floor((i + 1) * 100 / total);
  }
  for (let i = 0; i < prepared.length; i++) {
    const key = JSON.stringify([ids[i], counts.get(ids[i]) > 1 ? i : null]);
    keys.push(key); keyByItem.set(prepared[i], key); positions.set(key, i); offsets.push((i + 1) * 120);
    if ((i + 1) % 100 === 0 && i + 1 < prepared.length) yield Math.floor((rows.length + i + 1) * 100 / total);
  }
  return { prepared, byRow, virtualModel: { items: prepared, keys, keyByItem, positions, offsets, estimate: 120 } };
}

export default function usePreparedArtifactRows(rows, scope) {
  const completed = useRef(null);
  const immediate = useMemo(() => {
    // Preserve mounted editors for small edits within the same scope.
    const previous = completed.current?.scope === scope ? completed.current.byRow : null;
    let newRows = 0;
    for (const row of rows) if (!previous?.has(row) && ++newRows > 100) return null;
    const iterator = prepareRows(rows, previous);
    let step = iterator.next();
    while (!step.done) step = iterator.next();
    return step.value;
  }, [rows, scope]);
  useEffect(() => {
    if (immediate) completed.current = { scope, byRow: immediate.byRow };
  }, [immediate, scope]);
  const [state, setState] = useState(null);
  useEffect(() => {
    if (immediate) return undefined;
    let cancelled = false, timer;
    const previous = completed.current?.scope === scope ? completed.current.byRow : null;
    const iterator = prepareRows(rows, previous);
    setState({ rows, scope, progress: 0, prepared: null });
    const next = () => {
      if (cancelled) return;
      const step = iterator.next();
      if (step.done) {
        completed.current = { scope, byRow: step.value.byRow };
        setState({ rows, scope, ...step.value, progress: 100 });
      } else {
        setState({ rows, scope, progress: step.value, prepared: null });
        timer = setTimeout(next, 0);
      }
    };
    timer = setTimeout(next, 0);
    return () => { cancelled = true; clearTimeout(timer); iterator.return(); };
  }, [rows, scope, immediate]);
  if (immediate) return { ...immediate, progress: 100 };
  if (state?.rows !== rows || state?.scope !== scope) return { prepared: null, progress: 0 };
  return state;
}
