import React, { useEffect, useState } from "react";
import {
  SAFETY_FINDING_IMPLEMENTATION_STATUSES,
  SAFETY_FINDING_VERIFICATION_STATUSES,
  SAFETY_REMEDIATION_TEST_STATUSES,
} from "./safetyRemediationTypes";

export default function ImplementationEvidenceForm({ finding, busy = false, onSave }) {
  const [draft, setDraft] = useState({});

  useEffect(() => {
    setDraft({
      implementationStatus: finding?.implementationStatus || SAFETY_FINDING_IMPLEMENTATION_STATUSES.NOT_STARTED,
      appliedAt: finding?.appliedAt || "",
      appliedBy: finding?.appliedBy || "",
      localBranch: finding?.localBranch || "",
      commitSha: finding?.commitSha || "",
      pullRequestUrl: finding?.pullRequestUrl || "",
      pullRequestNumber: finding?.pullRequestNumber || "",
      testStatus: finding?.testStatus || SAFETY_REMEDIATION_TEST_STATUSES.NOT_RUN,
      testEvidence: finding?.testEvidence || "",
      verificationStatus: finding?.verificationStatus || SAFETY_FINDING_VERIFICATION_STATUSES.PENDING,
      implementationNotes: finding?.implementationNotes || "",
    });
  }, [finding]);

  if (!finding) return null;

  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const markApplied = () => {
    const now = new Date().toISOString();
    const patch = {
      ...draft,
      implementationStatus: SAFETY_FINDING_IMPLEMENTATION_STATUSES.APPLIED_LOCALLY,
      appliedAt: draft.appliedAt || now,
    };
    setDraft(patch);
    onSave?.(patch);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Implementation Evidence</div>
          <p className="mt-1 text-xs text-slate-500">Record what happened after the patch was reviewed and applied in VS Code.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={markApplied}
          className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Mark Applied in VS Code
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold uppercase text-slate-500">
          Implementation Status
          <select value={draft.implementationStatus || ""} onChange={(e) => update("implementationStatus", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800">
            {Object.values(SAFETY_FINDING_IMPLEMENTATION_STATUSES).map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Verification Status
          <select value={draft.verificationStatus || ""} onChange={(e) => update("verificationStatus", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800">
            {Object.values(SAFETY_FINDING_VERIFICATION_STATUSES).map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Local Branch
          <input value={draft.localBranch || ""} onChange={(e) => update("localBranch", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Commit SHA
          <input value={draft.commitSha || ""} onChange={(e) => update("commitSha", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          PR URL
          <input value={draft.pullRequestUrl || ""} onChange={(e) => update("pullRequestUrl", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          PR Number
          <input value={draft.pullRequestNumber || ""} onChange={(e) => update("pullRequestNumber", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Test Status
          <select value={draft.testStatus || ""} onChange={(e) => update("testStatus", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800">
            {Object.values(SAFETY_REMEDIATION_TEST_STATUSES).map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-slate-500">
          Applied By
          <input value={draft.appliedBy || ""} onChange={(e) => update("appliedBy", e.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold uppercase text-slate-500">
        Test Evidence
        <textarea value={draft.testEvidence || ""} onChange={(e) => update("testEvidence", e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
      </label>
      <label className="mt-3 block text-xs font-semibold uppercase text-slate-500">
        Implementation Notes
        <textarea value={draft.implementationNotes || ""} onChange={(e) => update("implementationNotes", e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm normal-case text-slate-800" />
      </label>
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={busy} onClick={() => onSave?.(draft)} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          Save Evidence
        </button>
      </div>
    </div>
  );
}
