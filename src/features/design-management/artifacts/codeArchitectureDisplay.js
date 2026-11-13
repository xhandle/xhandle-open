const levels = ['subsystem', 'csci', 'csc', 'csu'];
const limitLabel = value => String(value || '').slice(0, 240);

// CSU uses the same function-inside-unit presentation as the source workspace.
// Expand only the display graph; immutable aggregate evidence stays unchanged.
export function codeDisplayDiagram(diagram) {
  if (diagram.abstraction !== 'csu' || !diagram.snapshot.nodes.some(node => node.members?.length)) return diagram;
  const nodes = new Map(), edges = new Map(), owners = {};
  for (const node of diagram.snapshot.nodes) {
    for (const member of node.members || [node]) { nodes.set(member.id, member); owners[member.id] = node.id; }
    for (const edge of node.internalRelationships || []) { edges.set(edge.id, edge); owners[edge.id] = node.id; }
  }
  for (const aggregate of diagram.snapshot.edges) for (const edge of aggregate.relationships || [aggregate]) { edges.set(edge.id, edge); owners[edge.id] = aggregate.id; }
  return { ...diagram, displayOwners: owners, snapshot: { ...diagram.snapshot, nodes: [...nodes.values()], edges: [...edges.values()] } };
}

function allocation(node, level) {
  const path = node.displayArchitecture || node.architectures?.[0];
  // Unknown allocation stays explicitly unknown, never a claimed default system.
  if (!path || node.id.startsWith('unallocated:')) return Object.fromEntries(levels.map(key => [key, `Unallocated — ${node.label}`]));
  if (!['subsystem', 'csci', 'csc'].includes(level)) return path;
  return { ...Object.fromEntries(levels.map((key, index) => [key, index <= levels.indexOf(level) ? path[key] : node.label])), descriptions: path.descriptions };
}

export function codeArchitectureDisplay(diagram) {
  const allNodes = new Map(diagram.snapshot.nodes.map(node => [node.id, node]));
  const nodes = new Map(diagram.snapshot.nodes.filter(node => !node.group).map(node => [node.id, node]));
  const rows = [], included = new Set(), nodeSources = new Map(), edgeSources = new Map();
  const coarse = ['subsystem', 'csci', 'csc'].includes(diagram.abstraction);
  const owner = id => diagram.displayOwners?.[id] || id;
  for (const node of nodes.values()) {
    nodeSources.set(node.id, owner(node.id));
    const path = allocation(node, diagram.abstraction);
    for (const level of levels.filter(level => level === diagram.abstraction)) {
      const key = levels.slice(0, levels.indexOf(level) + 1).map(key => path[key]).join('::');
      nodeSources.set(`box:${level}:${key}`, owner(node.id));
    }
    // Functional snapshots include explicit group evidence. Map a container to
    // that group, never arbitrarily to the last function rendered inside it.
    let parent = allNodes.get(node.parentId);
    const visited = new Set();
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      if (levels.includes(parent.groupType)) {
        const key = levels.slice(0, levels.indexOf(parent.groupType) + 1).map(key => path[key]).join('::');
        nodeSources.set(`box:${parent.groupType}:${key}`, parent.id);
      }
      parent = allNodes.get(parent.parentId);
    }
  }
  const endpoint = (node, side) => ({ [`${side}NodeId`]: node.id, [`${side}Function`]: node.label, [`${side}Details`]: node.details || '', [`${side}File`]: node.files?.[0] || '', [`${side}Architecture`]: allocation(node, diagram.abstraction) });
  for (const edge of diagram.snapshot.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to) continue;
    const row = { ...endpoint(from, 'from'), ...endpoint(to, 'to'), edgeId: edge.nativeId || edge.row?.edgeId || edge.id, traceId: edge.id, controlAction: limitLabel(edge.label), controlDetails: edge.details || '',
      ...(coarse && edge.relationships ? { architectureRelationshipCount: edge.relationships.length, architectureLabels: [...new Set(edge.relationships.map(item => item.label).filter(Boolean))].slice(0, 3).map(limitLabel) } : {}),
      ...(edge.row?.functionalModel ? { functionalModel: { kind: edge.row.functionalModel.kind, significance: edge.row.functionalModel.significance, internal: edge.row.functionalModel.internal } } : {}) };
    rows.push(row); included.add(from.id); included.add(to.id); edgeSources.set(row.edgeId, owner(edge.id));
    if (coarse) {
      const key = side => levels.slice(0, levels.indexOf(diagram.abstraction) + 1).map(key => row[`${side}Architecture`][key]).join('::');
      edgeSources.set(`aggregate:${diagram.abstraction}:box:${diagram.abstraction}:${key('from')}->box:${diagram.abstraction}:${key('to')}`, edge.id);
    }
  }
  for (const node of nodes.values()) if (!included.has(node.id)) rows.push({ ...endpoint(node, 'from'), toFunction: '', controlAction: '', traceId: `isolated:${node.id}` });
  return { rows, nodeSources, edgeSources, abstraction: coarse ? diagram.abstraction : 'detailed', functionalPresentation: diagram.abstraction === 'functional', snapshot: diagram.snapshot.codeNative || { positions: [], notes: [], comments: [], routing: {} } };
}
