import React, { useEffect, useRef } from "react";

export default function HazardCsvIssuesModal({ issues = [], onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (issues.length && !dialog.open) dialog.showModal();
    if (!issues.length && dialog.open) dialog.close();
  }, [issues]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      aria-labelledby="hazard-csv-issues-title"
      aria-describedby="hazard-csv-issues-description"
      className="m-auto w-[calc(100%-2rem)] max-w-3xl rounded-xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-100"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="shrink-0 border-b border-gray-200 px-5 py-4 dark:border-zinc-700">
          <h2 id="hazard-csv-issues-title" className="text-lg font-semibold">CSV import issues ({issues.length})</h2>
          <p id="hazard-csv-issues-description" className="mt-1 text-sm">
            This CSV cannot be imported. All {issues.length} issues are listed below. No CSV updates were applied.
          </p>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4" tabIndex={0} role="region" aria-label="All CSV import issues">
          <ul className="list-disc space-y-3 break-words pl-5 text-sm">
            {issues.map((issue, index) => <li key={index}>{issue}</li>)}
          </ul>
        </div>
        <div className="flex shrink-0 justify-end border-t border-gray-200 px-5 py-3 dark:border-zinc-700">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
