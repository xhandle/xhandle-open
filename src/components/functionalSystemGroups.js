import { diagramRectsOverlap, GROUP_COLLISION_CLEARANCE } from './functionalDiagramCollision';

// Systems extend the existing groupBox representation. Legacy boxes are subsystems.
export const isSystemGroup = box => box?.elementType === 'system';
export function canContainElement(target, node, boxes) {
  if (!target || !node || target.id === node.id) return false;
  const box = boxes.find(item => item.id === node.id);
  if (!box) return !isSystemGroup(target) || node.type !== 'note';
  return isSystemGroup(target) && !isSystemGroup(box);
}

export function absoluteElementPosition(node, nodes, seen = new Set()) {
  if (!node || seen.has(node.id)) return { x: 0, y: 0 };
  seen.add(node.id);
  const parent = nodes.find(item => item.id === node.parentNode);
  const origin = parent ? absoluteElementPosition(parent, nodes, seen) : { x: 0, y: 0 };
  return { x: origin.x + (node.position?.x || 0), y: origin.y + (node.position?.y || 0) };
}

// React Flow requires parents before children. Preserve sibling order.
export function orderParentElements(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set();
  const result = [];
  const visit = node => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const parent = byId.get(node.parentNode);
    if (parent) visit(parent);
    result.push(node);
  };
  nodes.forEach(visit);
  return result;
}

export function reparentSystemElements(nodes, boxes, ids, targetId, padding) {
  const target = boxes.find(box => box.id === targetId);
  const selected = new Set(ids);
  const eligible = nodes.filter(node => selected.has(node.id) && (targetId
    ? canContainElement(target, node, boxes) : Boolean(node.parentNode)));
  // When both a subsystem and its function are selected, keep the function in it.
  const eligibleIds = new Set(eligible.map(node => node.id));
  const roots = new Set(eligible.filter(node => !eligibleIds.has(node.parentNode)).map(node => node.id));
  const targetNode = nodes.find(node => node.id === targetId);
  const origin = targetNode ? absoluteElementPosition(targetNode, nodes) : { x: 0, y: 0 };
  const nextNodes = nodes.map(node => {
    if (!roots.has(node.id)) return node;
    const absolute = absoluteElementPosition(node, nodes);
    const position = { x: absolute.x - origin.x, y: absolute.y - origin.y };
    if (target) {
      position.x = Math.max(padding.padX, position.x);
      position.y = Math.max(padding.padTop, position.y);
    }
    return { ...node, parentNode: targetId || undefined, extent: undefined, position };
  });
  let nextBoxes = boxes.map(box => {
    const node = nextNodes.find(item => item.id === box.id);
    return roots.has(box.id) ? { ...box, parentNode: node.parentNode, position: node.position } : box;
  });
  if (target) nextBoxes = fitSystemAncestors(nextNodes, nextBoxes, targetId, padding);
  return { nodes: orderParentElements(nextNodes), boxes: nextBoxes, movedIds: [...roots] };
}

export function fitSystemAncestors(nodes, boxes, startId, padding) {
  let next = boxes;
  let id = startId;
  const visited = new Set();
  while (id && !visited.has(id)) {
    visited.add(id);
    const currentId = id;
    const currentBoxes = next;
    const box = currentBoxes.find(item => item.id === currentId);
    if (!box) break;
    let width = box.width || padding.w;
    let height = box.height || padding.h;
    nodes.filter(node => node.parentNode === currentId).forEach(node => {
      const childBox = currentBoxes.find(item => item.id === node.id);
      width = Math.max(width, node.position.x + (childBox?.width || node.width || padding.nodeWidth) + padding.padX);
      height = Math.max(height, node.position.y + (childBox?.height || node.height || padding.nodeHeight) + padding.padBottom);
    });
    next = currentBoxes.map(item => item.id === currentId ? { ...item, width, height } : item);
    id = box.parentNode;
  }
  return next;
}

export function applyGroupGeometry(nodes, boxes) {
  const byId = new Map(boxes.map(box => [box.id, box]));
  return nodes.map(node => {
    const box = byId.get(node.id);
    return box ? { ...node, parentNode: box.parentNode || undefined, position: box.position,
      style: { ...node.style, width: box.width, height: box.height } } : node;
  });
}

