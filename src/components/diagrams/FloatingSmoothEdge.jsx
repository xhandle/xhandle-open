/**
 * xHandle: floating smooth edge diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

import React, { useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from 'reactflow';

// Compute intersection between a node's rectangle and a line to a point
function getNodeIntersection(nodeRect, point) {
  const cx = nodeRect.x + nodeRect.w / 2;
  const cy = nodeRect.y + nodeRect.h / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;

  // scale so that either |dx| -> half width or |dy| -> half height
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const scale = Math.max(absDx / (nodeRect.w / 2), absDy / (nodeRect.h / 2)) || 1;

  return { x: cx + dx / scale, y: cy + dy / scale };
}

/**
 * nodeRect renders a diagram-focused React component. It gives users access to interactive diagram inspection and editing while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param node Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function nodeRect(node) {
  const w = (node.measured?.width ?? node.width ?? 240);
  const h = (node.measured?.height ?? node.height ?? 96);
  const x = (node.positionAbsolute?.x ?? node.position.x);
  const y = (node.positionAbsolute?.y ?? node.position.y);
  return { x, y, w, h };
}

export default function FloatingSmoothEdge(props) {
  const {
    id, source, target, label, markerEnd, style,
    sourceX, sourceY, targetX, targetY,
  } = props;

  const { getNode } = useReactFlow();

  const { path, labelX, labelY } = useMemo(() => {
    const sNode = getNode(source);
    const tNode = getNode(target);

    if (!sNode || !tNode) {
      const [fallbackPath, lx, ly] = getSmoothStepPath({
        sourceX, sourceY, targetX, targetY,
      });
      return { path: fallbackPath, labelX: lx, labelY: ly };
    }

    const sRect = nodeRect(sNode);
    const tRect = nodeRect(tNode);

    // Use the other node’s center as the “aim point”
    const sAim = { x: tRect.x + tRect.w / 2, y: tRect.y + tRect.h / 2 };
    const tAim = { x: sRect.x + sRect.w / 2, y: sRect.y + sRect.h / 2 };

    const sI = getNodeIntersection(sRect, sAim);
    const tI = getNodeIntersection(tRect, tAim);

    const [edgePath, lx, ly] = getSmoothStepPath({
      sourceX: sI.x, sourceY: sI.y,
      targetX: tI.x, targetY: tI.y,
      // letting RF compute source/targetPosition from geometry works fine
      borderRadius: 16,
    });

    return { path: edgePath, labelX: lx, labelY: ly };
  }, [source, target, sourceX, sourceY, targetX, targetY, getNode]);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
