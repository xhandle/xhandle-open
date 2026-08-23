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
  BezierEdge,
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
  BaseEdge,
  updateEdge,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import { SmartBezierEdge } from '@tisoap/react-flow-smart-edge';
import { downloadDrawioXml } from './utils/exportDrawio';
import { notifyBackupDataChanged } from '../lib/localBackupEvents';

// Import layout management functions
import {
  runElkLayoutOnce,
  snap,
  isOverlapping,
  nearestFreePosition,
  nudgeIfOverlapping,
  seedPosition,
  resolveOverlaps,
  spreadToViewport,
  structureSignature,
} from './nodeLayoutManager';
import GroupBoxNode from './GroupBoxNode';
import {
  computeGroupBounds,
  computeBoxGroupBounds,
  buildGroupBoxNodes,
  isGroupBox,
  attachNodesToBoxes,
  attachBoxesToBoxes,
} from './nodeLayoutManager';

const WINDOWS_REVIEW_PINCH_ZOOM_MULTIPLIER = 2.25;

function isWindowsReviewRuntime() {
  if (typeof navigator === "undefined") return false;
  return /win/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);
}

// --- IndexedDB storage for diagram positions (unified schema) ---
const IDB_DB_NAME = "xhandle";
const IDB_VERSION = 4; // must match other files
const IDB_STORES = {
  codeIndex: "code_index",
  cba: "copilot_baseline",
  positions: "diagram_positions",
};

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
      console.warn("IndexedDB upgrade blocked; close other tabs using xHandle.");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hasDiagramPositionsStore(db) {
  return db?.objectStoreNames?.contains?.(IDB_STORES.positions);
}

async function idbPositionsLoad(storageKey) {
  const db = await idbOpen();
  if (!hasDiagramPositionsStore(db)) return new Map();
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

async function idbPositionsSave(storageKey, map) {
  const db = await idbOpen();
  if (!hasDiagramPositionsStore(db)) return;
  const arr = Array.from(map.entries()); // [[id,{x,y}], ...]
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORES.positions, "readwrite");
    tx.objectStore(IDB_STORES.positions).put({ key: storageKey, value: arr });
    tx.oncomplete = () => {
      notifyBackupDataChanged({ db: IDB_DB_NAME, stores: [IDB_STORES.positions], key: storageKey });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

function systemElementColorStorageKey(storageKey) {
  return `xhandle:cross-repo-system-element-colors:${storageKey || 'default'}`;
}

function loadSystemElementColorOverrides(storageKey) {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(systemElementColorStorageKey(storageKey)) || '{}');
    return new Map(Object.entries(parsed || {}).filter(([, value]) => typeof value === 'string' && value));
  } catch {
    return new Map();
  }
}

function saveSystemElementColorOverrides(storageKey, overrides) {
  if (typeof localStorage === 'undefined') return;
  const value = Object.fromEntries(overrides instanceof Map ? overrides.entries() : []);
  localStorage.setItem(systemElementColorStorageKey(storageKey), JSON.stringify(value));
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

const SYSTEM_ELEMENT_COLORS = [
  '#2D7DFE',
  '#14B8A6',
  '#A855F7',
  '#F59E0B',
  '#EF4444',
  '#22C55E',
  '#06B6D4',
  '#EC4899',
  '#6366F1',
  '#84CC16',
  '#F97316',
  '#0EA5E9',
];

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
    minZoom: 0.02,
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

function stableColorForSystemElement(value) {
  const text = String(value || '').trim();
  if (!text) return BRAND.blue;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return SYSTEM_ELEMENT_COLORS[Math.abs(hash) % SYSTEM_ELEMENT_COLORS.length];
}

function normalizeHexColor(value, fallback = '') {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

// Take the first file from a "Related File(s)" cell (handles comma/semicolon lists)
function primaryFile(cell) {
  if (!cell || typeof cell !== 'string') return '';
  const first = cell.split(/[,;]+/)[0].trim();
  return first;
}

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

const FUNCTION_GROUP_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'this', 'that', 'these', 'those',
  'data', 'system', 'module', 'service', 'handler', 'manager', 'process', 'control', 'action',
  'send', 'receive', 'handle', 'update', 'processes', 'manage', 'manages', 'provide', 'provides',
  'execute', 'executes', 'compute', 'computes', 'read', 'reads', 'write', 'writes',
]);
const ARCH_KEY_SEP = '::';

function tokenizeFunctionLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !FUNCTION_GROUP_STOPWORDS.has(token));
}

function humanizeToken(token) {
  return String(token || '').replace(/^\w/, (ch) => ch.toUpperCase());
}

function inferFunctionGroupForFile(file, rows) {
  const tokenCounts = new Map();
  const phraseCounts = new Map();

  for (const row of rows || []) {
    const associations = [
      { file: primaryFile(row.fromFile), fn: row.fromFunction },
      { file: primaryFile(row.toFile), fn: row.toFunction },
    ];
    for (const assoc of associations) {
      if (assoc.file !== file || !assoc.fn) continue;
      const phrase = String(assoc.fn).trim();
      if (phrase) phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      for (const token of tokenizeFunctionLabel(assoc.fn)) {
        tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
      }
    }
  }

  const topTokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([token]) => humanizeToken(token));

  if (topTokens.length >= 2) return `${topTokens[0]} / ${topTokens[1]}`;
  if (topTokens.length === 1) return topTokens[0];

  const topPhrase = Array.from(phraseCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (topPhrase) return topPhrase;

  const parts = String(file || '').split('/').filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 2];
  return 'General';
}

function cleanArchLabel(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function archPath(row) {
  const arch = row?.architecture || {};
  return {
    subsystem: cleanArchLabel(arch.subsystem, 'Application Subsystem'),
    csci: cleanArchLabel(arch.csci, 'Application Software'),
    csc: cleanArchLabel(arch.csc, 'Core Components'),
    csu: cleanArchLabel(arch.csu, cleanArchLabel(row?.fromFunction || row?.toFunction, 'Functional Unit')),
    descriptions: arch.descriptions || {},
  };
}

function summarizeGroupDescription(label, kind, nodes = []) {
  const rowRefs = Array.from(new Set(nodes.flatMap((node) => node?.data?.codeEvidence?.rowRefs || []))).filter(Boolean);
  const files = Array.from(new Set(nodes.flatMap((node) => node?.data?.codeEvidence?.files || []))).filter(Boolean);
  const functions = Array.from(new Set(nodes.map((node) => node?.data?.label).filter(Boolean))).slice(0, 6);
  const kindLabel = kind === 'csci' ? 'CSCI' : kind === 'csc' ? 'CSC' : kind === 'csu' ? 'CSU' : 'subsystem';
  const count = rowRefs.length || nodes.length;
  const fnText = functions.length ? ` It includes ${functions.join(', ')}.` : '';
  const fileText = files.length ? ` Source evidence includes ${files.slice(0, 5).join(', ')}.` : '';
  const rowText = rowRefs.length ? ` Related rows: ${rowRefs.slice(0, 10).join(', ')}.` : '';
  return `The ${label} ${kindLabel} groups ${count} code-derived functional relationship${count === 1 ? '' : 's'}.${fnText}${fileText}${rowText}`.trim();
}

function computeArchitectureByFunction(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const arch = archPath(row);
    const refs = [row.rowRef].filter(Boolean);
    const files = [
      primaryFile(row.fromFile),
      primaryFile(row.toFile),
      ...(row.codeEvidence?.files || []).map((file) => file.filePath),
    ].filter(Boolean);
    const evidence = {
      rowRefs: refs,
      files: Array.from(new Set(files)),
      imports: Array.from(new Set((row.codeEvidence?.files || []).flatMap((file) => file.imports || []))).slice(0, 8),
      exports: Array.from(new Set((row.codeEvidence?.files || []).flatMap((file) => file.exports || []))).slice(0, 8),
      sourceFunctions: Array.from(
        new Map(
          [
            ...(row.sourceEvidence?.functions || []),
            ...(row.codeEvidence?.sourceFunctions || []),
            ...(row.codeEvidence?.files || []).flatMap((file) => file.sourceFunctions || []),
          ]
            .filter((fn) => fn?.functionName && fn?.filePath)
            .map((fn) => [`${fn.filePath}:${fn.functionName}:${fn.startLine || ''}`, fn])
        ).values()
      ).slice(0, 30),
      rationale: row.architecture?.rationale || '',
    };

    [row.fromFunction, row.toFunction].filter(Boolean).forEach((fn) => {
      if (!map.has(fn)) {
        map.set(fn, { ...arch, evidence });
        return;
      }
      const current = map.get(fn);
      map.set(fn, {
        ...current,
        evidence: {
          rowRefs: Array.from(new Set([...(current.evidence?.rowRefs || []), ...refs])),
          files: Array.from(new Set([...(current.evidence?.files || []), ...files])),
          imports: Array.from(new Set([...(current.evidence?.imports || []), ...evidence.imports])).slice(0, 8),
          exports: Array.from(new Set([...(current.evidence?.exports || []), ...evidence.exports])).slice(0, 8),
          sourceFunctions: Array.from(
            new Map(
              [...(current.evidence?.sourceFunctions || []), ...evidence.sourceFunctions]
                .filter((fn) => fn?.functionName && fn?.filePath)
                .map((fn) => [`${fn.filePath}:${fn.functionName}:${fn.startLine || ''}`, fn])
            ).values()
          ).slice(0, 30),
          rationale: current.evidence?.rationale || evidence.rationale,
        },
      });
    });
  }
  return map;
}

function makePackedBoxNode({ id, label, groupKind, groupKey, parentGroupKey, position, width, height, parentNode, description = '', codeEvidence = null, systemElementColor = null }) {
  return {
    id,
    type: 'groupBox',
    className: 'x-category-box-node',
    position,
    data: { label, groupKind, groupKey, parentGroupKey, description, codeEvidence, systemElementColor },
    parentNode,
    extent: parentNode ? 'parent' : undefined,
    draggable: true,
    selectable: true,
    focusable: false,
    deletable: false,
    style: { width, height, zIndex: 0 },
  };
}

function packRectsGrid(items, { columns, gap = 48 } = {}) {
  if (!items.length) return [];
  const columnCount = Math.max(1, Math.min(items.length, columns || Math.ceil(Math.sqrt(items.length))));
  const columnWidths = Array.from({ length: columnCount }, () => 0);
  const rowCount = Math.ceil(items.length / columnCount);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  items.forEach((item, index) => {
    const col = index % columnCount;
    const row = Math.floor(index / columnCount);
    columnWidths[col] = Math.max(columnWidths[col], item.width);
    rowHeights[row] = Math.max(rowHeights[row], item.height);
  });

  const columnX = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((sum, width) => sum + width + gap, 0)
  );
  const rowY = rowHeights.map((_, index) =>
    rowHeights.slice(0, index).reduce((sum, height) => sum + height + gap, 0)
  );

  return items.map((item, index) => {
    const col = index % columnCount;
    const row = Math.floor(index / columnCount);
    return { ...item, x: columnX[col], y: rowY[row] };
  });
}

function measurePackedGrid(items, { columns, gap = 48 } = {}) {
  const packed = packRectsGrid(items, { columns, gap });
  const width = Math.max(...packed.map((item) => item.x + item.width), 0);
  const height = Math.max(...packed.map((item) => item.y + item.height), 0);
  return { packed, width, height };
}

function packRectsBalanced(items, { gap = 48, targetAspect = 1.15, maxColumns = 8 } = {}) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(items.length, maxColumns));
  let best = null;
  for (let columns = 1; columns <= limit; columns += 1) {
    const candidate = measurePackedGrid(items, { columns, gap });
    const aspect = candidate.width / Math.max(candidate.height, 1);
    const aspectScore = Math.abs(Math.log(aspect / targetAspect));
    const emptySlots = columns * Math.ceil(items.length / columns) - items.length;
    const score = aspectScore + emptySlots * 0.015;
    if (!best || score < best.score) best = { ...candidate, score };
  }
  return best?.packed || [];
}

function measurePackedMasonry(items, { columns, gap = 48 } = {}) {
  const columnCount = Math.max(1, Math.min(items.length, columns || Math.ceil(Math.sqrt(items.length))));
  const columnsState = Array.from({ length: columnCount }, () => ({ height: 0, width: 0, items: [] }));
  const ordered = items
    .map((item, originalIndex) => ({ ...item, originalIndex }))
    .sort((a, b) => (b.height * b.width) - (a.height * a.width) || String(a.label || '').localeCompare(String(b.label || '')));

  ordered.forEach((item) => {
    const target = columnsState
      .map((column, index) => ({ column, index }))
      .sort((a, b) => a.column.height - b.column.height || a.index - b.index)[0].column;
    target.items.push(item);
    target.width = Math.max(target.width, item.width);
    target.height += item.height + (target.items.length > 1 ? gap : 0);
  });

  const columnX = columnsState.map((_, index) =>
    columnsState.slice(0, index).reduce((sum, column) => sum + column.width + gap, 0)
  );
  const packed = [];
  columnsState.forEach((column, columnIndex) => {
    let y = 0;
    column.items.forEach((item) => {
      packed.push({ ...item, x: columnX[columnIndex], y });
      y += item.height + gap;
    });
  });
  return {
    packed: packed.sort((a, b) => a.originalIndex - b.originalIndex).map(({ originalIndex, ...item }) => item),
    width: Math.max(...columnsState.map((column, index) => columnX[index] + column.width), 0),
    height: Math.max(...columnsState.map((column) => column.height), 0),
  };
}

function packRectsMasonryBalanced(items, { gap = 48, targetAspect = 1.15, maxColumns = 6 } = {}) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(items.length, maxColumns));
  let best = null;
  for (let columns = 1; columns <= limit; columns += 1) {
    const candidate = measurePackedMasonry(items, { columns, gap });
    const aspect = candidate.width / Math.max(candidate.height, 1);
    const aspectScore = Math.abs(Math.log(aspect / targetAspect));
    const columnPenalty = columns > items.length ? 1 : 0;
    const score = aspectScore + columnPenalty;
    if (!best || score < best.score) best = { ...candidate, score };
  }
  return best?.packed || [];
}

function columnsForSquareNodeGrid(count, { maxColumns = 8 } = {}) {
  if (count <= 1) return 1;
  const stepX = THEME.node.w + 72;
  const stepY = THEME.node.h + 54;
  const ideal = Math.ceil(Math.sqrt(count * (stepY / stepX)));
  return Math.max(1, Math.min(maxColumns, count, ideal));
}

