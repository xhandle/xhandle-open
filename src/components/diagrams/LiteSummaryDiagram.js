/* eslint-disable react-hooks/exhaustive-deps */
/**
 * xHandle: lite summary diagram diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactFlow, { Background, Controls, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import { downloadDrawioXml } from "../utils/exportDrawio";

/* ---------------- brand ---------------- */
const BRAND = {
  blue: "#2D7DFE",
  blueSoft: "#E6F0FF",
  blueDim: "#CFE0FF",
  text: "#0B1B4D",
  danger: "#EF4444",
  warn: "#F59E0B",
  white: "#FFFFFF",
  gray: "#6B7280",
};
const VIEW = { DIAGRAM: "diagram", LIST: "list", TABLE: "table" };

/* ---------------- legend colors ---------------- */
const columnColors = [
  "#E0F7FA", "#FFF9C4", "#F8BBD0", "#D1C4E9", "#C8E6C9",
  "#FFECB3", "#FFCDD2", "#DCEDC8", "#F0F4C3", "#B3E5FC",
];

/* ---------------- helpers ---------------- */
const safeLoad = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
/**
 * safeSave encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param k Input consumed by this step of the xHandle workflow.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const safeSave = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/**
 * estimateNodeHeight encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param lineHeight Input consumed by this step of the xHandle workflow.
 * @param maxWidth Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const estimateNodeHeight = (label, lineHeight = 20, maxWidth = 240) => {
  const text = String(label ?? "");
  const words = text.split(/\s+/);
  const charsPerLine = Math.floor(maxWidth / 8);
  let line = "", lines = 0;
  for (const w of words) {
    if ((line + w).length > charsPerLine) { lines++; line = w; }
    else { line += (line ? " " : "") + w; }
  }
  if (line) lines++;
  return lines * lineHeight + 20;
};
/**
 * getNodeText reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param node Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
const getNodeText = (node) => {
  const lbl = node?.data?.label;
  return typeof lbl === "string" ? lbl : (lbl?.value ?? "");
};
/**
 * getColumnIndex reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param nodeId Stable identifier for the entity this step works with.
 * @returns the normalized data requested by this module.
 */
const getColumnIndex = (nodeId) => parseInt(String(nodeId).split("-")[0], 10);
/**
 * normKey encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const normKey = (s) => String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/gi, "_");
/**
 * stableHash encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const stableHash = (s) => { let h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(36); };

/**
 * pickProjectKey encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param summaryData Input consumed by this step of the xHandle workflow.
 * @param explicitId Stable identifier for the entity this step works with.
 * @returns diagram data or layout state for rendering.
 */
const pickProjectKey = (summaryData, explicitId) => {
  const candidate =
    explicitId ||
    summaryData?.projectId ||
    summaryData?.analysisId ||
    summaryData?.id ||
    summaryData?.AnalysisId ||
    summaryData?.ProjectId;
  if (candidate) return `proj_${normKey(String(candidate))}`;
  const rows = Array.isArray(summaryData?.Summary) ? summaryData.Summary.slice(1) : [];
  return `rows_${stableHash(JSON.stringify(rows || []))}`;
};

/**
 * makeEdge encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param source Input consumed by this step of the xHandle workflow.
 * @param target Input consumed by this step of the xHandle workflow.
 * @param highlight Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const makeEdge = (source, target, highlight = false) => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "bezier",
  animated: false,
  style: {
    stroke: highlight ? BRAND.warn : BRAND.blue,
    strokeWidth: highlight ? 2.2 : 1.8,
  },
  markerEnd: { type: "arrowclosed", color: highlight ? BRAND.warn : BRAND.blue },
});

const escapeCsvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/**
 * relayoutNodes encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param nodes Diagram node collection for the current view.
 * @param edges Diagram edge collection for the current view.
 * @param xSpacing Input consumed by this step of the xHandle workflow.
 * @param centerY Input consumed by this step of the xHandle workflow.
 * @param vGap Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const relayoutNodes = (nodes, edges, xSpacing = 500, centerY = 400, vGap = 40) => {
  const nodesByCol = new Map();
  nodes.forEach((n) => {
    const col = getColumnIndex(n.id);
    if (!nodesByCol.has(col)) nodesByCol.set(col, []);
    nodesByCol.get(col).push(n);
  });

  const incoming = {};
  edges.forEach((e) => {
    if (!incoming[e.target]) incoming[e.target] = [];
    incoming[e.target].push(e.source);
  });

  const positioned = [];
  [...nodesByCol.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([colIdx, colNodes]) => {
      colNodes.forEach((n) => {
        const text = getNodeText(n);
        n.height = n.height ?? estimateNodeHeight(text);
        const sources = incoming[n.id] || [];
        const avgY =
          (sources
            .map((srcId) => positioned.find((p) => p.id === srcId)?.position.y ?? 0)
            .reduce((a, b) => a + b, 0)) / (sources.length || 1);
        n._alignY = Number.isFinite(avgY) ? avgY : 0;
      });

      colNodes.sort((a, b) => a._alignY - b._alignY);

      const totalHeight = colNodes.reduce(
        (sum, n) => sum + (n.height ?? estimateNodeHeight(getNodeText(n))) + vGap,
        0
      );
      let startY = centerY - totalHeight / 2;

      colNodes.forEach((n) => {
        const h = n.height ?? estimateNodeHeight(getNodeText(n));
        n.position = { x: colIdx * xSpacing, y: startY };
        startY += h + vGap;
        positioned.push(n);
      });
    });

  return positioned.map((n) => ({ ...n, data: { ...n.data } }));
};

/**
 * columnTypicalHeight encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param nodes Diagram node collection for the current view.
 * @param columnIdx Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const columnTypicalHeight = (nodes, columnIdx) => {
  const heights = nodes
    .filter((n) => getColumnIndex(n.id) === columnIdx)
    .map((n) => n.height ?? estimateNodeHeight(getNodeText(n)));
  if (!heights.length) return null;
  const sorted = heights.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * collectDownstream prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param startId Stable identifier for the entity this step works with.
 * @param edges Diagram edge collection for the current view.
 * @returns diagram data or layout state for rendering.
 */
