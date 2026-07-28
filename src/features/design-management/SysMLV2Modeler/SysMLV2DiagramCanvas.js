import React from "react";
import ReactFlow, { Background, Controls, Handle, MarkerType, Position, ReactFlowProvider } from "reactflow";
import "reactflow/dist/style.css";
import { toReactFlowModel } from "./sysmlV2DiagramUtils";

function palette(type) {
  if (type === "Package") return "border-slate-500 bg-slate-50 text-slate-900";
  if (/Requirement/.test(type)) return "border-emerald-500 bg-emerald-50 text-emerald-950";
  if (/Verification/.test(type)) return "border-pink-500 bg-pink-50 text-pink-950";
  if (/Interface|Port|Connection/.test(type)) return "border-cyan-500 bg-cyan-50 text-cyan-950";
  if (/Action|State/.test(type)) return "border-indigo-500 bg-indigo-50 text-indigo-950";
  if (/Constraint/.test(type)) return "border-amber-500 bg-amber-50 text-amber-950";
  return "border-blue-500 bg-blue-50 text-blue-950";
}

function SysMLNode({ data }) {
  const element = data.element;
  const handleClass = "!h-2 !w-2 !border-2 !border-white !bg-slate-700";
  return (
    <div className={`w-[250px] rounded-lg border-2 px-3 py-2 shadow-sm ${palette(element.type)}`}>
      <Handle id="t-left" type="target" position={Position.Left} className={handleClass} />
      <Handle id="s-left" type="source" position={Position.Left} className={handleClass} />
      <Handle id="t-right" type="target" position={Position.Right} className={handleClass} />
      <Handle id="s-right" type="source" position={Position.Right} className={handleClass} />
      <Handle id="t-top" type="target" position={Position.Top} className={handleClass} />
      <Handle id="s-top" type="source" position={Position.Top} className={handleClass} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} className={handleClass} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} className={handleClass} />
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{element.type}</div>
      <div className="truncate text-sm font-semibold">{element.name}</div>
      {element.description ? <div className="mt-1 line-clamp-2 text-[11px] opacity-75">{element.description}</div> : null}
      {element.ports?.length ? <div className="mt-1 truncate text-[10px] opacity-70">Ports: {element.ports.map((p) => p.name || p).join(", ")}</div> : null}
    </div>
  );
}

const nodeTypes = { sysmlNode: SysMLNode };

function CanvasInner({ model, activeView, selection, onSelect, onPositionsChange }) {
  const rf = React.useMemo(() => toReactFlowModel(model, activeView), [model, activeView]);
  const edges = React.useMemo(() => rf.edges.map((edge) => ({
    ...edge,
    markerEnd: { type: MarkerType.ArrowClosed },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 6,
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.98, stroke: "#cbd5e1", strokeWidth: 1 },
    labelStyle: { fontSize: 11, fontWeight: 700, fill: "#334155" },
    style: {
      ...(edge.style || {}),
      stroke: selection?.id === edge.id ? "#2563eb" : "#475569",
    },
  })), [rf.edges, selection]);

  return (
    <ReactFlow
      nodes={rf.nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.22, minZoom: 0.35, maxZoom: 0.95 }}
      minZoom={0.2}
      defaultEdgeOptions={{ type: "bezier" }}
      onNodeClick={(_, node) => onSelect({ kind: "element", id: node.id })}
      onEdgeClick={(_, edge) => onSelect({ kind: "relationship", id: edge.id })}
      onNodeDragStop={(_, node) => onPositionsChange({ [node.id]: node.position })}
      deleteKeyCode={null}
    >
      <Background gap={18} color="#dbe3ef" />
      <Controls />
    </ReactFlow>
  );
}

export default function SysMLV2DiagramCanvas(props) {
  return (
    <div className="h-full min-h-0 bg-slate-50">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
