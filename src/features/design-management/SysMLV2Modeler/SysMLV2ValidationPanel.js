import React from "react";

export default function SysMLV2ValidationPanel({ findings = [], onSelect }) {
  const counts = findings.reduce((acc, finding) => ({ ...acc, [finding.severity]: (acc[finding.severity] || 0) + 1 }), {});
  return (
    <div className="bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-semibold">Validation</div>
        <div className="text-xs text-gray-500">{counts.error || 0} errors · {counts.warning || 0} warnings · {counts.info || 0} info</div>
      </div>
      <div className="overflow-auto p-2">
        {findings.length ? findings.map((finding) => (
          <button
            key={finding.id}
            className="mb-2 block w-full rounded border bg-white p-2 text-left text-xs hover:bg-gray-50"
            onClick={() => {
              const elementId = finding.elementIds?.[0];
              const relationshipId = finding.relationshipIds?.[0];
              if (elementId) onSelect?.({ kind: "element", id: elementId });
              else if (relationshipId) onSelect?.({ kind: "relationship", id: relationshipId });
            }}
          >
            <div className={`font-semibold ${finding.severity === "error" ? "text-red-700" : finding.severity === "warning" ? "text-amber-700" : "text-slate-700"}`}>{finding.title}</div>
            <div className="text-gray-600">{finding.message}</div>
            {finding.suggestedFix ? <div className="mt-1 text-gray-500">Fix: {finding.suggestedFix}</div> : null}
          </button>
        )) : <div className="p-3 text-xs text-gray-500">No validation findings.</div>}
      </div>
    </div>
  );
}
