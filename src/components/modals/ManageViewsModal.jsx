/**
 * xHandle: manage views modal modal workflow.
 * This file implements a focused modal surface used inside the xHandle workspace to collect input, expose a feature-specific editor, or present supporting project information.
 * Modal flows keep secondary tasks close to the main engineering workspace without forcing a separate route or losing the surrounding project context.
 * Related files: src/App.js, src/components/layout/TopNavBar.jsx, src/features/settings/SettingsModal.jsx.
 */

import { useMemo, useState } from "react";
import { X, Star, Trash2, Save } from "lucide-react";
import { listViews, upsertView, deleteView, renameView, setDefaultView } from "../utils/viewStore";

/**
 * uid renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function uid() { return "v_" + Math.random().toString(36).slice(2, 9); }

export default function ManageViewsModal({ open, onClose, viewKey, getCurrentState, applyState }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [version, setVersion] = useState(0);

  const { views, defaultId } = useMemo(() => listViews(viewKey), [viewKey, version]);

  if (!open) return null;

  function refresh() { setVersion(v => v + 1); }

  function handleSave() {
    const state = getCurrentState?.();
    if (!state) return;
    const id = uid();
    upsertView(viewKey, { id, name: name || "Untitled View", state, createdAt: Date.now() });
    setName("");
    refresh();
  }

  function handleLoad(v) {
    applyState?.(v.state);
    onClose?.();
  }

  function handleDelete(id) {
    deleteView(viewKey, id);
    refresh();
  }

  function handleRename(id) {
    if (!editingName.trim()) return setEditingId(null);
    renameView(viewKey, id, editingName.trim());
    setEditingId(null);
    setEditingName("");
    refresh();
  }

  function handleSetDefault(id) {
    setDefaultView(viewKey, id);
    refresh();
  }

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/30">
      <div className="w-[560px] max-w-[95vw] bg-white rounded-2xl shadow-2xl border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Manage Views</div>
          <button className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X size={18}/></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              placeholder="New view name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <button onClick={handleSave} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2D7DFE] text-white">
              <Save size={16}/> Save Current
            </button>
          </div>

          <div className="border rounded-xl">
            <div className="px-3 py-2 text-xs text-gray-500 border-b">Saved Views ({views.length})</div>
            <div className="max-h-[300px] overflow-auto divide-y">
              {views.map(v => (
                <div key={v.id} className="px-3 py-2 flex items-center gap-2">
                  <button
                    className={`p-1 rounded ${defaultId === v.id ? 'text-yellow-500' : 'text-gray-400'} hover:bg-gray-100`}
                    onClick={() => handleSetDefault(v.id)}
                  >
                    <Star size={16}/>
                  </button>
                  {editingId === v.id ? (
                    <>
                      <input
                        className="flex-1 border rounded px-2 py-1 text-sm"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                      <button className="px-2 py-1 rounded bg-[#2D7DFE] text-white text-xs" onClick={() => handleRename(v.id)}>Save</button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 text-sm">{v.name}</div>
                      <button className="px-2 py-1 rounded text-xs hover:bg-gray-100" onClick={() => { setEditingId(v.id); setEditingName(v.name); }}>Rename</button>
                    </>
                  )}
                  <button className="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200" onClick={() => handleLoad(v)}>Load</button>
                  <button className="p-1 rounded hover:bg-red-50 text-red-500" onClick={() => handleDelete(v.id)}>
                    <Trash2 size={16}/>
                  </button>
                </div>
              ))}
              {views.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-gray-500">No views saved yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t flex justify-end">
          <button className="px-3 py-2 rounded-lg hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
