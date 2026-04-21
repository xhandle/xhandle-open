/**
 * xHandle: node layout manager diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

// nodeLayoutManager.js — Dedicated node positioning and layout logic
import ELK from 'elkjs/lib/elk.bundled.js';

/* ================================
 * Theme constants for layout
 * ================================ */
const THEME = {
  node: {
    w: 240,
    h: 96,
  },
  canvas: {
    padX: 80,
    padY: 60,
  },
};

// Grid and spacing constants
const GRID = 16;
const GAP = 24;

/* ================================
 * ELK Layout Engine
 * ================================ */
const elk = new ELK();
const ELK_DEFAULTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '200',
  'elk.layered.spacing.nodeNodeBetweenLayers': '300',
  'elk.spacing.componentComponent': '400',
  'elk.padding': '[top=40,left=60,bottom=40,right=60]',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.edgeRouting': 'ORTHOGONAL',
};

/* ================================
 * Group helpers (file buckets & boxes)
 * ================================ */

// Identify a group box node
export const isGroupBox = (n) =>
  n?.type === 'groupBox' || n?.id?.startsWith('box:');

// Keep this near the top where helpers live:
export const nodeFileKey = (n) => {
  // Prefer explicit file set on the node by the diagram builder
  if (n?.data?.file) return n.data.file;

  // Fallbacks (in case a builder sets variants)
  if (n?.data?.fileFrom) return n.data.fileFrom;
  if (n?.data?.fileTo) return n.data.fileTo;

  // Last resort
  return 'Unfiled';
};


// Visual box styles
const BOX_PAD = 24; // padding between nodes and the box wall

// Compute min/max bounds for each file group
export function computeGroupBounds(nodes) {
  const groups = new Map();
  for (const n of nodes) {
    if (isGroupBox(n)) continue; // never include boxes inside boxes
    const key = nodeFileKey(n);
    if (!groups.has(key)) {
      groups.set(key, {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        count: 0,
      });
    }
    const g = groups.get(key);
    const x1 = n.position.x;
    const y1 = n.position.y;
    const x2 = x1 + THEME.node.w;
    const y2 = y1 + THEME.node.h;
    g.minX = Math.min(g.minX, x1);
    g.minY = Math.min(g.minY, y1);
    g.maxX = Math.max(g.maxX, x2);
    g.maxY = Math.max(g.maxY, y2);
    g.count += 1;
  }
  return groups;
}

/**
 * attachNodesToBoxes encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param nodes Diagram node collection for the current view.
 * @param boxes Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
export function attachNodesToBoxes(nodes, boxes) {
  const boxByFile = new Map(boxes.map((b) => [b.data.label, b]));
  return nodes.map((n) => {
    const file = nodeFileKey(n);
    const box = boxByFile.get(file);
    if (!box) return n;
    return {
      ...n,
      parentNode: box.id,            // ← make it a child of the box
      extent: 'parent',              // ← keep drags inside the box
      position: {
        x: n.position.x - box.position.x,
        y: n.position.y - box.position.y, // ← now relative to the box
      },
    };
  });
}

// Build React Flow nodes for the boxes (to be added AFTER ELK)
export function buildGroupBoxNodes(groups) {
  const boxes = [];
  const BOX_LABEL_CLEAR = 26;  // space for the label pill
  for (const [file, b] of groups.entries()) {
    if (b.count <= 0) continue;

    const topPad = BOX_PAD + BOX_LABEL_CLEAR;
    const width  = (b.maxX - b.minX) + BOX_PAD * 2;
    const height = (b.maxY - b.minY) + topPad + BOX_PAD;

    boxes.push({
      id: `box:${file}`,
      type: 'groupBox',
      position: { x: b.minX - BOX_PAD, y: b.minY - topPad },
      data: { label: file },
      draggable: true,                 // ← allow dragging the box
      selectable: true,
      focusable: false,
      deletable: false,
      style: { width, height, zIndex: 0, pointerEvents: 'auto' },
    });
  }
  return boxes;
}


/* ================================
 * ELK helpers
 * ================================ */

// Recursively collect (absolute) positions from ELK's nested result
function collectAbsolutePositions(elkNode, acc, ox = 0, oy = 0) {
  const px = Math.round((elkNode.x || 0) + ox);
  const py = Math.round((elkNode.y || 0) + oy);

  if (Array.isArray(elkNode.children) && elkNode.children.length) {
    for (const c of elkNode.children) {
      collectAbsolutePositions(c, acc, px, py);
    }
  } else if (elkNode.id) {
    acc.set(elkNode.id, { x: px, y: py });
  }
}

