import React from 'react';

// React Flow 11 rebuilds marker IDs from every marker object on each viewport
// store notification. Resolve our built-in markers once per edge revision and
// pass string references; keep the authoritative edges/export data unchanged.
export function compileArchitectureMarkers(edges, prefix) {
  const definitions = [], ids = new Map();
  const reference = marker => {
    if (!marker || typeof marker !== 'object' || !['arrow', 'arrowclosed'].includes(marker.type) || typeof marker.color !== 'string') return marker;
    const key = JSON.stringify(Object.keys(marker).sort().map(key => [key, marker[key]]));
    if (!ids.has(key)) {
      const id = `${prefix}-${definitions.length}`;
      ids.set(key, id); definitions.push({ ...marker, id });
    }
    return ids.get(key);
  };
  return { edges: edges.map(edge => ({ ...edge, markerStart: reference(edge.markerStart), markerEnd: reference(edge.markerEnd) })), definitions };
}

export const ArchitectureMarkers = React.memo(function ArchitectureMarkers({ definitions }) {
  if (!definitions.length) return null;
  return <svg data-architecture-markers="" aria-hidden="true" width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}><defs>
    {definitions.map(({ id, type, color, width = 12.5, height = 12.5, markerUnits = 'strokeWidth', strokeWidth, orient = 'auto-start-reverse' }) => <marker key={id} id={id} className="react-flow__arrowhead" markerWidth={width} markerHeight={height} viewBox="-10 -10 20 20" markerUnits={markerUnits} orient={orient} refX="0" refY="0">
      <polyline style={{ stroke: color, fill: type === 'arrowclosed' ? color : 'none', strokeWidth }} strokeLinecap="round" strokeLinejoin="round" points={type === 'arrowclosed' ? '-5,-4 0,0 -5,4 -5,-4' : '-5,-4 0,0 -5,4'} />
    </marker>)}
  </defs></svg>;
});
