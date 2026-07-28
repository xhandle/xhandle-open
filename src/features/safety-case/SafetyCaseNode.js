import React from "react";
import { Handle, Position } from "reactflow";
import { ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { NODE_TYPE_LABELS, NODE_TYPE_STYLES } from "./safetyCaseTypes";
import { SAFETY_CASE_NODE_SIZE } from "./safetyCaseLayout";

const ROLE_SIZES = {
  topClaim: { width: 620, minHeight: 82 },
  contextBox: { width: 300, minHeight: 140 },
  assumptionBox: { width: 360, minHeight: 140 },
  strategyBar: { width: 760, minHeight: 82 },
  goalColumn: { width: 220, minHeight: 150 },
  monitoringGoal: { width: 700, minHeight: 88 },
  goalEvidence: { width: 190, minHeight: 110 },
  bottomEvidence: { width: 190, minHeight: 120 },
};

const ROLE_CLASSES = {
  topClaim: "border-slate-500 bg-white",
  contextBox: "border-slate-500 bg-slate-50",
  assumptionBox: "border-amber-500 bg-amber-50",
  strategyBar: "border-teal-600 bg-teal-50",
  goalColumn: "border-slate-500 bg-white",
  monitoringGoal: "border-emerald-600 bg-emerald-50",
  goalEvidence: "border-slate-500 bg-slate-50",
  bottomEvidence: "border-slate-500 bg-slate-50",
};

export default function SafetyCaseNode({ data, selected }) {
  const node = data.node;
  const hasChildren = data.childCount > 0;
  const role = node.metadata?.layoutRole;
  const roleSize = ROLE_SIZES[role] || { width: SAFETY_CASE_NODE_SIZE.width - 20, minHeight: SAFETY_CASE_NODE_SIZE.height - 20 };
  const displayItems = node.metadata?.displayItems || [];
  const isLifecycleNode = Boolean(role);
  const isBar = ["topClaim", "strategyBar", "monitoringGoal"].includes(role);

  if (isLifecycleNode) {
    return (
      <div
        className={`relative rounded-md border-2 px-3 py-3 shadow-sm ${ROLE_CLASSES[role] || "border-slate-400 bg-white"} ${selected ? "ring-2 ring-[#2D7DFE]" : ""}`}
        style={{ width: roleSize.width, minHeight: roleSize.minHeight }}
      >
        <Handle type="target" position={Position.Top} className="!bg-gray-500" />
        <div className={`${isBar ? "text-center" : ""}`}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{NODE_TYPE_LABELS[node.type] || node.type}</div>
          <div className={`${isBar ? "text-sm" : "text-sm"} font-bold leading-snug text-slate-900`}>{node.title}</div>
          {!isBar && node.description && <div className="mt-2 text-xs leading-relaxed text-slate-700">{node.description}</div>}
        </div>
        {displayItems.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs font-semibold leading-snug text-slate-800">
            {displayItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        )}
        {!isBar && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`rounded px-1.5 py-0.5 ${node.status === "unsupported" ? "bg-red-100 text-red-700" : node.status === "supported" || node.status === "accepted" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>
              {node.status}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">{node.confidence}</span>
            <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
              <Link2 size={11} /> {(node.linkedArtifactIds || []).length}
            </span>
          </div>
        )}
        {hasChildren && (
          <button
            type="button"
            className="absolute right-2 top-2 rounded p-0.5 hover:bg-white/70"
            aria-label={node.collapsed ? "Expand branch" : "Collapse branch"}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapse?.(node.id);
            }}
          >
            {node.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <Handle type="source" position={Position.Bottom} className="!bg-gray-500" />
      </div>
    );
  }

  return (
    <div className={`w-[260px] rounded-lg border-2 bg-white shadow-sm ${selected ? "ring-2 ring-[#2D7DFE]" : ""}`}>
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className={`rounded-t-md border-b px-3 py-2 ${NODE_TYPE_STYLES[node.type] || NODE_TYPE_STYLES.claim}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide">{NODE_TYPE_LABELS[node.type] || node.type}</span>
          {hasChildren && (
            <button
              type="button"
              className="rounded p-0.5 hover:bg-white/60"
              aria-label={node.collapsed ? "Expand branch" : "Collapse branch"}
              onClick={(event) => {
                event.stopPropagation();
                data.onToggleCollapse?.(node.id);
              }}
            >
              {node.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="text-sm font-semibold leading-snug text-gray-900">{node.title || "Untitled node"}</div>
        <div className="line-clamp-3 text-xs leading-relaxed text-gray-600">{node.description || "No description yet."}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`rounded px-1.5 py-0.5 ${node.status === "unsupported" ? "bg-red-100 text-red-700" : node.status === "supported" || node.status === "accepted" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>
            {node.status}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">{node.confidence}</span>
          <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
            <Link2 size={11} /> {(node.linkedArtifactIds || []).length}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}
