/* eslint-disable react-hooks/exhaustive-deps */
/**
 * xHandle: lite summary diagram react flow git hub diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

// LiteSummaryDiagramReactFlowGitHub.js — Main diagram component using layout manager
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
import { SmartBezierEdge } from '@tisoap/react-flow-smart-edge';
import { downloadDrawioXml } from '../utils/exportDrawio';

// Import layout management functions
import {
  runElkLayoutOnce,
  nearestFreePosition,
  nudgeIfOverlapping,
  seedPosition,
  structureSignature,
} from './nodeLayoutManager';
import GroupBoxNode from './GroupBoxNode';
import {
  computeGroupBounds,
  buildGroupBoxNodes,
  isGroupBox,
  attachNodesToBoxes,
} from './nodeLayoutManager';
import { logger } from "../../lib/utils/logger";

// --- IndexedDB storage for diagram positions (unified schema) ---
const IDB_DB_NAME = "xhandle";
const IDB_VERSION = 3; // must match other files
const IDB_STORES = {
  codeIndex: "code_index",
  cba: "copilot_baseline",
  positions: "diagram_positions",
};

/**
 * idbOpen encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns diagram data or layout state for rendering.
 */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORES.codeIndex)) {
        db.createObjectStore(IDB_STORES.codeIndex, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(IDB_STORES.cba)) {
        db.createObjectStore(IDB_STORES.cba, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(IDB_STORES.positions)) {
        db.createObjectStore(IDB_STORES.positions, { keyPath: "key" });
      }
    };
    req.onblocked = () => {
      logger.warn("IndexedDB upgrade blocked; close other tabs using xHandle.");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * idbPositionsLoad encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param storageKey Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to diagram data or layout state for rendering.
 */
async function idbPositionsLoad(storageKey) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORES.positions, "readonly");
    const req = tx.objectStore(IDB_STORES.positions).get(storageKey);
    req.onsuccess = () => {
      const arr = req.result?.value || []; // [[id,{x,y}], ...]
      resolve(new Map(arr));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * idbPositionsSave encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param storageKey Input consumed by this step of the xHandle workflow.
 * @param map Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to diagram data or layout state for rendering.
 */
async function idbPositionsSave(storageKey, map) {
  const db = await idbOpen();
  const arr = Array.from(map.entries()); // [[id,{x,y}], ...]
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORES.positions, "readwrite");
    tx.objectStore(IDB_STORES.positions).put({ key: storageKey, value: arr });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}





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

// Take the first file from a "Related File(s)" cell (handles comma/semicolon lists)
function primaryFile(cell) {
  if (!cell || typeof cell !== 'string') return '';
  const first = cell.split(/[,;]+/)[0].trim();
  return first;
}

/**
 * positionsAbsMapFromRF encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param rfNodes Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function positionsAbsMapFromRF(rfNodes) {
  const m = new Map();
  (rfNodes || []).forEach((n) => {
    const p = n.positionAbsolute || n.position || { x: 0, y: 0 };
    m.set(n.id, { x: p.x, y: p.y });
  });
  return m;
}

// Build a map: functionName -> most frequent file across both From/To columns
function computePreferredFileByFunction(rows) {
  const countsByFunc = new Map(); // func -> Map(file -> count)

  for (const r of rows) {
    const fromFn = String(r.fromFunction || '').trim();
    const toFn = String(r.toFunction || '').trim();
    const fromF = primaryFile(r.fromFile);
    const toF = primaryFile(r.toFile);

    if (fromFn && fromF) {
      const m = countsByFunc.get(fromFn) || new Map();
      m.set(fromF, (m.get(fromF) || 0) + 1);
      countsByFunc.set(fromFn, m);
    }
    if (toFn && toF) {
      const m = countsByFunc.get(toFn) || new Map();
      m.set(toF, (m.get(toF) || 0) + 1);
      countsByFunc.set(toFn, m);
    }
  }

  const preferred = new Map();
  for (const [fn, m] of countsByFunc.entries()) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) preferred.set(fn, top);
  }
  return preferred;
}

/**
 * ensureValidParentRefs establishes the prerequisite runtime state this module needs before higher-level work can proceed. In xHandle that usually means preparing storage, event bridges, or shared runtime infrastructure before a feature starts using it.
 * @param nextNodes Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function ensureValidParentRefs(nextNodes) {
  const ids = new Set((nextNodes || []).map((n) => n.id));
  return (nextNodes || []).map((n) => {
    const parent = n?.parentNode;
    if (!parent || ids.has(parent)) return n;
    const cleaned = { ...n };
    delete cleaned.parentNode;
    if (cleaned.extent === "parent") delete cleaned.extent;
    return cleaned;
  });
}

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

/**
 * deriveDescriptionForFunction encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param fnName Input consumed by this step of the xHandle workflow.
 * @param rows Worksheet or table rows that this step transforms.
 * @returns diagram data or layout state for rendering.
 */
function deriveDescriptionForFunction(fnName, rows) {
  const name = String(fnName || '').trim();
  if (!name || !Array.isArray(rows)) return '';
  const candidates = [];
  for (const r of rows) {
    if (String(r.fromFunction || '').trim() === name && r.fromDetails) {
      candidates.push(String(r.fromDetails).trim());
    }
    if (String(r.toFunction || '').trim() === name && r.toDetails) {
      candidates.push(String(r.toDetails).trim());
    }
  }
  candidates.sort((a, b) => b.length - a.length); // prefer most informative
  return candidates[0] || '';
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
 * Component
 * ================================ */
const DiagramBody = forwardRef(function DiagramBody(
  {
    rows = [],
    onUpdateRows,
    storageKey = "diagram:positions:v1",
    cleanOnceKey = null,
    onCleanApplied,
    fitAfterClean = true,
    onRequestCreateProject, // NEW: parent handler
    includeFiles = undefined,            // undefined/null => show all; [] => show none
    repoName = "",
  },
  ref
) {
  // -------------------- React Flow state --------------------
  const [nodes, setNodes, reactflowOnNodesChange] = useNodesState([]);
  const [edges, setEdges, reactflowOnEdgesChange] = useEdgesState([]);

  // -------------------- Node / Edge types -------------------
  const nodeTypes = useMemo(
    () => ({
      bidirectional: BidirectionalNode,
      groupBox: GroupBoxNode,
    }),
    []
  );

  const hasBoxes = useMemo(
    () => nodes.some((n) => n.type === "groupBox" || String(n.id).startsWith("box:")),
    [nodes]
  );

  const edgeTypes = useMemo(() => {
    const Smart = !hasBoxes && typeof SmartBezierEdge === "function" && SmartBezierEdge;
    return { smartBezier: Smart };
  }, [hasBoxes]);
  
  

  // -------------------- UI state ----------------------------
  const [highlightedEdgeId, setHighlightedEdgeId] = useState(null);

  // -------------------- Include files normalization ---------
  // showAll: null/undefined => true; empty array => false (show none)
  const { showAll, includeSet } = useMemo(() => {
    const showAll = includeFiles == null;
    const includeSet = new Set(includeFiles || []); // [] => empty set
    return { showAll, includeSet };
  }, [includeFiles]);

  // -------------------- Node visibility --------------------
  // function nodes visible if (showAll) or (their file in includeSet)
  // group boxes visible if any child is visible
  const nodeVisibility = useMemo(() => {
    const vis = new Map();

    // first pass: mark function nodes
    nodes.forEach((n) => {
      if (n.type === "groupBox" || String(n.id).startsWith("box:")) {
        vis.set(n.id, false); // compute after child pass
      } else {
        const file = n?.data?.file || "Unfiled";
        vis.set(n.id, showAll || includeSet.has(file));
      }
    });

    // second pass: bubble to parents
    nodes.forEach((n) => {
      const parent = n.parentNode;
      if (parent && vis.get(n.id)) vis.set(parent, true);
    });

    return vis;
  }, [nodes, showAll, includeSet]);

  // -------------------- Filtered views ----------------------
  const viewNodes = useMemo(() => {
    const active = edges.find((e) => e.id === highlightedEdgeId);
    const actSet = active ? new Set([active.source, active.target]) : null;

    return nodes
      .filter((n) => nodeVisibility.get(n.id))
      .map((n) => ({
        ...n,
        style: actSet?.has(n.id)
          ? { ...(n.style || {}), filter: "drop-shadow(0 0 14px rgba(122,55,255,0.8))" }
          : n.style,
      }));
  }, [nodes, edges, highlightedEdgeId, nodeVisibility]);

  const viewEdges = useMemo(() => {
    // hide edges connected to hidden nodes
    const filtered = edges.filter(
      (e) => nodeVisibility.get(e.source) && nodeVisibility.get(e.target)
    );

    return filtered.map((e) => {
      const isOn = e.id === highlightedEdgeId;
      return {
        ...e,
        animated: isOn,
        style: {
          ...(e.style || {}),
          stroke: BRAND.blue,
          strokeWidth: isOn ? 4.5 : THEME.edge.width,
          opacity: isOn ? 1 : THEME.edge.opacity,
          filter: isOn ? "drop-shadow(0 0 6px rgba(45,125,254,0.45))" : undefined,
        },
        markerEnd:
          e.markerEnd ?? {
            type: MarkerType.ArrowClosed,
            color: BRAND.blue,
            width: ARROW_SIZE,
            height: ARROW_SIZE,
          },
      };
    });
  }, [edges, highlightedEdgeId, nodeVisibility]);

  // -------------------- refs / misc you already had ---------
  const diagramHostRef = useRef(null);
  const [editModal, setEditModal] = useState(null);

  // NEW: create-project modal & selection snapshot
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectionSnapshot, setSelectionSnapshot] = useState({ nodes: [], rows: [] });

  // NEW: selected node labels
  function getSelectedNodeLabels() {
    const labels = [];
    getNodes().forEach((n) => {
      if (n.selected) {
        const label =
          (n.data && (n.data.label || n.data.name)) || n.id.replace(/^n:/, "");
        if (label) labels.push(label);
      }
    });
    return labels;
  }

  function filterRowsByNodes(selectedLabels) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.filter((r) => {
      const from = String(r.fromFunction ?? "").trim();
      const to = String(r.toFunction ?? "").trim();
      return selectedLabels.includes(from) || selectedLabels.includes(to);
    });
  }
  

  // NEW: open modal with snapshot
  function openCreateProjectModal() {
    const selected = getSelectedNodeLabels();
    const filtered = filterRowsByNodes(selected);
    setSelectionSnapshot({ nodes: selected, rows: filtered });
    setProjectName("");
    setShowCreateModal(true);
  }

  // -------------------- positions persistence ----------------
  const posRef = useRef(new Map());
  const [posLoaded, setPosLoaded] = useState(false);
    const saveTimer = useRef(null);
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const loaded = await idbPositionsLoad(storageKey);
          if (!cancelled) {
            posRef.current = loaded instanceof Map ? loaded : new Map();
            setPosLoaded(true);
          }
        } catch {
          if (!cancelled) setPosLoaded(true); // proceed with empty map
        }
      })();
      return () => { cancelled = true; };
    }, [storageKey]);
    
    const persistSoon = useCallback(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        idbPositionsSave(storageKey, posRef.current).catch(() => {});
      }, 120);
    }, [storageKey]);
    

  const builtCountRef = useRef(0);
  const builtOnceRef = useRef(false);
  const structureRef = useRef("");
  const cleanedKeysRef = useRef(new Set());
  const arrangeInFlightRef = useRef(false);
  const connectStartRef = useRef(null);
  const [isInitialArrangePending, setIsInitialArrangePending] = useState(() => !!cleanOnceKey);
  const arrangeStartedAtRef = useRef(0);

  const { fitView, project, getNodes, getEdges } = useReactFlow();

  const runCleanAndSpread = useCallback(async () => {
    // 1) Layout only real nodes (ignore boxes)
    const realNodes = nodes.filter((n) => !isGroupBox(n));
    const elkNodes = await runElkLayoutOnce({
      nodes: realNodes,
      edges,
      groupByFile: true,
    });

    // 2) Build boxes from absolute positions
    const groups = computeGroupBounds(elkNodes);
    const boxNodes = buildGroupBoxNodes(groups);

    // 3) Parent children under boxes
    const childNodes = attachNodesToBoxes(elkNodes, boxNodes);

    // 4) Render boxes first
    setNodes(ensureValidParentRefs([...boxNodes, ...childNodes]));

    // 5) Persist absolute positions
    elkNodes.forEach((n) => posRef.current.set(n.id, { ...n.position }));
    persistSoon();

    // 6) Rebuild edges from absolute positions
    const raw = rowsToRawEdges(rows);
    const absPos = new Map(elkNodes.map((n) => [n.id, { ...n.position }]));
    setEdges(buildEdgesFromRaw(raw, absPos));

    // 7) Optional fit
    if (fitAfterClean) {
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true });
      }, 0);
    }
  }, [nodes, edges, rows, fitAfterClean, fitView, persistSoon, setEdges, setNodes]);
  
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

  const findNodeUnderPointer = useCallback((evt) => {
    const bounds = diagramHostRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const local = { x: evt.clientX - bounds.left, y: evt.clientY - bounds.top };
    const p = project(local);
    const w = THEME.node.w;
    const h = THEME.node.h;
    const hit = getNodes().find((n) => {
      const nx = n.position.x;
      const ny = n.position.y;
      return p.x >= nx && p.x <= nx + w && p.y >= ny && p.y <= ny + h;
    });
    return hit || null;
  }, [getNodes, project]);

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

      const targetNode = findNodeUnderPointer(evt);
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

