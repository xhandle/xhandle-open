/* eslint-disable react-hooks/exhaustive-deps */
/**
 * xHandle: lite summary diagram react flow diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

// LiteSummaryDiagramReactFlow.js — xHandle look, NO AUTO LAYOUT + ONE-TIME CLEAN & SPREAD
// - Positions persist across unmounts
// - One-time overlap removal + viewport spread after prompt via `cleanOnceKey` prop or `ref.cleanOnce()`
// - Renaming a node preserves its position; label/desc edits do NOT trigger layout

import React, {
  useMemo,
  useCallback,
  useEffect,
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import ReactFlow, {
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  updateEdge,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import ELK from 'elkjs/lib/elk.bundled.js';
import { downloadDrawioXml } from '../utils/exportDrawio';

/* ================================
 * Brand & Theme
 * ================================ */
const BRAND = {
  blue: '#2D7DFE',
  purple: '#7A37FF',
  light: '#ECEEFF',
  dark: '#0F0F12',
};

const THEME = {
  radius: 14,
  node: {
    w: 240,
    h: 96,
    pad: 12,
    shadow: '0 6px 20px rgba(24, 29, 54, 0.10)',
    borderAlpha: 0.35,
    titleSize: 14,
  },
  edge: {
    width: 2.5,
    hoverWidth: 3.5,
    opacity: 0.92,
    hoverOpacity: 1,
  },
  canvas: {
    padX: 80,
    padY: 60,
    minZoom: 0.1,
    maxZoom: 1.8,
  },
};

// Arrow size knob (in px)
const ARROW_SIZE = 18;

/* ================================
 * Utilities
 * ================================ */
const rgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/* ================================
 * Occupied spots from existing edges
 * ================================ */
function getOccupiedSpotsFromEdges(edges) {
  const occ = new Set();
  edges.forEach((e) => {
    const s = parseHandleId(e.sourceHandle);
    const t = parseHandleId(e.targetHandle);
    if (s) occ.add(spotKey(e.source, s.side, s.idx));
    if (t) occ.add(spotKey(e.target, t.side, t.idx));
  });
  return occ;
}

/* ================================
 * Prevent overlapping node placement
 * ================================ */
const GRID = 16;
const GAP = 24;

/**
 * snap encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const snap = (v) => Math.round(v / GRID) * GRID;

/**
 * isOverlapping encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param a Input consumed by this step of the xHandle workflow.
 * @param b Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function isOverlapping(a, b) {
  const w = THEME.node.w, h = THEME.node.h;
  return (
    Math.abs((a.x + w / 2) - (b.x + w / 2)) < (w + GAP) / 2 &&
    Math.abs((a.y + h / 2) - (b.y + h / 2)) < (h + GAP) / 2
  );
}

/**
 * nearestFreePosition encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param x Input consumed by this step of the xHandle workflow.
 * @param y Input consumed by this step of the xHandle workflow.
 * @param existing Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function nearestFreePosition({ x, y }, existing) {
  let r = 0, step = GRID;
  const maxRings = 50;
  const base = { x: snap(x), y: snap(y) };
  const taken = existing.map((n) => ({ x: n.position.x, y: n.position.y }));
  if (!taken.some((p) => isOverlapping(p, base))) return base;
  for (let ring = 1; ring <= maxRings; ring++) {
    r += step;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [dx, dy] of dirs) {
      const candidate = { x: snap(base.x + dx * r), y: snap(base.y + dy * r) };
      if (!taken.some((p) => isOverlapping(p, candidate))) return candidate;
    }
  }
  return base;
}

/* ================================
 * Nudge node if it overlaps after drag
 * ================================ */
function nudgeIfOverlapping(movedId, nodes, setNodes) {
  setNodes((nds) => {
    const me = nds.find((n) => n.id === movedId);
    if (!me) return nds;
    let pos = { ...me.position };
    const others = nds.filter((n) => n.id !== movedId);
    let tries = 0;
    while (others.some((o) => isOverlapping(pos, o.position)) && tries < 60) {
      pos.x = snap(pos.x + (tries % 2 ? GRID : 0));
      pos.y = snap(pos.y + (tries % 2 ? 0 : GRID));
      tries++;
    }
    return nds.map((n) => (n.id === movedId ? { ...n, position: pos } : n));
  });
}

/* ================================
 * ELK one-time layout helpers
 * ================================ */
const elk = new ELK();
const ELK_DEFAULTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '200',
  'elk.layered.spacing.nodeNodeBetweenLayers': '300',
  'elk.padding': '[top=40,left=60,bottom=40,right=60]',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.edgeRouting': 'ORTHOGONAL',
};

/**
 * toElkGraph encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param nodes Diagram node collection for the current view.
 * @param edges Diagram edge collection for the current view.
 * @returns diagram data or layout state for rendering.
 */
