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
  NodeResizer,
  MarkerType,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  BaseEdge,
  StepEdge,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import { SmartBezierEdge } from '@tisoap/react-flow-smart-edge';
import ELK from 'elkjs/lib/elk.bundled.js';
import { downloadDrawioXml } from './utils/exportDrawio';

/* ================================
 * Brand & Theme
 * ================================ */
const BRAND = {
  blue: '#2D7DFE',
  purple: '#7A37FF',
  yellow: '#F3B63F',
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

const GROUP = {
  w: 420,
  h: 280,
  minW: 320,
  minH: 180,
  padX: 18,
  padTop: 46,
  padBottom: 18,
  radius: 16,
};

const NODE_LAYOUT = {
  w: THEME.node.w + THEME.node.pad * 2,
  h: THEME.node.h + THEME.node.pad * 2,
};

const AUTO_CATEGORY = {
  minW: NODE_LAYOUT.w + 72,
  minH: NODE_LAYOUT.h + 80,
  padX: 36,
  padTop: 50,
  padBottom: 30,
  nodeGapX: 260,
  nodeGapY: 120,
  gapX: 190,
  gapY: 160,
};

const NOTE = {
  w: 240,
  h: 160,
};

const COLOR_PRESETS = [
  BRAND.blue,
  BRAND.purple,
  BRAND.yellow,
  '#22C55E',
  '#EF4444',
  '#14B8A6',
];

// Arrow size knob (in px)
const ARROW_SIZE = 18;

const EDGE_ROUTING_STYLES = {
  BEZIER: 'bezier',
  RECTANGULAR: 'rectangular',
};

function normalizeEdgeRoutingStyle(value) {
  return value === EDGE_ROUTING_STYLES.RECTANGULAR
    ? EDGE_ROUTING_STYLES.RECTANGULAR
    : EDGE_ROUTING_STYLES.BEZIER;
}

function edgeTypeForRoutingStyle(value) {
  return normalizeEdgeRoutingStyle(value) === EDGE_ROUTING_STYLES.RECTANGULAR
    ? 'smartStep'
    : 'smartBezier';
}

/* ================================
 * Utilities
 * ================================ */
const rgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function positionsAbsMapFromRF(rfNodes) {
  const m = new Map();
  (rfNodes || []).forEach((n) => {
    const p = n.positionAbsolute || n.position || { x: 0, y: 0 };
    m.set(n.id, { x: p.x, y: p.y });
  });
  return m;
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function cleanNodeForExport(node) {
  return {
    id: node.id,
    type: node.type || 'default',
    label: node.data?.label || node.id,
    description: node.data?.description || '',
    position: node.position || { x: 0, y: 0 },
    positionAbsolute: node.positionAbsolute || node.position || { x: 0, y: 0 },
    parentNode: node.parentNode || null,
    extent: node.extent || null,
    width: node.width || null,
    height: node.height || null,
    style: node.style || null,
    data: {
      brandColor: node.data?.brandColor || null,
      brandTint: node.data?.brandTint || null,
    },
  };
}

function cleanEdgeForExport(edge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    label: edge.label || edge.data?.label || '',
    type: edge.type || 'default',
    animated: !!edge.animated,
    style: edge.style || null,
    markerEnd: edge.markerEnd || null,
    data: edge.data || null,
  };
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

/* ================================
 * Prevent overlapping node placement
 * ================================ */
const GRID = 16;
const GAP = 24;

const snap = (v) => Math.round(v / GRID) * GRID;

function isOverlapping(a, b) {
  const w = THEME.node.w, h = THEME.node.h;
  return (
    Math.abs((a.x + w / 2) - (b.x + w / 2)) < (w + GAP) / 2 &&
    Math.abs((a.y + h / 2) - (b.y + h / 2)) < (h + GAP) / 2
  );
}

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
    return new Map(
      Array.isArray(arr)
        ? arr.map(([id, value]) => {
            if (value && typeof value === 'object' && 'position' in value) return [id, value];
            return [id, { position: value, parentId: null }];
          })
        : []
    );
  } catch {
    return new Map();
  }
}
function savePositions(storageKey, posMap) {
  try {
    const arr = Array.from(posMap.entries());
    localStorage.setItem(storageKey, JSON.stringify(arr));
  } catch {}
}

