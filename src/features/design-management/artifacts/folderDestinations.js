import { libraryParents } from '../../requirements/components/designLibraryHierarchy';

// Show the displayed hierarchy, including project containers.
export function folderDestinations(folders, projects = []) {
  const parents = libraryParents(folders, projects);
  const namesByKey = new Map([...folders.map(folder => [`folder:${folder.id}`, folder.name]), ...projects.map(project => [`project:${project.id}`, project.title || project.name])]);
  return folders.map(folder => {
    const names = [], seen = new Set();
    for (let key = `folder:${folder.id}`; namesByKey.has(key) && !seen.has(key); key = parents.get(key)) {
      seen.add(key); names.unshift(namesByKey.get(key));
    }
    return { ...folder, path: names.join(' / ') };
  });
}
