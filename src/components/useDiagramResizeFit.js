import { useEffect, useRef } from 'react';

// Fit once after a resize settles, using the latest graph without reconnecting
// the observer whenever its visible nodes change.
export default function useDiagramResizeFit(hostRef, fit, shouldSuppress) {
  const latest = useRef({ fit, shouldSuppress });
  latest.current = { fit, shouldSuppress };
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let timer;
    let previousSize;
    // A delayed automatic fit must not override navigation that began after
    // the resize. Observe input without preventing React Flow's own handlers.
    const cancelPendingFit = () => clearTimeout(timer);
    host.addEventListener('pointerdown', cancelPendingFit, { capture: true, passive: true });
    host.addEventListener('wheel', cancelPendingFit, { capture: true, passive: true });
    const observer = new ResizeObserver((entries) => {
      const rect = entries.find(entry => entry.target === host)?.contentRect;
      if (!rect) return;
      // Hidden hosts must cancel pending work before rounded-size deduplication:
      // a positive fractional size and zero can otherwise have the same key.
      if (rect.width <= 0 || rect.height <= 0) {
        clearTimeout(timer);
        previousSize = undefined;
        return;
      }
      const size = `${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (size === previousSize) return;
      previousSize = size;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!latest.current.shouldSuppress()) latest.current.fit({ duration: 0 });
      }, 150);
    });
    observer.observe(host);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      host.removeEventListener('pointerdown', cancelPendingFit, true);
      host.removeEventListener('wheel', cancelPendingFit, true);
    };
  }, [hostRef]);
}
