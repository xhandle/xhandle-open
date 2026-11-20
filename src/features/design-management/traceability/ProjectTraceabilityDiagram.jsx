import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, BaseEdge, Controls, EdgeText, Handle, MarkerType, MiniMap, Position, ReactFlowProvider, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import { relationshipLabel } from '../artifacts/SourceEvidenceDetails';
import { readableLabel } from '../../requirements/components/readableValues';
import { getTemplate } from '../artifacts/artifactModel';
import { indexProjectTrace, projectTraceLayers, filterProjectTraceLayers, overviewTraceDiagram, objectTraceDiagram, layoutTraceDiagram, traceNodeName } from './projectTraceDiagram';
import { TRACE_ICON_LEFT, TRACE_ICON_RIGHT, TRACE_ICON_Y, TRACE_ITEM_WIDTH, TRACE_ITEM_HEIGHT, traceRoutePath } from './projectTraceLayout';
import TraceArtifactIcon from './TraceArtifactIcon';
import TraceLayersDropdown from './TraceLayersDropdown';
import './projectTraceDiagram.css';

const typeNames = { 'systems-engineering-project': 'Project', 'owning-project': 'Source project', 'architecture-diagram': 'Source diagram',
  'supporting-sources': 'Supporting sources', 'source-snapshot': 'Saved source', 'hazard-tracking-record': 'HTR', 'architecture-element': 'Architecture element', unavailable: 'Unavailable reference' };
const canOpen = node => node && (node.hasEvidence || (!node.historical && (node.artifactId || node.type === 'artifact')));
function TraceNode({ data, selected }) {
  return <div className={`project-trace-node kind-${data.kind}${selected ? ' is-selected' : ''}${data.historical ? ' is-historical' : ''}`}>
    <Handle type="target" position={Position.Left} id="in" style={{ top: TRACE_ICON_Y, left: TRACE_ICON_LEFT }} />
    <Handle type="source" position={Position.Right} id="out" style={{ top: TRACE_ICON_Y, left: TRACE_ICON_RIGHT, right: 'auto' }} />
    {data.openable ? <button className="project-trace-symbol nodrag nopan" title={data.label} aria-label={`Open ${data.label}`} onClick={event => { event.stopPropagation(); data.open(); }}>
      <TraceArtifactIcon node={data.node} metadata={data.metadata} /><span className="project-trace-label">{data.label}</span>
    </button> : <div className="project-trace-symbol" title={data.label}><TraceArtifactIcon node={data.node} metadata={data.metadata} /><strong className="project-trace-label">{data.label}</strong></div>}
    <div className="project-trace-node-kind">{data.kindLabel}{data.count > 1 ? ` · ${data.count}` : ''}{data.historical && data.revision != null ? ` · r${data.revision}` : ''}</div>
    {data.gapCount > 0 && <span className="project-trace-gap">{data.gapCount} open</span>}
  </div>;
}
const nodeTypes = { traceItem: TraceNode };
function TraceEdge({ id, data, label, markerEnd, style }) {
  return <>
    <BaseEdge id={id} path={traceRoutePath(data.route.points)} markerEnd={markerEnd} style={style} />
    <EdgeText x={data.route.label.x} y={data.route.label.y} label={label} labelStyle={{ fill: '#334155', fontSize: 11, fontWeight: 500 }}
      labelBgStyle={{ fill: '#fafbfe', fillOpacity: .98 }} labelBgPadding={[5, 3]} labelBgBorderRadius={3} />
  </>;
}
const edgeTypes = { traceRoute: TraceEdge };
const pageSize = 25;

