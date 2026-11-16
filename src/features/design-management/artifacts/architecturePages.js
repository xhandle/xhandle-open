import { codeDisplayDiagram } from './codeArchitectureDisplay';
// Presentation only: the saved graph, element identities and evidence are unchanged.
export const ARCHITECTURE_PAGE_NODES = 120;
export const ARCHITECTURE_PAGE_EDGES = 60;

export function architecturePages(diagram) {
  if (diagram.workspaceType === 'code-architecture') diagram = codeDisplayDiagram(diagram);
  const { nodes } = diagram.snapshot;
  let edges = diagram.snapshot.edges;
  // Coarse abstractions already collapse implementation detail. Keep manageable
  // graphs together so the native canvas can reproduce the source layout.
  if (['subsystem', 'csci', 'csc'].includes(diagram.abstraction)) {
    const relationshipCount = edges.reduce((count, edge) => count + (edge.relationships?.length || 1), 0);
    if (nodes.length <= 500 && relationshipCount <= 1000) return [diagram];
    // A small number of coarse bundles can contain thousands of relationships.
    // Bound the actual rendered edges while retaining their projected endpoints
    // and the exact aggregate evidence used by inspection and focus navigation.
    const owners = { ...diagram.displayOwners };
    edges = edges.flatMap(edge => (edge.relationships?.length ? edge.relationships : [edge]).map(relationship => {
      owners[relationship.id] = diagram.displayOwners?.[edge.id] || edge.id;
      return { ...relationship, from: edge.from, to: edge.to };
    }));
    diagram = { ...diagram, displayOwners: owners };
  }
  if (diagram.workspaceType !== 'code-architecture' || (nodes.length <= ARCHITECTURE_PAGE_NODES && edges.length <= ARCHITECTURE_PAGE_EDGES)) return [diagram];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const covered = new Set(), pages = [];
  let pageNodes = new Map(), pageEdges = [];
  const flush = () => {
    if (!pageNodes.size && !pageEdges.length) return;
    pages.push({ ...diagram, snapshot: { ...diagram.snapshot, nodes: [...pageNodes.values()], edges: pageEdges } });
    pageNodes = new Map(); pageEdges = [];
  };
  const family = id => {
    const result = new Set();
    while (byId.has(id) && !result.has(id)) { result.add(id); id = byId.get(id).parentId; }
    return result;
  };
  const add = id => {
    for (const member of family(id)) { pageNodes.set(member, byId.get(member)); covered.add(member); }
  };
  const missingCount = ids => { let count = 0; for (const id of ids) if (!pageNodes.has(id)) count++; return count; };
  for (const edge of edges) {
    const missing = missingCount(new Set([...family(edge.from), ...family(edge.to)]));
    if (pageEdges.length >= ARCHITECTURE_PAGE_EDGES || pageNodes.size + missing > ARCHITECTURE_PAGE_NODES) flush();
    add(edge.from); add(edge.to); pageEdges.push(edge);
  }
  flush();
  // Include boundaries and isolated elements too; nothing is silently omitted.
  for (const node of nodes.filter(node => !node.group)) if (!covered.has(node.id)) {
    if (pageNodes.size + missingCount(family(node.id)) > ARCHITECTURE_PAGE_NODES) flush();
    add(node.id);
  }
  flush();
  return pages.map((page, index) => ({ ...page, id: `${diagram.id}:view:${index + 1}`, title: `${diagram.title} — View ${index + 1} of ${pages.length}` }));
}

export function architecturePageForElement(pages, id) {
  return Math.max(0, pages.findIndex(page => [...page.snapshot.nodes, ...page.snapshot.edges].some(item => item.id === id || page.displayOwners?.[item.id] === id)));
}
