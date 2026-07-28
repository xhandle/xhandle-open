import React, { useRef } from "react";
import { Bot, CheckCircle2, Copy, Download, FilePlus2, GitBranchPlus, Layout, Save, Search, Trash2, Upload } from "lucide-react";

function ToolButton({ icon: Icon, children, ...props }) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

export default function SafetyCaseToolbar({
  disabled,
  onNew,
  onSave,
  onDuplicate,
  onDelete,
  onAddTopClaim,
  onLayout,
  onExport,
  onImport,
  onAskAI,
  onGenerate,
  onCheck,
  onUnsupported,
}) {
  const fileRef = useRef(null);
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b bg-gray-50 px-2 py-1.5">
      <ToolButton icon={FilePlus2} onClick={onNew}>New Safety Case</ToolButton>
      <ToolButton icon={Save} disabled={disabled} onClick={onSave}>Save</ToolButton>
      <ToolButton icon={Copy} disabled={disabled} onClick={onDuplicate}>Duplicate</ToolButton>
      <ToolButton icon={Trash2} disabled={disabled} onClick={onDelete}>Delete</ToolButton>
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <ToolButton icon={GitBranchPlus} disabled={disabled} onClick={onAddTopClaim}>Add Top-Level Claim</ToolButton>
      <ToolButton icon={Layout} disabled={disabled} onClick={onLayout}>Auto Layout</ToolButton>
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <ToolButton icon={Download} disabled={disabled} onClick={onExport}>Export JSON</ToolButton>
      <ToolButton icon={Upload} onClick={() => fileRef.current?.click()}>Import JSON</ToolButton>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => onImport(event.target.files?.[0])} />
      <span className="mx-1 h-6 w-px bg-gray-200" />
      <ToolButton icon={Bot} disabled={disabled} onClick={onAskAI}>Ask Collaborator</ToolButton>
      <ToolButton icon={Bot} onClick={onGenerate}>Generate From Current Project</ToolButton>
      <ToolButton icon={CheckCircle2} disabled={disabled} onClick={onCheck}>Check Completeness</ToolButton>
      <ToolButton icon={Search} disabled={disabled} onClick={onUnsupported}>Identify Unsupported Claims</ToolButton>
    </div>
  );
}
