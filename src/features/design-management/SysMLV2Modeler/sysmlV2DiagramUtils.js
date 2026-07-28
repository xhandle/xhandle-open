export function elementMatchesView(element, viewId) {
  if (!element) return false;
  if (viewId === "package") return element.type === "Package" || ["contains", "imports"].includes(element.metadata?.primaryRelationship);
  if (viewId === "structure") return /Package|Part|Interface|Port|Connection/.test(element.type);
  if (viewId === "interface") return /Interface|Port|Connection|Part/.test(element.type);
  if (viewId === "requirements") return /Requirement|Part|Action|VerificationCase/.test(element.type);
  if (viewId === "behavior") return /Action|State|Part/.test(element.type);
  if (viewId === "verification") return /VerificationCase|Requirement|AnalysisCase/.test(element.type);
  if (viewId === "safety") return element.metadata?.safetyCritical || /Requirement|Part|Action|Interface|VerificationCase/.test(element.type);
  return true;
}

export function relationshipMatchesView(relationship, viewId) {
  if (!relationship) return false;
  if (viewId === "package") return ["contains", "imports"].includes(relationship.type);
  if (viewId === "interface") return ["connects", "exposes", "references"].includes(relationship.type);
  if (viewId === "requirements") return ["satisfies", "derives", "refines", "traces"].includes(relationship.type);
  if (viewId === "behavior") return ["allocates", "traces", "contains"].includes(relationship.type);
  if (viewId === "verification") return ["verifies", "satisfies", "traces"].includes(relationship.type);
  if (viewId === "safety") return ["traces", "satisfies", "verifies", "mitigates", "allocates"].includes(relationship.type) || true;
  return true;
}

export function defaultPosition(index) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: 120 + col * 340, y: 100 + row * 210 };
}

const NODE_WIDTH = 270;
const NODE_HEIGHT = 118;
const NODE_GAP_X = 150;
const NODE_GAP_Y = 96;
const EDGE_CLEARANCE = 46;

function stableSortByName(items) {
  return [...items].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function connectionRanks(elements, relationships) {
  const ids = new Set(elements.map((element) => element.id));
  const rank = new Map(elements.map((element) => [element.id, 0]));
  const connects = (relationships || []).filter((rel) => rel.type === "connects" && ids.has(rel.sourceId) && ids.has(rel.targetId));
  for (let pass = 0; pass < elements.length; pass += 1) {
    let changed = false;
    connects.forEach((rel) => {
      const nextRank = Math.max(rank.get(rel.targetId) || 0, (rank.get(rel.sourceId) || 0) + 1);
      if (nextRank !== rank.get(rel.targetId)) {
        rank.set(rel.targetId, nextRank);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return rank;
}

function structureLayout(model, visible) {
  const positions = {};
  const parts = visible.filter((element) => /Part/.test(element.type));
  const packages = stableSortByName(visible.filter((element) => element.type === "Package"));
  const interfaces = stableSortByName(visible.filter((element) => /Interface|Port|Connection/.test(element.type)));
  const actions = stableSortByName(visible.filter((element) => /Action|State/.test(element.type)));
  const requirements = stableSortByName(visible.filter((element) => /Requirement/.test(element.type)));
  const verifications = stableSortByName(visible.filter((element) => /VerificationCase|AnalysisCase/.test(element.type)));
  const rank = connectionRanks(parts, model.relationships || []);
  const columns = new Map();

  stableSortByName(parts).forEach((part) => {
    const col = Math.min(rank.get(part.id) || 0, 5);
    columns.set(col, [...(columns.get(col) || []), part]);
  });

  packages.forEach((element, index) => {
    positions[element.id] = { x: 80, y: 80 + index * (NODE_HEIGHT + NODE_GAP_Y) };
  });

  [...columns.entries()].sort(([a], [b]) => a - b).forEach(([col, columnParts]) => {
    columnParts.forEach((element, row) => {
      positions[element.id] = { x: 420 + col * (NODE_WIDTH + NODE_GAP_X), y: 80 + row * (NODE_HEIGHT + NODE_GAP_Y) };
    });
  });

  interfaces.forEach((element, index) => {
    positions[element.id] = { x: 420 + (index % 3) * (NODE_WIDTH + NODE_GAP_X), y: 620 + Math.floor(index / 3) * (NODE_HEIGHT + NODE_GAP_Y) };
  });

  actions.forEach((element, index) => {
    positions[element.id] = { x: 840 + (index % 2) * (NODE_WIDTH + NODE_GAP_X), y: 860 + Math.floor(index / 2) * (NODE_HEIGHT + NODE_GAP_Y) };
  });

  requirements.forEach((element, index) => {
    positions[element.id] = { x: 1260 + (index % 2) * (NODE_WIDTH + NODE_GAP_X), y: 620 + Math.floor(index / 2) * (NODE_HEIGHT + NODE_GAP_Y) };
  });

  verifications.forEach((element, index) => {
    positions[element.id] = { x: 1680 + (index % 2) * (NODE_WIDTH + NODE_GAP_X), y: 860 + Math.floor(index / 2) * (NODE_HEIGHT + NODE_GAP_Y) };
  });

  visible.forEach((element, index) => {
    if (!positions[element.id]) positions[element.id] = defaultPosition(index);
  });
  return positions;
}

export function autoLayoutSysML(model, viewId = "structure") {
  const visible = (model.elements || []).filter((element) => elementMatchesView(element, viewId));
  if (viewId === "structure" || viewId === "interface" || viewId === "safety") return structureLayout(model, visible);

  const bands = [
    visible.filter((element) => element.type === "Package"),
    visible.filter((element) => /Part|Interface/.test(element.type)),
    visible.filter((element) => /Action|State|Constraint/.test(element.type)),
    visible.filter((element) => /Requirement/.test(element.type)),
    visible.filter((element) => /VerificationCase|AnalysisCase/.test(element.type)),
  ].map(stableSortByName);
  const positions = {};
  bands.forEach((band, row) => {
    band.forEach((element, col) => {
      positions[element.id] = { x: 100 + col * (NODE_WIDTH + NODE_GAP_X), y: 80 + row * (NODE_HEIGHT + NODE_GAP_Y) };
    });
  });
  visible.forEach((element, index) => {
    if (!positions[element.id]) positions[element.id] = defaultPosition(index);
  });
  return positions;
}

function rectFor(position, pad = 0) {
  return {
    left: position.x - pad,
    top: position.y - pad,
    right: position.x + NODE_WIDTH + pad,
    bottom: position.y + NODE_HEIGHT + pad,
  };
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function lineIntersectsRect(a, b, rect) {
  const steps = Math.max(12, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 80));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (pointInRect(point, rect)) return true;
  }
  return false;
}

function centerOf(position) {
  return { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT / 2 };
}

function normalizePositions(elements, positions, relationships = []) {
  const normalized = {};
  elements.forEach((element, index) => {
    const position = positions[element.id] || defaultPosition(index);
    normalized[element.id] = { x: Math.round(position.x), y: Math.round(position.y) };
  });

  const ordered = stableSortByName(elements);
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        const aRect = rectFor(normalized[a.id], 26);
        const bRect = rectFor(normalized[b.id], 26);
        if (!rectsOverlap(aRect, bRect)) continue;
        const sameColumn = Math.abs(normalized[a.id].x - normalized[b.id].x) < NODE_WIDTH;
        if (sameColumn || normalized[b.id].y >= normalized[a.id].y) {
          normalized[b.id] = { ...normalized[b.id], y: aRect.bottom + NODE_GAP_Y };
        } else {
          normalized[b.id] = { ...normalized[b.id], x: aRect.right + NODE_GAP_X };
        }
        changed = true;
      }
    }
    if (!changed) break;
  }

  const visibleIds = new Set(elements.map((element) => element.id));
  const relevantRelationships = (relationships || []).filter((rel) => visibleIds.has(rel.sourceId) && visibleIds.has(rel.targetId));
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    relevantRelationships.forEach((rel) => {
      const source = normalized[rel.sourceId];
      const target = normalized[rel.targetId];
      if (!source || !target) return;
      const a = centerOf(source);
      const b = centerOf(target);
      elements.forEach((element) => {
        if (element.id === rel.sourceId || element.id === rel.targetId) return;
        const rect = rectFor(normalized[element.id], EDGE_CLEARANCE);
        if (!lineIntersectsRect(a, b, rect)) return;
        const horizontalEdge = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        normalized[element.id] = horizontalEdge
          ? { ...normalized[element.id], y: rect.bottom + NODE_GAP_Y }
          : { ...normalized[element.id], x: rect.right + NODE_GAP_X };
        changed = true;
      });
    });
    if (!changed) break;
  }

  return normalized;
}

