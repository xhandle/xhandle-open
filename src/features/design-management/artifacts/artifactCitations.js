import { architectureDraftingElement, architectureContextTitle } from './architectureDraftingContext';
// Model-facing references are short and local to this request. Persist only the
// canonical IDs from the exact saved manifest; never guess a source by title.
export function citationContext(sources) {
  const entries = sources.entries.filter(entry => entry.sourceType !== 'project');
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const rowKey = entry => JSON.stringify([entry.folderId, entry.moduleId, entry.rowId]);
  const byRow = new Map(entries.filter(entry => entry.rowId).map(entry => [rowKey(entry), entry]));
  const nodeIndexes = new Map();
  const canonical = new Set(byId.keys());
  let prefix = 'S';
  const collides = prefix => entries.some((_, index) => canonical.has(`${prefix}${index + 1}`));
  while (collides(prefix)) prefix += 'S';
  const aliases = new Map(entries.map((entry, index) => [`${prefix}${index + 1}`, entry.id]));
  const evidence = entry => {
    const { text, sourceType, kind, status, evidenceIssue, attributes, content, artifactTitle, revision, diagramTitle, level, abstraction, focus, heading, order } = entry;
    const module = sources.modules?.find(module => module.folderId === entry.folderId && module.moduleId === entry.moduleId);
    const parent = entry.parentId && byRow.get(rowKey({ ...entry, rowId: entry.parentId }));
    const candidate = byId.get(entry.diagramId);
    const diagram = candidate?.diagramHash === entry.diagramHash ? candidate : null;
    if (diagram?.snapshot && !nodeIndexes.has(diagram)) nodeIndexes.set(diagram, { nodes: new Map(diagram.snapshot.nodes.map(node => [node.id, node])) });
    const nodes = nodeIndexes.get(diagram);
    const scopedElement = architectureDraftingElement(entry, nodes);
    const element = scopedElement || (entry.element && {
      label: entry.element.label, withinBoundary: nodes?.nodes.get(entry.element.parentId)?.label, details: entry.element.details, files: entry.element.files, architectures: entry.element.architectures,
      members: entry.element.members?.map(member => ({ label: member.label, details: member.details, files: member.files })),
      supportingRelationships: (entry.element.relationships || entry.element.internalRelationships)?.map(edge => ({ from: edge.row?.fromFunction, to: edge.row?.toFunction, label: edge.label, details: edge.details })),
      relationship: entry.element.row && Object.fromEntries(Object.entries(entry.element.row).filter(([key]) => !/(?:id|hash|lineage|sourceRefs)$/i.test(key))),
    });
    return { title: architectureContextTitle(entry), text, sourceType, kind, status, evidenceIssue, attributes, content, artifactTitle, revision, diagramTitle, level, abstraction, focus, heading, order, element,
      ...(parent ? { parentHeading: parent.title } : {}),
      ...(entry.sourceRefs?.length ? { supportingReferences: entry.sourceRefs.map(reference => typeof reference === 'string' ? reference : { title: reference.title || reference.name, description: reference.description, url: reference.url || reference.href }) } : {}),
      ...(module ? { module: module.name, folder: module.folderName } : {}),
      // Preserve architectural constraints and code details during evidence review.
      // Nested records are supporting context, never additional citation IDs.
      ...(entry.architectureEvidence?.length ? { architectureEvidence: entry.architectureEvidence.map(evidence) } : {}),
    };
  };
  return {
    sources: entries.map((entry, index) => ({ ...evidence(entry), id: `${prefix}${index + 1}` })),
    resolve(response) {
      if (!Array.isArray(response?.objects)) return response;
      return { ...response, objects: response.objects.map(object => !object || !Array.isArray(object.sourceIds) ? object : { ...object, sourceIds: object.sourceIds.map(id => aliases.get(id) || id) }) };
    },
  };
}

// Only well-formed citation lists qualify for recovery. Malformed objects still
// fail normal validation; no invalid reference is retained as a trace link.
export function unresolvedCitationGaps(response, allowed) {
  const issues = new Map();
  const objects = response.objects.map(object => {
    if (!object || !Array.isArray(object.sourceIds) || object.sourceIds.length > 100 || object.sourceIds.some(id => typeof id !== 'string')) return object;
    const missing = object.sourceIds.filter(id => !allowed.has(id));
    if (!missing.length) return object;
    issues.set(object.key, { evidenceIssue: 'unknown-citation', proposedKind: object.kind, unresolvedCitationCount: new Set(missing).size });
    return { ...object, kind: 'gap', sourceIds: object.sourceIds.filter(id => allowed.has(id)) };
  });
  return { response: { ...response, objects }, issues };
}
