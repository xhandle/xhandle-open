import { semanticHash } from './artifactModel';

export const CODE_ABSTRACTIONS = { subsystem: 'Subsystem', csci: 'CSCI', csc: 'CSC', csu: 'CSU', functional: 'Functional' };

// Aggregate a saved graph, retaining every member and relationship as evidence.
// Prefer the captured native display allocation; retain original allocations
// separately as evidence. Older snapshots without that choice stay explicit
// about missing or ambiguous ownership.
export function abstractCodeArchitecture(snapshot, level) {
  if (!level || level === 'functional') return snapshot;
  const levels = ['subsystem', 'csci', 'csc', 'csu'];
  const nodes = new Map(), membership = new Map(), edges = new Map(), files = new Map(), allocations = new Map();
  for (const node of snapshot.nodes.filter(node => !node.group)) {
    const paths = new Map((node.displayArchitecture ? [node.displayArchitecture] : node.architectures || []).filter(path => String(path[level] || '').trim()).map(path => {
      const identity = levels.slice(0, levels.indexOf(level) + 1).map(key => [key, String(path[key] || '').trim()]);
      return [semanticHash(identity), path];
    }));
    const path = paths.size === 1 ? [...paths.values()][0] : null;
    const id = path ? `abstraction:${level}:${[...paths.keys()][0]}` : `unallocated:${level}:${node.id}`;
    if (!nodes.has(id)) nodes.set(id, { id, label: path ? String(path[level]).trim() : `${node.label} (${paths.size > 1 ? 'multiple allocations' : 'unallocated'})`,
      details: path?.descriptions?.[level] || (path ? '' : `No unambiguous ${CODE_ABSTRACTIONS[level]} allocation is recorded. The original element is retained for review.`),
      abstraction: level, ...(path ? { displayArchitecture: path } : {}), members: [], internalRelationships: [], files: [], architectures: [] });
    const group = nodes.get(id);
    group.members.push(node);
    if (!files.has(id)) { files.set(id, new Set()); allocations.set(id, new Map()); }
    for (const file of node.files || []) files.get(id).add(file);
    for (const path of node.architectures || []) allocations.get(id).set(semanticHash(path), path);
    membership.set(node.id, id);
  }
  for (const group of nodes.values()) {
    group.files = [...files.get(group.id)].sort();
    group.architectures = [...allocations.get(group.id).values()];
  }
  for (const edge of snapshot.edges) {
    const from = membership.get(edge.from), to = membership.get(edge.to);
    if (from === to) { nodes.get(from)?.internalRelationships.push(edge); continue; }
    const id = `abstraction-edge:${level}:${semanticHash([from, to])}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, label: '', details: '', relationships: [] });
    edges.get(id).relationships.push(edge);
  }
  for (const edge of edges.values()) {
    edge.label = [...new Set(edge.relationships.map(item => item.label).filter(Boolean))].join(' · ');
    edge.details = `${edge.relationships.length} saved relationships between ${CODE_ABSTRACTIONS[level]} elements.`;
  }
  return { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
