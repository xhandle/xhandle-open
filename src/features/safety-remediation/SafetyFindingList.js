import React from "react";
import { FINDING_STATUS_LABELS, SAFETY_FINDING_VIEWS } from "./safetyRemediationTypes";

export default function SafetyFindingList({
  findings = [],
  selectedFindingId,
  onSelect,
  view = SAFETY_FINDING_VIEWS.ACTIVE,
  onArchive,
  onRemove,
  onRestore,
  onOpenReview,
}) {
  if (!findings.length) {
    return <div className="rounded-md border border-dashed border-slate-200 p-2.5 text-xs text-slate-500">No safety findings match this view.</div>;
  }
  return (
    <div className="space-y-1.5">
      {findings.map((finding) => (
        <div
          key={finding.id}
          className={`w-full rounded-lg border p-2 text-left transition ${
            selectedFindingId === finding.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={() => onSelect?.(finding)} className="block min-w-0 flex-1 text-left">
              <div className="text-xs font-semibold leading-5 text-slate-800">{finding.title}</div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{finding.hazard || finding.description}</p>
            </button>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenReview?.(finding);
                }}
                className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                title="Open review popout"
              >
                {FINDING_STATUS_LABELS[finding.reviewStatus] || finding.reviewStatus}
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-1.5">
            {finding.folderPath && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{finding.folderPath}</span>
            )}
            {finding.priority && (
              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">Priority {finding.priority}</span>
            )}
            {(finding.riskCode || finding.riskLevel) && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{finding.riskCode || finding.riskLevel}</span>
            )}
            {Array.isArray(finding.coveredHazardRowRefs) && finding.coveredHazardRowRefs.length > 0 && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                Covers {finding.coveredHazardRowRefs.length} row{finding.coveredHazardRowRefs.length === 1 ? "" : "s"}
              </span>
            )}
            {finding.pinned && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Pinned</span>}
            <div className="ml-auto flex items-center gap-1">
              {view === SAFETY_FINDING_VIEWS.ACTIVE && (onArchive || onRemove) && (
                <>
                  {onArchive && <button type="button" onClick={() => onArchive?.(finding)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100">Archive</button>}
                  {onRemove && <button type="button" onClick={() => onRemove?.(finding)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50">Remove</button>}
                </>
              )}
              {view === SAFETY_FINDING_VIEWS.ARCHIVED && (onRestore || onRemove) && (
                <>
                  {onRestore && <button type="button" onClick={() => onRestore?.(finding)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50">Restore</button>}
                  {onRemove && <button type="button" onClick={() => onRemove?.(finding)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50">Remove</button>}
                </>
              )}
              {view === SAFETY_FINDING_VIEWS.REMOVED && onRestore && (
                <button type="button" onClick={() => onRestore?.(finding)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50">Restore</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
