import { absoluteElementPosition, applyGroupGeometry, canContainElement, fitSystemAncestors, isSystemGroup, orderParentElements } from './functionalSystemGroups';
import { diagramRectsOverlap, GROUP_COLLISION_CLEARANCE } from './functionalDiagramCollision';

const elementSize = (node, boxes, padding) => {
  const box = boxes.find(item => item.id === node.id);
  return { width: box?.width || node.width || padding.nodeWidth, height: box?.height || node.height || padding.nodeHeight };
};

// Like subsystem resizing, a shrinking boundary pushes direct children inward.
// Nested containers move as units; their contents retain their local positions.
export function resizeManualContainer(nodes, boxes, id, dimensions, padding) {
  const original = boxes.find(box => box.id === id);
  if (!original) return null;
  const position = { x: dimensions.x ?? original.position.x, y: dimensions.y ?? original.position.y };
  const width = dimensions.width ?? original.width;
  const height = dimensions.height ?? original.height;
  if (![position.x, position.y, width, height].every(Number.isFinite)) return null;
  if (width < padding.minW || height < padding.minH || (original.parentNode &&
    (position.x < padding.padX || position.y < padding.padTop))) return null;
  const children = nodes.filter(node => node.parentNode === id);
  if (children.some(node => {
    const size = elementSize(node, boxes, padding);
    return width < size.width + 2 * padding.padX || height < size.height + padding.padTop + padding.padBottom;
  })) return null;
  const nextNodes = nodes.map(node => {
    if (node.parentNode !== id) return node;
    const size = elementSize(node, boxes, padding);
    return { ...node, position: {
      x: Math.min(Math.max(padding.padX, node.position.x + original.position.x - position.x), width - size.width - padding.padX),
      y: Math.min(Math.max(padding.padTop, node.position.y + original.position.y - position.y), height - size.height - padding.padBottom),
    } };
  });
  let nextBoxes = boxes.map(box => {
    if (box.id === id) return { ...box, position, width, height, userResized: true };
    const child = nextNodes.find(node => node.id === box.id && node.parentNode === id);
    return child ? { ...box, position: child.position } : box;
  });
  nextBoxes = fitSystemAncestors(nextNodes, nextBoxes, original.parentNode, padding);
  const result = { nodes: applyGroupGeometry(nextNodes, nextBoxes), boxes: nextBoxes };
  const systems = result.boxes.filter(isSystemGroup);
  for (let index = 0; index < systems.length; index++) {
    const box = systems[index];
    if (systems.slice(index + 1).some(other => diagramRectsOverlap(
      { ...box.position, width: box.width, height: box.height },
      { ...other.position, width: other.width, height: other.height }, GROUP_COLLISION_CLEARANCE
    ))) return null;
  }
  return result;
}

// Grow each boundary by the pointer overshoot, including left/top edges. Keep
// stationary siblings fixed on the canvas while updating both node and box data.
export function expandManualAncestorsForDrag(nodes, boxes, draggedId, absolutePosition, padding) {
  let nextNodes = nodes;
  let nextBoxes = boxes.map(box => {
    const node = nodes.find(item => item.id === box.id);
    return node ? { ...box, position: node.position } : box;
  });
  const dragged = nodes.find(node => node.id === draggedId);
  if (!dragged?.parentNode) return { nodes, boxes };
  const origin = absoluteElementPosition(nextBoxes.find(box => box.id === dragged.parentNode), nextBoxes);
  nextNodes = nextNodes.map(node => node.id === draggedId ? { ...node, position: {
    x: absolutePosition.x - origin.x, y: absolutePosition.y - origin.y,
  } } : node);
  let childId = draggedId;
  const visited = new Set();
  while (!visited.has(childId)) {
    visited.add(childId);
    const currentChildId = childId;
    const child = nextNodes.find(node => node.id === currentChildId);
    const parent = nextBoxes.find(box => box.id === child?.parentNode);
    if (!parent) break;
    const size = elementSize(child, nextBoxes, padding);
    const left = Math.max(0, padding.padX - child.position.x);
    const top = Math.max(0, padding.padTop - child.position.y);
    const right = Math.max(0, child.position.x + size.width + padding.padX - parent.width);
    const bottom = Math.max(0, child.position.y + size.height + padding.padBottom - parent.height);
    const expanded = { ...parent, position: { x: parent.position.x - left, y: parent.position.y - top },
      width: parent.width + left + right, height: parent.height + top + bottom, userResized: true };
    nextNodes = nextNodes.map(node => node.id === parent.id ? { ...node, position: expanded.position }
      : node.parentNode === parent.id ? { ...node, position: { x: node.position.x + left, y: node.position.y + top } } : node);
    const positions = new Map(nextNodes.map(node => [node.id, node.position]));
    nextBoxes = nextBoxes.map(box => box.id === parent.id ? expanded
      : { ...box, position: positions.get(box.id) || box.position });
    childId = parent.id;
  }
  return { nodes: applyGroupGeometry(nextNodes, nextBoxes), boxes: nextBoxes };
}

