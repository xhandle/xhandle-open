import { absoluteElementPosition, applyGroupGeometry, canContainElement, fitSystemAncestors, orderParentElements } from './functionalSystemGroups';
import { diagramRectsOverlap } from './functionalDiagramCollision';

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
