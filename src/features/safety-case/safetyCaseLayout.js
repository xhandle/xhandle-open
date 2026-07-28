export const SAFETY_CASE_NODE_SIZE = { width: 280, height: 170 };

const LIFECYCLE_NODE_SIZES = {
  topClaim: { width: 620, height: 82 },
  contextBox: { width: 300, height: 140 },
  assumptionBox: { width: 360, height: 140 },
  strategyBar: { width: 760, height: 82 },
  goalColumn: { width: 220, height: 150 },
  goalEvidence: { width: 190, height: 110 },
  monitoringGoal: { width: 700, height: 88 },
  bottomEvidence: { width: 190, height: 120 },
};

const DEFAULT_TREE_GAPS = {
  column: 360,
  row: 210,
};

function nodeWidth(nodeSizes, nodeId) {
  return nodeSizes?.[nodeId]?.width || SAFETY_CASE_NODE_SIZE.width;
}

function nodeSizeFor(node, nodeSizes) {
  return nodeSizes?.[node.id] || LIFECYCLE_NODE_SIZES[node.metadata?.layoutRole] || SAFETY_CASE_NODE_SIZE;
}

function layoutLifecycleSafetyCase(safetyCase) {
  const nodes = safetyCase?.nodes || [];
  const roleNodes = (role) => nodes.filter((node) => node.metadata?.layoutRole === role);
  const positions = new Map();

  roleNodes("topClaim").forEach((node) => positions.set(node.id, { x: -nodeSizeFor(node).width / 2, y: -294 }));
  roleNodes("contextBox").forEach((node) => positions.set(node.id, { x: -760, y: -106 }));
  roleNodes("assumptionBox").forEach((node) => positions.set(node.id, { x: 470, y: -106 }));
  roleNodes("strategyBar").forEach((node) => positions.set(node.id, { x: -nodeSizeFor(node).width / 2, y: 90 }));

  const goals = roleNodes("goalColumn");
  const goalGap = 90;
  const goalWidth = LIFECYCLE_NODE_SIZES.goalColumn.width;
  const totalGoalWidth = goals.length * goalWidth + Math.max(0, goals.length - 1) * goalGap;
  const goalPositions = new Map();
  goals.forEach((node, index) => {
    const position = {
      x: -totalGoalWidth / 2 + index * (goalWidth + goalGap),
      y: 360,
    };
    goalPositions.set(node.id, position);
    positions.set(node.id, position);
  });

  const evidenceByParent = new Map();
  roleNodes("goalEvidence").forEach((node) => {
    if (!evidenceByParent.has(node.parentId)) evidenceByParent.set(node.parentId, []);
    evidenceByParent.get(node.parentId).push(node);
  });
  evidenceByParent.forEach((evidenceNodes, parentId) => {
    const parentPosition = goalPositions.get(parentId);
    if (!parentPosition) return;
    const evidenceGap = 22;
    const evidenceWidth = LIFECYCLE_NODE_SIZES.goalEvidence.width;
    const totalEvidenceWidth = evidenceNodes.length * evidenceWidth + Math.max(0, evidenceNodes.length - 1) * evidenceGap;
    evidenceNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: parentPosition.x + goalWidth / 2 - totalEvidenceWidth / 2 + index * (evidenceWidth + evidenceGap),
        y: parentPosition.y + LIFECYCLE_NODE_SIZES.goalColumn.height + 54,
      });
    });
  });

  roleNodes("monitoringGoal").forEach((node) => positions.set(node.id, { x: -nodeSizeFor(node).width / 2, y: 760 }));

  const bottomEvidence = roleNodes("bottomEvidence");
  const evidenceGap = 150;
  const evidenceWidth = LIFECYCLE_NODE_SIZES.bottomEvidence.width;
  const totalEvidenceWidth = bottomEvidence.length * evidenceWidth + Math.max(0, bottomEvidence.length - 1) * evidenceGap;
  bottomEvidence.forEach((node, index) => {
    positions.set(node.id, {
      x: -totalEvidenceWidth / 2 + index * (evidenceWidth + evidenceGap),
      y: 900,
    });
  });

  return centerSafetyCaseOnYAxis({
    ...safetyCase,
    nodes: nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) || node.position || { x: 0, y: 0 },
    })),
  });
}