// Manual membership changes move a selection as a unit. Automatic import/layout
// continues to use its existing reparenting and placement functions.
export function reparentManualElements(nodes, boxes, ids, targetId, padding) {
  const target = boxes.find(box => box.id === targetId);
  const selected = new Set(ids);
  const eligible = nodes.filter(node => selected.has(node.id) && (targetId
    ? canContainElement(target, node, boxes) : Boolean(node.parentNode)));
  const eligibleIds = new Set(eligible.map(node => node.id));
  const roots = eligible.filter(node => !eligibleIds.has(node.parentNode));
  const movedIds = new Set(roots.map(node => node.id));
  if (!roots.length) return { nodes, boxes, movedIds: [] };
  const origin = target ? absoluteElementPosition(target, boxes) : { x: 0, y: 0 };
  const positions = new Map(roots.map(node => {
    const absolute = absoluteElementPosition(node, nodes);
    return [node.id, { x: absolute.x - origin.x, y: absolute.y - origin.y }];
  }));
  if (target) {
    const shift = {
      x: Math.max(0, padding.padX - Math.min(...[...positions.values()].map(pos => pos.x))),
      y: Math.max(0, padding.padTop - Math.min(...[...positions.values()].map(pos => pos.y))),
    };
    positions.forEach(pos => { pos.x += shift.x; pos.y += shift.y; });
    const size = node => {
      const box = boxes.find(item => item.id === node.id);
      return { width: box?.width || node.width || padding.nodeWidth, height: box?.height || node.height || padding.nodeHeight };
    };
    const siblings = nodes.filter(node => node.parentNode === targetId && !movedIds.has(node.id))
      .map(node => ({ ...node.position, ...size(node) }));
    // Only move the incoming selection if it would obscure an existing child.
    let overlap;
    do {
      overlap = false;
      for (const node of roots) {
        const pos = positions.get(node.id);
        const blocker = siblings.find(rect => diagramRectsOverlap({ ...pos, ...size(node) }, rect, 16));
        if (!blocker) continue;
        const dy = blocker.y + blocker.height + 32 - pos.y;
        positions.forEach(point => { point.y += dy; });
        overlap = true;
        break;
      }
    } while (overlap);
  }
  const nextNodes = nodes.map(node => movedIds.has(node.id)
    ? { ...node, parentNode: targetId || undefined, extent: undefined, position: positions.get(node.id) } : node);
  const touched = new Set([targetId, ...roots.map(node => node.parentNode)]);
  let nextBoxes = boxes.map(box => ({ ...box,
    ...(touched.has(box.id) ? { manualMembership: true } : {}),
    ...(movedIds.has(box.id) ? { parentNode: targetId || undefined, position: positions.get(box.id) } : {}),
  }));
  if (target) nextBoxes = fitSystemAncestors(nextNodes, nextBoxes, targetId, padding);
  return { nodes: orderParentElements(applyGroupGeometry(nextNodes, nextBoxes)), boxes: nextBoxes, movedIds: [...movedIds] };
}

export function manualDropTarget(point, movingNodes, boxes) {
  if (!point || !movingNodes.length) return null;
  const moving = new Set(movingNodes.map(node => node.id));
  return boxes.filter(box => !moving.has(box.id) && movingNodes.every(node => canContainElement(box, node, boxes)))
    .filter(box => {
      const origin = absoluteElementPosition(box, boxes);
      return point.x >= origin.x && point.x <= origin.x + box.width
        && point.y >= origin.y && point.y <= origin.y + box.height;
    })
    .sort((a, b) => Number(Boolean(b.parentNode)) - Number(Boolean(a.parentNode)) || a.width * a.height - b.width * b.height)[0] || null;
}

export function rowsWithManualSubsystem(rows, nodeIds, subsystem) {
  const selected = new Set(nodeIds);
  let changed = false;
  const next = rows.map(row => {
    if (!selected.has(`n:${String(row.fromFunction || '').trim()}`) || String(row.subsystem || '').trim() === subsystem) return row;
    changed = true;
    return { ...row, subsystem };
  });
  return changed ? next : rows;
}