// Resize a nested container without treating its local coordinates as canvas coordinates.
export function resizeSystemElements(nodes, boxes, id, dimensions, padding) {
  const box = boxes.find(item => item.id === id);
  if (!box) return { nodes, boxes };
  const position = {
    x: Number.isFinite(dimensions.x) ? dimensions.x : box.position.x,
    y: Number.isFinite(dimensions.y) ? dimensions.y : box.position.y,
  };
  // Keep a nested subsystem below its system's title.
  if (box.parentNode) {
    position.x = Math.max(padding.padX, position.x);
    position.y = Math.max(padding.padTop, position.y);
  }
  const dx = box.position.x - position.x;
  const dy = box.position.y - position.y;
  const nextNodes = nodes.map(node => node.parentNode === id ? { ...node, position: {
    x: Math.max(padding.padX, node.position.x + dx),
    y: Math.max(padding.padTop, node.position.y + dy),
  } } : node);
  let nextBoxes = boxes.map(item => {
    if (item.id === id) return { ...item, position,
      width: Math.max(padding.minW, dimensions.width || item.width),
      height: Math.max(padding.minH, dimensions.height || item.height), userResized: true };
    const child = nextNodes.find(node => node.id === item.id && node.parentNode === id);
    return child ? { ...item, position: child.position } : item;
  });
  nextBoxes = fitSystemAncestors(nextNodes, nextBoxes, id, padding);
  return { nodes: applyGroupGeometry(nextNodes, nextBoxes), boxes: nextBoxes };
}

export function detachDeletedSystemParents(nodes, boxes, deletedIds) {
  const nextNodes = nodes.filter(node => !deletedIds.has(node.id)).map(node => {
    if (!deletedIds.has(node.parentNode)) return node;
    return { ...node, position: absoluteElementPosition(node, nodes), parentNode: undefined, extent: undefined };
  });
  const nextBoxes = boxes.filter(box => !deletedIds.has(box.id)).map(box => {
    const node = nextNodes.find(item => item.id === box.id);
    return deletedIds.has(box.parentNode) ? { ...box, position: node.position, parentNode: undefined } : box;
  });
  return { nodes: orderParentElements(nextNodes), boxes: nextBoxes };
}

const allocationKey = value => String(value || '').trim().toLowerCase();
export function systemForElement(node, nodes, boxes) {
  const byId = new Map(nodes.map(item => [item.id, item]));
  const groups = new Map(boxes.map(box => [box.id, box]));
  const seen = new Set();
  let parentId = node?.parentNode;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const group = groups.get(parentId);
    if (isSystemGroup(group)) return group.label || '';
    parentId = group?.parentNode || byId.get(parentId)?.parentNode;
  }
  return '';
}

export function rowsWithDiagramSystems(rows, nodes, boxes, { missingOnly = false } = {}) {
  const functions = new Map(nodes.filter(node => node.type !== 'groupBox').map(node => [allocationKey(node.data?.label), node]));
  let changed = false;
  const next = rows.map(row => {
    if (missingOnly && Object.prototype.hasOwnProperty.call(row, 'system')) return row;
    const node = functions.get(allocationKey(row.fromFunction));
    if (!node) return row;
    const system = systemForElement(node, nodes, boxes);
    if ((row.system || '') === system) return row;
    changed = true;
    return { ...row, system };
  });
  return changed ? next : rows;
}

// A subsystem has one system owner; changing its allocation updates its interface rows together.
export function editFunctionalSystem(rows, index, system) {
  const source = rows[index];
  if (!source) return rows;
  const subsystem = allocationKey(source.subsystem);
  const fn = allocationKey(source.fromFunction);
  return rows.map((row, rowIndex) => rowIndex === index
    || (subsystem && allocationKey(row.subsystem) === subsystem)
    || (fn && allocationKey(row.fromFunction) === fn)
    ? { ...row, system } : row);
}

