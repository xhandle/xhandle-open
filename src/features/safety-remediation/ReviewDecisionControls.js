import React, { useState } from "react";
import { REVIEW_DECISION_LABELS, SAFETY_REMEDIATION_REVIEW_DECISIONS } from "./safetyRemediationTypes";

const decisions = [
  SAFETY_REMEDIATION_REVIEW_DECISIONS.APPROVE,
  SAFETY_REMEDIATION_REVIEW_DECISIONS.APPROVE_WITH_CHANGES,
  SAFETY_REMEDIATION_REVIEW_DECISIONS.REJECT,
  SAFETY_REMEDIATION_REVIEW_DECISIONS.REGENERATE,
  SAFETY_REMEDIATION_REVIEW_DECISIONS.NEEDS_MORE_INFO,
];

export default function ReviewDecisionControls({ targetType = "finding", disabled = false, onDecision }) {
  const [notes, setNotes] = useState("");
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <label className="text-xs font-semibold uppercase text-slate-500">Reviewer notes</label>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        className="mt-2 min-h-[84px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        placeholder={`Notes for this ${targetType}`}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            disabled={disabled}
            onClick={() => onDecision?.(decision, notes)}
            className={`rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
              decision === SAFETY_REMEDIATION_REVIEW_DECISIONS.APPROVE
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : decision === SAFETY_REMEDIATION_REVIEW_DECISIONS.REJECT
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {REVIEW_DECISION_LABELS[decision]}
          </button>
        ))}
      </div>
    </div>
  );
}