// Use ABSOLUTE positions from RF nodes:
const positionsAbs = positionsAbsMapFromRF(getNodes());

const [autoSourceHandle, autoTargetHandle] = assignHandles(
  fromId,
  toId,
  positionsAbs,
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
    [nodes, edges, rows, onUpdateRows, persistSoon, findNodeUnderPointer, getNodes, setEdges]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try { idbPositionsSave(storageKey, posRef.current); } catch {}
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
        if (c.type === 'position' && c.id) {
          const rfNode = getNodes().find((n) => n.id === c.id);
          const p = rfNode?.positionAbsolute || c.position;
          if (p) {
            posRef.current.set(c.id, { x: p.x, y: p.y });
            persistSoon();
          }
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
    [rows, reactflowOnNodesChange, onUpdateRows, persistSoon, getNodes]
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

/* Build when structure changes (after positions are loaded) */
useEffect(() => {
  if (!posLoaded) return; // <-- guard: wait until IndexedDB positions are loaded

  let cancelled = false;

  const sig = structureSignature(rows);
  const structureUnchanged = builtOnceRef.current && sig === structureRef.current;
  const preferredFileByFunction = computePreferredFileByFunction(rows);
  if (structureUnchanged) return;

  const wantedNodeIds = new Set();
  rows.forEach((row) => {
    wantedNodeIds.add(`n:${row.fromFunction}`);
    if (row.toFunction) wantedNodeIds.add(`n:${row.toFunction}`);
  });

  const nextNodes = Array.from(wantedNodeIds).map((id) => {
    const pos = posRef.current.get(id) ?? seedPosition(builtCountRef.current++);
    if (!posRef.current.has(id)) {
      posRef.current.set(id, pos);
      persistSoon(); // <-- now persists to IndexedDB
    }
    const existing = nodes.find((n) => n.id === id);
    if (existing) return { ...existing, position: pos };
    const name = id.replace(/^n:/, '');
    const fileForFn = preferredFileByFunction.get(name) || 'Unfiled';

    return {
      id,
      type: 'bidirectional',
      position: pos,
      data: {
        label: name,
        description: '',
        brandColor: BRAND.blue,
        brandTint: rgba(BRAND.blue, 0.08),
        file: fileForFn, // used by ELK grouping & box labels
      },
    };
  });

  const rawEdges = rowsToRawEdges(rows);
  const nextEdges = buildEdgesFromRaw(rawEdges, posRef.current);

  if (!cancelled) {
    setNodes(ensureValidParentRefs(nextNodes));
    setEdges(nextEdges);
    builtOnceRef.current = true;
    structureRef.current = sig;
  }
  return () => { cancelled = true; };
}, [rows, posLoaded, persistSoon, nodes, setNodes, setEdges]);


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

    setNodes((nds) => {
      const validNodes = Array.isArray(nds) ? nds : [];
      return validNodes.map((n) => (nodeDetails.has(n.id) ? { ...n, data: { ...n.data, ...nodeDetails.get(n.id) } } : n));
    });
    
    setEdges((eds) => {
      const validEdges = Array.isArray(eds) ? eds : [];
      return validEdges.map((e) =>
        edgeDetails.has(e.id)
          ? { ...e, label: edgeDetails.get(e.id).label, data: { ...e.data, description: edgeDetails.get(e.id).description } }
          : e
      );
    });
  }, [rows, setNodes, setEdges]);

  /* One-time clean+spread trigger */
  useEffect(() => {
    if (!cleanOnceKey) {
      setIsInitialArrangePending(false);
      return;
    }
    if (!cleanedKeysRef.current.has(cleanOnceKey)) {
      arrangeStartedAtRef.current = Date.now();
      setIsInitialArrangePending(true);
    }
  }, [cleanOnceKey]);

  useEffect(() => {
    if (!cleanOnceKey) return;
    if (cleanedKeysRef.current.has(cleanOnceKey)) return;
    if (!nodes.length) return;
    if (arrangeInFlightRef.current) return;

    let cancelled = false;
    arrangeInFlightRef.current = true;

    (async () => {
      try {
        await Promise.race([
          runCleanAndSpread(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Initial arrange timed out")), 15000);
          }),
        ]);
        if (!cancelled) {
          const minOverlayMs = 650;
          const elapsed = Date.now() - (arrangeStartedAtRef.current || Date.now());
          const remaining = Math.max(0, minOverlayMs - elapsed);
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }

          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));

          cleanedKeysRef.current.add(cleanOnceKey);
          setIsInitialArrangePending(false);
          // tell parent we consumed the key so it won't fire on remount
          try { onCleanApplied?.(cleanOnceKey); } catch {}
        }
      } catch (err) {
        logger.warn("[LiteSummaryDiagramReactFlowGitHub] initial arrange skipped", err);
        if (!cancelled) {
          cleanedKeysRef.current.add(cleanOnceKey);
          setIsInitialArrangePending(false);
          try { onCleanApplied?.(cleanOnceKey); } catch {}
        }
      } finally {
        arrangeInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
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

        const srcNode = getNodes().find((n) => n.id === connection.source);
        const tgtNode = getNodes().find((n) => n.id === connection.target);
        const srcAbs = srcNode?.positionAbsolute || srcNode?.position;
        const tgtAbs = tgtNode?.positionAbsolute || tgtNode?.position;
        if (srcAbs) posRef.current.set(connection.source, { x: srcAbs.x, y: srcAbs.y });
        if (tgtAbs) posRef.current.set(connection.target, { x: tgtAbs.x, y: tgtAbs.y });
        persistSoon();
        
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
    [setEdges, rows, onUpdateRows, getNodes, persistSoon]
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
      {/* Add / Arrange / Export */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: 8 }}>
      {repoName && (
  <div
    style={{
      background: '#fff',
      border: `1px solid ${BRAND.blue}`,
      borderRadius: 8,
      padding: '6px 10px',
      fontWeight: 600,
      color: BRAND.blue,
      boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
      alignSelf: 'center',
    }}
  >
    {repoName}
  </div>
)}

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
  Add Node
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
          Auto Arrange
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
          Export .XML
        </button>
      </div>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 8 }}>
