export const REPORT_DIAGRAM_LANGUAGE = 'xhandle-diagram';
export const reportDiagramSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, direction: { type: 'string', enum: ['LR', 'TB'] },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] } },
    edges: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to', 'label'] } },
    notes: { type: 'array', items: { type: 'string' } },
  }, required: ['title', 'direction', 'nodes', 'edges', 'notes'],
};

export const REPORT_DIAGRAM_INSTRUCTIONS = `For any additional diagram you create, use a fenced ${REPORT_DIAGRAM_LANGUAGE} block containing one valid JSON object matching this schema: ${JSON.stringify(reportDiagramSchema)}.
Use ordinary boxes and directed arrows, never ASCII art, Unicode box drawing, Mermaid, raw SVG, or HTML diagrams. Use at most 60 nodes and 100 edges per diagram; split larger views into separate focused diagrams. Use short identifiers such as n1, n2; keep labels under 200 characters. Preserve supplied names, directions, and relationship labels. Do not invent missing relationships. Leave the existing [[FUNCTIONAL_DIAGRAM_PLACEHOLDER]] intact for the captured project diagram.`;

export function parseReportDiagram(value) {
  if (typeof value === 'string' && value.length > 100000) throw new Error('Diagram source is too large');
  const diagram = typeof value === 'string' ? JSON.parse(value) : value;
  if (!diagram || typeof diagram.title !== 'string' || !diagram.title.trim() || diagram.title.length > 160 || !['LR', 'TB'].includes(diagram.direction) ||
    !Array.isArray(diagram.nodes) || !diagram.nodes.length || diagram.nodes.length > 60 ||
    !Array.isArray(diagram.edges) || diagram.edges.length > 100) throw new Error('Invalid diagram structure');
  const ids = new Set();
  const nodes = diagram.nodes.map((node) => {
    if (!node || typeof node.id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(node.id) || ['__proto__', 'constructor', 'prototype'].includes(node.id) || ids.has(node.id) ||
      typeof node.label !== 'string' || !node.label.trim() || node.label.length > 200) throw new Error('Invalid diagram node');
    ids.add(node.id); return { id: node.id, label: node.label };
  });
  const edges = diagram.edges.map((edge) => {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || typeof edge.label !== 'string' || edge.label.length > 200) throw new Error('Invalid diagram relationship');
    return { from: edge.from, to: edge.to, label: edge.label };
  });
  const notes = diagram.notes ?? [];
  if (!Array.isArray(notes) || notes.length > 8 || notes.some((note) => typeof note !== 'string' || note.length > 300)) throw new Error('Invalid diagram notes');
  return { title: diagram.title, direction: diagram.direction, nodes, edges, notes };
}

export function isTextDiagram(source, language = '') {
  if (source.length > 16000) return false;
  if (['mermaid', 'dot', 'graphviz'].includes(language)) return true;
  if (language && !['text', 'plaintext', 'ascii', 'diagram'].includes(language)) return false;
  return source.split('\n').length >= 3 && (
    (/[┌┐└┘┬┴┼│]/.test(source) && /[─━→▶▼]/.test(source)) ||
    (/^\s*\+[-=]{2,}\+/m.test(source) && /(?:--+>|<--+|\|)/.test(source))
  );
}

export function replaceTextDiagram(markdown, source, diagram) {
  const replacement = `\`\`\`${REPORT_DIAGRAM_LANGUAGE}\n${JSON.stringify(parseReportDiagram(diagram), null, 2)}\n\`\`\``;
  let replaced = false;
  const next = markdown.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\2(?=\s*(?:\n|$))/g, (block, prefix, fence, content) => {
    if (content.trim() !== source.trim()) return block;
    replaced = true; return prefix + replacement;
  });
  if (replaced) return next;
  // Markdown also permits code blocks indented by four spaces or a tab.
  const lines = markdown.split('\n');
  for (let start = 0; start < lines.length; start++) {
    if (!/^(?: {4}|\t)/.test(lines[start])) continue;
    let end = start;
    while (end < lines.length && (/^(?: {4}|\t)/.test(lines[end]) || !lines[end].trim())) end++;
    const content = lines.slice(start, end).map((line) => line.replace(/^(?: {4}|\t)/, '')).join('\n').trim();
    if (content === source.trim()) return [...lines.slice(0, start), replacement, '', ...lines.slice(end)].join('\n');
    start = end - 1;
  }
  return null;
}