function toElkGraph({ nodes, edges }) {
  return {
    id: 'root',
    layoutOptions: ELK_DEFAULTS,
    children: nodes.map((n) => ({
      id: n.id,
      width: THEME.node.w,
      height: THEME.node.h,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };
}

/**
 * runElkLayoutOnce executes one step of the diagram-rendering workflow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param nodes Diagram node collection for the current view.
 * @param edges Diagram edge collection for the current view.
 * @returns Promise resolving to diagram data or layout state for rendering.
 */
async function runElkLayoutOnce({ nodes, edges }) {
  if (!nodes.length) return nodes;
  const graph = toElkGraph({ nodes, edges });
  const laidOut = await elk.layout(graph);
  const posById = new Map(
    laidOut.children.map((c) => [c.id, { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }])
  );
  return nodes.map((n) => ({
    ...n,
    position: posById.get(n.id) ?? n.position,
  }));
}

/* ===== Persisted positions helpers (localStorage) ===== */
function loadPositions(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    return new Map(Array.isArray(arr) ? arr : []);
  } catch {
    return new Map();
  }
}
/**
 * savePositions writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param storageKey Input consumed by this step of the xHandle workflow.
 * @param posMap Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
function savePositions(storageKey, posMap) {
  try {
    const arr = Array.from(posMap.entries());
    localStorage.setItem(storageKey, JSON.stringify(arr));
  } catch {}
}

/* ================================
 * Unique label helpers
 * ================================ */
function collectExistingLabels(nodes, rows) {
  const s = new Set();
  nodes.forEach((n) => s.add(n?.data?.label ?? ''));
  rows.forEach((r) => {
    if (r.fromFunction) s.add(r.fromFunction);
    if (r.toFunction) s.add(r.toFunction);
  });
  return s;
}

/**
 * makeUniqueNewLabel encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param existingLabels Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function makeUniqueNewLabel(existingLabels) {
  const prefix = 'new: ';
  let max = 0;
  for (const lab of existingLabels) {
    if (typeof lab === 'string' && lab.startsWith(prefix)) {
      const n = Number(lab.slice(prefix.length).trim());
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return `${prefix}${max + 1 || 1}`;
}

/* ================================
 * Node (clean, branded)
 * ================================ */
const portBase = {
  width: 10,
  height: 10,
  background: 'rgba(128, 128, 128, 0.3)',
  border: '1px solid rgba(128, 128, 128, 0.4)',
  borderRadius: '50%',
  opacity: 0,
  transition: 'opacity 120ms',
};

const TOP_BOTTOM_PCTS = [10, 30, 50, 70, 90]; // 5 handles
const LEFT_RIGHT_PCTS = [20, 50, 80];

/**
 * BidirectionalNode renders a diagram-focused React component. It gives users access to interactive diagram inspection and editing while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param data Structured data payload associated with the current record or node.
 * @param selected Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const BidirectionalNode = ({ data, selected }) => {
  const brandColor = data.brandColor || BRAND.blue;
  const tint = data.brandTint || rgba(brandColor, 0.08);
  const border = `1px solid ${rgba(brandColor, THEME.node.borderAlpha)}`;

  return (
    <div
      style={{
        width: THEME.node.w,
        minHeight: THEME.node.h,
        padding: THEME.node.pad,
        border,
        borderRadius: THEME.radius,
        background: tint,
        boxShadow: selected
          ? `0 0 0 5px ${rgba(brandColor, 0.18)}, ${THEME.node.shadow}`
          : THEME.node.shadow,
        position: 'relative',
        transition: 'box-shadow 150ms ease, border-color 150ms ease, transform 120ms ease',
      }}
      className="x-node"
      onMouseEnter={(e) => e.currentTarget.querySelectorAll('.x-port').forEach((h) => (h.style.opacity = 1))}
      onMouseLeave={(e) => e.currentTarget.querySelectorAll('.x-port').forEach((h) => (h.style.opacity = 0))}
    >
      {/* TOP (5) */}
      {TOP_BOTTOM_PCTS.map((p, i) => (
        <React.Fragment key={`top-${i}`}>
          <Handle className="x-port" type="target" position={Position.Top} id={`top-target-${i}`} style={{ ...portBase, left: `${p}%` }} />
          <Handle className="x-port" type="source" position={Position.Top} id={`top-source-${i}`} style={{ ...portBase, left: `${p}%` }} />
        </React.Fragment>
      ))}

      {/* BOTTOM (5) */}
      {TOP_BOTTOM_PCTS.map((p, i) => (
        <React.Fragment key={`bottom-${i}`}>
          <Handle className="x-port" type="target" position={Position.Bottom} id={`bottom-target-${i}`} style={{ ...portBase, left: `${p}%` }} />
          <Handle className="x-port" type="source" position={Position.Bottom} id={`bottom-source-${i}`} style={{ ...portBase, left: `${p}%` }} />
        </React.Fragment>
      ))}

      {/* LEFT (3) */}
      {LEFT_RIGHT_PCTS.map((p, i) => (
        <React.Fragment key={`left-${i}`}>
          <Handle className="x-port" type="target" position={Position.Left} id={`left-target-${i}`} style={{ ...portBase, top: `${p}%` }} />
          <Handle className="x-port" type="source" position={Position.Left} id={`left-source-${i}`} style={{ ...portBase, top: `${p}%` }} />
        </React.Fragment>
      ))}

      {/* RIGHT (3) */}
      {LEFT_RIGHT_PCTS.map((p, i) => (
        <React.Fragment key={`right-${i}`}>
          <Handle className="x-port" type="target" position={Position.Right} id={`right-target-${i}`} style={{ ...portBase, top: `${p}%` }} />
          <Handle className="x-port" type="source" position={Position.Right} id={`right-source-${i}`} style={{ ...portBase, top: `${p}%` }} />
        </React.Fragment>
      ))}

      {/* Title */}
      <div
        style={{
          fontWeight: 700,
          fontSize: THEME.node.titleSize,
          color: BRAND.dark,
          textAlign: 'center',
          lineHeight: 1.2,
          wordBreak: 'break-word',
          minHeight: THEME.node.h - THEME.node.pad * 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4,
        }}
      >
        {data.label}
      </div>
    </div>
  );
};

/* ================================
 * Handle assignment (use all 4 sides)
 * ================================ */
