import { useEffect, useState } from 'react';

// A generator yields after a bounded amount of real work. The first batch runs
// after a frame so a loading shell can paint before preparation begins.
export default function useHazardPreparation(job, immediate = null) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (immediate !== null) return undefined;
    let cancelled = false, frame, timer;
    const iterator = job();
    const next = () => {
      if (cancelled) return;
      try {
        const step = iterator.next();
        setState({ job, result: step.done ? step.value : null, progress: step.done ? 100 : step.value, error: null });
        if (!step.done) timer = setTimeout(next, 0);
      } catch (error) { setState({ job, result: null, progress: 0, error }); }
    };
    frame = requestAnimationFrame(() => { timer = setTimeout(next, 0); });
    return () => { cancelled = true; cancelAnimationFrame(frame); clearTimeout(timer); iterator.return?.(); };
  }, [job, immediate]);
  if (immediate !== null) return { result: immediate, progress: 100, error: null };
  return state?.job === job ? state : { result: null, progress: 0, error: null };
}
