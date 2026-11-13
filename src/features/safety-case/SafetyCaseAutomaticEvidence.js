import React, { useState } from "react";
import { automaticEvidenceForNode, evidenceRole } from "./safetyCaseEvidenceAutomation";
import { updateSafetyCaseAutomation } from "./safetyCaseStore";

export default function SafetyCaseAutomaticEvidence({ safetyCase, node, onNodeChange }) {
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const automatic = safetyCase.evidenceAutomation;
  if (!node) {
    const count = safetyCase.nodes.reduce((total, item) => total + automaticEvidenceForNode(safetyCase, item.id).length, 0);
    return (
      <div className="flex flex-wrap items-center gap-2 border-b bg-blue-50 px-4 py-2 text-xs" role="status">
        <span>{automatic?.paused ? "Automatic evidence paused" : !(safetyCase.sourceProjectId ?? safetyCase.projectId) ? "Choose a source project for automatic evidence" : !automatic ? "Collecting project requirements and verification evidence…"
          : !automatic.complete ? "Evidence collection incomplete" : `${automatic.artifacts?.length || 0} artifacts collected · ${count} automatic allocations`}</span>
        <span>Claims require review.</span>
        {automatic?.lastSyncedAt && <span>Updated {new Date(automatic.lastSyncedAt).toLocaleString()}</span>}
        <button type="button" className="rounded border bg-white px-2 py-1" onClick={async () => {
          try {
            await updateSafetyCaseAutomation(safetyCase.id, (latest) => ({ ...latest.evidenceAutomation, paused: !latest.evidenceAutomation?.paused }));
            setError("");
          } catch (failure) { setError(failure.message); }
        }}>{automatic?.paused ? "Resume collection" : "Pause collection"}</button>
        {(automatic?.errors || []).map((message) => <span key={message} className="text-red-700">{message}</span>)}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }
  const allocations = automaticEvidenceForNode(safetyCase, node.id);
  const excluded = node.metadata?.excludedAutomaticEvidenceIds || [];
  const patchMetadata = (changes) => onNodeChange({ ...node, metadata: { ...node.metadata, ...changes } }, { persist: true });
  return (
    <section className="mt-4 space-y-2 rounded-md border bg-blue-50 p-3 text-xs" aria-label="Automatic evidence">
      <div className="font-semibold">Automatic evidence</div>
      <label className="block">Collect for this node
        <select className="mt-1 w-full rounded border bg-white p-1" value={evidenceRole(safetyCase, node) || ""} onChange={(event) => patchMetadata({ evidenceRole: event.target.value || "none" })}>
          <option value="">Choose an evidence role</option><option value="none">Manual allocation only</option>
          <option value="design">Project requirements</option><option value="verification">Tests traced to project requirements</option>
        </select>
      </label>
      {!allocations.length && <p>No automatic evidence allocated to this node.</p>}
      {allocations.slice(0, visibleCount).map((item) => (
        <div key={item.id} className="space-y-1 rounded border bg-white p-2">
          <div className="font-medium">{item.title}</div>
          <div>{item.description}</div>
          <div>Evidence: {item.outcome} · {item.state}</div>
          <p>{item.rationale}</p>
          {item.recordedEvidence && <p className="whitespace-pre-wrap">{item.recordedEvidence}</p>}
          {item.state === "changed" && <button type="button" className="mr-2 underline" onClick={() => patchMetadata({ reviewedAutomaticEvidenceRevisions: { ...node.metadata?.reviewedAutomaticEvidenceRevisions, [item.id]: item.revision } })}>Acknowledge current revision</button>}
          <button type="button" className="underline" onClick={() => patchMetadata({ excludedAutomaticEvidenceIds: [...excluded, item.id] })}>Exclude automatic link</button>
        </div>
      ))}
      {allocations.length > visibleCount && <button type="button" className="underline" onClick={() => setVisibleCount((count) => count + 50)}>Show more automatic evidence ({allocations.length - visibleCount} remaining)</button>}
      {excluded.length > 0 && <button type="button" className="underline" onClick={() => patchMetadata({ excludedAutomaticEvidenceIds: [] })}>Restore {excluded.length} excluded automatic links</button>}
    </section>
  );
}