export function reconcileTableSystems(rows, nodes, boxes, padding) {
  let result = { nodes, boxes };
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(row, 'system')) continue;
    const fn = result.nodes.find(node => node.type !== 'groupBox' && allocationKey(node.data?.label) === allocationKey(row.fromFunction));
    if (!fn) continue;
    const desired = String(row.system || '').trim();
    if (allocationKey(systemForElement(fn, result.nodes, result.boxes)) === allocationKey(desired)) continue;
    const parent = result.boxes.find(box => box.id === fn.parentNode);
    const member = parent && !isSystemGroup(parent) ? result.nodes.find(node => node.id === parent.id) : fn;
    let target = result.boxes.find(box => isSystemGroup(box) && allocationKey(box.label) === allocationKey(desired));
    if (desired && !target) {
      const absolute = absoluteElementPosition(member, result.nodes);
      let id = `g:system:${encodeURIComponent(allocationKey(desired))}`;
      const existingIds = new Set(result.boxes.map(box => box.id));
      while (existingIds.has(id)) id += ':';
      target = { id, elementType: 'system', label: desired, position: { x: absolute.x - padding.padX, y: absolute.y - padding.padTop }, width: padding.w, height: padding.h, autoGenerated: false };
      result.boxes = [...result.boxes, target];
      result.nodes = [...result.nodes, { id, type: 'groupBox', position: target.position, data: { label: desired, elementType: 'system' } }];
    }
    result = reparentSystemElements(result.nodes, result.boxes, [member.id], target?.id || null, padding);
    // Importing a direct function may clamp a negative local coordinate onto
    // an existing sibling. Keep every function visible instead of stacking them.
    if (target && member.type !== 'groupBox') {
      const moved = result.nodes.find(node => node.id === member.id);
      const rect = { ...moved.position, width: moved.width || padding.nodeWidth, height: moved.height || padding.nodeHeight };
      const siblings = result.nodes.filter(node => node.parentNode === target.id && node.id !== moved.id)
        .map(node => ({ ...node.position, width: node.width || padding.nodeWidth, height: node.height || padding.nodeHeight }));
      let blocker = siblings.find(other => diagramRectsOverlap(rect, other, 32));
      while (blocker) {
        rect.y = blocker.y + blocker.height + 48;
        blocker = siblings.find(other => diagramRectsOverlap(rect, other, 32));
      }
      result.nodes = result.nodes.map(node => node.id === moved.id ? { ...node, position: { x: rect.x, y: rect.y } } : node);
      result.boxes = fitSystemAncestors(result.nodes, result.boxes, target.id, padding);
    }
  }
  return { nodes: applyGroupGeometry(result.nodes, result.boxes), boxes: result.boxes };
}


/** Separate sibling systems using the same rectangle clearance as subsystem placement.
 * Only system origins move: all descendant coordinates and memberships stay intact.
 * A collision-free canvas returns the original array and does not relayout anything.
 */
export function separateSystemGroups(boxes) {
  const placed = [];
  let changed = false;
  const next = boxes.map(box => {
    if (!isSystemGroup(box)) return box;
    const rect = { x: box.position?.x || 0, y: box.position?.y || 0,
      width: Math.max(Number(box.width) || 420, 320), height: Math.max(Number(box.height) || 280, 180) };
    // Each step passes a blocking rectangle on one axis; movement is monotonic.
    // Therefore a blocker cannot be encountered again and the search terminates.
    let blocker = placed.find(other => diagramRectsOverlap(rect, other, GROUP_COLLISION_CLEARANCE));
    while (blocker) {
      const right = Math.ceil((blocker.x + blocker.width + GROUP_COLLISION_CLEARANCE + 1) / 16) * 16;
      const below = Math.ceil((blocker.y + blocker.height + GROUP_COLLISION_CLEARANCE + 1) / 16) * 16;
      if (right - rect.x <= below - rect.y) rect.x = right;
      else rect.y = below;
      blocker = placed.find(other => diagramRectsOverlap(rect, other, GROUP_COLLISION_CLEARANCE));
    }
    placed.push(rect);
    if (rect.x === box.position.x && rect.y === box.position.y) return box;
    changed = true;
    return { ...box, position: { x: rect.x, y: rect.y } };
  });
  return changed ? next : boxes;
}

