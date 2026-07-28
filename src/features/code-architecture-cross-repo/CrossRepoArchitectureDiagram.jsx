import React, { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";

const STATUS_STYLE = {
  Accepted: { stroke: "#16a34a", strokeWidth: 2.5 },
  Rejected: { stroke: "#94a3b8", strokeWidth: 2, strokeDasharray: "6 5" },
  "Needs Review": { stroke: "#d97706", strokeWidth: 2.5 },
  Proposed: { stroke: "#2D7DFE", strokeWidth: 2.3 },
};

function storageKey(folderId) {
  return `xhandle:cross-repo-architecture:positions:${folderId || "folder"}`;
}

function loadPositions(folderId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(folderId)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePositions(folderId, nodes = []) {
  try {
    const positions = {};
    nodes.forEach((node) => {
      positions[node.id] = node.position;
    });
    localStorage.setItem(storageKey(folderId), JSON.stringify(positions));
  } catch {}
}

function repoNodeId(value) {
  return `repo:${String(value || "unknown").replace(/[^a-zA-Z0-9_.:-]+/g, "-")}`;
}

function nodeLabel(row, side) {
  return side === "source"
    ? row.sourceRepo || row.sourceRepoId || "Source repo"
    : row.targetRepo || row.targetRepoId || "Target repo";
}

function makeNodes(rows = [], folderId = "") {
  const positions = loadPositions(folderId);
  const byId = new Map();
  rows.forEach((row) => {
    [
      { side: "source", repoId: row.sourceRepoId || row.sourceRepo || row.sourceProjectId },
      { side: "target", repoId: row.targetRepoId || row.targetRepo || row.targetProjectId },
    ].forEach(({ side, repoId }) => {
      if (!repoId) return;
      const id = repoNodeId(repoId);
      if (byId.has(id)) return;
      byId.set(id, {
        id,
        type: "default",
        position: positions[id] || {
          x: 80 + (byId.size % 4) * 280,
          y: 80 + Math.floor(byId.size / 4) * 180,
        },
        data: {
          label: (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{nodeLabel(row, side)}</div>
              <div className="truncate text-[11px] text-slate-500">{repoId}</div>
            </div>
          ),
        },
        style: {
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          background: "#fff",
          width: 220,
          minHeight: 64,
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
        },
      });
    });
  });
  return Array.from(byId.values());
}

function makeEdges(rows = []) {
  return rows
    .filter((row) => row.sourceRepoId || row.sourceRepo || row.targetRepoId || row.targetRepo)
    .map((row, index) => {
      const style = STATUS_STYLE[row.reviewStatus] || STATUS_STYLE.Proposed;
      return {
        id: row.internalId || row.id || `cross-edge-${index}`,
        source: repoNodeId(row.sourceRepoId || row.sourceRepo || row.sourceProjectId),
        target: repoNodeId(row.targetRepoId || row.targetRepo || row.targetProjectId),
        label: row.interfaceName || row.dataControlFlow || row.interfaceType || row.id,
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        style,
        data: { row },
      };
    });
}

export default function CrossRepoArchitectureDiagram({ folderId, rows = [], onOpenRow }) {
  const [selectedRow, setSelectedRow] = useState(null);
  const initialNodes = useMemo(() => makeNodes(rows, folderId), [folderId, rows]);
  const edges = useMemo(() => makeEdges(rows), [rows]);
  const [nodes, setNodes] = useState(initialNodes);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes]);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-lg border border-slate-200 bg-white">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) => {
            setNodes((current) => {
              const next = current.map((node) => {
                const change = changes.find((item) => item.id === node.id && item.type === "position");
                return change?.position ? { ...node, position: change.position } : node;
              });
              savePositions(folderId, next);
              return next;
            });
          }}
          onEdgeDoubleClick={(event, edge) => {
            event.preventDefault();
            event.stopPropagation();
            setSelectedRow(edge.data?.row || null);
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={18} size={1} />
          <Controls position="bottom-right" />
        </ReactFlow>
      </ReactFlowProvider>

      {selectedRow && (
        <div className="absolute right-3 top-3 z-10 w-[min(440px,calc(100%-24px))] rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{selectedRow.interfaceName || selectedRow.id}</div>
              <div className="mt-1 text-xs text-slate-500">{selectedRow.reviewStatus} · {selectedRow.confidence}</div>
            </div>
            <button type="button" className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setSelectedRow(null)}>Close</button>
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div><span className="font-semibold">Flow:</span> {selectedRow.dataControlFlow || "Not specified"}</div>
            <div><span className="font-semibold">Source:</span> {selectedRow.sourceRepo} · {selectedRow.sourceFunction}</div>
            <div><span className="font-semibold">Target:</span> {selectedRow.targetRepo} · {selectedRow.targetFunction}</div>
            <div><span className="font-semibold">Evidence:</span> {selectedRow.evidence || "No evidence text provided."}</div>
            {onOpenRow && (
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-[#2D7DFE] hover:bg-slate-50"
                  onClick={() => onOpenRow(selectedRow, "source")}
                >
                  Open Source Row
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-[#2D7DFE] hover:bg-slate-50"
                  onClick={() => onOpenRow(selectedRow, "target")}
                >
                  Open Target Row
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