function handleAnchorsForNode(kind /* 'source' | 'target' */) {
  const W = THEME.node.w;
  const H = THEME.node.h;
  const anchors = [];
  TOP_BOTTOM_PCTS.forEach((p, i) => {
    const x = (p / 100) * W;
    anchors.push({ id: `top-${kind}-${i}`, side: 'top', x, y: 0, idx: i });
    anchors.push({ id: `bottom-${kind}-${i}`, side: 'bottom', x, y: H, idx: i });
  });
  LEFT_RIGHT_PCTS.forEach((p, i) => {
    const y = (p / 100) * H;
    anchors.push({ id: `left-${kind}-${i}`, side: 'left', x: 0, y, idx: i });
    anchors.push({ id: `right-${kind}-${i}`, side: 'right', x: THEME.node.w, y, idx: i });
  });
  return anchors;
}
/**
 * spotKey encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param nodeId Stable identifier for the entity this step works with.
 * @param side Input consumed by this step of the xHandle workflow.
 * @param idx Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const spotKey = (nodeId, side, idx) => `${nodeId}:${side}:${idx}`;
/**
 * parseHandleId encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param handleId Stable identifier for the entity this step works with.
 * @returns diagram data or layout state for rendering.
 */
function parseHandleId(handleId) {
  const m = /^(top|bottom|left|right)-(?:source|target)-(\d+)$/.exec(handleId || '');
  if (!m) return null;
  return { side: m[1], idx: Number(m[2]) };
}
/**
 * sideSlotCount encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param side Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const sideSlotCount = (side) =>
  (side === 'top' || side === 'bottom') ? TOP_BOTTOM_PCTS.length : LEFT_RIGHT_PCTS.length;
/**
 * middleIdxForSide encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param side Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const middleIdxForSide = (side) => Math.floor(sideSlotCount(side) / 2);

// centered order: [mid, mid-1, mid+1, mid-2, mid+2, ...]
function centeredIndexOrder(side) {
  const mid = middleIdxForSide(side);
  const count = sideSlotCount(side);
  const seq = [mid];
  for (let o = 1; o < count; o++) {
    if (mid - o >= 0) seq.push(mid - o);
    if (mid + o < count) seq.push(mid + o);
  }
  return seq;
}

// get anchor x,y in node-local coords for a given side+idx
function anchorXY(side, idx) {
  if (side === 'left')  return { x: 0, y: (LEFT_RIGHT_PCTS[idx] / 100) * THEME.node.h };
  if (side === 'right') return { x: THEME.node.w, y: (LEFT_RIGHT_PCTS[idx] / 100) * THEME.node.h };
  if (side === 'top')   return { x: (TOP_BOTTOM_PCTS[idx] / 100) * THEME.node.w, y: 0 };
  // bottom
  return { x: (TOP_BOTTOM_PCTS[idx] / 100) * THEME.node.w, y: THEME.node.h };
}

/**
 * assignHandles encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param fromId Stable identifier for the entity this step works with.
 * @param toId Stable identifier for the entity this step works with.
 * @param positions Input consumed by this step of the xHandle workflow.
 * @param occupiedSpots Input consumed by this step of the xHandle workflow.
 * @param _edgeLabel Input consumed by this step of the xHandle workflow.
 * @param edgeIndex Input consumed by this step of the xHandle workflow.
 * @param pairIdx Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function assignHandles(fromId, toId, positions, occupiedSpots, _edgeLabel, edgeIndex = 0, pairIdx = 0) {
  const from = positions.get(fromId);
  const to = positions.get(toId);
  if (!from || !to) return ['right-source-0', 'left-target-0'];

  // 1) Rank side-pairs by middle-to-middle distance
  const sides = ['top', 'right', 'bottom', 'left'];
  const sidePairs = [];
  for (const sSide of sides) {
    const sMid = middleIdxForSide(sSide);
    const sPt = anchorXY(sSide, sMid);
    const sAbs = { x: from.x + sPt.x, y: from.y + sPt.y };

    for (const tSide of sides) {
      const tMid = middleIdxForSide(tSide);
      const tPt = anchorXY(tSide, tMid);
      const tAbs = { x: to.x + tPt.x, y: to.y + tPt.y };
      const dx = tAbs.x - sAbs.x;
      const dy = tAbs.y - sAbs.y;
      sidePairs.push({ sSide, tSide, d2: dx * dx + dy * dy });
    }
  }
  sidePairs.sort((a, b) => a.d2 - b.d2);

  // 2) For each side-pair (closest first), try the middle then expand outward
  for (const { sSide, tSide } of sidePairs) {
    const sOrder = centeredIndexOrder(sSide);
    const tOrder = centeredIndexOrder(tSide);

    // spread parallel edges: skip first N centered options
    const sSeq = sOrder.slice(Math.min(pairIdx, sOrder.length));
    const tSeq = tOrder.slice(Math.min(pairIdx, tOrder.length));

    // If slice made them empty (rare), fall back to full order
    const sTrySeq = sSeq.length ? sSeq : sOrder;
    const tTrySeq = tSeq.length ? tSeq : tOrder;

    for (const si of sTrySeq) {
      const sSpot = spotKey(fromId, sSide, si);
      if (occupiedSpots.has(sSpot)) continue;

      for (const ti of tTrySeq) {
        const tSpot = spotKey(toId, tSide, ti);
        if (occupiedSpots.has(tSpot)) continue;

        // Found closest-to-middle available pair on the closest side-pair
        return [`${sSide}-source-${si}`, `${tSide}-target-${ti}`];
      }
    }
  }

  // 3) Fallback: if everything above is occupied, revert to shortest distance among free handles
  const srcAnchors = handleAnchorsForNode('source');
  const tgtAnchors = handleAnchorsForNode('target');
  let best = null;

  for (let i = 0; i < srcAnchors.length; i++) {
    const sa = srcAnchors[i];
    const sSpot = spotKey(fromId, sa.side, sa.idx);
    if (occupiedSpots.has(sSpot)) continue;
    const sAbsX = from.x + sa.x, sAbsY = from.y + sa.y;

    for (let j = 0; j < tgtAnchors.length; j++) {
      const ta = tgtAnchors[j];
      const tSpot = spotKey(toId, ta.side, ta.idx);
      if (occupiedSpots.has(tSpot)) continue;
      const tAbsX = to.x + ta.x, tAbsY = to.y + ta.y;
      const dx = tAbsX - sAbsX, dy = tAbsY - sAbsY;
      const d2 = dx * dx + dy * dy;

      if (
        best === null ||
        d2 < best.d2 ||
        (d2 === best.d2 && ((i + j + edgeIndex) % 2) === 0)
      ) {
        best = { sSide: sa.side, sIdx: sa.idx, tSide: ta.side, tIdx: ta.idx, d2 };
      }
    }
  }

  if (!best) return ['right-source-0', 'left-target-0'];
  return [`${best.sSide}-source-${best.sIdx}`, `${best.tSide}-target-${best.tIdx}`];
}


/* ================================
 * Edge building (no layout dependency)
 * ================================ */
