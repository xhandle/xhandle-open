import { isTextDiagram, parseReportDiagram, replaceTextDiagram } from './reportDiagramModel';
import { layoutReportDiagram } from './ReportGraphicalDiagram';

const source = '+-------+      +-------+\n| QIBUS |----->|  DBW  |\n+-------+      +-------+';
const graph = { title: 'QIBUS control', direction: 'LR', notes: [],
  nodes: [{ id: 'qibus', label: 'QIBUS coordinator' }, { id: 'dbw', label: 'ATOMS DBW' }],
  edges: [{ from: 'qibus', to: 'dbw', label: 'Vehicle Actuation Request' }, { from: 'dbw', to: 'qibus', label: 'Vehicle/control feedback' }] };

test('preserves labels, direction, and feedback relationships in graphical layout', () => {
  const layout = layoutReportDiagram(graph);
  expect(layout.nodes.map((node) => node.label)).toEqual(graph.nodes.map((node) => node.label));
  expect(layout.edges.map(({ from, to, label }) => ({ from, to, label }))).toEqual(graph.edges);
  for (const node of layout.nodes) {
    expect(Number.isFinite(node.x)).toBe(true); expect(Number.isFinite(node.y)).toBe(true);
    expect(node.x - node.width / 2).toBeGreaterThanOrEqual(0);
    expect(node.y - node.height / 2).toBeGreaterThanOrEqual(0);
    expect(node.x + node.width / 2).toBeLessThanOrEqual(layout.width);
    expect(node.y + node.height / 2).toBeLessThanOrEqual(layout.height);
  }
});

test('supports duplicate edges and self feedback without losing labels', () => {
  const layout = layoutReportDiagram({ ...graph, edges: [...graph.edges, { from: 'qibus', to: 'qibus', label: 'Supervision' }, { from: 'qibus', to: 'dbw', label: 'Safety status' }] });
  expect(layout.edges).toHaveLength(4);
  layout.edges.forEach((edge) => expect(edge.points.length).toBeGreaterThan(1));
});

test.each([
  { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
  { ...graph, edges: [{ from: 'unknown', to: 'dbw', label: 'Invalid' }] },
  { ...graph, nodes: [{ id: '__proto__', label: 'Unsafe identifier' }] },
  { ...graph, nodes: Array.from({ length: 61 }, (_, i) => ({ id: 'n' + i, label: 'Node' })) },
  { ...graph, edges: Array.from({ length: 101 }, () => graph.edges[0]) },
])('rejects invalid or excessive graph data before layout', (value) => {
  expect(() => parseReportDiagram(value)).toThrow();
});

test('recognizes existing ASCII and Unicode diagrams but leaves ordinary code alone', () => {
  expect(isTextDiagram(source, 'text')).toBe(true);
  expect(isTextDiagram('A ──Input──▶┐\n            │\n        ┌───┘\n        │ B │')).toBe(true);
  expect(isTextDiagram('const arrow = "-->";\nconst x = 1;\nconsole.log(x);', 'javascript')).toBe(false);
  expect(isTextDiagram(source.repeat(1000))).toBe(false);
});

test.each(['```text', '```', '~~~ascii'])('replaces only the matching saved diagram block: %s', (fence) => {
  const end = fence.startsWith('~') ? '~~~' : '```';
  const report = '# Report\n\n' + fence + '\n' + source + '\n' + end + '\n\n## Findings\nKeep this text.\n\n```javascript\nconst x = 1;\n```';
  const next = replaceTextDiagram(report, source, graph);
  expect(next).toContain('```xhandle-diagram');
  expect(next).not.toContain(source);
  expect(next).toContain('Keep this text.');
  expect(next).toContain('```javascript\nconst x = 1;\n```');
  expect(report).toContain(source);
});

test('supports Markdown indented diagram blocks and refuses unmatched replacements', () => {
  const report = '# Report\n\n' + source.split('\n').map((line) => '    ' + line).join('\n') + '\n\nFinal paragraph.';
  expect(replaceTextDiagram(report, source, graph)).toContain('```xhandle-diagram');
  expect(replaceTextDiagram('# Different report', source, graph)).toBeNull();
});