function buildArchitectureLayout(elkNodes, { colorSystemElements = false, systemElementColorOverrides = new Map() } = {}) {
  const dims = {
    nodeGapX: 72,
    nodeGapY: 54,
    csuPad: 20,
    csuTop: 50,
    cscPad: 26,
    cscTop: 58,
    csciPad: 32,
    csciTop: 68,
    csuGap: 48,
    cscGap: 64,
    csciGap: 96,
  };

  const root = new Map();
  const fallback = {
    subsystem: 'Application Subsystem',
    csci: 'Application Software',
    csc: 'Core Components',
    csu: 'Functional Unit',
  };

  for (const node of elkNodes || []) {
    const subsystem = cleanArchLabel(node?.data?.subsystem, fallback.subsystem);
    const csci = cleanArchLabel(node?.data?.csci, fallback.csci);
    const csc = cleanArchLabel(node?.data?.csc, fallback.csc);
    const csu = cleanArchLabel(node?.data?.csu, fallback.csu);
    const subsystemKey = node?.data?.subsystemKey || subsystem;
    const csciKey = node?.data?.csciKey || `${subsystem}${ARCH_KEY_SEP}${csci}`;
    const cscKey = node?.data?.cscKey || `${subsystem}${ARCH_KEY_SEP}${csci}${ARCH_KEY_SEP}${csc}`;
    const csuKey = node?.data?.csuKey || `${subsystem}${ARCH_KEY_SEP}${csci}${ARCH_KEY_SEP}${csc}${ARCH_KEY_SEP}${csu}`;

    const descriptions = node?.data?.architectureDescriptions || {};
    if (!root.has(subsystemKey)) root.set(subsystemKey, { key: subsystemKey, label: subsystem, description: descriptions.subsystem || '', nodes: [], cscis: new Map() });
    const subsystemGroup = root.get(subsystemKey);
    subsystemGroup.nodes.push(node);
    if (!subsystemGroup.description) subsystemGroup.description = descriptions.subsystem || '';
    if (!subsystemGroup.cscis.has(csciKey)) subsystemGroup.cscis.set(csciKey, { key: csciKey, label: csci, description: descriptions.csci || '', parentKey: subsystemKey, nodes: [], cscs: new Map() });
    const csciGroup = subsystemGroup.cscis.get(csciKey);
    csciGroup.nodes.push(node);
    if (!csciGroup.description) csciGroup.description = descriptions.csci || '';
    if (!csciGroup.cscs.has(cscKey)) csciGroup.cscs.set(cscKey, { key: cscKey, label: csc, description: descriptions.csc || '', parentKey: csciKey, nodes: [], csus: new Map() });
    const cscGroup = csciGroup.cscs.get(cscKey);
    cscGroup.nodes.push(node);
    if (!cscGroup.description) cscGroup.description = descriptions.csc || '';
    if (!cscGroup.csus.has(csuKey)) cscGroup.csus.set(csuKey, { key: csuKey, label: csu, description: descriptions.csu || '', parentKey: cscKey, nodes: [] });
    if (!cscGroup.csus.get(csuKey).description) cscGroup.csus.get(csuKey).description = descriptions.csu || '';
    cscGroup.csus.get(csuKey).nodes.push(node);
  }

  const subsystemItems = Array.from(root.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((subsystemGroup) => {
      const csciItems = Array.from(subsystemGroup.cscis.values())
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((csciGroup) => {
          const cscItems = Array.from(csciGroup.cscs.values())
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((cscGroup) => {
              const csuItems = Array.from(cscGroup.csus.values())
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((csuGroup) => {
                  const childNodes = [...csuGroup.nodes].sort((a, b) => String(a.data?.label || a.id).localeCompare(String(b.data?.label || b.id)));
                  const cols = columnsForSquareNodeGrid(childNodes.length || 1, { maxColumns: 8 });
                  const rowsCount = Math.max(1, Math.ceil((childNodes.length || 1) / cols));
                  const width = Math.max(
                    360,
                    dims.csuPad * 2 + cols * THEME.node.w + Math.max(0, cols - 1) * dims.nodeGapX
                  );
                  const height = Math.max(
                    190,
                    dims.csuTop + dims.csuPad + rowsCount * THEME.node.h + Math.max(0, rowsCount - 1) * dims.nodeGapY
                  );
                  return { ...csuGroup, childNodes, cols, width, height };
                });

              const packedCsus = packRectsBalanced(csuItems, { gap: dims.csuGap, targetAspect: 1.2, maxColumns: 6 });
              const contentWidth = Math.max(...packedCsus.map((item) => item.x + item.width), 0);
              const contentHeight = Math.max(...packedCsus.map((item) => item.y + item.height), 0);
              return {
                ...cscGroup,
                csus: packedCsus,
                width: Math.max(440, dims.cscPad * 2 + contentWidth),
                height: Math.max(260, dims.cscTop + dims.cscPad + contentHeight),
              };
            });

          const packedCscs = packRectsMasonryBalanced(cscItems, { gap: dims.cscGap, targetAspect: 1.18, maxColumns: 5 });
          const contentWidth = Math.max(...packedCscs.map((item) => item.x + item.width), 0);
          const contentHeight = Math.max(...packedCscs.map((item) => item.y + item.height), 0);
          return {
            ...csciGroup,
            cscs: packedCscs,
            width: Math.max(520, dims.csciPad * 2 + contentWidth),
            height: Math.max(340, dims.csciTop + dims.csciPad + contentHeight),
          };
        });

      const packedCscis = packRectsBalanced(csciItems, { gap: dims.csciGap, targetAspect: 1.15, maxColumns: 4 });
      const contentWidth = Math.max(...packedCscis.map((item) => item.x + item.width), 0);
      const contentHeight = Math.max(...packedCscis.map((item) => item.y + item.height), 0);
      return {
        ...subsystemGroup,
        cscis: packedCscis,
        width: Math.max(620, dims.csciPad * 2 + contentWidth),
        height: Math.max(430, dims.csciTop + dims.csciPad + contentHeight),
      };
    });

  const packedSubsystems = packRectsBalanced(subsystemItems, { gap: dims.csciGap, targetAspect: 1.2, maxColumns: 4 });
  const subsystemBoxes = [];
  const csciBoxes = [];
  const cscBoxes = [];
  const csuBoxes = [];
  const childNodes = [];
  const absoluteNodes = [];

  for (const subsystem of packedSubsystems) {
    const subsystemId = `box:subsystem:${subsystem.key}`;
    const savedSystemElementColor =
      systemElementColorOverrides?.get?.(subsystem.key) ||
      systemElementColorOverrides?.get?.(subsystem.label);
    const systemElementColor = colorSystemElements
      ? savedSystemElementColor || stableColorForSystemElement(subsystem.key || subsystem.label)
      : null;
    subsystemBoxes.push(makePackedBoxNode({
      id: subsystemId,
      label: subsystem.label,
      groupKind: 'subsystem',
      groupKey: subsystem.key,
      description: subsystem.description || summarizeGroupDescription(subsystem.label, 'subsystem', subsystem.nodes),
      codeEvidence: {
        rowRefs: Array.from(new Set((subsystem.nodes || []).flatMap((node) => node?.data?.codeEvidence?.rowRefs || []))),
        files: Array.from(new Set((subsystem.nodes || []).flatMap((node) => node?.data?.codeEvidence?.files || []))),
      },
      position: { x: subsystem.x, y: subsystem.y },
      width: subsystem.width,
      height: subsystem.height,
      systemElementColor,
    }));

    for (const csci of subsystem.cscis) {
      const csciId = `box:csci:${csci.key}`;
      const csciPos = { x: dims.csciPad + csci.x, y: dims.csciTop + csci.y };
      csciBoxes.push(makePackedBoxNode({
        id: csciId,
        label: csci.label,
        groupKind: 'csci',
        groupKey: csci.key,
        parentGroupKey: subsystem.key,
        description: csci.description || summarizeGroupDescription(csci.label, 'csci', csci.nodes),
        codeEvidence: {
          rowRefs: Array.from(new Set((csci.nodes || []).flatMap((node) => node?.data?.codeEvidence?.rowRefs || []))),
          files: Array.from(new Set((csci.nodes || []).flatMap((node) => node?.data?.codeEvidence?.files || []))),
        },
        parentNode: subsystemId,
        position: csciPos,
        width: csci.width,
        height: csci.height,
      }));

      for (const csc of csci.cscs) {
        const cscId = `box:csc:${csc.key}`;
        const cscPos = { x: dims.csciPad + csc.x, y: dims.csciTop + csc.y };
        cscBoxes.push(makePackedBoxNode({
          id: cscId,
          label: csc.label,
          groupKind: 'csc',
          groupKey: csc.key,
          parentGroupKey: csci.key,
          description: csc.description || summarizeGroupDescription(csc.label, 'csc', csc.nodes),
          codeEvidence: {
            rowRefs: Array.from(new Set((csc.nodes || []).flatMap((node) => node?.data?.codeEvidence?.rowRefs || []))),
            files: Array.from(new Set((csc.nodes || []).flatMap((node) => node?.data?.codeEvidence?.files || []))),
          },
          parentNode: csciId,
          position: cscPos,
          width: csc.width,
          height: csc.height,
        }));

        for (const csu of csc.csus) {
          const csuId = `box:csu:${csu.key}`;
          const csuPos = { x: dims.cscPad + csu.x, y: dims.cscTop + csu.y };
          csuBoxes.push(makePackedBoxNode({
            id: csuId,
            label: csu.label,
            groupKind: 'csu',
            groupKey: csu.key,
            parentGroupKey: csc.key,
            description: csu.description || summarizeGroupDescription(csu.label, 'csu', csu.nodes),
            codeEvidence: {
              rowRefs: Array.from(new Set((csu.nodes || []).flatMap((node) => node?.data?.codeEvidence?.rowRefs || []))),
              files: Array.from(new Set((csu.nodes || []).flatMap((node) => node?.data?.codeEvidence?.files || []))),
              sourceFunctions: Array.from(
                new Map(
                  (csu.nodes || []).flatMap((node) => node?.data?.codeEvidence?.sourceFunctions || [])
                    .map((fn) => [`${fn.filePath || ''}:${fn.functionName || ''}:${fn.startLine || ''}`, fn])
                ).values()
              ).slice(0, 12),
            },
            parentNode: cscId,
            position: csuPos,
            width: csu.width,
            height: csu.height,
          }));

          csu.childNodes.forEach((node, idx) => {
            const col = idx % csu.cols;
            const row = Math.floor(idx / csu.cols);
            const relativePosition = {
              x: dims.csuPad + col * (THEME.node.w + dims.nodeGapX),
              y: dims.csuTop + row * (THEME.node.h + dims.nodeGapY),
            };
            const absolutePosition = {
              x: subsystem.x + csciPos.x + cscPos.x + csuPos.x + relativePosition.x,
              y: subsystem.y + csciPos.y + cscPos.y + csuPos.y + relativePosition.y,
            };
            childNodes.push({
              ...node,
              parentNode: csuId,
              extent: 'parent',
              position: relativePosition,
            });
            absoluteNodes.push({
              ...node,
              position: absolutePosition,
            });
          });
        }
      }
    }
  }

  return {
    groupedNodes: [...subsystemBoxes, ...csciBoxes, ...cscBoxes, ...csuBoxes, ...childNodes],
    absoluteNodes,
  };
}

function sourceFunctionKey(fn) {
  if (!fn) return '';
  return `${fn.filePath || ''}:${fn.functionName || ''}:${fn.startLine || ''}`;
}

function splitTraceCell(value) {
  return String(value || '')
    .split(/[,;|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function assuranceText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(assuranceText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value).trim();
}

function normalizeAssuranceText(value) {
  return assuranceText(value).toLowerCase().replace(/\s+/g, ' ');
}

function assuranceArtifactTitle(row = {}, fallback = 'Artifact') {
  return assuranceText(row.requirementText || row.designElementName || row.description || row.title || row.name || row.id || fallback);
}

function assuranceArchitectureLabel(ref = {}) {
  const trace = assuranceText(ref.traceId || ref.rowRef || (Number.isFinite(Number(ref.rowIndex)) ? Number(ref.rowIndex) + 1 : ''));
  const mode = ref.mode === 'edge' ? 'Interface' : ref.mode === 'to' ? 'Target' : 'Source';
  return trace ? `${mode} ${trace}` : mode;
}

function splitAssuranceList(value) {
  return assuranceText(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeAssuranceRefs(refs = []) {
  const seen = new Set();
  const out = [];
  refs.filter(Boolean).forEach((ref) => {
    const key = [
      ref.traceId,
      ref.rowRef,
      ref.rowIndex,
      ref.fromNodeId,
      ref.edgeId,
      ref.toNodeId,
      ref.mode,
    ].map(assuranceText).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  });
  return out;
}

function findArchitectureRowIndex(rows = [], sourceId = '') {
  const target = assuranceText(sourceId);
  if (!target) return -1;
  return rows.findIndex((row, index) =>
    assuranceText(row.traceId) === target ||
    assuranceText(row.rowRef) === target ||
    String(index + 1) === target
  );
}

function architectureRefFromDiagramRow(row = {}, rowIndex = 0, mode = 'edge') {
  return {
    rowIndex,
    rowRef: row.rowRef || rowIndex + 1,
    traceId: row.traceId || row.rowRef || String(rowIndex + 1),
    fromFunction: row.fromFunction || row.from || '',
    controlAction: row.controlAction || row.action || '',
    toFunction: row.toFunction || row.to || '',
    fromNodeId: row.fromNodeId || (row.fromFunction || row.from ? `n:${row.fromFunction || row.from}` : ''),
    edgeId: row.edgeId || '',
    toNodeId: row.toNodeId || (row.toFunction || row.to ? `n:${row.toFunction || row.to}` : ''),
    fromFile: row.fromFile || '',
    toFile: row.toFile || '',
    mode,
    subsystem: row.architecture?.subsystem || '',
    csci: row.architecture?.csci || '',
    csc: row.architecture?.csc || '',
    csu: row.architecture?.csu || '',
  };
}

function assuranceRefMatchesTarget(ref = {}, target = {}) {
  if (!ref || !target) return false;
  const targetRowRefs = new Set(
    [
      ...(target.codeEvidence?.rowRefs || []),
      ...(target.rowRefs || []),
      target.rowRef,
    ]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map((value) => String(value).trim())
  );
  const refRowRefs = [
    ref.rowRef,
    ref.traceId,
    Number.isFinite(Number(ref.rowIndex)) ? Number(ref.rowIndex) + 1 : '',
  ].filter((value) => value !== undefined && value !== null && value !== '').map((value) => String(value).trim());
  if (refRowRefs.some((value) => targetRowRefs.has(value))) return true;

  if (target.id && [ref.fromNodeId, ref.edgeId, ref.toNodeId].some((value) => String(value || '') === String(target.id))) return true;

  if (target.type === 'edge') {
    const edgeFrom = normalizeAssuranceText(target.fromFunction);
    const edgeAction = normalizeAssuranceText(target.controlAction || target.label);
    const edgeTo = normalizeAssuranceText(target.toFunction);
    return Boolean(
      edgeFrom &&
      edgeTo &&
      normalizeAssuranceText(ref.fromFunction) === edgeFrom &&
      normalizeAssuranceText(ref.toFunction) === edgeTo &&
      (!edgeAction || normalizeAssuranceText(ref.controlAction) === edgeAction)
    );
  }

  if (target.type === 'node') {
    const label = normalizeAssuranceText(target.label);
    return Boolean(label && [ref.fromFunction, ref.toFunction].some((value) => normalizeAssuranceText(value) === label));
  }

  if (target.type === 'architectureBox') {
    const arch = target.architecture || {};
    return [
      ['subsystem', arch.subsystem],
      ['csci', arch.csci],
      ['csc', arch.csc],
      ['csu', arch.csu],
    ].some(([key, value]) => normalizeAssuranceText(value) && normalizeAssuranceText(ref[key]) === normalizeAssuranceText(value));
  }

  return false;
}

function boxIdsForArchitectureData(data) {
  const ids = [];
  if (data?.subsystemKey) ids.push(`box:subsystem:${data.subsystemKey}`);
  if (data?.csciKey) ids.push(`box:csci:${data.csciKey}`);
  if (data?.cscKey) ids.push(`box:csc:${data.cscKey}`);
  if (data?.csuKey) ids.push(`box:csu:${data.csuKey}`);
  return ids;
}

function nodeMatchesSourceFunction(node, sourceFn) {
  const key = sourceFunctionKey(sourceFn);
  if (!key || isGroupBox(node)) return false;
  return (node?.data?.codeEvidence?.sourceFunctions || []).some((fn) => sourceFunctionKey(fn) === key);
}

function nodeMatchesArchitectureFocus(node, focus) {
  if (!focus) return true;
  if (focus.kind === 'subsystem') return node?.data?.subsystemKey === focus.key;
  if (focus.kind === 'csci') return node?.data?.csciKey === focus.key;
  if (focus.kind === 'csc') return node?.data?.cscKey === focus.key;
  return true;
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
      {(data.csu || data.file) && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 8,
            fontSize: 10,
            color: '#64748B',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={data.csu || data.file}
        >
          {data.csu || data.file}
        </div>
      )}
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

function edgeIdFromElement(element) {
  const edgeEl = element?.closest?.(".react-flow__edge");
  if (!edgeEl) return "";
  const testId = edgeEl.getAttribute("data-testid") || "";
  if (testId.startsWith("rf__edge-")) return testId.slice("rf__edge-".length);
  return edgeEl.id || "";
}

function edgeLabelTextFromElement(element) {
  const labelEl = element?.closest?.(".react-flow__edge-textwrapper");
  return labelEl ? String(labelEl.textContent || "").trim() : "";
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

function rowsToRawEdges(rows) {
  const raw = [];
  rows.forEach((row, idx) => {
    if (!row.toFunction) return;
    const fromId = row.fromNodeId || `n:${row.fromFunction}`;
    const toId = row.toNodeId || `n:${row.toFunction}`;
    raw.push({
      id: row.edgeId || `e:${fromId}->${toId}-${idx}`,
      source: fromId,
      target: toId,
      animated: false,
      type: 'smartBezier',
      style: { stroke: BRAND.dark },
      updatable: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
      label: row.controlAction,
      data: {
        offsetIndex: 0,
        description: row.controlDetails || '',
        rowRef: row.rowRef || idx + 1,
        rowRefs: [row.rowRef || idx + 1],
        traceId: row.traceId || '',
        codeEvidence: row.codeEvidence || {
          rowRefs: [row.rowRef || idx + 1],
          files: [row.fromFile, row.toFile].filter(Boolean),
        },
        fromNodeId: fromId,
        edgeId: row.edgeId || `e:${fromId}->${toId}-${idx}`,
        toNodeId: toId,
        fromFunction: row.fromFunction,
        controlAction: row.controlAction,
        toFunction: row.toFunction,
      },
    });
  });
  return raw;
}

function absoluteNodeFrame(node, nodesById, seen = new Set()) {
  if (!node) return null;
  if (seen.has(node.id)) return null;
  seen.add(node.id);

  const width = Number(node.style?.width) || THEME.node.w;
  const height = Number(node.style?.height) || THEME.node.h;
  const parentFrame = node.parentNode ? absoluteNodeFrame(nodesById.get(node.parentNode), nodesById, seen) : null;
  const x = (parentFrame?.x || 0) + (node.position?.x || 0);
  const y = (parentFrame?.y || 0) + (node.position?.y || 0);
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function aggregateHandlesFor(source, target, nodesById) {
  const sourceFrame = absoluteNodeFrame(nodesById.get(source), nodesById);
  const targetFrame = absoluteNodeFrame(nodesById.get(target), nodesById);
  if (!sourceFrame || !targetFrame) {
    return { sourceHandle: 'right-source-0', targetHandle: 'left-target-0' };
  }

  const dx = targetFrame.cx - sourceFrame.cx;
  const dy = targetFrame.cy - sourceFrame.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'right-source-0', targetHandle: 'left-target-0' }
      : { sourceHandle: 'left-source-0', targetHandle: 'right-target-0' };
  }
  return dy >= 0
    ? { sourceHandle: 'bottom-source-0', targetHandle: 'top-target-0' }
    : { sourceHandle: 'top-source-0', targetHandle: 'bottom-target-0' };
}

function buildArchitectureAggregateEdges({
  rows,
  nodes,
  nodeVisibility,
  visibleNodes,
  visibleIds,
  level,
  highlightedEdgeId,
}) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visibleNodesById = new Map((visibleNodes || []).map((node) => [node.id, node]));
  const edgeMap = new Map();

  (rows || []).forEach((row, rowIndex) => {
    const sourceNode = nodesById.get(row.fromNodeId || `n:${row.fromFunction}`);
    const targetNode = nodesById.get(row.toNodeId || `n:${row.toFunction}`);
    if (!sourceNode || !targetNode) return;
    if (!nodeVisibility.get(sourceNode.id) || !nodeVisibility.get(targetNode.id)) return;

    const keyForLevel = (node) => {
      if (level === "subsystem") return node?.data?.subsystemKey;
      if (level === "csci") return node?.data?.csciKey;
      if (level === "csu") return node?.data?.csuKey;
      return node?.data?.cscKey;
    };
    const sourceKey = keyForLevel(sourceNode);
    const targetKey = keyForLevel(targetNode);
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;

    const source = `box:${level}:${sourceKey}`;
    const target = `box:${level}:${targetKey}`;
    if (!visibleIds.has(source) || !visibleIds.has(target)) return;

    const pairId = `aggregate:${level}:${source}->${target}`;
    const previous = edgeMap.get(pairId);
    const count = (previous?.data?.count || 0) + 1;
    const labels = Array.from(
      new Set([...(previous?.data?.labels || []), row.controlAction].filter(Boolean))
    ).slice(0, 3);
    const isHighlighted = highlightedEdgeId === pairId;
    const handles = aggregateHandlesFor(source, target, visibleNodesById);

    edgeMap.set(pairId, {
      id: pairId,
      source,
      target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: "smartBezier",
      animated: isHighlighted,
      label: isHighlighted
        ? labels.length ? labels.join(", ") : count > 1 ? `${count} interfaces` : ''
        : count > 1 ? String(count) : '',
      data: {
        count,
        rowRefs: [...(previous?.data?.rowRefs || []), row.rowRef || `Row ${rowIndex + 1}`],
        labels,
      },
      style: {
        stroke: BRAND.blue,
        strokeWidth: isHighlighted ? 4.5 : 2.6,
        opacity: isHighlighted ? 1 : 0.58,
      },
      zIndex: 5,
      labelStyle: {
        fill: "#334155",
        fontSize: 11,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: "rgba(255,255,255,0.9)",
      },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: BRAND.blue,
        width: ARROW_SIZE,
        height: ARROW_SIZE,
      },
    });
  });

  return Array.from(edgeMap.values());
}

function compactArchBoxSize(label, kind) {
  const textWidth = String(label || '').length * 7.5 + 72;
  if (kind === 'subsystem') {
    return { width: Math.min(520, Math.max(320, textWidth)), height: 128 };
  }
  if (kind === 'csci') {
    return { width: Math.min(460, Math.max(280, textWidth)), height: 120 };
  }
  return { width: Math.min(360, Math.max(240, textWidth)), height: 104 };
}

function buildCompactArchitectureViewNodes({ nodes, nodeVisibility, level, positionOverrides }) {
  const overrideFor = (nodeId, fallback) => positionOverrides?.get(`${level}:${nodeId}`) || fallback;

  if (level === 'subsystem') {
    const items = nodes
      .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'subsystem')
      .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')))
      .map((node) => ({
        node,
        ...compactArchBoxSize(node.data?.label, 'subsystem'),
      }));

    return packRectsGrid(items, { gap: 96 }).map((item) => ({
      ...item.node,
      parentNode: undefined,
      extent: undefined,
      position: overrideFor(item.node.id, { x: item.x, y: item.y }),
      style: {
        ...(item.node.style || {}),
        width: item.width,
        height: item.height,
        zIndex: 2,
      },
    }));
  }

  if (level === 'csci') {
    const subsystemNodes = nodes
      .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'subsystem')
      .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')));
    const csciNodesByParent = new Map();
    nodes.forEach((node) => {
      if (!nodeVisibility.get(node.id) || node.type !== 'groupBox' || node.data?.groupKind !== 'csci') return;
      const list = csciNodesByParent.get(node.parentNode) || [];
      list.push(node);
      csciNodesByParent.set(node.parentNode, list);
    });

    const subsystemItems = subsystemNodes.map((subsystemNode) => {
      const childItems = (csciNodesByParent.get(subsystemNode.id) || [])
        .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')))
        .map((node) => ({
          node,
          ...compactArchBoxSize(node.data?.label, 'csci'),
        }));
      const packedChildren = packRectsGrid(childItems, { gap: 40 });
      const contentWidth = Math.max(...packedChildren.map((item) => item.x + item.width), 0);
      const contentHeight = Math.max(...packedChildren.map((item) => item.y + item.height), 0);
      return {
        node: subsystemNode,
        children: packedChildren,
        width: Math.max(380, contentWidth + 48),
        height: Math.max(200, contentHeight + 92),
      };
    });

    const packedSubsystems = packRectsGrid(subsystemItems, { gap: 96 });
    const compactNodes = [];
    packedSubsystems.forEach((subsystem) => {
      compactNodes.push({
        ...subsystem.node,
        parentNode: undefined,
        extent: undefined,
        position: overrideFor(subsystem.node.id, { x: subsystem.x, y: subsystem.y }),
        style: {
          ...(subsystem.node.style || {}),
          width: subsystem.width,
          height: subsystem.height,
          zIndex: 1,
        },
      });

      subsystem.children.forEach((child) => {
        compactNodes.push({
          ...child.node,
          parentNode: subsystem.node.id,
          extent: 'parent',
          position: overrideFor(child.node.id, { x: 24 + child.x, y: 60 + child.y }),
          style: {
            ...(child.node.style || {}),
            width: child.width,
            height: child.height,
            zIndex: 2,
          },
        });
      });
    });

    return compactNodes;
  }

  if (level === 'csu') {
    const subsystemNodes = nodes
      .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'subsystem')
      .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')));
    const csciNodes = nodes
      .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'csci')
      .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')));
    const cscNodes = nodes
      .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'csc')
      .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')));
    const csciNodesByParent = new Map();
    csciNodes.forEach((node) => {
      const list = csciNodesByParent.get(node.parentNode) || [];
      list.push(node);
      csciNodesByParent.set(node.parentNode, list);
    });
    const cscNodesByParent = new Map();
    cscNodes.forEach((node) => {
      const list = cscNodesByParent.get(node.parentNode) || [];
      list.push(node);
      cscNodesByParent.set(node.parentNode, list);
    });
    const csuNodesByParent = new Map();
    nodes.forEach((node) => {
      if (!nodeVisibility.get(node.id) || node.type !== 'groupBox' || node.data?.groupKind !== 'csu') return;
      const list = csuNodesByParent.get(node.parentNode) || [];
      list.push(node);
      csuNodesByParent.set(node.parentNode, list);
    });

    const cscItems = cscNodes.map((cscNode) => {
      const childItems = (csuNodesByParent.get(cscNode.id) || [])
        .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')))
        .map((node) => ({
          node,
          ...compactArchBoxSize(node.data?.label, 'csu'),
        }));
      const packedChildren = packRectsGrid(childItems, { gap: 36 });
      const contentWidth = Math.max(...packedChildren.map((item) => item.x + item.width), 0);
      const contentHeight = Math.max(...packedChildren.map((item) => item.y + item.height), 0);
      return {
        node: cscNode,
        children: packedChildren,
        width: Math.max(320, contentWidth + 48),
        height: Math.max(180, contentHeight + 84),
      };
    });

    const cscItemById = new Map(cscItems.map((item) => [item.node.id, item]));
    const csciItems = csciNodes.map((csciNode) => {
      const childItems = (cscNodesByParent.get(csciNode.id) || [])
        .map((node) => cscItemById.get(node.id))
        .filter(Boolean);
      const packedChildren = packRectsGrid(childItems, { gap: 44 });
      const contentWidth = Math.max(...packedChildren.map((item) => item.x + item.width), 0);
      const contentHeight = Math.max(...packedChildren.map((item) => item.y + item.height), 0);
      return {
        node: csciNode,
        children: packedChildren,
        width: Math.max(380, contentWidth + 52),
        height: Math.max(230, contentHeight + 96),
      };
    });

    const csciItemById = new Map(csciItems.map((item) => [item.node.id, item]));
    const subsystemItems = subsystemNodes.map((subsystemNode) => {
      const childItems = (csciNodesByParent.get(subsystemNode.id) || [])
        .map((node) => csciItemById.get(node.id))
        .filter(Boolean);
      const packedChildren = packRectsGrid(childItems, { gap: 52 });
      const contentWidth = Math.max(...packedChildren.map((item) => item.x + item.width), 0);
      const contentHeight = Math.max(...packedChildren.map((item) => item.y + item.height), 0);
      return {
        node: subsystemNode,
        children: packedChildren,
        width: Math.max(460, contentWidth + 60),
        height: Math.max(300, contentHeight + 110),
      };
    });

    const packedSubsystems = packRectsGrid(subsystemItems, { gap: 96 });
    const compactNodes = [];
    packedSubsystems.forEach((subsystem) => {
      compactNodes.push({
        ...subsystem.node,
        parentNode: undefined,
        extent: undefined,
        position: overrideFor(subsystem.node.id, { x: subsystem.x, y: subsystem.y }),
        style: {
          ...(subsystem.node.style || {}),
          width: subsystem.width,
          height: subsystem.height,
          zIndex: 1,
        },
      });

      subsystem.children.forEach((csci) => {
        compactNodes.push({
          ...csci.node,
          parentNode: subsystem.node.id,
          extent: 'parent',
          position: overrideFor(csci.node.id, { x: 30 + csci.x, y: 72 + csci.y }),
          style: {
            ...(csci.node.style || {}),
            width: csci.width,
            height: csci.height,
            zIndex: 2,
          },
        });

        csci.children.forEach((csc) => {
          compactNodes.push({
            ...csc.node,
            parentNode: csci.node.id,
            extent: 'parent',
            position: overrideFor(csc.node.id, { x: 26 + csc.x, y: 64 + csc.y }),
            style: {
              ...(csc.node.style || {}),
              width: csc.width,
              height: csc.height,
              zIndex: 3,
            },
          });

          csc.children.forEach((child) => {
            compactNodes.push({
              ...child.node,
              parentNode: csc.node.id,
              extent: 'parent',
              position: overrideFor(child.node.id, { x: 24 + child.x, y: 54 + child.y }),
              style: {
                ...(child.node.style || {}),
                width: child.width,
                height: child.height,
                zIndex: 4,
              },
            });
          });
        });
      });
    });

    return compactNodes;
  }

  if (level !== 'csc') return nodes.filter((node) => nodeVisibility.get(node.id));

  const subsystemNodes = nodes
    .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'subsystem')
    .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')));
  const csciNodes = nodes
    .filter((node) => nodeVisibility.get(node.id) && node.type === 'groupBox' && node.data?.groupKind === 'csci')
    .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')));
  const csciNodesByParent = new Map();
  csciNodes.forEach((node) => {
    const list = csciNodesByParent.get(node.parentNode) || [];
    list.push(node);
    csciNodesByParent.set(node.parentNode, list);
  });
  const cscNodesByParent = new Map();
  nodes.forEach((node) => {
    if (!nodeVisibility.get(node.id) || node.type !== 'groupBox' || node.data?.groupKind !== 'csc') return;
    const list = cscNodesByParent.get(node.parentNode) || [];
    list.push(node);
    cscNodesByParent.set(node.parentNode, list);
  });

  const csciItems = csciNodes.map((csciNode) => {
    const childItems = (cscNodesByParent.get(csciNode.id) || [])
      .sort((a, b) => String(a.data?.label || '').localeCompare(String(b.data?.label || '')))
      .map((node) => ({
        node,
        ...compactArchBoxSize(node.data?.label, 'csc'),
      }));
    const packedChildren = packRectsGrid(childItems, { gap: 40 });
    const contentWidth = Math.max(...packedChildren.map((item) => item.x + item.width), 0);
    const contentHeight = Math.max(...packedChildren.map((item) => item.y + item.height), 0);
    return {
      node: csciNode,
      children: packedChildren,
      width: Math.max(340, contentWidth + 48),
      height: Math.max(190, contentHeight + 92),
    };
  });

  const csciItemById = new Map(csciItems.map((item) => [item.node.id, item]));
  const subsystemItems = subsystemNodes.map((subsystemNode) => {
    const childItems = (csciNodesByParent.get(subsystemNode.id) || [])
      .map((node) => csciItemById.get(node.id))
      .filter(Boolean);
    const packedChildren = packRectsGrid(childItems, { gap: 48 });
    const contentWidth = Math.max(...packedChildren.map((item) => item.x + item.width), 0);
    const contentHeight = Math.max(...packedChildren.map((item) => item.y + item.height), 0);
    return {
      node: subsystemNode,
      children: packedChildren,
      width: Math.max(420, contentWidth + 56),
      height: Math.max(260, contentHeight + 104),
    };
  });

  const packedSubsystems = packRectsGrid(subsystemItems, { gap: 96 });
  const compactNodes = [];
  packedSubsystems.forEach((subsystem) => {
    compactNodes.push({
      ...subsystem.node,
      parentNode: undefined,
      extent: undefined,
      position: overrideFor(subsystem.node.id, { x: subsystem.x, y: subsystem.y }),
      style: {
        ...(subsystem.node.style || {}),
        width: subsystem.width,
        height: subsystem.height,
        zIndex: 1,
      },
    });

    subsystem.children.forEach((csci) => {
      compactNodes.push({
        ...csci.node,
        parentNode: subsystem.node.id,
        extent: 'parent',
        position: overrideFor(csci.node.id, { x: 28 + csci.x, y: 68 + csci.y }),
        style: {
          ...(csci.node.style || {}),
          width: csci.width,
          height: csci.height,
          zIndex: 2,
        },
      });

      csci.children.forEach((child) => {
        compactNodes.push({
          ...child.node,
          parentNode: csci.node.id,
          extent: 'parent',
          position: overrideFor(child.node.id, { x: 24 + child.x, y: 60 + child.y }),
          style: {
            ...(child.node.style || {}),
            width: child.width,
            height: child.height,
            zIndex: 3,
          },
        });
      });
    });
  });

  return compactNodes;
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
    architectureMode = false,
    architectureAbstraction = "detailed",
    colorSystemElements = false,
    height = 600,
    hazardSummary = null,
    assuranceArtifacts = null,
    onOpenHazardRow,
    onOpenFunctionalRow,
    onOpenAssuranceArtifactRow,
    reviewMode = false,
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
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [pendingArchitectureFocusTarget, setPendingArchitectureFocusTarget] = useState(null);
  const [architectureFocus, setArchitectureFocus] = useState(null);
  const [architectureNodePositions, setArchitectureNodePositions] = useState(() => new Map());
  const [systemElementColorOverrides, setSystemElementColorOverrides] = useState(() => new Map());

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
        vis.set(n.id, (showAll || includeSet.has(file)) && nodeMatchesArchitectureFocus(n, architectureFocus));
      }
    });

    // second pass: bubble to all parent boxes in the chain
    const byId = new Map(nodes.map((n) => [n.id, n]));
    nodes.forEach((n) => {
      if (!vis.get(n.id)) return;
      let parent = n.parentNode;
      while (parent) {
        vis.set(parent, true);
        parent = byId.get(parent)?.parentNode;
      }
    });

    return vis;
  }, [nodes, showAll, includeSet, architectureFocus]);

  // -------------------- Filtered views ----------------------
  const traceSets = useMemo(() => {
    const nodeIds = new Set(selectedTrace?.nodeIds || []);
    const boxIds = new Set(selectedTrace?.boxIds || []);
    return { nodeIds, boxIds };
  }, [selectedTrace]);

  const activeArchitectureAbstraction = architectureMode ? architectureAbstraction : "detailed";

  useEffect(() => {
    if (!architectureMode && architectureFocus) setArchitectureFocus(null);
  }, [architectureMode, architectureFocus]);

  const viewNodes = useMemo(() => {
    const active = edges.find((e) => e.id === highlightedEdgeId);
    const actSet = active ? new Set([active.source, active.target]) : null;
    const baseNodes = activeArchitectureAbstraction !== "detailed"
      ? buildCompactArchitectureViewNodes({
          nodes,
          nodeVisibility,
          level: activeArchitectureAbstraction,
          positionOverrides: architectureNodePositions,
        })
      : nodes.filter((n) => nodeVisibility.get(n.id));

    return baseNodes
      .map((n) => {
        const isTraceNode = traceSets.nodeIds.has(n.id);
        const isTraceBox = traceSets.boxIds.has(n.id);
        const isEdgeNode = actSet?.has(n.id);
        const traceStyle = isTraceNode
          ? {
              filter: "drop-shadow(0 0 16px rgba(20,184,166,0.85))",
              zIndex: 30,
            }
          : isTraceBox
            ? {
                filter: "drop-shadow(0 0 10px rgba(37,99,235,0.45))",
                zIndex: 20,
              }
            : {};
        return {
          ...n,
          className: [
            n.className,
            n.type === "groupBox" || String(n.id).startsWith("box:") ? "x-category-box-node" : "",
          ].filter(Boolean).join(" "),
          data: {
            ...(n.data || {}),
            traceActive: isTraceNode || isTraceBox,
            traceFocus: isTraceNode,
          },
          style:
            isEdgeNode || isTraceNode || isTraceBox
              ? {
                  ...(n.style || {}),
                  ...(isEdgeNode ? { filter: "drop-shadow(0 0 14px rgba(122,55,255,0.8))" } : {}),
                  ...traceStyle,
                }
              : n.style,
        };
      });
  }, [nodes, edges, highlightedEdgeId, nodeVisibility, traceSets, activeArchitectureAbstraction, architectureNodePositions]);

  const viewEdges = useMemo(() => {
    if (activeArchitectureAbstraction !== "detailed") {
      const visibleIds = new Set(viewNodes.map((node) => node.id));
      return buildArchitectureAggregateEdges({
        rows,
        nodes,
        nodeVisibility,
        visibleNodes: viewNodes,
        visibleIds,
        level: activeArchitectureAbstraction,
        highlightedEdgeId,
      });
    }

    // hide edges connected to hidden nodes
    const filtered = edges.filter(
      (e) => nodeVisibility.get(e.source) && nodeVisibility.get(e.target)
    );

    return filtered.map((e) => {
      const isOn =
        e.id === highlightedEdgeId ||
        (traceSets.nodeIds.has(e.source) && traceSets.nodeIds.has(e.target));
      return {
        ...e,
        animated: isOn,
        style: {
          ...(e.style || {}),
          stroke: isOn && e.id !== highlightedEdgeId ? '#14B8A6' : BRAND.blue,
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
  }, [edges, highlightedEdgeId, nodeVisibility, traceSets, activeArchitectureAbstraction, nodes, viewNodes, rows]);

  // -------------------- refs / misc you already had ---------
  const diagramHostRef = useRef(null);
  const nodeIdCounter = useRef(0);
  const [editModal, setEditModal] = useState(null);
  const [editModalExpanded, setEditModalExpanded] = useState(false);
  const hazardHeaders = useMemo(() => (
    Array.isArray(hazardSummary?.[0]) ? hazardSummary[0].map((header) => String(header || '')) : []
  ), [hazardSummary]);
  const hazardDataRows = useMemo(() => (
    Array.isArray(hazardSummary) ? hazardSummary.slice(1) : []
  ), [hazardSummary]);
  const hazardHeaderIndexByName = useMemo(() => {
    const map = new Map();
    hazardHeaders.forEach((header, index) => {
      const key = String(header || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, index);
    });
    return map;
  }, [hazardHeaders]);
  const hazardTitleIndex = useMemo(() => {
    const exactHazardIdx = hazardHeaders.findIndex((header) => /^hazards?$/i.test(header.trim()));
    if (exactHazardIdx >= 0) return exactHazardIdx;
    const preferredIdx = hazardHeaders.findIndex((header) =>
      /\bfailure mode\b|\brisk\b|\bscenario\b|\bevent\b/i.test(header)
    );
    return preferredIdx >= 0 ? preferredIdx : 0;
  }, [hazardHeaders]);
  const getHazardCell = useCallback((cells, headerName) => {
    const index = hazardHeaderIndexByName.get(String(headerName || '').trim().toLowerCase());
    return index >= 0 ? String(cells?.[index] ?? '').trim() : '';
  }, [hazardHeaderIndexByName]);
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
    const targetLabel = normalizeAssociationText(target.label);
    const targetRowRefs = new Set(
      [
        ...(target.codeEvidence?.rowRefs || []),
        ...(target.rowRefs || []),
        target.rowRef,
      ]
        .filter((ref) => ref !== undefined && ref !== null && ref !== '')
        .map((ref) => String(ref).trim())
    );
    const targetElementIds = new Set(Array.from(targetRowRefs).map((ref) => `cba-row-${ref}`));
    if (target.id) targetElementIds.add(String(target.id));

    const sourceSymbols = new Set(
      (target.codeEvidence?.sourceFunctions || [])
        .map((fn) => normalizeAssociationText(fn?.functionName))
        .filter(Boolean)
    );
    if (targetLabel) sourceSymbols.add(targetLabel);

    hazardDataRows.forEach((cells, idx) => {
      const architectureRowRef = getHazardCell(cells, 'Architecture Row Ref');
      const architectureElementId = getHazardCell(cells, 'Architecture Element ID');
      const functionFrom = normalizeAssociationText(getHazardCell(cells, 'Function (From)'));
      const controlAction = normalizeAssociationText(getHazardCell(cells, 'Control Action'));
      const functionTo = normalizeAssociationText(getHazardCell(cells, 'Function (To)'));
      const rowSymbols = splitTraceCell(getHazardCell(cells, 'Source Symbols')).map(normalizeAssociationText);

      const architectureRowRefs = splitTraceCell(architectureRowRef).map((ref) => String(ref || '').trim());
      if (architectureRowRefs.some((ref) => targetRowRefs.has(ref))) {
        matchedIndexes.add(idx);
        return;
      }
      const architectureElementIds = splitTraceCell(architectureElementId).map((ref) => String(ref || '').trim());
      if (architectureElementIds.some((ref) => targetElementIds.has(ref))) {
        matchedIndexes.add(idx);
        return;
      }

      if (target.type === 'edge') {
        const edgeFrom = normalizeAssociationText(target.fromFunction);
        const edgeAction = normalizeAssociationText(target.controlAction || target.label);
        const edgeTo = normalizeAssociationText(target.toFunction);
        if (edgeFrom && edgeTo && functionFrom === edgeFrom && functionTo === edgeTo && (!edgeAction || controlAction === edgeAction)) {
          matchedIndexes.add(idx);
          return;
        }
      }

      if (target.type === 'node' && targetLabel) {
        if (functionFrom === targetLabel || functionTo === targetLabel || rowSymbols.some((symbol) => sourceSymbols.has(symbol))) {
          matchedIndexes.add(idx);
          return;
        }
      }

      if (target.type === 'architectureBox') {
        const arch = target.architecture || {};
        const deepestArchPair = [
          ['CSU', arch.csu],
          ['CSC', arch.csc],
          ['CSCI', arch.csci],
          ['Subsystem', arch.subsystem],
        ].find(([, value]) => normalizeAssociationText(value));
        if (deepestArchPair && normalizeAssociationText(getHazardCell(cells, deepestArchPair[0])) === normalizeAssociationText(deepestArchPair[1])) {
          matchedIndexes.add(idx);
        }
      }
    });

    const associated = Array.from(matchedIndexes)
      .sort((a, b) => a - b)
      .map((idx) => ({ sourceIndex: idx, cells: hazardDataRows[idx] }))
      .filter((entry) => Array.isArray(entry.cells));

    return associated;
  }, [getHazardCell, hazardDataRows, normalizeAssociationText]);
  const editHazardRows = useMemo(
    () => getAssociatedHazardRows(editModal),
    [editModal, getAssociatedHazardRows]
  );
  const assuranceArtifactGroups = useMemo(() => ([
    {
      key: 'software-requirements',
      label: 'Software Requirements',
      rows: assuranceArtifacts?.softwareRequirements || [],
      fields: [
        ['Requirement Type', 'requirementType'],
        ['Priority', 'priority'],
        ['Source Functional Row', 'sourceTraceId'],
        ['Derived From Function', 'derivedFromFunction'],
        ['Derived From Interface', 'derivedFromInterface'],
      ],
    },
    {
      key: 'system-requirements',
      label: 'System Requirements',
      rows: assuranceArtifacts?.systemRequirements || [],
      fields: [
        ['Parent SW Requirement', 'parentSwRequirement'],
        ['Verification Method', 'verificationMethod'],
        ['Derived From', 'derivedFrom'],
      ],
    },
    {
      key: 'subsystem-requirements',
      label: 'Subsystem Requirements',
      rows: assuranceArtifacts?.subsystemRequirements || [],
      fields: [
        ['Subsystem', 'subsystem'],
        ['Parent System Requirement', 'parentSystemRequirement'],
        ['Allocated Function', 'allocatedFunction'],
        ['Allocated CSCI / CSC / CSU', 'allocatedArchitecture'],
        ['Verification Method', 'verificationMethod'],
      ],
    },
    {
      key: 'design-elements',
      label: 'System / Subsystem Design',
      rows: assuranceArtifacts?.designElements || [],
      fields: [
        ['Design Level', 'designLevel'],
        ['Parent Requirement', 'parentRequirement'],
        ['Allocated Function', 'allocatedFunction'],
        ['Allocated CSCI / CSC / CSU', 'allocatedArchitecture'],
        ['Linked Source Code', 'linkedSourceCode'],
      ],
    },
  ]), [assuranceArtifacts]);
  const resolveAssuranceRefs = useCallback((row = {}, groupKey = '', visiting = new Set()) => {
    const directRefs = Array.isArray(row.sourceArchitectureRefs) ? row.sourceArchitectureRefs.filter(Boolean) : [];
    if (directRefs.length) return dedupeAssuranceRefs(directRefs);

    if (groupKey === 'software-requirements') {
      const sourceIds = splitAssuranceList(row.sourceTraceId || row.sourceFunctionalRow || row.architectureRowRef);
      const refs = sourceIds.flatMap((sourceId) => {
        const rowIndex = findArchitectureRowIndex(rows, sourceId);
        return rowIndex >= 0 ? [architectureRefFromDiagramRow(rows[rowIndex], rowIndex, 'edge')] : [];
      });
      return dedupeAssuranceRefs(refs);
    }

    const parentConfig = {
      'system-requirements': {
        parentKey: 'parentSwRequirement',
        parentGroupKey: 'software-requirements',
        parentRows: assuranceArtifacts?.softwareRequirements || [],
      },
      'subsystem-requirements': {
        parentKey: 'parentSystemRequirement',
        parentGroupKey: 'system-requirements',
        parentRows: assuranceArtifacts?.systemRequirements || [],
      },
      'design-elements': {
        parentKey: 'parentRequirement',
        parentGroupKey: 'subsystem-requirements',
        parentRows: assuranceArtifacts?.subsystemRequirements || [],
      },
    }[groupKey];

    if (!parentConfig) return [];
    const rowKey = `${groupKey}:${row.id || row.internalId || ''}`;
    if (visiting.has(rowKey)) return [];
    const nextVisiting = new Set(visiting);
    nextVisiting.add(rowKey);

    const parentIds = splitAssuranceList(row[parentConfig.parentKey]);
    const refs = parentIds.flatMap((parentId) => {
      const parent = parentConfig.parentRows.find((candidate) => assuranceText(candidate.id) === parentId);
      return parent ? resolveAssuranceRefs(parent, parentConfig.parentGroupKey, nextVisiting) : [];
    });
    return dedupeAssuranceRefs(refs);
  }, [assuranceArtifacts, rows]);
  const editAssuranceArtifactGroups = useMemo(() => {
    if (!editModal) return [];
    return assuranceArtifactGroups.map((group) => ({
      ...group,
      rows: group.rows
        .map((row) => ({
          ...row,
          resolvedSourceArchitectureRefs: resolveAssuranceRefs(row, group.key),
        }))
        .filter((row) => row.resolvedSourceArchitectureRefs.some((ref) => assuranceRefMatchesTarget(ref, editModal))),
    }));
  }, [assuranceArtifactGroups, editModal, resolveAssuranceRefs]);
  const editFunctionalTraceRows = useMemo(() => {
    if (!editModal) return [];
    const refs = Array.from(new Set([
      ...(editModal.codeEvidence?.rowRefs || []),
      ...(editModal.rowRefs || []),
      editModal.rowRef,
    ].filter((ref) => ref !== undefined && ref !== null && ref !== '')));
    return refs
      .map((ref) => {
        const refText = String(ref).trim();
        const exactIndex = rows.findIndex((row) => String(row?.rowRef || '').trim() === refText);
        const numeric = Number(refText.replace(/^row\s*/i, ''));
        const fallbackIndex = Number.isFinite(numeric) ? numeric - 1 : -1;
        const rowIndex = exactIndex >= 0 ? exactIndex : fallbackIndex;
        const row = rowIndex >= 0 ? rows[rowIndex] : null;
        return { ref: refText, rowIndex, row };
      })
      .filter((entry) => entry.row || entry.ref);
  }, [editModal, rows]);
  const { fitView, project, getNodes, getEdges, getViewport, setViewport } = useReactFlow();
  const useWindowsReviewPinchZoom = reviewMode && isWindowsReviewRuntime();
  const handleReviewWheelCapture = useCallback((event) => {
    if (!useWindowsReviewPinchZoom || !event.ctrlKey) return;
    const current = getViewport();
    const rawDelta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    if (!Number.isFinite(rawDelta) || rawDelta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget?.getBoundingClientRect?.();
    const anchorX = bounds ? event.clientX - bounds.left : 0;
    const anchorY = bounds ? event.clientY - bounds.top : 0;
    const zoomFactor = Math.exp(-rawDelta * 0.001 * WINDOWS_REVIEW_PINCH_ZOOM_MULTIPLIER);
    const nextZoom = Math.max(THEME.canvas.minZoom, Math.min(THEME.canvas.maxZoom, current.zoom * zoomFactor));
    const ratio = nextZoom / current.zoom;
    setViewport({
      x: anchorX - (anchorX - current.x) * ratio,
      y: anchorY - (anchorY - current.y) * ratio,
      zoom: nextZoom,
    });
  }, [getViewport, setViewport, useWindowsReviewPinchZoom]);
  const edgeForDoubleClickTarget = useCallback((event) => {
    const allEdges = getEdges();
    const byId = new Map(allEdges.map((edge) => [edge.id, edge]));
    const elements = [
      event.target,
      ...(typeof document !== "undefined" && document.elementsFromPoint
        ? document.elementsFromPoint(event.clientX, event.clientY)
        : []),
    ].filter(Boolean);

    for (const element of elements) {
      const edgeId = edgeIdFromElement(element);
      if (edgeId && byId.has(edgeId)) return byId.get(edgeId);
    }

    const targetLabel = elements.map(edgeLabelTextFromElement).find(Boolean);
    const labelCandidates = targetLabel
      ? allEdges.filter((edge) => String(edge.label || edge.data?.controlAction || "").trim() === targetLabel)
      : [];
    if (labelCandidates.length === 1) return labelCandidates[0];

    const labelWrappers = Array.from(
      diagramHostRef.current?.querySelectorAll?.(".react-flow__edge-textwrapper") || []
    );
    let nearest = null;
    labelWrappers.forEach((labelEl) => {
      const text = String(labelEl.textContent || "").trim();
      if (!text) return;
      const rect = labelEl.getBoundingClientRect();
      const expanded = 12;
      const inside =
        event.clientX >= rect.left - expanded &&
        event.clientX <= rect.right + expanded &&
        event.clientY >= rect.top - expanded &&
        event.clientY <= rect.bottom + expanded;
      if (!inside) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(event.clientX - cx, event.clientY - cy);
      const matches = allEdges.filter((edge) => String(edge.label || edge.data?.controlAction || "").trim() === text);
      if (!matches.length) return;
      if (!nearest || distance < nearest.distance) {
        nearest = { distance, edge: matches[0] };
      }
    });
    return nearest?.edge || null;
  }, [getEdges]);
  const architectureBoxForDoubleClickTarget = useCallback((event) => {
    if (!architectureMode) return null;
    const bounds = diagramHostRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const point = project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    const byId = new Map(viewNodes.map((node) => [node.id, node]));
    const absolutePositionFor = (node) => {
      if (node?.positionAbsolute) return node.positionAbsolute;
      let x = Number(node?.position?.x || 0);
      let y = Number(node?.position?.y || 0);
      let parentId = node?.parentNode;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        x += Number(parent.positionAbsolute?.x ?? parent.position?.x ?? 0);
        y += Number(parent.positionAbsolute?.y ?? parent.position?.y ?? 0);
        parentId = parent.parentNode;
      }
      return { x, y };
    };
    const boxes = viewNodes
      .filter((node) => node?.type === 'groupBox' || node?.data?.groupKind)
      .map((node) => {
        const pos = absolutePositionFor(node);
        const width = Number(node.style?.width || node.width || 0);
        const height = Number(node.style?.height || node.height || 0);
        return { node, pos, width, height };
      })
      .filter(({ pos, width, height }) =>
        width > 0 &&
        height > 0 &&
        point.x >= pos.x &&
        point.x <= pos.x + width &&
        point.y >= pos.y &&
        point.y <= pos.y + height
      )
      .sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return boxes[0]?.node || null;
  }, [architectureMode, project, viewNodes]);
  const openArchitectureBoxEditModal = useCallback((node) => {
    const groupKind = node?.data?.groupKind;
    const label = String(node?.data?.label || groupKind || 'Architecture box');
    setEditModal({
      type: 'architectureBox',
      id: node.id,
      label,
      description: node?.data?.description || summarizeGroupDescription(label, groupKind || 'group', []),
      groupKind,
      groupKey: node?.data?.groupKey || '',
      systemElementColor: node?.data?.systemElementColor || '',
      canEditSystemElementColor: Boolean(colorSystemElements && groupKind === 'subsystem'),
      architecture: {
        subsystem: groupKind === 'subsystem' ? label : '',
        csci: groupKind === 'csci' ? label : '',
        csc: groupKind === 'csc' ? label : '',
        csu: groupKind === 'csu' ? label : '',
      },
      codeEvidence: node?.data?.codeEvidence || null,
    });
  }, [colorSystemElements]);
  const systemElementBoxForDoubleClickTarget = useCallback((event) => {
    if (!colorSystemElements || !architectureMode) return null;
    const bounds = diagramHostRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const point = project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    const boxes = viewNodes
      .filter((node) => node?.type === 'groupBox' && node?.data?.groupKind === 'subsystem')
      .map((node) => {
        const pos = node.positionAbsolute || node.position || { x: 0, y: 0 };
        const width = Number(node.style?.width || node.width || 0);
        const height = Number(node.style?.height || node.height || 0);
        return { node, pos, width, height };
      })
      .filter(({ pos, width, height }) =>
        width > 0 &&
        height > 0 &&
        point.x >= pos.x &&
        point.x <= pos.x + width &&
        point.y >= pos.y &&
        point.y <= pos.y + height
      )
      .sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return boxes[0]?.node || null;
  }, [architectureMode, colorSystemElements, project, viewNodes]);
  const visibleNodeIdsKey = useMemo(
    () => viewNodes.map((node) => node?.id).filter(Boolean).join('\n'),
    [viewNodes]
  );
  const fitCurrentView = useCallback((options = {}) => {
    const visibleNodeIds = visibleNodeIdsKey ? visibleNodeIdsKey.split('\n').filter(Boolean) : [];
    const request = {
      padding: 0.08,
      duration: 350,
      includeHiddenNodes: false,
      minZoom: THEME.canvas.minZoom,
      ...options,
    };
    try {
      if (visibleNodeIds.length) {
        fitView({ ...request, nodes: visibleNodeIds.map((id) => ({ id })) });
      } else {
      fitView({ ...request, includeHiddenNodes: true });
    }
  } catch {}
  }, [fitView, visibleNodeIdsKey]);

  const isolateArchitectureBox = useCallback(
    (node) => {
      const kind = node?.data?.groupKind;
      if (!architectureMode || !['subsystem', 'csci', 'csc'].includes(kind)) return false;
      const key = node?.data?.groupKey;
      if (!key) return false;
      setArchitectureFocus({
        kind,
        key,
        label: node?.data?.label || (kind === 'subsystem' ? 'Subsystem' : kind === 'csci' ? 'CSCI' : 'CSC'),
      });
      setHighlightedEdgeId(null);
      setSelectedTrace(null);
      setTimeout(() => {
        try {
          fitView({ padding: 0.25, duration: 350, includeHiddenNodes: false });
        } catch {}
      }, 0);
      return true;
    },
    [architectureMode, fitView]
  );

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

  const selectSourceTrace = useCallback(
    (sourceFn, originNodeId) => {
      const rfNodes = getNodes();
      const matchingNodes = rfNodes.filter((node) => nodeMatchesSourceFunction(node, sourceFn));
      const originNode = originNodeId ? rfNodes.find((node) => node.id === originNodeId) : null;
      const targetNodes = matchingNodes.length ? matchingNodes : originNode ? [originNode] : [];
      const nodeIds = Array.from(new Set(targetNodes.map((node) => node.id)));
      const boxIds = Array.from(
        new Set(targetNodes.flatMap((node) => boxIdsForArchitectureData(node.data || {})))
      );
      const primary = targetNodes[0] || originNode;
      setSelectedTrace({
        sourceFn,
        nodeIds,
        boxIds,
        architecture: primary?.data
          ? {
              subsystem: primary.data.subsystem,
              csci: primary.data.csci,
              csc: primary.data.csc,
              csu: primary.data.csu,
            }
          : null,
        label: primary?.data?.label || sourceFn?.functionName || '',
      });
      if (nodeIds.length) {
        setNodes((nds) =>
          nds.map((node) => ({
            ...node,
            selected: nodeIds.includes(node.id),
          }))
        );
        setTimeout(() => {
          try {
            fitView({ nodes: nodeIds.map((id) => ({ id })), padding: 0.35, duration: 500 });
          } catch {}
        }, 0);
      }
    },
    [fitView, getNodes, setNodes]
  );

  const performArchitectureTargetFocus = useCallback((target = {}) => {
    suppressAutoFitUntilRef.current = Date.now() + 1800;
    const type = target.type || 'node';
    const rowIndex = Number(target.rowIndex);
    const functionName = String(target.functionName || '').trim();
    const rfNodes = getNodes();

    if (type === 'edge') {
      const edgeId = target.edgeId || (Number.isFinite(rowIndex)
        ? `e:n:${target.fromFunction}->n:${target.toFunction}-${rowIndex}`
        : '');
      const edge = getEdges().find((candidate) => candidate.id === edgeId) ||
        getEdges().find((candidate) => {
          const data = candidate?.data || {};
          return (
            (target.rowRef && String(data.rowRef || "") === String(target.rowRef)) ||
            (String(data.fromFunction || "") === String(target.fromFunction || "") &&
              String(data.controlAction || "") === String(target.controlAction || "") &&
              String(data.toFunction || "") === String(target.toFunction || ""))
          );
        });
      if (!edge?.id) return false;
      setHighlightedEdgeId(edge.id);
      const nodeIds = [edge.source, edge.target].filter((id) => rfNodes.some((node) => node.id === id));
      setNodes((nds) => nds.map((node) => ({ ...node, selected: nodeIds.includes(node.id) })));
      if (nodeIds.length) {
        setTimeout(() => {
          try {
            fitView({ nodes: nodeIds.map((id) => ({ id })), padding: 0.12, duration: 600, maxZoom: 1.65 });
          } catch {}
        }, 0);
      }
      return true;
    }

    const nodeId = target.nodeId || (functionName ? `n:${functionName}` : "");
    if (!nodeId) return false;
    const targetNode = rfNodes.find((node) => node.id === nodeId);
    if (!targetNode) return false;
    setHighlightedEdgeId(null);
    setSelectedTrace({
      sourceFn: null,
      nodeIds: [nodeId],
      boxIds: boxIdsForArchitectureData(targetNode.data || {}),
      architecture: targetNode.data
        ? {
            subsystem: targetNode.data.subsystem,
            csci: targetNode.data.csci,
            csc: targetNode.data.csc,
            csu: targetNode.data.csu,
          }
        : null,
      label: targetNode.data?.label || functionName,
    });
    setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === nodeId })));
    setTimeout(() => {
      try {
        fitView({ nodes: [{ id: nodeId }], padding: 0.18, duration: 600, maxZoom: 1.9 });
      } catch {}
    }, 0);
    return true;
  }, [fitView, getEdges, getNodes, setNodes]);

  const focusArchitectureTarget = useCallback((target = {}) => {
    const focused = performArchitectureTargetFocus(target);
    if (!focused) {
      suppressAutoFitUntilRef.current = Date.now() + 2200;
      setPendingArchitectureFocusTarget({
        ...target,
        __focusAttempt: Number(target.__focusAttempt || 0),
      });
    } else {
      setPendingArchitectureFocusTarget(null);
    }
    return focused;
  }, [performArchitectureTargetFocus]);
  

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
      if (reviewMode) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        idbPositionsSave(storageKey, posRef.current).catch(() => {});
      }, 120);
    }, [storageKey, reviewMode]);

  useEffect(() => {
    if (!colorSystemElements) {
      setSystemElementColorOverrides(new Map());
      return;
    }
    setSystemElementColorOverrides(loadSystemElementColorOverrides(storageKey));
  }, [colorSystemElements, storageKey]);

  useEffect(() => {
    if (!colorSystemElements) return;
    setNodes((nds) =>
      nds.map((node) => {
        if (node?.type !== 'groupBox' || node?.data?.groupKind !== 'subsystem') return node;
        const key = node?.data?.groupKey || node?.data?.label || node.id;
        const override = systemElementColorOverrides.get(key) || systemElementColorOverrides.get(node?.data?.label);
        const color = override || stableColorForSystemElement(key || node?.data?.label);
        return node?.data?.systemElementColor === color
          ? node
          : { ...node, data: { ...node.data, systemElementColor: color } };
      })
    );
  }, [colorSystemElements, setNodes, systemElementColorOverrides]);
    

  const builtCountRef = useRef(0);
  const builtOnceRef = useRef(false);
  const structureRef = useRef("");
  const cleanedKeysRef = useRef(new Set());
  const connectStartRef = useRef(null);
  const suppressAutoFitUntilRef = useRef(0);
  const [initialLayoutPending, setInitialLayoutPending] = useState(() => !!cleanOnceKey);
  const shouldSuppressAutoFit = useCallback(() => Date.now() < suppressAutoFitUntilRef.current, []);

  useEffect(() => {
    if (!pendingArchitectureFocusTarget) return;
    if (initialLayoutPending || activeArchitectureAbstraction !== 'detailed') return;
    const attempt = Number(pendingArchitectureFocusTarget.__focusAttempt || 0);
    if (attempt > 18) {
      setPendingArchitectureFocusTarget(null);
      return;
    }
    const timer = setTimeout(() => {
      const focused = performArchitectureTargetFocus(pendingArchitectureFocusTarget);
      if (focused) {
        setPendingArchitectureFocusTarget(null);
      } else {
        suppressAutoFitUntilRef.current = Date.now() + 2200;
        setPendingArchitectureFocusTarget({
          ...pendingArchitectureFocusTarget,
          __focusAttempt: attempt + 1,
        });
      }
    }, attempt < 4 ? 120 : 260);
    return () => clearTimeout(timer);
  }, [
    activeArchitectureAbstraction,
    edges.length,
    initialLayoutPending,
    nodes.length,
    pendingArchitectureFocusTarget,
    performArchitectureTargetFocus,
    viewEdges.length,
    viewNodes.length,
  ]);

  useEffect(() => {
    if (!architectureMode || initialLayoutPending || !viewNodes.length || shouldSuppressAutoFit()) return;
    const timer = setTimeout(() => {
      if (shouldSuppressAutoFit()) return;
      fitCurrentView();
    }, 0);
    return () => clearTimeout(timer);
  }, [architectureMode, activeArchitectureAbstraction, fitCurrentView, initialLayoutPending, shouldSuppressAutoFit, viewNodes.length]);

  const runCleanAndSpread = useCallback(async () => {
    // 1) Layout only real nodes (ignore boxes)
    const realNodes = nodes.filter((n) => !isGroupBox(n));
    const elkNodes = await runElkLayoutOnce({
      nodes: realNodes,
      edges,
      groupByFile: true,
    });

    let groupedNodes;
    let positionedNodes = elkNodes;
    if (architectureMode) {
      const architectureLayout = buildArchitectureLayout(elkNodes, { colorSystemElements, systemElementColorOverrides });
      groupedNodes = architectureLayout.groupedNodes;
      positionedNodes = architectureLayout.absoluteNodes;
    } else {
      // 2) Build nested boxes: generalized function groups contain file boxes
      const fileGroups = computeGroupBounds(elkNodes, (n) => n?.data?.file || 'Unfiled');
      const fileBoxNodes = buildGroupBoxNodes(fileGroups, {
        kind: 'file',
        keyToParentKey: (file) => {
          const match = elkNodes.find((n) => (n?.data?.file || 'Unfiled') === file);
          return match?.data?.functionGroup || 'General';
        },
      });
      const functionGroups = computeBoxGroupBounds(
        fileBoxNodes,
        (box) => box?.data?.parentGroupKey || box?.data?.groupKey || 'General'
      );
      const functionBoxNodes = buildGroupBoxNodes(functionGroups, { kind: 'function' });

      // 3) Attach nodes to the ABSOLUTE file boxes first, then nest file boxes under function boxes.
      const childNodes = attachNodesToBoxes(elkNodes, fileBoxNodes, (n) => n?.data?.file || 'Unfiled');
      const childFileBoxes = attachBoxesToBoxes(
        fileBoxNodes,
        functionBoxNodes,
        (box) => box?.data?.parentGroupKey || 'General'
      );
      groupedNodes = [...functionBoxNodes, ...childFileBoxes, ...childNodes];
    }

    // 4) Render outer boxes first, then inner boxes, then nodes
    setNodes(groupedNodes);

    // 5) Persist absolute positions
    positionedNodes.forEach((n) => posRef.current.set(n.id, { ...n.position }));
    persistSoon();

    // 6) Rebuild edges from absolute positions
    const raw = rowsToRawEdges(rows);
    const absPos = new Map(positionedNodes.map((n) => [n.id, { ...n.position }]));
    setEdges(buildEdgesFromRaw(raw, absPos));

    // 7) Optional fit
    if (fitAfterClean) {
      setTimeout(() => {
        if (shouldSuppressAutoFit()) return;
        fitCurrentView({ duration: 600 });
      }, 0);
    }
  }, [nodes, edges, rows, fitAfterClean, fitCurrentView, persistSoon, architectureMode, colorSystemElements, systemElementColorOverrides, shouldSuppressAutoFit]);
  
  // Auto-fit when graph is (re)built or changes noticeably
