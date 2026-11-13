// Presentation changes never alter source identities, relationships or ownership.
const size = node => ({ width: Number(node.width || node.style?.width) || 240, height: Number(node.height || node.style?.height) || 96 });

export function arrangedNodes(nodes, geometry = {}) {
  const mapped = nodes.map(node => {
    const patch = geometry[node.id] || {};
    return { ...node, ...patch, parentNode: patch.parentNode === null ? undefined : patch.parentNode ?? node.parentNode,
      extent: undefined, expandParent: false,
      style: { ...node.style, ...(patch.width ? { width: patch.width, height: patch.height } : {}) } };
  });
  const byId = new Map(mapped.map(node => [node.id, node])), seen = new Set(), result = [];
  function visit(node) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (byId.has(node.parentNode)) visit(byId.get(node.parentNode));
    result.push(node);
  }
  mapped.forEach(visit);
  return result;
}

export function absolutePosition(node, nodes) {
  const byId = new Map(nodes.map(item => [item.id, item]));
  const seen = new Set();
  const point = { x: 0, y: 0 };
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    point.x += node.position?.x || 0;
    point.y += node.position?.y || 0;
    node = byId.get(node.parentNode);
  }
  return point;
}

export function changeArrangement(nodes, geometry, changes, fitParents = true) {
  const next = { ...geometry };
  changes.forEach(({ id, ...patch }) => { next[id] = { ...next[id], ...patch }; });
  if (!fitParents) return next;
  const arranged = arrangedNodes(nodes, next);
  const children = new Map();
  arranged.forEach(node => {
    if (!node.parentNode) return;
    if (!children.has(node.parentNode)) children.set(node.parentNode, []);
    children.get(node.parentNode).push(node);
  });
  // Children precede their parents here, so nested containers grow in one pass.
  [...arranged].reverse().forEach(parent => {
    const group = children.get(parent.id);
    if (!group?.length) return;
    const dx = Math.min(0, ...group.map(child => child.position.x - 16));
    const dy = Math.min(0, ...group.map(child => child.position.y - 40));
    if (dx || dy) {
      parent.position = { x: parent.position.x + dx, y: parent.position.y + dy };
      group.forEach(child => {
        child.position = { x: child.position.x - dx, y: child.position.y - dy };
        next[child.id] = { ...next[child.id], position: child.position };
      });
    }
    const old = size(parent);
    parent.width = Math.max(old.width - dx, ...group.map(child => child.position.x + size(child).width + 16));
    parent.height = Math.max(old.height - dy, ...group.map(child => child.position.y + size(child).height + 16));
    if (dx || dy || parent.width !== old.width || parent.height !== old.height) {
      next[parent.id] = { ...next[parent.id], position: parent.position, width: parent.width, height: parent.height };
    }
  });
  return next;
}

export function reparentArrangement(nodes, geometry, selectedIds, targetId = null) {
  const arranged = arrangedNodes(nodes, geometry), byId = new Map(arranged.map(node => [node.id, node]));
  const selected = new Set(selectedIds);
  const ancestorSelected = node => {
    const seen = new Set();
    while (node?.parentNode && !seen.has(node.parentNode)) {
      seen.add(node.parentNode);
      if (selected.has(node.parentNode)) return true;
      node = byId.get(node.parentNode);
    }
    return false;
  };
  const target = byId.get(targetId);
  if (targetId && (!target || selected.has(targetId) || ancestorSelected(target))) return geometry;
  const origin = target ? absolutePosition(target, arranged) : { x: 0, y: 0 };
  const changes = arranged.filter(node => selected.has(node.id) && !ancestorSelected(node)).map(node => {
    const point = absolutePosition(node, arranged);
    return { id: node.id, parentNode: targetId, position: { x: point.x - origin.x, y: point.y - origin.y } };
  });
  return changeArrangement(nodes, geometry, changes);
}

export function arrangeInGroups(nodes, geometry) {
  const arranged = arrangedNodes(nodes, geometry), groups = new Map(), changes = [];
  arranged.forEach(node => {
    const key = node.parentNode || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  });
  const byId = new Map(arranged.map(node => [node.id, node]));
  [...groups.entries()].reverse().forEach(([parentId, children]) => {
    const columns = Math.ceil(Math.sqrt(children.length));
    let y = parentId ? 40 : 0, x = parentId ? 16 : 0, rowHeight = 0, width = 0;
    children.forEach((node, index) => {
      if (index && index % columns === 0) { y += rowHeight + 48; x = parentId ? 16 : 0; rowHeight = 0; }
      const dimensions = size(node);
      changes.push({ id: node.id, position: { x, y } });
      width = Math.max(width, x + dimensions.width + 16);
      x += dimensions.width + 48;
      rowHeight = Math.max(rowHeight, dimensions.height);
    });
    const parent = byId.get(parentId);
    if (parent) {
      parent.width = width; parent.height = y + rowHeight + 16;
      changes.push({ id: parent.id, width: parent.width, height: parent.height });
    }
  });
  return changeArrangement(nodes, geometry, changes);
}
