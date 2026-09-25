import React, { useEffect, useMemo, useState } from "react";
import { History, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";

/**
 * Discover, preview, and restore retained hazard-analysis revisions.
 *
 * The revision journal existed for a while with no product surface, which meant
 * a lost analysis was still sitting in IndexedDB and was nonetheless
 * unrecoverable for anyone without developer tools. This is that surface.
 */

const REASON_LABELS = {
  "before-vibe-review": "Before a Vibe Review",
  "revision-restore": "Restored from history",
  "explicit-user-clear": "Cleared by you",
};

function describeReason(reason) {
  if (!reason) return "Automatic save";
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  if (reason.startsWith("vibe-review:")) return `Review decision (${reason.slice("vibe-review:".length)})`;
  return reason;
}

function formatWhen(value) {
  if (!value) return "Unknown time";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "Unknown time";
  return at.toLocaleString();
}

const STATUS_MESSAGES = {
  unavailable: "Browser storage is unavailable, so saved versions could not be listed. This does not mean they are gone — try again once storage is available.",
  "write-error": "Saved versions could not be read because browser storage returned an error.",
  quota: "Browser storage is full, so saved versions could not be read.",
  missing: "This project has no saved version history yet.",
};

export default function HazardAnalysisRecoveryModal({
  open,
  projectName = "",
  headMissing = false,
  listing = null,
  busyRevision = null,
  previewRevision = null,
  onPreview,
  onRestore,
  onClose,
}) {
  const [selected, setSelected] = useState(null);

  const revisions = useMemo(
    () => [...(listing?.revisions || [])].sort((a, b) => (b.revision || 0) - (a.revision || 0)),
    [listing],
  );

  useEffect(() => {
    if (open && selected === null && revisions.length) setSelected(revisions[0].revision);
  }, [open, revisions, selected]);

  if (!open) return null;

  const listingFailed = listing && listing.status !== "ok";
  const nothingToShow = !listingFailed && revisions.length === 0;

  return (
    <div className="xhandle-modal-viewport fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="hazard-recovery-title">
      <button type="button" className="absolute inset-0 bg-black/45" onClick={busyRevision ? undefined : onClose} aria-label="Close recovery" />
      <div className="relative z-[121] flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-blue-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
          <span className="rounded-full bg-blue-100 p-2 text-blue-700"><History size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="hazard-recovery-title" className="font-semibold text-gray-900">Restore a saved hazard analysis</h2>
            <p className="mt-1 text-sm text-gray-600">
              {projectName ? `${projectName} — ` : ""}
              xHandle keeps recent versions so a bad save or an interrupted review can be undone.
            </p>
          </div>
        </div>

        {headMissing && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              The current hazard analysis is missing or unreadable, but saved versions exist. Restoring one below will
              bring it back. Nothing has been deleted.
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {listingFailed && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {STATUS_MESSAGES[listing.status] || "Saved versions could not be listed."}
            </p>
          )}

          {nothingToShow && (
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              There are no saved versions for this project yet. Versions are kept automatically as the analysis changes.
            </p>
          )}

          {!listingFailed && revisions.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Saved hazard-analysis versions, newest first</caption>
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th scope="col" className="py-2 pr-3">Saved</th>
                  <th scope="col" className="py-2 pr-3">Version</th>
                  <th scope="col" className="py-2 pr-3">Rows</th>
                  <th scope="col" className="py-2 pr-3">Why it was saved</th>
                  <th scope="col" className="py-2 pr-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((entry) => {
                  const isSelected = selected === entry.revision;
                  return (
                    <tr
                      key={entry.revision}
                      className={`border-b border-gray-100 ${isSelected ? "bg-blue-50" : ""}`}
                      onClick={() => setSelected(entry.revision)}
                    >
                      <td className="py-2 pr-3 text-gray-900">{formatWhen(entry.updatedAt)}</td>
                      <td className="py-2 pr-3 text-gray-600">{entry.revision}</td>
                      <td className="py-2 pr-3 text-gray-600">{entry.rowCount}</td>
                      <td className="py-2 pr-3 text-gray-600">
                        <span className="flex items-center gap-1.5">
                          {entry.pinned && (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
                              <ShieldCheck size={12} aria-hidden="true" /> Kept
                            </span>
                          )}
                          {describeReason(entry.lastWriteReason)}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            onClick={() => onPreview?.(entry.revision)}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            disabled={busyRevision !== null}
                            onClick={() => onRestore?.(entry.revision)}
                          >
                            {busyRevision === entry.revision ? "Restoring…" : "Restore"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {previewRevision && (
            <div className="mt-4 rounded-lg border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                Preview of version {previewRevision.revision} — first rows
              </div>
              <div className="max-h-56 overflow-auto p-3">
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {(previewRevision.analysisResult?.Summary || []).slice(0, 6).map((row, rowIndex) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={rowIndex} className={rowIndex === 0 ? "font-semibold text-gray-700" : "text-gray-600"}>
                        {(row || []).slice(0, 6).map((cell, cellIndex) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <td key={cellIndex} className="max-w-[12rem] truncate border-b border-gray-100 py-1 pr-3">{String(cell ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-5 py-4">
          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            <RotateCcw size={14} aria-hidden="true" />
            Restoring keeps the current version in history, so a restore can itself be undone.
          </p>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={busyRevision !== null}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