/**
 * toElkGraph encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param nodes Diagram node collection for the current view.
 * @param edges Diagram edge collection for the current view.
 * @param groupByFile Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
function toElkGraph({ nodes, edges, groupByFile = true }) {
  if (!groupByFile) {
    // Flat graph (original behavior)
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

  // ---- Grouped graph (compounds) ----
  // Partition nodes by file bucket
  const byFile = new Map();
  for (const n of nodes) {
    const key = nodeFileKey(n);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(n);
  }

  // Create a compound node per file with its children
  const fileChildren = [...byFile.entries()].map(([file, fileNodes]) => ({
    id: `g:${file}`, // container id
    labels: [{ text: file }], // visible in ELK debug
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.padding': '[top=30,left=30,bottom=30,right=30]',
      // Slightly tighter inside a group so big files don't balloon
      'elk.spacing.nodeNode': '120',
      'elk.layered.spacing.nodeNodeBetweenLayers': '180',
    },
    children: fileNodes.map((n) => ({
      id: n.id,
      width: THEME.node.w,
      height: THEME.node.h,
    })),
  }));

  return {
    id: 'root',
    layoutOptions: {
      ...ELK_DEFAULTS,
      'elk.direction': 'RIGHT',
      'elk.spacing.componentComponent': '400',
    },
    children: fileChildren,
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
 * @param groupByFile Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to diagram data or layout state for rendering.
 */
export async function runElkLayoutOnce({
  nodes,
  edges,
  groupByFile = true, // default: auto-group if file info exists
}) {
  if (!nodes.length) return nodes;

  // Auto-disable grouping if nodes don't carry a file key
  const anyHasFile = nodes.some((n) => nodeFileKey(n) !== 'Unfiled');
  const useGroups = groupByFile && anyHasFile;

  const graph = toElkGraph({ nodes, edges, groupByFile: useGroups });
  const laidOut = await elk.layout(graph);

  // ELK children positions are relative to their parent; convert to absolute
  const posById = new Map();
  collectAbsolutePositions(laidOut, posById);

  return nodes.map((n) => ({
    ...n,
    position: posById.get(n.id) ?? n.position,
  }));
}

/* ================================
 * Grid snapping and positioning
 * ================================ */
export const snap = (v) => Math.round(v / GRID) * GRID;

/**
 * isOverlapping encapsulates a focused piece of diagram-rendering workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param a Input consumed by this step of the xHandle workflow.
 * @param b Input consumed by this step of the xHandle workflow.
 * @returns diagram data or layout state for rendering.
 */
export function isOverlapping(a, b) {
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
export function nearestFreePosition({ x, y }, existing) {
  let r = 0, step = GRID;
  const maxRings = 50;
  const base = { x: snap(x), y: snap(y) };
  const taken = existing
    .filter((n) => !isGroupBox(n))
    .map((n) => ({ x: n.position.x, y: n.position.y }));
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
export function nudgeIfOverlapping(movedId, nodes, setNodes) {
  setNodes((nds) => {
    const filtered = nds.filter((n) => !isGroupBox(n));
    const me = filtered.find((n) => n.id === movedId);
    if (!me) return nds;
    let pos = { ...me.position };
    const others = filtered.filter((n) => n.id !== movedId);
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
 * Seed position for new nodes
 * ================================ */
export function seedPosition(index = 0) {
  const baseX = 120;
  const baseY = 120;
  const step = 48;
  return { x: baseX + step * (index % 10), y: baseY + step * Math.floor(index / 10) };
}

/* ================================
 * Overlap resolution (physics-like pushing)
 * ================================ */
export function resolveOverlaps({ nodes, containerW, containerH, gap = 36, passes = 60 }) {
  const W = THEME.node.w;
  const H = THEME.node.h;

  // Work only on real nodes; keep boxes unchanged and merge later
  const real = nodes.filter((n) => !isGroupBox(n));
  const out = real.map((n) => ({ ...n, position: { ...n.position } }));

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

  const boxes = nodes.filter((n) => isGroupBox(n));
  return [...boxes, ...out];
}

/* ================================
 * Spread cleaned nodes to fill viewport
 * ================================ */
export function spreadToViewport({
  nodes,
  containerW,
  containerH,
  padX = THEME.canvas.padX,
  padY = THEME.canvas.padY
}) {
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
 * Persistent position storage
 * ================================ */
export function loadPositions(storageKey) {
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
export function savePositions(storageKey, posMap) {
  try {
    const arr = Array.from(posMap.entries());
    localStorage.setItem(storageKey, JSON.stringify(arr));
  } catch {}
}

/* ================================
 * Structure signature for detecting changes
 * ================================ */
export function structureSignature(rows) {
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
