/**
 * xHandle: astar orthogonal edge diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

import React, { useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useReactFlow } from 'reactflow';
import PF from 'pathfinding';

/**
 * Tunables
 * - GRID_SIZE: smaller = finer routing (slower), larger = coarser (faster)
 * - PADDING: how far to keep routes from node skins
 * - SAFETY_GAP: pulls path off the handle so first segment doesn't clip node
 */
const GRID_SIZE = 16;
const PADDING   = 28;
const SAFETY_GAP = 10;

// Fallback sizes that match your node theme (240x96); used if RF hasn't measured yet
const FALLBACK_NODE_W = 240;
const FALLBACK_NODE_H = 96;

/**
 * rectToGridCells renders a diagram-focused React component. It gives users access to interactive diagram inspection and editing while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param rect Input consumed by this step of the xHandle workflow.
 * @param toLocal Input consumed by this step of the xHandle workflow.
 * @param gridSize Input consumed by this step of the xHandle workflow.
 * @param pad Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function rectToGridCells(rect, toLocal, gridSize, pad = 0) {
  const r = {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
  };
  const { x: lx, y: ly } = toLocal({ x: r.x, y: r.y });
  const { x: rx, y: ry } = toLocal({ x: r.x + r.w, y: r.y + r.h });
  const c0 = Math.floor(lx / gridSize);
  const r0 = Math.floor(ly / gridSize);
  const c1 = Math.ceil(rx / gridSize);
  const r1 = Math.ceil(ry / gridSize);
  const cells = [];
  for (let rI = r0; rI < r1; rI++) {
    for (let cI = c0; cI < c1; cI++) {
      cells.push([cI, rI]);
    }
  }
  return cells;
}

/**
 * pointsToPath renders a diagram-focused React component. It gives users access to interactive diagram inspection and editing while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param points Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function pointsToPath(points) {
  if (!points.length) return '';
  const [first, ...rest] = points;
  return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ');
}

/**
 * nearestFree renders a diagram-focused React component. It gives users access to interactive diagram inspection and editing while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param grid Input consumed by this step of the xHandle workflow.
 * @param c Input consumed by this step of the xHandle workflow.
 * @param r Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function nearestFree(grid, c, r) {
  if (grid.isWalkableAt(c, r)) return [c, r];
  const maxRing = 12;
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let i = -ring; i <= ring; i++) {
      const candidates = [
        [c + i, r - ring],
        [c + i, r + ring],
        [c - ring, r + i],
        [c + ring, r + i],
      ];
      for (const [cc, rr] of candidates) {
        if (cc >= 0 && rr >= 0 && cc < grid.width && rr < grid.height && grid.isWalkableAt(cc, rr)) {
          return [cc, rr];
        }
      }
    }
  }
  return [c, r];
}

export default function AStarOrthogonalEdge(props) {
  const {
    id,
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition, targetPosition,
    style,
    markerEnd,
    label,
  } = props;

  const { getNodes } = useReactFlow();

  const d = useMemo(() => {
    // 1) Build routing bounds that include ALL nodes (so the grid "sees" every obstacle)
    const margin = 240;

    const nodes = getNodes();

    let minX = Math.min(sourceX, targetX);
    let minY = Math.min(sourceY, targetY);
    let maxX = Math.max(sourceX, targetX);
    let maxY = Math.max(sourceY, targetY);

    nodes.forEach((n) => {
      const w = (n.measured?.width ?? n.width ?? FALLBACK_NODE_W);
      const h = (n.measured?.height ?? n.height ?? FALLBACK_NODE_H);
      const x = (n.positionAbsolute?.x ?? n.position.x);
      const y = (n.positionAbsolute?.y ?? n.position.y);
      minX = Math.min(minX, x - PADDING);
      minY = Math.min(minY, y - PADDING);
      maxX = Math.max(maxX, x + w + PADDING);
      maxY = Math.max(maxY, y + h + PADDING);
    });

    minX -= margin; minY -= margin;
    maxX += margin; maxY += margin;

    const cols = Math.max(2, Math.ceil((maxX - minX) / GRID_SIZE));
    const rows = Math.max(2, Math.ceil((maxY - minY) / GRID_SIZE));

    const toLocal = ({ x, y }) => ({ x: x - minX, y: y - minY });

    // 2) Create grid and mark obstacles from node bounding boxes (+padding)
    const grid = new PF.Grid(cols, rows);
    nodes.forEach((n) => {
      const rect = {
        x: n.positionAbsolute?.x ?? n.position.x,
        y: n.positionAbsolute?.y ?? n.position.y,
        width: (n.measured?.width ?? n.width ?? FALLBACK_NODE_W),
        height: (n.measured?.height ?? n.height ?? FALLBACK_NODE_H),
      };
      rectToGridCells(rect, toLocal, GRID_SIZE, PADDING).forEach(([c, r]) => {
        if (c >= 0 && r >= 0 && c < cols && r < rows) grid.setWalkableAt(c, r, false);
      });
    });

    // 3) Compute start / end grid cells with a slight inset from the handle side
    const inset = (x, y, side) => {
      switch (side) {
        case 'left':   return { x: x - SAFETY_GAP, y };
        case 'right':  return { x: x + SAFETY_GAP, y };
        case 'top':    return { x, y: y - SAFETY_GAP };
        case 'bottom': return { x, y: y + SAFETY_GAP };
        default:       return { x, y };
      }
    };

    const sAbs = inset(sourceX, sourceY, sourcePosition);
    const tAbs = inset(targetX, targetY, targetPosition);

    const sLoc = toLocal(sAbs);
    const tLoc = toLocal(tAbs);

    const sC = Math.max(0, Math.min(cols - 1, Math.round(sLoc.x / GRID_SIZE)));
    const sR = Math.max(0, Math.min(rows - 1, Math.round(sLoc.y / GRID_SIZE)));
    const tC = Math.max(0, Math.min(cols - 1, Math.round(tLoc.x / GRID_SIZE)));
    const tR = Math.max(0, Math.min(rows - 1, Math.round(tLoc.y / GRID_SIZE)));

    // 4) Nudge start/end to nearest free cell (don't punch holes in obstacles)
    let [sCol, sRow] = nearestFree(grid, sC, sR);
    let [tCol, tRow] = nearestFree(grid, tC, tR);

    // 5) A* with Manhattan movement (orthogonal)
    const finder = new PF.AStarFinder({
      allowDiagonal: false,
      heuristic: PF.Heuristic.manhattan,
      dontCrossCorners: true,
    });
    const rawPath = finder.findPath(sCol, sRow, tCol, tRow, grid);

    // 6) Convert grid cells -> pixel points (center of cells), add back minX/minY
    let pts = rawPath.map(([c, r]) => [
      minX + c * GRID_SIZE + GRID_SIZE / 2,
      minY + r * GRID_SIZE + GRID_SIZE / 2,
    ]);

    // 7) Simplify collinear segments for a cleaner polyline
    const simplify = (arr) => {
      if (arr.length <= 2) return arr;
      const out = [arr[0]];
      for (let i = 1; i < arr.length - 1; i++) {
        const [x0, y0] = out[out.length - 1];
        const [x1, y1] = arr[i];
        const [x2, y2] = arr[i + 1];
        const collinear = (x0 === x1 && x1 === x2) || (y0 === y1 && y1 === y2);
        if (!collinear) out.push(arr[i]);
      }
      out.push(arr[arr.length - 1]);
      return out;
    };
    pts = simplify(pts);

    // 8) If A* fails, fall back to straight
    if (pts.length < 2) {
      const [fallback] = getStraightPath({ sourceX, sourceY, targetX, targetY });
      return fallback;
    }

    // 9) Build SVG path
    return pointsToPath(pts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, getNodes]);

  return (
    <>
      <BaseEdge id={id} path={d} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%)`,
              pointerEvents: 'all',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
