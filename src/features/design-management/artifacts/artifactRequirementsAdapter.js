import { artifactObjectText } from './artifactModel';
import { orderedObjects } from './artifactExport';
import { engineeringProjectTrace } from './engineeringProjectModel';

// Adapt canonical artifact objects for the original requirements components.
// This is a projection only: edits still publish immutable artifact revisions.
export function artifactRequirementRows(meta, revision, objects, manifest, project, draft = false, includeEvidence = true) {
  const sources = new Map();
  const entries = new Map((manifest?.entries || []).map(entry => [entry.id, entry]));
  const modules = new Map((manifest?.modules || []).map(module => [`${module.folderId}:${module.moduleId}`, module]));
  const folderNameById = { [meta.folderId]: 'Design artifacts' };
  const rows = orderedObjects(objects).map((object, order) => {
    const evidence = includeEvidence && !project ? (object.sourceEvidence || (object.sourceIds || []).map(id => entries.get(id)).filter(Boolean)) : [];
    const links = evidence.map(source => {
      const id = `${meta.id}:evidence:${object.evidenceHash || manifest?.hash || 'source'}:${source.id}`;
      const folderId = `${meta.id}:source-folder:${source.folderId || 'notes'}`;
      const module = modules.get(`${source.folderId}:${source.moduleId}`);
      folderNameById[folderId] = source.diagramId ? 'Architecture source snapshot' : module?.folderName || 'Source snapshot';
      sources.set(id, { id, folderId, projectId: folderId, module: source.diagramTitle || source.artifactTitle || module?.name || 'Source notes', title: source.title, links: [] });
      return { type: 'refines', toId: id };
    });
    return { ...object, folderId: meta.folderId, projectId: meta.folderId, moduleId: meta.id, module: meta.title,
      heading: object.kind === 'section', order, attributes: { Description: artifactObjectText(object), Kind: object.kind, ...(object.attributes || {}) },
      status: object.status || 'Proposed', version: revision?.number || 1, updatedAt: revision?.createdAt || meta.updatedAt, links,
    };
  });
  if (project) {
    const graph = project.nodes ? project : engineeringProjectTrace(project.program, project.records, draft);
    const docs = new Map((project.records || []).map(record => [record.meta.id, record.meta]));
    const outgoing = new Map();
    for (const edge of graph.links.filter(link => link.type === 'refines')) {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push({ type: 'refines', toId: edge.to });
    }
    const local = new Map(rows.map(row => [row.id, row]));
    const allRequirements = graph.nodes.filter(node => node.objectId || node.evidence || node.hasEvidence).map(node => {
      if (local.has(node.id)) return { ...local.get(node.id), links: outgoing.get(node.id) || [] };
      const doc = docs.get(node.artifactId);
      const folderId = `trace:${node.artifactId || 'source'}${node.historical ? ':snapshot' : ''}`;
      folderNameById[folderId] = node.historical ? 'Source revision snapshot' : project.projectTitle || project.program?.title;
      return { ...node, folderId, module: node.moduleTitle || node.evidence?.diagramTitle || doc?.title || 'Source evidence', links: outgoing.get(node.id) || [] };
    });
    return { rows, allRequirements, folderNameById };
  }
  return { rows, allRequirements: [...rows, ...sources.values()], folderNameById };
}

export function changeArtifactStructure(objects, id, command) {
  const object = objects.find(o => o.id === id);
  if (!object) return objects;
  if (command === 'delete') {
    const removed = new Set([id]);
    let changed = true;
    while (changed) { changed = false; for (const o of objects) if (removed.has(o.parentId) && !removed.has(o.id)) { removed.add(o.id); changed = true; } }
    return objects.map(o => removed.has(o.id) ? { ...o, deleted: true, manual: true } : o);
  }
  const ordered = orderedObjects(objects);
  const siblings = ordered.filter(o => o.parentId === object.parentId);
  const index = siblings.findIndex(o => o.id === id);
  let nextParent = object.parentId;
  if (command === 'up' || command === 'down') {
    const target = index + (command === 'up' ? -1 : 1);
    if (target < 0 || target >= siblings.length) return objects;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  } else if (command === 'promote') {
    if (!object.parentId) return objects;
    nextParent = objects.find(o => o.id === object.parentId)?.parentId || null;
  } else if (command === 'demote') {
    if (index <= 0) return objects;
    nextParent = siblings[index - 1].id;
  }
  if (nextParent !== object.parentId) {
    return objects.map(o => o.id === id ? { ...o, parentId: nextParent, order: ordered.length, manual: true } : o);
  }
  const positions = new Map(siblings.map((o, i) => [o.id, i]));
  return objects.map(o => positions.has(o.id) ? { ...o, order: positions.get(o.id), manual: true } : o);
}