function TraceCanvas({ graph, records, onOpenNode, labelForNode }) {
  const [level, setLevel] = useState('artifacts'), [artifact, setArtifact] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [selection, setSelection] = useState(null), [detailPage, setDetailPage] = useState(0);
  const [hiddenLayers, setHiddenLayers] = useState([]);
  const { fitView, fitBounds } = useReactFlow();
  const index = useMemo(() => indexProjectTrace(graph), [graph]);
  const layers = useMemo(() => projectTraceLayers(index).map(layer => ({ ...layer, label: relationshipLabel(layer.id) })), [index]);
  const selectedLayers = useMemo(() => layers.map(layer => layer.id).filter(id => !hiddenLayers.includes(id)), [layers, hiddenLayers]);
  const visibleIndex = useMemo(() => hiddenLayers.length ? filterProjectTraceLayers(index, selectedLayers) : index, [index, hiddenLayers, selectedLayers]);
  const artifacts = useMemo(() => [...index.nodes.values()].filter(node => node.type === 'artifact'), [index]);
  const artifactId = artifacts.some(node => node.id === artifact) ? artifact : artifacts[0]?.id || '';
  const model = useMemo(() => {
    const view = level === 'artifacts' ? overviewTraceDiagram(visibleIndex) : objectTraceDiagram(visibleIndex, artifactId, query, page);
    return { ...view, edges: view.edges.map(edge => ({ ...edge, label: `${relationshipLabel(edge.type)}${edge.members.length > 1 ? ` · ${edge.members.length}` : ''}` })) };
  }, [visibleIndex, level, artifactId, query, page]);
  const [layoutState, setLayoutState] = useState({}), [layoutAttempt, setLayoutAttempt] = useState(0);
  const layout = layoutState.model === model && layoutState.attempt === layoutAttempt ? layoutState.layout : null;
  const layoutError = layoutState.model === model && layoutState.attempt === layoutAttempt ? layoutState.error : null;
  useEffect(() => {
    let current = true;
    layoutTraceDiagram(model).then(result => { if (current) setLayoutState({ model, attempt: layoutAttempt, layout: result }); })
      .catch(() => { if (current) setLayoutState({ model, attempt: layoutAttempt, error: 'Unable to arrange traceability. Try again.' }); });
    return () => { current = false; };
  }, [model, layoutAttempt]);
  useEffect(() => { if (!layout) return undefined; const frame = requestAnimationFrame(() => fitView({ padding: .18, minZoom: .55, maxZoom: 1 })); return () => cancelAnimationFrame(frame); }, [layout, fitView]);
  const fitDiagram = () => { if (layout) fitBounds(layout.bounds, { padding: .18, duration: 200 }); };
  const metadata = useMemo(() => new Map(records.map(({ meta }) => [meta.id, meta])), [records]);
  const label = useCallback(node => labelForNode?.(node) || traceNodeName(node), [labelForNode]);
  const kindLabel = node => {
    if (node.type === 'artifact' && metadata.get(node.id)?.templateId) return getTemplate(metadata.get(node.id).templateId).name;
    const kind = typeNames[node.type] || readableLabel(node.type), owner = node.moduleTitle || metadata.get(node.artifactId)?.title;
    return owner ? `${owner} · ${kind}` : kind;
  };
  const selectedNode = selection?.kind === 'node' ? model.nodes.find(node => node.id === selection.id) : null;
  const selectedEdge = selection?.kind === 'edge' ? model.edges.find(edge => edge.id === selection.id) : null;
  const select = useCallback(value => { setSelection(value); setDetailPage(0); }, []);
  const rawNodeFor = node => node?.members?.length === 1 ? index.nodes.get(node.members[0]) : null;
  const diagramNodes = layout ? model.nodes.map(node => ({ id: node.id, type: 'traceItem', position: layout.positions.get(node.id), selected: selectedNode?.id === node.id,
    style: { width: TRACE_ITEM_WIDTH, height: TRACE_ITEM_HEIGHT },
    data: { node, metadata: metadata.get(node.id), label: label(node), kind: node.type, kindLabel: kindLabel(node), count: node.members.length, gapCount: node.gapCount,
      historical: node.historical, revision: node.revision, openable: canOpen(rawNodeFor(node)), open: () => onOpenNode(rawNodeFor(node)) } })) : [];
  const diagramEdges = layout ? model.edges.map(edge => {
    const highlighted = selectedEdge?.id === edge.id || selectedNode?.id === edge.from || selectedNode?.id === edge.to;
    return { id: edge.id, source: edge.from, target: edge.to, sourceHandle: 'out', targetHandle: 'in',
      type: 'traceRoute', label: edge.label, data: { route: layout.routes.get(edge.id) },
      markerEnd: { type: MarkerType.ArrowClosed, color: highlighted ? '#4338ca' : '#64748b' },
      style: { stroke: highlighted ? '#4338ca' : '#94a3b8', strokeWidth: highlighted ? 2.5 : 1.4, ...(edge.type === 'contains' ? { strokeDasharray: '5 4' } : {}) } };
  }) : [];
  const inspectedEdges = useMemo(() => {
    const ids = new Set();
    for (const edge of model.edges) if (edge.id === selectedEdge?.id || (selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id))) for (const id of edge.members) ids.add(id);
    return [...ids].map(id => index.links.get(id)).filter(Boolean);
  }, [model, selectedEdge, selectedNode, index]);
  const inspectable = selectedNode || selectedEdge;
  const raw = selectedNode && rawNodeFor(selectedNode);
  const detailsPages = Math.max(1, Math.ceil(inspectedEdges.length / pageSize));
  const currentDetailsPage = Math.min(detailPage, detailsPages - 1);
  const switchLevel = value => { setLevel(value); setPage(0); setQuery(''); select(null); };
  const reference = id => { const node = index.nodes.get(id); return canOpen(node) ? <button onClick={() => onOpenNode(node)}>{label(node)}</button> : <span>{node ? label(node) : 'Unavailable linked item'}</span>; };
  return <section className="project-trace-diagram" aria-label="Traceability directed graph">
    <div className="project-trace-tools">
      <label>Level<select value={level} onChange={event => switchLevel(event.target.value)}><option value="artifacts">Artifacts</option><option value="objects">Objects</option></select></label>
      <TraceLayersDropdown layers={layers} selected={selectedLayers} onChange={selected => { setHiddenLayers(layers.map(layer => layer.id).filter(id => !selected.includes(id))); setPage(0); select(null); }} />
      {level === 'objects' && <>
        <label>Artifact<select value={artifactId} onChange={event => { setArtifact(event.target.value); setPage(0); select(null); }}>{artifacts.map(node => <option key={node.id} value={node.id}>{label(node)}</option>)}</select></label>
        <label>Find object<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); select(null); }} /></label>
        {model.pageCount > 1 && <div className="project-trace-paging"><button disabled={!model.page} onClick={() => { setPage(model.page - 1); select(null); }}>Previous objects</button><span>{model.page + 1} / {model.pageCount}</span><button disabled={model.page + 1 === model.pageCount} onClick={() => { setPage(model.page + 1); select(null); }}>Next objects</button></div>}
      </>}
    </div>
    {model.truncated && <p className="project-trace-notice" role="status">Showing {model.nodes.length} of {model.totalNodes} nodes and {model.edges.length} of {model.totalEdges} relationships in this view. Use Objects or the traceability table to inspect further links.</p>}
    {!!layers.length && !selectedLayers.length && <p role="status">No relationship layers selected. Choose layers to show links.</p>}
    {level === 'objects' && !model.objectCount && <p role="status">No saved objects{query ? ' match this search' : ' in this artifact'}.</p>}
    <div className="project-trace-body">
      <div className="project-trace-canvas">
        {layoutError ? <div className="project-trace-layout-message" role="alert">{layoutError}<button onClick={() => setLayoutAttempt(layoutAttempt + 1)}>Retry diagram</button></div> : !layout ? <p className="project-trace-layout-message" role="status">Arranging diagram…</p> : <ReactFlow key={`${level}:${artifactId}:${model.page || 0}:${query}`} nodes={diagramNodes} edges={diagramEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView fitViewOptions={{ padding: .18, minZoom: .55, maxZoom: 1 }} minZoom={.02} maxZoom={2} nodesDraggable={false} nodesConnectable={false}
          panOnScroll panOnScrollMode="free" zoomOnScroll={false} zoomOnPinch
          deleteKeyCode={null} onNodesDelete={() => {}} onEdgesDelete={() => {}} onlyRenderVisibleElements
          onNodeClick={(_, node) => select({ kind: 'node', id: node.id })}
          onNodeDoubleClick={(_, node) => { const source = rawNodeFor(model.nodes.find(item => item.id === node.id)); if (canOpen(source)) onOpenNode(source); }}
          onEdgeClick={(_, edge) => select({ kind: 'edge', id: edge.id })} onPaneClick={() => select(null)}>
          <Background gap={22} color="#e2e8f0" /><Controls showInteractive={false} onFitView={fitDiagram} />
          {model.nodes.length > 8 && <MiniMap pannable zoomable style={{ width: 140, height: 90 }} nodeColor="#c7d2fe" />}
        </ReactFlow>}
      </div>
      {inspectable && <aside className="project-trace-details" aria-label="Selected traceability item">
        <div className="project-trace-details-heading"><strong>{selectedNode ? label(selectedNode) : relationshipLabel(selectedEdge.type)}</strong><button aria-label="Close traceability details" onClick={() => select(null)}>×</button></div>
        {selectedNode?.historical && <p>Saved revision {selectedNode.revision ?? '—'}</p>}
        {raw && canOpen(raw) && <button className="project-trace-open" onClick={() => onOpenNode(raw)}>Open linked item</button>}
        {selectedNode?.type === 'artifact' && <button className="project-trace-open" onClick={() => { setArtifact(selectedNode.id); switchLevel('objects'); }}>Show object traces</button>}
        <ul>{inspectedEdges.slice(currentDetailsPage * pageSize, (currentDetailsPage + 1) * pageSize).map(edge => <li key={edge.id}>
          {reference(edge.from)}<small>{relationshipLabel(edge.type)} →</small>{reference(edge.to)}
        </li>)}</ul>
        {!inspectedEdges.length && <p>No linked relationships in this view.</p>}
        {detailsPages > 1 && <div className="project-trace-paging"><button disabled={!currentDetailsPage} onClick={() => setDetailPage(currentDetailsPage - 1)}>Previous links</button><span>{currentDetailsPage + 1} / {detailsPages}</span><button disabled={currentDetailsPage + 1 === detailsPages} onClick={() => setDetailPage(currentDetailsPage + 1)}>Next links</button></div>}
      </aside>}
    </div>
  </section>;
}

export default function ProjectTraceabilityDiagram(props) {
  if (!props.graph.nodes?.length) return <p>No recorded traceability.</p>;
  return <ReactFlowProvider><TraceCanvas {...props} /></ReactFlowProvider>;
}
