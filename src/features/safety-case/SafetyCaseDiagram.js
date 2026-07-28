import React, { useMemo, useCallback } from "react";
import ReactFlow, { Background, Controls, MiniMap, applyEdgeChanges, applyNodeChanges, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";
import SafetyCaseNode from "./SafetyCaseNode";
import { SAFETY_CASE_NODE_SIZE, centerSafetyCaseOnYAxis } from "./safetyCaseLayout";

const nodeTypes = { safetyCaseNode: SafetyCaseNode };
const elk = new ELK();

export async function layoutSafetyCase(safetyCase) {
  const nodes = safetyCase.nodes || [];
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    },
    children: nodes.map((node) => ({ id: node.id, width: SAFETY_CASE_NODE_SIZE.width, height: SAFETY_CASE_NODE_SIZE.height })),
    edges: (safetyCase.edges || []).map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
  const layouted = await elk.layout(graph);
  const pos = new Map((layouted.children || []).map((node) => [node.id, { x: node.x || 0, y: node.y || 0 }]));
  return centerSafetyCaseOnYAxis({
    ...safetyCase,
    nodes: nodes.map((node) => ({ ...node, position: pos.get(node.id) || node.position })),
  });
}

function descendantIds(nodes, rootId) {
  const byParent = new Map();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
    byParent.get(node.parentId).push(node.id);
  });
  const ids = new Set();
  const stack = [...(byParent.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop();
    ids.add(id);
    stack.push(...(byParent.get(id) || []));
  }
  return ids;
}

function visibleModel(safetyCase, onToggleCollapse) {
  const nodes = safetyCase.nodes || [];
  const hidden = new Set();
  nodes.filter((node) => node.collapsed).forEach((node) => {
    descendantIds(nodes, node.id).forEach((id) => hidden.add(id));
  });
  const childCounts = nodes.reduce((acc, node) => {
    if (node.parentId) acc[node.parentId] = (acc[node.parentId] || 0) + 1;
    return acc;
  }, {});
  const rfNodes = nodes.filter((node) => !hidden.has(node.id)).map((node) => ({
    id: node.id,
    type: "safetyCaseNode",
    position: node.position || { x: 0, y: 0 },
    data: { node, childCount: childCounts[node.id] || 0, onToggleCollapse },
  }));
  const visibleIds = new Set(rfNodes.map((node) => node.id));
  const rfEdges = (safetyCase.edges || []).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#64748b", strokeWidth: 1.5 },
    labelStyle: { fill: "#475569", fontSize: 11 },
  }));
  return { rfNodes, rfEdges };
}

export default function SafetyCaseDiagram({ safetyCase, selectedNodeId, onSelectNode, onChange, onToggleCollapse }) {
  const { rfNodes, rfEdges } = useMemo(() => visibleModel(safetyCase, onToggleCollapse), [safetyCase, onToggleCollapse]);
  const selectedNodes = useMemo(
    () => rfNodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [rfNodes, selectedNodeId]
  );
  const [nodes, setNodes] = React.useState(selectedNodes);
  const [edges, setEdges] = React.useState(rfEdges);
  const flowInstanceRef = React.useRef(null);

  React.useEffect(() => setNodes(selectedNodes), [selectedNodes]);
  React.useEffect(() => setEdges(rfEdges), [rfEdges, setEdges]);
  React.useEffect(() => {
    if (!flowInstanceRef.current || !safetyCase?.id) return;
    window.requestAnimationFrame(() => flowInstanceRef.current?.fitView({ padding: 0.2, duration: 0 }));
  }, [safetyCase?.id, selectedNodes.length]);

  const onNodesChange = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const handleConnect = useCallback((params) => {
    const edge = {
      id: `sce-${Date.now()}`,
      source: params.source,
      target: params.target,
      relationship: "supports",
      label: "supports",
    };
    onChange({ ...safetyCase, edges: [...(safetyCase.edges || []), edge] });
  }, [onChange, safetyCase]);

  const handleNodeDragStop = useCallback((_event, node) => {
    onChange({
      ...safetyCase,
      nodes: safetyCase.nodes.map((item) => item.id === node.id ? { ...item, position: node.position } : item),
    });
  }, [onChange, safetyCase]);

  const handleEdgesDelete = useCallback((edges) => {
    const deleteIds = new Set(edges.map((edge) => edge.id));
    onChange({ ...safetyCase, edges: safetyCase.edges.filter((edge) => !deleteIds.has(edge.id)) });
  }, [onChange, safetyCase]);

  const handleInit = useCallback((instance) => {
    flowInstanceRef.current = instance;
    window.requestAnimationFrame(() => instance.fitView({ padding: 0.18, duration: 0 }));
  }, []);

  return (
    <div className="h-full min-h-[360px] overflow-hidden rounded-lg border bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        onInit={handleInit}
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background gap={18} color="#e5e7eb" />
      </ReactFlow>
    </div>
  );
}
