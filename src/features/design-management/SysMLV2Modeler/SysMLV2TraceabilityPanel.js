import React from "react";

export default function SysMLV2TraceabilityPanel({ model, onSelect }) {
  const elements = new Map((model?.elements || []).map((element) => [element.id, element]));
  const links = model?.traceLinks || [];
  return (
    <div className="bg-white">
      <div className="border-b px-3 py-2 text-sm font-semibold">Traceability</div>
      <div className="overflow-auto p-2">
        {links.length ? links.map((link) => (
          <button key={link.id} className="mb-2 block w-full rounded border p-2 text-left text-xs hover:bg-gray-50" onClick={() => onSelect?.({ kind: "element", id: link.sourceId })}>
            <div className="font-semibold">{elements.get(link.sourceId)?.name || link.sourceId} → {link.targetType}:{link.targetId}</div>
            <div className="text-gray-500">{link.relationshipType} {link.rationale ? `· ${link.rationale}` : ""}</div>
          </button>
        )) : <div className="p-3 text-xs text-gray-500">No trace links yet. Add links in the properties panel.</div>}
      </div>
    </div>
  );
}
