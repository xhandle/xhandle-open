import React, { useEffect, useState } from "react";
import { SAFETY_FINDING_PRIORITIES } from "../safetyRemediationTypes";

export default function FindingOrganizationControls({ finding, busy = false, onSave }) {
  const [draft, setDraft] = useState({
    folderPath: "",
    tags: "",
    priority: SAFETY_FINDING_PRIORITIES.MEDIUM,
    owner: "",
    pinned: false,
  });

  useEffect(() => {
    setDraft({
      folderPath: finding?.folderPath || "",
      tags: Array.isArray(finding?.tags) ? finding.tags.join(", ") : "",
      priority: finding?.priority || SAFETY_FINDING_PRIORITIES.MEDIUM,
      owner: finding?.owner || "",
      pinned: Boolean(finding?.pinned),
    });
  }, [finding]);

  if (!finding) return null;

  const save = () => {
    const folderPath = draft.folderPath.trim();
    onSave?.({
      folderPath,
      folderId: folderPath,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      priority: draft.priority,
      owner: draft.owner.trim(),
      pinned: Boolean(draft.pinned),
    });
  };

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Organize Selected
      </summary>
      <div className="mt-2 space-y-2">
        <input
          value={draft.folderPath}
          onChange={(event) => setDraft((prev) => ({ ...prev, folderPath: event.target.value }))}
          placeholder="Folder, e.g. Flight Control / Timing"
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-800"
        />
        <input
          value={draft.tags}
          onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
          placeholder="Tags, comma separated"
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-800"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={draft.priority}
            onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value }))}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700"
          >
            {Object.values(SAFETY_FINDING_PRIORITIES).map((priority) => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>
          <input
            value={draft.owner}
            onChange={(event) => setDraft((prev) => ({ ...prev, owner: event.target.value }))}
            placeholder="Owner"
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-800"
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(event) => setDraft((prev) => ({ ...prev, pinned: event.target.checked }))}
          />
          Pin to top
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full rounded-md bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Save Organization
        </button>
      </div>
    </details>
  );
}
