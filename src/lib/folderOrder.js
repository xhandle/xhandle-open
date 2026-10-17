// Folder array order is persisted by the sidebar's existing storage effects.
export function moveFolder(folders, id, targetId = null, position = 'before') {
  const folder = folders.find(item => item.id === id);
  const target = folders.find(item => item.id === targetId);
  if (!folder || id === targetId || (targetId && !target)) return folders;
  const parentId = position === 'inside' && target ? target.id : target?.parentId || null;
  const byId = new Map(folders.map(item => [item.id, item]));
  const visited = new Set([id]);
  let ancestor = parentId;
  while (ancestor) {
    if (visited.has(ancestor)) return folders;
    visited.add(ancestor);
    ancestor = byId.get(ancestor)?.parentId;
  }
  const result = folders.filter(item => item.id !== id);
  const moved = (folder.parentId || null) === parentId ? folder : { ...folder, parentId };
  const index = target && position !== 'inside' ? result.findIndex(item => item.id === targetId) + (position === 'after' ? 1 : 0) : result.length;
  result.splice(index, 0, moved);
  return result;
}
