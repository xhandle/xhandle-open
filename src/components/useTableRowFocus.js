import { useEffect, useRef } from 'react';

// Reveal logic runs in the caller. Only acknowledge once the revealed row exists.
export default function useTableRowFocus({ requestKey, rowIndex, rowRefs, revision, onResolved }) {
  const handled = useRef(null);
  const callback = useRef(onResolved);
  callback.current = onResolved;
  useEffect(() => {
    if (rowIndex === null || rowIndex === undefined || rowIndex === '') {
      handled.current = null;
      return;
    }
    const identity = `${requestKey ?? ''}:${rowIndex}`;
    if (handled.current === identity) return;
    const timer = requestAnimationFrame(() => {
      const element = rowRefs.current[rowIndex];
      if (!element?.isConnected) return;
      element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      handled.current = identity;
      callback.current?.(requestKey);
    });
    return () => cancelAnimationFrame(timer);
  }, [requestKey, rowIndex, rowRefs, revision]);
}