export function usesLifecycleSafetyCaseLayout(safetyCase) {
  return Boolean((safetyCase?.nodes || []).some((node) => node.metadata?.template === "lifecycleSafetyCase" || node.metadata?.layoutRole === "strategyBar"));
}

export function centerSafetyCaseOnYAxis(safetyCase, { nodeSizes } = {}) {
  const nodes = safetyCase?.nodes || [];
  if (!nodes.length) return safetyCase;

  const bounds = nodes.reduce((acc, node) => {
    const position = node.position || { x: 0, y: 0 };
    const width = nodeSizeFor(node, nodeSizes).width;
    return {
      minX: Math.min(acc.minX, position.x),
      maxX: Math.max(acc.maxX, position.x + width),
    };
  }, { minX: Infinity, maxX: -Infinity });

  const graphCenterX = (bounds.minX + bounds.maxX) / 2;
  return {
    ...safetyCase,
    nodes: nodes.map((node) => ({
      ...node,
      position: {
        ...(node.position || { x: 0, y: 0 }),
        x: (node.position?.x || 0) - graphCenterX,
      },
    })),
  };
}

export function layoutSafetyCaseTreeSymmetrically(safetyCase, { columnGap = DEFAULT_TREE_GAPS.column, rowGap = DEFAULT_TREE_GAPS.row, nodeSizes } = {}) {
  const nodes = safetyCase?.nodes || [];
  if (!nodes.length) return safetyCase;
  if (usesLifecycleSafetyCaseLayout(safetyCase)) {
    return layoutLifecycleSafetyCase(safetyCase);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const childrenByParent = new Map();
  nodes.forEach((node) => {
    if (!node.parentId || !nodeIds.has(node.parentId)) return;
    if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId).push(node.id);
  });

  const roots = nodes.filter((node) => !node.parentId || !nodeIds.has(node.parentId));
  const levels = [];
  const visited = new Set();
  let currentLevel = roots.length ? roots.map((node) => node.id) : [nodes[0].id];

  while (currentLevel.length) {
    const level = currentLevel.filter((id) => !visited.has(id));
    if (!level.length) break;
    level.forEach((id) => visited.add(id));
    levels.push(level);
    currentLevel = level.flatMap((id) => childrenByParent.get(id) || []);
  }

  const orphanIds = nodes.map((node) => node.id).filter((id) => !visited.has(id));
  if (orphanIds.length) levels.push(orphanIds);

  const positions = new Map();
  levels.forEach((level, levelIndex) => {
    if (levelIndex === 0) {
      level.forEach((id, index) => {
        const centerOffset = (level.length - 1) / 2;
        positions.set(id, {
          x: (index - centerOffset) * columnGap - nodeWidth(nodeSizes, id) / 2,
          y: 0,
        });
      });
      return;
    }

    const pairColumnGap = Math.max(columnGap, nodeWidth(nodeSizes, level[0]) + 140);
    level.forEach((id, index) => {
      const pairIndex = Math.floor(index / 2);
      const isLeft = index % 2 === 0;
      const columnOffset = pairIndex + 1;
      const centerX = level.length === 1 ? 0 : (isLeft ? -1 : 1) * columnOffset * pairColumnGap;
      positions.set(id, {
        x: centerX - nodeWidth(nodeSizes, id) / 2,
        y: levelIndex * rowGap + pairIndex * Math.round(rowGap * 0.72),
      });
    });
  });

  return centerSafetyCaseOnYAxis({
    ...safetyCase,
    nodes: nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) || node.position || {
        x: -nodeWidth(nodeSizes, node.id) / 2,
        y: 0,
      },
    })),
  }, { nodeSizes });
}
