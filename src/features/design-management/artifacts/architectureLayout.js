import dagre from 'dagre';
const lines = value => String(value || '').match(/.{1,28}(?:\s|$)|.{1,28}/g) || [''];
const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
export function layoutArchitecture(diagram) {
  const model = diagram.snapshot;
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', ranksep: 130, nodesep: 65, marginx: 25, marginy: 25 }); graph.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(model.nodes.map(node => node.id));
  model.nodes.forEach(node => graph.setNode(node.id, { ...node, lines: lines(node.label), width: 210, height: Math.max(70, lines(node.label).length * 18 + 24) }));
  const edges = [...model.edges.map(edge => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label })), ...model.nodes.filter(node => node.parentId && ids.has(node.parentId)).map(node => ({ id: `contains:${node.id}`, source: node.parentId, target: node.id, label: 'contains', containment: true }))];
  edges.forEach(edge => graph.setEdge(edge.source, edge.target, { ...edge, width: Math.max(120, ...lines(edge.label).map(line => line.length * 7 + 16)), height: Math.max(20, lines(edge.label).length * 15), lines: lines(edge.label) }, edge.id)); dagre.layout(graph);
  return { width: graph.graph().width, height: graph.graph().height, nodes: model.nodes.map(node => graph.node(node.id)), edges: graph.edges().map(edge => graph.edge(edge)) };
}
export function architectureSVG(diagram, layout = layoutArchitecture(diagram)) {
  const label = (value, x, y, height = 18) => `<text x="${x}" y="${y}" text-anchor="middle" fill="#172554" font-family="sans-serif" font-size="12">${value.map((line, index) => `<tspan x="${x}" dy="${index ? height : 0}">${xml(line)}</tspan>`).join('')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><title>${xml(diagram.title)}</title><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8Z" fill="#64748b"/></marker></defs>${layout.edges.map(edge => `<polyline points="${edge.points.map(point => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="#64748b" stroke-width="1.5" ${edge.containment ? 'stroke-dasharray="4 4"' : ''} marker-end="url(#arrow)"/><rect x="${edge.x - edge.width / 2}" y="${edge.y - edge.height / 2 - 8}" width="${edge.width}" height="${edge.height + 10}" fill="white"/>${label(edge.lines, edge.x, edge.y - edge.height / 2 + 5, 15)}`).join('')}${layout.nodes.map(node => `<rect x="${node.x - node.width / 2}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}" rx="8" fill="${node.group ? '#e0e7ff' : '#f8fafc'}" stroke="#94a3b8"/>${label(node.lines, node.x, node.y - (node.lines.length - 1) * 9 + 4)}`).join('')}</svg>`;
}
