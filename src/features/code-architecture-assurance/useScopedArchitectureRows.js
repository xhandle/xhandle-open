import { useCallback, useRef, useState } from 'react';
import { immutableFunctionalRows } from '../code-architecture-context/functionalModel';

const EMPTY = Object.freeze([]);
const UNLOADED = Object.freeze({ scope: null, rows: EMPTY, dirty: false });

// The rows and their owner move together. A render for another scope must never
// expose the previous array, even before the hydration effect has started.
export default function useScopedArchitectureRows(scope) {
  const active = useRef(scope);
  const epoch = useRef(0);
  const session = useRef(0);
  if (active.current !== scope) { active.current = scope; epoch.current++; session.current++; }
  const ownerSession = session.current;
  const [snapshot, setSnapshot] = useState(UNLOADED);
  const adoptRows = useCallback((next, dirty = false) => {
    if (!scope || active.current !== scope || session.current !== ownerSession) return;
    epoch.current++;
    setSnapshot(previous => {
      if (active.current !== scope || session.current !== ownerSession) return previous;
      const rows = previous.scope === scope && previous.session === ownerSession ? previous.rows : EMPTY;
      return { scope, session: ownerSession, rows: immutableFunctionalRows(typeof next === 'function' ? next(rows) : next), dirty };
    });
  }, [scope, ownerSession]);
  const setRows = useCallback(next => adoptRows(next, true), [adoptRows]);
  const beginLoad = useCallback(() => {
    const token = ++epoch.current;
    return () => active.current === scope && session.current === ownerSession && epoch.current === token;
  }, [scope, ownerSession]);
  const publishRows = useCallback((owner, rows) => {
    if (!owner || active.current !== owner) return;
    epoch.current++;
    setSnapshot({ scope: owner, session: session.current, rows: immutableFunctionalRows(rows), dirty: false });
  }, []);
  const owned = snapshot.scope === scope && snapshot.session === ownerSession ? snapshot : UNLOADED;
  return { publishRows, rows: owned.rows, snapshot: owned, setRows, adoptRows, beginLoad };
}
