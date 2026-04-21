/**
 * xHandle: project picker modal modal workflow.
 * This file implements a focused modal surface used inside the xHandle workspace to collect input, expose a feature-specific editor, or present supporting project information.
 * Modal flows keep secondary tasks close to the main engineering workspace without forcing a separate route or losing the surrounding project context.
 * Related files: src/App.js, src/components/layout/TopNavBar.jsx, src/features/settings/SettingsModal.jsx.
 */

import React, { useEffect, useState } from "react";

export default function ProjectPickerModal({
  open,
  onClose,
  onSelect,     // (project) => void
  onCreate,     // (name) => void
  fetchProjects // async () => [{id, name, updatedAt?}]
}) {
  if (!open) return null;
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const items = await fetchProjects();
        if (mounted) setProjects(items || []);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => (mounted = false);
  }, [fetchProjects]);

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Select project</h3>
            <button className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" onClick={onClose}>✕</button>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="Search projects…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div className="max-h-64 overflow-auto border rounded">
              {loading ? (
                <div className="p-3 text-sm text-gray-500">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">No projects found.</div>
              ) : (
                <ul>
                  {filtered.map(p => (
                    <li key={p.id}>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                        onClick={() => { onSelect(p); onClose(); }}
                      >
                        <div className="text-sm font-medium">{p.name}</div>
                        {p.updatedAt && (
                          <div className="text-xs text-gray-500">Updated {new Date(p.updatedAt).toLocaleString()}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t pt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Create new project</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  placeholder="Project name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button
                  className="px-3 py-1 text-sm rounded bg-black text-white disabled:opacity-40"
                  disabled={!newName.trim()}
                  onClick={() => { onCreate(newName.trim()); setNewName(""); onClose(); }}
                >
                  Create
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
