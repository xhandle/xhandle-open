import { useCallback, useLayoutEffect, useRef } from 'react';

// Stable event handlers for memoized views; invoke the latest committed state.
// Do not use for render-time derivations (which need explicit dependencies).
export default function useEventCallback(callback) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args) => latest.current(...args), []);
}
