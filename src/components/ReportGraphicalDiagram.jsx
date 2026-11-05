import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import dagre from 'dagre';
import { generateGraphicalReportDiagram } from './generateAgenticReport';
import { parseReportDiagram } from './reportDiagramModel';

function wrapLabel(text, max = 30) {
  const lines = [];
  for (const original of text.split('\n')) {
    let line = '';
    for (const word of original.split(/\s+/)) {
      if (line.length + word.length + 1 > max && line) { lines.push(line); line = ''; }
      if (word.length > max) {
        if (line) { lines.push(line); line = ''; }
        for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max));
      } else line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function layoutReportDiagram(input) {
  const diagram = parseReportDiagram(input);
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: diagram.direction, ranksep: 110, nodesep: 45, edgesep: 30, marginx: 30, marginy: 30 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of diagram.nodes) {
    const lines = wrapLabel(node.label);
    graph.setNode(node.id, { ...node, lines, width: Math.max(150, Math.max(...lines.map((line) => line.length)) * 7.5 + 32), height: Math.max(64, lines.length * 19 + 24) });
  }
  diagram.edges.forEach((edge, index) => {
    const lines = wrapLabel(edge.label, 26);
    graph.setEdge(edge.from, edge.to, { ...edge, lines, width: lines.length ? Math.max(...lines.map((line) => line.length)) * 6.8 + 12 : 0, height: lines.length * 17 + 8 }, String(index));
  });
  dagre.layout(graph);
  return { ...diagram, width: graph.graph().width, height: graph.graph().height,
    nodes: diagram.nodes.map((node) => graph.node(node.id)),
    edges: graph.edges().map((edge) => graph.edge(edge)) };
}

export function ReportGraphicalDiagram({ diagram }) {
  const layout = useMemo(() => layoutReportDiagram(diagram), [diagram]);
  const marker = 'report-arrow-' + useId().replace(/[^a-z0-9_-]/gi, '');
  return <figure className="my-5 rounded-xl border border-slate-200 bg-white p-3" aria-label={layout.title}>
    <figcaption className="mb-3 text-sm font-semibold text-slate-800">{layout.title}</figcaption>
    <svg role="img" aria-label={layout.title} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ display: 'block', width: '100%', height: 'auto', maxWidth: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <title>{layout.title}</title>
      <defs><marker id={marker} markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M 0 0 L 10 4 L 0 8 Z" fill="#2d5c9e" /></marker></defs>
      {layout.edges.map((edge, index) => <g key={index}>
        <polyline points={edge.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2d5c9e" strokeWidth="1.8" markerEnd={`url(#${marker})`} />
        {edge.label && <g><rect x={edge.x - edge.width / 2} y={edge.y - edge.height / 2} width={edge.width} height={edge.height} fill="white" rx="4" />
          <text x={edge.x} y={edge.y - (edge.lines.length - 1) * 8.5} textAnchor="middle" dominantBaseline="central" fontSize="12" fill="#334155">{edge.lines.map((line, i) => <tspan key={i} x={edge.x} dy={i ? 17 : 0}>{line}</tspan>)}</text>
        </g>}
      </g>)}
      {layout.nodes.map((node) => <g key={node.id} aria-label={node.label}>
        <title>{node.label}</title><rect x={node.x - node.width / 2} y={node.y - node.height / 2} width={node.width} height={node.height} rx="10" fill="#eff6ff" stroke="#8cadd8" strokeWidth="1.5" />
        <text x={node.x} y={node.y - (node.lines.length - 1) * 9.5} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="600" fill="#17375e">{node.lines.map((line, i) => <tspan key={i} x={node.x} dy={i ? 19 : 0}>{line}</tspan>)}</text>
      </g>)}
    </svg>
    {layout.notes.length > 0 && <ul className="mt-3 text-xs text-amber-800">{layout.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
  </figure>;
}

export function ConvertReportDiagram({ source, onConverted }) {
  const [diagram, setDiagram] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const convert = async () => {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    let rendered = diagram;
    try {
      const result = diagram || await generateGraphicalReportDiagram(source, { signal: abort.signal });
      if (abort.signal.aborted) return;
      setDiagram(result);
      rendered = result;
      if (onConverted) await onConverted(result);
    } catch {
      if (!abort.signal.aborted) setError(rendered ? 'The diagram is displayed, but its saved report version could not be created. Retry saving.' : 'The diagram could not be converted. Please check your AI provider settings and retry.');
    } finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <div className="my-4">
    {diagram ? <ReportGraphicalDiagram diagram={diagram} /> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <button type="button" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={busy} onClick={convert}>{busy ? 'Creating graphical diagram…' : 'Render as graphical diagram'}</button>
      <details className="mt-2 text-xs text-slate-500"><summary>Original diagram</summary><pre className="overflow-auto whitespace-pre">{source}</pre></details>
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error} <button type="button" className="underline" disabled={busy} onClick={convert}>Retry</button></p>}
  </div>;
}