<button
  onClick={openCreateProjectModal}
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
  title="Create a new project from the currently selected nodes"
>
  Add Selection → Project
</button>
</div>
      {/* Canvas */}
      <div
        style={{
          border: `2px solid ${BRAND.blue}`,
          borderRadius: '8px',
          overflow: 'hidden',
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {isInitialArrangePending && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.96))',
              color: '#1e3a8a',
              fontWeight: 700,
              letterSpacing: '0.01em',
            }}
          >
            Arranging diagram...
          </div>
        )}
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
          selectionOnDrag={true} 
          multiSelectionKeyCode="Shift"
          defaultEdgeOptions={{
            type: 'smartBezier',
            markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
          style={{
            opacity: isInitialArrangePending ? 0 : 1,
            transition: 'opacity 180ms ease',
          }}
          onNodeDoubleClick={(event, node) => {
            const label =
              (node?.data?.label && String(node.data.label)) ||
              String(node?.id || '').replace(/^n:/, '');
            const currentDesc = node?.data?.description || '';
            const fallbackDesc = currentDesc || deriveDescriptionForFunction(label, rows);
          
            setEditModal({
              type: 'node',
              id: node.id,
              label,
              description: fallbackDesc,
            });
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
          
            setNodes((nds) => {
              const currentNodes = Array.isArray(nds) ? nds : [];
              return [...currentNodes, newNode];
            });
            posRef.current.set(rfId, newNode.position);
            persistSoon();
          }}           
          onNodeDragStop={(_, node) => {
            // If a box moved, update all its children in the position cache
            if (node?.id?.startsWith('box:')) {
              const rfNodes = getNodes();
              rfNodes.forEach((n) => {
                if (n.parentNode === node.id || !n.parentNode) {
                  const p = n.positionAbsolute || n.position;
                  if (p) posRef.current.set(n.id, { x: p.x, y: p.y });
                }
              });
            } else if (node?.id) {
              const p = node.positionAbsolute || node.position;
              if (p) posRef.current.set(node.id, { x: p.x, y: p.y });
            }
          
            persistSoon();
          
            // Rebuild edges using current ABSOLUTE positions from the canvas
            const absPos = positionsAbsMapFromRF(getNodes());
            const raw = rowsToRawEdges(rows);
            setEdges(buildEdgesFromRaw(raw, absPos));
          
            // Optional: only nudge if there are no group boxes (nudger expects absolute, non-parented coords)
            const boxesExist = getNodes().some((n) => n.type === 'groupBox' || String(n.id).startsWith('box:'));
            if (!boxesExist) {
              nudgeIfOverlapping(node.id, nodes, setNodes);
            }
          }}
          
        >
          <Background variant="dots" gap={18} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>

      {/* Edit Modal */}
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

      {/* Create Project modal */}
{showCreateModal && (
<div
  style={{
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  }}
>
  <div
    style={{
      width: 420,
      maxWidth: '90vw',
      background: 'white',
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: 14,
      boxShadow: '0 18px 48px rgba(0,0,0,0.2)',
      padding: 18,
    }}
  >
    <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Create Project from Selection</h3>
    <p style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>
      {selectionSnapshot.nodes.length} {selectionSnapshot.nodes.length === 1 ? 'node' : 'nodes'} selected.
      We'll include all rows where Function (From) or Function (To) matches any selected node.
    </p>

    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Project Name</label>
    <input
      autoFocus
      value={projectName}
      onChange={(e) => setProjectName(e.target.value)}
      placeholder="e.g., Sensor Fusion Slice"
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid #e2e8f0',
        outline: 'none',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && projectName.trim()) {
          const payload = {
            name: projectName.trim(),
            selectedNodes: selectionSnapshot.nodes,
            filteredRows: selectionSnapshot.rows,
          };
          try { onRequestCreateProject?.(payload); } catch {}
          setShowCreateModal(false);
        }
      }}
    />

    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
      <button
        onClick={() => setShowCreateModal(false)}
        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc' }}
      >
        Cancel
      </button>
      <button
        disabled={!projectName.trim()}
        onClick={() => {
          if (!projectName.trim()) return;
          const payload = {
            name: projectName.trim(),
            selectedNodes: selectionSnapshot.nodes,
            filteredRows: selectionSnapshot.rows,
          };
          try { onRequestCreateProject?.(payload); } catch {}
          setShowCreateModal(false);
        }}
        style={{
          padding: '8px 12px',
          borderRadius: 10,
          border: 'none',
          background: BRAND.purple,
          color: 'white',
          fontWeight: 700,
          opacity: projectName.trim() ? 1 : 0.6,
          boxShadow: '0 6px 16px rgba(122,55,255,0.18)',
        }}
      >
        Create Project
      </button>
    </div>
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
