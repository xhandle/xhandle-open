export { layoutTraceDiagram } from './projectTraceLayout';

export const TRACE_NODE_LIMIT = 80;
export const TRACE_EDGE_LIMIT = 240;
export const TRACE_OBJECT_PAGE_SIZE = 20;
const containers = new Set(['systems-engineering-project', 'owning-project', 'artifact']);
const nodeName = node => node.title || node.description || node.moduleTitle || node.type || 'Linked item';
const key = parts => JSON.stringify(parts);

// Index once per loaded graph. Keep the full register available while bounding
// the amount of layout and DOM work performed for any one diagram.
export function indexProjectTrace(graph) {
  const nodes = new Map((graph.nodes || []).map(node => [node.id, node]));
  const links = new Map(), incident = new Map(), objects = new Map();
  for (const edge of graph.links || []) {
    if (!edge.from || !edge.to) continue;
    const id = edge.id || key([edge.from, edge.to, edge.type]);
    if (links.has(id)) continue;
    links.set(id, { ...edge, id });
    for (const endpoint of new Set([edge.from, edge.to])) {
      if (!nodes.has(endpoint)) nodes.set(endpoint, { id: endpoint, type: 'unavailable', title: 'Unavailable linked item' });
      if (!incident.has(endpoint)) incident.set(endpoint, []);
      incident.get(endpoint).push(id);
    }
  }
  for (const node of nodes.values()) if (node.artifactId && !node.historical && !containers.has(node.type)) {
    if (!objects.has(node.artifactId)) objects.set(node.artifactId, []);
    objects.get(node.artifactId).push(node.id);
  }
  const gaps = new Map();
  for (const gap of graph.gaps || []) for (const id of new Set([gap.artifactId, gap.objectId].filter(Boolean))) gaps.set(id, (gaps.get(id) || 0) + 1);
  return { nodes, links, incident, objects, gaps };
}

export function projectTraceLayers(index) {
  return [...new Set([...index.links.values()].map(edge => edge.type))].map(id => ({ id }));
}

// Filter relationships before aggregation, object expansion and edge limits.
// Keep documents and selected objects available as context, including when all
// relationships are hidden. Keep the original index for evidence lookup.
export function filterProjectTraceLayers(index, selectedLayers) {
  const selected = new Set(selectedLayers);
  const links = new Map([...index.links].filter(([, edge]) => selected.has(edge.type)));
  const incident = new Map([...index.incident].map(([id, edges]) => [id, edges.filter(edge => links.has(edge))]));
  return { ...index, links, incident };
}

function boundGraph(nodes, edges, extra = {}) {
  const visibleNodes = nodes.slice(0, TRACE_NODE_LIMIT), ids = new Set(visibleNodes.map(node => node.id));
  const eligibleEdges = edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  return { nodes: visibleNodes, edges: eligibleEdges.slice(0, TRACE_EDGE_LIMIT), totalNodes: nodes.length, totalEdges: edges.length,
    truncated: nodes.length > TRACE_NODE_LIMIT || eligibleEdges.length !== edges.length || edges.length > TRACE_EDGE_LIMIT, ...extra };
}

export function overviewTraceDiagram(index) {
  const projected = new Map(), groups = new Map();
  const add = (id, node, memberId) => {
    if (!groups.has(id)) groups.set(id, { ...node, id, members: [], gapCount: index.gaps.get(memberId) || 0 });
    groups.get(id).members.push(memberId);
    projected.set(memberId, id);
  };
  // Containers come first so large supporting-source sets cannot displace the
  // project and its artifacts. Historical references never become current ones.
  for (const node of index.nodes.values()) if (containers.has(node.type)) add(node.id, node, node.id);
  for (const node of index.nodes.values()) {
    if (containers.has(node.type)) continue;
    if (!node.historical && node.artifactId && index.nodes.get(node.artifactId)?.type === 'artifact') {
      projected.set(node.id, node.artifactId);
      continue;
    }
    if (node.historical) {
      const id = key(['saved-source', node.artifactId || node.id, node.revision]);
      add(id, { type: 'source-snapshot', title: node.moduleTitle || nodeName(node), revision: node.revision, historical: true }, node.id);
    } else if (node.type === 'architecture-diagram' || node.type === 'unavailable') add(node.id, node, node.id);
    else {
      const id = key(['supporting-sources', node.type, node.moduleTitle || '']);
      add(id, { type: 'supporting-sources', title: node.moduleTitle || 'Supporting sources' }, node.id);
    }
  }
  const edges = new Map();
  for (const edge of index.links.values()) {
    const from = projected.get(edge.from), to = projected.get(edge.to);
    if (!from || !to || (from === to && edge.from !== edge.to)) continue;
    const id = key([from, to, edge.type]);
    if (!edges.has(id)) edges.set(id, { id, from, to, type: edge.type, members: [] });
    edges.get(id).members.push(edge.id);
  }
  return boundGraph([...groups.values()], [...edges.values()]);
}

export function objectTraceDiagram(index, artifactId, query = '', requestedPage = 0) {
  const needle = query.trim().toLocaleLowerCase();
  const objects = (index.objects.get(artifactId) || []).filter(id => !needle || `${id} ${nodeName(index.nodes.get(id))} ${index.nodes.get(id).type}`.toLocaleLowerCase().includes(needle));
  const pageCount = Math.max(1, Math.ceil(objects.length / TRACE_OBJECT_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const seeds = objects.slice(page * TRACE_OBJECT_PAGE_SIZE, (page + 1) * TRACE_OBJECT_PAGE_SIZE);
  const ids = new Set(index.nodes.has(artifactId) ? [artifactId, ...seeds] : seeds);
  const edgeIds = new Set();
  // Expand objects, not the artifact's entire Contains fan-out.
  for (const id of seeds) for (const edgeId of index.incident.get(id) || []) {
    const edge = index.links.get(edgeId); edgeIds.add(edgeId); ids.add(edge.from); ids.add(edge.to);
  }
  const nodes = [...ids].map(id => ({ ...index.nodes.get(id), members: [id], gapCount: index.gaps.get(id) || 0 }));
  const edges = [...edgeIds].map(id => ({ ...index.links.get(id), members: [id] }));
  return boundGraph(nodes, edges, { page, pageCount, objectCount: objects.length });
}

export { nodeName as traceNodeName };