useEffect(() => {
  if (!builtOnceRef.current) return; // wait until first build
  const t = setTimeout(() => {
    if (shouldSuppressAutoFit()) return;
    fitCurrentView({ duration: 0 });
  }, 0);
  return () => clearTimeout(t);
}, [nodes.length, edges.length, fitCurrentView, shouldSuppressAutoFit]);

// Auto-fit when the host container size changes
useEffect(() => {
  if (!diagramHostRef.current) return;
  const ro = new ResizeObserver(() => {
    setTimeout(() => {
      if (shouldSuppressAutoFit()) return;
      fitCurrentView({ duration: 0 });
    }, 0);
  });
  ro.observe(diagramHostRef.current);
  return () => ro.disconnect();
}, [fitCurrentView, shouldSuppressAutoFit]);

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
    if (reviewMode) return;
    connectStartRef.current = params || null;
  }, [reviewMode]);

  const onConnectEndLoose = useCallback(
    (evt) => {
      if (reviewMode) return;
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

      const edgeId = cryptoId('cba-edge');
      const newEdge = {
        id: edgeId,
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

      const fromFunction = srcNode?.data?.label || fromId.replace(/^n:/, '');
      const toFunction = tgtNode?.data?.label || toId.replace(/^n:/, '');
      onUpdateRows?.([
        ...rows,
        {
          traceId: cryptoId('cba-trace'),
          fromNodeId: fromId,
          edgeId,
          toNodeId: toId,
          fromFunction,
          fromDetails: '',
          controlAction: '',
          controlDetails: '',
          toFunction,
          toDetails: '',
        },
      ]);
    },
    [nodes, edges, rows, onUpdateRows, persistSoon, reviewMode]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (!reviewMode) {
        try { idbPositionsSave(storageKey, posRef.current); } catch {}
      }
    };
  }, [storageKey, reviewMode]);
  

  // Extra fit when parent flips cleanOnceKey (used after prompt finishes)
