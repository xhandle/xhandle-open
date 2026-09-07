import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";

export default function HazardAnalysisResetModal({ counts, busy = false, onCancel, onConfirm }) {
  const [scope, setScope] = useState("results");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="hazard-reset-title">
      <button type="button" className="absolute inset-0 bg-black/45" onClick={busy ? undefined : onCancel} aria-label="Cancel reset" />
      <div className="relative z-[121] w-full max-w-lg rounded-2xl border border-red-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
          <span className="rounded-full bg-red-100 p-2 text-red-700"><AlertTriangle size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="hazard-reset-title" className="font-semibold text-gray-900">Clear hazard analysis?</h2>
            <p className="mt-1 text-sm text-gray-600">A restorable snapshot will be saved before anything is removed.</p>
          </div>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {[["Raw rows", counts.rawRows], ["Draft rows", counts.draftRows], ["Safety issues", counts.safetyIssues], ["Reports", counts.reports], ["Review items", counts.reviewItems], ["Contexts", counts.contexts]].map(([label, count]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"><div className="text-lg font-semibold text-gray-900">{count}</div><div className="text-xs text-gray-500">{label}</div></div>
            ))}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold text-gray-800">Reset scope</legend>
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${scope === "results" ? "border-blue-400 bg-blue-50" : "border-gray-200"}`}>
              <input type="radio" name="hazard-reset-scope" value="results" checked={scope === "results"} onChange={() => setScope("results")} className="mt-1" />
              <span><strong className="block text-sm text-gray-900">Clear results only</strong><span className="text-xs text-gray-600">Preserves functional decomposition, operational contexts, method, and generation settings.</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${scope === "results-and-contexts" ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
              <input type="radio" name="hazard-reset-scope" value="results-and-contexts" checked={scope === "results-and-contexts"} onChange={() => setScope("results-and-contexts")} className="mt-1" />
              <span><strong className="block text-sm text-gray-900">Clear results and operational contexts</strong><span className="text-xs text-gray-600">Also removes all scenarios, modes, conditions, and context assumptions.</span></span>
            </label>
          </fieldset>
          <label className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/60 p-3 text-sm text-red-900">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
            <span>I understand that the current analysis, consolidated issues, reports, and linked hazard-review statuses will be cleared.</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => onConfirm(scope)} disabled={!confirmed || busy} className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Saving snapshot…" : "Clear analysis"}</button>
        </div>
      </div>
    </div>
  );
}
