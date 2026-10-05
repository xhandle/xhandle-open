import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BaseEdge, Position, useReactFlow, useStore } from 'reactflow';

const selectCanvas = state => state.domNode;
const labelContainers = new WeakMap();
function FunctionEdgeLabel({ children }) {
  // React Flow's EdgeLabelRenderer queries the DOM in its store selector on
  // every pan/zoom update, once per edge. Subscribe only to the canvas root.
  const canvas = useStore(selectCanvas);
  const container = useMemo(() => {
    if (!canvas) return null;
    let target = labelContainers.get(canvas);
    if (!target?.isConnected) {
      target = canvas.querySelector('.react-flow__edgelabel-renderer');
      if (target) labelContainers.set(canvas, target);
    }
    return target;
  }, [canvas]);
  return container ? createPortal(children, container) : null;
}

const BRAND = { purple: '#7A37FF', dark: '#0F0F12' };

export const MANUAL_EDGE_ENDPOINT_SPACING = 40;
export const ORTHOGONAL_MIN_BEND_RUN = 56;

function pointForEndpointLead(x, y, position, spacing = MANUAL_EDGE_ENDPOINT_SPACING) {
  if (position === Position.Left) return { x: x - spacing, y };
  if (position === Position.Top) return { x, y: y - spacing };
  if (position === Position.Bottom) return { x, y: y + spacing };
  return { x: x + spacing, y };
}

export function buildManualOrthogonalRoute({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, corridor, routeAxis, sourceSpacing, targetSpacing, sourceOffset, targetOffset } = {}) {
  const source = { x: Number(sourceX) || 0, y: Number(sourceY) || 0 };
  const target = { x: Number(targetX) || 0, y: Number(targetY) || 0 };
  const normalizedSourceSpacing = Math.max(MANUAL_EDGE_ENDPOINT_SPACING, Number(sourceSpacing) || MANUAL_EDGE_ENDPOINT_SPACING);
  const normalizedTargetSpacing = Math.max(MANUAL_EDGE_ENDPOINT_SPACING, Number(targetSpacing) || MANUAL_EDGE_ENDPOINT_SPACING);
  const sourceLead = pointForEndpointLead(source.x, source.y, sourcePosition, normalizedSourceSpacing);
  const targetLead = pointForEndpointLead(target.x, target.y, targetPosition, normalizedTargetSpacing);
  const horizontalDeparture = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const facingHorizontally = (sourcePosition === Position.Right && targetPosition === Position.Left) || (sourcePosition === Position.Left && targetPosition === Position.Right);
  const facingVertically = (sourcePosition === Position.Bottom && targetPosition === Position.Top) || (sourcePosition === Position.Top && targetPosition === Position.Bottom);
  const horizontalLeadOverlap = facingHorizontally && ((sourcePosition === Position.Right && sourceLead.x >= targetLead.x) || (sourcePosition === Position.Left && sourceLead.x <= targetLead.x));
  const verticalLeadOverlap = facingVertically && ((sourcePosition === Position.Bottom && sourceLead.y >= targetLead.y) || (sourcePosition === Position.Top && sourceLead.y <= targetLead.y));
  const horizontalBendRunIsCompact = facingHorizontally && Math.abs(targetLead.x - sourceLead.x) < ORTHOGONAL_MIN_BEND_RUN * 2;
  const verticalBendRunIsCompact = facingVertically && Math.abs(targetLead.y - sourceLead.y) < ORTHOGONAL_MIN_BEND_RUN * 2;
  const detour = horizontalLeadOverlap || verticalLeadOverlap || horizontalBendRunIsCompact || verticalBendRunIsCompact;
  const automaticAxis = detour ? (horizontalDeparture ? 'y' : 'x') : (horizontalDeparture ? 'x' : 'y');
  const axis = ['x', 'y'].includes(routeAxis) ? routeAxis : automaticAxis;
  const detourClearance = MANUAL_EDGE_ENDPOINT_SPACING + ORTHOGONAL_MIN_BEND_RUN;
  const defaultCorridor = axis === 'x'
    ? (detour ? Math.min(sourceLead.x, targetLead.x) - detourClearance : (sourceLead.x + targetLead.x) / 2)
    : (detour ? Math.min(sourceLead.y, targetLead.y) - detourClearance : (sourceLead.y + targetLead.y) / 2);
  const routeCorridor = Number.isFinite(Number(corridor)) ? Number(corridor) : defaultCorridor;
  const normalizedSourceOffset = Number.isFinite(Number(sourceOffset)) ? Number(sourceOffset) : 0;
  const normalizedTargetOffset = Number.isFinite(Number(targetOffset)) ? Number(targetOffset) : 0;
  const rawPoints = axis === 'x'
    ? [
        source,
        sourceLead,
        { x: sourceLead.x, y: sourceLead.y + normalizedSourceOffset },
        { x: routeCorridor, y: sourceLead.y + normalizedSourceOffset },
        { x: routeCorridor, y: targetLead.y + normalizedTargetOffset },
        { x: targetLead.x, y: targetLead.y + normalizedTargetOffset },
        targetLead,
        target,
      ]
    : [
        source,
        sourceLead,
        { x: sourceLead.x + normalizedSourceOffset, y: sourceLead.y },
        { x: sourceLead.x + normalizedSourceOffset, y: routeCorridor },
        { x: targetLead.x + normalizedTargetOffset, y: routeCorridor },
        { x: targetLead.x + normalizedTargetOffset, y: targetLead.y },
        targetLead,
        target,
      ];
  const segmentDefinition = (key, startIndex, endIndex, dragAxis) => ({
    key,
    dragAxis,
    orientation: dragAxis === 'x' ? 'vertical' : 'horizontal',
    point: {
      x: (rawPoints[startIndex].x + rawPoints[endIndex].x) / 2,
      y: (rawPoints[startIndex].y + rawPoints[endIndex].y) / 2,
    },
  });
  const controls = axis === 'x'
    ? [segmentDefinition('sourceOffset', 2, 3, 'y'), segmentDefinition('corridor', 3, 4, 'x'), segmentDefinition('targetOffset', 4, 5, 'y')]
    : [segmentDefinition('sourceOffset', 2, 3, 'x'), segmentDefinition('corridor', 3, 4, 'y'), segmentDefinition('targetOffset', 4, 5, 'x')];
  const points = rawPoints.filter((point, index) => index === 0 || point.x !== rawPoints[index - 1].x || point.y !== rawPoints[index - 1].y);
  return {
    axis,
    corridor: routeCorridor,
    detour,
    sourceSpacing: normalizedSourceSpacing,
    targetSpacing: normalizedTargetSpacing,
    sourceOffset: normalizedSourceOffset,
    targetOffset: normalizedTargetOffset,
    points,
    controls,
  };
}

