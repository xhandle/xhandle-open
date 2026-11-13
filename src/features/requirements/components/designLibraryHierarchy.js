// Folder attachment belongs to the project record, so adopting a folder and its
// artifacts can be committed together. The original folder parent is retained
// as a fallback if the project is deleted.
export function libraryParents(folders, projects) {
  const parents = new Map(folders.map(folder => [`folder:${folder.id}`, folder.parentId ? `folder:${folder.parentId}` : 'library']));
  for (const project of projects.filter(project => !project.deleted)) {
    const key = `project:${project.id}`;
    parents.set(key, `folder:${project.folderId}`);
    for (const id of project.libraryFolderIds || []) if (parents.has(`folder:${id}`)) parents.set(`folder:${id}`, key);
  }
  return parents;
}

export function libraryDescendants(parents, key) {
  const result = new Set([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of parents) if (result.has(parent) && !result.has(child)) { result.add(child); changed = true; }
  }
  return result;
}

export function folderProject(folderId, folders, projects) {
  const parents = libraryParents(folders, projects), seen = new Set();
  let key = `folder:${folderId}`;
  while (key && !seen.has(key)) {
    if (key.startsWith('project:')) return key.slice(8);
    seen.add(key); key = parents.get(key);
  }
  return null;
}
