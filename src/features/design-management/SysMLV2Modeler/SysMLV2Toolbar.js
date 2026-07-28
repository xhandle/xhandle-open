import React from "react";
import { SYSML_DIAGRAM_VIEWS, SYSML_ELEMENT_TYPES, SYSML_RELATIONSHIP_TYPES } from "./sysmlV2Types";

export default function SysMLV2Toolbar({
  model,
  activeView,
  onViewChange,
  onCreateModel,
  onAddElement,
  onAddRelationship,
  onAutoLayout,
  onValidate,
  onExportJson,
  onImportJson,
}) {
  const [elementType, setElementType] = React.useState("PartDefinition");
  const [relationshipType, setRelationshipType] = React.useState("connects");

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-white px-3 py-2">
      <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onCreateModel}>
        New model
      </button>
      <select className="rounded border px-2 py-1.5 text-xs" value={activeView} onChange={(e) => onViewChange(e.target.value)}>
        {SYSML_DIAGRAM_VIEWS.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
      </select>
      <div className="h-5 w-px bg-gray-200" />
      <select className="rounded border px-2 py-1.5 text-xs" value={elementType} onChange={(e) => setElementType(e.target.value)}>
        {SYSML_ELEMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <button className="rounded bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700" onClick={() => onAddElement(elementType)}>
        Add element
      </button>
      <select className="rounded border px-2 py-1.5 text-xs" value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)}>
        {SYSML_RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" disabled={!model?.elements?.length} onClick={() => onAddRelationship(relationshipType)}>
        Add relationship
      </button>
      <div className="h-5 w-px bg-gray-200" />
      <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onAutoLayout}>Auto-layout</button>
      <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onValidate}>Validate</button>
      <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onExportJson}>Export JSON</button>
      <button className="rounded border px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50" onClick={onImportJson}>Import JSON</button>
    </div>
  );
}

