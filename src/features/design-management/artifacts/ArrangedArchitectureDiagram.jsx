import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import TablePreparationProgress from '../../code-architecture-assurance/TablePreparationProgress';
import NativeArchitectureDiagram from './NativeArchitectureDiagram';
import NativeCodeArchitectureDiagram from './NativeCodeArchitectureDiagram';
import { loadArchitecturePresentation, saveArchitecturePresentation } from './architecturePresentation';

// Keep annotations and display preferences; reset only arrangement overrides.
export function sourceLayoutPresentation(presentation) {
  const next = { ...presentation, storage: { ...presentation?.storage } };
  delete next.geometry;
  delete next.routing;
  for (const key of ['', ':groups:v1', ':element-sizes:v1', ':edge-routing:v1']) delete next.storage[key];
  return next;
}

export default forwardRef(function ArrangedArchitectureDiagram({ artifactId, diagram, ...props }, ref) {
  // The parent keys this component by artifact, diagram and snapshot hash.
  // Ignore newly deserialized copies of that same immutable snapshot.
  const snapshot = useRef(diagram).current;
  const [loaded, setLoaded] = useState(null);
  const [status, setStatus] = useState('');
  const [restoringLayout, setRestoringLayout] = useState(false);
  const latest = useRef(null);
  const timer = useRef(null);
  const pending = useRef(Promise.resolve());
  const canvas = useRef(null);
  const alive = useRef(true);
  const currentPresentation = useRef(null);
  const restoring = useRef(false);
  const epoch = useRef(0);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const flush = useCallback(() => {
    if (restoring.current) return pending.current;
    canvas.current?.flushPresentation?.();
    clearTimeout(timer.current);
    if (!latest.current) return pending.current;
    const value = latest.current;
    latest.current = null;
    pending.current = pending.current.catch(() => {}).then(() => saveArchitecturePresentation(artifactId, snapshot, value));
    pending.current.then(() => { if (alive.current && !latest.current) setStatus('Arrangement saved'); }, error => {
      if (alive.current) { latest.current ||= value; setStatus(`Arrangement not saved: ${error.message}`); }
    });
    return pending.current;
  }, [artifactId, snapshot]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    loadArchitecturePresentation(artifactId, snapshot).then(presentation => {
      if (!cancelled) { currentPresentation.current = presentation; setLoaded({ ...snapshot, presentation }); }
    }, error => { if (!cancelled) setStatus(`Could not load arrangement: ${error.message}`); });
    return () => { cancelled = true; alive.current = false; flush().catch(() => {}); };
  }, [artifactId, snapshot, flush]);
  const change = useCallback(presentation => {
    if (restoring.current || canvasVersion !== epoch.current) return;
    currentPresentation.current = presentation;
    latest.current = presentation;
    queueMicrotask(() => { if (alive.current) setStatus('Saving arrangement…'); });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush().catch(() => {}), 250);
  }, [flush, canvasVersion]);
  const restoreSourceLayout = useCallback(async () => {
    if (restoring.current || !loaded) return;
    const saved = flush();
    restoring.current = true;
    setRestoringLayout(true);
    setStatus('Restoring source layout…');
    try {
      await saved;
      const presentation = sourceLayoutPresentation(currentPresentation.current);
      pending.current = saveArchitecturePresentation(artifactId, snapshot, presentation);
      await pending.current;
      currentPresentation.current = presentation;
      latest.current = null;
      epoch.current += 1;
      if (alive.current) {
        setLoaded({ ...snapshot, presentation });
        setCanvasVersion(epoch.current);
        setStatus('Source layout restored');
      }
    } catch (error) {
      pending.current = pending.current.catch(() => {});
      if (alive.current) setStatus(`Could not restore source layout: ${error.message}`);
      throw error;
    } finally { restoring.current = false; if (alive.current) setRestoringLayout(false); }
  }, [artifactId, snapshot, loaded, flush]);
  useImperativeHandle(ref, () => ({ flush, restoreSourceLayout, getPNG: () => canvas.current?.getPNG(), isReady: () => canvas.current?.isReady() }), [flush, restoreSourceLayout]);
  const Canvas = diagram.workspaceType === 'functional' ? NativeArchitectureDiagram : NativeCodeArchitectureDiagram;
  return <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {(status.startsWith('Arrangement not saved:') || status.startsWith('Could not ')) && <div role="alert" className="text-xs text-slate-500" style={{ flexShrink: 0 }}>{status}{status.startsWith('Arrangement not saved:') && <button onClick={() => flush().catch(() => {})}>Retry save</button>}</div>}
    {!loaded && !status && <TablePreparationProgress label="Loading diagram arrangement" progress={0} />}
    {loaded && <div aria-busy={restoringLayout} inert={restoringLayout ? '' : undefined} style={{ flex: 1, minHeight: 0, pointerEvents: restoringLayout ? 'none' : undefined }}><Canvas key={canvasVersion} ref={canvas} diagram={loaded} editable onPresentationChange={change} {...props} /></div>}
  </div>;
});
