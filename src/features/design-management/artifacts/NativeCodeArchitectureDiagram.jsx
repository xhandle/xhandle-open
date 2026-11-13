import React, { forwardRef, useRef } from 'react';
import NativeArchitectureDiagram from './NativeArchitectureDiagram';
import { codeArchitectureCanvas } from './codeArchitectureCanvas';

export default forwardRef(function NativeCodeArchitectureDiagram({ diagram, focusId, onSelect, ...props }, ref) {
  // Metadata refreshes must not recreate private storage or reset the user's view.
  const cache = useRef(null);
  const identity = diagram.diagramHash ? `${diagram.id}:${diagram.diagramHash}` : diagram;
  if (cache.current?.identity !== identity) cache.current = { identity, ...codeArchitectureCanvas(diagram) };
  const adapted = cache.current;
  const edge = diagram.snapshot.edges.find(item => item.id === focusId);
  const focus = adapted.sourceNodes.get(focusId) || edge?.relationships?.[0]?.id || focusId;
  return <NativeArchitectureDiagram key={diagram.diagramHash || diagram.id} ref={ref} diagram={adapted.diagram}
    focusId={focus} onSelect={id => onSelect?.(adapted.nodeSources.get(id) || id)} {...props} />;
});