function buildEdgesFromRaw(rawEdges, positions) {
  const occupiedSpots = new Set();
  const pairSeq = new Map();
  return rawEdges.map((e, i) => {
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    const pairIdx = pairSeq.get(key) || 0;
    pairSeq.set(key, pairIdx + 1);

    const [sourceHandle, targetHandle] = assignHandles(
      e.source,
      e.target,
      positions,
      occupiedSpots,
      e.label || '',
      i,
      pairIdx
    );

    const sParsed = parseHandleId(sourceHandle);
    const tParsed = parseHandleId(targetHandle);
    if (sParsed) occupiedSpots.add(spotKey(e.source, sParsed.side, sParsed.idx));
    if (tParsed) occupiedSpots.add(spotKey(e.target, tParsed.side, tParsed.idx));

    const stroke = BRAND.blue;
    return {
      ...e,
      type: 'smartBezier',
      sourceHandle,
      targetHandle,
      style: { stroke, strokeWidth: 3 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: ARROW_SIZE, height: ARROW_SIZE },
    };
  });
}

/**
 * rowsToRawEdges encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param rows Worksheet or table rows that this step transforms.
 * @returns diagram data or layout state for rendering.
 */
function rowsToRawEdges(rows) {
  const raw = [];
  rows.forEach((row, idx) => {
    if (!row.toFunction) return;
    const fromId = `n:${row.fromFunction}`;
    const toId = `n:${row.toFunction}`;
    raw.push({
      id: `e:${fromId}->${toId}-${idx}`,
      source: fromId,
      target: toId,
      animated: false,
      type: 'smartBezier',
      style: { stroke: BRAND.dark },
      updatable: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
      label: row.controlAction,
      data: { offsetIndex: 0, description: row.controlDetails || '' },
    });
  });
  return raw;
}

/* ================================
 * Seed position for new nodes only (not a layout)
 * ================================ */
function seedPosition(index = 0) {
  const baseX = 120;
  const baseY = 120;
  const stepX = THEME.node.w + 60; // Node width + gap
  const stepY = THEME.node.h + 40; // Node height + gap
  const cols = 4; // Number of columns before wrapping
  
  const col = index % cols;
  const row = Math.floor(index / cols);
  
  return { 
    x: baseX + col * stepX, 
    y: baseY + row * stepY 
  };
}

/* ================================
 * Structure signature
 * ================================ */
