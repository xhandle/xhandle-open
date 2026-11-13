import { libraryParents, libraryDescendants, folderProject } from './designLibraryHierarchy';
export const LIBRARY_DRAG = 'application/x-xhandle-design-library';
export const LIBRARY_ORDER = 'xhandle:design-library-order';
export const libraryNodeKey = item => `${item.kind}:${item.id}`;
export const libraryContainer = item => item.libraryParent || (item.kind === 'folder' ? (item.parentId ? `folder:${item.parentId}` : 'library') : item.programId ? `project:${item.programId}` : `folder:${item.folderId}`);
export function orderLibraryItems(items, order = []) {
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...items].sort((a, b) => (rank.get(libraryNodeKey(a)) ?? Infinity) - (rank.get(libraryNodeKey(b)) ?? Infinity));
}
export function libraryDrop(item, target, position, folders) {
  if (!item || (item.id === target?.id && item.kind === target.kind)) return null;
  const container = !target ? 'library' : position === 'inside' ? (target.kind === 'folder' ? `folder:${target.id}` : target.kind === 'project' ? `project:${target.id}` : null) : libraryContainer(target);
  if (!container || (container === 'library' && item.kind !== 'folder')) return null;
  if (container.startsWith('project:')) {
    if (!['artifact', 'folder'].includes(item.kind) || (item.programId && `project:${item.programId}` !== container)) return null;
  } // Folder placement is independent of project membership.
  const folderId = container.startsWith('folder:') ? container.slice(7) : null;
  const projects = folders.flatMap(folder => (folder.modules || []).filter(record => record.recordType === 'systems-engineering-project').map(project => ({ ...project, folderId: folder.id })));
  const parents = libraryParents(folders, projects);
  if (['folder', 'project'].includes(item.kind) && libraryDescendants(parents, libraryNodeKey(item)).has(container)) return null;
  const owner = folderId && folderProject(folderId, folders, projects);
  if (owner && (item.kind === 'project' || (item.programId && item.programId !== owner))) return null;
  return { container, folderId, ...(container.startsWith('project:') ? { programId: container.slice(8) } : {}), anchor: target && position !== 'inside' ? libraryNodeKey(target) : null, position };
}
export function reorderedKeys(keys, item, placement) {
  const key = libraryNodeKey(item), next = keys.filter(value => value !== key);
  const anchor = placement.anchor ? next.indexOf(placement.anchor) : -1;
  next.splice(anchor < 0 ? next.length : anchor + (placement.position === 'after' ? 1 : 0), 0, key);
  return next;
}