const collectDownstream = (startId, edges) => {
  const toDelete = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of edges) {
      if (e.source === cur && !toDelete.has(e.target)) {
        toDelete.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return toDelete;
};

/**
 * nodeIdFor encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param colIdx Input consumed by this step of the xHandle workflow.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const nodeIdFor = (colIdx, text) => `${colIdx}-${normKey(text)}`;
/**
 * getNodeLabelById reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param nodes Diagram node collection for the current view.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns the normalized data requested by this module.
 */
const getNodeLabelById = (nodes, id) => {
  const n = nodes.find((x) => x.id === id);
  return n ? getNodeText(n) : "";
};

/**
 * findIdx encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param headers Column headers used to label row values or generated output.
 * @param re Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const findIdx = (headers, re) => headers.findIndex((h) => re.test(String(h || "")));

/**
 * likelyColumns encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param headers Column headers used to label row values or generated output.
 * @returns diagram data or layout state for rendering.
 */
const likelyColumns = (headers) => {
  const hazardByName = findIdx(headers, /\b(hazard|haz|hazards)\b/i);
  const lossIdx      = findIdx(headers, /\b(loss|accident|harm|damage)\b/i);
  const ucaIdx       = findIdx(headers, /\b(unsafe\s*control.*|^uca$|^ucas$)\b/i);
  const mitIdx = findIdx(headers, /\b(mitigation(?:\s*strategy)?|safety\s*constraint(?:s)?|constraints?|^sc$|^scs$)\b/i);
  let hazardIdx = hazardByName;

  if (hazardIdx < 0) {
    if (lossIdx >= 0 && ucaIdx >= 0 && lossIdx + 1 < headers.length) hazardIdx = lossIdx + 1;
    else if (lossIdx >= 0 && mitIdx >= 0 && lossIdx + 1 < headers.length) hazardIdx = lossIdx + 1;
    else if (ucaIdx > 0) hazardIdx = ucaIdx - 1;
    else if (mitIdx > 0) hazardIdx = mitIdx - 1;
    else hazardIdx = 0;
  }

  if (hazardIdx < 0 || hazardIdx >= headers.length) hazardIdx = 0;

  return { hazardIdx, ucaIdx, mitIdx, lossIdx };
};

/* ---------------- risk helpers ---------------- */
const defaultRiskConfig = {
  method: "SxL",
  maxScale: 5,
  thresholds: { low: 6, med: 12 },
};
/**
 * clamp encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param n Input consumed by this step of the xHandle workflow.
 * @param lo Input consumed by this step of the xHandle workflow.
 * @param hi Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
/**
 * computeRiskScore encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param rating Input consumed by this step of the xHandle workflow.
 * @param cfg Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const computeRiskScore = (rating, cfg) => {
  const s = clamp(rating.severity ?? 1, 1, cfg.maxScale);
  const l = clamp(rating.likelihood ?? 1, 1, cfg.maxScale);
  if (cfg.method === "SxLxD") {
    const d = clamp(rating.detectability ?? 1, 1, cfg.maxScale);
    return s * l * d;
  }
  return s * l;
};
/**
 * categorize encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param score Input consumed by this step of the xHandle workflow.
 * @param cfg Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
const categorize = (score, cfg) => {
  const { low, med } = cfg.thresholds;
  if (score <= low) return { label: "Low", color: "#10B981" };
  if (score <= med) return { label: "Medium", color: "#F59E0B" };
  return { label: "High", color: "#EF4444" };
};

/* ---------------- Node UI ---------------- */
const CustomNode = ({ data, id }) => {
  const text = typeof data.label === "string" ? data.label : data.label?.value || "";
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

  return (
    <div
      className="relative group px-4 py-2 text-sm max-w-xs whitespace-normal break-words rounded-xl shadow-md"
      style={{
        ...((data?.label?.style) || {}),
        color: BRAND.text,
        border: `2px solid ${BRAND.blue}`,
        boxShadow: "0 4px 16px rgba(13, 60, 180, 0.10)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: "transparent", border: "none", zIndex: 30 }} />
      <div className="leading-5">{text}</div>

      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full z-40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="pointer-events-auto flex gap-1 bg-white/95 border border-gray-200 rounded-full shadow px-1 py-1" onMouseDown={stop} onClick={stop}>
          <button
            title="Edit"
            className="w-7 h-7 rounded-full text-xs flex items-center justify-center"
            style={{ background: BRAND.warn, color: BRAND.white }}
            onClick={() => data?.onOpenEditor?.(id)}
          >✎</button>
          <button
            title="Delete"
            className="w-7 h-7 rounded-full text-xs flex items-center justify-center"
            style={{ background: BRAND.danger, color: BRAND.white }}
            onClick={() => data?.onRemoveNode?.(id)}
          >×</button>
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ background: "transparent", border: "none", zIndex: 30 }} />
    </div>
  );
};

/* ---------------- Main component ---------------- */
export default function LiteSummaryDiagram({ summaryData, projectId }) {
  const reactFlowInstanceRef = useRef(null);

  // NEW: which heading powers the bottom buttons (defaults to 2nd heading)
  const [filterColIdx, setFilterColIdx] = useState(1);
  // NEW: active value within that column
  const [activeFilterKey, setActiveFilterKey] = useState(null);

  // Persist per project/analysis (and header version)
  const storageKey = React.useMemo(() => {
    const hdrs = Array.isArray(summaryData?.Summary) ? summaryData.Summary[0] : [];
    const projectPart = pickProjectKey(summaryData, projectId);
    const headerPart  = `hdr_${stableHash(JSON.stringify(hdrs || []))}`;
    return `LiteSummaryDiagram::${projectPart}::${headerPart}`;
  }, [summaryData, projectId]);

  // load persisted bits
  useEffect(() => {
    const persisted = typeof window !== "undefined" ? safeLoad(storageKey) : null;
    if (persisted) {
      if (Number.isInteger(persisted.filterColIdx)) setFilterColIdx(persisted.filterColIdx);
      if (persisted.activeFilterKey) setActiveFilterKey(persisted.activeFilterKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // List & risk state
  const [riskConfig, setRiskConfig] = useState(defaultRiskConfig);
  const [ratings, setRatings] = useState({});
  const [listQuery, setListQuery] = useState("");
  const [sortByRisk] = useState(true);
  const [details, setDetails] = useState({ open: false, key: null });

  const [tableRows, setTableRows] = useState([]);

  // Add-trace modal state
  const [addTrace, setAddTrace] = useState({
    open: false,
    colIdx: null,
    hazardKey: null,
    search: "",
    selected: new Set(),
  });

  /* view */
  const [view, setView] = useState(VIEW.DIAGRAM);
  useEffect(() => {
    if (view === VIEW.LIST) setView(VIEW.DIAGRAM);
  }, [view]);

  /* diagram state */
  const [allNodes, setAllNodes] = useState([]);
  const [allEdges, setAllEdges] = useState([]);
  const [filteredNodes, setFilteredNodes] = useState([]);
  const [filteredEdges, setFilteredEdges] = useState([]);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [, setIsIsolated] = useState(false);
  const [, setTraceNodeIds] = useState(new Set());
  const [, setTraceEdgeIds] = useState(new Set());

  /* shared refs */
  const nodesRef = useRef(allNodes);
  const edgesRef = useRef(allEdges);
  const headersRef = useRef([]);
  const rowsRef = useRef([]);
  const lastColRef = useRef(0);
  useEffect(() => { nodesRef.current = allNodes; }, [allNodes]);
  useEffect(() => { edgesRef.current = allEdges; }, [allEdges]);

  /* ids */
  const nodeCounterRef = useRef(0);
  const generateUniqueId = useCallback((colIdx) => `${colIdx}-new_${nodeCounterRef.current++}`, []);

  /* editor modal */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorNodeId, setEditorNodeId] = useState(null);
  const [editorDraft, setEditorDraft] = useState("");

  /* add-node modal */
  const [addOpen, setAddOpen] = useState(false);
  const [addColIdx, setAddColIdx] = useState(0);

  /* handler wiring */
  const handlersRef = useRef({ onOpenEditor: () => {}, onRemoveNode: () => {} });
  const injectCallbacks = useCallback(
    (nodes) => nodes.map((n) => ({ ...n, data: { ...n.data, ...handlersRef.current } })),
    []
  );

  const handleRemoveNode = useCallback((nodeId) => {
    const edges = edgesRef.current;
    const toDelete = collectDownstream(nodeId, edges);

    const nextNodes = nodesRef.current.filter((n) => !toDelete.has(n.id));
    const nextEdges = edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));

    const relaid = relayoutNodes(nextNodes, nextEdges);
    const withCbs = injectCallbacks(relaid);

    setAllNodes(withCbs);
    setFilteredNodes(withCbs);
    setAllEdges(nextEdges);
    setFilteredEdges(nextEdges);

    if (toDelete.has(activeNodeId)) setActiveNodeId(null);
    reactFlowInstanceRef.current?.fitView?.({ padding: 0.2, duration: 300 });
  }, [activeNodeId, injectCallbacks]);

  const getNodeTextById = useCallback((nodeId) => {
    const n = nodesRef.current.find((n) => n.id === nodeId);
    const lbl = n?.data?.label;
    return typeof lbl === "string" ? lbl : (lbl?.value ?? "");
  }, []);
  const openEditor = useCallback((nodeId) => {
    setEditorNodeId(nodeId);
    setEditorDraft(getNodeTextById(nodeId));
    setEditorOpen(true);
  }, [getNodeTextById]);
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorNodeId(null);
    setEditorDraft("");
  }, []);
  const saveEditor = useCallback(() => {
    if (!editorNodeId) return;
    const newText = String(editorDraft).trim();
    if (!newText) return closeEditor();

    const nextNodes = nodesRef.current.map((node) => {
      if (node.id !== editorNodeId) return node;
      const h = estimateNodeHeight(newText);
      return {
        ...node,
        height: h,
        data: {
          ...node.data,
          label: typeof node.data.label === "string" ? newText : { ...node.data.label, value: newText },
        },
      };
    });

    const relaid = relayoutNodes(nextNodes, edgesRef.current);
    const withCbs = injectCallbacks(relaid);
    setAllNodes(withCbs);
    setFilteredNodes(withCbs);
    closeEditor();
    reactFlowInstanceRef.current?.fitView?.({ padding: 0.2, duration: 300 });
  }, [editorNodeId, editorDraft, closeEditor, injectCallbacks]);

  handlersRef.current = { onOpenEditor: openEditor, onRemoveNode: handleRemoveNode };

  /* manual connections (adjacent cols) */
  const isValidConnection = useCallback((conn) => {
    if (!conn?.source || !conn?.target) return false;
    const s = getColumnIndex(conn.source);
    const t = getColumnIndex(conn.target);
    return Math.abs(s - t) === 1;
  }, []);
  const onConnect = useCallback((params) => {
    const { source, target } = params || {};
    if (!source || !target) return;
    const sCol = getColumnIndex(source);
    const tCol = getColumnIndex(target);
    if (Math.abs(sCol - tCol) !== 1) return;

    const id = `${source}->${target}`;
    if (edgesRef.current.some((e) => e.id === id || (e.source === source && e.target === target))) return;

    const newEdge = makeEdge(source, target);
    const nextEdges = [...edgesRef.current, newEdge];

    const relaid = relayoutNodes(nodesRef.current.slice(), nextEdges);
    const withCbs = injectCallbacks(relaid);

    setAllNodes(withCbs);
    setFilteredNodes(withCbs);
    setAllEdges(nextEdges);
    setFilteredEdges(nextEdges);
  }, [injectCallbacks]);

  const handleAddNodeToColumn = useCallback((colIdx) => {
    const maxCol = lastColRef.current;
    if (colIdx < 0 || colIdx > maxCol) return;

    const all = nodesRef.current;
    const typicalH = columnTypicalHeight(all, colIdx) ?? 60;

    const newNode = {
      id: generateUniqueId(colIdx),
      type: "custom",
      data: {
        label: {
          value: "New node — click ✎ to edit",
          style: { backgroundColor: columnColors[colIdx % columnColors.length] },
        },
      },
      position: { x: colIdx * 500, y: 0 },
      height: typicalH,
    };

    const nextNodes = [...all, newNode];
    const nextEdges = edgesRef.current.slice();

    const relaid = relayoutNodes(nextNodes, nextEdges);
    const withCbs = injectCallbacks(relaid);

    setAllNodes(withCbs);
    setFilteredNodes(withCbs);
    setAllEdges(nextEdges);
    setFilteredEdges(nextEdges);

    setAddOpen(false);
    reactFlowInstanceRef.current?.fitView?.({ padding: 0.2, duration: 300 });
  }, [generateUniqueId, injectCallbacks]);

  /* ---------- build graph from summary ---------- */
  const [hazardMap, setHazardMap] = useState(new Map()); // unchanged (used by List)
  useEffect(() => {
    if (!summaryData || !Array.isArray(summaryData.Summary) || summaryData.Summary.length < 2) return;

    const [headers, ...rows] = summaryData.Summary;
    headersRef.current = headers || [];
    rowsRef.current = rows || [];
    lastColRef.current = Math.max(0, headers.length - 1);

    // default filter column = second header (index 1) if exists
    setFilterColIdx((prev) => {
      const persisted = typeof window !== "undefined" ? safeLoad(storageKey) : null;
      if (Number.isInteger(persisted?.filterColIdx)) return persisted.filterColIdx;
      return headers.length > 1 ? 1 : 0;
    });

    // Try persisted graph
    const persisted = typeof window !== "undefined" ? safeLoad(storageKey) : null;
    const persistedLooksUsable =
      persisted &&
      Array.isArray(persisted.headers) &&
      JSON.stringify(persisted.headers) === JSON.stringify(headers) &&
      Array.isArray(persisted.nodes) &&
      persisted.nodes.length > 0;

    if (persistedLooksUsable) {
      const rebuiltNodes = (persisted.nodes || []).map((p) => {
        const bg = p.style?.backgroundColor ?? columnColors[getColumnIndex(p.id) % columnColors.length];
        const label = { value: p.label ?? "", style: { backgroundColor: bg } };
        return {
          id: p.id,
          type: "custom",
          data: { label },
          position: { x: getColumnIndex(p.id) * 500, y: 0 },
          height: p.height ?? estimateNodeHeight(p.label ?? ""),
        };
      });
      const rebuiltEdges = (persisted.edges || []).map((e) => makeEdge(e.source, e.target));
      const relaid = relayoutNodes(rebuiltNodes, rebuiltEdges, 500, 400, 40);
      const withCbs = injectCallbacks(relaid);

      setAllNodes(withCbs);
      setFilteredNodes(withCbs);
      setAllEdges(rebuiltEdges);
      setFilteredEdges(rebuiltEdges);
      setActiveNodeId(null);
      setIsIsolated(false);
      setTraceNodeIds(new Set());
      setTraceEdgeIds(new Set());
      setAddColIdx(Math.min(1, lastColRef.current));

      if (persisted.ratings) setRatings(persisted.ratings);
      if (persisted.riskConfig) setRiskConfig(persisted.riskConfig);
    } else {
      // Build from incoming rows
      const nodeMap = new Map();
      const edgeMap = new Map();
      const xSpacing = 500;
      const norm = (colIdx, text) => `${colIdx}-${normKey(text)}`;

      rows.forEach((row) => {
        for (let i = 0; i < headers.length - 1; i++) {
          const source = String(row[i] ?? "");
          const target = String(row[i + 1] ?? "");
          if (!source || !target) continue;

          const sourceId = norm(i, source);
          const targetId = norm(i + 1, target);

          if (!nodeMap.has(sourceId)) {
            nodeMap.set(sourceId, {
              id: sourceId,
              type: "custom",
              data: { label: { value: source, style: { backgroundColor: columnColors[i % columnColors.length] } } },
              position: { x: i * xSpacing, y: 0 },
              height: estimateNodeHeight(source),
            });
          }
          if (!nodeMap.has(targetId)) {
            nodeMap.set(targetId, {
              id: targetId,
              type: "custom",
              data: { label: { value: target, style: { backgroundColor: columnColors[(i + 1) % columnColors.length] } } },
              position: { x: (i + 1) * xSpacing, y: 0 },
              height: estimateNodeHeight(target),
            });
          }

          const edgeId = `${sourceId}->${targetId}`;
          if (!edgeMap.has(edgeId)) edgeMap.set(edgeId, makeEdge(sourceId, targetId));
        }
      });

      const positioned = relayoutNodes([...nodeMap.values()], [...edgeMap.values()], 500, 400, 40);
      const edges = Array.from(edgeMap.values());
      const withCbs = injectCallbacks(positioned);

      setAllNodes(withCbs);
      setFilteredNodes(withCbs);
      setAllEdges(edges);
      setFilteredEdges(edges);
      setActiveNodeId(null);
      setIsIsolated(false);
      setTraceNodeIds(new Set());
      setTraceEdgeIds(new Set());
      setAddColIdx(Math.min(1, lastColRef.current));
    }

    // Build hazardMap (unchanged, for List view)
    const hMap = new Map();
    const { hazardIdx, ucaIdx, mitIdx } = likelyColumns(headers);
    rows.forEach((row) => {
      const hText = String(row[hazardIdx] ?? "").trim();
      if (!hText) return;
      const key = normKey(hText);
      const entry = hMap.get(key) || { key, text: hText, rows: [], counts: { ucas: 0, mits: 0 } };
      entry.rows.push(row);
      hMap.set(key, entry);
    });
    hMap.forEach((entry) => {
      const uSet = new Set();
      const mSet = new Set();
      entry.rows.forEach((row) => {
        if (ucaIdx >= 0 && row[ucaIdx]) uSet.add(String(row[ucaIdx]));
        if (mitIdx >= 0 && row[mitIdx]) mSet.add(String(row[mitIdx]));
      });
      entry.counts.ucas = uSet.size;
      entry.counts.mits = mSet.size;
    });
    setHazardMap(hMap);
  }, [summaryData, injectCallbacks, storageKey]);

  /* ---------- Resolve columns early ---------- */
  const headers = headersRef.current;
  const cols = likelyColumns(headers);

  // Build rows from current graph for table (hazard-centric for now)
  const buildRowsFromGraph = useCallback((headers, nodes, edges, hazardIdx) => {
    if (!headers?.length || !nodes?.length) return [];
    const labelOf = (id) => {
      const n = nodes.find((x) => x.id === id);
      const lbl = n?.data?.label;
      return typeof lbl === "string" ? lbl : (lbl?.value ?? "");
    };
    const lastCol = headers.length - 1;
    const hazardNodes = nodes.filter((n) => getColumnIndex(n.id) === hazardIdx);
    const enumerateRight = (startId) => {
      let parts = [{ nodeId: startId, map: { [hazardIdx]: labelOf(startId) } }];
      for (let c = hazardIdx; c < lastCol; c++) {
        const nextParts = [];
        for (const p of parts) {
          const outs = edges.filter((e) => e.source === p.nodeId && getColumnIndex(e.target) === c + 1);
          if (!outs.length) nextParts.push(p);
          else outs.forEach((e) => nextParts.push({ nodeId: e.target, map: { ...p.map, [c + 1]: labelOf(e.target) } }));
        }
        parts = nextParts;
      }
      const seen = new Set();
      const uniq = [];
      for (const p of parts) {
        const key = JSON.stringify(p.map);
        if (!seen.has(key)) { seen.add(key); uniq.push(p.map); }
      }
      return uniq;
    };
    const rows = [];
    hazardNodes.forEach((h) => {
      const hazardId = h.id;
      const hazardText = labelOf(hazardId);
      let leftVals = [""];
      if (hazardIdx > 0) {
        const leftCol = hazardIdx - 1;
        leftVals = edges
          .filter((e) => e.target === hazardId && getColumnIndex(e.source) === leftCol)
          .map((e) => labelOf(e.source));
        if (!leftVals.length) leftVals = [""];
      }
      let rights = enumerateRight(hazardId);
      if (!rights.length) rights = [{ [hazardIdx]: hazardText }];

      leftVals.forEach((lv) => {
        rights.forEach((rmap) => {
          const row = Array(headers.length).fill("");
          if (hazardIdx > 0) row[hazardIdx - 1] = lv;
          row[hazardIdx] = hazardText;
          for (let c = hazardIdx + 1; c < headers.length; c++) row[c] = rmap[c] || "";
          rows.push(row);
        });
      });
    });

    const presentPairs = new Set(
      rows.flatMap((r) => r.map((val, col) => (val ? `${col}::${val}` : null)).filter(Boolean))
    );
    nodes.forEach((n) => {
      const col = getColumnIndex(n.id);
      const txt = labelOf(n.id).trim();
      if (!txt) return;
      const key = `${col}::${txt}`;
      if (!presentPairs.has(key)) {
        const r = Array(headers.length).fill("");
        r[col] = txt;
        rows.push(r);
      }
    });
    return rows;
  }, []);

  // Keep table and hazardMap in sync with current graph
  useEffect(() => {
    if (!headersRef.current.length) return;

    const rows = buildRowsFromGraph(
      headersRef.current,
      nodesRef.current,
      edgesRef.current,
      cols.hazardIdx
    );
    rowsRef.current = rows;
    setTableRows(rows);

    const { hazardIdx, ucaIdx, mitIdx } = cols;
    const hMap = new Map();
    const hazardNodes = (nodesRef.current || []).filter(
      (n) => getColumnIndex(n.id) === hazardIdx
    );

    hazardNodes.forEach((n) => {
      const text = getNodeText(n).trim();
      if (!text) return;
      const key = normKey(text);

      const rowsForHaz = rows.filter((r) => String(r[hazardIdx] ?? "") === text);

      const ucaCount =
        ucaIdx >= 0
          ? edgesRef.current.filter(
              (e) => e.source === n.id && getColumnIndex(e.target) === ucaIdx
            ).length
          : 0;

      const mitCount =
        mitIdx >= 0
          ? edgesRef.current.filter(
              (e) => e.source === n.id && getColumnIndex(e.target) === mitIdx
            ).length
          : 0;

      hMap.set(key, { key, text, rows: rowsForHaz, counts: { ucas: ucaCount, mits: mitCount } });
    });

    setHazardMap(hMap);
  }, [allNodes, allEdges, cols, buildRowsFromGraph]);

  // PERSIST everything we care about (incl. new filterColIdx / activeFilterKey)
  useEffect(() => {
    if (!headersRef.current.length) return;
    if (nodesRef.current.length === 0 && edgesRef.current.length === 0) return;
    const toSave = {
      headers: headersRef.current,
      nodes: nodesRef.current.map((n) => ({
        id: n.id,
        label: getNodeText(n),
        style: n.data?.label?.style || {},
        height: n.height,
      })),
      edges: edgesRef.current.map((e) => ({ source: e.source, target: e.target })),
      ratings,
      riskConfig,
      filterColIdx,
      activeFilterKey,
    };
    safeSave(storageKey, toSave);
  }, [allNodes, allEdges, ratings, riskConfig, filterColIdx, activeFilterKey, storageKey]);

  /* ---------- FILTER BAR (generic, by selected column) ---------- */
  // Build map of unique values in the chosen filter column from current GRAPH (nodes)
  const filterMap = useMemo(() => {
    const m = new Map();
    const col = Number.isInteger(filterColIdx) ? filterColIdx : 0;
    (allNodes || [])
      .filter((n) => getColumnIndex(n.id) === col)
      .forEach((n) => {
        const text = getNodeText(n).trim();
        if (!text) return;
        const key = normKey(text);
        if (!m.has(key)) m.set(key, { key, text });
      });
    return m;
  }, [filterColIdx, allNodes]); // depends on graph so it live-updates

  // Build tabs (no "All")
  const filterTabs = useMemo(() => {
    const arr = [];
    filterMap.forEach((v) => arr.push({ key: v.key, text: v.text }));
    return arr.sort((a, b) => a.text.localeCompare(b.text));
  }, [filterMap]);

  // Ensure we always have an active tab (since "All" is removed)
  useEffect(() => {
    if (!filterTabs.length) { setActiveFilterKey(null); return; }
    if (!activeFilterKey || !filterMap.has(activeFilterKey)) {
      setActiveFilterKey(filterTabs[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTabs]);

  // Recompute diagram when the active filter changes or the graph updates
  const buildTraceSubgraph = useCallback((nodeId, nodes, edges) => {
    if (!nodeId) return { nodeSet: new Set(), edgeSet: new Set() };
    const nodeSet = new Set([nodeId]);
    const fwd = [nodeId];
    const bwd = [nodeId];

    while (fwd.length) {
      const cur = fwd.shift();
      for (const e of edges) {
        if (e.source === cur && !nodeSet.has(e.target)) {
          nodeSet.add(e.target);
          fwd.push(e.target);
        }
      }
    }
    while (bwd.length) {
      const cur = bwd.shift();
      for (const e of edges) {
        if (e.target === cur && !nodeSet.has(e.source)) {
          nodeSet.add(e.source);
          bwd.push(e.source);
        }
      }
    }
    const edgeSet = new Set(
      edges
        .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
        .map((e) => e.id)
    );
    return { nodeSet, edgeSet };
  }, []);

  const relayoutSubgraphColumns = useCallback((subNodes) => {
    const byCol = new Map();
    subNodes.forEach((n) => {
      const col = getColumnIndex(n.id);
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col).push(n);
    });

    const updated = [];
    [...byCol.entries()].sort(([a], [b]) => a - b).forEach(([colIdx, nodes]) => {
      const totalHeight = nodes.reduce((s, n) => s + (n.height ?? estimateNodeHeight(getNodeText(n))) + 40, 0);
      let y = 400 - totalHeight / 2;
      nodes.forEach((n) => {
        updated.push({ ...n, position: { x: colIdx * 500, y } });
        y += (n.height ?? estimateNodeHeight(getNodeText(n))) + 40;
      });
    });

    return updated;
  }, []);

  useEffect(() => {
    if (!headersRef.current.length) return;
    if (!activeFilterKey) {
      // If nothing selected (e.g., no nodes yet), show full graph
      setFilteredNodes(allNodes);
      setFilteredEdges(allEdges);
      setActiveNodeId(null);
      setIsIsolated(false);
      setTraceNodeIds(new Set());
      setTraceEdgeIds(new Set());
      return;
    }

    const entry = filterMap.get(activeFilterKey);
    if (!entry) return;

    const startId = nodeIdFor(filterColIdx, entry.text);
    const { nodeSet, edgeSet } = buildTraceSubgraph(startId, allNodes, allEdges);

    const subEdges = allEdges
      .filter((e) => edgeSet.has(e.id))
      .map((e) => ({
        ...e,
        style: { stroke: BRAND.warn, strokeWidth: 2.2 },
        markerEnd: { type: "arrowclosed", color: BRAND.warn },
      }));

    const subNodes = allNodes.filter((n) => nodeSet.has(n.id));
    const laid = relayoutSubgraphColumns(subNodes);

    setFilteredNodes(laid);
    setFilteredEdges(subEdges);
    setActiveNodeId(startId);
    setIsIsolated(true);
    setTraceNodeIds(nodeSet);
    setTraceEdgeIds(edgeSet);
  }, [
    activeFilterKey,
    filterColIdx,
    allNodes,
    allEdges,
    filterMap,
    buildTraceSubgraph,
    relayoutSubgraphColumns,
  ]);

  const hasData = Boolean(
    summaryData &&
    Array.isArray(summaryData.Summary) &&
    summaryData.Summary.length >= 2
  );

  /* ---------- click to trace / isolate (diagram) ---------- */
  const handleNodeClick = useCallback((_, node) => {
    if (!node?.id) return;

    // With tabs (no "All"), keep interactions inside the active subgraph
    if (activeFilterKey) {
      setActiveNodeId(node.id);
      return;
    }

    // Fallback if ever no active filter (should be rare)
    if (activeNodeId === node.id) {
      setFilteredNodes(allNodes);
      setFilteredEdges(allEdges);
      setActiveNodeId(null);
      return;
    }

    const { nodeSet: traceToTargets, edgeSet: traceEdges } = buildTraceSubgraph(node.id, allNodes, allEdges);

    const newNodes = allNodes.map((n) => {
      const isOnPath = traceToTargets.has(n.id);
      return {
        ...n,
        data: {
          ...n.data,
          label: {
            ...n.data.label,
            style: {
              ...n.data.label.style,
              border: `2px solid ${isOnPath ? BRAND.warn : BRAND.blue}`,
              boxShadow: isOnPath ? "0 6px 20px rgba(245, 158, 11, 0.20)" : "0 4px 16px rgba(13, 60, 180, 0.10)",
              backgroundColor: n.data?.label?.style?.backgroundColor,
            },
          },
        },
      };
    });

    const newEdges = allEdges.map((e) => ({
      ...e,
      style: { stroke: traceEdges.has(e.id) ? BRAND.warn : BRAND.blueDim, strokeWidth: traceEdges.has(e.id) ? 2.2 : 1.4 },
      markerEnd: { type: "arrowclosed", color: traceEdges.has(e.id) ? BRAND.warn : BRAND.blueDim },
    }));

    setTraceNodeIds(traceToTargets);
    setTraceEdgeIds(traceEdges);
    setFilteredNodes(newNodes);
    setFilteredEdges(newEdges);
    setActiveNodeId(node.id);
  }, [allNodes, allEdges, activeNodeId, activeFilterKey, buildTraceSubgraph]);

  /* ---------- misc helpers reused in List Details ---------- */
  function getUCAIdsForHazard(hazardId) {
    if (cols.ucaIdx < 0) return [];
    return edgesRef.current
      .filter((e) => e.source === hazardId && getColumnIndex(e.target) === cols.ucaIdx)
      .map((e) => e.target);
  }

  const linkedCountFor = useCallback((hazardText, colIdx) => {
    const hazardId = nodeIdFor(cols.hazardIdx, hazardText);
    if (cols.mitIdx >= 0 && colIdx === cols.mitIdx) {
      const ucaIds = getUCAIdsForHazard(hazardId);
      const mitSet = new Set();
      edgesRef.current.forEach((e) => {
        if (ucaIds.includes(e.source) && getColumnIndex(e.target) === cols.mitIdx) {
          const lbl = getNodeLabelById(nodesRef.current, e.target);
          if (lbl) mitSet.add(lbl);
        }
      });
      return mitSet.size;
    }
    if (colIdx < cols.hazardIdx) {
      return edgesRef.current.filter(
        (e) => e.target === hazardId && getColumnIndex(e.source) === colIdx
      ).length;
    }
    return edgesRef.current.filter(
      (e) => e.source === hazardId && getColumnIndex(e.target) === colIdx
    ).length;
  }, [cols.hazardIdx, cols.mitIdx, getUCAIdsForHazard]);

  const removeHazardLink = useCallback((hazardText, colIdx, value) => {
    const hazardId = nodeIdFor(cols.hazardIdx, hazardText);
    if (cols.mitIdx >= 0 && colIdx === cols.mitIdx) {
      const ucaIds = getUCAIdsForHazard(hazardId);
      const mitId  = nodeIdFor(cols.mitIdx, value);
      const nextEdges = edgesRef.current.filter(
        (e) => !(ucaIds.includes(e.source) && e.target === mitId)
      );
      const relaid = relayoutNodes(nodesRef.current.slice(), nextEdges);
      const withCbs = injectCallbacks(relaid);
      setAllNodes(withCbs);
      setFilteredNodes(withCbs);
      setAllEdges(nextEdges);
      setFilteredEdges(nextEdges);
      return;
    }
    const otherId = nodeIdFor(colIdx, value);
    const source  = colIdx < cols.hazardIdx ? otherId : hazardId;
    const target  = colIdx < cols.hazardIdx ? hazardId : otherId;
    const edgeId  = `${source}->${target}`;

    const nextEdges = edgesRef.current.filter((e) => e.id !== edgeId);
    const relaid = relayoutNodes(nodesRef.current.slice(), nextEdges);
    const withCbs = injectCallbacks(relaid);

    setAllNodes(withCbs);
    setFilteredNodes(withCbs);
    setAllEdges(nextEdges);
    setFilteredEdges(nextEdges);
  }, [cols.hazardIdx, cols.mitIdx, getUCAIdsForHazard, injectCallbacks]);

  const addHazardLinks = useCallback((hazardText, colIdx, values) => {
    const hazardId = nodeIdFor(cols.hazardIdx, hazardText);

    if (cols.mitIdx >= 0 && colIdx === cols.mitIdx) {
      const ucaIds = getUCAIdsForHazard(hazardId);
      const nextEdges = [...edgesRef.current];
      const ensureEdge = (src, tgt) => {
        const id = `${src}->${tgt}`;
        if (!nextEdges.some((e) => e.id === id)) nextEdges.push(makeEdge(src, tgt));
      };
      values.forEach((v) => {
        const mitId = nodeIdFor(cols.mitIdx, v);
        ucaIds.forEach((ucaId) => ensureEdge(ucaId, mitId));
      });
      const relaid = relayoutNodes(nodesRef.current.slice(), nextEdges);
      const withCbs = injectCallbacks(relaid);
      setAllNodes(withCbs);
      setFilteredNodes(withCbs);
      setAllEdges(nextEdges);
      setFilteredEdges(nextEdges);
      return;
    }

    const nextEdges = [...edgesRef.current];
    const ensureEdge = (src, tgt) => {
      const id = `${src}->${tgt}`;
      if (!nextEdges.some((e) => e.id === id)) nextEdges.push(makeEdge(src, tgt));
    };

    const collectUCAAncestors = (startIds) => {
      const queue = [...startIds];
      const seen = new Set(queue);
      const ucaIds = new Set();
      while (queue.length) {
        const cur = queue.shift();
        for (const e of edgesRef.current) {
          if (e.target !== cur) continue;
          const src = e.source;
          if (seen.has(src)) continue;
          seen.add(src);
          const srcCol = getColumnIndex(src);
          if (srcCol === cols.ucaIdx) ucaIds.add(src);
          else if (srcCol > cols.ucaIdx) queue.push(src);
        }
      }
      return ucaIds;
    };

    if (colIdx < cols.hazardIdx && Math.abs(colIdx - cols.hazardIdx) === 1) {
      values.forEach((v) => ensureEdge(nodeIdFor(colIdx, v), hazardId));
    } else if (colIdx === cols.ucaIdx) {
      values.forEach((v) => ensureEdge(hazardId, nodeIdFor(colIdx, v)));
    } else if (colIdx > cols.ucaIdx) {
      const startIds = values.map((v) => nodeIdFor(colIdx, v));
      const ucaIds   = collectUCAAncestors(startIds);
      ucaIds.forEach((ucaId) => ensureEdge(hazardId, ucaId));
    }

    const relaid = relayoutNodes(nodesRef.current.slice(), nextEdges);
    const withCbs = injectCallbacks(relaid);
    setAllNodes(withCbs);
    setFilteredNodes(withCbs);
    setAllEdges(nextEdges);
    setFilteredEdges(nextEdges);
  }, [cols.hazardIdx, cols.ucaIdx, cols.mitIdx, getUCAIdsForHazard, injectCallbacks]);

  const allValuesForColumn = useCallback((colIdx) => {
    const s = new Set();
    (rowsRef.current || []).forEach((row) => {
      const v = String(row[colIdx] ?? "").trim();
      if (v) s.add(v);
    });
    (nodesRef.current || [])
      .filter((n) => getColumnIndex(n.id) === colIdx)
      .forEach((n) => {
        const v = getNodeText(n).trim();
        if (v) s.add(v);
      });
    return Array.from(s);
  }, []);

  // ratings sync with hazards (kept)
  useEffect(() => {
    if (!hazardMap || hazardMap.size === 0) return;
    setRatings((prev) => {
      const next = {};
      hazardMap.forEach(({ key }) => {
        next[key] = prev[key] ?? { severity: 3, likelihood: 3, detectability: 1 };
      });
      return next;
    });
  }, [hazardMap]);

  const listItems = useMemo(() => {
    const items = [];
    hazardMap.forEach((entry) => {
      const r = ratings[entry.key] ?? { severity: 3, likelihood: 3, detectability: 1 };
      const score = computeRiskScore(r, riskConfig);
      const cat = categorize(score, riskConfig);
      items.push({ key: entry.key, text: entry.text, counts: entry.counts, rating: r, score, category: cat });
    });

    const q = listQuery.trim().toLowerCase();
    const filtered = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items;

    if (sortByRisk) filtered.sort((a, b) => b.score - a.score);
    else filtered.sort((a, b) => a.text.localeCompare(b.text));

    return filtered;
  }, [hazardMap, ratings, riskConfig, listQuery, sortByRisk]);

  const exportCSV = () => {
    const rows = [
      ["Hazard", "Severity", "Likelihood", ...(riskConfig.method === "SxLxD" ? ["Detectability"] : []), "Score", "Category", "#UCAs", "#Mitigations"],
      ...listItems.map((i) => [
        i.text.replace(/\s+/g, " "),
        i.rating.severity,
        i.rating.likelihood,
        ...(riskConfig.method === "SxLxD" ? [i.rating.detectability] : []),
        i.score,
        i.category.label,
        i.counts.ucas,
        i.counts.mits,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hazards_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportTableCsv = useCallback(() => {
    const csvRows = [
      headersRef.current.map((h, i) => h || `Column ${i + 1}`),
      ...(tableRows || []),
    ];
    const csv = csvRows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hazard-analysis-table_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [tableRows]);

  const exportDiagramXml = useCallback(() => {
    const nodesToExport = (filteredNodes?.length ? filteredNodes : allNodes).map((node) => ({
      ...node,
      data: {
        ...node.data,
        label: getNodeText(node),
      },
      width: node.width ?? 240,
      height: node.height ?? estimateNodeHeight(getNodeText(node)),
    }));
    const nodeIds = new Set(nodesToExport.map((node) => node.id));
    const edgesToExport = (filteredEdges?.length ? filteredEdges : allEdges).filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );
    downloadDrawioXml(nodesToExport, edgesToExport, "hazard-analysis-diagram.drawio.xml");
  }, [allNodes, allEdges, filteredNodes, filteredEdges]);

  const [cfgOpen, setCfgOpen] = useState(false);
  const applyCfg = () => {
    setRatings((prev) => {
      const max = riskConfig.maxScale;
      const next = {};
      for (const k of Object.keys(prev)) {
        const r = prev[k];
        next[k] = {
          severity: clamp(r.severity, 1, max),
          likelihood: clamp(r.likelihood, 1, max),
          detectability: clamp(r.detectability ?? 1, 1, max),
        };
      }
      return next;
    });
    setCfgOpen(false);
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div className="relative w-full overflow-hidden" style={{ height: "600px" }}>
      {/* View switcher + Filter-by (top-left) */}
      <div className="absolute top-3 left-4 z-30 flex items-center gap-2">
        {[VIEW.DIAGRAM, VIEW.TABLE].map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{
              background: view === v ? BRAND.blue : BRAND.white,
              color: view === v ? BRAND.white : BRAND.text,
              border: `1px solid ${BRAND.blueDim}`,
            }}
          >
            {v === VIEW.DIAGRAM ? "Diagram" : "Table"}
          </button>
        ))}

        {/* NEW: Filter-by heading selector */}
        {hasData && (
          <div className="ml-2 flex items-center gap-2">
            <span className="text-sm" style={{ color: BRAND.text }}>Filter by:</span>
            <select
              className="px-2 py-1.5 rounded-lg text-sm"
              style={{ border: `1px solid ${BRAND.blueDim}`, background: BRAND.white }}
              value={Math.min(filterColIdx ?? 0, Math.max(headers.length - 1, 0))}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setFilterColIdx(idx);
                // reset active filter to first available value in the new column
                const nextTabs = [];
                (nodesRef.current || [])
                  .filter((n) => getColumnIndex(n.id) === idx)
                  .forEach((n) => {
                    const t = getNodeText(n).trim();
                    if (t) nextTabs.push({ key: normKey(t), text: t });
                  });
                nextTabs.sort((a, b) => a.text.localeCompare(b.text));
                setActiveFilterKey(nextTabs[0]?.key || null);
              }}
            >
              {headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || `Column ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right top actions */}
      {hasData && (
        <div className="absolute top-3 right-4 z-20 flex items-center gap-2">
          <button
            onClick={exportTableCsv}
            className="px-2 py-1.5 rounded-md shadow-sm text-sm font-medium whitespace-nowrap"
            style={{ background: BRAND.white, color: BRAND.text, border: `1px solid ${BRAND.blueDim}` }}
            title="Export Table to CSV"
          >
            Export CSV
          </button>
          {view === VIEW.DIAGRAM && (
            <>
              <button
                onClick={exportDiagramXml}
                className="px-2 py-1.5 rounded-md shadow-sm text-sm font-medium whitespace-nowrap"
                style={{ background: BRAND.white, color: BRAND.text, border: `1px solid ${BRAND.blueDim}` }}
                title="Export Diagram to XML"
              >
                Export XML
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="px-2 py-1.5 rounded-md shadow-sm text-sm font-medium text-white whitespace-nowrap"
                style={{ background: BRAND.blue }}
                title="Add Node"
              >
                + Add Node
              </button>
            </>
          )}
        </div>
      )}

      {/* No data fallback */}
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          No data available to visualize.
        </div>
      )}

      {/* DIAGRAM VIEW */}
      {view === VIEW.DIAGRAM && hasData && (
        <div
          style={{
            position: "absolute",
            inset: "48px 0 0 0",
            border: `2px solid ${BRAND.blue}`,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 8px 28px rgba(13, 60, 180, 0.10)",
          }}
        >
          <ReactFlow
            nodes={filteredNodes}
            edges={filteredEdges}
            nodeTypes={{ custom: CustomNode }}
            onInit={(inst) => (reactFlowInstanceRef.current = inst)}
            onNodeClick={handleNodeClick}
            onPaneClick={() => {
              // Since "All" is gone, clicking the pane should NOT show the entire graph.
              // Keep subgraph focused; just clear active node highlight.
              setActiveNodeId(null);
              setIsIsolated(true);
            }}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            panOnScroll={false}
            zoomOnScroll={false}
            nodesDraggable={false}
            nodesConnectable={true}
            elementsSelectable={false}
            fitView
            minZoom={0.1}
            maxZoom={2}
            style={{ width: "100%", height: "100%" }}
          >
            <Background variant="dots" gap={18} size={1} color={BRAND.blueDim} />
            <Controls
              showInteractive={false}
              position="bottom-right"
              style={{ background: BRAND.white, borderRadius: 8, border: `1px solid ${BRAND.blueDim}` }}
            />
          </ReactFlow>

          {/* Legend */}
          <div
            className="absolute top-4 left-4 px-3 py-2 text-xs z-10 rounded-md"
            style={{ background: "rgba(255,255,255,0.92)", border: `1px solid ${BRAND.blueDim}`, boxShadow: "0 4px 14px rgba(13, 60, 180, 0.08)" }}
          >
            <div className="font-semibold text-gray-700 mb-1">Legend</div>
            <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
              {headers.map((header, idx) => (
                <div key={idx} className="flex items-center space-x-2">
                  <div className="w-4 h-4 rounded-sm border" style={{ backgroundColor: columnColors[idx % columnColors.length], borderColor: BRAND.blueDim }} />
                  <div className="text-gray-700">{header}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom buttons (NO "All") */}
          <div
            className="absolute left-0 right-0 bottom-0 z-30"
            style={{
              background: "rgba(255,255,255,0.96)",
              borderTop: `1px solid ${BRAND.blueDim}`,
              padding: "6px 8px",
            }}
          >
            <div className="flex items-center gap-6 overflow-x-auto px-1">
              {filterTabs.map((t) => {
                const isActive = activeFilterKey === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveFilterKey(t.key)}
                    className="shrink-0 px-10 py-1.5 rounded-full text-sm whitespace-nowrap"
                    style={{
                      background: isActive ? BRAND.blue : BRAND.white,
                      color: isActive ? BRAND.white : BRAND.text,
                      border: `1px solid ${BRAND.blueDim}`,
                      boxShadow: isActive ? "0 4px 14px rgba(13,60,180,0.16)" : "none",
                    }}
                    title={t.text}
                  >
                    {t.text.length > 36 ? t.text.slice(0, 33) + "…" : t.text}
                  </button>
                );
              })}
              {filterTabs.length === 0 && (
                <div className="text-sm text-gray-500 px-2">No items in this column.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LIST VIEW (unchanged core) */}
      {view === VIEW.LIST && hasData && (
        <div className="absolute inset-12 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Search hazards…"
              className="px-3 py-2 rounded-md border"
              style={{ borderColor: BRAND.blueDim, minWidth: 220 }}
            />
            <button
              onClick={exportCSV}
              className="px-3 py-2 rounded-md text-sm"
              style={{ border: `1px solid ${BRAND.blueDim}`, background: BRAND.white }}
            >
              Export CSV
            </button>
          </div>

          <div
            className="grid grid-cols-12 items-center px-3 py-2 text-xs font-semibold rounded-md mb-1"
            style={{ background: BRAND.blueSoft, color: BRAND.text, border: `1px solid ${BRAND.blueDim}` }}
          >
            <div className="col-span-7">Hazard</div>
          </div>

          <div className="overflow-auto h-[calc(100%-64px)] rounded-md border" style={{ borderColor: BRAND.blueDim }}>
            {listItems.map((item) => (
              <div
                key={item.key}
                onDoubleClick={() => setDetails({ open: true, key: item.key })}
                className="grid grid-cols-12 items-center px-3 py-2 border-b hover:bg-gray-50 cursor-pointer"
                style={{ borderColor: BRAND.blueDim }}
                title="Double-click for details"
              >
                <div className="col-span-7 pr-3 truncate" style={{ color: BRAND.text }}>
                  {item.text}
                </div>
              </div>
            ))}
            {listItems.length === 0 && <div className="p-6 text-sm text-gray-500">No results.</div>}
          </div>
        </div>
      )}

      {/* TABLE VIEW */}
      {view === VIEW.TABLE && hasData && (
        <div className="absolute inset-12 overflow-auto border rounded-md" style={{ borderColor: BRAND.blueDim }}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-20" style={{ background: BRAND.blueSoft }}>
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2 border-b"
                    style={{
                      position: 'sticky',
                      top: 0,
                      background: BRAND.blueSoft,
                      borderColor: BRAND.blueDim,
                      zIndex: 20,
                    }}
                  >
                    {h || `Column ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-2 border-b" style={{ borderColor: BRAND.blueDim }}>
                      {String(cell ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Node modal */}
      {addOpen && view === VIEW.DIAGRAM && hasData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[min(90vw,520px)] max-w-[520px] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 text-white" style={{ background: BRAND.blue }}>
              <div className="text-lg font-semibold">Add Node</div>
            </div>

            <div className="p-6">
              <label className="block text-sm text-gray-700 mb-1">Column</label>
              <select
                className="w-full border rounded-md p-2 mb-4"
                style={{ borderColor: BRAND.blueDim }}
                value={addColIdx}
                onChange={(e) => setAddColIdx(Number(e.target.value))}
              >
                {headers.map((h, idx) => (
                  <option key={idx} value={idx}>{h || `Column ${idx + 1}`}</option>
                ))}
              </select>

              <div className="flex justify-end gap-3">
                <button onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm rounded-md border" style={{ borderColor: BRAND.blueDim }}>
                  Cancel
                </button>
                <button onClick={() => handleAddNodeToColumn(addColIdx)} className="px-4 py-2 text-sm rounded-md text-white" style={{ background: BRAND.blue }}>
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Node modal */}
      {editorOpen && view === VIEW.DIAGRAM && hasData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[min(90vw,720px)] max-w-[720px] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 text-white" style={{ background: BRAND.blue }}>
              <div className="text-lg font-semibold">Edit Node Text</div>
            </div>

            <div className="p-6">
              <textarea
                autoFocus
                className="w-full rounded-md p-3 outline-none resize-vertical"
                style={{ border: `1px solid ${BRAND.blueDim}` }}
                rows={8}
                value={editorDraft}
                onChange={(e) => setEditorDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); closeEditor(); }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); saveEditor(); }
                }}
                placeholder="Enter node text…"
              />
              <div className="text-xs text-gray-500 mt-2 mb-4">Press Ctrl/⌘ + Enter to save, Esc to cancel</div>

              <div className="flex justify-end gap-3">
                <button onClick={closeEditor} className="px-4 py-2 text-sm rounded-md border" style={{ borderColor: BRAND.blueDim }}>
                  Cancel
                </button>
                <button onClick={saveEditor} className="px-4 py-2 text-sm rounded-md text-white" style={{ background: BRAND.blue }}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Config modal */}
      {cfgOpen && view === VIEW.LIST && hasData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[min(90vw,560px)] max-w-[560px] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 text-white" style={{ background: BRAND.blue }}>
              <div className="text-lg font-semibold">Configure Risk Assessment</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-sm font-medium" style={{ color: BRAND.text }}>Method</div>
                <label className="text-sm flex items-center gap-2">
                  <input type="radio" name="method" checked={riskConfig.method === "SxL"} onChange={() => setRiskConfig((c) => ({ ...c, method: "SxL" }))} />
                  S × L
                </label>
                <label className="text-sm flex items-center gap-2">
                  <input type="radio" name="method" checked={riskConfig.method === "SxLxD"} onChange={() => setRiskConfig((c) => ({ ...c, method: "SxLxD" }))} />
                  S × L × D
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-medium" style={{ color: BRAND.text, minWidth: 120 }}>Scale (max)</div>
                <input
                  type="number"
                  min={3}
                  max={10}
                  value={riskConfig.maxScale}
                  onChange={(e) => setRiskConfig((c) => ({ ...c, maxScale: clamp(Number(e.target.value || 5), 3, 10) }))}
                  className="px-2 py-1 rounded border w-24"
                  style={{ borderColor: BRAND.blueDim }}
                />
                <div className="text-xs text-gray-500">Affects the dropdown ranges in the list.</div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-medium" style={{ color: BRAND.text, minWidth: 120 }}>Thresholds</div>
                <div className="flex items-center gap-2 text-sm">
                  Low ≤
                  <input
                    type="number"
                    value={riskConfig.thresholds.low}
                    onChange={(e) => setRiskConfig((c) => ({ ...c, thresholds: { ...c.thresholds, low: Number(e.target.value || 1) } }))}
                    className="px-2 py-1 rounded border w-20"
                    style={{ borderColor: BRAND.blueDim }}
                  />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  Medium ≤
                  <input
                    type="number"
                    value={riskConfig.thresholds.med}
                    onChange={(e) => setRiskConfig((c) => ({ ...c, thresholds: { ...c.thresholds, med: Number(e.target.value || 1) } }))}
                    className="px-2 py-1 rounded border w-20"
                    style={{ borderColor: BRAND.blueDim }}
                  />
                </div>
                <div className="text-xs text-gray-500">High is above Medium.</div>
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => setCfgOpen(false)} className="px-4 py-2 text-sm rounded-md border" style={{ borderColor: BRAND.blueDim }}>
                  Cancel
                </button>
                <button onClick={applyCfg} className="px-4 py-2 text-sm rounded-md text-white" style={{ background: BRAND.blue }}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hazard Details modal (list) */}
      {details.open && view === VIEW.LIST && hasData && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setDetails({ open: false, key: null })}
          aria-label="Close hazard details"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[min(96vw,1120px)] max-w-[1120px] rounded-2xl overflow-hidden shadow-2xl"
            style={{
              background: BRAND.white,
              border: `1px solid ${BRAND.blueDim}`,
              maxHeight: "66vh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const entry = hazardMap.get(details.key);
              if (!entry) return null;
              const sysReqIdx  = findIdx(headers, /\bsystem\s*requirements?\b/i);
              const consReqIdx = findIdx(headers, /\bconsolidated\s*requirements?\b/i);

              
              // keep Loss & Mitigation Strategy interactive; add System & Consolidated Requirement
// columns that should show "+ Add" and allow removing links
              // collect uniques per column (used for non-adjacent sections)
              const uniquesByCol = headers.map(() => new Set());
              entry.rows.forEach((r) =>
                r.forEach((v, idx) => {
                  if (String(v || "").trim()) uniquesByCol[idx].add(String(v));
                })
              );

              // risk for this hazard
              const rating = ratings[entry.key] ?? { severity: 3, likelihood: 3, detectability: 1 };
              const score  = computeRiskScore(rating, riskConfig);
              const cat    = categorize(score, riskConfig);

              // NEW: counts reflect CURRENT LINKS (edges)
              const ucaCount = cols.ucaIdx >= 0 ? linkedCountFor(entry.text, cols.ucaIdx) : 0;
              const mitCount = cols.mitIdx >= 0 ? linkedCountFor(entry.text, cols.mitIdx) : 0;

              return (
                <>
                  {/* Header: title + risk badge + close */}
                  <div
                    className="px-6 py-3 text-white flex items-center gap-3"
                    style={{ background: BRAND.blue }}
                  >
                    <div className="text-lg font-semibold truncate pr-2 flex-1">{entry.text}</div>

                    <div
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm"
                      style={{
                        background: `${cat.color}26`,
                        border: `1px solid ${cat.color}`,
                        color: "#fff",
                      }}
                      title={`Score: ${score}`}
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: cat.color }}
                      />
                      <span className="font-medium">{cat.label}</span>
                      <span className="opacity-90">({score})</span>
                    </div>

                    <button
                      onClick={() => setDetails({ open: false, key: null })}
                      className="ml-2 inline-flex items-center justify-center w-8 h-8 rounded-md text-white/90 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60"
                      aria-label="Close"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>

                  {/* Body: left sidebar (risk + stats) / right content (by column) */}
                  <div className="flex gap-4 p-4 overflow-hidden" style={{ flex: "1 1 auto" }}>
                    {/* LEFT: Risk + Quick stats */}
                    <aside
                      className="shrink-0 w-[300px] space-y-4"
                      aria-label="Risk assessment and quick stats"
                    >

                      {/* Quick stats */}
                      <div
                        className="rounded-xl p-4"
                        style={{ border: `1px solid ${BRAND.blueDim}`, boxShadow: "0 6px 20px rgba(13, 60, 180, 0.06)" }}
                      >
                        <div className="text-sm font-semibold mb-3" style={{ color: BRAND.text }}>
                          At-a-glance
                        </div>
                        <div className="space-y-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Rows</span>
                            <span className="font-medium" style={{ color: BRAND.text }}>{entry.rows.length}</span>
                          </div>
                          {cols.ucaIdx >= 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">UCAs</span>
                              <span className="font-medium" style={{ color: BRAND.text }}>{ucaCount}</span>
                            </div>
                          )}
                          {cols.mitIdx >= 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Mitigations</span>
                              <span className="font-medium" style={{ color: BRAND.text }}>{mitCount}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </aside>

 {/* RIGHT: grouped by column with collapsible sections */}
<section
  className="flex-1 min-w-0 overflow-auto"
  aria-label="Grouped related information"
>
  {(() => {
    // Sections that are editable (show +Add and allow removing links)
const interactiveCols = new Set(
  [cols.lossIdx, cols.ucaIdx, cols.mitIdx, sysReqIdx, consReqIdx].filter((i) => i >= 0)
);


    const hazardId = nodeIdFor(cols.hazardIdx, entry.text);

    const edgeValuesForColumn = (colIdx) => {
      if (cols.mitIdx >= 0 && colIdx === cols.mitIdx) {
        // Mitigations linked through any UCA of this hazard
        const ucaIds = getUCAIdsForHazard(hazardId);
        const mitLabels = new Set();
        edgesRef.current.forEach((e) => {
          if (ucaIds.includes(e.source) && getColumnIndex(e.target) === cols.mitIdx) {
            const lbl = getNodeLabelById(nodesRef.current, e.target);
            if (lbl) mitLabels.add(lbl);
          }
        });
        return Array.from(mitLabels);
      }
    
      // Default: direct edges touching the hazard
      return Array.from(
        new Set(
          edgesRef.current
            .filter(
              (e) =>
                (e.source === hazardId && getColumnIndex(e.target) === colIdx) ||
                (e.target === hazardId && getColumnIndex(e.source) === colIdx)
            )
            .map((e) =>
              e.source === hazardId
                ? getNodeLabelById(nodesRef.current, e.target)
                : getNodeLabelById(nodesRef.current, e.source)
            )
            .filter(Boolean)
        )
      );
    };
    
    const rowValuesForColumn = (colIdx) => {
      const s = new Set();
      entry.rows.forEach((r) => {
        const v = String(r[colIdx] ?? "").trim();
        if (v) s.add(v);
      });
      return Array.from(s);
    };
    
    const valsForColumn = (colIdx) => {
      const fromEdges = edgeValuesForColumn(colIdx);
      return (fromEdges.length ? fromEdges : rowValuesForColumn(colIdx)).sort((a, b) => a.localeCompare(b));
    };
    
    const isLinked = (colIdx, value) => {
      if (cols.mitIdx >= 0 && colIdx === cols.mitIdx) {
        const ucaIds = getUCAIdsForHazard(hazardId);
        const mitId  = nodeIdFor(cols.mitIdx, value);
        return edgesRef.current.some((e) => ucaIds.includes(e.source) && e.target === mitId);
      }
      const otherId = nodeIdFor(colIdx, value);
      return edgesRef.current.some(
        (e) =>
          (e.source === hazardId && e.target === otherId) ||
          (e.target === hazardId && e.source === otherId)
      );
    };

    return (
      <div className="space-y-3 pr-1">
        {headers.map((h, idx) => {
          if (idx === cols.hazardIdx) return null;

          const isInteractive = interactiveCols.has(idx);
          const vals = valsForColumn(idx);

          // Non-interactive sections can be hidden if truly empty
          if (!isInteractive && vals.length === 0) return null;

          return (
            <details
              key={idx}
              className="rounded-lg border"
              style={{ borderColor: BRAND.blueDim, background: "#fff" }}
            >
              <summary
                className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none"
                style={{ listStyle: "none" }}
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm border"
                  style={{
                    background: columnColors[idx % columnColors.length],
                    borderColor: BRAND.blueDim,
                  }}
                />
                <span className="text-sm font-medium" style={{ color: BRAND.text }}>
                  {h || `Column ${idx + 1}`}
                </span>

                <span className="ml-auto text-xs text-gray-500 mr-2">
                  {vals.length} {vals.length === 1 ? "item" : "items"}
                </span>
              </summary>

              <div className="px-3 pb-3">
                {vals.length === 0 ? (
                  <div className="text-xs text-gray-500">No items.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {vals.map((v) => {
                      const linked = isLinked(idx, v);
                      return (
                        <span
                          key={v}
                          className="relative inline-flex items-center px-2 py-1 text-xs rounded-full border"
                          style={{ borderColor: BRAND.blueDim, paddingRight: isInteractive && linked ? 20 : 8 }}
                          title={v}
                        >
                          {v}
                          {isInteractive && linked && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeHazardLink(entry.text, idx, v);
                              }}
                              className="absolute -right-1 -top-1 w-4 h-4 rounded-full text-[10px] leading-none flex items-center justify-center"
                              style={{
                                background: BRAND.danger,
                                color: BRAND.white,
                                boxShadow: "0 0 0 1px #fff",
                              }}
                              aria-label={`Remove ${v}`}
                              title={`Remove ${v}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      );
                    })}

                    {isInteractive && (
                      <button
                        type="button"
                        onClick={() =>
                          setAddTrace({
                            open: true,
                            colIdx: idx,
                            hazardKey: entry.key,
                            search: "",
                            selected: new Set(),
                          })
                        }
                        className="px-2 py-1 text-xs rounded-full border"
                        style={{ borderColor: BRAND.blueDim, background: BRAND.white }}
                        title="Add linked item"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    );
  })()}
</section>

                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Add Trace modal (pick losses/UCAs/etc to link to the hazard) */}
      {addTrace.open && view === VIEW.LIST && hasData && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setAddTrace((s) => ({ ...s, open: false }))}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[min(92vw,680px)] max-w-[680px] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-3 text-white flex items-center justify-between" style={{ background: BRAND.blue }}>
              <div className="text-lg font-semibold">Add Linked Items</div>
              <button
                onClick={() => setAddTrace((s) => ({ ...s, open: false }))}
                className="text-white/90 hover:text-white text-xl leading-none"
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>

            {(() => {
              // figure out what’s already linked (so we can exclude from the picker)
              const hazardEntry = hazardMap.get(addTrace.hazardKey);
              const hazardText  = hazardEntry?.text ?? "";
              const hazardId    = nodeIdFor(cols.hazardIdx, hazardText);

              let alreadyLinked = new Set();
              if (addTrace.colIdx != null) {
                if (cols.mitIdx >= 0 && addTrace.colIdx === cols.mitIdx) {
                  // Mitigation section: consider UCA->Mitigation edges for this hazard
                  const ucaIds = getUCAIdsForHazard(hazardId);
                  edgesRef.current.forEach((e) => {
                    if (ucaIds.includes(e.source) && getColumnIndex(e.target) === cols.mitIdx) {
                      const label = getNodeLabelById(nodesRef.current, e.target);
                      if (label) alreadyLinked.add(label);
                    }
                  });
                } else if (addTrace.colIdx < cols.hazardIdx) {
                  // incoming col -> hazard
                  edgesRef.current
                    .filter((e) => e.target === hazardId && getColumnIndex(e.source) === addTrace.colIdx)
                    .forEach((e) => {
                      const label = getNodeLabelById(nodesRef.current, e.source);
                      if (label) alreadyLinked.add(label);
                    });
                } else {
                  // hazard -> outgoing col (direct adjacency)
                  edgesRef.current
                    .filter((e) => e.source === hazardId && getColumnIndex(e.target) === addTrace.colIdx)
                    .forEach((e) => {
                      const label = getNodeLabelById(nodesRef.current, e.target);
                      if (label) alreadyLinked.add(label);
                    });
                }
              }
              

              const allVals   = allValuesForColumn(addTrace.colIdx ?? 0);
              const options   = allVals.filter((v) => v && !alreadyLinked.has(v));
              const filtered  = (addTrace.search.trim()
                ? options.filter((v) => v.toLowerCase().includes(addTrace.search.trim().toLowerCase()))
                : options
              ).sort((a, b) => a.localeCompare(b)); // NEW: alphabetize

              return (
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <input
                      placeholder="Search…"
                      value={addTrace.search}
                      onChange={(e) => setAddTrace((s) => ({ ...s, search: e.target.value }))}
                      className="px-3 py-2 rounded-md border flex-1"
                      style={{ borderColor: BRAND.blueDim }}
                    />
                    <div className="text-xs text-gray-500">
                      {filtered.length} available
                    </div>
                  </div>

                  <div
                    className="border rounded-md overflow-auto"
                    style={{ borderColor: BRAND.blueDim, maxHeight: 320 }}
                  >
                    {filtered.length === 0 ? (
                      <div className="p-4 text-sm text-gray-500">No items available.</div>
                    ) : (
                      <ul className="divide-y" style={{ borderColor: BRAND.blueDim }}>
                        {filtered.map((v) => {
                          return (
                            <li key={v} className="flex items-center justify-between px-3 py-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={addTrace.selected.has(v) || alreadyLinked.has(v)}   // ✅ pre-check if linked
                                  onChange={(e) =>
                                    setAddTrace((s) => {
                                      const sel = new Set(s.selected);
                                      if (e.target.checked) sel.add(v);
                                      else sel.delete(v);
                                      return { ...s, selected: sel };
                                    })
                                  }
                                />
                                <span className="text-sm">{v}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setAddTrace((s) => ({ ...s, open: false }))}
                      className="px-4 py-2 text-sm rounded-md border"
                      style={{ borderColor: BRAND.blueDim }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!hazardEntry) return;
                        const toAdd = Array.from(addTrace.selected);
                        if (toAdd.length) {
                          addHazardLinks(hazardEntry.text, addTrace.colIdx, toAdd);
                        }
                        setAddTrace({ open: false, colIdx: null, hazardKey: null, search: "", selected: new Set() });
                      }}
                      className="px-4 py-2 text-sm rounded-md text-white"
                      style={{ background: BRAND.blue }}
                      disabled={addTrace.selected.size === 0}
                    >
                      Add Selected
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
