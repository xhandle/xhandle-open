import React from "react";
import {
  SAFETY_FINDING_PRIORITIES,
  SAFETY_FINDING_VIEWS,
} from "../safetyRemediationTypes";

const viewLabels = {
  [SAFETY_FINDING_VIEWS.ACTIVE]: "Active",
  [SAFETY_FINDING_VIEWS.ARCHIVED]: "Archived",
  [SAFETY_FINDING_VIEWS.REMOVED]: "Removed",
};

export default function FindingToolbar({
  filters,
  counts,
  onChange,
}) {
  const update = (patch) => onChange?.({ ...filters, ...patch });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold">
        {Object.values(SAFETY_FINDING_VIEWS).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => update({ view, folderId: "all" })}
            className={`px-2 py-1.5 ${filters.view === view ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`}
          >
            {viewLabels[view]} {counts?.[view] ?? 0}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={filters.query || ""}
        onChange={(event) => update({ query: event.target.value })}
        placeholder="Search findings"
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
      />

      <div>
        <select
          value={filters.priority || "all"}
          onChange={(event) => update({ priority: event.target.value })}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
          title="Priority"
        >
          <option value="all">Any priority</option>
          {Object.values(SAFETY_FINDING_PRIORITIES).map((priority) => (
            <option key={priority} value={priority}>{priority}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
