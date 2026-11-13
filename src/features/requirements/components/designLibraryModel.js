import { libraryParents } from './designLibraryHierarchy';
const isProject = item => item.recordType === 'systems-engineering-project';

// Group by stable ownership, never by document title. Legacy modules and standalone
// artifacts remain direct folder children; project members appear exactly once.
export function libraryContents(folder) {
  const modules = folder.modules || [];
  const projects = modules.filter(isProject).map(project => {
    const order = new Map((project.members || []).map((member, index) => [member.id, index]));
    return { ...project, artifacts: modules.filter(item => !isProject(item) && item.programId === project.id)
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.name.localeCompare(b.name)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const projectIds = new Set(projects.map(project => project.id));
  return { projects, items: modules.filter(item => !isProject(item) && !projectIds.has(item.programId)) };
}


export function designLibraryModel(roots) {
  const containers = new Map(), allFolders = [];
  const collect = (nodes, parentId = null) => {
    for (const folder of nodes) {
      allFolders.push({ ...folder, parentId });
      const { projects, items } = libraryContents(folder);
      containers.set(`folder:${folder.id}`, [...(folder.children || []).map(child => ({ ...child, kind: 'folder', parentId: folder.id })), ...projects.map(project => ({ ...project, kind: 'project', folderId: folder.id })), ...items.map(item => ({ ...item, kind: item.externalArtifact ? 'artifact' : 'module', folderId: folder.id }))]);
      for (const project of projects) containers.set(`project:${project.id}`, project.artifacts.map(item => ({ ...item, kind: 'artifact', folderId: folder.id })));
      collect(folder.children || [], folder.id);
    }
  };
  collect(roots); containers.set('library', roots.map(folder => ({ ...folder, kind: 'folder', parentId: null })));
  const projects = allFolders.flatMap(folder => (folder.modules || []).filter(isProject).map(project => ({ ...project, folderId: folder.id })));
  const parents = libraryParents(allFolders, projects);
  for (const folder of allFolders) {
    const parent = parents.get(`folder:${folder.id}`);
    if (!parent?.startsWith('project:') || !containers.has(parent)) continue;
    const previous = folder.parentId ? `folder:${folder.parentId}` : 'library';
    containers.set(previous, (containers.get(previous) || []).filter(item => !(item.kind === 'folder' && item.id === folder.id)));
    containers.get(parent).push({ ...folder, kind: 'folder', libraryParent: parent });
  }
  return { containers, allFolders, projects, parents };
}
