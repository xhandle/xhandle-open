import React, { forwardRef, useEffect, useMemo, useRef, useImperativeHandle } from 'react';
import LiteSummaryDiagramReactFlow from '../../../components/LiteSummaryDiagramReactFlow';
import { nativeArchitectureState, nativeElementSource } from './nativeArchitectureSnapshot';

export default forwardRef(function NativeArchitectureDiagram({ diagram, focusId, onSelect, editable = false, onPresentationChange }, ref) {
  const state = useMemo(() => nativeArchitectureState(diagram, onPresentationChange), [diagram, onPresentationChange]);
  const canvas = useRef(null);
  const host = useRef(null);
  useImperativeHandle(ref, () => ({ flushPresentation: () => canvas.current?.flushPresentation(), isReady: () => canvas.current?.isReady(), getPNG: () => canvas.current?.getPNG() }), []);
  useEffect(() => {
    // onInit precedes snapshot hydration. Fit only once nodes are measured,
    // then refit when the available pane changes size, not on ordinary renders.
    let attempts = 0;
    const fit = () => canvas.current?.fitViewToDiagram({ duration: 0 });
    const timer = setInterval(() => {
      if (++attempts > 150) clearInterval(timer);
      else if (canvas.current?.isReady()) { if (!focusId) fit(); clearInterval(timer); }
    }, 100);
    const observer = new ResizeObserver(() => { if (canvas.current?.isReady() && !focusId) fit(); });
    if (host.current) observer.observe(host.current);
    return () => { clearInterval(timer); observer.disconnect(); };
  }, [state, focusId]);
  useEffect(() => {
    if (!focusId) return;
    const node = diagram.snapshot.nodes.find(node => node.id === focusId);
    const edge = diagram.snapshot.edges.find(edge => edge.id === focusId);
    const target = node ? { kind: node.group ? 'subsystem' : 'function', label: node.label } : edge ? { kind: 'edge', label: edge.label, fromFunction: edge.row?.fromFunction, toFunction: edge.row?.toFunction } : null;
    let attempts = 0;
    const timer = setInterval(() => {
      const ids = node ? [node.id] : edge ? [edge.from, edge.to] : [];
      const exactIdentity = diagram.snapshot.native?.nodeLabels;
      if (++attempts > 40 || (canvas.current?.isReady() && ((exactIdentity && canvas.current?.focusSavedElements?.(ids)) || canvas.current?.focusArchitectureTarget(target)))) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [diagram, focusId]);
  return <div ref={host} style={{ height: '100%', minHeight: 0 }}><LiteSummaryDiagramReactFlow ref={canvas} rows={state.rows} nodeLabels={diagram.snapshot.native?.nodeLabels} preserveSnapshotGeometry={diagram.snapshot.native?.preserveGeometry === true} autoCategories={state.autoCategories} storageKey={state.key} storage={state.storage} readOnly={!editable} layoutOnly={editable} onInspectElement={target => onSelect?.(nativeElementSource(diagram, target))} /></div>;
});