export function toReactFlowModel(model, viewId = "structure") {
  const positions = model?.diagrams?.[viewId]?.positions || {};
  const visibleElements = (model?.elements || []).filter((element) => elementMatchesView(element, viewId));
  const visibleIds = new Set(visibleElements.map((element) => element.id));
  const visibleRelationships = (model?.relationships || [])
    .filter((relationship) => visibleIds.has(relationship.sourceId) && visibleIds.has(relationship.targetId) && relationshipMatchesView(relationship, viewId));
  const layout = normalizePositions(visibleElements, { ...autoLayoutSysML(model, viewId), ...positions }, visibleRelationships);
  const nodes = visibleElements.map((element, index) => ({
    id: element.id,
    type: "sysmlNode",
    position: layout[element.id] || defaultPosition(index),
    data: { element },
  }));
  const nodePositionById = new Map(nodes.map((node) => [node.id, node.position]));
  const edges = visibleRelationships
    .map((relationship) => {
      const sourcePosition = nodePositionById.get(relationship.sourceId) || { x: 0, y: 0 };
      const targetPosition = nodePositionById.get(relationship.targetId) || { x: 0, y: 0 };
      const horizontal = Math.abs(targetPosition.x - sourcePosition.x) >= Math.abs(targetPosition.y - sourcePosition.y);
      const forward = targetPosition.x >= sourcePosition.x;
      const downward = targetPosition.y >= sourcePosition.y;
      return {
        id: relationship.id,
        source: relationship.sourceId,
        target: relationship.targetId,
        sourceHandle: `s-${horizontal ? (forward ? "right" : "left") : (downward ? "bottom" : "top")}`,
        targetHandle: `t-${horizontal ? (forward ? "left" : "right") : (downward ? "top" : "bottom")}`,
        label: relationship.label || relationship.type,
        type: "bezier",
        animated: ["traces", "verifies", "satisfies"].includes(relationship.type),
        style: {
          strokeWidth: ["connects", "contains"].includes(relationship.type) ? 2.4 : 2,
          strokeDasharray: ["allocates", "traces", "derives", "refines"].includes(relationship.type) ? "6 5" : undefined,
        },
        data: { relationship },
      };
    });
  return { nodes, edges };
}