function structureSignature(rows) {
  const nodes = new Set();
  const edgeCounts = new Map();
  rows.forEach((r) => {
    const fromId = `n:${r.fromFunction}`;
    nodes.add(fromId);
    if (r.toFunction) {
      const toId = `n:${r.toFunction}`;
      nodes.add(toId);
      const key = `${fromId}->${toId}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  });
  const nodePart = [...nodes].sort().join('|');
  const edgePart = [...edgeCounts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, c]) => `${k}:${c}`)
    .join('|');
  return `${nodePart}::${edgePart}`;
}

/* ================================
 * Component
 * ================================ */
const DiagramBody = forwardRef(function DiagramBody(
    { rows = [], onUpdateRows, storageKey = 'diagram:positions:v1', cleanOnceKey = null, onCleanApplied, fitAfterClean = true },
    ref
  ) {
  const nodeTypes = useMemo(() => ({ bidirectional: BidirectionalNode }), []);

  const [nodes, setNodes, reactflowOnNodesChange] = useNodesState([]);
  const [edges, setEdges, reactflowOnEdgesChange] = useEdgesState([]);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState(null);

  const viewNodes = useMemo(() => {
    const active = edges.find((e) => e.id === highlightedEdgeId);
    const actSet = active ? new Set([active?.source, active?.target]) : null;
    return nodes.map((n) => ({
      ...n,
      style: actSet?.has(n.id) ? { ...(n.style || {}), filter: 'drop-shadow(0 0 14px rgba(122,55,255,0.8))' } : n.style,
    }));
  }, [nodes, edges, highlightedEdgeId]);

  const viewEdges = useMemo(
    () =>
      edges.map((e) => {
        const isOn = e.id === highlightedEdgeId;
        return {
          ...e,
          animated: isOn,
          style: {
            ...(e.style || {}),
            stroke: BRAND.blue,
            strokeWidth: isOn ? 4.5 : THEME.edge.width,
            opacity: isOn ? 1 : THEME.edge.opacity,
            filter: isOn ? 'drop-shadow(0 0 6px rgba(45,125,254,0.45))' : undefined,
          },
          markerEnd: e.markerEnd ?? { type: MarkerType.ArrowClosed, color: BRAND.blue, width: ARROW_SIZE, height: ARROW_SIZE },
        };
      }),
    [edges, highlightedEdgeId]
  );

  const diagramHostRef = useRef(null);
  const [editModal, setEditModal] = useState(null);

  // positions map persisted across unmounts
  const posRef = useRef(loadPositions(storageKey));
  const saveTimer = useRef(null);
  const persistSoon = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePositions(storageKey, posRef.current), 120);
  }, [storageKey]);

  const builtOnceRef = useRef(false);
  const structureRef = useRef('');

  // track which clean keys have been applied
  const cleanedKeysRef = useRef(new Set());

  // Track the connect drag start
  const connectStartRef = useRef(null);

  const { fitView, project, getNodes, getEdges } = useReactFlow();

  // Auto-fit when graph is (re)built or changes noticeably
useEffect(() => {
  if (!builtOnceRef.current) return; // wait until first build
  const t = setTimeout(() => {
    try {
      fitView({ padding: 0.2, includeHiddenNodes: true });
    } catch {}
  }, 0);
  return () => clearTimeout(t);
}, [nodes.length, edges.length, fitView]);

// Auto-fit when the host container size changes
useEffect(() => {
  if (!diagramHostRef.current) return;
  const ro = new ResizeObserver(() => {
    setTimeout(() => {
      try {
        fitView({ padding: 0.2, includeHiddenNodes: true });
      } catch {}
    }, 0);
  });
  ro.observe(diagramHostRef.current);
  return () => ro.disconnect();
}, [fitView]);

  /* Node-hover connect (loose) */
  const onConnectStartLoose = useCallback((_, params) => {
    connectStartRef.current = params || null;
  }, []);

  const onConnectEndLoose = useCallback(
    (evt) => {
      const start = connectStartRef.current;
      connectStartRef.current = null;

      const endedOnHandle = evt.target?.closest?.('.react-flow__handle');
      if (endedOnHandle) return;

      const bounds = diagramHostRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const local = { x: evt.clientX - bounds.left, y: evt.clientY - bounds.top };
      const projectedPoint = project(local);
      const nodeWidth = THEME.node.w;
      const nodeHeight = THEME.node.h;
      const targetNode = getNodes().find((node) => {
        const nx = node.position.x;
        const ny = node.position.y;
        return (
          projectedPoint.x >= nx &&
          projectedPoint.x <= nx + nodeWidth &&
          projectedPoint.y >= ny &&
          projectedPoint.y <= ny + nodeHeight
        );
      }) || null;
      if (!targetNode || !start?.nodeId) return;

      const fromId = start.nodeId;
      const toId = targetNode.id;
      if (fromId === toId) return;

      const srcNode = nodes.find((n) => n.id === fromId);
      const tgtNode = nodes.find((n) => n.id === toId);
      if (srcNode?.position) posRef.current.set(fromId, { ...srcNode.position });
      if (tgtNode?.position) posRef.current.set(toId, { ...tgtNode.position });
      persistSoon();

      const occupied = getOccupiedSpotsFromEdges(edges);
      const pairIdxForThisPair =
        edges.filter(
          (e) =>
            (e.source === fromId && e.target === toId) ||
            (e.source === toId && e.target === fromId)
        ).length;

      const [autoSourceHandle, autoTargetHandle] = assignHandles(
        fromId,
        toId,
        posRef.current,
        occupied,
        '',
        edges.length,
        pairIdxForThisPair
      );

      const sourceHandle = start.handleId || autoSourceHandle;
      const targetHandle = autoTargetHandle;

      const newEdge = {
        id: `e:${cryptoId()}`,
        source: fromId,
        target: toId,
        sourceHandle,
        targetHandle,
        animated: false,
        type: 'smartBezier',
        style: { strokeWidth: 3, stroke: BRAND.blue },
        markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
      };

      setEdges((eds) => addEdge(newEdge, eds));

      const fromFunction = fromId.replace(/^n:/, '');
      const toFunction = toId.replace(/^n:/, '');
      onUpdateRows?.([
        ...rows,
        { fromFunction, fromDetails: '', controlAction: '', controlDetails: '', toFunction, toDetails: '' },
      ]);
    },
    [nodes, edges, rows, onUpdateRows, persistSoon, setEdges, project, getNodes]
  );

  useEffect(() => {
    const positions = posRef.current;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      savePositions(storageKey, positions);
    };
  }, [storageKey]);

  // Extra fit when parent flips cleanOnceKey (used after prompt finishes)
useEffect(() => {
  if (!cleanOnceKey) return;
  const t = setTimeout(() => {
    try {
      fitView({ padding: 0.2, includeHiddenNodes: true });
    } catch {}
  }, 120); // small defer lets RF settle labels/edges
  return () => clearTimeout(t);
}, [cleanOnceKey, fitView]);


  const runCleanAndSpread = useCallback(async () => {
    const elkNodes = await runElkLayoutOnce({ nodes, edges });
    setNodes(elkNodes);
    elkNodes.forEach((n) => posRef.current.set(n.id, { ...n.position }));
    persistSoon();
    const rawEdges = rowsToRawEdges(rows);
    setEdges(buildEdgesFromRaw(rawEdges, posRef.current));
    if (fitAfterClean) setTimeout(() => fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true }), 0);
  }, [nodes, edges, rows, fitAfterClean, fitView, persistSoon, setEdges, setNodes]);

  // expose imperative actions to parent
  useImperativeHandle(ref, () => ({
    async exportAsImage() {
      const flowCanvas = diagramHostRef.current?.querySelector('.react-flow');
      if (!flowCanvas) return null;
      return await toPng(flowCanvas, { backgroundColor: '#ffffff', style: { margin: '0 auto', display: 'block' } });
    },
    async getPNG() { return this.exportAsImage(); },
    isReady() { return !!diagramHostRef.current?.querySelector('.react-flow'); },
    cleanOnce() { runCleanAndSpread(); },
    fitViewToDiagram() {
      try { fitView({ padding: 0.2, duration: 400, includeHiddenNodes: true }); } catch {}
    },
        exportDrawio() {
      const n = getNodes();
      const e = getEdges();
      downloadDrawioXml(n, e, 'xHandle-diagram.drawio.xml', {
        pageWidth: 1920,
        pageHeight: 1080,
        nodeSize: { width: 240, height: 96 },
        nodeStyle:
          'rounded=1;whiteSpace=wrap;html=1;strokeColor=#334155;fillColor=#EEF2FF;fontColor=#0F0F12;shadow=0;arcSize=12;spacing=8;',
        edgeStyle:
          'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=#94A3B8;strokeWidth=2;',
      });
    },
  }));

  const onNodesChange = useCallback(
    (changes) => {
      changes.forEach((c) => {
        if (c.type === 'position' && c.id && c.position) {
          posRef.current.set(c.id, { ...c.position });
          persistSoon();
        }
        if (c.type === 'remove' && c.id) {
          posRef.current.delete(c.id);
          persistSoon();
        }
      });

      const deletions = changes.filter((cc) => cc.type === 'remove');
      if (deletions.length > 0) {
        const deletedIds = new Set(deletions.map((cc) => cc.id));
        const updatedRows = rows.filter(
          (r) => !deletedIds.has(`n:${r.fromFunction}`) && !deletedIds.has(`n:${r.toFunction}`)
        );
        onUpdateRows?.(updatedRows);
      }
      reactflowOnNodesChange(changes);
    },
    [rows, reactflowOnNodesChange, onUpdateRows, persistSoon]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      const removals = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removals.length) {
        const removalSet = new Set(removals);
        const updatedRows = rows.filter((r, i) => !removalSet.has(`e:n:${r.fromFunction}->n:${r.toFunction}-${i}`));
        onUpdateRows?.(updatedRows);
      }
      reactflowOnEdgesChange(changes);
    },
    [rows, reactflowOnEdgesChange, onUpdateRows]
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setHighlightedEdgeId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Build when structure changes */
  useEffect(() => {
    let cancelled = false;

    const sig = structureSignature(rows);
    const structureUnchanged = builtOnceRef.current && sig === structureRef.current;
    if (structureUnchanged) return;

    const wantedNodeIds = new Set();
    rows.forEach((row) => {
      wantedNodeIds.add(`n:${row.fromFunction}`);
      if (row.toFunction) wantedNodeIds.add(`n:${row.toFunction}`);
    });

// Convert to array and sort for consistent indexing
const sortedNodeIds = Array.from(wantedNodeIds).sort();
    
const nextNodes = sortedNodeIds.map((id, index) => {
  // Check if we have a saved position
  let pos = posRef.current.get(id);
  
  // If no saved position, create a better spread
  if (!pos) {
    pos = seedPosition(index); // Use the sorted index
    posRef.current.set(id, pos);
    persistSoon();
  }
  
  const existing = nodes.find((n) => n.id === id);
  if (existing) {
    return { ...existing, position: pos };
  }
  
  const name = id.replace(/^n:/, '');
  return {
    id,
    type: 'bidirectional',
    position: pos,
    data: {
      label: name,
      description: '',
      brandColor: BRAND.blue,
      brandTint: rgba(BRAND.blue, 0.08),
    },
  };
});

    const rawEdges = rowsToRawEdges(rows);
    const nextEdges = buildEdgesFromRaw(rawEdges, posRef.current);

    if (!cancelled) {
      setNodes(nextNodes);
      setEdges(nextEdges);
      builtOnceRef.current = true;
      structureRef.current = sig;
      
      // Auto-arrange when loading project data with multiple nodes
// Auto-arrange when loading project data with multiple nodes
if (nextNodes.length > 1) {
  const hasNewNodes = sortedNodeIds.some(id => {
    const savedPos = posRef.current.get(id);
    // Consider it "new" if no saved position OR if it's still at the default seed position
    return !savedPos || (savedPos.x === seedPosition(0).x && savedPos.y === seedPosition(0).y);
  });
  
  if (hasNewNodes) {
    setTimeout(async () => {
      if (!cancelled) {
        // Use the same ELK layout as manual button
        const currentNodes = getNodes();
        const currentEdges = getEdges();
        const elkNodes = await runElkLayoutOnce({ nodes: currentNodes, edges: currentEdges });
        setNodes(elkNodes);
        elkNodes.forEach((n) => posRef.current.set(n.id, { ...n.position }));
        persistSoon();
        const rawEdges = rowsToRawEdges(rows);
        setEdges(buildEdgesFromRaw(rawEdges, posRef.current));
        if (fitAfterClean) {
          setTimeout(() => fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true }), 0);
        }
      }
    }, 200); // Slightly longer delay to ensure React Flow has rendered
  }
}
    }
    return () => { cancelled = true; };
  }, [rows, persistSoon, nodes, setNodes, setEdges, fitAfterClean, fitView, getEdges, getNodes]);
  // Sync labels/details without moving nodes
  useEffect(() => {
    if (!builtOnceRef.current) return;

    const nodeDetails = new Map();
    const edgeDetails = new Map();

    rows.forEach((r, idx) => {
      nodeDetails.set(`n:${r.fromFunction}`, { label: r.fromFunction, description: r.fromDetails || '' });
      if (r.toFunction) {
        nodeDetails.set(`n:${r.toFunction}`, { label: r.toFunction, description: r.toDetails || '' });
        const edgeId = `e:n:${r.fromFunction}->n:${r.toFunction}-${idx}`;
        edgeDetails.set(edgeId, { label: r.controlAction || '', description: r.controlDetails || '' });
      }
    });

    setNodes((nds) =>
      nds.map((n) => (nodeDetails.has(n.id) ? { ...n, data: { ...n.data, ...nodeDetails.get(n.id) } } : n))
    );
    setEdges((eds) =>
      eds.map((e) =>
        edgeDetails.has(e.id)
          ? { ...e, label: edgeDetails.get(e.id).label, data: { ...e.data, description: edgeDetails.get(e.id).description } }
          : e
      )
    );
  }, [rows, setNodes, setEdges]);

  /* One-time clean+spread trigger */
  useEffect(() => {
    if (!cleanOnceKey) return;
    if (cleanedKeysRef.current.has(cleanOnceKey)) return;
    if (!nodes.length) return;

    runCleanAndSpread();
    cleanedKeysRef.current.add(cleanOnceKey);
    // tell parent we consumed the key so it won't fire on remount
    try { onCleanApplied?.(cleanOnceKey); } catch {}
  }, [cleanOnceKey, nodes, onCleanApplied, runCleanAndSpread]);

  /* Connect / Update */
  const onConnect = useCallback(
    (connection) => {
      setEdges((eds) => {
        const newEdge = {
          ...connection,
          animated: false,
          type: 'smartBezier',
          style: { strokeWidth: 3 },
          markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
        };

        const fromFunction = (connection.source || '').replace(/^n:/, '');
        const toFunction = (connection.target || '').replace(/^n:/, '');

        const srcNode = nodes.find((n) => n.id === connection.source);
        const tgtNode = nodes.find((n) => n.id === connection.target);
        const srcBuiltId = `n:${fromFunction}`;
        const tgtBuiltId = `n:${toFunction}`;
        if (srcNode?.position) posRef.current.set(srcBuiltId, { ...srcNode.position });
        if (tgtNode?.position) posRef.current.set(tgtBuiltId, { ...tgtNode.position });
        persistSoon();

        onUpdateRows?.([
          ...rows,
          { fromFunction, fromDetails: '', controlAction: '', controlDetails: '', toFunction, toDetails: '' },
        ]);

        return addEdge(newEdge, eds);
      });
    },
    [setEdges, rows, onUpdateRows, nodes, persistSoon]
  );

  const onEdgeUpdate = useCallback(
    (oldEdge, newConn) => {
      setEdges((eds) =>
        updateEdge(
          oldEdge,
          {
            ...newConn,
            type: 'smartBezier',
            markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  /* Render */
  return (
    <div ref={diagramHostRef} style={{ width: '100%', height: 600, position: 'relative' }}>
      {/* ➕ Add / Arrange / Export */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: 8 }}>
      <button
  onClick={() => {
    const existing = collectExistingLabels(getNodes(), rows);
    const label = makeUniqueNewLabel(existing);        // unique "new: N"
    const rfId = `n:${label}`;
    const position = nearestFreePosition(seedPosition(0), getNodes());
    setNodes((nds) => [
      ...nds,
      {
        id: rfId,
        type: 'bidirectional',
        position,
        data: { label, brandColor: BRAND.purple, brandTint: rgba(BRAND.purple, 0.08) },
      },
    ]);
    posRef.current.set(rfId, position);
    persistSoon();
  }}
  style={{
    background: BRAND.blue,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 12px',
    fontWeight: 700,
    boxShadow: '0 6px 16px rgba(45,125,254,0.18)',
    cursor: 'pointer',
  }}
>
  ➕ Add Node
</button>


        <button
          onClick={runCleanAndSpread}
          style={{
            background: BRAND.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 12px',
            fontWeight: 700,
            boxShadow: '0 6px 16px rgba(45,125,254,0.18)',
            cursor: 'pointer',
          }}
          title="One-time overlap clean + spread to viewport"
        >
          ⚡ Auto Arrange
        </button>

        <button
          onClick={() => {
            const n = getNodes();
            const e = getEdges();
            downloadDrawioXml(n, e, 'xHandle-diagram.drawio.xml', {
              pageWidth: 1920,
              pageHeight: 1080,
              nodeSize: { width: 240, height: 96 },
              nodeStyle:
                'rounded=1;whiteSpace=wrap;html=1;strokeColor=#334155;fillColor=#EEF2FF;fontColor=#0F0F12;shadow=0;arcSize=12;spacing=8;',
              edgeStyle:
                'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=#94A3B8;strokeWidth=2;',
            });
          }}
          style={{
            background: BRAND.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 12px',
            fontWeight: 700,
            boxShadow: '0 6px 16px rgba(45,125,254,0.18)',
            cursor: 'pointer',
          }}
          title="Export to draw.io (.xml)"
        >
          📤 Export .XML
        </button>
      </div>

      {/* 🧠 Canvas */}
      <div
        style={{
          border: `2px solid ${BRAND.blue}`,
          borderRadius: '8px',
          overflow: 'hidden',
          width: '100%',
          height: '100%',
        }}
      >
        <ReactFlow
          nodes={viewNodes}
          edges={viewEdges}
          onInit={(instance) => {
            setTimeout(() => {
              try {
                instance.fitView({ padding: 0.2, includeHiddenNodes: true });
              } catch {}
            }, 0);
          }}
          
          defaultEdgeOptions={{
            type: 'smartBezier',
            markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
          }}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeUpdate={onEdgeUpdate}
          onEdgeClick={(evt, edge) => setHighlightedEdgeId(edge.id)}
          onPaneClick={() => setHighlightedEdgeId(null)}
          onNodeClick={() => setHighlightedEdgeId(null)}
          nodesDraggable
          nodesConnectable
          edgesUpdatable
          connectionMode={ConnectionMode.Loose}
          onConnectStart={onConnectStartLoose}
          onConnectEnd={onConnectEndLoose}
          minZoom={THEME.canvas.minZoom}
          maxZoom={THEME.canvas.maxZoom}
          panOnScroll={false}
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
          onNodeDoubleClick={(event, node) => {
            setEditModal({ type: 'node', id: node.id, label: node.data.label || '', description: node.data.description || '' });
          }}
          onEdgeDoubleClick={(event, edge) => {
            setEditModal({ type: 'edge', id: edge.id, label: edge.label || '', description: edge.data?.description || '' });
          }}
          onDoubleClick={(event) => {
            const isInside = event.target.closest('.react-flow__node, .react-flow__edge, .react-flow__edge-label');
            if (isInside) return;
          
            const bounds = diagramHostRef.current?.getBoundingClientRect();
            const position = nearestFreePosition(
              { x: event.clientX - (bounds?.left || 0), y: event.clientY - (bounds?.top || 0) },
              getNodes()
            );
          
            const existing = collectExistingLabels(getNodes(), rows);
            const label = makeUniqueNewLabel(existing);   // guarantees unique "new: N"
            const rfId = `n:${label}`;
          
            const newNode = {
              id: rfId,
              type: 'bidirectional',
              position,
              data: { label, brandColor: BRAND.purple, brandTint: rgba(BRAND.purple, 0.08) },
            };
          
            setNodes((nds) => [...nds, newNode]);
            posRef.current.set(rfId, newNode.position);
            persistSoon();
          }}           
          onNodeDragStop={(_, node) => {
            if (node?.id && node?.position) {
              posRef.current.set(node.id, { ...node.position });
              persistSoon();
              nudgeIfOverlapping(node.id, nodes, setNodes);
              const raw = rowsToRawEdges(rows);
              setEdges(buildEdgesFromRaw(raw, posRef.current));
            }
          }}
        >
          <Background variant="dots" gap={18} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>

      {/* ✏️ Edit Modal */}
      {editModal && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 12,
            padding: 20,
            zIndex: 100,
            width: 340,
            boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
          }}
        >
          <h3 style={{ marginBottom: 10 }}>Edit {editModal.type === 'node' ? 'Node' : 'Edge'}</h3>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Label:
            <input
              type="text"
              value={editModal.label}
              onChange={(e) => setEditModal((m) => ({ ...m, label: e.target.value }))}
              style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #ddd' }}
            />
          </label>
          <label style={{ display: 'block' }}>
            Description:
            <textarea
              value={editModal.description}
              onChange={(e) => setEditModal((m) => ({ ...m, description: e.target.value }))}
              style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #ddd' }}
              rows={4}
            />
          </label>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setEditModal(null)} style={{ padding: '6px 12px', borderRadius: 8 }}>
              Cancel
            </button>
            <button
              onClick={() => {
                if (editModal.type === 'node') {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === editModal.id
                        ? { ...n, data: { ...n.data, label: editModal.label, description: editModal.description } }
                        : n
                    )
                  );

                  const updatedRows = rows.map((r) => {
                    if (`n:${r.fromFunction}` === editModal.id)
                      return { ...r, fromFunction: editModal.label, fromDetails: editModal.description };
                    if (`n:${r.toFunction}` === editModal.id)
                      return { ...r, toFunction: editModal.label, toDetails: editModal.description };
                    return r;
                  });

                  const oldId = editModal.id;
                  const newId = `n:${editModal.label}`;
                  const oldPos = posRef.current.get(oldId);
                  if (oldPos) {
                    posRef.current.set(newId, { ...oldPos });
                    posRef.current.delete(oldId);
                    persistSoon();
                  }

                  onUpdateRows?.(updatedRows);
                } else {
                  setEdges((eds) =>
                    eds.map((e) =>
                      e.id === editModal.id
                        ? { ...e, label: editModal.label, data: { ...e.data, description: editModal.description } }
                        : e
                    )
                  );
                  const updatedRows = rows.map((r, i) => {
                    const edgeId = `e:n:${r.fromFunction}->n:${r.toFunction}-${i}`;
                    if (edgeId !== editModal.id) return r;
                    return { ...r, controlAction: editModal.label, controlDetails: editModal.description };
                  });
                  onUpdateRows?.(updatedRows);
                }
                setEditModal(null);
              }}
              style={{
                background: BRAND.purple,
                color: 'white',
                padding: '8px 14px',
                borderRadius: 8,
                fontWeight: 700,
                boxShadow: '0 6px 16px rgba(122,55,255,0.18)',
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default forwardRef(function LiteSummaryDiagramReactFlow(props, ref) {
  return (
    <ReactFlowProvider>
      <DiagramBody ref={ref} {...props} />
    </ReactFlowProvider>
  );
});

/* ================================
 * Small helper
 * ================================ */
function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Math.random().toString(36).slice(2, 10)}`;
}
