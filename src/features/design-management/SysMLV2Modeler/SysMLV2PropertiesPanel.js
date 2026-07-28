import React from "react";
import { PanelRightClose } from "lucide-react";
import { SYSML_ELEMENT_TYPES, SYSML_RELATIONSHIP_TYPES, SYSML_TRACE_RELATIONSHIP_TYPES, SYSML_TRACE_TARGET_TYPES } from "./sysmlV2Types";

function TextField({ label, value, onChange, multiline = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {multiline ? (
        <textarea className="min-h-[72px] w-full rounded border px-2 py-1 text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="w-full rounded border px-2 py-1 text-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function SysMLV2PropertiesPanel({
  model,
  selection,
  onUpdateElement,
  onUpdateRelationship,
  onDeleteElement,
  onDeleteRelationship,
  onAddTraceLink,
  onCollapse,
}) {
  const element = selection?.kind === "element" ? model?.elements?.find((entry) => entry.id === selection.id) : null;
  const relationship = selection?.kind === "relationship" ? model?.relationships?.find((entry) => entry.id === selection.id) : null;

  if (!element && !relationship) {
    return (
      <div className="h-full overflow-auto border-l bg-white p-3">
        <PanelHeader title="Properties" onCollapse={onCollapse} />
        <div className="mt-2 text-xs text-gray-500">Select a SysML element or relationship to edit details.</div>
      </div>
    );
  }

  if (relationship) {
    return (
      <div className="h-full overflow-auto border-l bg-white p-3">
        <PanelHeader title="Relationship" onCollapse={onCollapse} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Type</span>
          <select className="w-full rounded border px-2 py-1 text-sm" value={relationship.type} onChange={(e) => onUpdateRelationship(relationship.id, { type: e.target.value })}>
            {SYSML_RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <div className="mt-3 space-y-3">
          <TextField label="Label" value={relationship.label} onChange={(value) => onUpdateRelationship(relationship.id, { label: value })} />
          <TextField label="Description" value={relationship.description} multiline onChange={(value) => onUpdateRelationship(relationship.id, { description: value })} />
        </div>
        <button className="mt-4 w-full rounded border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50" onClick={() => onDeleteRelationship(relationship.id)}>
          Delete relationship
        </button>
      </div>
    );
  }

  const updateJsonField = (field, raw) => {
    try {
      onUpdateElement(element.id, { [field]: JSON.parse(raw || "[]") });
    } catch {
      onUpdateElement(element.id, { [field]: raw ? [{ name: raw }] : [] });
    }
  };

  return (
    <div className="h-full overflow-auto border-l bg-white p-3">
      <PanelHeader title="Element Properties" onCollapse={onCollapse} />
      <div className="space-y-3">
        <TextField label="Name" value={element.name} onChange={(value) => onUpdateElement(element.id, { name: value })} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Type</span>
          <select className="w-full rounded border px-2 py-1 text-sm" value={element.type} onChange={(e) => onUpdateElement(element.id, { type: e.target.value })}>
            {SYSML_ELEMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <TextField label="Description / requirement text" value={element.description} multiline onChange={(value) => onUpdateElement(element.id, { description: value })} />
        <TextField label="Attributes JSON or name" value={JSON.stringify(element.attributes || [], null, 2)} multiline onChange={(value) => updateJsonField("attributes", value)} />
        <TextField label="Ports JSON or name" value={JSON.stringify(element.ports || [], null, 2)} multiline onChange={(value) => updateJsonField("ports", value)} />
        <TextField label="Constraints JSON or name" value={JSON.stringify(element.constraints || [], null, 2)} multiline onChange={(value) => updateJsonField("constraints", value)} />
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={!!element.metadata?.safetyCritical}
            onChange={(e) => onUpdateElement(element.id, { metadata: { ...(element.metadata || {}), safetyCritical: e.target.checked } })}
          />
          Safety-critical
        </label>
      </div>
      <div className="mt-4 rounded border bg-gray-50 p-2">
        <div className="mb-2 text-xs font-semibold text-gray-700">Add Trace Link</div>
        <TraceLinkMiniForm element={element} onAddTraceLink={onAddTraceLink} />
      </div>
      <button className="mt-4 w-full rounded border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50" onClick={() => onDeleteElement(element.id)}>
        Delete element
      </button>
    </div>
  );
}

function PanelHeader({ title, onCollapse }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
      {onCollapse ? (
        <button
          type="button"
          className="shrink-0 rounded border p-1 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          title="Collapse properties panel"
          aria-label="Collapse properties panel"
          onClick={onCollapse}
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function TraceLinkMiniForm({ element, onAddTraceLink }) {
  const [targetType, setTargetType] = React.useState("requirement");
  const [targetId, setTargetId] = React.useState("");
  const [relationshipType, setRelationshipType] = React.useState("tracesTo");
  const [rationale, setRationale] = React.useState("");
  return (
    <div className="space-y-2">
      <select className="w-full rounded border px-2 py-1 text-xs" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
        {SYSML_TRACE_TARGET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <select className="w-full rounded border px-2 py-1 text-xs" value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)}>
        {SYSML_TRACE_RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <input className="w-full rounded border px-2 py-1 text-xs" placeholder="Target id" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
      <input className="w-full rounded border px-2 py-1 text-xs" placeholder="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <button
        className="w-full rounded bg-gray-900 px-2 py-1 text-xs text-white"
        onClick={() => {
          if (!targetId.trim()) return;
          onAddTraceLink({ sourceType: "sysmlElement", sourceId: element.id, targetType, targetId: targetId.trim(), relationshipType, rationale });
          setTargetId("");
          setRationale("");
        }}
      >
        Add trace
      </button>
    </div>
  );
}
