/**
 * xHandle: requirements manager modal modal workflow.
 * This file implements a focused modal surface used inside the xHandle workspace to collect input, expose a feature-specific editor, or present supporting project information.
 * Modal flows keep secondary tasks close to the main engineering workspace without forcing a separate route or losing the surrounding project context.
 * Related files: src/App.js, src/components/layout/TopNavBar.jsx, src/features/settings/SettingsModal.jsx.
 */

// RequirementsManagerModal.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
    listFolderTree, createFolder, renameFolder, deleteFolderRecursive,
  listRequirementsByFolder, createRequirement
} from "../../lib/storage/requirementsStore";
import { X, ChevronRight, FolderPlus, Trash2, Edit3, Plus } from "lucide-react";

export default function RequirementsManagerModal({
  activeProjectId,
  isOpen,
  onClose,
  renderTable,
  defaultFolderId, // NEW
}) {
  const [tree, setTree] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = All
  const [rows, setRows] = useState([]);

  const refreshTree = useCallback(async () => {
    if (!activeProjectId) return;
    const t = await listFolderTree(activeProjectId);
    setTree(t);
  }, [activeProjectId]);

  const refreshRows = useCallback(async () => {
    if (!activeProjectId) return;
    const r = await listRequirementsByFolder(activeProjectId, selectedFolderId);
    setRows(r);
  }, [activeProjectId, selectedFolderId]);

  // FIXED: braces/paren
  useEffect(() => {
    if (isOpen) {
      setSelectedFolderId(defaultFolderId ?? null);
      refreshTree();
    }
  }, [isOpen, defaultFolderId, refreshTree]);
  

  useEffect(() => {
    if (isOpen) refreshRows();
  }, [isOpen, refreshRows]);

  // close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        className="absolute inset-0 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div
          className="w-full max-w-[1200px] max-h-[85vh] bg-white rounded-xl shadow-xl border overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="font-semibold">Manage Requirement Sets</div>
            <button
              className="p-1 rounded hover:bg-gray-100"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar: folder tree */}
            <aside className="w-72 border-r p-3 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Folders</div>
                <button
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-600 text-white"
                  onClick={async () => {
                    const f = await createFolder(activeProjectId, "New Folder", null);
                    await refreshTree();
                    setSelectedFolderId(f.id);
                  }}
                >
                  <FolderPlus size={14} /> New
                </button>
              </div>

              <Tree
                data={tree}
                selectedId={selectedFolderId}
                onSelect={setSelectedFolderId}
                onRename={async (id, name) => { await renameFolder(id, name); await refreshTree(); }}
                onDelete={async (id) => {
                    if (window.confirm("Delete this folder and all contents?")) {
                                            await deleteFolderRecursive(id);
                    await refreshTree();
                    if (selectedFolderId === id) setSelectedFolderId(null);
                    await refreshRows();
                  }
                }}
                onCreateChild={async (parentId) => {
                  const f = await createFolder(activeProjectId, "New Folder", parentId);
                  await refreshTree();
                  setSelectedFolderId(f.id);
                }}
              />
            </aside>

            {/* Main pane */}
            <main className="flex-1 p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <Breadcrumb
                  folderId={selectedFolderId}
                  tree={tree}
                  onSelect={setSelectedFolderId}
                />

                <button
                  className="flex items-center gap-1 text-sm px-3 py-2 rounded bg-green-600 text-white"
                  onClick={async () => {
                    await createRequirement(activeProjectId, selectedFolderId, {});
                    await refreshRows();
                  }}
                >
                  <Plus size={16}/> Add Requirement
                </button>
              </div>

              {/* Table area */}
              {renderTable ? (
                renderTable({ rows, setRows, selectedFolderId, refreshRows })
              ) : rows.length ? (
                <PlaceholderTable />
              ) : (
                <div className="border rounded-lg p-8 text-center text-gray-500">
                  No requirements in this folder yet.
                  <div className="mt-3">
                    <button
                      className="px-3 py-2 text-sm rounded bg-green-600 text-white"
                      onClick={async () => { await createRequirement(activeProjectId, selectedFolderId, {}); await refreshRows(); }}
                    >
                      + Add Requirement
                    </button>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------- Tree ---------- */
function Tree({ data, selectedId, onSelect, onRename, onDelete, onCreateChild }) {
  return (
    <div className="space-y-1">
      <TreeItemRoot
        label="All Requirements"
        selected={selectedId === null}
        onClick={() => onSelect(null)}
      />
      {data.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          onCreateChild={onCreateChild}
        />
      ))}
    </div>
  );
}

/**
 * TreeItemRoot renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param label Input consumed by this step of the xHandle workflow.
 * @param selected Input consumed by this step of the xHandle workflow.
 * @param onClick Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function TreeItemRoot({ label, selected, onClick }) {
  return (
    <button
      className={`w-full text-left px-2 py-1 rounded ${selected ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * TreeNode renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param node Input consumed by this step of the xHandle workflow.
 * @param depth Input consumed by this step of the xHandle workflow.
 * @param selectedId Stable identifier for the entity this step works with.
 * @param onSelect Callback used to notify the surrounding workflow about progress or user actions.
 * @param onRename Callback used to notify the surrounding workflow about progress or user actions.
 * @param onDelete Callback used to notify the surrounding workflow about progress or user actions.
 * @param onCreateChild Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function TreeNode({ node, depth, selectedId, onSelect, onRename, onDelete, onCreateChild }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        className={`flex items-center justify-between ${selectedId === node.id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"} rounded`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          className="flex items-center gap-1 py-1 px-1.5 flex-1 text-left"
          onClick={() => onSelect(node.id)}
        >
          <ChevronRight
            className={`transition ${open ? "rotate-90" : ""}`}
            size={16}
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
          />
          <span>{node.name}</span>
        </button>
        <div className="flex items-center gap-1 pr-1.5">
          <button title="New subfolder" onClick={() => onCreateChild(node.id)}><FolderPlus size={16} /></button>
          <button title="Rename" onClick={async () => {
const name = window.prompt("Folder name", node.name);
            if (name && name.trim()) await onRename(node.id, name.trim());
          }}><Edit3 size={16} /></button>
          <button title="Delete" onClick={async () => { await onDelete(node.id); }}><Trash2 size={16} /></button>
        </div>
      </div>

      {open && node.children?.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onCreateChild={onCreateChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Breadcrumb ---------- */
function Breadcrumb({ folderId, tree, onSelect }) {
  const path = useMemo(() => {
    if (!folderId) return [];
    const index = new Map();
    (function indexTree(nodes) {
      nodes.forEach((n) => { index.set(n.id, n); n.children && indexTree(n.children); });
    })(tree);
    const chain = [];
    let cur = index.get(folderId);
    while (cur) { chain.push(cur); cur = index.get(cur.parentId); }
    return chain.reverse();
  }, [folderId, tree]);

  if (!folderId) return <div className="text-sm text-gray-500">All Requirements</div>;
  return (
    <div className="text-sm text-gray-600">
      <button className="underline" onClick={() => onSelect(null)}>All</button>
      {path.map((n) => (
        <span key={n.id}>
          {" / "}
          <button className="underline" onClick={() => onSelect(n.id)}>{n.name}</button>
        </span>
      ))}
    </div>
  );
}

/* ---------- Placeholder table ---------- */
function PlaceholderTable() {
  return (
    <div className="border rounded-lg p-6 text-center text-gray-500">
      Connect your existing requirements table here via <code>renderTable</code>. It receives{" "}
      <code>{`{ rows, setRows, selectedFolderId, refreshRows }`}</code>.
    </div>
  );
}