function loadGroupBoxes(storageKey) {
  try {
    const raw = localStorage.getItem(`${storageKey}:groups:v1`);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveGroupBoxes(storageKey, boxes) {
  try {
    localStorage.setItem(`${storageKey}:groups:v1`, JSON.stringify(boxes || []));
  } catch {}
}

function saveAutoCategoryMeta(storageKey, meta) {
  try {
    localStorage.setItem(`${storageKey}:auto-categories:v1`, JSON.stringify(meta || {}));
  } catch {}
}

function getActiveAutoGroupIds(autoCategories, rows, deletedAutoGroupIds = new Set()) {
  if (!Array.isArray(autoCategories?.categories)) return null;
  const activeCategories = normalizeCategories(autoCategories, rows)
    .filter((category, index) => !deletedAutoGroupIds.has(stableAutoCategoryId(category, index)));
  return new Set(activeCategories.map((category, index) => stableAutoCategoryId(category, index)));
}

function pruneGroupBoxesForProject(groupBoxes, autoCategories, rows, deletedAutoGroupIds = new Set()) {
  const boxes = Array.isArray(groupBoxes) ? groupBoxes : [];
  const activeAutoGroupIds = getActiveAutoGroupIds(autoCategories, rows, deletedAutoGroupIds);
  if (!activeAutoGroupIds) return boxes.filter((box) => !box.autoGenerated);
  return boxes.filter((box) => !box.autoGenerated || activeAutoGroupIds.has(box.id));
}

function prunePositionParentsForGroups(posMap, groupBoxes) {
  const validGroupIds = new Set((groupBoxes || []).map((box) => box.id));
  let changed = false;
  posMap.forEach((value, id) => {
    if (!value?.parentId || validGroupIds.has(value.parentId)) return;
    posMap.set(id, { ...value, parentId: null });
    changed = true;
  });
  return changed;
}

function loadDeletedAutoGroupIds(storageKey) {
  try {
    const raw = localStorage.getItem(`${storageKey}:deleted-auto-groups:v1`);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveDeletedAutoGroupIds(storageKey, deletedIds) {
  try {
    localStorage.setItem(`${storageKey}:deleted-auto-groups:v1`, JSON.stringify(Array.from(deletedIds || [])));
  } catch {}
}

function loadManualNodes(storageKey) {
  try {
    const raw = localStorage.getItem(`${storageKey}:manual:v1`);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveManualNodes(storageKey, manualNodes) {
  try {
    localStorage.setItem(`${storageKey}:manual:v1`, JSON.stringify(manualNodes || []));
  } catch {}
}

function loadEdgeAggregationState(storageKey) {
  try {
    const raw = localStorage.getItem(`${storageKey}:edge-aggregation:v1`);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      aggregateAll: Boolean(parsed?.aggregateAll),
      aggregatedPairs: new Set(Array.isArray(parsed?.aggregatedPairs) ? parsed.aggregatedPairs.filter(Boolean) : []),
      expandedPairs: new Set(Array.isArray(parsed?.expandedPairs) ? parsed.expandedPairs.filter(Boolean) : []),
    };
  } catch {
    return { aggregateAll: false, aggregatedPairs: new Set(), expandedPairs: new Set() };
  }
}

function saveEdgeAggregationState(storageKey, state = {}) {
  try {
    localStorage.setItem(`${storageKey}:edge-aggregation:v1`, JSON.stringify({
      aggregateAll: Boolean(state.aggregateAll),
      aggregatedPairs: Array.from(state.aggregatedPairs || []),
      expandedPairs: Array.from(state.expandedPairs || []),
    }));
  } catch {}
}

function loadEdgeRoutingState(storageKey) {
  try {
    const raw = localStorage.getItem(`${storageKey}:edge-routing:v1`);
    const parsed = raw ? JSON.parse(raw) : {};
    const overrides = parsed?.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {};
    return {
      defaultStyle: normalizeEdgeRoutingStyle(parsed?.defaultStyle),
      overrides: Object.fromEntries(
        Object.entries(overrides)
          .filter(([key]) => Boolean(key))
          .map(([key, value]) => [key, normalizeEdgeRoutingStyle(value)])
      ),
    };
  } catch {
    return { defaultStyle: EDGE_ROUTING_STYLES.BEZIER, overrides: {} };
  }
}

function saveEdgeRoutingState(storageKey, state = {}) {
  try {
    localStorage.setItem(`${storageKey}:edge-routing:v1`, JSON.stringify({
      defaultStyle: normalizeEdgeRoutingStyle(state.defaultStyle),
      overrides: state.overrides && typeof state.overrides === 'object' ? state.overrides : {},
    }));
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

const GroupBoxNode = ({ data, selected }) => {
  const brandColor = data.brandColor || BRAND.purple;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: `2px dashed ${rgba(brandColor, selected ? 0.85 : 0.5)}`,
        background: rgba(brandColor, 0.06),
        borderRadius: GROUP.radius,
        boxShadow: selected ? `0 0 0 5px ${rgba(brandColor, 0.15)}` : 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <NodeResizer
        minWidth={GROUP.minW}
        minHeight={GROUP.minH}
        onResize={(_, params) => data.onResize?.(params)}
        onResizeEnd={(_, params) => data.onResize?.(params)}
        lineStyle={{ borderColor: rgba(brandColor, 0.45), borderWidth: 1, pointerEvents: 'auto' }}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 3,
          border: `1px solid ${rgba(brandColor, 0.65)}`,
          background: '#fff',
          pointerEvents: 'auto',
        }}
        isVisible={selected}
      />
      <div
        className="project-group-drag-handle"
        style={{
          padding: '12px 14px',
          fontSize: 13,
          fontWeight: 700,
          color: BRAND.dark,
          background: rgba(brandColor, 0.08),
          borderBottom: `1px dashed ${rgba(brandColor, 0.3)}`,
          pointerEvents: 'auto',
          cursor: 'grab',
        }}
      >
        {data.label || 'Group'}
      </div>
    </div>
  );
};

const NoteNode = ({ data, selected }) => {
  const brandColor = data.brandColor || BRAND.yellow;
  const tint = data.brandTint || rgba(brandColor, 0.2);
  return (
    <div
      style={{
        width: NOTE.w,
        minHeight: NOTE.h,
        padding: 14,
        border: `1px solid ${rgba(brandColor, 0.45)}`,
        borderRadius: 8,
        background: tint,
        boxShadow: selected ? `0 0 0 5px ${rgba(brandColor, 0.18)}, ${THEME.node.shadow}` : THEME.node.shadow,
        color: BRAND.dark,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word' }}>
        {data.label || 'Note'}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {data.description || 'Add a note'}
      </div>
    </div>
  );
};

/* ================================
 * Edge fallback (orthogonal)
 * ================================ */
function OrthogonalFallbackEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, markerEnd, style, selected } = props;
  const viaX = { x: targetX, y: sourceY };
  const useHV = Math.abs(targetX - sourceX) > Math.abs(targetY - sourceY);
  const d = useHV
    ? `M ${sourceX},${sourceY} L ${viaX.x},${viaX.y} L ${targetX},${targetY}`
    : `M ${sourceX},${sourceY} L ${sourceX},${targetY} L ${targetX},${targetY}`;
  const stroke = style?.stroke || '#1f2544';
  const width = selected ? 3.5 : 2.5;
  return (
    <BaseEdge
      id={id}
      path={d}
      markerEnd={{ ...(markerEnd || {}), color: stroke, width: ARROW_SIZE, height: ARROW_SIZE, type: MarkerType.ArrowClosed }}
      style={{ stroke, strokeWidth: width }}
    />
  );
}

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
const spotKey = (nodeId, side, idx) => `${nodeId}:${side}:${idx}`;
function parseHandleId(handleId) {
  const m = /^(top|bottom|left|right)-(?:source|target)-(\d+)$/.exec(handleId || '');
  if (!m) return null;
  return { side: m[1], idx: Number(m[2]) };
}
function normalizeFunctionName(value) {
  return String(value || '').trim();
}
function nodeIdForFunction(value) {
  const name = normalizeFunctionName(value);
  return name ? `n:${name}` : null;
}
function edgeIdForRow(row, index) {
  const fromId = nodeIdForFunction(row?.fromFunction);
  const toId = nodeIdForFunction(row?.toFunction);
  return fromId && toId ? `e:${fromId}->${toId}-${index}` : null;
}
const sideSlotCount = (side) =>
  (side === 'top' || side === 'bottom') ? TOP_BOTTOM_PCTS.length : LEFT_RIGHT_PCTS.length;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
function edgePairKey(source, target) {
  return `${source || ''}->${target || ''}`;
}

function aggregateEdgeIdForPair(pairKey) {
  return `e:aggregate:${pairKey}`;
}

function shouldAggregatePair(pairKey, count, options = {}) {
  if (count <= 1) return false;
  if (options.aggregateAll) return !options.expandedPairs?.has(pairKey);
  return Boolean(options.aggregatedPairs?.has(pairKey));
}

function summarizeEdgeLabels(edges = []) {
  const labels = Array.from(new Set(edges.map((edge) => String(edge.label || '').trim()).filter(Boolean)));
  if (!labels.length) return '';
  const preview = labels.slice(0, 3).join(', ');
  return labels.length > 3 ? `${preview} +${labels.length - 3}` : preview;
}

function edgeRoutingTargetKey(edge) {
  if (!edge) return '';
  if (edge.data?.aggregated && edge.data?.pairKey) return `pair:${edge.data.pairKey}`;
  return edge.id || '';
}

function resolveEdgeRoutingStyle(edge, routing = {}) {
  const targetKey = edgeRoutingTargetKey(edge);
  const override = targetKey ? routing.overrides?.[targetKey] : null;
  return normalizeEdgeRoutingStyle(override || routing.defaultStyle);
}

function buildEdgesFromRaw(rawEdges, positions, aggregation = {}, routing = {}) {
  const grouped = new Map();
  rawEdges.forEach((edge, rowIndex) => {
    const pairKey = edgePairKey(edge.source, edge.target);
    if (!grouped.has(pairKey)) grouped.set(pairKey, []);
    grouped.get(pairKey).push({ ...edge, rowIndex });
  });

  const displayEdges = [];
  grouped.forEach((pairEdges, pairKey) => {
    if (shouldAggregatePair(pairKey, pairEdges.length, aggregation)) {
      const first = pairEdges[0];
      displayEdges.push({
        ...first,
        id: aggregateEdgeIdForPair(pairKey),
        label: `${pairEdges.length} edges`,
        sourceHandle: null,
        targetHandle: null,
        updatable: false,
        data: {
          ...(first.data || {}),
          aggregated: true,
          pairKey,
          count: pairEdges.length,
          summary: summarizeEdgeLabels(pairEdges),
          edgeIds: pairEdges.map((edge) => edge.id),
          rowIndexes: pairEdges.map((edge) => edge.rowIndex),
        },
      });
      return;
    }
    displayEdges.push(...pairEdges);
  });

  const occupiedSpots = new Set();
  const pairSeq = new Map();
  return displayEdges.map((e, i) => {
    const key = edgePairKey(e.source, e.target);
    const pairIdx = pairSeq.get(key) || 0;
    pairSeq.set(key, pairIdx + 1);

    const savedSourceHandle = parseHandleId(e.sourceHandle) ? e.sourceHandle : null;
    const savedTargetHandle = parseHandleId(e.targetHandle) ? e.targetHandle : null;
    const [autoSourceHandle, autoTargetHandle] = assignHandles(
      e.source,
      e.target,
      positions,
      occupiedSpots,
      e.label || '',
      i,
      pairIdx
    );
    const sourceHandle = savedSourceHandle || autoSourceHandle;
    const targetHandle = savedTargetHandle || autoTargetHandle;

    const sParsed = parseHandleId(sourceHandle);
    const tParsed = parseHandleId(targetHandle);
    if (sParsed) occupiedSpots.add(spotKey(e.source, sParsed.side, sParsed.idx));
    if (tParsed) occupiedSpots.add(spotKey(e.target, tParsed.side, tParsed.idx));

    const isAggregated = Boolean(e.data?.aggregated);
    const stroke = isAggregated ? BRAND.purple : BRAND.blue;
    const routingTargetKey = edgeRoutingTargetKey(e);
    const routingStyle = resolveEdgeRoutingStyle(e, routing);
    return {
      ...e,
      type: edgeTypeForRoutingStyle(routingStyle),
      sourceHandle,
      targetHandle,
      data: {
        ...(e.data || {}),
        routingStyle,
        routingTargetKey,
      },
      style: {
        stroke,
        strokeWidth: isAggregated ? 5 : 3,
        strokeDasharray: isAggregated ? '8 5' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: ARROW_SIZE, height: ARROW_SIZE },
      label: isAggregated && e.data?.summary ? `${e.label}: ${e.data.summary}` : e.label,
    };
  });
}

function getNodeAbsolutePosition(node, byId) {
  if (!node) return { x: 0, y: 0 };
  if (!node.parentNode) return { x: node.position.x, y: node.position.y };
  const parent = byId.get(node.parentNode);
  if (!parent) return { x: node.position.x, y: node.position.y };
  const parentAbs = getNodeAbsolutePosition(parent, byId);
  return { x: parentAbs.x + node.position.x, y: parentAbs.y + node.position.y };
}

function buildAbsolutePositionMap(nodes) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const map = new Map();
  (nodes || []).forEach((node) => {
    map.set(node.id, getNodeAbsolutePosition(node, byId));
  });
  return map;
}

function clampToGroup(position, box) {
  const maxX = Math.max(GROUP.padX, (box?.width || GROUP.w) - NODE_LAYOUT.w - GROUP.padX);
  const maxY = Math.max(GROUP.padTop, (box?.height || GROUP.h) - NODE_LAYOUT.h - GROUP.padBottom);
  return {
    x: Math.min(Math.max(GROUP.padX, position.x), maxX),
    y: Math.min(Math.max(GROUP.padTop, position.y), maxY),
  };
}

function sizeGroupToFitChildren(box, children) {
  const widthBase = Math.max(box?.width || GROUP.w, GROUP.minW);
  const heightBase = Math.max(box?.height || GROUP.h, GROUP.minH);
  if (!children?.length) {
    return { width: widthBase, height: heightBase };
  }

  let maxRight = GROUP.padX + NODE_LAYOUT.w;
  let maxBottom = GROUP.padTop + NODE_LAYOUT.h;
  children.forEach((child) => {
    const x = child?.position?.x ?? GROUP.padX;
    const y = child?.position?.y ?? GROUP.padTop;
    maxRight = Math.max(maxRight, x + NODE_LAYOUT.w + GROUP.padX);
    maxBottom = Math.max(maxBottom, y + NODE_LAYOUT.h + GROUP.padBottom);
  });

  return {
    width: Math.max(widthBase, snap(maxRight)),
    height: Math.max(heightBase, snap(maxBottom)),
  };
}

function rowsToRawEdges(rows) {
  const raw = [];
  rows.forEach((row, idx) => {
    const fromId = nodeIdForFunction(row.fromFunction);
    const toId = nodeIdForFunction(row.toFunction);
    if (!fromId || !toId) return;
    raw.push({
      id: edgeIdForRow(row, idx),
      source: fromId,
      target: toId,
      animated: false,
      type: 'smartBezier',
      style: { stroke: BRAND.dark },
      updatable: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
      label: row.controlAction,
      sourceHandle: row.sourceHandle || row.edgeSourceHandle || row.handles?.source || null,
      targetHandle: row.targetHandle || row.edgeTargetHandle || row.handles?.target || null,
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
    const fromId = nodeIdForFunction(r.fromFunction);
    if (fromId) nodes.add(fromId);
    const toId = nodeIdForFunction(r.toFunction);
    if (fromId && toId) {
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

function buildWantedNodeIdSet(rows) {
  const wanted = new Set();
  (rows || []).forEach((row) => {
    const fromId = nodeIdForFunction(row.fromFunction);
    const toId = nodeIdForFunction(row.toFunction);
    if (fromId) wanted.add(fromId);
    if (toId) wanted.add(toId);
  });
  return wanted;
}

function rowCategorySignature(rows) {
  return JSON.stringify((rows || []).map((row) => ({
    fromFunction: (row.fromFunction || '').trim(),
    fromDetails: (row.fromDetails || '').trim(),
    controlAction: (row.controlAction || '').trim(),
    controlDetails: (row.controlDetails || '').trim(),
    sourceHandle: (row.sourceHandle || '').trim(),
    targetHandle: (row.targetHandle || '').trim(),
    toFunction: (row.toFunction || '').trim(),
    toDetails: (row.toDetails || '').trim(),
  })));
}

function getUniqueFunctionsFromRows(rows) {
  const functions = new Set();
  (rows || []).forEach((row) => {
    if ((row.fromFunction || '').trim()) functions.add(row.fromFunction.trim());
    if ((row.toFunction || '').trim()) functions.add(row.toFunction.trim());
  });
  return Array.from(functions).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

function normalizeCategories(aiPlan, rows) {
  const allFunctions = getUniqueFunctionsFromRows(rows);
  const exactByLower = new Map(allFunctions.map((fn) => [fn.toLowerCase(), fn]));
  const categories = Array.isArray(aiPlan?.categories) ? aiPlan.categories : [];
  const assignedFunctionNames = new Set();

  const normalized = categories
    .map((category, index) => {
      const rowIndexes = Array.isArray(category?.rowIndexes) ? category.rowIndexes : [];
      const fnSet = new Set();

      rowIndexes.forEach((rowIndex) => {
        const row = rows[Number(rowIndex)];
        if (!row) return;
        if (row.fromFunction) fnSet.add(row.fromFunction.trim());
        if (row.toFunction) fnSet.add(row.toFunction.trim());
      });

      (category?.functions || category?.functionNames || []).forEach((fn) => {
        const exact = exactByLower.get(String(fn || '').trim().toLowerCase());
        if (exact) fnSet.add(exact);
      });

      const functions = Array.from(fnSet)
        .filter(Boolean)
        .filter((fn) => {
          const key = fn.toLowerCase();
          if (assignedFunctionNames.has(key)) return false;
          assignedFunctionNames.add(key);
          return true;
        });
      return {
        name: cleanCategoryTitle(category?.name || `Category ${index + 1}`),
        sourceIndex: index,
        functions,
        description: String(category?.description || '').trim(),
      };
    })
    .filter((category) => category.name && category.functions.length)
    .filter((category) => !/\b(unallocated|unassigned|uncategorized|other functions?)\b/i.test(category.name))
    .slice(0, 10);

  if (!normalized.length && allFunctions.length) {
    normalized.push({ name: 'Functional Architecture', functions: allFunctions });
    return normalized;
  }

  const functionToCategory = new Map();
  normalized.forEach((category) => {
    category.functions = Array.from(new Set(category.functions));
    category.functions.forEach((fn) => functionToCategory.set(fn, category));
  });

  const assigned = new Set(functionToCategory.keys());
  const unassigned = allFunctions.filter((fn) => !assigned.has(fn));
  unassigned.forEach((fn) => {
    const relatedRows = (rows || []).filter((row) =>
      String(row?.fromFunction || '').trim() === fn || String(row?.toFunction || '').trim() === fn
    );
    const relatedCategory = relatedRows
      .flatMap((row) => [String(row?.fromFunction || '').trim(), String(row?.toFunction || '').trim()])
      .map((relatedFn) => functionToCategory.get(relatedFn))
      .find(Boolean);
    const targetCategory = relatedCategory || normalized[0];
    targetCategory.functions.push(fn);
    functionToCategory.set(fn, targetCategory);
  });

  normalized.forEach((category) => {
    category.functions = Array.from(new Set(category.functions)).filter(Boolean);
  });

  return normalized;
}

function cleanCategoryTitle(value) {
  const cleaned = String(value || 'Category')
    .replace(/\bcomputer software configuration item\b/gi, '')
    .replace(/\bcsci\b/gi, '')
    .replace(/\s*[-:|/]\s*$/g, '')
    .replace(/^\s*[-:|/]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return (cleaned || 'Category').slice(0, 60);
}

function generateGroupDescription(label, functions = [], rows = []) {
  const uniqueFunctions = Array.from(new Set(functions.map((fn) => String(fn || '').trim()).filter(Boolean)));
  const functionSet = new Set(uniqueFunctions.map((fn) => fn.toLowerCase()));
  const relatedRows = (rows || []).filter((row) => (
    functionSet.has(String(row?.fromFunction || '').trim().toLowerCase()) ||
    functionSet.has(String(row?.toFunction || '').trim().toLowerCase())
  ));
  const actions = Array.from(
    new Set(
      relatedRows
        .map((row) => String(row?.controlAction || '').trim())
        .filter(Boolean)
    )
  );
  const details = Array.from(
    new Set(
      relatedRows
        .flatMap((row) => [row?.fromDetails, row?.controlDetails, row?.toDetails])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
  const functionPreview = uniqueFunctions.slice(0, 6).join(', ');
  const actionPreview = actions.slice(0, 5).join(', ');
  const detailPreview = details.slice(0, 4).join(' ');
  const functionRemainder = uniqueFunctions.length > 6 ? ` and ${uniqueFunctions.length - 6} more` : '';
  const actionRemainder = actions.length > 5 ? ` and ${actions.length - 5} more` : '';
  const title = cleanCategoryTitle(label || 'Category');

  if (!uniqueFunctions.length) {
    return `${title} groups related functional architecture elements. Add functions to this category to populate its generated description.`;
  }

  if (detailPreview) {
    return `${title} groups ${uniqueFunctions.length} function${uniqueFunctions.length === 1 ? '' : 's'} including ${functionPreview}${functionRemainder}. It covers the responsibilities, exchanged data/control actions, and constraints described by these functions and interfaces: ${detailPreview}`;
  }

  const actionSentence = actions.length
    ? ` It covers ${actions.length} interface/control action${actions.length === 1 ? '' : 's'}: ${actionPreview}${actionRemainder}, and should be reviewed for timing, data/state ownership, and receiver effects.`
    : '';

  return `${title} contains ${uniqueFunctions.length} function${uniqueFunctions.length === 1 ? '' : 's'}: ${functionPreview}${functionRemainder}.${actionSentence}`;
}

function stableAutoCategoryId(category, index) {
  const stableIndex = Number.isFinite(Number(category?.sourceIndex)) ? Number(category.sourceIndex) : index;
  const label = cleanCategoryTitle(category?.name || `Category ${index + 1}`);
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `g:auto:${stableIndex}:${slug || 'category'}`;
}

function buildAutoCategoryLayout(categories) {
  const gapX = AUTO_CATEGORY.gapX;
  const gapY = AUTO_CATEGORY.gapY;
  const nodeGapX = AUTO_CATEGORY.nodeGapX;
  const nodeGapY = AUTO_CATEGORY.nodeGapY;
  const innerPadX = AUTO_CATEGORY.padX;
  const innerPadTop = AUTO_CATEGORY.padTop;
  const innerPadBottom = AUTO_CATEGORY.padBottom;
  const startX = 80;
  const startY = 90;
  const boxes = [];
  const positionByFunction = new Map();
  const columns = categories.length > 4 ? 3 : 2;
  const planned = categories.map((category, categoryIndex) => {
    const functions = category.functions || [];
    const count = functions.length || 1;
    const innerCols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
    const innerRows = Math.max(1, Math.ceil((functions.length || 1) / innerCols));
    const maxRowCount = Math.min(innerCols, count);
    const contentWidth = maxRowCount * NODE_LAYOUT.w + (maxRowCount - 1) * nodeGapX;
    const width = Math.max(AUTO_CATEGORY.minW, innerPadX * 2 + contentWidth);
    const height = Math.max(AUTO_CATEGORY.minH, innerPadTop + innerPadBottom + innerRows * NODE_LAYOUT.h + (innerRows - 1) * nodeGapY);
    return {
      category,
      categoryIndex,
      functions,
      innerCols,
      innerRows,
      width: snap(width),
      height: snap(height),
    };
  });

  const colWidths = Array.from({ length: columns }, (_, col) =>
    Math.max(
      AUTO_CATEGORY.minW,
      ...planned.filter((item) => item.categoryIndex % columns === col).map((item) => item.width)
    )
  );
  const rowCount = Math.ceil(planned.length / columns);
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(
      AUTO_CATEGORY.minH,
      ...planned.filter((item) => Math.floor(item.categoryIndex / columns) === row).map((item) => item.height)
    )
  );
  const colX = colWidths.map((_, col) =>
    startX + colWidths.slice(0, col).reduce((sum, width) => sum + width + gapX, 0)
  );
  const rowY = rowHeights.map((_, row) =>
    startY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gapY, 0)
  );

  planned.forEach(({ category, categoryIndex, functions, innerCols, innerRows, width, height }) => {
    const col = categoryIndex % columns;
    const row = Math.floor(categoryIndex / columns);
    const position = {
      x: colX[col],
      y: rowY[row],
    };
    const label = cleanCategoryTitle(category.name);
    const box = {
      id: stableAutoCategoryId(category, categoryIndex),
      label,
      position,
      width,
      height,
      brandColor: COLOR_PRESETS[categoryIndex % COLOR_PRESETS.length],
      autoGenerated: true,
    };
    boxes.push(box);

    const gridHeight = innerRows * NODE_LAYOUT.h + (innerRows - 1) * nodeGapY;
    const gridStartY = innerPadTop + Math.max(0, (height - innerPadTop - innerPadBottom - gridHeight) / 2);

    functions.forEach((fn, functionIndex) => {
      const fnRow = Math.floor(functionIndex / innerCols);
      const rowStart = fnRow * innerCols;
      const rowCount = Math.min(innerCols, functions.length - rowStart);
      const fnCol = functionIndex - rowStart;
      const rowWidth = rowCount * NODE_LAYOUT.w + (rowCount - 1) * nodeGapX;
      const rowStartX = innerPadX + Math.max(0, (width - innerPadX * 2 - rowWidth) / 2);
      positionByFunction.set(fn, {
        parentId: box.id,
        boxPosition: position,
        position: {
          x: rowStartX + fnCol * (NODE_LAYOUT.w + nodeGapX),
          y: gridStartY + fnRow * (NODE_LAYOUT.h + nodeGapY),
        },
      });
    });
  });

  return { boxes, positionByFunction };
}

function applyCategoryLayoutToPositionMap({ categories, rows, posMap }) {
  const functions = getUniqueFunctionsFromRows(rows);
  const renderableFunctions = new Set(functions);
  const prunedCategories = (categories || [])
    .map((category) => ({
      ...category,
      functions: Array.from(new Set((category.functions || [])
        .map((fn) => String(fn || '').trim())
        .filter((fn) => fn && renderableFunctions.has(fn)))),
    }))
    .filter((category) => category.functions.length);
  if (!prunedCategories.length) return [];
  const { boxes, positionByFunction } = buildAutoCategoryLayout(prunedCategories);
  const functionsByGroupId = new Map(prunedCategories.map((category, index) => [
    stableAutoCategoryId(category, index),
    category.functions || [],
  ]));
  const categoryByGroupId = new Map(prunedCategories.map((category, index) => [
    stableAutoCategoryId(category, index),
    category,
  ]));

  boxes.forEach((box) => {
    const category = categoryByGroupId.get(box.id);
    box.description = String(category?.description || '').trim() || generateGroupDescription(box.label, functionsByGroupId.get(box.id) || [], rows);
    box.descriptionSource = category?.description ? 'prompt-wizard' : 'diagram-generated';
  });

  functions.forEach((fn, index) => {
    const placement = positionByFunction.get(fn);
    const id = nodeIdForFunction(fn);
    if (!id) return;
    if (placement) {
      posMap.set(id, {
        position: placement.position,
        parentId: placement.parentId,
      });
    } else {
      const prev = posMap.get(id);
      posMap.set(id, {
        position: prev?.position || seedPosition(index),
        parentId: null,
      });
    }
  });

  return boxes;
}

function isNodeInsideBox(node, box) {
  if (!node || !box) return false;
  const x = node.position?.x ?? 0;
  const y = node.position?.y ?? 0;
  const left = box.position.x;
  const top = box.position.y;
  const right = left + (box.width || GROUP.w);
  const bottom = top + (box.height || GROUP.h);
  return (
    x >= left &&
    y >= top &&
    x + NODE_LAYOUT.w <= right &&
    y + NODE_LAYOUT.h <= bottom
  );
}

function boxesOverlap(a, b, padding = 24) {
  if (!a || !b) return false;
  const aLeft = a.position?.x ?? 0;
  const aTop = a.position?.y ?? 0;
  const aRight = aLeft + (a.width || GROUP.w);
  const aBottom = aTop + (a.height || GROUP.h);
  const bLeft = b.position?.x ?? 0;
  const bTop = b.position?.y ?? 0;
  const bRight = bLeft + (b.width || GROUP.w);
  const bBottom = bTop + (b.height || GROUP.h);
  return (
    aLeft < bRight + padding &&
    aRight + padding > bLeft &&
    aTop < bBottom + padding &&
    aBottom + padding > bTop
  );
}

function serializeManualNode(node) {
  return {
    id: node.id,
    type: node.type || 'bidirectional',
    position: { ...(node.position || { x: 0, y: 0 }) },
    parentNode: node.parentNode || null,
    connectable: node.connectable !== false,
    data: {
      ...(node.data || {}),
    },
  };
}

/* ================================
 * One-time CLEAN PACK
 * ================================ */
function resolveOverlaps({ nodes, containerW, containerH, gap = 36, passes = 60 }) {
  const W = THEME.node.w;
  const H = THEME.node.h;
  const out = nodes.map((n) => ({ ...n, position: { ...n.position } }));

  const clampNode = (n) => {
    n.position.x = Math.min(Math.max(0, n.position.x), Math.max(0, (containerW || 1) - W));
    n.position.y = Math.min(Math.max(0, n.position.y), Math.max(0, (containerH || 1) - H));
  };

  for (let pass = 0; pass < passes; pass++) {
    let movedAny = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const acx = a.position.x + W / 2, acy = a.position.y + H / 2;
        const bcx = b.position.x + W / 2, bcy = b.position.y + H / 2;

        const overlapX = (W + gap) - Math.abs(acx - bcx);
        const overlapY = (H + gap) - Math.abs(acy - bcy);

        if (overlapX > 0 && overlapY > 0) {
          movedAny = true;
          const signX = acx === bcx ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(acx - bcx);
          const signY = acy === bcy ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(acy - bcy);
          const pushX = (overlapX / 2) * signX;
          const pushY = (overlapY / 2) * signY;

          a.position.x += pushX; a.position.y += pushY;
          b.position.x -= pushX; b.position.y -= pushY;

          clampNode(a); clampNode(b);
        }
      }
    }
    if (!movedAny) break;
  }
  return out;
}

/* ================================
 * Spread cleaned nodes
 * ================================ */
function spreadToViewport({ nodes, containerW, containerH, padX = THEME.canvas.padX, padY = THEME.canvas.padY }) {
  if (!nodes.length) return nodes;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    const { x, y } = n.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });

  const domainW = Math.max(1, maxX - minX);
  const domainH = Math.max(1, maxY - minY);

  const availW = Math.max(1, containerW - 2 * padX - THEME.node.w);
  const availH = Math.max(1, containerH - 2 * padY - THEME.node.h);

  const scaleX = availW / domainW;
  const scaleY = availH / domainH;

  return nodes.map((n) => {
    const nx = padX + (n.position.x - minX) * scaleX;
    const ny = padY + (n.position.y - minY) * scaleY;
    return { ...n, position: { x: nx, y: ny } };
  });
}

/* ================================
 * Component
 * ================================ */
const DiagramBody = forwardRef(function DiagramBody(
    { rows = [], onUpdateRows, storageKey = 'diagram:positions:v1', cleanOnceKey = null, onCleanApplied, fitAfterClean = true, autoCategories = null, hazardSummary = null, onOpenHazardRow },
    ref
) {
  const nodeTypes = useMemo(() => ({ bidirectional: BidirectionalNode, groupBox: GroupBoxNode, note: NoteNode }), []);

  const [nodes, setNodes, reactflowOnNodesChange] = useNodesState([]);
  const [edges, setEdges, reactflowOnEdgesChange] = useEdgesState([]);
  const hasGroups = useMemo(
    () => nodes.some((n) => n.type === 'groupBox'),
    [nodes]
  );
  const edgeTypes = useMemo(() => {
    const Smart = !hasGroups && typeof SmartBezierEdge === 'function' && SmartBezierEdge;
    return { smartBezier: Smart, smartStep: StepEdge };
  }, [hasGroups]);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState(null);
  const [groupBoxes, setGroupBoxes] = useState(() => loadGroupBoxes(storageKey));
  const [manualNodesStore, setManualNodesStore] = useState(() => loadManualNodes(storageKey));
  const [deletedAutoGroupIds, setDeletedAutoGroupIds] = useState(() => loadDeletedAutoGroupIds(storageKey));
  const [edgeAggregation, setEdgeAggregation] = useState(() => loadEdgeAggregationState(storageKey));
  const [edgeRouting, setEdgeRouting] = useState(() => loadEdgeRoutingState(storageKey));
  const [hydratedStorageKey, setHydratedStorageKey] = useState(storageKey);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const storageReady = hydratedStorageKey === storageKey;

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
        const stroke = e.data?.aggregated ? BRAND.purple : BRAND.blue;
        return {
          ...e,
          animated: isOn,
          style: {
            ...(e.style || {}),
            stroke,
            strokeWidth: isOn ? (e.data?.aggregated ? 6 : 4.5) : (e.data?.aggregated ? 5 : THEME.edge.width),
            opacity: isOn ? 1 : THEME.edge.opacity,
            filter: isOn ? 'drop-shadow(0 0 6px rgba(45,125,254,0.45))' : undefined,
          },
          markerEnd: e.markerEnd ?? { type: MarkerType.ArrowClosed, color: stroke, width: ARROW_SIZE, height: ARROW_SIZE },
        };
      }),
    [edges, highlightedEdgeId]
  );

  const diagramHostRef = useRef(null);
  const nodeIdCounter = useRef(0);
  const [editModal, setEditModal] = useState(null);

  const hazardHeaders = useMemo(() => (
    Array.isArray(hazardSummary?.[0]) ? hazardSummary[0].map((header) => String(header || '')) : []
  ), [hazardSummary]);

  const hazardDataRows = useMemo(() => (
    Array.isArray(hazardSummary) ? hazardSummary.slice(1) : []
  ), [hazardSummary]);

  const hazardTitleIndex = useMemo(() => {
    const exactHazardIdx = hazardHeaders.findIndex((header) => /^hazards?$/i.test(header.trim()));
    if (exactHazardIdx >= 0) return exactHazardIdx;
    const fallbackIdx = hazardHeaders.findIndex((header) =>
      /\bhazard\b|\bfailure mode\b|\brisk\b|\bscenario\b|\bevent\b/i.test(header)
    );
    return fallbackIdx >= 0 ? fallbackIdx : 0;
  }, [hazardHeaders]);

  const getHazardCardTitle = useCallback((cells, sourceIndex) => {
    const value = String(cells?.[hazardTitleIndex] ?? '').trim();
    return value || `Hazard ${sourceIndex + 1}`;
  }, [hazardTitleIndex]);

  const normalizeAssociationText = useCallback((value) => (
    String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  ), []);

  const getAssociatedHazardRows = useCallback((target) => {
    if (!hazardDataRows.length || !target) return [];

    const matchedIndexes = new Set();
    const isGroupTarget = target.type === 'node' && (target.nodeType === 'groupBox' || String(target.id || '').startsWith('g:'));

    if (isGroupTarget) {
      const childNodes = nodes.filter((node) => node.parentNode === target.id && node.type !== 'groupBox');
      const childLabels = new Set(
        childNodes
          .map((node) => normalizeAssociationText(node?.data?.label || String(node?.id || '').replace(/^n:/, '')))
          .filter(Boolean)
      );

      rows.forEach((row, idx) => {
        const from = normalizeAssociationText(row?.fromFunction);
        const to = normalizeAssociationText(row?.toFunction);
        if (childLabels.has(from) || childLabels.has(to)) matchedIndexes.add(idx);
      });
    } else if (target.type === 'node') {
      const label = normalizeAssociationText(target.label);
      if (!label) return [];

      rows.forEach((row, idx) => {
        const from = normalizeAssociationText(row?.fromFunction);
        const to = normalizeAssociationText(row?.toFunction);
        if (from === label || to === label) matchedIndexes.add(idx);
      });
    } else if (target.type === 'edge') {
      rows.forEach((row, idx) => {
        const edgeId = edgeIdForRow(row, idx);
        if (edgeId === target.id) matchedIndexes.add(idx);
      });
    }

    const associated = Array.from(matchedIndexes)
      .sort((a, b) => a - b)
      .map((idx) => ({ sourceIndex: idx, cells: hazardDataRows[idx] }))
      .filter((entry) => Array.isArray(entry.cells));

    return associated;
  }, [hazardDataRows, nodes, normalizeAssociationText, rows]);

  const editHazardRows = useMemo(
    () => getAssociatedHazardRows(editModal),
    [editModal, getAssociatedHazardRows]
  );

  const clearBrowserTextSelection = useCallback(() => {
    try {
      window.getSelection?.()?.removeAllRanges?.();
    } catch {}
  }, []);

  // positions map persisted across unmounts
  const posRef = useRef(loadPositions(storageKey));
  const groupSaveTimer = useRef(null);
  const manualSaveTimer = useRef(null);
  const saveTimer = useRef(null);
  const resizeFrameRef = useRef(null);
  const pendingGroupResizeRef = useRef(new Map());
  const groupBoxesRef = useRef(groupBoxes);
  const deletedAutoGroupIdsRef = useRef(deletedAutoGroupIds);
  const edgeAggregationRef = useRef(edgeAggregation);
  const edgeRoutingRef = useRef(edgeRouting);
  const storageKeyRef = useRef(storageKey);
  const appliedAutoCategoriesRef = useRef(null);
  const groupDragRef = useRef(null);
  const persistSoon = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePositions(storageKey, posRef.current), 120);
  }, [storageKey]);
  const persistGroupsSoon = useCallback((nextBoxes) => {
    groupBoxesRef.current = nextBoxes;
    if (groupSaveTimer.current) clearTimeout(groupSaveTimer.current);
    groupSaveTimer.current = setTimeout(() => saveGroupBoxes(storageKey, nextBoxes), 120);
  }, [storageKey]);
  const persistManualSoon = useCallback((nextManualNodes) => {
    if (manualSaveTimer.current) clearTimeout(manualSaveTimer.current);
    manualSaveTimer.current = setTimeout(() => saveManualNodes(storageKey, nextManualNodes), 120);
  }, [storageKey]);

  const builtCountRef = useRef(0);
  const builtOnceRef = useRef(false);
  const structureRef = useRef('');

  const flushGroupResizeAndPersistence = useCallback(({ updateState = true } = {}) => {
    if (resizeFrameRef.current) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    const pending = pendingGroupResizeRef.current;
    if (pending.size) {
      pendingGroupResizeRef.current = new Map();
      const baseBoxes = groupBoxesRef.current || [];
      const nextBoxes = baseBoxes.map((box) => {
        const nextSize = pending.get(box.id);
        if (!nextSize) return box;
        const width = nextSize.width;
        const height = nextSize.height;
        if (width === (box.width || GROUP.w) && height === (box.height || GROUP.h)) return box;
        return { ...box, width, height, userResized: true };
      });
      groupBoxesRef.current = nextBoxes;
      if (updateState) setGroupBoxes(nextBoxes);
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (groupSaveTimer.current) clearTimeout(groupSaveTimer.current);
    savePositions(storageKey, posRef.current);
    saveGroupBoxes(storageKey, groupBoxesRef.current);
  }, [storageKey]);

  // track which clean keys have been applied
  const cleanedKeysRef = useRef(new Set());

  // Track the connect drag start
  const connectStartRef = useRef(null);
  const edgeUpdateGestureRef = useRef({ active: false, oldEdgeId: null });
  const suppressedEdgeRemovalIdsRef = useRef(new Set());

  const { fitView, project, getNodes, getEdges, getViewport } = useReactFlow();

  useEffect(() => {
    groupBoxesRef.current = groupBoxes;
  }, [groupBoxes]);

  useEffect(() => {
    deletedAutoGroupIdsRef.current = deletedAutoGroupIds;
  }, [deletedAutoGroupIds]);

  useEffect(() => {
    edgeAggregationRef.current = edgeAggregation;
    if (storageKeyRef.current !== storageKey) return;
    saveEdgeAggregationState(storageKey, edgeAggregation);
  }, [edgeAggregation, storageKey]);

  useEffect(() => {
    edgeRoutingRef.current = edgeRouting;
    if (storageKeyRef.current !== storageKey) return;
    saveEdgeRoutingState(storageKey, edgeRouting);
  }, [edgeRouting, storageKey]);

  const getConnectableFunctionName = useCallback((nodeId) => {
    const node = getNodes().find((entry) => entry.id === nodeId) || nodes.find((entry) => entry.id === nodeId);
    if (!node || node.type === 'groupBox' || node.type === 'note') return '';
    if (!String(node.id || '').startsWith('n:')) return '';
    return normalizeFunctionName(node.data?.label || String(node.id).replace(/^n:/, ''));
  }, [getNodes, nodes]);

  const rebuildRenderedEdgesFromRows = useCallback((nextRows, sourceNodes = null) => {
    const graphNodes = sourceNodes || getNodes();
    const rawEdges = rowsToRawEdges(nextRows);
    setEdges(buildEdgesFromRaw(rawEdges, buildAbsolutePositionMap(graphNodes), edgeAggregationRef.current, edgeRoutingRef.current));
  }, [getNodes, setEdges]);

  useEffect(() => {
    storageKeyRef.current = storageKey;
    setHydratedStorageKey(null);
    posRef.current = loadPositions(storageKey);
    const loadedDeletedAutoGroupIds = loadDeletedAutoGroupIds(storageKey);
    deletedAutoGroupIdsRef.current = loadedDeletedAutoGroupIds;
    setDeletedAutoGroupIds(loadedDeletedAutoGroupIds);
    const loadedGroupBoxes = pruneGroupBoxesForProject(
      loadGroupBoxes(storageKey),
      autoCategories,
      rows,
      loadedDeletedAutoGroupIds
    );
    const positionsChanged = prunePositionParentsForGroups(posRef.current, loadedGroupBoxes);
    groupBoxesRef.current = loadedGroupBoxes;
    setGroupBoxes(loadedGroupBoxes);
    saveGroupBoxes(storageKey, loadedGroupBoxes);
    if (positionsChanged) savePositions(storageKey, posRef.current);
    setManualNodesStore(loadManualNodes(storageKey));
    const loadedEdgeAggregation = loadEdgeAggregationState(storageKey);
    edgeAggregationRef.current = loadedEdgeAggregation;
    setEdgeAggregation(loadedEdgeAggregation);
    const loadedEdgeRouting = loadEdgeRoutingState(storageKey);
    edgeRoutingRef.current = loadedEdgeRouting;
    setEdgeRouting(loadedEdgeRouting);
    setNodes([]);
    setEdges([]);
    setSelectedNodeIds([]);
    setContextMenu(null);
    setEditModal(null);
    builtOnceRef.current = false;
    structureRef.current = '';
    builtCountRef.current = 0;
    appliedAutoCategoriesRef.current = null;
    setHydratedStorageKey(storageKey);
  }, [storageKey, setEdges, setNodes]);

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

useEffect(() => {
  const swallowResizeObserverNoise = (event) => {
    const message = event?.message || event?.reason?.message || '';
    if (
      message.includes('ResizeObserver loop completed with undelivered notifications') ||
      message.includes('ResizeObserver loop limit exceeded')
    ) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    }
  };

  window.addEventListener('error', swallowResizeObserverNoise);
  window.addEventListener('unhandledrejection', swallowResizeObserverNoise);
  return () => {
    window.removeEventListener('error', swallowResizeObserverNoise);
    window.removeEventListener('unhandledrejection', swallowResizeObserverNoise);
  };
}, []);

  function findNodeUnderPointer(evt) {
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
  }

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
      if (edgeUpdateGestureRef.current.active) return;

      const fromId = start.nodeId;
      const toId = targetNode.id;
      if (fromId === toId) return;
      const fromFunction = getConnectableFunctionName(fromId);
      const toFunction = getConnectableFunctionName(toId);
      if (!fromFunction || !toFunction) return;

      const srcNode = nodes.find((n) => n.id === fromId);
      const tgtNode = nodes.find((n) => n.id === toId);
      if (srcNode?.position) posRef.current.set(fromId, { position: { ...srcNode.position }, parentId: srcNode.parentNode || null });
      if (tgtNode?.position) posRef.current.set(toId, { position: { ...tgtNode.position }, parentId: tgtNode.parentNode || null });
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
        type: edgeTypeForRoutingStyle(edgeRoutingRef.current.defaultStyle),
        style: { strokeWidth: 3, stroke: BRAND.blue },
        markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
      };

      setEdges((eds) => addEdge(newEdge, eds));

      onUpdateRows?.([
        ...rows,
        {
          fromFunction,
          fromDetails: '',
          controlAction: '',
          controlDetails: '',
          toFunction,
          toDetails: '',
          sourceHandle,
          targetHandle,
        },
      ]);
    },
    [getConnectableFunctionName, nodes, edges, rows, onUpdateRows, persistSoon]
  );

  useEffect(() => {
    return () => {
      flushGroupResizeAndPersistence({ updateState: false });
      if (manualSaveTimer.current) clearTimeout(manualSaveTimer.current);
      saveManualNodes(storageKey, manualNodesStore);
    };
  }, [flushGroupResizeAndPersistence, storageKey, manualNodesStore]);

  const queueGroupResizeUpdate = useCallback((id, dimensions) => {
    if (!id || !dimensions) return;
    const rawWidth = Number(dimensions.width);
    const rawHeight = Number(dimensions.height);
    if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) return;
    const width = Math.max(GROUP.minW, Math.round(rawWidth));
    const height = Math.max(GROUP.minH, Math.round(rawHeight));

    pendingGroupResizeRef.current.set(id, {
      width,
      height,
    });
    setNodes((nds) => nds.map((node) => (
      node.id === id
        ? {
            ...node,
            style: {
              ...(node.style || {}),
              width,
              height,
            },
          }
        : node
    )));

    if (resizeFrameRef.current) return;

    resizeFrameRef.current = requestAnimationFrame(() => {
      flushGroupResizeAndPersistence();
    });
  }, [flushGroupResizeAndPersistence, setNodes]);

  const exportDiagramJson = useCallback(() => {
    const exportedAt = new Date().toISOString();
    const payload = {
      schema: 'xhandle.functional-diagram.v1',
      exportedAt,
      storageKey,
      viewport: typeof getViewport === 'function' ? getViewport() : null,
      functionalDecomposition: rows,
      nodes: getNodes().map(cleanNodeForExport),
      edges: getEdges().map(cleanEdgeForExport),
      groups: groupBoxes,
      manualNodes: manualNodesStore,
      autoCategories,
    };
    downloadJson(payload, `xHandle-diagram-${exportedAt.slice(0, 10)}.json`);
  }, [autoCategories, getEdges, getNodes, getViewport, groupBoxes, manualNodesStore, rows, storageKey]);

  const refreshEdgesFromNodes = useCallback((nextNodes) => {
    const raw = rowsToRawEdges(rows);
    setEdges(buildEdgesFromRaw(raw, positionsAbsMapFromRF(nextNodes), edgeAggregationRef.current, edgeRoutingRef.current));
  }, [rows, setEdges]);

  const growGroupToFitMembers = useCallback((groupId, sourceNodes = null) => {
    if (!groupId) return;
    const currentNodes = sourceNodes || getNodes();
    const childNodes = currentNodes.filter((node) => node.parentNode === groupId && node.type !== 'groupBox');
    setGroupBoxes((currentBoxes) => {
      const existingBox = currentBoxes.find((box) => box.id === groupId);
      if (!existingBox) return currentBoxes;
      if (existingBox.userResized) return currentBoxes;

      const nextSize = sizeGroupToFitChildren(existingBox, childNodes);
      if (nextSize.width === (existingBox.width || GROUP.w) && nextSize.height === (existingBox.height || GROUP.h)) {
        return currentBoxes;
      }

      const nextBoxes = currentBoxes.map((box) => (
        box.id === groupId ? { ...box, ...nextSize } : box
      ));
      persistGroupsSoon(nextBoxes);
      return nextBoxes;
    });
  }, [getNodes, persistGroupsSoon]);

  const assignNodesToGroup = useCallback((nodeIds, groupId) => {
    const targetBox = groupBoxes.find((box) => box.id === groupId);
    if (!targetBox || !nodeIds?.length) return;

    let nextNodesSnapshot = null;
    setNodes((nds) => {
      const byId = new Map(nds.map((n) => [n.id, n]));
      const nextNodes = nds.map((node) => {
        if (!nodeIds.includes(node.id) || node.type === 'groupBox') return node;
        const abs = getNodeAbsolutePosition(node, byId);
        const relative = clampToGroup(
          { x: abs.x - targetBox.position.x, y: abs.y - targetBox.position.y },
          targetBox
        );
        posRef.current.set(node.id, { position: relative, parentId: groupId });
        return { ...node, parentNode: groupId, position: relative };
      });
      nextNodesSnapshot = nextNodes;
      return nextNodes;
    });
    persistSoon();
    setContextMenu(null);
    setTimeout(() => {
      const latestNodes = nextNodesSnapshot || getNodes();
      growGroupToFitMembers(groupId, latestNodes);
      refreshEdgesFromNodes(latestNodes);
    }, 0);
  }, [getNodes, groupBoxes, growGroupToFitMembers, persistSoon, refreshEdgesFromNodes, setNodes]);

  const ungroupNodes = useCallback((nodeIds) => {
    if (!nodeIds?.length) return;
    setNodes((nds) => {
      const byId = new Map(nds.map((n) => [n.id, n]));
      return nds.map((node) => {
        if (!nodeIds.includes(node.id) || node.type === 'groupBox' || !node.parentNode) return node;
        const abs = getNodeAbsolutePosition(node, byId);
        posRef.current.set(node.id, { position: abs, parentId: null });
        return { ...node, parentNode: undefined, extent: undefined, position: abs };
      });
    });
    persistSoon();
    setContextMenu(null);
    setTimeout(() => refreshEdgesFromNodes(getNodes()), 0);
  }, [getNodes, persistSoon, refreshEdgesFromNodes, setNodes]);

  useEffect(() => {
    if (!storageReady) return;
    const signature = autoCategories?.signature || rowCategorySignature(rows);
    if (!Array.isArray(autoCategories?.categories)) return;
    const categories = autoCategories.categories;
    const activeCategories = normalizeCategories({ categories }, rows)
      .filter((category, index) => !deletedAutoGroupIds.has(stableAutoCategoryId(category, index)));
    const activeAutoGroupIds = new Set(activeCategories.map((category, index) => stableAutoCategoryId(category, index)));
    if (groupDragRef.current) return;
    if (groupBoxes.some((box) => box.autoGenerated && !activeAutoGroupIds.has(box.id))) {
      setGroupBoxes((currentBoxes) => {
        const nextBoxes = currentBoxes.filter((box) => !box.autoGenerated || activeAutoGroupIds.has(box.id));
        if (nextBoxes.length !== currentBoxes.length) {
          groupBoxesRef.current = nextBoxes;
          persistGroupsSoon(nextBoxes);
          return nextBoxes;
        }
        return currentBoxes;
      });
      return;
    }
    const wantedNodeIds = buildWantedNodeIdSet(rows);
    const functionalNodes = nodes.filter((node) => wantedNodeIds.has(node.id) && node.type !== 'groupBox');
    const autoBoxesOverlap = groupBoxes.some((box, index) => (
      box.autoGenerated &&
      groupBoxes.slice(index + 1).some((nextBox) => nextBox.autoGenerated && boxesOverlap(box, nextBox))
    ));
    const needsAutoCategoryRepair = Boolean(
      categories.length &&
      groupBoxes.length &&
      groupBoxes.every((box) => box.autoGenerated) &&
      (
        autoBoxesOverlap ||
        functionalNodes.some((node) => (
          !node.parentNode ||
          !groupBoxes.some((box) => box.id === node.parentNode)
        ))
      )
    );
    const savedAutoGroupIds = new Set(groupBoxes.filter((box) => box.autoGenerated).map((box) => box.id));
    const hasCompleteSavedAutoLayout = Boolean(
      activeAutoGroupIds.size &&
      savedAutoGroupIds.size === activeAutoGroupIds.size &&
      Array.from(activeAutoGroupIds).every((id) => savedAutoGroupIds.has(id))
    );
    if (hasCompleteSavedAutoLayout && !needsAutoCategoryRepair) {
      appliedAutoCategoriesRef.current = signature;
      return;
    }
    if (!activeCategories.length || (appliedAutoCategoriesRef.current === signature && !needsAutoCategoryRepair)) return;
    if (groupBoxes.some((box) => !box.autoGenerated)) return;

    const boxes = applyCategoryLayoutToPositionMap({
      categories: activeCategories,
      rows,
      posMap: posRef.current,
    });
    if (!boxes.length) return;

    appliedAutoCategoriesRef.current = signature;
    groupBoxesRef.current = boxes;
    setGroupBoxes(boxes);
    saveGroupBoxes(storageKey, boxes);
    savePositions(storageKey, posRef.current);
    saveAutoCategoryMeta(storageKey, {
      signature,
      categoryCount: boxes.length,
      source: autoCategories?.source || 'wizard',
      generatedAt: autoCategories?.generatedAt || new Date().toISOString(),
    });
    structureRef.current = '';
  }, [autoCategories, rows, groupBoxes, nodes, storageKey, deletedAutoGroupIds, persistGroupsSoon, setGroupBoxes, storageReady]);

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
    const categories = Array.isArray(autoCategories?.categories) ? autoCategories.categories : [];
    if (categories.length && groupBoxes.every((box) => box.autoGenerated)) {
      const boxes = applyCategoryLayoutToPositionMap({
        categories: normalizeCategories({ categories }, rows),
        rows,
        posMap: posRef.current,
      });
      if (boxes.length) {
        groupBoxesRef.current = boxes;
        setGroupBoxes(boxes);
        saveGroupBoxes(storageKey, boxes);
        savePositions(storageKey, posRef.current);
        structureRef.current = '';
        persistSoon();
        setTimeout(() => fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true }), 0);
        return;
      }
    }

    const movableNodes = nodes.filter((n) => n.type !== 'groupBox' && !n.parentNode);
    const elkNodes = await runElkLayoutOnce({ nodes: movableNodes, edges });
    setNodes((nds) => {
      const laidById = new Map(elkNodes.map((n) => [n.id, n.position]));
      return nds.map((n) => {
        if (!laidById.has(n.id)) return n;
        return { ...n, position: laidById.get(n.id) };
      });
    });
    elkNodes.forEach((n) => posRef.current.set(n.id, { position: { ...n.position }, parentId: null }));
    persistSoon();
    savePositions(storageKey, posRef.current);
    const rawEdges = rowsToRawEdges(rows);
    const absolutePositions = buildAbsolutePositionMap(
      nodes.map((node) => {
        const match = elkNodes.find((laid) => laid.id === node.id);
        return match ? { ...node, position: match.position } : node;
      })
    );
    setEdges(buildEdgesFromRaw(rawEdges, absolutePositions, edgeAggregationRef.current, edgeRoutingRef.current));
    if (fitAfterClean) setTimeout(() => fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true }), 0);
  }, [autoCategories, groupBoxes, nodes, edges, rows, storageKey, fitAfterClean, fitView, persistSoon]);

  const canvasSpawnPosition = useCallback((offset = { x: 96, y: 108 }) => {
    const local = { x: offset.x, y: offset.y };
    try {
      return project(local);
    } catch {
      return { x: local.x, y: local.y };
    }
  }, [project]);

  const addManualDiagramNode = useCallback(() => {
    const existing = collectExistingLabels(getNodes(), rows);
    const label = makeUniqueNewLabel(existing);
    const id = nodeIdForFunction(label);
    const position = nearestFreePosition(canvasSpawnPosition(), getNodes());
    const newNode = {
      id,
      type: 'bidirectional',
      position,
      data: { label, description: '', brandColor: BRAND.purple, brandTint: rgba(BRAND.purple, 0.08) },
    };
    setNodes((nds) => [...nds, newNode]);
    posRef.current.set(id, { position, parentId: null });
    persistSoon();
  }, [canvasSpawnPosition, getNodes, persistSoon, rows, setNodes]);

  const addNoteNode = useCallback(() => {
    const existingNotes = getNodes().filter((node) => node.type === 'note').length;
    const id = `note:${cryptoId()}`;
    const position = nearestFreePosition(canvasSpawnPosition({ x: 128, y: 128 }), getNodes());
    const noteNode = {
      id,
      type: 'note',
      position,
      data: {
        label: `Note ${existingNotes + 1}`,
        description: '',
        brandColor: BRAND.yellow,
        brandTint: rgba(BRAND.yellow, 0.2),
      },
    };
    setNodes((nds) => [...nds, noteNode]);
    posRef.current.set(id, { position, parentId: null });
    persistSoon();
  }, [canvasSpawnPosition, getNodes, persistSoon, setNodes]);

  const createGroupBox = useCallback(() => {
    const currentNodes = getNodes();
    const selectedNodes = currentNodes.filter((node) => (
      selectedNodeIds.includes(node.id) &&
      node.type !== 'groupBox' &&
      !node.id.startsWith('g:')
    ));
    const groupId = `g:${cryptoId()}`;
    const groupCount = groupBoxes.length + 1;
    let position = canvasSpawnPosition({ x: 96, y: 96 });
    let width = GROUP.w;
    let height = GROUP.h;

    if (selectedNodes.length) {
      const byId = new Map(currentNodes.map((node) => [node.id, node]));
      const bounds = selectedNodes.reduce((acc, node) => {
        const abs = getNodeAbsolutePosition(node, byId);
        return {
          minX: Math.min(acc.minX, abs.x),
          minY: Math.min(acc.minY, abs.y),
          maxX: Math.max(acc.maxX, abs.x + THEME.node.w),
          maxY: Math.max(acc.maxY, abs.y + THEME.node.h),
        };
      }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      position = {
        x: Math.max(0, bounds.minX - GROUP.padX),
        y: Math.max(0, bounds.minY - GROUP.padTop),
      };
      width = Math.max(GROUP.minW, bounds.maxX - bounds.minX + GROUP.padX * 2);
      height = Math.max(GROUP.minH, bounds.maxY - bounds.minY + GROUP.padTop + GROUP.padBottom);
    }

    const newBox = {
      id: groupId,
      label: `Group ${groupCount}`,
      description: '',
      position,
      width,
      height,
      brandColor: BRAND.purple,
      userResized: false,
      autoGenerated: false,
    };

    setGroupBoxes((currentBoxes) => {
      const nextBoxes = [...currentBoxes, newBox];
      persistGroupsSoon(nextBoxes);
      return nextBoxes;
    });

    if (selectedNodes.length) {
      const byId = new Map(currentNodes.map((node) => [node.id, node]));
      setNodes((nds) => nds.map((node) => {
        if (!selectedNodeIds.includes(node.id) || node.type === 'groupBox') return node;
        const abs = getNodeAbsolutePosition(node, byId);
        const relative = clampToGroup({ x: abs.x - position.x, y: abs.y - position.y }, newBox);
        posRef.current.set(node.id, { position: relative, parentId: groupId });
        return { ...node, parentNode: groupId, extent: 'parent', position: relative };
      }));
      persistSoon();
      setTimeout(() => refreshEdgesFromNodes(getNodes()), 0);
    }
  }, [canvasSpawnPosition, getNodes, groupBoxes.length, persistGroupsSoon, persistSoon, refreshEdgesFromNodes, selectedNodeIds, setNodes]);

  const ungroupSelectedNodes = useCallback(() => {
    const selected = selectedNodeIds.length ? selectedNodeIds : getNodes().filter((node) => node.parentNode).map((node) => node.id);
    ungroupNodes(selected);
  }, [getNodes, selectedNodeIds, ungroupNodes]);

  const exportDiagramXml = useCallback(() => {
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
  }, [getEdges, getNodes]);

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
    exportJson() {
      exportDiagramJson();
    },
        exportDrawio() {
      exportDiagramXml();
    },
  }));

  const onNodesChange = useCallback(
    (changes) => {
      changes.forEach((c) => {
        if (c.type === 'position' && c.id && c.position) {
          const prev = posRef.current.get(c.id) || { position: c.position, parentId: null };
          posRef.current.set(c.id, { ...prev, position: { ...c.position } });
          persistSoon();
        }
        if (c.type === 'dimensions' && c.id && c.dimensions) {
          const targetBox = groupBoxes.find((box) => box.id === c.id);
          if (targetBox) {
            queueGroupResizeUpdate(c.id, c.dimensions);
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
        const deletedGroups = groupBoxes.filter((box) => deletedIds.has(box.id));
        if (deletedGroups.length) {
          const deletedAutoIds = deletedGroups
            .filter((box) => box.autoGenerated)
            .map((box) => box.id);
          if (deletedAutoIds.length) {
            setDeletedAutoGroupIds((currentIds) => {
              const nextIds = new Set(currentIds);
              deletedAutoIds.forEach((id) => nextIds.add(id));
              deletedAutoGroupIdsRef.current = nextIds;
              saveDeletedAutoGroupIds(storageKey, nextIds);
              return nextIds;
            });
          }
          setGroupBoxes((currentBoxes) => {
            const nextBoxes = currentBoxes.filter((box) => !deletedIds.has(box.id));
            persistGroupsSoon(nextBoxes);
            return nextBoxes;
          });
          setNodes((nds) => {
            const byId = new Map(nds.map((n) => [n.id, n]));
            return nds.map((n) => {
              if (!n.parentNode || !deletedIds.has(n.parentNode)) return n;
              const abs = getNodeAbsolutePosition(n, byId);
              posRef.current.set(n.id, { position: abs, parentId: null });
              return { ...n, parentNode: undefined, extent: undefined, position: abs };
            });
          });
        }
        const updatedRows = rows.filter((r) => {
          const fromId = nodeIdForFunction(r.fromFunction);
          const toId = nodeIdForFunction(r.toFunction);
          return !deletedIds.has(fromId) && !deletedIds.has(toId);
        });
        onUpdateRows?.(updatedRows);
      }
      reactflowOnNodesChange(changes);
    },
    [rows, reactflowOnNodesChange, onUpdateRows, persistSoon, groupBoxes, queueGroupResizeUpdate, persistGroupsSoon, setNodes, storageKey]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      const removals = changes
        .filter((c) => c.type === 'remove')
        .map((c) => c.id)
        .filter((id) => !suppressedEdgeRemovalIdsRef.current.has(id));
      if (removals.length) {
        const removalSet = new Set(removals);
        const updatedRows = rows.filter((r, i) => !removalSet.has(edgeIdForRow(r, i)));
        onUpdateRows?.(updatedRows);
      }
      reactflowOnEdgesChange(changes.filter((change) => (
        change.type !== 'remove' || !suppressedEdgeRemovalIdsRef.current.has(change.id)
      )));
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
    if (!storageReady) return;
    let cancelled = false;

    const sig = structureSignature(rows);
    const groupSig = JSON.stringify(groupBoxes.map((box) => [box.id, box.label, box.description, box.brandColor, box.autoGenerated]));
    const fullSig = `${sig}::${groupSig}`;
    const structureUnchanged = builtOnceRef.current && fullSig === structureRef.current;
    if (structureUnchanged) return;

    const wantedNodeIds = new Set();
    rows.forEach((row) => {
      const fromId = nodeIdForFunction(row.fromFunction);
      const toId = nodeIdForFunction(row.toFunction);
      if (fromId) wantedNodeIds.add(fromId);
      if (toId) wantedNodeIds.add(toId);
    });

// Convert to array and sort for consistent indexing
const sortedNodeIds = Array.from(wantedNodeIds).sort();

const groupNodes = groupBoxes.map((box) => ({
  id: box.id,
  type: 'groupBox',
  position: box.position,
  data: {
    label: box.label,
    description: box.description || '',
    brandColor: box.brandColor || BRAND.purple,
    onResize: (dimensions) => queueGroupResizeUpdate(box.id, dimensions),
  },
  zIndex: 0,
  style: {
    width: box.width || GROUP.w,
    height: box.height || GROUP.h,
    zIndex: 0,
    padding: 0,
    border: 'none',
    background: 'transparent',
    boxShadow: 'none',
    pointerEvents: 'none',
  },
  draggable: true,
  selectable: true,
  dragHandle: '.project-group-drag-handle',
  connectable: false,
  focusable: false,
}));

const nodeShellStyle = {
  zIndex: 2,
  padding: 0,
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
};

const nextFunctionalNodes = sortedNodeIds.map((id, index) => {
  // Check if we have a saved position
  const saved = posRef.current.get(id);
  let pos = saved?.position;
  const savedParentId = saved?.parentId && groupBoxes.some((box) => box.id === saved.parentId) ? saved.parentId : null;
  const parentId = savedParentId;
  
  // If no saved position, create a better spread
  if (!pos) {
    pos = seedPosition(index); // Use the sorted index
    posRef.current.set(id, { position: pos, parentId: null });
    persistSoon();
  }
  
  const existing = nodes.find((n) => n.id === id && n.type !== 'groupBox');
  if (existing) {
    return {
      ...existing,
      zIndex: 2,
      position: parentId ? clampToGroup(pos, groupBoxes.find((box) => box.id === parentId)) : pos,
      parentNode: parentId || undefined,
      extent: parentId ? 'parent' : undefined,
      style: {
        ...(existing.style || {}),
        ...nodeShellStyle,
      },
    };
  }
  
  const name = id.replace(/^n:/, '');
  return {
    id,
    type: 'bidirectional',
    zIndex: 2,
    position: parentId ? clampToGroup(pos, groupBoxes.find((box) => box.id === parentId)) : pos,
    parentNode: parentId || undefined,
    extent: parentId ? 'parent' : undefined,
    style: nodeShellStyle,
    data: {
      label: name,
      description: '',
      brandColor: BRAND.blue,
      brandTint: rgba(BRAND.blue, 0.08),
    },
  };
});

    const scopedManualNodes = manualNodesStore.filter((node) => !wantedNodeIds.has(node.id));
    if (scopedManualNodes.length !== manualNodesStore.length) {
      setManualNodesStore(scopedManualNodes);
      persistManualSoon(scopedManualNodes);
    }

    const manualNodes = scopedManualNodes.map((node) => {
      const saved = posRef.current.get(node.id);
      const fallbackPosition = node.position || { x: 0, y: 0 };
      const position = saved?.position || fallbackPosition;
      const parentId =
        saved?.parentId && groupBoxes.some((box) => box.id === saved.parentId)
          ? saved.parentId
          : node.parentNode && groupBoxes.some((box) => box.id === node.parentNode)
            ? node.parentNode
            : null;

      if (!saved) {
        posRef.current.set(node.id, { position, parentId });
        persistSoon();
      }

      return {
        ...node,
        zIndex: parentId ? 2 : node.zIndex,
        position: parentId ? clampToGroup(position, groupBoxes.find((box) => box.id === parentId)) : position,
        parentNode: parentId || undefined,
        extent: parentId ? 'parent' : undefined,
        style: parentId
          ? {
              ...(node.style || {}),
              zIndex: 2,
            }
          : node.style,
      };
    });

    const nextNodes = [...groupNodes, ...nextFunctionalNodes, ...manualNodes];
    const rawEdges = rowsToRawEdges(rows);
    const nextEdges = buildEdgesFromRaw(rawEdges, buildAbsolutePositionMap(nextNodes), edgeAggregationRef.current, edgeRoutingRef.current);

    if (!cancelled) {
      setNodes(nextNodes);
      setEdges(nextEdges);
      builtOnceRef.current = true;
      structureRef.current = fullSig;
      
      // Auto-arrange when loading project data with multiple nodes
// Auto-arrange when loading project data with multiple nodes
if (nextFunctionalNodes.length > 1) {
  const hasNewNodes = sortedNodeIds.some(id => {
    const savedPos = posRef.current.get(id)?.position;
    // Consider it "new" if no saved position OR if it's still at the default seed position
    return !savedPos || (savedPos.x === seedPosition(0).x && savedPos.y === seedPosition(0).y);
  });
  
  if (hasNewNodes) {
    setTimeout(async () => {
      if (!cancelled) {
        // Use the same ELK layout as manual button
        const currentNodes = getNodes();
        const currentEdges = getEdges();
        const movableNodes = currentNodes.filter((n) => n.type !== 'groupBox' && !n.parentNode);
        const elkNodes = await runElkLayoutOnce({ nodes: movableNodes, edges: currentEdges });
        setNodes((nds) => {
          const laidById = new Map(elkNodes.map((n) => [n.id, n.position]));
          return nds.map((n) => (laidById.has(n.id) ? { ...n, position: laidById.get(n.id) } : n));
        });
        elkNodes.forEach((n) => posRef.current.set(n.id, { position: { ...n.position }, parentId: null }));
        persistSoon();
        savePositions(storageKey, posRef.current);
        const rawEdges = rowsToRawEdges(rows);
        const absolutePositions = buildAbsolutePositionMap(
          currentNodes.map((node) => {
            const laid = elkNodes.find((n) => n.id === node.id);
            return laid ? { ...node, position: laid.position } : node;
          })
        );
        setEdges(buildEdgesFromRaw(rawEdges, absolutePositions, edgeAggregationRef.current, edgeRoutingRef.current));
        if (fitAfterClean) {
          setTimeout(() => fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true }), 0);
        }
      }
    }, 200); // Slightly longer delay to ensure React Flow has rendered
  }
}
    }
    return () => { cancelled = true; };
  }, [rows, persistSoon, nodes, setNodes, setEdges, runCleanAndSpread, groupBoxes, queueGroupResizeUpdate, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    if (!groupBoxes.length) return;
    if (groupDragRef.current) return;

    setGroupBoxes((currentBoxes) => {
      const nextBoxes = currentBoxes.map((box) => {
        if (box.descriptionUserEdited) return box;
        if (box.descriptionSource === 'prompt-wizard' && box.description) return box;
        const childFunctions = nodes
          .filter((node) => node.parentNode === box.id && node.type !== 'groupBox')
          .map((node) => String(node?.data?.label || '').trim())
          .filter(Boolean);
        const generatedDescription = generateGroupDescription(box.label, childFunctions, rows);
        if (box.description === generatedDescription) return box;
        return { ...box, description: generatedDescription };
      });

      const changed = nextBoxes.some((box, index) => box.description !== currentBoxes[index]?.description);
      if (changed) {
        persistGroupsSoon(nextBoxes);
        return nextBoxes;
      }
      return currentBoxes;
    });
  }, [groupBoxes, nodes, rows, persistGroupsSoon, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    if (!groupBoxes.length || !nodes.length) return;
    if (groupDragRef.current) return;
    setGroupBoxes((currentBoxes) => {
      const nextBoxes = currentBoxes.map((box) => {
        if (box.autoGenerated) return box;
        const childNodes = nodes.filter((node) => node.parentNode === box.id && node.type !== 'groupBox');
        if (box.userResized) return box;
        const nextSize = sizeGroupToFitChildren(box, childNodes);
        if (nextSize.width === (box.width || GROUP.w) && nextSize.height === (box.height || GROUP.h)) {
          return box;
        }
        return { ...box, ...nextSize };
      });

      const changed = nextBoxes.some((box, index) => (
        box.width !== currentBoxes[index]?.width ||
        box.height !== currentBoxes[index]?.height ||
        box.position?.x !== currentBoxes[index]?.position?.x ||
        box.position?.y !== currentBoxes[index]?.position?.y ||
        box.userResized !== currentBoxes[index]?.userResized
      ));

      if (changed) {
        persistGroupsSoon(nextBoxes);
        return nextBoxes;
      }

      return currentBoxes;
    });
  }, [autoCategories, groupBoxes, nodes, rows, persistGroupsSoon, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    if (!builtOnceRef.current) return;
    const wantedNodeIds = buildWantedNodeIdSet(rows);
    const nextManualNodes = nodes
      .filter((node) => node.type !== 'groupBox' && !wantedNodeIds.has(node.id))
      .map((node) => serializeManualNode(node));

    const prevSig = JSON.stringify(manualNodesStore);
    const nextSig = JSON.stringify(nextManualNodes);
    if (prevSig === nextSig) return;

    setManualNodesStore(nextManualNodes);
    persistManualSoon(nextManualNodes);
  }, [nodes, rows, manualNodesStore, persistManualSoon, storageReady]);

  // Sync labels/details without moving nodes
  useEffect(() => {
    if (!storageReady) return;
    if (!builtOnceRef.current) return;

    const nodeDetails = new Map();
    const edgeDetails = new Map();

    rows.forEach((r, idx) => {
      const fromLabel = normalizeFunctionName(r.fromFunction);
      const toLabel = normalizeFunctionName(r.toFunction);
      const fromId = nodeIdForFunction(fromLabel);
      const toId = nodeIdForFunction(toLabel);
      if (fromId) nodeDetails.set(fromId, { label: fromLabel, description: r.fromDetails || '' });
      if (toId) {
        nodeDetails.set(toId, { label: toLabel, description: r.toDetails || '' });
        const edgeId = edgeIdForRow(r, idx);
        if (edgeId) edgeDetails.set(edgeId, { label: r.controlAction || '', description: r.controlDetails || '' });
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
  }, [rows, setNodes, setEdges, storageReady]);

  /* One-time clean+spread trigger */
  useEffect(() => {
    if (!storageReady) return;
    if (!cleanOnceKey) return;
    if (cleanedKeysRef.current.has(cleanOnceKey)) return;
    if (!nodes.length) return;

    if (Array.isArray(autoCategories?.categories) && autoCategories.categories.length) {
      setTimeout(() => {
        try { fitView({ padding: 0.2, duration: 600, includeHiddenNodes: true }); } catch {}
      }, 120);
      cleanedKeysRef.current.add(cleanOnceKey);
      try { onCleanApplied?.(cleanOnceKey); } catch {}
      return;
    }

    runCleanAndSpread();
    cleanedKeysRef.current.add(cleanOnceKey);
    // tell parent we consumed the key so it won't fire on remount
    try { onCleanApplied?.(cleanOnceKey); } catch {}
  }, [cleanOnceKey, nodes, autoCategories, fitView, runCleanAndSpread, onCleanApplied, storageReady]);

  /* Connect / Update */
  const onConnect = useCallback(
    (connection) => {
      if (edgeUpdateGestureRef.current.active) return;
      const fromFunction = getConnectableFunctionName(connection.source);
      const toFunction = getConnectableFunctionName(connection.target);
      if (!fromFunction || !toFunction || fromFunction === toFunction) return;
      setEdges((eds) => {
        const count = eds.filter(
          (e) =>
            (e.source === connection.source && e.target === connection.target) ||
            (e.source === connection.target && e.target === connection.source)
        ).length;

        const newEdge = {
          ...connection,
          animated: false,
          type: edgeTypeForRoutingStyle(edgeRoutingRef.current.defaultStyle),
          style: { strokeWidth: 3 },
          markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
        };

        const srcNode = nodes.find((n) => n.id === connection.source);
        const tgtNode = nodes.find((n) => n.id === connection.target);
        const srcBuiltId = nodeIdForFunction(fromFunction);
        const tgtBuiltId = nodeIdForFunction(toFunction);
        if (srcNode?.position && srcBuiltId) posRef.current.set(srcBuiltId, { position: { ...srcNode.position }, parentId: srcNode.parentNode || null });
        if (tgtNode?.position && tgtBuiltId) posRef.current.set(tgtBuiltId, { position: { ...tgtNode.position }, parentId: tgtNode.parentNode || null });
        persistSoon();

        onUpdateRows?.([
          ...rows,
          {
            fromFunction,
            fromDetails: '',
            controlAction: '',
            controlDetails: '',
            toFunction,
            toDetails: '',
            sourceHandle: connection.sourceHandle || null,
            targetHandle: connection.targetHandle || null,
          },
        ]);

        return addEdge(newEdge, eds);
      });
    },
    [getConnectableFunctionName, setEdges, rows, onUpdateRows, nodes, persistSoon]
  );

  const onEdgeUpdateStart = useCallback((_, edge) => {
    edgeUpdateGestureRef.current = { active: true, oldEdgeId: edge?.id || null };
    if (edge?.id) suppressedEdgeRemovalIdsRef.current.add(edge.id);
  }, []);

  const onEdgeUpdate = useCallback(
    (oldEdge, newConn) => {
      const oldRowIndex = rows.findIndex((row, index) => edgeIdForRow(row, index) === oldEdge.id);
      const fromFunction = getConnectableFunctionName(newConn.source);
      const toFunction = getConnectableFunctionName(newConn.target);
      if (oldEdge?.id) suppressedEdgeRemovalIdsRef.current.add(oldEdge.id);
      if (oldRowIndex < 0 || !fromFunction || !toFunction || fromFunction === toFunction) return;
      if (oldRowIndex >= 0) {
        const nextRows = rows.map((row, index) => (
          index === oldRowIndex
            ? {
                ...row,
                fromFunction,
                toFunction,
                sourceHandle: newConn.sourceHandle || row.sourceHandle || null,
                targetHandle: newConn.targetHandle || row.targetHandle || null,
              }
            : row
        ));
        onUpdateRows?.(nextRows);
        rebuildRenderedEdgesFromRows(nextRows);
      }
    },
    [getConnectableFunctionName, onUpdateRows, rebuildRenderedEdgesFromRows, rows]
  );

  const onEdgeUpdateEnd = useCallback(() => {
    const oldEdgeId = edgeUpdateGestureRef.current.oldEdgeId;
    window.setTimeout(() => {
      if (oldEdgeId) suppressedEdgeRemovalIdsRef.current.delete(oldEdgeId);
      edgeUpdateGestureRef.current = { active: false, oldEdgeId: null };
    }, 0);
  }, []);

  const canUngroupSelected = selectedNodeIds.some((id) => (
    nodes.some((node) => node.id === id && node.parentNode)
  ));
  const edgePairs = useMemo(() => {
    const pairs = new Map();
    rowsToRawEdges(rows).forEach((edge) => {
      const pairKey = edgePairKey(edge.source, edge.target);
      if (!pairs.has(pairKey)) pairs.set(pairKey, []);
      pairs.get(pairKey).push(edge);
    });
    return pairs;
  }, [rows]);
  const multiEdgePairCount = useMemo(
    () => Array.from(edgePairs.values()).filter((pairEdges) => pairEdges.length > 1).length,
    [edgePairs]
  );
  const highlightedEdge = useMemo(
    () => edges.find((edge) => edge.id === highlightedEdgeId),
    [edges, highlightedEdgeId]
  );
  const highlightedPairKey = highlightedEdge
    ? highlightedEdge.data?.pairKey || edgePairKey(highlightedEdge.source, highlightedEdge.target)
    : '';
  const highlightedPairEdges = highlightedPairKey ? edgePairs.get(highlightedPairKey) || [] : [];
  const canToggleHighlightedPair = highlightedPairEdges.length > 1;
  const highlightedPairAggregated = canToggleHighlightedPair
    ? shouldAggregatePair(highlightedPairKey, highlightedPairEdges.length, edgeAggregation)
    : false;
  const highlightedRoutingTargetKey = highlightedEdge ? edgeRoutingTargetKey(highlightedEdge) : '';
  const highlightedRoutingStyle = highlightedEdge
    ? resolveEdgeRoutingStyle(highlightedEdge, edgeRouting)
    : normalizeEdgeRoutingStyle(edgeRouting.defaultStyle);
  const highlightedRoutingLabel = highlightedRoutingStyle === EDGE_ROUTING_STYLES.RECTANGULAR ? 'Bezier Edge' : 'Rect Edge';
  const rebuildEdgesWithRouting = useCallback((nextRouting) => {
    const rawEdges = rowsToRawEdges(rows);
    setEdges(buildEdgesFromRaw(rawEdges, buildAbsolutePositionMap(getNodes()), edgeAggregationRef.current, nextRouting));
  }, [getNodes, rows, setEdges]);
  const applyEdgeAggregation = useCallback((updater) => {
    setEdgeAggregation((current) => {
      const next = updater({
        aggregateAll: Boolean(current.aggregateAll),
        aggregatedPairs: new Set(current.aggregatedPairs || []),
        expandedPairs: new Set(current.expandedPairs || []),
      });
      edgeAggregationRef.current = next;
      const rawEdges = rowsToRawEdges(rows);
      setEdges(buildEdgesFromRaw(rawEdges, buildAbsolutePositionMap(getNodes()), next, edgeRoutingRef.current));
      return next;
    });
  }, [getNodes, rows, setEdges]);
  const toggleAggregateAllEdges = useCallback(() => {
    applyEdgeAggregation((current) => ({
      aggregateAll: !current.aggregateAll,
      aggregatedPairs: new Set(),
      expandedPairs: new Set(),
    }));
    setHighlightedEdgeId(null);
  }, [applyEdgeAggregation]);
  const toggleHighlightedEdgePairAggregation = useCallback(() => {
    if (!canToggleHighlightedPair || !highlightedPairKey) return;
    applyEdgeAggregation((current) => {
      if (current.aggregateAll) {
        if (current.expandedPairs.has(highlightedPairKey)) {
          current.expandedPairs.delete(highlightedPairKey);
        } else {
          current.expandedPairs.add(highlightedPairKey);
        }
      } else if (current.aggregatedPairs.has(highlightedPairKey)) {
        current.aggregatedPairs.delete(highlightedPairKey);
      } else {
        current.aggregatedPairs.add(highlightedPairKey);
      }
      return current;
    });
    setHighlightedEdgeId(null);
  }, [applyEdgeAggregation, canToggleHighlightedPair, highlightedPairKey]);
  const setAllEdgeRoutingStyle = useCallback((style) => {
    const next = {
      defaultStyle: normalizeEdgeRoutingStyle(style),
      overrides: {},
    };
    edgeRoutingRef.current = next;
    setEdgeRouting(next);
    rebuildEdgesWithRouting(next);
  }, [rebuildEdgesWithRouting]);
  const toggleHighlightedEdgeRoutingStyle = useCallback(() => {
    if (!highlightedRoutingTargetKey) return;
    const nextStyle = highlightedRoutingStyle === EDGE_ROUTING_STYLES.RECTANGULAR
      ? EDGE_ROUTING_STYLES.BEZIER
      : EDGE_ROUTING_STYLES.RECTANGULAR;
    setEdgeRouting((current) => {
      const next = {
        defaultStyle: normalizeEdgeRoutingStyle(current.defaultStyle),
        overrides: {
          ...(current.overrides || {}),
          [highlightedRoutingTargetKey]: nextStyle,
        },
      };
      edgeRoutingRef.current = next;
      rebuildEdgesWithRouting(next);
      return next;
    });
  }, [highlightedRoutingStyle, highlightedRoutingTargetKey, rebuildEdgesWithRouting]);

  /* Render */
  return (
    <div ref={diagramHostRef} style={{ width: '100%', height: '100%', minHeight: 560, position: 'relative' }}>
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
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            maxWidth: 'calc(100% - 24px)',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={addManualDiagramNode}
            title="Add Node"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.blue}`,
              background: BRAND.blue,
              color: 'white',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: '0 8px 18px rgba(45,125,254,0.18)',
              cursor: 'pointer',
            }}
          >
            + Add Node
          </button>
          <button
            type="button"
            onClick={createGroupBox}
            title="Group"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.purple}`,
              background: BRAND.purple,
              color: 'white',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: '0 8px 18px rgba(122,55,255,0.18)',
              cursor: 'pointer',
            }}
          >
            □ Group
          </button>
          <button
            type="button"
            onClick={addNoteNode}
            title="Note"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.yellow}`,
              background: '#FFF8E6',
              color: BRAND.dark,
              fontWeight: 800,
              fontSize: 15,
              boxShadow: '0 8px 18px rgba(243,182,63,0.14)',
              cursor: 'pointer',
            }}
          >
            📝 Note
          </button>
          <button
            type="button"
            onClick={ungroupSelectedNodes}
            disabled={!canUngroupSelected}
            title="Ungroup"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.purple}`,
              background: canUngroupSelected ? 'white' : '#F8F5FF',
              color: canUngroupSelected ? BRAND.purple : 'rgba(122,55,255,0.48)',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: canUngroupSelected ? '0 8px 18px rgba(122,55,255,0.10)' : 'none',
              cursor: canUngroupSelected ? 'pointer' : 'not-allowed',
            }}
          >
            ↱ Ungroup
          </button>
          <button
            type="button"
            onClick={runCleanAndSpread}
            title="Auto Arrange"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.blue}`,
              background: BRAND.blue,
              color: 'white',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: '0 8px 18px rgba(45,125,254,0.18)',
              cursor: 'pointer',
            }}
          >
            ⚡ Auto Arrange
          </button>
          <button
            type="button"
            onClick={toggleAggregateAllEdges}
            title={edgeAggregation.aggregateAll ? 'Expand all aggregated edge bundles' : 'Aggregate all repeated node-pair edges'}
            disabled={!multiEdgePairCount}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.purple}`,
              background: edgeAggregation.aggregateAll ? BRAND.purple : 'white',
              color: edgeAggregation.aggregateAll ? 'white' : BRAND.purple,
              fontWeight: 800,
              fontSize: 15,
              boxShadow: multiEdgePairCount ? '0 8px 18px rgba(122,55,255,0.10)' : 'none',
              cursor: multiEdgePairCount ? 'pointer' : 'not-allowed',
              opacity: multiEdgePairCount ? 1 : 0.55,
            }}
          >
            {edgeAggregation.aggregateAll ? '⇄ Expand Edges' : '⇉ Aggregate Edges'}
          </button>
          <button
            type="button"
            onClick={toggleHighlightedEdgePairAggregation}
            title="Select an edge to aggregate or expand only that node pair"
            disabled={!canToggleHighlightedPair}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.blue}`,
              background: highlightedPairAggregated ? BRAND.blue : 'white',
              color: canToggleHighlightedPair ? (highlightedPairAggregated ? 'white' : BRAND.blue) : 'rgba(45,125,254,0.45)',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: canToggleHighlightedPair ? '0 8px 18px rgba(45,125,254,0.10)' : 'none',
              cursor: canToggleHighlightedPair ? 'pointer' : 'not-allowed',
              opacity: canToggleHighlightedPair ? 1 : 0.55,
            }}
          >
            {highlightedPairAggregated ? 'Expand Pair' : 'Aggregate Pair'}
          </button>
          <div
            role="group"
            aria-label="Default edge routing style"
            style={{
              display: 'flex',
              border: `1px solid ${BRAND.blue}`,
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 8px 18px rgba(45,125,254,0.08)',
            }}
          >
            <button
              type="button"
              onClick={() => setAllEdgeRoutingStyle(EDGE_ROUTING_STYLES.BEZIER)}
              title="Set all edges to Bezier routing"
              style={{
                padding: '10px 12px',
                border: 0,
                borderRight: `1px solid ${rgba(BRAND.blue, 0.35)}`,
                background: edgeRouting.defaultStyle === EDGE_ROUTING_STYLES.BEZIER && !Object.keys(edgeRouting.overrides || {}).length ? BRAND.blue : 'white',
                color: edgeRouting.defaultStyle === EDGE_ROUTING_STYLES.BEZIER && !Object.keys(edgeRouting.overrides || {}).length ? 'white' : BRAND.blue,
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Bezier All
            </button>
            <button
              type="button"
              onClick={() => setAllEdgeRoutingStyle(EDGE_ROUTING_STYLES.RECTANGULAR)}
              title="Set all edges to rectangular routing"
              style={{
                padding: '10px 12px',
                border: 0,
                background: edgeRouting.defaultStyle === EDGE_ROUTING_STYLES.RECTANGULAR && !Object.keys(edgeRouting.overrides || {}).length ? BRAND.blue : 'white',
                color: edgeRouting.defaultStyle === EDGE_ROUTING_STYLES.RECTANGULAR && !Object.keys(edgeRouting.overrides || {}).length ? 'white' : BRAND.blue,
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Rect All
            </button>
          </div>
          <button
            type="button"
            onClick={toggleHighlightedEdgeRoutingStyle}
            title="Select an edge to override only that edge or aggregate pair"
            disabled={!highlightedRoutingTargetKey}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.purple}`,
              background: highlightedRoutingTargetKey && highlightedRoutingStyle === EDGE_ROUTING_STYLES.RECTANGULAR ? BRAND.purple : 'white',
              color: highlightedRoutingTargetKey ? (highlightedRoutingStyle === EDGE_ROUTING_STYLES.RECTANGULAR ? 'white' : BRAND.purple) : 'rgba(122,55,255,0.45)',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: highlightedRoutingTargetKey ? '0 8px 18px rgba(122,55,255,0.10)' : 'none',
              cursor: highlightedRoutingTargetKey ? 'pointer' : 'not-allowed',
              opacity: highlightedRoutingTargetKey ? 1 : 0.55,
            }}
          >
            {highlightedRoutingLabel}
          </button>
          <button
            type="button"
            onClick={exportDiagramXml}
            title="Export XML"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.blue}`,
              background: BRAND.blue,
              color: 'white',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: '0 8px 18px rgba(45,125,254,0.18)',
              cursor: 'pointer',
            }}
          >
            📥 Export .XML
          </button>
          <button
            type="button"
            onClick={exportDiagramJson}
            title="Export JSON"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: `1px solid ${BRAND.blue}`,
              background: BRAND.blue,
              color: 'white',
              fontWeight: 800,
              fontSize: 15,
              boxShadow: '0 8px 18px rgba(45,125,254,0.18)',
              cursor: 'pointer',
            }}
          >
            📥 Export .JSON
          </button>
        </div>
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
            type: edgeTypeForRoutingStyle(edgeRouting.defaultStyle),
            markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeUpdateStart={onEdgeUpdateStart}
          onEdgeUpdate={onEdgeUpdate}
          onEdgeUpdateEnd={onEdgeUpdateEnd}
          onEdgeClick={(evt, edge) => setHighlightedEdgeId(edge.id)}
          onPaneClick={() => { setHighlightedEdgeId(null); setContextMenu(null); }}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            setContextMenu(null);
          }}
          onNodeClick={() => { setHighlightedEdgeId(null); setContextMenu(null); }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            const selected = selectedNodeIds.length ? selectedNodeIds : [node.id];
            const eligible = selected.filter((id) => !id.startsWith('g:'));
            if (!eligible.length || !groupBoxes.length) return;
            const bounds = diagramHostRef.current?.getBoundingClientRect();
            setContextMenu({
              x: event.clientX - (bounds?.left || 0),
              y: event.clientY - (bounds?.top || 0),
              nodeIds: eligible,
            });
          }}
          onSelectionChange={({ nodes: selectedNodes }) => {
            setSelectedNodeIds((selectedNodes || []).map((n) => n.id));
          }}
          selectionOnDrag
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          nodesDraggable
          nodesConnectable
          edgesUpdatable
          connectionMode={ConnectionMode.Loose}
          onConnectStart={onConnectStartLoose}
          onConnectEnd={onConnectEndLoose}
          minZoom={THEME.canvas.minZoom}
          maxZoom={THEME.canvas.maxZoom}
          panOnScroll
          panOnScrollMode="free"
          zoomOnScroll={false}
          preventScrolling
          proOptions={{ hideAttribution: true }}
          onNodeDoubleClick={(event, node) => {
            event.preventDefault();
            event.stopPropagation();
            clearBrowserTextSelection();
            setEditModal({
              type: 'node',
              id: node.id,
              nodeType: node.type || 'bidirectional',
              label: node.data.label || '',
              description: node.data.description || '',
              color: node.data.brandColor || (node.type === 'groupBox' ? BRAND.purple : node.type === 'note' ? BRAND.yellow : BRAND.blue),
            });
            requestAnimationFrame(clearBrowserTextSelection);
          }}
          onEdgeDoubleClick={(event, edge) => {
            event.preventDefault();
            event.stopPropagation();
            clearBrowserTextSelection();
            setEditModal({ type: 'edge', id: edge.id, label: edge.label || '', description: edge.data?.description || '' });
            requestAnimationFrame(clearBrowserTextSelection);
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
            const rfId = nodeIdForFunction(label);
          
            const newNode = {
              id: rfId,
              type: 'bidirectional',
              position,
              data: { label, brandColor: BRAND.purple, brandTint: rgba(BRAND.purple, 0.08) },
            };
          
            setNodes((nds) => [...nds, newNode]);
            posRef.current.set(rfId, { position: newNode.position, parentId: null });
            persistSoon();
          }}
          onNodeDragStart={(_, node) => {
            if (node?.type !== 'groupBox') return;
            const startBox = groupBoxesRef.current.find((box) => box.id === node.id);
            if (!startBox) return;
            const childPositions = getNodes()
              .filter((n) => n.id !== node.id && n.type !== 'groupBox' && !n.parentNode && isNodeInsideBox(n, startBox))
              .map((n) => [n.id, { x: n.position.x, y: n.position.y }]);
            groupDragRef.current = {
              groupId: node.id,
              startPosition: { ...startBox.position },
              childPositions: new Map(childPositions),
            };
          }}
          onNodeDrag={(_, node) => {
            if (node?.type !== 'groupBox') return;
            const drag = groupDragRef.current;
            if (!drag || drag.groupId !== node.id) return;
            const delta = {
              x: node.position.x - drag.startPosition.x,
              y: node.position.y - drag.startPosition.y,
            };
            setNodes((nds) => nds.map((n) => {
              const startPosition = drag.childPositions.get(n.id);
              if (!startPosition) return n;
              return {
                ...n,
                position: {
                  x: startPosition.x + delta.x,
                  y: startPosition.y + delta.y,
                },
              };
            }));
          }}
          onNodeDragStop={(_, node) => {
            if (node?.id && node?.position) {
              let finalParentId = node.parentNode || null;
              if (node.type === 'groupBox') {
                const previousBox = groupBoxesRef.current.find((box) => box.id === node.id);
                const activeGroupDrag = groupDragRef.current?.groupId === node.id
                  ? groupDragRef.current
                  : null;
                const delta = previousBox
                  ? {
                      x: node.position.x - previousBox.position.x,
                      y: node.position.y - previousBox.position.y,
                    }
                  : { x: 0, y: 0 };

                setGroupBoxes((currentBoxes) => {
                  const baseBoxes = groupBoxesRef.current.length ? groupBoxesRef.current : currentBoxes;
                  const nextBoxes = baseBoxes.map((box) => (
                    box.id === node.id ? { ...box, position: { ...node.position } } : box
                  ));
                  persistGroupsSoon(nextBoxes);
                  return nextBoxes;
                });

                if (activeGroupDrag) {
                  activeGroupDrag.childPositions.forEach((startPosition, id) => {
                    posRef.current.set(id, {
                      position: {
                        x: startPosition.x + delta.x,
                        y: startPosition.y + delta.y,
                      },
                      parentId: null,
                    });
                  });
                  savePositions(storageKey, posRef.current);
                  groupDragRef.current = null;
                } else if (previousBox && (delta.x !== 0 || delta.y !== 0)) {
                  setNodes((nds) => nds.map((n) => {
                    if (n.id === node.id || n.type === 'groupBox' || n.parentNode || !isNodeInsideBox(n, previousBox)) return n;
                    const nextPosition = {
                      x: n.position.x + delta.x,
                      y: n.position.y + delta.y,
                    };
                    posRef.current.set(n.id, { position: nextPosition, parentId: null });
                    return { ...n, position: nextPosition };
                  }));
                  savePositions(storageKey, posRef.current);
                }
                setTimeout(() => refreshEdgesFromNodes(getNodes()), 0);
              } else {
                const currentNodes = getNodes();
                const byId = new Map(currentNodes.map((n) => [n.id, n]));
                const dragged = byId.get(node.id) || node;
                const abs = dragged.positionAbsolute || getNodeAbsolutePosition(dragged, byId);
                const containingBox = groupBoxes.find((box) => {
                  const left = box.position.x;
                  const top = box.position.y;
                  const right = left + (box.width || GROUP.w);
                  const bottom = top + (box.height || GROUP.h);
                  const cx = abs.x + THEME.node.w / 2;
                  const cy = abs.y + THEME.node.h / 2;
                  return cx >= left && cx <= right && cy >= top && cy <= bottom;
                });

                const keepCurrentGroup = dragged.parentNode && containingBox?.id === dragged.parentNode;
                const targetBox = keepCurrentGroup
                  ? groupBoxes.find((box) => box.id === dragged.parentNode)
                  : containingBox;

                if (targetBox) {
                  const relative = clampToGroup(
                    { x: abs.x - targetBox.position.x, y: abs.y - targetBox.position.y },
                    targetBox
                  );
                  finalParentId = targetBox.id;
                  setNodes((nds) => nds.map((n) => (
                    n.id === node.id ? { ...n, parentNode: targetBox.id, position: relative } : n
                  )));
                  posRef.current.set(node.id, { position: relative, parentId: targetBox.id });
                  if (!targetBox.autoGenerated) {
                    setTimeout(() => growGroupToFitMembers(targetBox.id, getNodes()), 0);
                  }
                } else if (dragged.parentNode) {
                  finalParentId = null;
                  setNodes((nds) => nds.map((n) => (
                    n.id === node.id ? { ...n, parentNode: undefined, position: abs } : n
                  )));
                  posRef.current.set(node.id, { position: abs, parentId: null });
                } else {
                  finalParentId = null;
                  posRef.current.set(node.id, { position: { x: abs.x, y: abs.y }, parentId: null });
                }
              }
              persistSoon();
              savePositions(storageKey, posRef.current);
              if (node.type !== 'groupBox' && !finalParentId) {
                nudgeIfOverlapping(node.id, nodes.filter((n) => !n.parentNode && n.type !== 'groupBox'), setNodes);
              }
              setTimeout(() => {
                refreshEdgesFromNodes(getNodes());
              }, 0);
            }
          }}
        >
          <Background variant="dots" gap={18} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>

      {contextMenu && (
        <div
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 30,
            background: '#fff',
            border: '1px solid rgba(15,15,18,0.12)',
            borderRadius: 10,
            boxShadow: '0 10px 28px rgba(15,15,18,0.18)',
            minWidth: 220,
            overflow: 'hidden',
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid rgba(15,15,18,0.08)' }}>
            Add Selected Nodes To Group
          </div>
          {groupBoxes.map((box) => (
            <button
              key={box.id}
              onClick={() => assignNodesToGroup(contextMenu.nodeIds, box.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13, background: '#fff', border: 'none', cursor: 'pointer' }}
            >
              {box.label}
            </button>
          ))}
          <button
            onClick={() => ungroupNodes(contextMenu.nodeIds)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13, background: '#fff', border: 'none', borderTop: '1px solid rgba(15,15,18,0.08)', cursor: 'pointer' }}
          >
            Remove From Group
          </button>
        </div>
      )}

      {/* ✏️ Edit Modal */}
      {editModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'rgba(15,15,18,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setEditModal(null);
          }}
        >
          <div
            style={{
              background: 'white',
              border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 12,
              width: 'min(860px, calc(100% - 32px))',
              maxHeight: 'calc(100% - 48px)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: 20,
                overflowY: 'auto',
                flex: '1 1 auto',
                minHeight: 0,
              }}
            >
            <h3 style={{ marginBottom: 10 }}>Edit {editModal.type === 'node' ? 'Node' : 'Edge'}</h3>
            <label style={{ display: 'block', marginBottom: 8 }}>
              Label:
              <input
                type="text"
                value={editModal.label}
                onChange={(e) => setEditModal((m) => ({ ...m, label: e.target.value }))}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #ddd' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              Description:
              <textarea
                value={editModal.description}
                onChange={(e) => setEditModal((m) => ({ ...m, description: e.target.value }))}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #ddd' }}
                rows={4}
              />
            </label>
            {editModal.type === 'node' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 14, marginBottom: 6 }}>Color:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEditModal((m) => ({ ...m, color }))}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        border: editModal.color === color ? `2px solid ${BRAND.dark}` : '1px solid rgba(15,15,18,0.15)',
                        background: color,
                        cursor: 'pointer',
                        boxShadow: editModal.color === color ? '0 0 0 2px rgba(15,15,18,0.08)' : 'none',
                      }}
                      aria-label={`Choose color ${color}`}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={editModal.color || BRAND.blue}
                  onChange={(e) => setEditModal((m) => ({ ...m, color: e.target.value }))}
                  style={{ display: 'block', width: 56, height: 36, padding: 0, border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}
                />
              </div>
            )}
            <div
              style={{
                marginTop: 16,
                borderTop: '1px solid rgba(15,15,18,0.1)',
                paddingTop: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.dark }}>
                  Associated Hazard Analysis
                </div>
                {hazardDataRows.length > 0 && (
                  <div style={{ fontSize: 12, color: 'rgba(15,15,18,0.58)' }}>
                    {editHazardRows.length} result{editHazardRows.length === 1 ? '' : 's'}
                  </div>
                )}
              </div>
              {!hazardDataRows.length ? (
                <div style={{ fontSize: 13, color: 'rgba(15,15,18,0.58)' }}>
                  Run hazard analysis to see linked results here.
                </div>
              ) : editHazardRows.length === 0 ? (
                <div style={{ fontSize: 13, color: 'rgba(15,15,18,0.58)' }}>
                  No hazard analysis rows are linked to this {editModal.type}.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {editHazardRows.map(({ sourceIndex, cells }) => (
                    <div
                      key={`${sourceIndex}-${cells.join('|')}`}
                      style={{
                        border: '1px solid rgba(45,125,254,0.18)',
                        borderRadius: 8,
                        background: '#F8FAFC',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 10px',
                          background: '#EEF4FF',
                          color: '#0B3EA8',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        <span>{getHazardCardTitle(cells, sourceIndex)}</span>
                        {typeof onOpenHazardRow === 'function' && (
                          <button
                            type="button"
                            onClick={() => onOpenHazardRow(sourceIndex)}
                            style={{
                              float: 'right',
                              border: 'none',
                              background: 'transparent',
                              color: BRAND.blue,
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          >
                            Open in table
                          </button>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)',
                          gap: 0,
                        }}
                      >
                        {cells.map((cell, idx) => (
                          <React.Fragment key={`${sourceIndex}-${idx}`}>
                            <div
                              style={{
                                padding: '8px 10px',
                                borderTop: '1px solid rgba(15,15,18,0.08)',
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#4B5563',
                                background: 'white',
                              }}
                            >
                              {hazardHeaders[idx] || `Column ${idx + 1}`}
                            </div>
                            <div
                              style={{
                                padding: '8px 10px',
                                borderTop: '1px solid rgba(15,15,18,0.08)',
                                fontSize: 12,
                                color: '#111827',
                                background: 'white',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {String(cell ?? '') || '—'}
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '14px 20px',
                borderTop: '1px solid rgba(15,15,18,0.1)',
                background: 'white',
                boxShadow: '0 -8px 18px rgba(15,15,18,0.04)',
              }}
            >
              <button onClick={() => setEditModal(null)} style={{ padding: '6px 12px', borderRadius: 8 }}>
                Cancel
              </button>
              <button
	                onClick={() => {
	                if (editModal.type === 'node') {
                    const nodeColor = editModal.color || BRAND.blue;
                    const nodeTint =
                      editModal.nodeType === 'note' ? rgba(nodeColor, 0.2) : rgba(nodeColor, 0.08);
		                  if (editModal.id.startsWith('g:')) {
	                    setGroupBoxes((currentBoxes) => {
                        const baseBoxes = groupBoxesRef.current.length ? groupBoxesRef.current : currentBoxes;
	                      const nextBoxes = baseBoxes.map((box) => (
	                        box.id === editModal.id
                            ? {
                                ...box,
                                label: editModal.label,
                                description: editModal.description,
                                descriptionUserEdited: true,
                                brandColor: nodeColor,
                              }
                            : box
	                      ));
	                      persistGroupsSoon(nextBoxes);
	                      return nextBoxes;
	                    });
	                    setNodes((nds) =>
	                      nds.map((n) =>
	                        n.id === editModal.id
	                          ? { ...n, data: { ...n.data, label: editModal.label, description: editModal.description, brandColor: nodeColor } }
	                          : n
	                      )
	                    );
	                    setEditModal(null);
	                    return;
	                  }
                    if (editModal.id.startsWith('note:') || editModal.nodeType === 'note') {
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === editModal.id
                            ? {
                                ...n,
                                data: {
                                  ...n.data,
                                  label: editModal.label,
                                  description: editModal.description,
                                  brandColor: nodeColor,
                                  brandTint: nodeTint,
                                },
                              }
                            : n
                        )
                      );
                      setEditModal(null);
                      return;
                    }
	                  setNodes((nds) =>
	                    nds.map((n) =>
	                      n.id === editModal.id
	                        ? {
                              ...n,
                              data: {
                                ...n.data,
                                label: editModal.label,
                                description: editModal.description,
                                brandColor: nodeColor,
                                brandTint: nodeTint,
                              },
                            }
	                        : n
	                    )
                  );

                  const updatedRows = rows.map((r) => {
                    if (nodeIdForFunction(r.fromFunction) === editModal.id)
                      return { ...r, fromFunction: normalizeFunctionName(editModal.label), fromDetails: editModal.description };
                    if (nodeIdForFunction(r.toFunction) === editModal.id)
                      return { ...r, toFunction: normalizeFunctionName(editModal.label), toDetails: editModal.description };
                    return r;
                  });

                  const oldId = editModal.id;
                  const newId = nodeIdForFunction(editModal.label);
                  const oldPos = posRef.current.get(oldId);
                  if (oldPos && newId) {
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
                    const edgeId = edgeIdForRow(r, i);
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