function orthogonalPath(points = []) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x},${point.y}`).join(' ');
}

export const OrthogonalFunctionEdge = React.memo(function OrthogonalFunctionEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, style, selected, label, data } = props;
  const { getZoom } = useReactFlow();
  const stopDrag = useRef(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const route = buildManualOrthogonalRoute({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    corridor: data?.manualRoute?.corridor,
    routeAxis: data?.manualRoute?.axis,
    // The former adjuster model persisted arbitrarily large endpoint spacing.
    // Draw.io-style segment editing keeps these lead-ins stable, so legacy
    // spacing is intentionally ignored rather than producing off-screen loops.
    sourceSpacing: MANUAL_EDGE_ENDPOINT_SPACING,
    targetSpacing: MANUAL_EDGE_ENDPOINT_SPACING,
    sourceOffset: data?.manualRoute?.sourceOffset,
    targetOffset: data?.manualRoute?.targetOffset,
  });
  const d = orthogonalPath(route.points);
  const stroke = style?.stroke || '#1f2544';
  const width = selected ? 3.5 : 2.5;
  const middlePoint = route.points[Math.floor(route.points.length / 2)] || { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  const routeControls = (route.controls || []).map((control) => ({
    ...control,
    cursor: control.dragAxis === 'x' ? 'ew-resize' : 'ns-resize',
  }));
  const startRouteDrag = (event, control = 'corridor') => {
    event.preventDefault();
    event.stopPropagation();
    stopDrag.current?.();
    const routeControl = routeControls.find((candidate) => candidate.key === control);
    if (!routeControl) return;
    const dragAxis = routeControl.dragAxis;
    const initialClient = dragAxis === 'x' ? event.clientX : event.clientY;
    const initialValue = Number(route[control]) || 0;
    if (data?.onRouteChange) data.onRouteStart?.();
    else window.dispatchEvent(new CustomEvent('xhandle:manual-edge-route-start', { detail: { routingTargetKey: data?.routingTargetKey } }));
    const move = (moveEvent) => {
      const currentClient = dragAxis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      const delta = (currentClient - initialClient) / Math.max(0.1, getZoom?.() || 1);
      const value = initialValue + delta;
      const routePatch = { model: 'segment-v2', axis: route.axis, [control]: value };
      if (data?.onRouteChange) data.onRouteChange(data.routingTargetKey, routePatch);
      else window.dispatchEvent(new CustomEvent('xhandle:manual-edge-route-change', {
        detail: { routingTargetKey: data?.routingTargetKey, routePatch },
      }));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stopDrag.current = null;
    };
    stopDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  return (
    <>
      <BaseEdge
        id={id}
        path={d}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{ ...style, stroke, strokeWidth: width }}
      />
      {(selected || data?.isHighlighted) && !data?.readOnly ? routeControls.map((control) => (
        <circle
          key={control.key}
          className="nodrag nopan"
          cx={control.point.x}
          cy={control.point.y}
          r={7}
          fill="#fff"
          stroke={BRAND.purple}
          strokeWidth={2}
          role="button"
          tabIndex={0}
          aria-label={`Adjust selected edge ${control.key}`}
          onPointerDown={(event) => startRouteDrag(event, control.key)}
          style={{ cursor: control.cursor, pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(15,15,18,0.25))' }}
        >
          <title>{control.orientation === 'vertical' ? 'Drag left or right to reposition this vertical segment' : 'Drag up or down to reposition this horizontal segment'}</title>
        </circle>
      )) : null}
      <FunctionEdgeLabel>
        {label ? <div className="nodrag nopan" style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${middlePoint.x}px,${middlePoint.y - 14}px)`, fontSize: 11, color: BRAND.dark, background: 'rgba(255,255,255,0.9)', padding: '2px 5px', borderRadius: 4, pointerEvents: 'none' }}>{label}</div> : null}
      </FunctionEdgeLabel>
    </>
  );
});