// Close unused horizontal/vertical gaps without changing subsystem contents
// or reflowing the diagram into a new grid.
export function tightenSystemSubsystemSpacing(nodes, boxes, padding) {
  const replacements = new Map();
  const systems = new Map();
  boxes.filter(isSystemGroup).forEach(system => {
    const members = nodes.filter(node => node.parentNode === system.id);
    if (members.filter(node => boxes.some(box => box.id === node.id && !isSystemGroup(box))).length < 2) return;
    const rects = members.map(node => {
      const box = boxes.find(item => item.id === node.id);
      return { id: node.id, x: node.position.x, y: node.position.y,
        width: box?.width || node.width || padding.nodeWidth,
        height: box?.height || node.height || padding.nodeHeight };
    });
    const gap = 144;
    for (const axis of ['x', 'y']) {
      const other = axis === 'x' ? 'y' : 'x';
      const size = axis === 'x' ? 'width' : 'height';
      const otherSize = axis === 'x' ? 'height' : 'width';
      const placed = [];
      [...rects].sort((a, b) => a[axis] - b[axis]).forEach(rect => {
        rect[axis] = Math.max(axis === 'x' ? padding.padX : padding.padTop,
          ...placed.filter(prev => rect[other] < prev[other] + prev[otherSize] + gap
            && rect[other] + rect[otherSize] + gap > prev[other])
            .map(prev => prev[axis] + prev[size] + gap));
        placed.push(rect);
      });
    }
    rects.forEach(rect => replacements.set(rect.id, { x: rect.x, y: rect.y }));
    systems.set(system.id, { ...system,
      width: Math.max(padding.minW, ...rects.map(rect => rect.x + rect.width + padding.padX)),
      height: Math.max(padding.minH, ...rects.map(rect => rect.y + rect.height + padding.padBottom)),
    });
  });
  if (!systems.size) return { nodes, boxes };
  const nextBoxes = boxes.map(box => systems.get(box.id)
    || (replacements.has(box.id) ? { ...box, position: replacements.get(box.id) } : box));
  return {
    boxes: nextBoxes,
    nodes: applyGroupGeometry(nodes.map(node => replacements.has(node.id)
      ? { ...node, position: replacements.get(node.id) } : node), nextBoxes),
  };
}

// Compact the canvas around systems as whole containers. Child coordinates stay local.
export function tightenSystemSpacing(nodes, boxes, padding) {
  if (boxes.filter(isSystemGroup).length < 2) return { nodes, boxes };
  const rects = nodes.filter(node => !node.parentNode).map(node => {
    const box = boxes.find(item => item.id === node.id);
    return { id: node.id, x: node.position.x, y: node.position.y,
      width: box?.width || node.width || padding.nodeWidth,
      height: box?.height || node.height || padding.nodeHeight };
  });
  if (!rects.length) return { nodes, boxes };
  const origin = { x: Math.min(...rects.map(rect => rect.x)), y: Math.min(...rects.map(rect => rect.y)) };
  const gap = 144;
  for (const axis of ['x', 'y']) {
    const other = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'width' : 'height';
    const otherSize = axis === 'x' ? 'height' : 'width';
    const placed = [];
    [...rects].sort((a, b) => a[axis] - b[axis]).forEach(rect => {
      rect[axis] = Math.max(origin[axis], ...placed
        .filter(prev => rect[other] < prev[other] + prev[otherSize] + gap
          && rect[other] + rect[otherSize] + gap > prev[other])
        .map(prev => prev[axis] + prev[size] + gap));
      placed.push(rect);
    });
  }
  const positions = new Map(rects.map(rect => [rect.id, { x: rect.x, y: rect.y }]));
  const nextBoxes = boxes.map(box => positions.has(box.id) ? { ...box, position: positions.get(box.id) } : box);
  return { boxes: nextBoxes,
    nodes: applyGroupGeometry(nodes.map(node => positions.has(node.id)
      ? { ...node, position: positions.get(node.id) } : node), nextBoxes) };
}