useEffect(() => {
  if (!cleanOnceKey) return;
  const t = setTimeout(() => {
    if (shouldSuppressAutoFit()) return;
    fitCurrentView({ duration: 0 });
  }, 120); // small defer lets RF settle labels/edges
  return () => clearTimeout(t);
}, [cleanOnceKey, fitCurrentView, shouldSuppressAutoFit]);

  useEffect(() => {
    if (!cleanOnceKey || nodes.length > 0) return;
    if ((rows || []).length > 0 || !posLoaded) return;
    setInitialLayoutPending(false);
  }, [cleanOnceKey, nodes.length, posLoaded, rows]);

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
          if (shouldSuppressAutoFit()) return;
		      fitCurrentView({ duration: 400 });
		    },
      focusArchitectureTarget,
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
      if (reviewMode) {
        reactflowOnNodesChange(changes.filter((change) => change.type !== 'remove'));
        return;
      }
      if (architectureMode && activeArchitectureAbstraction !== 'detailed') {
        const positionChanges = changes.filter((c) => c.type === 'position' && c.id);
        if (positionChanges.length) {
          setArchitectureNodePositions((prev) => {
            const next = new Map(prev);
            positionChanges.forEach((c) => {
              const p = c.position;
              if (p) next.set(`${activeArchitectureAbstraction}:${c.id}`, { x: p.x, y: p.y });
            });
            return next;
          });
        }

        const nonPositionChanges = changes.filter((c) => c.type !== 'position');
        if (!nonPositionChanges.length) return;
        reactflowOnNodesChange(nonPositionChanges);
        return;
      }

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
          (r) => !deletedIds.has(r.fromNodeId || `n:${r.fromFunction}`) && !deletedIds.has(r.toNodeId || `n:${r.toFunction}`)
        );
        onUpdateRows?.(updatedRows);
      }
  
      reactflowOnNodesChange(changes);
    },
    [rows, reactflowOnNodesChange, onUpdateRows, persistSoon, getNodes, architectureMode, activeArchitectureAbstraction, reviewMode]
  );
  

  const onEdgesChange = useCallback(
    (changes) => {
      if (reviewMode) {
        reactflowOnEdgesChange(changes.filter((change) => change.type !== 'remove'));
        return;
      }
      const removals = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removals.length) {
        const removalSet = new Set(removals);
        const updatedRows = rows.filter((r, i) => !removalSet.has(r.edgeId || `e:${r.fromNodeId || `n:${r.fromFunction}`}->${r.toNodeId || `n:${r.toFunction}`}-${i}`));
        onUpdateRows?.(updatedRows);
      }
      reactflowOnEdgesChange(changes);
    },
    [rows, reactflowOnEdgesChange, onUpdateRows, reviewMode]
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

	  const sig = `${architectureMode ? 'architecture' : 'functional'}:${structureSignature(rows)}:${(rows || [])
	    .map((row) => [
        row.architecture?.subsystem,
        row.architecture?.csci,
        row.architecture?.csc,
        row.architecture?.csu,
        row.fromArchitecture?.subsystem,
        row.fromArchitecture?.csci,
        row.fromArchitecture?.csc,
        row.fromArchitecture?.csu,
        row.toArchitecture?.subsystem,
        row.toArchitecture?.csci,
        row.toArchitecture?.csc,
        row.toArchitecture?.csu,
      ].filter(Boolean).join('/'))
	    .join('|')}`;
  const structureUnchanged = builtOnceRef.current && sig === structureRef.current;
  const preferredFileByFunction = computePreferredFileByFunction(rows);
  const architectureByFunction = computeArchitectureByFunction(rows);
  if (structureUnchanged) return;

  const wantedNodeIds = new Set();
  const rowByNodeId = new Map();
  rows.forEach((row) => {
    const fromId = row.fromNodeId || `n:${row.fromFunction}`;
    const toId = row.toNodeId || `n:${row.toFunction}`;
    wantedNodeIds.add(fromId);
    rowByNodeId.set(fromId, { row, side: 'from' });
    if (row.toFunction) {
      wantedNodeIds.add(toId);
      rowByNodeId.set(toId, { row, side: 'to' });
    }
  });

  const nextNodes = Array.from(wantedNodeIds).map((id) => {
    const pos = posRef.current.get(id) ?? seedPosition(builtCountRef.current++);
    if (!posRef.current.has(id)) {
      posRef.current.set(id, pos);
      persistSoon(); // <-- now persists to IndexedDB
    }
    const existing = nodes.find((n) => n.id === id);
    const nodeRow = rowByNodeId.get(id);
    const name = nodeRow?.side === 'to'
      ? nodeRow.row.toFunction
      : nodeRow?.row?.fromFunction || id.replace(/^n:/, '');
    const fileForFn = preferredFileByFunction.get(name) || 'Unfiled';
	    const functionGroup = inferFunctionGroupForFile(fileForFn, rows);
	    const endpointArch = nodeRow?.side === 'to'
	      ? nodeRow?.row?.toArchitecture
	      : nodeRow?.row?.fromArchitecture;
	    const arch = endpointArch || architectureByFunction.get(name) || {
	      subsystem: 'Application Subsystem',
	      csci: 'Application Software',
	      csc: 'Core Components',
      csu: functionGroup || 'Functional Unit',
      evidence: { rowRefs: [], files: fileForFn ? [fileForFn] : [] },
    };
    const subsystemKey = arch.subsystem || 'Application Subsystem';
    const csciKey = `${subsystemKey}${ARCH_KEY_SEP}${arch.csci}`;
    const cscKey = `${subsystemKey}${ARCH_KEY_SEP}${arch.csci}${ARCH_KEY_SEP}${arch.csc}`;
    const csuKey = `${subsystemKey}${ARCH_KEY_SEP}${arch.csci}${ARCH_KEY_SEP}${arch.csc}${ARCH_KEY_SEP}${arch.csu}`;
    if (existing) {
      return {
        ...existing,
        position: pos,
        data: {
          ...(existing.data || {}),
          file: fileForFn,
          functionGroup,
          subsystem: arch.subsystem,
          csci: arch.csci,
          csc: arch.csc,
          csu: arch.csu,
          subsystemKey,
          csciKey,
          cscKey,
          csuKey,
          architectureDescriptions: arch.descriptions || {},
          codeEvidence: arch.evidence,
        },
      };
    }

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
        functionGroup,
        subsystem: arch.subsystem,
        csci: arch.csci,
        csc: arch.csc,
        csu: arch.csu,
        subsystemKey,
        csciKey,
        cscKey,
        csuKey,
        architectureDescriptions: arch.descriptions || {},
        codeEvidence: arch.evidence,
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
  }
  return () => { cancelled = true; };
}, [rows, posLoaded, persistSoon, nodes, setNodes, setEdges, architectureMode]);


  // Sync labels/details without moving nodes
  useEffect(() => {
    if (!builtOnceRef.current) return;

    const nodeDetails = new Map();
    const edgeDetails = new Map();

    rows.forEach((r, idx) => {
      const fromNodeId = r.fromNodeId || `n:${r.fromFunction}`;
      const toNodeId = r.toNodeId || `n:${r.toFunction}`;
      nodeDetails.set(fromNodeId, { label: r.fromFunction, description: r.fromDetails || '' });
      if (r.toFunction) {
        nodeDetails.set(toNodeId, { label: r.toFunction, description: r.toDetails || '' });
        const edgeId = r.edgeId || `e:${fromNodeId}->${toNodeId}-${idx}`;
        edgeDetails.set(edgeId, {
          label: r.controlAction || '',
          description: r.controlDetails || '',
          rowRef: r.rowRef || idx + 1,
          rowRefs: [r.rowRef || idx + 1],
          traceId: r.traceId || '',
          codeEvidence: r.codeEvidence || {
            rowRefs: [r.rowRef || idx + 1],
            files: [r.fromFile, r.toFile].filter(Boolean),
          },
          fromNodeId,
          edgeId,
          toNodeId,
        });
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
          ? { ...e, label: edgeDetails.get(e.id).label, data: { ...e.data, ...edgeDetails.get(e.id) } }
          : e
      );
    });
  }, [rows, setNodes, setEdges]);

  /* One-time clean+spread trigger */
  useEffect(() => {
    if (!cleanOnceKey) return;
    if (cleanedKeysRef.current.has(cleanOnceKey)) return;
    if (!nodes.length) {
      if ((rows || []).length === 0 && posLoaded) {
        setInitialLayoutPending(false);
      } else {
        setInitialLayoutPending(true);
      }
      return;
    }

    let cancelled = false;
    setInitialLayoutPending(true);
    (async () => {
      try {
        await runCleanAndSpread();
        if (cancelled) return;
        cleanedKeysRef.current.add(cleanOnceKey);
        setInitialLayoutPending(false);
        // tell parent we consumed the key so it won't fire on remount
        try { onCleanApplied?.(cleanOnceKey); } catch {}
      } catch {
        if (!cancelled) setInitialLayoutPending(false);
      }
    })();

    return () => { cancelled = true; };
  }, [cleanOnceKey, nodes, runCleanAndSpread, onCleanApplied, posLoaded, rows]);

  /* Connect / Update */
  const onConnect = useCallback(
    (connection) => {
      if (reviewMode) return;
      setEdges((eds) => {
        const count = eds.filter(
          (e) =>
            (e.source === connection.source && e.target === connection.target) ||
            (e.source === connection.target && e.target === connection.source)
        ).length;

        const edgeId = cryptoId('cba-edge');
        const newEdge = {
          ...connection,
          id: edgeId,
          animated: false,
          type: 'smartBezier',
          style: { strokeWidth: 3 },
          markerEnd: { type: MarkerType.ArrowClosed, width: ARROW_SIZE, height: ARROW_SIZE, color: BRAND.blue },
        };

        const srcNode = getNodes().find((n) => n.id === connection.source);
        const tgtNode = getNodes().find((n) => n.id === connection.target);
        const fromFunction = srcNode?.data?.label || (connection.source || '').replace(/^n:/, '');
        const toFunction = tgtNode?.data?.label || (connection.target || '').replace(/^n:/, '');
        const srcAbs = srcNode?.positionAbsolute || srcNode?.position;
        const tgtAbs = tgtNode?.positionAbsolute || tgtNode?.position;
        if (srcAbs) posRef.current.set(connection.source, { x: srcAbs.x, y: srcAbs.y });
        if (tgtAbs) posRef.current.set(connection.target, { x: tgtAbs.x, y: tgtAbs.y });
        persistSoon();
        
        const srcBuiltId = connection.source;
        const tgtBuiltId = connection.target;
        if (srcNode?.position) posRef.current.set(srcBuiltId, { ...srcNode.position });
        if (tgtNode?.position) posRef.current.set(tgtBuiltId, { ...tgtNode.position });
        persistSoon();

        onUpdateRows?.([
          ...rows,
          {
            traceId: cryptoId('cba-trace'),
            fromNodeId: connection.source,
            edgeId,
            toNodeId: connection.target,
            fromFunction,
            fromDetails: '',
            controlAction: '',
            controlDetails: '',
            toFunction,
            toDetails: '',
          },
        ]);

        return addEdge(newEdge, eds);
      });
    },
    [setEdges, rows, onUpdateRows, nodes, persistSoon, reviewMode]
  );

  const onEdgeUpdate = useCallback(
    (oldEdge, newConn) => {
      if (reviewMode) return;
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
    [setEdges, reviewMode]
  );

  /* Render */
  return (
    <div ref={diagramHostRef} style={{ width: '100%', height, minHeight: height === '100%' ? 0 : undefined, position: 'relative' }}>
      {!reviewMode && (
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
      )}
      {architectureFocus && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: 54,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 460,
            background: 'white',
            border: '1px solid rgba(45,125,254,0.35)',
            borderRadius: 10,
            padding: '7px 9px',
            boxShadow: '0 8px 22px rgba(15, 23, 42, 0.10)',
            color: '#334155',
            fontSize: 12,
          }}
        >
          <span style={{ fontWeight: 800, color: BRAND.blue }}>
            Focused {architectureFocus.kind.toUpperCase()}:
          </span>
          <span
            title={architectureFocus.label}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {architectureFocus.label}
          </span>
          <button
            type="button"
            onClick={() => setArchitectureFocus(null)}
            title="Show full architecture"
            style={{
              border: '1px solid #D8E2F3',
              background: '#F8FAFC',
              borderRadius: 7,
              color: '#475569',
              cursor: 'pointer',
              fontWeight: 800,
              lineHeight: 1,
              padding: '4px 7px',
            }}
          >
            ×
          </button>
        </div>
      )}
      {selectedTrace && (
        <div
          style={{
            position: 'absolute',
            right: 10,
            top: 54,
            zIndex: 10,
            width: 320,
            background: 'white',
            border: '1px solid rgba(20,184,166,0.45)',
            borderRadius: 10,
            padding: 10,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.12)',
            fontSize: 12,
            color: '#334155',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
            <div style={{ fontWeight: 800, color: '#0F766E' }}>Selected Source Trace</div>
            <button
              onClick={() => setSelectedTrace(null)}
              style={{ border: 'none', background: 'transparent', color: '#64748B', cursor: 'pointer', fontWeight: 700 }}
              title="Clear source trace highlight"
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 6, lineHeight: 1.45 }}>
            <div><b>Subsystem:</b> {selectedTrace.architecture?.subsystem || 'Application Subsystem'}</div>
            <div><b>CSCI:</b> {selectedTrace.architecture?.csci || 'n/a'}</div>
            <div><b>CSC:</b> {selectedTrace.architecture?.csc || 'n/a'}</div>
            <div><b>CSU:</b> {selectedTrace.architecture?.csu || 'n/a'}</div>
            <div style={{ marginTop: 4 }}>
              <b>Function:</b> {selectedTrace.sourceFn?.functionName || selectedTrace.label || 'n/a'}
            </div>
            {selectedTrace.sourceFn?.filePath && (
              <div title={selectedTrace.sourceFn.filePath} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <b>File:</b> {selectedTrace.sourceFn.filePath}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Canvas */}
      <div
        onWheelCapture={handleReviewWheelCapture}
        style={{
          border: `2px solid ${BRAND.blue}`,
          borderRadius: '8px',
          overflow: 'hidden',
          width: '100%',
          height: '100%',
        }}
      >
        {initialLayoutPending && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.92)',
              color: BRAND.blue,
              fontWeight: 700,
              letterSpacing: '0.01em',
            }}
          >
            Arranging diagram...
          </div>
        )}
        <ReactFlow
          nodes={initialLayoutPending ? [] : viewNodes}
          edges={initialLayoutPending ? [] : viewEdges}
          onInit={() => {
            setTimeout(() => {
              try {
                if (shouldSuppressAutoFit()) return;
                fitCurrentView({ duration: 0 });
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
          nodesDraggable={!reviewMode}
          nodesConnectable={!reviewMode}
          edgesUpdatable={!reviewMode}
          connectionMode={ConnectionMode.Loose}
          onConnectStart={onConnectStartLoose}
          onConnectEnd={onConnectEndLoose}
          minZoom={THEME.canvas.minZoom}
          maxZoom={THEME.canvas.maxZoom}
          panOnScroll
          panOnScrollMode="free"
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          onNodeDoubleClick={(event, node) => {
            const groupKind = node?.data?.groupKind;
            if (node?.type === 'groupBox' || groupKind) {
              event.preventDefault();
              event.stopPropagation();
              openArchitectureBoxEditModal(architectureBoxForDoubleClickTarget(event) || node);
              return;
            }
            if (isolateArchitectureBox(node)) return;
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
              architecture: {
                subsystem: node?.data?.subsystem || '',
                csci: node?.data?.csci || '',
                csc: node?.data?.csc || '',
                csu: node?.data?.csu || '',
              },
              codeEvidence: node?.data?.codeEvidence || null,
            });
          }}
          
          onEdgeDoubleClick={(event, edge) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              window.getSelection?.().removeAllRanges();
            } catch {}
            setEditModal({
              type: 'edge',
              id: edge.id,
              label: edge.label || '',
              description: edge.data?.description || '',
              rowRef: edge.data?.rowRef || '',
              rowRefs: edge.data?.rowRefs || [],
              codeEvidence: edge.data?.codeEvidence || null,
              fromFunction: edge.data?.fromFunction || '',
              controlAction: edge.data?.controlAction || edge.label || '',
              toFunction: edge.data?.toFunction || '',
            });
            setTimeout(() => {
              try {
                window.getSelection?.().removeAllRanges();
              } catch {}
            }, 0);
          }}
          onDoubleClick={(event) => {
            const edge = edgeForDoubleClickTarget(event);
            if (edge) {
              event.preventDefault();
              event.stopPropagation();
              try {
                window.getSelection?.().removeAllRanges();
              } catch {}
              setEditModal({
                type: 'edge',
                id: edge.id,
                label: edge.label || '',
                description: edge.data?.description || '',
                rowRef: edge.data?.rowRef || '',
                rowRefs: edge.data?.rowRefs || [],
                codeEvidence: edge.data?.codeEvidence || null,
                fromFunction: edge.data?.fromFunction || '',
                controlAction: edge.data?.controlAction || edge.label || '',
                toFunction: edge.data?.toFunction || '',
              });
              return;
            }
            const isInside = event.target.closest('.react-flow__node, .react-flow__edge, .react-flow__edge-label');
            if (isInside) return;
            const systemElementBox = systemElementBoxForDoubleClickTarget(event);
            if (systemElementBox) {
              event.preventDefault();
              event.stopPropagation();
              openArchitectureBoxEditModal(systemElementBox);
              return;
            }
            if (reviewMode) return;
          
            const bounds = diagramHostRef.current?.getBoundingClientRect();
            const position = nearestFreePosition(
              { x: event.clientX - (bounds?.left || 0), y: event.clientY - (bounds?.top || 0) },
              getNodes()
            );
          
            const existing = collectExistingLabels(getNodes(), rows);
            const label = makeUniqueNewLabel(existing);   // guarantees unique "new: N"
            const rfId = cryptoId('cba-node');
          
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
            if (reviewMode) return;
            // If a box moved, update all its children in the position cache
            if (node?.id?.startsWith('box:')) {
              const rfNodes = getNodes();
              const descendants = new Set([node.id]);
              let changed = true;
              while (changed) {
                changed = false;
                rfNodes.forEach((n) => {
                  if (n.parentNode && descendants.has(n.parentNode) && !descendants.has(n.id)) {
                    descendants.add(n.id);
                    changed = true;
                  }
                });
              }
              rfNodes.forEach((n) => {
                if (descendants.has(n.id) || !n.parentNode) {
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
            padding: 0,
            zIndex: 100,
            width: editModalExpanded ? 'calc(100% - 16px)' : 'min(1120px, calc(100% - 32px))',
            height: editModalExpanded ? 'calc(100% - 16px)' : 'min(860px, calc(100% - 48px))',
            maxHeight: editModalExpanded ? 'calc(100% - 16px)' : 'calc(100% - 48px)',
            overflow: 'hidden',
            boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              flex: '0 0 auto',
              padding: '10px 92px 10px 16px',
              borderBottom: '1px solid rgba(15,23,42,0.1)',
              background: 'white',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <button
              type="button"
              onClick={() => setEditModal(null)}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: 12,
                right: 14,
                width: 30,
                height: 30,
                borderRadius: 999,
                border: '1px solid rgba(15,23,42,0.12)',
                background: '#F8FAFC',
                color: '#334155',
                fontSize: 18,
                lineHeight: '26px',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
            <button
              type="button"
              onClick={() => setEditModalExpanded((value) => !value)}
              aria-label={editModalExpanded ? 'Restore modal size' : 'Expand modal'}
              title={editModalExpanded ? 'Restore modal size' : 'Expand modal'}
              style={{
                position: 'absolute',
                top: 12,
                right: 50,
                minWidth: 34,
                height: 30,
                borderRadius: 999,
                border: '1px solid rgba(15,23,42,0.12)',
                background: '#F8FAFC',
                color: '#334155',
                fontSize: 16,
                lineHeight: '26px',
                cursor: 'pointer',
                padding: '0 8px',
              }}
            >
              {editModalExpanded ? '↙' : '↗'}
            </button>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.2 }}>
              {editModal.type === 'architectureBox'
                ? 'Architecture Description'
                : reviewMode
                  ? `${editModal.type === 'node' ? 'Node' : 'Edge'} Details`
                  : `Edit ${editModal.type === 'node' ? 'Node' : 'Edge'}`}
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: editModal.canEditSystemElementColor
                  ? 'minmax(220px, 0.34fr) minmax(280px, 1fr) minmax(160px, 0.22fr)'
                  : 'minmax(220px, 0.42fr) minmax(280px, 1fr)',
                gap: 10,
                alignItems: 'start',
              }}
            >
            <label style={{ display: 'block', marginBottom: 0, fontSize: 12, fontWeight: 700, color: '#334155' }}>
              Label
              <input
                type="text"
                value={editModal.label}
                onChange={(e) => setEditModal((m) => ({ ...m, label: e.target.value }))}
                disabled={reviewMode}
                style={{ width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155' }}>
              Description
              <textarea
                value={editModal.description}
                onChange={(e) => {
                  if (reviewMode) return;
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  setEditModal((m) => ({ ...m, description: e.target.value }));
                }}
                ref={(node) => {
                  if (!node) return;
                  node.style.height = 'auto';
                  node.style.height = `${node.scrollHeight}px`;
                }}
                style={{
                  width: '100%',
                  marginTop: 3,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  fontSize: 13,
                  minHeight: 34,
                  maxHeight: editModalExpanded ? '260px' : '150px',
                  overflowY: 'auto',
                  resize: 'vertical',
                }}
                rows={1}
                disabled={reviewMode}
              />
            </label>
            {editModal.canEditSystemElementColor && (
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Color
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                  <input
                    type="color"
                    value={normalizeHexColor(editModal.systemElementColor, BRAND.blue)}
                    onChange={(e) => setEditModal((m) => ({ ...m, systemElementColor: e.target.value }))}
                    disabled={reviewMode}
                    style={{
                      width: 42,
                      height: 34,
                      padding: 2,
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      background: 'white',
                      cursor: 'pointer',
                    }}
                  />
                  <input
                    type="text"
                    value={editModal.systemElementColor || ''}
                    onChange={(e) => setEditModal((m) => ({ ...m, systemElementColor: e.target.value }))}
                    disabled={reviewMode}
                    placeholder="#2D7DFE"
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13 }}
                  />
                </div>
              </label>
            )}
            </div>
          </div>
          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 20px 18px' }}>
	          {(editModal.type === 'node' || editModal.type === 'edge' || editModal.type === 'architectureBox') && (editModal.architecture?.csci || editModal.architecture?.subsystem || editModal.codeEvidence || editModal.rowRefs?.length || editModal.rowRef) && (
	            <details
	              style={{
                marginTop: 14,
                borderTop: '1px solid rgba(15,23,42,0.1)',
                paddingTop: 12,
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 10,
                  listStylePosition: 'inside',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                  Architecture Trace
                </span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {editFunctionalTraceRows.length} row{editFunctionalTraceRows.length === 1 ? '' : 's'}
                </span>
              </summary>
              {editFunctionalTraceRows.length === 0 ? (
                <div style={{ fontSize: 13, color: '#64748B' }}>
                  No functional decomposition rows are linked to this {editModal.type === 'architectureBox' ? 'architecture box' : editModal.type}.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    maxHeight: 'min(320px, 36vh)',
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {editFunctionalTraceRows.map(({ ref, rowIndex, row }) => {
                    const title = row
                      ? `${row.fromFunction || 'Function'}${row.controlAction ? ` - ${row.controlAction}` : ''}${row.toFunction ? ` - ${row.toFunction}` : ''}`
                      : `Functional row ${ref}`;
                    const files = Array.from(new Set([row?.fromFile, row?.toFile, ...(editModal.codeEvidence?.files || [])].filter(Boolean))).slice(0, 6);
                    const sourceFunctions = Array.from(new Map([
                      ...(row?.codeEvidence?.sourceFunctions || []),
                      ...(row?.sourceEvidence?.functions || []),
                      ...(editModal.codeEvidence?.sourceFunctions || []),
                    ].filter(Boolean).map((fn, index) => [sourceFunctionKey(fn) || `${fn.functionName || 'source'}:${index}`, fn])).values()).slice(0, 8);
                    return (
                      <div
                        key={`${ref}-${rowIndex}`}
                        style={{
                          border: '1px solid rgba(45,125,254,0.18)',
                          borderRadius: 8,
                          background: '#F8FAFC',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            padding: '8px 10px',
                            background: '#EEF4FF',
                            color: '#0B3EA8',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Row {ref}: {title}
                          </span>
                          {typeof onOpenFunctionalRow === 'function' && rowIndex >= 0 && (
                            <button
                              type="button"
                              onClick={() => onOpenFunctionalRow({
                                type: 'functional-row',
                                intent: 'open-table',
                                rowIndex,
                                rowRef: row?.rowRef || ref,
                                traceId: row?.traceId || ref,
                                ref,
                              })}
                              style={{
                                flex: '0 0 auto',
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
                        <details style={{ borderTop: '1px solid rgba(45,125,254,0.12)' }}>
                          <summary
                            style={{
                              cursor: 'pointer',
                              padding: '7px 10px',
                              fontSize: 12,
                              fontWeight: 700,
                              color: BRAND.blue,
                              listStylePosition: 'inside',
                            }}
                          >
                            Details
                          </summary>
                          <div style={{ display: 'grid', gap: 4, padding: '0 10px 10px', fontSize: 12, color: '#475569' }}>
                            {[
                              ['Subsystem', row?.architecture?.subsystem || editModal.architecture?.subsystem],
                              ['CSCI', row?.architecture?.csci || editModal.architecture?.csci],
                              ['CSC', row?.architecture?.csc || editModal.architecture?.csc],
                              ['CSU', row?.architecture?.csu || editModal.architecture?.csu],
                              ['Files', files.join(', ')],
                            ].filter(([, value]) => value).map(([label, value]) => (
                              <div key={`${ref}-${label}`} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: 8 }}>
                                <span style={{ fontWeight: 700, color: '#334155' }}>{label}</span>
                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(value)}</span>
                              </div>
                            ))}
                            {sourceFunctions.length > 0 && (
                              <div style={{ marginTop: 6 }}>
                                <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>Source Links</div>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  {sourceFunctions.map((fn, index) => {
                                    const lineLabel = fn.startLine
                                      ? `L${fn.startLine}${fn.endLine && fn.endLine !== fn.startLine ? `-L${fn.endLine}` : ''}`
                                      : 'source';
                                    const label = `${fn.functionName || 'source'} (${fn.filePath || 'unknown file'}${fn.startLine ? `:${fn.startLine}` : ''})`;
                                    const isSelectedSource = sourceFunctionKey(selectedTrace?.sourceFn) === sourceFunctionKey(fn);
                                    const sourceItemStyle = {
                                      color: '#2563EB',
                                      textDecoration: fn.sourceUrl ? 'underline' : 'none',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      borderRadius: 6,
                                      padding: '2px 4px',
                                      background: isSelectedSource ? 'rgba(20,184,166,0.14)' : 'transparent',
                                      boxShadow: isSelectedSource ? 'inset 0 0 0 1px rgba(20,184,166,0.35)' : 'none',
                                    };
                                    return fn.sourceUrl ? (
                                      <a
                                        key={`${ref}:${fn.filePath}:${fn.functionName}:${fn.startLine || index}`}
                                        href={fn.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={() => selectSourceTrace(fn, editModal.id)}
                                        title={label}
                                        style={sourceItemStyle}
                                      >
                                        {fn.functionName || 'source'} - {lineLabel}
                                      </a>
                                    ) : (
                                      <button
                                        key={`${ref}:${fn.filePath}:${fn.functionName}:${fn.startLine || index}`}
                                        type="button"
                                        onClick={() => selectSourceTrace(fn, editModal.id)}
                                        title={label}
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          ...sourceItemStyle,
                                          textAlign: 'left',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {fn.functionName || 'source'} - {lineLabel}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
            </details>
          )}
          {editAssuranceArtifactGroups.map((group) => (
            <details
              key={group.key}
              style={{
                marginTop: 14,
                borderTop: '1px solid rgba(15,23,42,0.1)',
                paddingTop: 12,
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 10,
                  listStylePosition: 'inside',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                  {group.label}
                </span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {group.rows.length} result{group.rows.length === 1 ? '' : 's'}
                </span>
              </summary>
              {group.rows.length === 0 ? (
                <div style={{ fontSize: 13, color: '#64748B' }}>
                  No {group.label.toLowerCase()} are linked to this {editModal.type === 'architectureBox' ? 'architecture box' : editModal.type}.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {group.rows.map((row, rowIndex) => {
                    const rowId = assuranceText(row.id || row.internalId || `${group.key}-${rowIndex + 1}`);
                    const refs = (row.resolvedSourceArchitectureRefs || row.sourceArchitectureRefs || []).map(assuranceArchitectureLabel).filter(Boolean).join(', ');
                    return (
                      <div
                        key={`${group.key}-${rowId}-${rowIndex}`}
                        style={{
                          border: '1px solid rgba(45,125,254,0.18)',
                          borderRadius: 8,
                          background: '#F8FAFC',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            padding: '8px 10px',
                            background: '#EEF4FF',
                            color: '#0B3EA8',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rowId}: {assuranceArtifactTitle(row, group.label)}
                          </span>
                          {typeof onOpenAssuranceArtifactRow === 'function' && rowId && (
                            <button
                              type="button"
                              onClick={() => onOpenAssuranceArtifactRow(group.key, rowId)}
                              style={{
                                flex: '0 0 auto',
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
                        <details style={{ borderTop: '1px solid rgba(45,125,254,0.12)' }}>
                          <summary
                            style={{
                              cursor: 'pointer',
                              padding: '7px 10px',
                              fontSize: 12,
                              fontWeight: 700,
                              color: BRAND.blue,
                              listStylePosition: 'inside',
                            }}
                          >
                            Details
                          </summary>
                          <div style={{ display: 'grid', gap: 4, padding: '0 10px 10px', fontSize: 12, color: '#475569' }}>
                            {[
                              ['Architecture Source', refs],
                              ...group.fields.map(([label, key]) => [label, row?.[key]]),
                              ['Last Updated', row.updatedAt],
                            ].filter(([, value]) => assuranceText(value)).map(([label, value]) => (
                              <div key={`${group.key}-${rowId}-${label}`} style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: 8 }}>
                                <span style={{ fontWeight: 700, color: '#334155' }}>{label}</span>
                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assuranceText(value)}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
            </details>
          ))}
          <details
            style={{
              marginTop: 14,
              borderTop: '1px solid rgba(15,23,42,0.1)',
              paddingTop: 12,
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 10,
                listStylePosition: 'inside',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                Associated Hazard Analysis
              </span>
              {hazardDataRows.length > 0 && (
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {editHazardRows.length} result{editHazardRows.length === 1 ? '' : 's'}
                </span>
              )}
            </summary>
            {!hazardDataRows.length ? (
              <div style={{ fontSize: 13, color: '#64748B' }}>
                Run hazard analysis to see linked results here.
              </div>
            ) : editHazardRows.length === 0 ? (
              <div style={{ fontSize: 13, color: '#64748B' }}>
                No hazard analysis rows are linked to this {editModal.type === 'architectureBox' ? 'architecture box' : editModal.type}.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                  maxHeight: 'min(360px, 42vh)',
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
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
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 10px',
                        background: '#EEF4FF',
                        color: '#0B3EA8',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getHazardCardTitle(cells, sourceIndex)}
                      </span>
                      {typeof onOpenHazardRow === 'function' && (
                        <button
                          type="button"
                          onClick={() => onOpenHazardRow(sourceIndex)}
                          style={{
                            flex: '0 0 auto',
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
                    <details style={{ borderTop: '1px solid rgba(45,125,254,0.12)' }}>
                      <summary
                        style={{
                          cursor: 'pointer',
                          padding: '7px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          color: BRAND.blue,
                          listStylePosition: 'inside',
                        }}
                      >
                        Details
                      </summary>
                      <div style={{ display: 'grid', gap: 4, padding: '0 10px 10px', fontSize: 12, color: '#475569' }}>
                        {hazardHeaders.slice(0, 6).map((header, colIndex) => (
                          <div key={`${sourceIndex}-${header}-${colIndex}`} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: 8 }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>{header || `Column ${colIndex + 1}`}</span>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(cells?.[colIndex] ?? '')}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </details>
          </div>
          <div style={{ flex: '0 0 auto', borderTop: '1px solid rgba(15,23,42,0.1)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'white' }}>
            <button onClick={() => setEditModal(null)} style={{ padding: '6px 12px', borderRadius: 8 }}>
              Cancel
            </button>
            {!reviewMode && (
            <button
              onClick={() => {
                if (editModal.type === 'architectureBox') {
                  const nextSystemElementColor = editModal.canEditSystemElementColor
                    ? normalizeHexColor(editModal.systemElementColor, BRAND.blue)
                    : null;
                  if (editModal.canEditSystemElementColor) {
                    const colorKey = editModal.groupKey || editModal.label || editModal.id;
                    setSystemElementColorOverrides((previous) => {
                      const next = new Map(previous);
                      next.set(colorKey, nextSystemElementColor);
                      saveSystemElementColorOverrides(storageKey, next);
                      return next;
                    });
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
                              ...(editModal.canEditSystemElementColor ? { systemElementColor: nextSystemElementColor } : {}),
                            },
                          }
                        : n
                    )
                  );
                } else if (editModal.type === 'node') {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === editModal.id
                        ? { ...n, data: { ...n.data, label: editModal.label, description: editModal.description } }
                        : n
                    )
                  );

                  const updatedRows = rows.map((r) => {
                    if ((r.fromNodeId || `n:${r.fromFunction}`) === editModal.id)
                      return { ...r, fromFunction: editModal.label, fromDetails: editModal.description };
                    if ((r.toNodeId || `n:${r.toFunction}`) === editModal.id)
                      return { ...r, toFunction: editModal.label, toDetails: editModal.description };
                    return r;
                  });

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
                    const edgeId = r.edgeId || `e:${r.fromNodeId || `n:${r.fromFunction}`}->${r.toNodeId || `n:${r.toFunction}`}-${i}`;
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
            )}
          </div>
        </div>
      )}

      {/* Create Project modal */}
{showCreateModal && !reviewMode && (
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
function cryptoId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
