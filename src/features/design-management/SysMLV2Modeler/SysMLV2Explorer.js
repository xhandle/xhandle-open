import React from "react";
import { PanelLeftClose } from "lucide-react";

const EMPTY_ELEMENTS = [];

function iconFor(type) {
  if (type === "Package") return "pkg";
  if (/Requirement/.test(type)) return "req";
  if (/Verification/.test(type)) return "ver";
  if (/Interface|Port/.test(type)) return "if";
  if (/Action|State/.test(type)) return "act";
  if (/Constraint/.test(type)) return "con";
  return "part";
}

export default function SysMLV2Explorer({ model, selectedId, onSelect, onCollapse }) {
  const elements = model?.elements || EMPTY_ELEMENTS;
  const childrenByOwner = React.useMemo(() => {
    const map = new Map();
    elements.forEach((element) => {
      const key = element.ownerId || element.packageId || "root";
      map.set(key, [...(map.get(key) || []), element]);
    });
    return map;
  }, [elements]);

  const renderElement = (element, depth = 0) => {
    const children = (childrenByOwner.get(element.id) || []).filter((child) => child.id !== element.id);
    return (
      <div key={element.id}>
        <button
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${selectedId === element.id ? "bg-indigo-50 text-indigo-800" : "hover:bg-gray-50"}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onSelect({ kind: "element", id: element.id })}
        >
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">{iconFor(element.type)}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{element.name}</span>
        </button>
        {children.map((child) => renderElement(child, depth + 1))}
      </div>
    );
  };

  const roots = elements.filter((element) => !element.ownerId && !element.packageId);
  return (
    <div className="h-full overflow-auto border-r bg-white">
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">Model Explorer</div>
          <div className="truncate text-xs text-gray-500">{model?.name || "No model"}</div>
        </div>
        {onCollapse ? (
          <button
            type="button"
            className="shrink-0 rounded border p-1 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            title="Collapse model explorer"
            aria-label="Collapse model explorer"
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="p-2">
        {roots.length ? roots.map((element) => renderElement(element)) : <div className="p-3 text-xs text-gray-500">Create or import a model to begin.</div>}
      </div>
    </div>
  );
}
